// src/index.js
// Stable scraper: native fetch, resilient link regex, optional HTML dumps,
// optional Firebase (disabled by default).
// No opening of URLs — only logs + optional file outputs.

const DEFAULT_UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const SAUDI_PAGES = parseInt(process.env.SAUDI_PAGES || '1', 10);
const PAUSE_MS = parseInt(process.env.PAUSE_MS || '350', 10);
const ENABLE_EMAIL_EXTRACTION = (process.env.ENABLE_EMAIL_EXTRACTION ?? '1') !== '0';
const DUMP_HTML = (process.env.DUMP_HTML ?? '0') !== '0';
const FIREBASE_DISABLED = (process.env.FIREBASE_DISABLED ?? '0') !== '0'; // default to enabled
const MIN_DESCRIPTION_LEN = parseInt(process.env.MIN_DESCRIPTION_LEN || '120', 10);
const CATEGORIES = new Set([
  "Civil",
  "Mechanical",
  "Electrical",
  "HSE",
  "QAQC",
  "Project Management",
  "Planning",
  "Estimation",
  "Procurement/Logistics"
]);

// Simple pause
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Write helper
function wrote(row) {
  console.log('[WROTE]', JSON.stringify(row));
}

// Minimal Firebase writer shim — no ADC, no firebase-admin import unless configured.
async function writeToFirebase(_path, _data) {
  // Intentionally no-op by default; enable explicitly if you rewire Firebase later.
  return;
}

// HTML dump utility
import fs from 'node:fs';
import path from 'node:path';
import { enhanceJobRecord } from './ai/openaiClean.js';
import { splitMultiRoles } from './splitter.js';
import { normalizeJobRecord } from './lib/schema-normalizer.js';
import { initFirebaseIfPossible, writeRow } from './writer.js';
import { chooseCategory } from './category.js';
function dumpHtml(kind, index, html) {
  if (!DUMP_HTML) return;
  const dir = path.join(process.cwd(), 'runs', 'html');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${String(index).padStart(3, '0')}.html`);
  fs.writeFileSync(file, html, 'utf8');
}

// Fetch wrapper with UA
async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1'
    }
  });
  return res;
}

// Parse job detail links robustly using regex on href.
function extractJobLinks(listHtml, baseUrl) {
  const links = new Set();
  const re = /href\s*=\s*"([^"]*job-details\?jobid=\d+[^"]*)"/gi;
  let m;
  while ((m = re.exec(listHtml)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      links.add(abs);
    } catch {}
  }
  return Array.from(links);
}

// Extract emails from page text
function extractEmails(html) {
  const emails = new Set();
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let email = m[0];
    // Remove trailing junk after TLD (e.g., "@gmail.comOffice" -> "@gmail.com")
    email = email.replace(/(\.[A-Za-z]{2,})[A-Z][a-zA-Z]*$/, '$1');
    // Remove common prefixes that get attached (e.g., "WhatsApprubel@" -> "rubel@")
    email = email.replace(/^(WhatsApp|Email|E-mail|Mail|Contact|Call|Phone|Tel|Mob|Mobile)/i, '');
    // Clean up any leading/trailing punctuation
    email = email.replace(/^[^A-Za-z0-9]+/, '').replace(/[\s,;:"')\]]+$/, '');
    // Validate it still looks like an email
    if (email.includes('@') && email.includes('.')) {
      emails.add(email.toLowerCase());
    }
  }
  return Array.from(emails);
}

function parseTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return 'Recent Jobs';
  return m[1].replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  // remove scripts/styles early to avoid noise
  s = s.replace(/<\s*(script|style|noscript)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ');
  // preserve list structure and line breaks
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/\s*p\s*>/gi, '\n');
  s = s.replace(/<\s*li[^>]*>/gi, '\n- ');
  s = s.replace(/<\/\s*li\s*>/gi, '\n');
  s = s.replace(/<\/\s*(ul|ol|div|section|article)\s*>/gi, '\n');
  // strip tags
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeHtmlEntities(s);
  s = s.replace(/\u00A0/g, ' ');
  // drop common bullet artifacts
  s = s.replace(/[•·\u2022]+/g, ' ');
  // normalize odd icon placeholders like "????"
  s = s.replace(/\?{2,}/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.trim();
  return s;
}

function stripNoiseHtml(html) {
  let s = String(html || '');
  s = s.replace(/<\s*(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ');
  s = s.replace(/<\s*(header|footer|nav|aside|form|button)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ');
  return s;
}

function extractDescriptionHtml(html) {
  const patterns = [
    /<div[^>]+class=["'][^"']*(job[-\s]?description|job[-\s]?details|job[-\s]?detail|job[-\s]?content|description|details|content|post[-\s]?content|entry[-\s]?content|single[-\s]?content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]+class=["'][^"']*(job[-\s]?description|job[-\s]?details|job[-\s]?detail|description|details|content|post[-\s]?content|entry[-\s]?content)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i
  ];
  let best = '';
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[2] && m[2].length > best.length) best = m[2];
    if (m && m[1] && m[1].length > best.length) best = m[1];
  }
  return best;
}

function extractDescriptionFromText(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  const anchors = ['job description', 'description', 'responsibilities', 'requirements'];
  let start = -1;
  for (const a of anchors) {
    const idx = lower.indexOf(a);
    if (idx !== -1) {
      start = idx;
      break;
    }
  }
  if (start === -1) return '';
  let out = text.slice(start);
  // cut off footer/signature noise
  const stops = ['regards', 'interested candidates', 'apply now', 'send your cv', 'email:', 'contact', 'phone'];
  for (const s of stops) {
    const i = out.toLowerCase().indexOf(s);
    if (i > 200) {
      out = out.slice(0, i);
      break;
    }
  }
  return out.trim();
}

function extractBestDescription(html) {
  const cleanedHtml = stripNoiseHtml(html || '');
  const candidates = [];

  // Prefer og:description if present and long enough
  const ogDescMatch = cleanedHtml.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (ogDescMatch && ogDescMatch[1]) {
    candidates.push(htmlToText(ogDescMatch[1]));
  }

  const byContainer = extractDescriptionHtml(cleanedHtml);
  if (byContainer) candidates.push(htmlToText(byContainer));

  const bodyMatch = cleanedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : cleanedHtml;
  const bodyText = htmlToText(bodyHtml);
  if (bodyText) candidates.push(bodyText);

  const fromText = extractDescriptionFromText(bodyText);
  if (fromText) candidates.push(fromText);

  // Pick the longest meaningful candidate
  let best = '';
  for (const c of candidates) {
    const t = (c || '').replace(/\s+/g, ' ').trim();
    if (t.length > best.length && !/^view job$/i.test(t)) best = t;
  }
  return best;
}

// Extract job title from job detail page (og:title meta tag)
function parseJobTitle(html) {
  // Try og:title first (most reliable for job pages)
  const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogMatch) {
    return htmlToText(ogMatch[1]);
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    return htmlToText(h1Match[1]);
  }
  // Fallback to first <title> tag before the DOCTYPE
  const titleMatch = html.match(/^[\s\S]*?<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    return htmlToText(titleMatch[1]);
  }
  return 'Unknown Job';
}

export async function run() {
  console.log('[RapidApply SA] Starting scraper: pages=%d, pauseMs=%d', SAUDI_PAGES, PAUSE_MS);
  if (FIREBASE_DISABLED) {
    console.log('[firebase] writing disabled via FIREBASE_DISABLED=1');
  }
  const firebaseReady = await initFirebaseIfPossible();
  if (!firebaseReady && !FIREBASE_DISABLED) {
    console.log('[firebase] not initialized; rows will be logged only');
  }

  let totalWrote = 0;

  for (let page = 1; page <= SAUDI_PAGES; page++) {
    const listUrl = `https://www.saudijobs.in/index?page=${page}`;
    console.log('[list] %s', listUrl);
    const res = await get(listUrl);
    console.log('[debug] status=%d', res.status);
    const html = await res.text();
    dumpHtml('list', page, html);

    const links = extractJobLinks(html, listUrl);
    console.log('[links] page %d: found %d', page, links.length);

    if (links.length === 0) {
      // Emit a sentinel row so you can see the page parsed
      wrote({
        title: parseTitle(html) || 'Recent Jobs',
        category: 'Other',
        location: 'Saudi Arabia',
        email: null,
        emails: []
      });
      continue;
    }

    for (const [idx, jobUrl] of links.entries()) {
      let emails = [];
      let chosen = null;
      let title = 'Unknown Job';
      let description = '';

      try {
        const jr = await get(jobUrl);
        const jhtml = await jr.text();
        if (DUMP_HTML) {
          dumpHtml(`job-${String(page).padStart(3, '0')}-${String(idx + 1).padStart(3, '0')}`, 1, jhtml);
        }
        // Extract title from job page
        title = parseJobTitle(jhtml);
        description = extractBestDescription(jhtml);
        if (description && description.length < MIN_DESCRIPTION_LEN) {
          description = null;
        }
        // Extract emails if enabled
        if (ENABLE_EMAIL_EXTRACTION) {
          emails = extractEmails(jhtml);
          chosen = emails.length ? emails[0] : null;
        }
      } catch {
        // ignore single-link failures
      }

      const base = {
        title,
        description,
        category: null,
        location: 'Saudi Arabia',
        email: chosen,
        emails,
        url: jobUrl
      };

      const expanded = splitMultiRoles(base);
      for (const rec of expanded) {
        const enhanced = await enhanceJobRecord(rec);
        const finalTitle = enhanced.title ?? rec.title;
        const finalDesc = enhanced.description ?? rec.description;
        const aiCategory = typeof enhanced.category === 'string' && CATEGORIES.has(enhanced.category)
          ? enhanced.category
          : null;
        const category = aiCategory || chooseCategory(finalTitle, finalDesc);
        const row = normalizeJobRecord({ ...rec, ...enhanced, category });
        wrote(row);
        await writeRow(row);
        totalWrote += 1;
      }

      if (PAUSE_MS > 0) await sleep(PAUSE_MS);
    }
  }

  console.log('[RapidApply SA] Done. wrote=%d, errors=0', totalWrote);
}

// default export (optional)
export default { run };

import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import nodemailer from "nodemailer";

admin.initializeApp();

const db = admin.database();
const storage = admin.storage();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SAUDI_PAGES = parseInt(process.env.SAUDI_PAGES || "1", 10);
const MIN_DESCRIPTION_LEN = parseInt(process.env.MIN_DESCRIPTION_LEN || "120", 10);

const BRAND = "MegaApply™";
const FOOTER = "Powered by So Jobless Inc.";
const CATEGORIES = [
  "Civil",
  "Mechanical",
  "Electrical",
  "HSE",
  "QAQC",
  "Project Management",
  "Planning",
  "Estimation",
  "Procurement/Logistics"
];

const LOCATION_WORDS = new Set([
  "saudi", "arabia", "ksa", "riyadh", "jeddah", "dammam", "jubail",
  "khobar", "alkhobar", "al-khobar", "makkah", "mecca", "medina",
  "tabuk", "abha", "jazan", "najran", "hail", "hofuf", "al-kharj"
]);

const VAGUE_PATTERNS = [
  /urgent\s*requirement/i,
  /urgent\s*hiring/i,
  /multiple\s*positions?/i,
  /various\s*roles?/i,
  /manpower\s*requirement/i,
  /positions?\s*available/i,
  /we\s*are\s*hiring/i,
  /hiring\s*now/i,
  /our\s*company\s*needs/i,
  /job\s*vacanc(?:y|ies)/i,
  /job\s*title/i,
  /vacanc(?:y|ies)\s*open/i
];

function toTitleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(^|[\s\-_/])(\w)/g, (_, a, b) => a + b.toUpperCase())
    .trim();
}

function preserveAcronyms(s) {
  let out = String(s || "");
  out = out.replace(/\bqa\/?qc\b/gi, "QA/QC");
  out = out.replace(/\bqaqc\b/gi, "QA/QC");
  out = out.replace(/\bqa\b/gi, "QA");
  out = out.replace(/\bqc\b/gi, "QC");
  out = out.replace(/\bqs\b/gi, "QS");
  return out;
}

function stripLocationSuffix(s) {
  return String(s || "")
    .replace(/\s*[-–,]\s*(riyadh|jeddah|dammam|jubail|ksa|saudi arabia|saudi)\b.*$/i, "")
    .trim();
}

function isLocationOnly(s) {
  const tokens = String(s || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((t) => LOCATION_WORDS.has(t.replace(/[^a-z\-]/g, "")));
}

function isVagueTitle(s) {
  const t = String(s || "").trim();
  if (!t || t.length < 4) return true;
  if (isLocationOnly(t)) return true;
  return VAGUE_PATTERNS.some((re) => re.test(t));
}

function cleanJobTitleStrict(raw) {
  let s = cleanTitleBasic(raw || "");
  s = s.replace(/\b(urgent|requirement|requirements|hiring|needed|vacancy|vacancies)\b/gi, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = stripLocationSuffix(s);
  s = toTitleCase(s);
  s = preserveAcronyms(s);
  return s;
}

function extractRoleFromText(text) {
  if (!text) return "";
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const patterns = [
    /^(?:position|job\s*title|role)\s*[:\-]\s*(.+)$/i,
    /^(?:hiring|wanted|required|we are hiring|we are looking for|seeking)\s*[:\-]?\s*(.+)$/i,
    /(?:looking for|seeking)\s+(?:an|a)\s+([A-Za-z0-9 /&\-()]+)\b/i
  ];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1]) {
        const candidate = cleanJobTitleStrict(m[1]);
        if (!isVagueTitle(candidate)) return candidate;
      }
    }
  }
  return "";
}

function normalizeCategory(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower === "qa/qc" || lower === "qaqc" || lower.includes("quality")) return "QAQC";
  if (lower.includes("procurement") || lower.includes("logistics") || lower.includes("supply")) {
    return "Procurement/Logistics";
  }
  if (lower.includes("project") || lower.includes("pm")) return "Project Management";
  if (lower.includes("estimation") || lower.includes("cost")) return "Estimation";
  if (lower.includes("planning")) return "Planning";
  if (lower.includes("electrical")) return "Electrical";
  if (lower.includes("mechanical")) return "Mechanical";
  if (lower.includes("civil")) return "Civil";
  if (lower.includes("hse") || lower.includes("safety")) return "HSE";
  return CATEGORIES.includes(s) ? s : "";
}

function mailer() {
  const host = SMTP_HOST.value();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  if (!host || !user || !pass) {
    throw new Error("SMTP settings missing");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function centeredEmailTemplate({ heading, subheading, contentHtml, footer }) {
  return `
  <div style="background:#f6f2ee;padding:30px 0;font-family:Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;background:#fff8f1;border-radius:20px;padding:32px;text-align:center;border:1px solid #eadfd4;">
      <div style="font-size:28px;font-weight:800;letter-spacing:.3px;color:#1f1a17;margin-bottom:6px;">${BRAND}</div>
      <div style="color:#f05a28;font-weight:700;font-size:16px;margin-bottom:22px;">${subheading || "Auto Apply Summary"}</div>
      <h2 style="margin:0 0 10px;font-size:22px;color:#1f1a17;">${heading}</h2>
      <div style="font-size:14px;color:#6b5f58;line-height:1.6;margin:12px 0 22px;">${contentHtml}</div>
      <div style="margin-top:22px;padding-top:14px;border-top:1px dashed #eadfd4;color:#9b8b81;font-size:12px;">${footer}</div>
    </div>
  </div>`;
}

function employerEmailTemplate({ contentHtml, footer, headerTitle }) {
  return `
  <div style="background:#f5f6fb;padding:34px 0;font-family:Arial,sans-serif;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:22px;border:1px solid #e5e9f2;overflow:hidden;">
      <div style="padding:26px 28px;background:linear-gradient(135deg,#ffe3b1 0%,#ffd1dc 45%,#c7d7ff 100%);color:#1f2333;text-align:center;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;opacity:.85;">Candidate Submission</div>
        <div style="margin-top:10px;font-size:28px;font-weight:900;letter-spacing:.3px;">${headerTitle || "Job Application"}</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;">Ready for immediate review</div>
      </div>
      <div style="padding:26px 28px;background:#ffffff;color:#1f2333;text-align:center;">
        ${contentHtml}
        <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e9edf5;color:#8b95ad;font-size:12px;text-align:center;">
          ${footer}
        </div>
      </div>
    </div>
  </div>`;
}

function dailyEmailTemplate({ heading, subheading, contentHtml, footer }) {
  return `
  <div style="background:#f5f6fb;padding:34px 0;font-family:Arial,sans-serif;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:22px;border:1px solid #e5e9f2;overflow:hidden;">
      <div style="padding:26px 28px;background:linear-gradient(135deg,#ffe3b1 0%,#ffd1dc 45%,#c7d7ff 100%);color:#1f2333;text-align:center;">
        <div style="display:flex;justify-content:center;gap:10px;align-items:center;margin-bottom:6px;">
          <span style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#8fb3ff,#7b61ff,#a6c1ff);display:inline-block;border:1px solid rgba(0,0,0,0.05);"></span>
          <span style="font-size:16px;font-weight:800;letter-spacing:.2px;color:#1f2333;">MegaApply<span style="font-size:12px;vertical-align:top;">™</span></span>
        </div>
        <div style="margin-top:10px;font-size:28px;font-weight:900;letter-spacing:.3px;">${heading}</div>
        <div style="margin-top:6px;font-size:14px;font-weight:700;">${subheading || "Daily Summary"}</div>
      </div>
      <div style="padding:26px 28px;background:#ffffff;color:#1f2333;text-align:center;">
        ${contentHtml}
        <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e9edf5;color:#8b95ad;font-size:12px;text-align:center;">
          ${footer}
        </div>
      </div>
    </div>
  </div>`;
}

// --- Scraper helpers (Firebase-only scheduled job) ---
const TITLE_NOISE = [
  [/^\s*job\s*vacanc(?:y|ies)\s*[:\-–]?\s*/i, ""],
  [/^\s*job\s*title\s*[:\-–]\s*/i, ""],
  [/^\s*position\s*[:\-–]\s*/i, ""],
  [/^\s*urgent\s*requirement[s]?\s*(for)?\s*/i, ""],
  [/^\s*urgent\s*hiring\s*[:\-–]?\s*/i, ""],
  [/^\s*required\s*in\s*saudi\b\s*[:\-–]?\s*/i, ""],
  [/[\!]+/g, ""],
];

function cleanTitleBasic(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  for (const [re, rep] of TITLE_NOISE) s = s.replace(re, rep);
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || "Recent Jobs";
}

function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function htmlToText(html) {
  if (!html) return "";
  let s = String(html);
  s = s.replace(/<\s*(script|style|noscript)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<\/\s*p\s*>/gi, "\n");
  s = s.replace(/<\s*li[^>]*>/gi, "\n- ");
  s = s.replace(/<\/\s*li\s*>/gi, "\n");
  s = s.replace(/<\/\s*(ul|ol|div|section|article)\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);
  s = s.replace(/\u00A0/g, " ");
  s = s.replace(/[•·\u2022]+/g, " ");
  s = s.replace(/\?{2,}/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ").trim();
  return s;
}

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

function parseJobTitle(html) {
  const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogMatch) return htmlToText(ogMatch[1]);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return htmlToText(h1Match[1]);
  const titleMatch = html.match(/^[\s\S]*?<title>([^<]+)<\/title>/i);
  if (titleMatch) return htmlToText(titleMatch[1]);
  return "Unknown Job";
}

function extractBestDescription(html) {
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (ogDescMatch && ogDescMatch[1]) {
    return htmlToText(ogDescMatch[1]);
  }
  return htmlToText(html);
}

function extractEmails(html) {
  const emails = new Set();
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const email = m[0].toLowerCase();
    if (email.includes("@") && email.includes(".")) emails.add(email);
  }
  return Array.from(emails);
}

const CATEGORY_RULES = [
  { cat: "Civil", re: /(\bcivil\b|structural|infrastructure|road\b|highway|bridge|tunnel|concrete|rebar|land\s*survey(or)?|\bqs\b|quantity\s*survey(or)?)/i },
  { cat: "Mechanical", re: /(\bmechanical\b|mep\b|plumbing|fire\s*fighting|hvac|chiller|duct|pump|piping|rotating\s*equipment|static\s*equipment)/i },
  { cat: "Electrical", re: /(electrical|\belv\b|low\s*current|substation|mv\b|lv\b|transformer|protection\s*relay|switchgear|power\s*system|panel\s*board)/i },
  { cat: "Planning", re: /(planning|scheduler|primavera|\bp6\b|project\s*controls)/i },
  { cat: "Estimation", re: /(estimator|estimation|tender|bid|boq\b|cost\s*(control|engineer)|pricing)/i },
  { cat: "QAQC", re: /(qa\/?qc|\bqa\b|\bqc\b|quality\s*(assurance|control|engineer)|quality\s*inspector|inspection\b|inspector\b|welding\s*inspection|ndt\b|coating\s*inspection|iso\s*9001)/i },
  { cat: "HSE", re: /(\bhse\b|\bohs\b|safety\b|nebosh|osha\b|iosh\b|permit\s*to\s*work|ptw)/i },
  { cat: "Project Management", re: /(project\s*(manager|engineer|coordinator)|\bpm\b(?![a-z])|epc\b|lead\s*engineer|site\s*(manager|engineer)|document\s*controller|doc\s*controller|document\s*control)/i },
  { cat: "Procurement/Logistics", re: /(procure|buyer|purchas|expedit|vendor\s*dev|supply\s*chain|material\s*controller?|warehouse|store\s*keeper|storeman|logistics|inventory|material\s*handling)/i },
  { cat: "Project Management", re: /./i }
];

function chooseCategory(title, desc = "") {
  const hay = `${title || ""} ${desc || ""}`;
  for (const r of CATEGORY_RULES) {
    if (r.re.test(hay)) return r.cat;
  }
  return "Project Management";
}

async function enhanceWithOpenAI({ title, description }) {
  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const categoryList = CATEGORIES.join(", ");
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You clean and improve scraped job data. Fix typos/casing. Do not invent facts. " +
          `Assign one category from this exact list: ${categoryList}. ` +
          "Title must be only the job role (no locations, no urgency words, no company names). " +
          "Return strict JSON with keys: title, description, category."
      },
      {
        role: "user",
        content: JSON.stringify({ title, description })
      }
    ],
    response_format: { type: "json_object" }
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const rawCategory = typeof parsed.category === "string" ? parsed.category.trim() : "";
  const category = normalizeCategory(rawCategory);
  return {
    title: cleanTitleBasic(parsed.title || title),
    description: String(parsed.description || description || "").trim(),
    category
  };
}

function jobIdFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get("jobid");
  } catch {
    return null;
  }
}

export const scrapeSaudiJobsDaily = onSchedule(
  { schedule: "every day 05:00", secrets: [OPENAI_API_KEY] },
  async () => {
    const base = "https://www.saudijobs.in";
    const nowIso = new Date().toISOString();
    for (let page = 1; page <= SAUDI_PAGES; page++) {
      const listUrl = `${base}/index?page=${page}`;
      const res = await fetch(listUrl);
      if (!res.ok) continue;
      const html = await res.text();
      const links = extractJobLinks(html, listUrl);
      for (const jobUrl of links) {
        const jobId = jobIdFromUrl(jobUrl);
        if (!jobId) continue;
        const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
        if (jobSnap.exists()) continue;
        const jr = await fetch(jobUrl);
        if (!jr.ok) continue;
        const jhtml = await jr.text();
        const rawTitle = parseJobTitle(jhtml);
        const rawDesc = extractBestDescription(jhtml);
        const emails = extractEmails(jhtml);
        const chosen = emails.length ? emails[0] : null;
        const ai = await enhanceWithOpenAI({
          title: rawTitle,
          description: rawDesc
        });
        const desc = ai.description.length >= MIN_DESCRIPTION_LEN ? ai.description : rawDesc;
        let finalTitle = cleanJobTitleStrict(ai.title || rawTitle);
        if (isVagueTitle(finalTitle)) {
          const extracted = extractRoleFromText(desc) || extractRoleFromText(rawDesc);
          finalTitle = extracted || finalTitle;
        }
        if (isVagueTitle(finalTitle)) {
          finalTitle = cleanJobTitleStrict(rawTitle) || "General Engineering Role";
        }
        const aiCategory = normalizeCategory(ai.category);
        const category = aiCategory || chooseCategory(finalTitle, desc);
        await db.ref(`jobs/${jobId}`).set({
          title: finalTitle,
          description: desc,
          category,
          location: "Saudi Arabia",
          email: chosen,
          emails,
          url: jobUrl,
          createdAt: nowIso
        });
      }
    }
  }
);

async function getFileAsBuffer(gsPath) {
  const bucket = storage.bucket();
  const [buf] = await bucket.file(gsPath).download();
  return buf;
}

async function sendEmployerEmail({ job, userProfile }) {
  if (!job.email) return false;
  const transporter = mailer();

  const photoUrl = userProfile.photoUrl || "";
  const hasPhoto = Boolean(photoUrl || userProfile.photoPath);
  const cvLink = userProfile.cvUrl || "";
  const jobLink = job.url || "";
  const displayJobTitle = preserveAcronyms(job.title || "");
  const contentHtml = `
    <div style="display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap;">
      <div style="width:96px;height:96px;border-radius:20px;overflow:hidden;background:#f2f4f8;border:1px solid #e5e9f2;display:flex;align-items:center;justify-content:center;">
        ${
          hasPhoto
            ? `<img src="${photoUrl || "cid:profile-photo"}" alt="Profile" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div style="font-size:34px;font-weight:900;color:#4b5565;">${(userProfile.name || "C").slice(0, 1).toUpperCase()}</div>`
        }
      </div>
      <div style="text-align:center;">
        <div style="font-size:26px;font-weight:900;color:#1f2333;letter-spacing:.2px;">${userProfile.name || "Candidate"}</div>
        <div style="font-size:15px;color:#5d667b;margin-top:4px;font-weight:700;">${userProfile.title || "Role Title"}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <span style="padding:6px 10px;border-radius:999px;background:#eef2ff;border:1px solid #d7def3;color:#55607a;font-size:12px;">Applied for</span>
          <span style="padding:6px 10px;border-radius:999px;background:#ffd9a0;color:#3a2600;font-size:12px;font-weight:800;">${displayJobTitle || "Job"}</span>
          ${job.location ? `<span style="padding:6px 10px;border-radius:999px;background:#b8c9ff;color:#18203a;font-size:12px;font-weight:800;">${job.location}</span>` : ""}
        </div>
      </div>
    </div>
    <div style="margin-top:18px;padding:18px;border-radius:16px;background:#f9fafc;border:1px solid #e9edf5;text-align:center;">
      <div style="font-size:12px;color:#8b95ad;text-transform:uppercase;letter-spacing:.4px;">Professional Summary</div>
      <div style="margin-top:8px;color:#1f2333;line-height:1.7;font-size:15px;">${userProfile.bio || "No summary provided."}</div>
    </div>
    <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
      ${
        cvLink
          ? `<a href="${cvLink}" style="display:inline-block;padding:14px 18px;border-radius:999px;background:linear-gradient(135deg,#ffcc7a,#ff9ab3);color:#3a2600;text-decoration:none;font-weight:900;letter-spacing:.2px;">View CV (PDF)</a>`
          : `<span style="display:inline-block;padding:14px 18px;border-radius:999px;background:#eef1f6;color:#7a8498;">CV not provided</span>`
      }
    </div>
    <div style="margin-top:14px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap;color:#7e89a3;font-size:12px;">
      <div>Availability: Immediate</div>
      <div>Attachments: CV ${userProfile.cvPath ? "✓" : "—"} · Photo ${userProfile.photoPath ? "✓" : "—"}</div>
    </div>
  `;

  const attachments = [];
  if (userProfile.photoPath) {
    const buf = await getFileAsBuffer(userProfile.photoPath);
    attachments.push({
      filename: "profile.jpg",
      content: buf,
      cid: "profile-photo",
      contentType: "image/jpeg",
      contentDisposition: "inline"
    });
  }
  if (userProfile.cvPath) {
    const buf = await getFileAsBuffer(userProfile.cvPath);
    attachments.push({ filename: "cv.pdf", content: buf });
  }

  const footer = `Powered by So Jobless Inc. · <a href="https://www.sojobless.live" style="color:#8b95ad;text-decoration:none;">www.sojobless.live</a> · <a href="https://instagram.com/sojobless.bh" style="color:#8b95ad;text-decoration:none;">instagram.com/sojobless.bh</a>`;
  const html = employerEmailTemplate({
    contentHtml,
    footer,
    headerTitle: displayJobTitle ? `${displayJobTitle} Vacancy` : "Job Vacancy"
  });

  await transporter.sendMail({
    from: MAIL_FROM.value() || userProfile.email,
    to: job.email,
    subject: `${userProfile.name || "Candidate"}: Application for ${displayJobTitle ? `${displayJobTitle} Vacancy` : "Job Vacancy"}`,
    html,
    attachments
  });
  return true;
}

function summarizeJobsByCategory(jobs) {
  const counts = {};
  for (const j of jobs) {
    const c = j.category || "Unknown";
    counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

function formatCategoryList(byCat) {
  return Object.entries(byCat)
    .map(
      ([cat, count]) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border:1px solid #eadfd4;border-radius:12px;margin:6px 0;background:#fff;">` +
        `<span style="font-weight:600;color:#1f1a17;">${cat}</span>` +
        `<span style="color:#f05a28;font-weight:700;">${count}</span>` +
        `</div>`
    )
    .join("");
}

async function sendUserSummaryEmail({ userProfile, jobs, lifetimeTotal = 0 }) {
  if (!userProfile.email) return;
  const transporter = mailer();
  const total = jobs.length;
  const byCat = summarizeJobsByCategory(jobs);
  const listHtml = formatCategoryList(byCat);
  const photoUrl = userProfile.photoUrl || "";

  const contentHtml = `
    <div style="display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap;">
      <div style="width:96px;height:96px;border-radius:20px;overflow:hidden;background:#f2f4f8;border:1px solid #e5e9f2;display:flex;align-items:center;justify-content:center;">
        ${
          photoUrl
            ? `<img src="${photoUrl}" alt="Profile" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div style="font-size:34px;font-weight:900;color:#4b5565;">${(userProfile.name || "U").slice(0, 1).toUpperCase()}</div>`
        }
      </div>
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#1f2333;letter-spacing:.2px;">${userProfile.name || "Your Profile"}</div>
        <div style="font-size:14px;color:#5d667b;margin-top:4px;font-weight:700;">${userProfile.title || "Job Seeker"}</div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <span style="padding:8px 12px;border-radius:999px;background:#eef2ff;border:1px solid #d7def3;color:#55607a;font-size:13px;font-weight:700;letter-spacing:.2px;">Daily total</span>
          <span style="padding:10px 16px;border-radius:999px;background:#ffd9a0;color:#3a2600;font-size:16px;font-weight:900;letter-spacing:.2px;">${total} applications</span>
          <span style="padding:10px 16px;border-radius:999px;background:#b8c9ff;color:#18203a;font-size:16px;font-weight:900;letter-spacing:.2px;">Lifetime ${lifetimeTotal}</span>
        </div>
      </div>
    </div>
    <div style="margin-top:18px;padding:18px;border-radius:16px;background:#f9fafc;border:1px solid #e9edf5;text-align:center;">
      <div style="font-size:12px;color:#8b95ad;text-transform:uppercase;letter-spacing:.4px;">Applied by Category</div>
      <div style="margin-top:8px;display:inline-block;text-align:left;width:100%;">${listHtml}</div>
    </div>
    <div style="margin-top:14px;color:#7e89a3;font-size:12px;">We keep applying daily to new matches in your top 2 categories.</div>
  `;

  const html = dailyEmailTemplate({
    heading: "Daily Auto Apply Summary",
    subheading: "Your MegaApply™ Report",
    contentHtml,
    footer: FOOTER
  });

  await transporter.sendMail({
    from: MAIL_FROM.value() || "no-reply@megaapply.com",
    to: userProfile.email,
    subject: `MegaApply™ Daily Summary - ${total} applications`,
    html
  });
}

async function sendUserFirstEmail({ userProfile, jobs }) {
  if (!userProfile.email) return;
  const transporter = mailer();
  const total = jobs.length;
  const byCat = summarizeJobsByCategory(jobs);
  const listHtml = formatCategoryList(byCat);
  const photoUrl = userProfile.photoUrl || "";

  const contentHtml = `
    <div style="display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap;">
      <div style="width:96px;height:96px;border-radius:20px;overflow:hidden;background:#f2f4f8;border:1px solid #e5e9f2;display:flex;align-items:center;justify-content:center;">
        ${
          photoUrl
            ? `<img src="${photoUrl}" alt="Profile" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div style="font-size:34px;font-weight:900;color:#4b5565;">${(userProfile.name || "U").slice(0, 1).toUpperCase()}</div>`
        }
      </div>
      <div style="text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#1f2333;letter-spacing:.2px;">${userProfile.name || "Your Profile"}</div>
        <div style="font-size:14px;color:#5d667b;margin-top:4px;font-weight:700;">${userProfile.title || "Job Seeker"}</div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <span style="padding:8px 12px;border-radius:999px;background:#eef2ff;border:1px solid #d7def3;color:#55607a;font-size:13px;font-weight:700;letter-spacing:.2px;">First run</span>
          <span style="padding:10px 16px;border-radius:999px;background:#ffd9a0;color:#3a2600;font-size:16px;font-weight:900;letter-spacing:.2px;">${total} applications</span>
          <span style="padding:10px 16px;border-radius:999px;background:#b8c9ff;color:#18203a;font-size:16px;font-weight:900;letter-spacing:.2px;">${Object.keys(byCat).length} categories</span>
        </div>
      </div>
    </div>
    <div style="margin-top:18px;padding:18px;border-radius:16px;background:#f9fafc;border:1px solid #e9edf5;text-align:center;">
      <div style="font-size:12px;color:#8b95ad;text-transform:uppercase;letter-spacing:.4px;">Applied by Category</div>
      <div style="margin-top:8px;display:inline-block;text-align:left;width:100%;">${listHtml}</div>
    </div>
    <div style="margin-top:14px;color:#7e89a3;font-size:12px;">
      Welcome to MegaApply™. We emailed employers your profile and CV and will keep applying daily.
    </div>
  `;

  const html = dailyEmailTemplate({
    heading: "Your First Auto-Apply Run Is Complete",
    subheading: "Welcome to MegaApply™",
    contentHtml,
    footer: FOOTER
  });

  await transporter.sendMail({
    from: MAIL_FROM.value() || "no-reply@megaapply.com",
    to: userProfile.email,
    subject: `Welcome to MegaApply™ — ${total} applications sent`,
    html
  });
}

async function loadJobsSince(ts) {
  const snap = await db.ref("jobs").orderByChild("createdAt").startAt(new Date(ts).toISOString()).once("value");
  const jobs = [];
  snap.forEach((child) => {
    jobs.push({ id: child.key, ...child.val() });
  });
  return jobs;
}

async function loadUsers() {
  const snap = await db.ref("users").once("value");
  const users = [];
  snap.forEach((child) => users.push({ id: child.key, ...child.val() }));
  return users;
}

async function markApplied(userId, jobId) {
  await db.ref(`applications/${userId}/${jobId}`).set({ appliedAt: Date.now() });
}

async function alreadyApplied(userId, jobId) {
  const snap = await db.ref(`applications/${userId}/${jobId}`).once("value");
  return snap.exists();
}

async function getApplicationsCount(userId) {
  const snap = await db.ref(`applications/${userId}`).once("value");
  if (!snap.exists()) return 0;
  return snap.numChildren();
}

async function runAutoApplyForUser(user) {
  if (!user.autoApplyEnabled || !user.categories || !user.categories.length) return [];
  const last = user.lastAutoApply || 0;
  const jobs = await loadJobsSince(last);
  const filtered = jobs.filter((j) => user.categories.includes(j.category));
  const appliedJobs = [];

  for (const job of filtered) {
    if (!job.email) continue;
    const applied = await alreadyApplied(user.id, job.id);
    if (applied) continue;

    const profile = {
      ...user,
      photoPath: user.photoPath,
      cvPath: user.cvPath
    };
    await sendEmployerEmail({ job, userProfile: profile });
    await markApplied(user.id, job.id);
    appliedJobs.push(job);
  }

  await db.ref(`users/${user.id}/lastAutoApply`).set(Date.now());
  if (appliedJobs.length) {
    const lifetimeTotal = await getApplicationsCount(user.id);
    if (last === 0) {
      await sendUserFirstEmail({ userProfile: user, jobs: appliedJobs });
    }
    await sendUserSummaryEmail({ userProfile: user, jobs: appliedJobs, lifetimeTotal });
  }
  return appliedJobs;
}

export const runAutoApplyNow = onRequest(
  { secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM] },
  async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    res.status(400).send("Missing userId");
    return;
  }
  const userSnap = await db.ref(`users/${userId}`).once("value");
  if (!userSnap.exists()) {
    res.status(404).send("User not found");
    return;
  }
  const user = { id: userId, ...userSnap.val() };
  const applied = await runAutoApplyForUser(user);
  res.json({ applied: applied.length });
});

export const dailyAutoApply = onSchedule(
  { schedule: "every day 08:00", secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM] },
  async () => {
    const users = await loadUsers();
    for (const user of users) {
      await runAutoApplyForUser(user);
    }
  }
);

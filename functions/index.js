import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import nodemailer from "nodemailer";
import crypto from "node:crypto";

admin.initializeApp({
  databaseURL: "https://mega-apply-default-rtdb.firebaseio.com",
  storageBucket: "mega-apply.firebasestorage.app"
});

const db = admin.database();
const storage = admin.storage();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");
const ADMIN_TOKEN = defineSecret("ADMIN_TOKEN");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const FUNCTIONS_VERSION = "2026-01-31-1";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const MATCH_STRICT_THRESHOLD = parseFloat(process.env.MATCH_STRICT_THRESHOLD || "0.65");
const MATCH_THRESHOLD = parseFloat(process.env.MATCH_THRESHOLD || "0.58");
const MATCH_KEYWORD_MIN = parseFloat(process.env.MATCH_KEYWORD_MIN || "0.12");
const MATCH_KEYWORD_FALLBACK = parseFloat(process.env.MATCH_KEYWORD_FALLBACK || "0.10");
const MAX_APPLY_PER_RUN = parseInt(process.env.MAX_APPLY_PER_RUN || "40", 10);
const MAX_RUN_MS = parseInt(process.env.MAX_RUN_MS || "45000", 10);
const MAX_MATCH_STATS_MS = parseInt(process.env.MAX_MATCH_STATS_MS || "45000", 10);
const SAUDI_PAGES = parseInt(process.env.SAUDI_PAGES || "1", 10);
const MIN_DESCRIPTION_LEN = parseInt(process.env.MIN_DESCRIPTION_LEN || "120", 10);

const ALLOWED_ORIGINS = new Set([
  "https://mega-apply.web.app",
  "https://mega-apply.firebaseapp.com",
  "http://localhost:3000"
]);

function applyCors(req, res) {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

function toPublicJob(id, job) {
  if (!job) return null;
  return {
    id,
    title: job.title || "",
    description: job.description || "",
    category: job.category || "Uncategorized",
    location: job.location || "",
    createdAt: job.createdAt || "",
    url: job.url || ""
  };
}

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

const MATCH_KEYWORDS = [
  "civil",
  "mechanical",
  "electrical",
  "hse",
  "qa/qc",
  "qaqc",
  "quality assurance",
  "quality control",
  "inspection",
  "inspector",
  "project management",
  "project controls",
  "planning",
  "estimation",
  "procurement",
  "logistics",
  "quantity surveyor",
  "qs",
  "quantity surveying",
  "boq",
  "bill of quantities",
  "cost estimation",
  "cost control",
  "tender",
  "tendering",
  "take-off",
  "quantity take-off",
  "measurement",
  "valuation",
  "variation",
  "claims",
  "contract",
  "fidic",
  "site quantity",
  "autocad",
  "revit",
  "etabs",
  "staad",
  "sap2000",
  "primavera",
  "p6",
  "ms project",
  "navisworks",
  "bim",
  "hvac",
  "piping",
  "pipeline",
  "welding",
  "ndt",
  "iso 9001",
  "safety",
  "substation",
  "switchgear",
  "transformer",
  "commissioning",
  "site engineer",
  "design engineer",
  "maintenance"
];

const QS_ROLE_PHRASES = [
  "quantity surveyor",
  "quantity surveying",
  "qs",
  "cost control",
  "cost estimation",
  "estimation",
  "boq",
  "bill of quantities",
  "tender",
  "tendering",
  "take-off",
  "quantity take-off",
  "measurement",
  "valuation",
  "claims",
  "contract",
  "fidic"
];

const QS_USER_HINTS = [
  "quantity surveyor",
  "quantity surveying",
  "qs",
  "estimation",
  "cost control",
  "cost estimation",
  "boq"
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

function normalizeEmbeddingInput(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

async function getEmbedding(text) {
  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing for embeddings");
  const input = normalizeEmbeddingInput(text);
  if (!input) return null;
  const payload = {
    model: EMBEDDING_MODEL,
    input
  };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI Embeddings HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding || null;
  return Array.isArray(embedding) ? embedding : null;
}

async function getEmbeddingsBatch(texts = []) {
  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing for embeddings");
  const inputs = texts.map((t) => normalizeEmbeddingInput(t)).filter(Boolean);
  if (!inputs.length) return [];
  const payload = {
    model: EMBEDDING_MODEL,
    input: inputs
  };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI Embeddings HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.map((d) => d.embedding) : [];
}

function requireAdminToken(req) {
  const token = req.get("x-admin-token") || req.query.token || "";
  const expected = ADMIN_TOKEN.value();
  if (!expected) return { ok: false, status: 400, message: "ADMIN_TOKEN not configured" };
  if (token !== expected) return { ok: false, status: 403, message: "Invalid admin token" };
  return { ok: true };
}

async function backfillJobEmbeddingsBatch({ startAfter = null, limit = 250 }) {
  let query = db.ref("jobs").orderByKey().limitToFirst(limit);
  if (startAfter) query = db.ref("jobs").orderByKey().startAfter(startAfter).limitToFirst(limit);
  const snap = await query.once("value");
  if (!snap.exists()) {
    return { processed: 0, updated: 0, skipped: 0, lastKey: null };
  }
  const jobs = [];
  snap.forEach((child) => jobs.push({ id: child.key, ...child.val() }));
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const toEmbed = [];

  for (const job of jobs) {
    processed += 1;
    const text = buildJobText(job);
    if (!text) {
      skipped += 1;
      continue;
    }
    const textHash = hashText(text);
    const hasEmbedding =
      Array.isArray(job.embedding) &&
      job.embedding.length > 0 &&
      job.embeddingHash === textHash &&
      job.embeddingModel === EMBEDDING_MODEL;
    if (hasEmbedding) {
      skipped += 1;
      continue;
    }
    toEmbed.push({ id: job.id, text, hash: textHash });
  }

  const batchSize = 50;
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const chunk = toEmbed.slice(i, i + batchSize);
    const embeddings = await getEmbeddingsBatch(chunk.map((c) => c.text));
    const updates = {};
    chunk.forEach((item, idx) => {
      const embedding = embeddings[idx];
      if (!Array.isArray(embedding)) return;
      updates[`jobs/${item.id}/embedding`] = embedding;
      updates[`jobs/${item.id}/embeddingHash`] = item.hash;
      updates[`jobs/${item.id}/embeddingModel`] = EMBEDDING_MODEL;
      updated += 1;
    });
    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }
  }

  const lastKey = jobs.length ? jobs[jobs.length - 1].id : null;
  return { processed, updated, skipped, lastKey };
}

function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function extractKeywordHits(text) {
  const hay = String(text || "").toLowerCase();
  const hits = new Set();
  for (const kw of MATCH_KEYWORDS) {
    if (hay.includes(kw)) hits.add(kw);
  }
  return hits;
}

function normalizeForMatch(text) {
  return String(text || "").toLowerCase();
}

function hasAnyPhrase(hay, phrases) {
  if (!hay) return false;
  return phrases.some((p) => hay.includes(p));
}

function hasTitleTokenMatch(userTitle, jobText) {
  if (!userTitle || !jobText) return false;
  const tokens = String(userTitle)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 4);
  if (!tokens.length) return false;
  return tokens.some((t) => jobText.includes(t));
}

function buildUserText(user) {
  return normalizeEmbeddingInput([user?.title, user?.bio].filter(Boolean).join("\n"));
}

function buildJobText(job) {
  return normalizeEmbeddingInput([job?.title, job?.description].filter(Boolean).join("\n"));
}

async function ensureUserEmbedding(user) {
  const text = buildUserText(user);
  if (!text) return { embedding: null, keywords: new Set(), text };
  const textHash = hashText(text);
  if (
    Array.isArray(user?.profileEmbedding) &&
    user.profileEmbedding.length > 0 &&
    user.profileEmbeddingHash === textHash &&
    user.profileEmbeddingModel === EMBEDDING_MODEL
  ) {
    return { embedding: user.profileEmbedding, keywords: extractKeywordHits(text), text };
  }
  const embedding = await getEmbedding(text);
  if (embedding) {
    await db.ref(`users/${user.id}`).update({
      profileEmbedding: embedding,
      profileEmbeddingHash: textHash,
      profileEmbeddingModel: EMBEDDING_MODEL
    });
  }
  return { embedding, keywords: extractKeywordHits(text), text };
}

async function ensureJobEmbedding(job, jobId) {
  const text = buildJobText(job);
  if (!text) return null;
  const textHash = hashText(text);
  if (
    Array.isArray(job?.embedding) &&
    job.embedding.length > 0 &&
    job.embeddingHash === textHash &&
    job.embeddingModel === EMBEDDING_MODEL
  ) {
    return job.embedding;
  }
  const embedding = await getEmbedding(text);
  if (embedding) {
    await db.ref(`jobs/${jobId}`).update({
      embedding,
      embeddingHash: textHash,
      embeddingModel: EMBEDDING_MODEL
    });
  }
  return embedding;
}

function scoreJobMatch({ userEmbedding, jobEmbedding, userKeywords, jobKeywords, userTitle, jobTitle, jobText }) {
  const userCount = userKeywords.size;
  const overlap = [...userKeywords].filter((k) => jobKeywords.has(k));
  const keywordScore = userCount ? overlap.length / Math.max(3, userCount) : 0;
  const textHay = normalizeForMatch(jobText);
  const userTitleLower = normalizeForMatch(userTitle);
  const userIsQS = userTitleLower.includes("quantity surveyor") || hasAnyPhrase(userTitleLower, QS_USER_HINTS);
  const rolePhraseHit = userIsQS && hasAnyPhrase(textHay, QS_ROLE_PHRASES);
  const titleTokenHit = hasTitleTokenMatch(userTitle, textHay);
  const titleHit =
    userTitle &&
    jobTitle &&
    String(jobTitle).toLowerCase().includes(String(userTitle).toLowerCase());

  if (Array.isArray(userEmbedding) && Array.isArray(jobEmbedding) && userEmbedding.length && jobEmbedding.length) {
    const similarity = cosineSimilarity(userEmbedding, jobEmbedding);
    const strictPass = similarity >= MATCH_STRICT_THRESHOLD;
    const blendedPass = similarity >= MATCH_THRESHOLD && (userCount ? keywordScore >= MATCH_KEYWORD_MIN : true);
    const keywordFallback = userCount ? keywordScore >= MATCH_KEYWORD_FALLBACK : false;
    return {
      match: strictPass || blendedPass || keywordFallback || titleHit || titleTokenHit || rolePhraseHit,
      similarity,
      keywordScore,
      keywords: overlap.slice(0, 6)
    };
  }

  const fallbackPass = titleHit || titleTokenHit || rolePhraseHit || (userCount ? keywordScore >= MATCH_KEYWORD_FALLBACK : false);
  return {
    match: fallbackPass,
    similarity: 0,
    keywordScore,
    keywords: overlap.slice(0, 6)
  };
}

async function computeMatchStatsForUser(user, opts = {}) {
  let totalJobs = 0;
  let totalWithEmail = 0;
  const userCtx = await ensureUserEmbedding(user);
  if (!userCtx.embedding) {
    return {
      totalJobs,
      totalWithEmail,
      matchingJobs: 0
    };
  }

  const startTime = Date.now();
  let matchingJobs = 0;
  let startAfter = null;
  while (true) {
    if (Date.now() - startTime > MAX_MATCH_STATS_MS - 1000) {
      break;
    }
    const { jobs, lastKey } = await loadJobsPage({ startAfter, limit: 200 });
    if (!jobs.length) break;
    totalJobs += jobs.length;
    totalWithEmail += jobs.filter((j) => j.email).length;

    const missing = [];
    const prepared = jobs.map((job) => {
      const text = buildJobText(job);
      const textHash = text ? hashText(text) : null;
      const hasEmbedding =
        Array.isArray(job.embedding) &&
        job.embedding.length > 0 &&
        job.embeddingHash === textHash &&
        job.embeddingModel === EMBEDDING_MODEL;
      if (opts.backfillEmbeddings && !hasEmbedding && text) {
        missing.push({ id: job.id, text, hash: textHash });
      }
      return { ...job, _text: text, _hash: textHash, _hasEmbedding: hasEmbedding };
    });
    const preparedById = new Map(prepared.map((job) => [job.id, job]));

    if (opts.backfillEmbeddings && missing.length) {
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        const embeddings = await getEmbeddingsBatch(chunk.map((c) => c.text));
        const updates = {};
        chunk.forEach((item, idx) => {
          const embedding = embeddings[idx];
          if (!Array.isArray(embedding)) return;
          updates[`jobs/${item.id}/embedding`] = embedding;
          updates[`jobs/${item.id}/embeddingHash`] = item.hash;
          updates[`jobs/${item.id}/embeddingModel`] = EMBEDDING_MODEL;
          const target = preparedById.get(item.id);
          if (target) {
            target.embedding = embedding;
            target._hasEmbedding = true;
          }
        });
        if (Object.keys(updates).length) {
          await db.ref().update(updates);
        }
      }
    }

    for (const job of prepared) {
      if (!job.email) continue;
      const jobKeywords = extractKeywordHits(job._text || "");
      const score = scoreJobMatch({
        userEmbedding: userCtx.embedding,
        jobEmbedding: job._hasEmbedding ? job.embedding : null,
        userKeywords: userCtx.keywords,
        jobKeywords,
        userTitle: user.title,
        jobTitle: job.title,
        jobText: job._text || ""
      });
      if (score.match) matchingJobs += 1;
    }

    startAfter = lastKey;
    if (!lastKey) break;
  }
  return {
    totalJobs,
    totalWithEmail,
    matchingJobs
  };
}

function extractEmailAddress(raw) {
  if (!raw) return "";
  const str = String(raw).trim();
  const match = str.match(/<([^>]+)>/);
  if (match && match[1]) return match[1].trim();
  if (str.includes("@")) return str;
  return "";
}

function buildFrom(name, fallbackEmail) {
  const email = extractEmailAddress(MAIL_FROM.value()) || fallbackEmail || "no-reply@megaapply.com";
  return `${name} <${email}>`;
}

function centeredEmailTemplate({ heading, subheading, contentHtml, footer }) {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f2ee;margin:0;padding:0;font-family:Arial,sans-serif;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#fff8f1;border-radius:20px;border:1px solid #eadfd4;">
          <tr>
            <td align="center" style="padding:28px 24px 18px;">
              <div style="font-size:28px;font-weight:800;letter-spacing:.3px;color:#1f1a17;margin-bottom:6px;">${BRAND}</div>
              <div style="color:#f05a28;font-weight:700;font-size:16px;margin-bottom:18px;">${subheading || "Auto Apply Summary"}</div>
              <div style="margin:0 0 10px;font-size:22px;font-weight:700;color:#1f1a17;">${heading}</div>
              <div style="font-size:14px;color:#6b5f58;line-height:1.6;margin:12px 0 18px;">${contentHtml}</div>
              <div style="margin-top:18px;padding-top:14px;border-top:1px dashed #eadfd4;color:#9b8b81;font-size:12px;">${footer}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function employerEmailTemplate({ contentHtml, footer, headerTitle }) {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6fb;margin:0;padding:0;font-family:Arial,sans-serif;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:22px;border:1px solid #e5e9f2;overflow:hidden;">
          <tr>
            <td align="center" style="padding:24px 22px;background:linear-gradient(135deg,#ffe3b1 0%,#ffd1dc 45%,#c7d7ff 100%);color:#1f2333;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;opacity:.85;">Candidate Submission</div>
              <div style="margin-top:10px;font-size:28px;font-weight:900;letter-spacing:.3px;">${headerTitle || "Job Application"}</div>
              <div style="margin-top:6px;font-size:14px;font-weight:700;">Ready for immediate review</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 22px 26px;background:#ffffff;color:#1f2333;">
              ${contentHtml}
              <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e9edf5;color:#8b95ad;font-size:12px;text-align:center;">
                ${footer}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function dailyEmailTemplate({ heading, subheading, contentHtml, footer }) {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6fb;margin:0;padding:0;font-family:Arial,sans-serif;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:22px;border:1px solid #e5e9f2;overflow:hidden;">
          <tr>
            <td align="center" style="padding:24px 22px;background:linear-gradient(135deg,#ffe3b1 0%,#ffd1dc 45%,#c7d7ff 100%);color:#1f2333;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#8fb3ff,#7b61ff,#a6c1ff);border:1px solid rgba(0,0,0,0.05);"></td>
                  <td style="padding-left:10px;font-size:16px;font-weight:800;letter-spacing:.2px;color:#1f2333;">MegaApply<span style="font-size:12px;vertical-align:top;">™</span></td>
                </tr>
              </table>
              <div style="margin-top:4px;font-size:28px;font-weight:900;letter-spacing:.3px;">${heading}</div>
              <div style="margin-top:6px;font-size:14px;font-weight:700;">${subheading || "Daily Summary"}</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 22px 26px;background:#ffffff;color:#1f2333;">
              ${contentHtml}
              <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e9edf5;color:#8b95ad;font-size:12px;text-align:center;">
                ${footer}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
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
        let embedding = null;
        let embeddingHash = null;
        try {
          const jobText = buildJobText({ title: finalTitle, description: desc });
          if (jobText) {
            embedding = await getEmbedding(jobText);
            embeddingHash = hashText(jobText);
          }
        } catch {}
        await db.ref(`jobs/${jobId}`).set({
          title: finalTitle,
          description: desc,
          category,
          location: "Saudi Arabia",
          email: chosen,
          emails,
          url: jobUrl,
          createdAt: nowIso,
          embedding,
          embeddingHash,
          embeddingModel: embedding ? EMBEDDING_MODEL : null
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
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <div style="width:96px;height:96px;border-radius:20px;overflow:hidden;background:#f2f4f8;border:1px solid #e5e9f2;display:inline-block;">
            ${
              hasPhoto
                ? `<img src="${photoUrl || "cid:profile-photo"}" alt="Profile" style="width:100%;height:100%;object-fit:cover;display:block;" />`
                : `<div style="width:96px;height:96px;line-height:96px;text-align:center;font-size:34px;font-weight:900;color:#4b5565;">${(userProfile.name || "C").slice(0, 1).toUpperCase()}</div>`
            }
          </div>
          <div style="font-size:24px;font-weight:900;color:#1f2333;letter-spacing:.2px;margin-top:12px;">${userProfile.name || "Candidate"}</div>
          <div style="font-size:14px;color:#5d667b;margin-top:4px;font-weight:700;">${userProfile.title || "Role Title"}</div>
          <div style="margin-top:10px;">
            <span style="display:inline-block;margin:4px;padding:6px 10px;border-radius:999px;background:#eef2ff;border:1px solid #d7def3;color:#55607a;font-size:12px;">Applied for</span>
            <span style="display:inline-block;margin:4px;padding:6px 10px;border-radius:999px;background:#ffd9a0;color:#3a2600;font-size:12px;font-weight:800;">${displayJobTitle || "Job"}</span>
            ${job.location ? `<span style="display:inline-block;margin:4px;padding:6px 10px;border-radius:999px;background:#b8c9ff;color:#18203a;font-size:12px;font-weight:800;">${job.location}</span>` : ""}
          </div>
        </td>
      </tr>
    </table>
    <div style="margin-top:18px;padding:18px;border-radius:16px;background:#f9fafc;border:1px solid #e9edf5;text-align:center;">
      <div style="font-size:12px;color:#8b95ad;text-transform:uppercase;letter-spacing:.4px;">Professional Summary</div>
      <div style="margin-top:8px;color:#1f2333;line-height:1.7;font-size:15px;">${userProfile.bio || "No summary provided."}</div>
    </div>
    <div style="margin-top:18px;text-align:center;">
      ${
        cvLink
          ? `<a href="${cvLink}" style="display:inline-block;margin:4px;padding:14px 18px;border-radius:999px;background:linear-gradient(135deg,#ffcc7a,#ff9ab3);color:#3a2600;text-decoration:none;font-weight:900;letter-spacing:.2px;">View CV (PDF)</a>`
          : `<span style="display:inline-block;margin:4px;padding:14px 18px;border-radius:999px;background:#eef1f6;color:#7a8498;">CV not provided</span>`
      }
    </div>
    <div style="margin-top:14px;text-align:center;color:#7e89a3;font-size:12px;">
      Availability: Immediate · Attachments: CV ${userProfile.cvPath ? "✓" : "—"} · Photo ${userProfile.photoPath ? "✓" : "—"}
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
    from: buildFrom("Job Application", userProfile.email),
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
        `<tr>` +
        `<td style="padding:8px 12px;border:1px solid #eadfd4;border-right:0;border-radius:12px 0 0 12px;background:#fff;font-weight:600;color:#1f1a17;">${cat}</td>` +
        `<td align="right" style="padding:8px 12px;border:1px solid #eadfd4;border-left:0;border-radius:0 12px 12px 0;background:#fff;color:#f05a28;font-weight:700;">${count}</td>` +
        `</tr>`
    )
    .join("");
}

async function sendUserSummaryEmail({ userProfile, jobs, lifetimeTotal = 0 }) {
  if (!userProfile.email) return;
  const transporter = mailer();
  const total = jobs.length;
  const photoUrl = userProfile.photoUrl || "";
  const titleSkill = userProfile.title ? userProfile.title : "your role";

  const contentHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <div style="width:96px;height:96px;border-radius:20px;overflow:hidden;background:#f2f4f8;border:1px solid #e5e9f2;display:inline-block;">
            ${
              photoUrl
                ? `<img src="${photoUrl}" alt="Profile" style="width:100%;height:100%;object-fit:cover;display:block;" />`
                : `<div style="width:96px;height:96px;line-height:96px;text-align:center;font-size:34px;font-weight:900;color:#4b5565;">${(userProfile.name || "U").slice(0, 1).toUpperCase()}</div>`
            }
          </div>
          <div style="font-size:22px;font-weight:900;color:#1f2333;letter-spacing:.2px;margin-top:12px;">${userProfile.name || "Your Profile"}</div>
          <div style="font-size:14px;color:#5d667b;margin-top:4px;font-weight:700;">${userProfile.title || "Job Seeker"}</div>
          <div style="margin-top:10px;font-size:14px;color:#2f3640;font-weight:700;line-height:1.5;">We applied to roles where your ${titleSkill} skills are in high demand.</div>
          <div style="margin-top:12px;">
            <span style="display:inline-block;margin:4px;padding:8px 12px;border-radius:999px;background:#eef2ff;border:1px solid #d7def3;color:#55607a;font-size:13px;font-weight:700;letter-spacing:.2px;">Daily total</span>
            <span style="display:inline-block;margin:4px;padding:10px 16px;border-radius:999px;background:#ffd9a0;color:#3a2600;font-size:16px;font-weight:900;letter-spacing:.2px;">${total} applications</span>
            <span style="display:inline-block;margin:4px;padding:10px 16px;border-radius:999px;background:#b8c9ff;color:#18203a;font-size:16px;font-weight:900;letter-spacing:.2px;">Lifetime ${lifetimeTotal}</span>
          </div>
        </td>
      </tr>
    </table>
    <div style="margin-top:14px;color:#7e89a3;font-size:12px;">We keep applying daily to new matches based on your profile—even when the job title doesn't say it explicitly but the description fits your skills.</div>
  `;

  const html = dailyEmailTemplate({
    heading: "Daily Auto Apply Summary",
    subheading: "Your MegaApply™ Report",
    contentHtml,
    footer: FOOTER
  });

  await transporter.sendMail({
    from: buildFrom(BRAND, "no-reply@megaapply.com"),
    to: userProfile.email,
    subject: `MegaApply™ Daily Summary - ${total} applications`,
    html
  });
}


async function loadJobsPage({ startAfter = null, limit = 200 }) {
  let query = db.ref("jobs").orderByKey().limitToFirst(limit);
  if (startAfter) {
    query = db.ref("jobs").orderByKey().startAfter(startAfter).limitToFirst(limit);
  }
  const snap = await query.once("value");
  const jobs = [];
  snap.forEach((child) => jobs.push({ id: child.key, ...child.val() }));
  if (jobs.length > 1 || limit <= 1) {
    const lastKey = jobs.length ? jobs[jobs.length - 1].id : null;
    return { jobs, lastKey, source: "sdk" };
  }
  const fallback = await loadJobsPageViaRest({ startAfter, limit });
  return { ...fallback, source: "rest" };
}

async function getAccessToken() {
  const cred = admin.app().options.credential;
  if (cred && typeof cred.getAccessToken === "function") {
    const token = await cred.getAccessToken();
    return token?.access_token || null;
  }
  return null;
}

async function loadJobsPageViaRest({ startAfter = null, limit = 200 }) {
  const token = await getAccessToken();
  const base = admin.app().options.databaseURL;
  if (!base) return { jobs: [], lastKey: null };
  const params = new URLSearchParams();
  params.set("orderBy", "\"$key\"");
  params.set("limitToFirst", String(limit));
  if (startAfter) params.set("startAt", JSON.stringify(startAfter));
  if (token) params.set("auth", token);
  const url = `${base}/jobs.json?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`REST jobs fetch failed (${resp.status})`);
  }
  const data = await resp.json();
  const keys = data ? Object.keys(data) : [];
  const jobs = keys.map((key) => ({ id: key, ...(data[key] || {}) }));
  let normalized = jobs;
  if (startAfter && normalized.length && normalized[0]?.id === startAfter) {
    normalized = normalized.slice(1);
  }
  const lastKey = normalized.length ? normalized[normalized.length - 1].id : null;
  return { jobs: normalized, lastKey };
}

async function loadUsers() {
  const snap = await db.ref("users").once("value");
  const users = [];
  snap.forEach((child) => users.push({ id: child.key, ...child.val() }));
  return users;
}

async function markApplied(userId, jobId, data = {}) {
  await db.ref(`applications/${userId}/${jobId}`).set({ appliedAt: Date.now(), ...data });
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

async function runAutoApplyForUser(user, opts = {}) {
  if (!user.autoApplyEnabled) return { appliedJobs: [], diagnostics: { disabled: true } };
  const dryRun = Boolean(opts.dryRun);
  const startTime = Date.now();
  const maxApply = Number.isFinite(opts.maxApply) ? opts.maxApply : MAX_APPLY_PER_RUN;
  const maxMs = Number.isFinite(opts.maxMs) ? opts.maxMs : MAX_RUN_MS;
  const last = user.lastAutoApply || 0;
  const appliedJobs = [];
  const diagnostics = {
    scanned: 0,
    matched: 0,
    missingEmail: 0,
    alreadyApplied: 0,
    skippedOld: 0,
    missingProfile: 0,
    sent: 0,
    jobsWithEmbedding: 0,
    jobsWithoutEmbedding: 0,
    keywordOverlap: 0,
    userKeywords: []
  };
  const userCtx = await ensureUserEmbedding(user);
  const shouldUpdateStats =
    opts.updateMatchStats === true;

  if (!userCtx.embedding) {
    if (shouldUpdateStats) {
      const stats = await computeMatchStatsForUser(user, { backfillEmbeddings: false });
      await db.ref(`users/${user.id}/matchStats`).set({
        ...stats,
        updatedAt: Date.now(),
        threshold: MATCH_THRESHOLD
      });
    }
    return { appliedJobs: [], diagnostics };
  }

  const cutoff = opts.ignoreCutoff ? "" : (last ? new Date(last).toISOString() : "");
  diagnostics.userKeywords = Array.from(userCtx.keywords || []).slice(0, 10);
  let startAfter = null;
  while (true) {
    const { jobs, lastKey } = await loadJobsPage({ startAfter, limit: 200 });
    if (!jobs.length) break;
    for (const job of jobs) {
      if (maxApply && appliedJobs.length >= maxApply) break;
      if (Date.now() - startTime > maxMs - 1000) break;
      diagnostics.scanned += 1;
      if (cutoff && job.createdAt && job.createdAt < cutoff) {
        diagnostics.skippedOld += 1;
        continue;
      }
      if (!job.email) {
        diagnostics.missingEmail += 1;
        continue;
      }
      const applied = await alreadyApplied(user.id, job.id);
      if (applied) {
        diagnostics.alreadyApplied += 1;
        continue;
      }

      const text = buildJobText(job);
      const textHash = text ? hashText(text) : null;
      const hasEmbedding =
        Array.isArray(job?.embedding) &&
        job.embedding.length > 0 &&
        job.embeddingHash === textHash &&
        job.embeddingModel === EMBEDDING_MODEL;
      const jobEmbedding = dryRun ? (hasEmbedding ? job.embedding : null) : await ensureJobEmbedding(job, job.id);
      if (jobEmbedding) {
        diagnostics.jobsWithEmbedding += 1;
      } else {
        diagnostics.jobsWithoutEmbedding += 1;
      }
      const jobKeywords = extractKeywordHits(text);
      if (jobKeywords.size && [...jobKeywords].some((kw) => userCtx.keywords.has(kw))) {
        diagnostics.keywordOverlap += 1;
      }
      const score = scoreJobMatch({
        userEmbedding: userCtx.embedding,
        jobEmbedding,
        userKeywords: userCtx.keywords,
        jobKeywords,
        userTitle: user.title,
        jobTitle: job.title,
        jobText: text
      });
      if (!score.match) continue;
      diagnostics.matched += 1;

      const profile = {
        ...user,
        photoPath: user.photoPath,
        cvPath: user.cvPath
      };
      if (!profile.email || (!profile.cvPath && !profile.cvUrl)) {
        diagnostics.missingProfile += 1;
        continue;
      }
      if (!dryRun) {
        await sendEmployerEmail({ job, userProfile: profile });
        await markApplied(user.id, job.id, {
          matchScore: Number(score.similarity.toFixed(4)),
          keywordScore: Number(score.keywordScore.toFixed(4)),
          matchKeywords: score.keywords
        });
        diagnostics.sent += 1;
      }
      appliedJobs.push(job);
    }
    if (maxApply && appliedJobs.length >= maxApply) break;
    if (Date.now() - startTime > maxMs - 1000) break;
    startAfter = lastKey;
    if (!lastKey) break;
  }

  await db.ref(`users/${user.id}/lastAutoApply`).set(Date.now());
  if (shouldUpdateStats) {
    const stats = await computeMatchStatsForUser(user);
    await db.ref(`users/${user.id}/matchStats`).set({
      ...stats,
      updatedAt: Date.now(),
      threshold: MATCH_THRESHOLD
    });
  }
  if (!dryRun && appliedJobs.length) {
    const lifetimeTotal = await getApplicationsCount(user.id);
    await sendUserSummaryEmail({ userProfile: user, jobs: appliedJobs, lifetimeTotal });
  }
  return { appliedJobs, diagnostics };
}

export const runAutoApplyNow = onRequest(
  { secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, OPENAI_API_KEY] },
  async (req, res) => {
  if (applyCors(req, res)) return;
  const { userId } = req.query;
  const dryRun = String(req.query.dryRun || "") === "1";
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
  const result = await runAutoApplyForUser(user, { updateMatchStats: false, dryRun, ignoreCutoff: true });
  res.json({
    applied: result.appliedJobs.length,
    capped: MAX_APPLY_PER_RUN,
    timedOut: false,
    diagnostics: result.diagnostics
  });
});

export const dailyAutoApply = onSchedule(
  { schedule: "every day 08:00", secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, OPENAI_API_KEY] },
  async () => {
    const users = await loadUsers();
    for (const user of users) {
      await runAutoApplyForUser(user, { updateMatchStats: false });
    }
  }
);

export const computeMatchStatsNow = onRequest(
  { secrets: [OPENAI_API_KEY] },
  async (req, res) => {
    if (applyCors(req, res)) return;

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
    try {
      const stats = await computeMatchStatsForUser(user, { backfillEmbeddings: false });
      await db.ref(`users/${userId}/matchStats`).set({
        ...stats,
        updatedAt: Date.now(),
        threshold: MATCH_THRESHOLD
      });
      res.json({
        ...stats,
        updatedAt: Date.now(),
        dbUrl: admin.app().options.databaseURL || null,
        version: FUNCTIONS_VERSION
      });
    } catch (err) {
      res.status(500).send(err?.message || "Failed to compute match stats");
    }
  }
);

export const diagnoseJobsNow = onRequest(
  async (req, res) => {
    if (applyCors(req, res)) return;

    const page1 = await loadJobsPage({ startAfter: null, limit: 200 });
    const page2 = page1.lastKey
      ? await loadJobsPage({ startAfter: page1.lastKey, limit: 200 })
      : { jobs: [], lastKey: null, source: page1.source };
    const firstKeysSnap = await db.ref("jobs").orderByKey().limitToFirst(5).once("value");
    const lastKeysSnap = await db.ref("jobs").orderByKey().limitToLast(5).once("value");
    const firstKeys = [];
    const lastKeys = [];
    firstKeysSnap.forEach((child) => firstKeys.push(child.key));
    lastKeysSnap.forEach((child) => lastKeys.push(child.key));
    res.json({
      dbUrl: admin.app().options.databaseURL || null,
      version: FUNCTIONS_VERSION,
      page1Source: page1.source || "sdk",
      page2Source: page2.source || "sdk",
      firstKeys,
      lastKeys,
      page1Count: page1.jobs.length,
      page1FirstKey: page1.jobs[0]?.id || null,
      page1LastKey: page1.lastKey,
      page2Count: page2.jobs.length,
      page2FirstKey: page2.jobs[0]?.id || null,
      page2LastKey: page2.lastKey
    });
  }
);

export const listJobs = onRequest(
  {
    timeoutSeconds: 60,
    memory: "512MiB"
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      const category = (req.query.category || "").toString().trim();
      if (!category) return res.json({ jobs: [] });
      const limit = Math.min(parseInt(req.query.limit || "60", 10) || 60, 200);
      try {
        const snap = await db
          .ref("jobs")
          .orderByChild("category")
          .equalTo(category)
          .limitToFirst(limit)
          .get();
        const jobs = [];
        snap.forEach((child) => {
          const job = toPublicJob(child.key, child.val());
          if (job && job.title) jobs.push(job);
        });
        return res.json({ jobs });
      } catch (err) {
        console.error("listJobs indexed query failed, falling back", err);
        const fallbackLimit = Math.min(Math.max(limit * 5, 200), 500);
        const fallbackSnap = await db.ref("jobs").orderByKey().limitToFirst(fallbackLimit).get();
        const jobs = [];
        fallbackSnap.forEach((child) => {
          const job = toPublicJob(child.key, child.val());
          if (!job || !job.title) return;
          if (job.category === category) jobs.push(job);
        });
        return res.json({ jobs: jobs.slice(0, limit), fallback: true, fallbackLimit });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "list_failed" });
    }
  }
);

export const getJobsByIds = onRequest(
  {
    timeoutSeconds: 60
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      const raw = (req.query.ids || "").toString();
      const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);
      if (!ids.length) return res.json({ jobs: {} });
      const jobs = {};
      await Promise.all(
        ids.map(async (id) => {
          const snap = await db.ref("jobs").child(id).get();
          if (!snap.exists()) return;
          const job = toPublicJob(id, snap.val());
          if (job) jobs[id] = job;
        })
      );
      return res.json({ jobs });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "fetch_failed" });
    }
  }
);

export const backfillJobEmbeddings = onRequest(
  { secrets: [OPENAI_API_KEY, ADMIN_TOKEN] },
  async (req, res) => {
    const auth = requireAdminToken(req);
    if (!auth.ok) {
      res.status(auth.status).send(auth.message);
      return;
    }
    const limit = Math.min(parseInt(req.query.limit || "250", 10) || 250, 500);
    const startAfter = req.query.startAfter ? String(req.query.startAfter) : null;
    try {
      const result = await backfillJobEmbeddingsBatch({ startAfter, limit });
      res.json({
        ...result,
        nextStartAfter: result.lastKey,
        done: !result.lastKey || result.processed === 0
      });
    } catch (err) {
      res.status(500).send(err?.message || "Backfill failed");
    }
  }
);

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
  { cat: "HSE", re: /(\bhse\b|\bohs\b|safety\b|nebosh|osha\b|iosh\b|permit\s*to\s*work|ptw)/i },
  { cat: "QAQC", re: /(\bqa\b|\bqc\b|quality\s*(assurance|control)|welding\s*inspection|ndt\b|coating\s*inspection)/i },
  { cat: "Project Management", re: /(project\s*(manager|engineer|coordinator)|\bpm\b(?![a-z])|epc\b|lead\s*engineer|site\s*(manager|engineer))/i },
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
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You clean and improve scraped job data. Fix typos/casing. Do not invent facts. Return strict JSON with keys: title, description."
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
  return {
    title: cleanTitleBasic(parsed.title || title),
    description: String(parsed.description || description || "").trim()
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
        const finalTitle = cleanTitleBasic(ai.title || rawTitle);
        const category = chooseCategory(finalTitle, desc);
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

  const contentHtml = `
    <p><strong>Candidate:</strong> ${userProfile.name || ""}</p>
    <p><strong>Role Title:</strong> ${userProfile.title || ""}</p>
    <p><strong>Bio:</strong> ${userProfile.bio || ""}</p>
    <p><strong>Job:</strong> ${job.title}</p>
    <p><strong>Location:</strong> ${job.location}</p>
    <p><strong>Job Link:</strong> <a href="${job.url}">${job.url}</a></p>
  `;

  const attachments = [];
  if (userProfile.photoPath) {
    const buf = await getFileAsBuffer(userProfile.photoPath);
    attachments.push({ filename: "profile.jpg", content: buf });
  }
  if (userProfile.cvPath) {
    const buf = await getFileAsBuffer(userProfile.cvPath);
    attachments.push({ filename: "cv.pdf", content: buf });
  }

  const html = centeredEmailTemplate({
    heading: "New Application via MegaApply™",
    subheading: "Auto Apply Submission",
    contentHtml,
    footer: FOOTER
  });

  await transporter.sendMail({
    from: MAIL_FROM.value() || userProfile.email,
    to: job.email,
    subject: `Application: ${userProfile.title || "Candidate"} for ${job.title}`,
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

async function sendUserSummaryEmail({ userProfile, jobs }) {
  if (!userProfile.email) return;
  const transporter = mailer();
  const total = jobs.length;
  const byCat = summarizeJobsByCategory(jobs);
  const listHtml = Object.entries(byCat)
    .map(([cat, count]) => `<div style="margin:4px 0;"><strong>${cat}:</strong> ${count}</div>`)
    .join("");

  const contentHtml = `
    <p>Today we auto‑applied to <strong>${total}</strong> jobs for you.</p>
    <div style="display:inline-block;text-align:left;">${listHtml}</div>
  `;

  const html = centeredEmailTemplate({
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
    await sendUserSummaryEmail({ userProfile: user, jobs: appliedJobs });
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

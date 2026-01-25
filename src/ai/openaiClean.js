// src/ai/openaiClean.js
import { cleanTitle, stripTitleNoise } from "./cleaners.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const REQUIRE_OPENAI = (process.env.REQUIRE_OPENAI ?? "1") !== "0";
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
  let s = String(raw || "").trim();
  s = s.replace(/\s+/g, " ");
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
  if (!raw) return null;
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
  return CATEGORIES.includes(s) ? s : null;
}

function normalizeWhitespace(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function basicCleanDescription(s) {
  let out = normalizeWhitespace(s);
  if (!out) return "";
  out = out.replace(/^(job description|description)\s*[:\-]\s*/i, "");
  return out;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

async function callOpenAI(payload) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  return await res.json();
}

export async function enhanceJobRecord(raw) {
  const baseTitle = cleanTitle(raw.title || "");
  const baseDesc = basicCleanDescription(raw.description || "");

  if (!OPENAI_API_KEY) {
    if (REQUIRE_OPENAI) {
      throw new Error("OPENAI_API_KEY is required when REQUIRE_OPENAI=1");
    }
    return {
      title: stripTitleNoise(baseTitle) || "Recent Jobs",
      description: baseDesc || null,
      category: null,
      ai_cleaned: false
    };
  }

  const categoryList = CATEGORIES.join(", ");
  const system = [
    "You clean and improve scraped job data.",
    "Fix typos, casing, spacing, and obvious OCR-like errors.",
    "Do NOT invent facts, requirements, salary, or company names.",
    "Keep meaning intact; prefer concise, professional phrasing.",
    `Assign exactly one category from this list: ${categoryList}.`,
    "Title must be only the job role (no locations, no urgency words, no company names).",
    "Return strict JSON with keys: title, description, category."
  ].join(" ");

  const user = JSON.stringify({
    title: baseTitle,
    description: baseDesc
  });

  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  };

  try {
    const data = await callOpenAI(payload);
    const content = data?.choices?.[0]?.message?.content || "";
    const jsonText = extractJson(content);
    const parsed = safeJsonParse(jsonText || "");

    const cleanDescOut = basicCleanDescription(parsed?.description || baseDesc);
    let cleanTitleOut = stripTitleNoise(cleanTitle(parsed?.title || baseTitle));
    cleanTitleOut = cleanJobTitleStrict(cleanTitleOut);
    if (isVagueTitle(cleanTitleOut)) {
      const extracted = extractRoleFromText(cleanDescOut) || extractRoleFromText(baseDesc);
      cleanTitleOut = extracted || cleanTitleOut;
    }
    if (isVagueTitle(cleanTitleOut)) {
      cleanTitleOut = cleanJobTitleStrict(baseTitle) || "General Engineering Role";
    }
    const rawCategory = typeof parsed?.category === "string" ? parsed.category.trim() : "";
    const category = normalizeCategory(rawCategory);

    return {
      title: cleanTitleOut || "Recent Jobs",
      description: cleanDescOut || null,
      category,
      ai_cleaned: true
    };
  } catch {
    return {
      title: stripTitleNoise(baseTitle) || "Recent Jobs",
      description: baseDesc || null,
      category: null,
      ai_cleaned: false
    };
  }
}

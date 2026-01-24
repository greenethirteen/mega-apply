// src/ai/openaiClean.js
import { cleanTitle, stripTitleNoise } from "./cleaners.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const REQUIRE_OPENAI = (process.env.REQUIRE_OPENAI ?? "1") !== "0";

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
      ai_cleaned: false
    };
  }

  const system = [
    "You clean and improve scraped job data.",
    "Fix typos, casing, spacing, and obvious OCR-like errors.",
    "Do NOT invent facts, requirements, salary, or company names.",
    "Keep meaning intact; prefer concise, professional phrasing.",
    "Return strict JSON with keys: title, description."
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

    const cleanTitleOut = stripTitleNoise(cleanTitle(parsed?.title || baseTitle));
    const cleanDescOut = basicCleanDescription(parsed?.description || baseDesc);

    return {
      title: cleanTitleOut || "Recent Jobs",
      description: cleanDescOut || null,
      ai_cleaned: true
    };
  } catch {
    return {
      title: stripTitleNoise(baseTitle) || "Recent Jobs",
      description: baseDesc || null,
      ai_cleaned: false
    };
  }
}

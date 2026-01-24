// Pure utility cleaners; no external deps
const TITLE_FIXES = [
  [/\s+/g, " "],
  [/–|—/g, "-"],
];

const TITLE_NOISE = [
  [/^\s*job\s*vacanc(?:y|ies)\s*[:\-–]?\s*/i, ""],
  [/^\s*job\s*title\s*[:\-–]\s*/i, ""],
  [/^\s*position\s*[:\-–]\s*/i, ""],
  [/^\s*urgent\s*requirement[s]?\s*(for)?\s*/i, ""],
  [/^\s*urgent\s*hiring\s*[:\-–]?\s*/i, ""],
  [/^\s*required\s*in\s*saudi\b\s*[:\-–]?\s*/i, ""],
  [/\s*-\s*required\s*in\s*saudi\b\s*$/i, ""],
  [/\s*[-–]\s*riyadh\s*$/i, ""],
  [/[\!]+/g, ""],
];

const CATEGORY_MAP = new Map([
  [/civil/i, "Civil Engineering"],
  [/mechanical|mech\b/i, "Mechanical (MEP)"],
  [/electrical|elv/i, "Electrical (Power/ELV)"],
  [/planning/i, "Planning"],
  [/hse|safety/i, "HSE & Safety"],
  [/qa\/?qc|quality/i, "QA/QC"],
  [/project\s*manager|pm\b/i, "Project Management"],
  [/procurement/i, "Procurement"],
]);

export function cleanTitle(raw) {
  if (!raw) return "Recent Jobs";
  let s = String(raw).trim();
  for (const [re, rep] of TITLE_FIXES) s = s.replace(re, rep);
  // Title case-ish without shouting
  s = s
    .toLowerCase()
    .replace(/(^|[\s\-_/])(\w)/g, (_, a, b) => a + b.toUpperCase());
  return s;
}

export function stripTitleNoise(raw) {
  let s = String(raw || "").trim();
  for (const [re, rep] of TITLE_NOISE) s = s.replace(re, rep);
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

export function ensureTitle(s) {
  s = cleanTitle(s);
  if (!s || s.length < 3) return "Recent Jobs";
  return s;
}

export function cleanCategory(raw) {
  const s = String(raw || "").trim();
  for (const [re, label] of CATEGORY_MAP) {
    if (re.test(s)) return label;
  }
  // Heuristic category by keywords in title if present
  if (/engineer/i.test(s)) return "Other";
  return "Other";
}

export function cleanLocation(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Saudi Arabia";
  // Collapse whitespace and strip noise words
  return s.replace(/\s+/g, " ");
}

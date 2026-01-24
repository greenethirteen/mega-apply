// src/email/extract.js
// Robust email extraction & cleanup for odd tokens like '...Only', '...Please', 'Email-foo@bar'
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmails(raw) {
  if (!raw) return [];
  const found = (raw.match(EMAIL_RE) || []).map(cleanEmailToken);
  // unique preserve order
  const seen = new Set();
  const out = [];
  for (const e of found) {
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

function cleanEmailToken(token) {
  // strip leading 'Email-' or 'E-mail:' variants
  token = token.replace(/^(Email[-:\s]*)/i, "");

  // drop trailing junk words that sometimes get appended
  token = token.replace(/(Only|Please|Your|Documents|Doc|CV|Whatsapp|WhatsApp)$/i, "");

  // strip trailing punctuation
  token = token.replace(/[\)\],;:.]+$/g, "");

  return token.trim();
}

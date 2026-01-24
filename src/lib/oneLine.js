// src/lib/oneLine.js
// Tiny helper to collapse any HTML/text block into a single, tidy sentence.
// - Strips emails/URLs
// - Collapses whitespace
// - Trims to a sane length (default 180 chars)
export function oneLineSummary(raw, maxLen = 180) {
  try {
    if (!raw) return null;
    let text = String(raw)
      // replace newlines/tabs with spaces
      .replace(/[\r\n\t]+/g, ' ')
      // drop HTML tags if any
      .replace(/<[^>]+>/g, ' ')
      // remove emails/URLs so they don't pollute the summary
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
      .replace(/\bhttps?:\/\/\S+/gi, ' ')
      // collapse leftover punctuation spam
      .replace(/[•·\u2022]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // prefer the first sentence-ish fragment
    const stop = /([.!?])\s/;
    const m = text.match(stop);
    if (m && m.index !== undefined && m.index > 40) {
      text = text.slice(0, m.index + 1);
    }

    if (text.length > maxLen) {
      text = text.slice(0, maxLen - 1).trim();
      // cut at the last space for tidiness
      const lastSpace = text.lastIndexOf(' ');
      if (lastSpace > 60) text = text.slice(0, lastSpace);
      text += '…';
    }
    return text || null;
  } catch {
    return null;
  }
}
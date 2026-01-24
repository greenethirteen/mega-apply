import { extractEmailsFromHtml } from "../email/extract.js";

export function firstEmailFromHtml(html) {
  const arr = extractEmailsFromHtml(html);
  return arr[0] || null;
}

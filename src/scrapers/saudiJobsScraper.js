// src/scrapers/saudiJobsScraper.js
import * as cheerio from "cheerio";
import { fetchHTML, dumpFile, ensureDir } from "../utils.js";
import { extractEmails } from "../email/extract.js";
import path from "path";

export async function scrapeSaudiListPage({ page, url, userAgent, dumpHtml, enableEmailExtraction }) {
  const html = await fetchHTML(url, userAgent);
  if (dumpHtml) {
    const out = path.join("runs", "html", `list-${String(page).padStart(3, "0")}.html`);
    dumpFile(out, html);
  }

  const $ = cheerio.load(html);

  // Find only job items: anchor links that point to job-details
  const jobLinks = $('a[href*="/job-details?"]');
  const linkCount = jobLinks.length;

  const items = [];
  if (!linkCount) {
    // No visible jobs — possibly blocked markup or layout change;
    // still return empty and let caller log a none-found row.
    return { items, linkCount };
  }

  jobLinks.each((_, a) => {
    const $a = $(a);
    // prefer closest meaningful container to scope text (li, div, article, tr)
    const $box = $a.closest("li,div,article,tr").first();
    const scopeHtml = $box && $box.length ? $box.html() || "" : $a.parent().html() || "";
    const scopeText = $box && $box.length ? $box.text() || "" : $a.parent().text() || "";

    const emails = enableEmailExtraction ? extractEmails(`${scopeHtml} ${scopeText}`) : [];
    const row = {
      title: "Recent Jobs",
      category: "Other",
      location: "Saudi Arabia",
      email: emails.length ? emails[0] : null,
      emails
    };
    items.push(row);
  });

  return { items, linkCount };
}

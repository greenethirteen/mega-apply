import fetch from "node-fetch";
import { load } from "cheerio";
import {
  cleanTitle,
  cleanCategory,
  cleanLocation,
  ensureTitle,
} from "./ai/cleaners.js";

export async function fetchJobListPage(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);

  const links = [];
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    if (href.includes("/job-details?jobid=")) {
      try {
        const absolute = new URL(href, url).toString();
        links.push(absolute);
      } catch {}
    }
  });
  return [...new Set(links)];
}

export async function fetchJobDetail(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);

  const rawTitle = $("h1, .job-title, title").first().text();
  const title = ensureTitle(rawTitle);
  const category = cleanCategory(
    $(".category, .job-category").first().text() || ""
  );
  const location = cleanLocation(
    $(".location, .job-location").first().text() || "Saudi Arabia"
  );

  return { html, title, category, location };
}

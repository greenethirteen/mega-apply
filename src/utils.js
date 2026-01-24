// src/utils.js
import fs from "fs";
import path from "path";

export async function fetchHTML(url, userAgent) {
  const headers = {
    "User-Agent": userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache"
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return await res.text();
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function dumpFile(relPath, content) {
  ensureDir(path.dirname(relPath));
  fs.writeFileSync(relPath, content);
}

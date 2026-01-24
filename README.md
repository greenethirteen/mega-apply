# RapidApply Saudi Add-on

Scrape **saudijobs.in**, split multi-vacancy posts into separate jobs, clean titles, and generate a **1-line description** with GPT.  
Writes to **Firebase RTDB** under: `/jobs_sa/{job_uid}`.

## Features
- Multi-vacancy split (one record per role)
- Title cleanup (removes "URGENT", "Walk-in", etc.)
- One-line GPT summary (`description_snippet`)
- Category mapping:
  - Heuristic keyword map (`src/config/sa_category_map.json`)
  - **Optional** GPT category classification (`USE_GPT_CATEGORY=true`)

## Quick Start
```bash
# 1) install
npm i

# 2) copy env
cp .env.example .env
# fill OPENAI_API_KEY and one firebase auth method

# 3) run scraper
npm run scrape
```

The script will crawl N list pages (default 8), visit job detail pages, and write cleaned jobs to `/jobs_sa/*`.

## Env Vars
- `OPENAI_API_KEY`: OpenAI key
- `SAUDI_PAGES`: number of list pages to crawl (default 8)
- `PAUSE_MS`: ms to wait between detail pages (default 800)
- `USE_GPT_CATEGORY`: `true` to use GPT for category mapping (keyword map is fallback)

## Firebase Access
Use either:
1. `GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/serviceAccount.json`  
2. `FIREBASE_SERVICE_ACCOUNT={...}` inline JSON (single line)

## Cron Example
See `scripts/cron_example.sh` for a sample crontab entry.

## Output Schema
Each job record (values normalized / shortened):
```json
{
  "id": "sha1(uid)",
  "title": "Electrical Engineer",
  "company": "ABC Co",
  "location": "Saudi Arabia",
  "posted_at": "2025-10-18T10:00:00.000Z",
  "apply_url": "https://saudijobs.in/job-details?jobid=...",
  "source": "saudijobs.in",
  "country": "SA",
  "category": "Engineering",
  "description_snippet": "Electrical engineer for construction projects; GCC experience required.",
  "salary": "SAR 5,000 - SAR 7,000",
  "scraped_at": "ISO",
  "last_updated": "ISO"
}
```

## Integrating with RapidApply
- Read from `/jobs_sa` when user selects **Saudi** (or merge with Bahrain feed for **Both**)
- Use `id` (`job_uid`) to avoid duplicates in your “already applied” table
- Respect existing per-day apply limits and cooldowns

---
# RapidApplyKSAScraper
# mega-apply

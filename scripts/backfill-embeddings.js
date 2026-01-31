import admin from "firebase-admin";
import crypto from "node:crypto";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "";
const LIMIT = Math.min(parseInt(process.env.BACKFILL_LIMIT || "250", 10) || 250, 500);
const EMBED_BATCH_SIZE = Math.min(parseInt(process.env.EMBED_BATCH_SIZE || "25", 10) || 25, 100);
const EMBED_RETRIES = Math.min(parseInt(process.env.EMBED_RETRIES || "5", 10) || 5, 10);
const EMBED_RETRY_DELAY_MS = Math.min(parseInt(process.env.EMBED_RETRY_DELAY_MS || "1500", 10) || 1500, 10000);

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}
if (!FIREBASE_DB_URL) {
  console.error("FIREBASE_DB_URL is required (e.g. https://mega-apply-default-rtdb.firebaseio.com)");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: FIREBASE_DB_URL
});

const db = admin.database();

function normalizeEmbeddingInput(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function buildJobText(job) {
  return normalizeEmbeddingInput([job?.title, job?.description].filter(Boolean).join("\n"));
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function getEmbeddingsBatch(texts = []) {
  const inputs = texts.map((t) => normalizeEmbeddingInput(t)).filter(Boolean);
  if (!inputs.length) return [];
  const payload = { model: EMBEDDING_MODEL, input: inputs };
  let lastErr = null;
  for (let attempt = 1; attempt <= EMBED_RETRIES; attempt += 1) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`OpenAI Embeddings HTTP ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data.map((d) => d.embedding) : [];
    } catch (err) {
      lastErr = err;
      if (attempt < EMBED_RETRIES) {
        await sleep(EMBED_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

async function backfillOnce(startAfter = null) {
  let query = db.ref("jobs").orderByKey().limitToFirst(LIMIT);
  if (startAfter) {
    query = db.ref("jobs").orderByKey().startAfter(startAfter).limitToFirst(LIMIT);
  }
  const snap = await query.once("value");
  if (!snap.exists()) return { processed: 0, updated: 0, skipped: 0, lastKey: null };

  const jobs = [];
  snap.forEach((child) => jobs.push({ id: child.key, ...child.val() }));

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const toEmbed = [];

  for (const job of jobs) {
    processed += 1;
    const text = buildJobText(job);
    if (!text) {
      skipped += 1;
      continue;
    }
    const textHash = hashText(text);
    const hasEmbedding =
      Array.isArray(job.embedding) &&
      job.embedding.length > 0 &&
      job.embeddingHash === textHash &&
      job.embeddingModel === EMBEDDING_MODEL;
    if (hasEmbedding) {
      skipped += 1;
      continue;
    }
    toEmbed.push({ id: job.id, text, hash: textHash });
  }

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const chunk = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await getEmbeddingsBatch(chunk.map((c) => c.text));
    const updates = {};
    chunk.forEach((item, idx) => {
      const embedding = embeddings[idx];
      if (!Array.isArray(embedding)) return;
      updates[`jobs/${item.id}/embedding`] = embedding;
      updates[`jobs/${item.id}/embeddingHash`] = item.hash;
      updates[`jobs/${item.id}/embeddingModel`] = EMBEDDING_MODEL;
      updated += 1;
    });
    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }
  }

  const lastKey = jobs.length ? jobs[jobs.length - 1].id : null;
  return { processed, updated, skipped, lastKey };
}

async function main() {
  let lastKey = process.env.BACKFILL_START_AFTER || null;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let loops = 0;

  while (true) {
    const res = await backfillOnce(lastKey);
    totalProcessed += res.processed;
    totalUpdated += res.updated;
    totalSkipped += res.skipped;
    loops += 1;
    console.log(
      `[batch ${loops}] processed=${res.processed} updated=${res.updated} skipped=${res.skipped} lastKey=${res.lastKey}`
    );
    if (!res.lastKey || res.processed === 0) break;
    lastKey = res.lastKey;
  }

  console.log(
    `DONE: processed=${totalProcessed} updated=${totalUpdated} skipped=${totalSkipped}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

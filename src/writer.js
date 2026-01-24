// src/writer.js
import { initFirebase, getDb } from "./firebase.js";

const RTDB_PATH = process.env.RTDB_PATH || "jobs";

export async function initFirebaseIfPossible() {
  const db = await initFirebase();
  return !!db;
}

export async function writeRow(row) {
  const db = getDb();
  if (!db) return false; // dry-run
  const ref = db.ref(RTDB_PATH).push();
  await ref.set({
    ...row,
    createdAt: new Date().toISOString()
  });
  return true;
}

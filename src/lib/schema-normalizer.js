// src/lib/schema-normalizer.js
// Minimal normalizer/guard so only the expected fields are saved.
export function normalizeJobRecord(rec) {
  const out = {};
  out.title = typeof rec.title === 'string' ? rec.title : 'Recent Jobs';
  out.category = typeof rec.category === 'string' ? rec.category : 'Project Management';
  out.location = typeof rec.location === 'string' ? rec.location : 'Saudi Arabia';
  out.email = rec.email ?? null;
  out.emails = Array.isArray(rec.emails) ? rec.emails : (rec.email ? [rec.email] : []);
  out.description = typeof rec.description === 'string' ? rec.description : null; // NEW
  out.url = typeof rec.url === 'string' ? rec.url : null;                           // NEW
  return out;
}

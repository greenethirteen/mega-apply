// src/splitter.js
// Multi-role splitter (title + description) + compound role splitting
//
// Handles:
// - "Ras Tanurah, for the following positions" (bulleted list in description)
// - "Multiple engineering vacancies"
// - "Engineers ( civil, mech, electrical )" → ["Civil Engineer","Mechanical Engineer","Electrical Engineer"]
// - Compound titles like "Project Manager Civil Engineer" → split into roles

const ROLE_SECTION = /(following positions|following roles|positions available|openings|vacancies|the below positions|multiple (engineering|engineer) vacancies)/i;
const GENERIC_TITLE = /(urgent requirement|urgent|requirement|vacancies|openings|hiring|wanted|walk[-\s]?in|jobs?\s*in|multiple positions|available positions)/i;

function norm(s){ return String(s||"").replace(/\s+/g," ").trim(); }

function mapDisciplineToEngineer(tok){
  const t = tok.toLowerCase().trim();
  if (!t) return null;
  if (t === 'mech' || t === 'mechanical') return 'Mechanical Engineer';
  if (t === 'elect' || t === 'electrical') return 'Electrical Engineer';
  if (t === 'elv') return 'ELV Engineer';
  if (t === 'struct' || t === 'structural') return 'Structural Engineer';
  if (t === 'hvac') return 'HVAC Engineer';
  if (t === 'civil') return 'Civil Engineer';
  // default guess
  return t[0].toUpperCase()+t.slice(1)+' Engineer';
}

function trySplitFromTitle(title=''){
  const t = norm(title);
  // Engineers ( civil, mech, electrical )
  const m = t.match(/^\s*engineers?\s*\(([^)]+)\)/i);
  if (m){
    const parts = m[1].split(/[,/&]+/).map(x=>norm(x)).filter(Boolean);
    const out = [];
    for(const p of parts){
      const mapped = mapDisciplineToEngineer(p);
      if (mapped) out.push(mapped);
    }
    return Array.from(new Set(out));
  }
  return [];
}

function extractRolesFromText(text=''){
  const lines = String(text||'').split(/\r?\n/).map(l=>l.replace(/\u00A0/g,' ').trim()).filter(Boolean);
  const roles = [];
  for(const l of lines){
    if (/^(?:\d+[\)\.\-]\s*|[\*\-\u2022•]\s*)/.test(l)){
      const core = l.replace(/^(?:\d+[\)\.\-]\s*|[\*\-\u2022•]\s*)/,'')
                    .replace(/\s*-\s*\d+\s*(ea|nos?)\.?$/i,'')
                    .trim();
      if (core && core.length<=80) roles.push(core);
    }
  }
  return Array.from(new Set(roles));
}

// New: split compound titles
const ROLE_HINT = /\b(engineer|supervisor|officer|manager|technician|coordinator|controller|specialist|inspector|architect|analyst|surveyor|operator|foreman|planner|estimator|procurement|document controller|hse|qa|qaqc|qa\/qc|hvac|mech|civil|electrical|elv|autocad|driver|nurse|accountant|qs|drafter|administrator)\b/i;

function splitCompoundTitleIfNeeded(title) {
  const t = (title||"").trim();
  if (!t) return [];
  const parts = t.split(/\s*(?:&|\/|,| and )\s*/i).map(s=>s.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const roles = parts.filter(p => ROLE_HINT.test(p) && p.length <= 60);
  if (roles.length >= 2) return Array.from(new Set(roles));
  return [];
}

export function splitMultiRoles(raw){
  const title = raw.title || '';
  const desc  = raw.description || raw.description_html || '';

  // If the heading/description indicates multi-roles, split
  if (ROLE_SECTION.test(title) || ROLE_SECTION.test(desc)) {
    const byTitle = trySplitFromTitle(title);
    const byDesc  = extractRolesFromText(desc);
    const roles = (byTitle.length?byTitle:[]).concat(byDesc);
    const uniq = Array.from(new Set(roles)).filter(Boolean).slice(0, 50);
    if (uniq.length) return uniq.map(r=>({...raw, title:r, multi_source_title:title}));
  }

  // If cleaner returned empty title (signaling multi-role), also split from desc
  if (!title) {
    const byDesc = extractRolesFromText(desc);
    if (byDesc.length) return byDesc.map(r=>({...raw, title:r, multi_source_title:''}));
  }

  // If title is generic but description lists multiple roles, split anyway
  const descRoles = extractRolesFromText(desc);
  if (descRoles.length >= 2 && (GENERIC_TITLE.test(title) || !ROLE_HINT.test(title))) {
    return descRoles.map(r => ({ ...raw, title: r, multi_source_title: title }));
  }

  // Try splitting compound titles like "Project Manager Civil Engineer" or "... & Safety Supervisor"
  const compound = splitCompoundTitleIfNeeded(title);
  if (compound.length) {
    return compound.map(r => ({ ...raw, title: r, multi_source_title: title }));
  }

  return [raw];
}

export default { splitMultiRoles, extractRolesFromText };

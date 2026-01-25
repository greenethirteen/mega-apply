// src/category.js
// Deterministic category chooser. No model calls.
// Expanded taxonomy tailored to saudijobs.in (engineering/construction heavy).
// Order matters: first match wins.

const RULES = [
  // Core construction / site roles
  { cat: "Construction / Site Management", re: /(construction\s*manager|site\s*(manager|engineer)|camp\s*boss|general\s*foreman|superintendent)/i },

  // Engineering disciplines
  { cat: "Civil", re: /(\bcivil\b|structural|infrastructure|road\b|highway|bridge|tunnel|concrete|rebar|land\s*survey(or)?|\bqs\b|quantity\s*survey(or)?)/i },
  { cat: "Mechanical", re: /(\bmechanical\b|mep\b|plumbing|fire\s*fighting|hvac|chiller|duct|pump|piping|rotating\s*equipment|static\s*equipment)/i },
  { cat: "Electrical", re: /(electrical|\belv\b|low\s*current|substation|mv\b|lv\b|transformer|protection\s*relay|switchgear|power\s*system|panel\s*board)/i },
  { cat: "Instrumentation & Control", re: /(instrumentation|\bics\b|control\s*systems|dcs\b|plc\b|scada\b|loop\s*check|calibration)/i },
  { cat: "Telecom", re: /(telecom|fiber\s*optics|\bfttx\b|structured\s*cabling|bms\b(?!\w)|avs\b|pa\/ga)/i },

  // Project controls
  { cat: "Planning", re: /(planning|scheduler|primavera|\bp6\b|project\s*controls)/i },
  { cat: "Estimation", re: /(estimator|estimation|tender|bid|boq\b|cost\s*(control|engineer)|pricing)/i },

  // QA/Safety
  { cat: "QAQC", re: /(qa\/?qc|\bqa\b|\bqc\b|quality\s*(assurance|control|engineer)|quality\s*inspector|inspection\b|inspector\b|welding\s*inspection|ndt\b|coating\s*inspection|iso\s*9001)/i },
  { cat: "HSE", re: /(\bhse\b|\bohs\b|safety\b|nebosh|osha\b|iosh\b|permit\s*to\s*work|ptw)/i },

  // PM / Leadership
  { cat: "Project Management", re: /(project\s*(manager|engineer|coordinator)|\bpm\b(?![a-z])|epc\b|lead\s*engineer|site\s*(manager|engineer)|document\s*controller|doc\s*controller|document\s*control)/i },

  // Commercial & supply
  { cat: "Procurement/Logistics", re: /(procure|buyer|purchas|expedit|vendor\s*dev|supply\s*chain|material\s*controller?|warehouse|store\s*keeper|storeman|logistics|inventory|material\s*handling)/i },

  // Technical support
  // Fallback: keep to the 9 buckets above
  { cat: "Project Management", re: /./i },
];

export function chooseCategory(title, desc = "") {
  const hay = `${title || ""} ${desc || ""}`;
  for (const r of RULES) {
    if (r.re.test(hay)) return r.cat;
  }
  return "General Engineering";
}

export default { chooseCategory };

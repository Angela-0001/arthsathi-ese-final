/**
 * ArthSathi — Scheme Tagger (keyword-based, no AI)
 *
 * Tags all schemes using keyword matching on name + description.
 * Adds target_groups TEXT[] and eligible_states TEXT[] columns.
 *
 * Run once:    node tag_schemes.js
 * Re-tag all:  node tag_schemes.js --update-all
 */

require('dotenv').config();
const { query } = require('./src/db');

const UPDATE_ALL = process.argv.includes('--update-all');

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi',
  'Jammu and Kashmir','Ladakh','Puducherry','Chandigarh',
  'Andaman and Nicobar Islands','Dadra and Nagar Haveli','Lakshadweep',
];

// State aliases used in scheme names
const STATE_ALIASES = {
  'andhra': 'Andhra Pradesh', 'ap ': 'Andhra Pradesh',
  'arunachal': 'Arunachal Pradesh',
  'assam': 'Assam',
  'bihar': 'Bihar',
  'chhattisgarh': 'Chhattisgarh', 'chattisgarh': 'Chhattisgarh',
  'goa': 'Goa',
  'gujarat': 'Gujarat',
  'haryana': 'Haryana',
  'himachal': 'Himachal Pradesh', 'h.p.': 'Himachal Pradesh',
  'jharkhand': 'Jharkhand',
  'karnataka': 'Karnataka',
  'kerala': 'Kerala',
  'madhya pradesh': 'Madhya Pradesh', 'm.p.': 'Madhya Pradesh',
  'maharashtra': 'Maharashtra',
  'manipur': 'Manipur',
  'meghalaya': 'Meghalaya',
  'mizoram': 'Mizoram',
  'nagaland': 'Nagaland',
  'odisha': 'Odisha', 'orissa': 'Odisha',
  'punjab': 'Punjab',
  'rajasthan': 'Rajasthan',
  'sikkim': 'Sikkim',
  'tamil nadu': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu', 't.n.': 'Tamil Nadu',
  'telangana': 'Telangana',
  'tripura': 'Tripura',
  'uttar pradesh': 'Uttar Pradesh', 'u.p.': 'Uttar Pradesh',
  'uttarakhand': 'Uttarakhand', 'uttaranchal': 'Uttarakhand',
  'west bengal': 'West Bengal',
  'delhi': 'Delhi', 'new delhi': 'Delhi',
  'jammu': 'Jammu and Kashmir', 'kashmir': 'Jammu and Kashmir', 'j&k': 'Jammu and Kashmir',
  'ladakh': 'Ladakh',
  'puducherry': 'Puducherry', 'pondicherry': 'Puducherry',
  'chandigarh': 'Chandigarh',
  'andaman': 'Andaman and Nicobar Islands',
  'dadra': 'Dadra and Nagar Haveli',
  'lakshadweep': 'Lakshadweep',
  'north eastern': null, // multiple states
  'dnh': 'Dadra and Nagar Haveli', 'dnhdd': 'Dadra and Nagar Haveli',
};

// Keyword rules for each group
const GROUP_RULES = {
  women: [
    'women', 'woman', 'girl', 'girls', 'female', 'mahila', 'stree', 'nari',
    'beti', 'kanya', 'kishori', 'matru', 'maternal', 'mother', 'widow',
    'widows', 'vidhwa', 'divorcee', 'self help group', 'shg', 'sakhi',
    'ladli', 'balika', 'gender', 'annapurna', 'poshan', 'pradhan mantri matru',
    'pregnant', 'lactating', 'swayam siddha', 'priyadarshini',
  ],
  widow: [
    'widow', 'widows', 'vidhwa', 'vidhava', 'bereaved', 'destitute women',
    'single woman', 'abandoned women',
  ],
  disabled: [
    'disabled', 'disability', 'divyang', 'handicap', 'handicapped', 'viklang',
    'differently abled', 'specially abled', 'blindness', 'blind', 'deaf',
    'locomotor', 'mental illness', 'intellectual disability', 'cerebral palsy',
    'leprosy', 'acid attack', 'multiple disability', 'benchmark disability',
  ],
  bpl: [
    'bpl', 'below poverty', 'below poverty line', 'poor', 'poverty',
    'antyodaya', 'aay', 'garib', 'ration card', 'phh', 'destitute',
    'marginalised', 'marginalized', 'economically weaker', 'ews',
    'vulnerable', 'weaker section', 'lower income', 'low income',
    'subsistence', 'impoverished', 'underprivileged', 'pm garib',
  ],
  elderly: [
    'elderly', 'old age', 'senior citizen', 'aged', 'vridh', 'vrishth',
    'pension', 'pensioner', 'geriatric', '50 years', '55 years', '60 years', '65 years',
    'above 50', 'above 55', 'above 60', 'above 65',
    'varishtha', 'pradhan mantri vaya', 'ignoap', 'national old age',
    'indira gandhi national old', 'old age home', 'senior',
  ],
  farmers: [
    'farmer', 'farmers', 'kisan', 'kisaan', 'agriculture', 'agricultural',
    'farm', 'farming', 'crop', 'crops', 'fasal', 'krishi', 'horticulture',
    'fishermen', 'fisherman', 'fishing', 'fisheries', 'sericulture', 'silk',
    'animal husbandry', 'dairy', 'livestock', 'poultry', 'irrigation',
    'seed', 'fertilizer', 'soil', 'watershed', 'agri', 'cultivat',
    'marginal farmer', 'small farmer', 'landless',
  ],
  sc: [
    'scheduled caste', 'scheduled castes', 'sc/', '(sc)', 'dalit', 'dalits',
    'harijans', 'ambedkar', 'dr. b.r. ambedkar', 'dr.b.r.ambedkar',
    'post matric sc', 'pre matric sc', 'sc students', 'sc scholarship',
    'for sc', ' sc ', ' scs ',
  ],
  st: [
    'scheduled tribe', 'scheduled tribes', 'st/', '(st)', 'tribal', 'tribals',
    'adivasi', 'adivasis', 'vanvasi', 'indigenous', 'forest dweller',
    'post matric st', 'pre matric st', 'st students', 'st scholarship',
    'for st', ' st ', ' sts ', 'north eastern',
  ],
  obc: [
    'other backward', 'obc', 'backward class', 'backward classes',
    'backward caste', 'backward castes', 'obcs', 'socially backward',
    'educationally backward', 'most backward', 'de-notified', 'nomadic tribe',
    'nt/', 'vjnt', ' nt ', 'dnts',
  ],
  minority: [
    'minority', 'minorities', 'muslim', 'christian', 'sikh', 'buddhist',
    'jain', 'parsi', 'zoroastrian', 'waqf', 'madrasa', 'maulana azad',
    'minority community', 'religious minority',
  ],
  students: [
    'student', 'students', 'scholarship', 'education', 'school', 'college',
    'university', 'academic', 'study', 'studies', 'chhatra', 'vidyarthi',
    'meritorious', 'merit', 'stipend', 'tuition', 'hostel', 'girl child',
    'children', 'child', 'youth', 'young', 'juvenile', 'coaching',
    'vocational training', 'apprentice', 'internship',
  ],
  housing: [
    'housing', 'house', 'home', 'shelter', 'awas', 'habitat', 'dwelling',
    'construction of house', 'pucca house', 'toilet', 'sanitation',
    'slum', 'iay', 'pmay', 'pradhan mantri awas', 'rural housing',
    'urban housing', 'tenement', 'flat', 'apartment',
  ],
  health: [
    'health', 'medical', 'hospital', 'treatment', 'disease', 'illness',
    'medicine', 'doctor', 'nurse', 'sanitation', 'nutrition', 'malnutrition',
    'vaccination', 'immunization', 'cancer', 'tuberculosis', 'tb',
    'dialysis', 'ayushman', 'pmjay', 'esi', 'health insurance',
    'mental health', 'janani', 'suraksha', 'poshan', 'mid day meal',
  ],
  employment: [
    'employment', 'job', 'work', 'livelihood', 'rozgar', 'mgnrega', 'nrega',
    'skill', 'training', 'vocational', 'apprenticeship', 'placement',
    'unemployed', 'unemployment', 'workforce', 'labourer', 'worker',
    'mazdoor', 'shramik', 'daily wage', 'wage employment', 'pmkvy',
    'deen dayal', 'roshni', 'udaan', 'himayat',
  ],
  business: [
    'entrepreneur', 'entrepreneurship', 'business', 'enterprise', 'startup',
    'msme', 'mudra', 'loan', 'credit', 'self employment', 'self-employment',
    'vyapar', 'udyog', 'industry', 'industrial', 'trade', 'trader',
    'stand up india', 'standup', 'pmegp', 'kvic', 'artisan', 'craftsman',
    'weaver', 'handloom', 'handicraft', 'khadi',
  ],
};

// ── Classify a single scheme ────────────────────────────────────────────────
function classifyScheme(name, description, ministry) {
  const text = `${name} ${description} ${ministry || ''}`.toLowerCase();

  // Find target groups
  const groups = [];
  for (const [group, keywords] of Object.entries(GROUP_RULES)) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
      groups.push(group);
    }
  }

  // Remove redundant: if widow is set, women is implied — keep both for better filtering
  // If sc/st/obc is set, remove "general"
  const hasCasteSpecific = groups.includes('sc') || groups.includes('st') || groups.includes('obc');

  if (groups.length === 0 || (groups.length === 1 && !hasCasteSpecific)) {
    if (!groups.includes('general')) groups.push('general');
  }

  // Find eligible states
  const states = [];
  const textLower = text.toLowerCase();

  // Check state aliases
  for (const [alias, state] of Object.entries(STATE_ALIASES)) {
    if (state && textLower.includes(alias.toLowerCase())) {
      if (!states.includes(state)) states.push(state);
    }
  }

  // Also check full state names
  for (const state of INDIAN_STATES) {
    if (textLower.includes(state.toLowerCase()) && !states.includes(state)) {
      states.push(state);
    }
  }

  // If "central" keywords found, clear states (national scheme)
  const centralKeywords = ['central government', 'ministry of', 'government of india', 'national', 'pradhan mantri', 'pm ', 'india ', 'union government', 'central scheme'];
  const isCentral = centralKeywords.some(kw => textLower.includes(kw));
  if (isCentral && states.length === 0) {
    // Leave states empty = national scheme
  }

  return { groups, states };
}

async function addColumns() {
  await query(`ALTER TABLE schemes ADD COLUMN IF NOT EXISTS target_groups TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE schemes ADD COLUMN IF NOT EXISTS eligible_states TEXT[] DEFAULT '{}'`);
  console.log('[TagSchemes] Columns ensured: target_groups, eligible_states');
}

async function main() {
  console.log('[TagSchemes] Starting keyword-based scheme classification...');
  await addColumns();

  const condition = UPDATE_ALL
    ? 'is_active = TRUE'
    : "is_active = TRUE AND (target_groups IS NULL OR target_groups = '{}')";

  const result = await query(
    `SELECT id, name, description, ministry FROM schemes WHERE ${condition} ORDER BY id`
  );
  const schemes = result.rows;
  console.log(`[TagSchemes] Schemes to process: ${schemes.length}`);

  if (schemes.length === 0) {
    console.log('[TagSchemes] All schemes already tagged! Use --update-all to re-tag.');
    await showSummary();
    process.exit(0);
  }

  let processed = 0, failed = 0;
  const BATCH = 500; // DB batch update size

  // Process in memory, batch DB updates
  const updates = [];
  for (const s of schemes) {
    const name = typeof s.name === 'object' ? (s.name.en || s.name.hi || '') : (s.name || '');
    const desc = typeof s.description === 'object' ? (s.description.en || s.description.hi || '') : (s.description || '');
    const ministry = s.ministry || '';

    const { groups, states } = classifyScheme(name, desc, ministry);
    updates.push({ id: s.id, groups, states });
  }

  console.log(`[TagSchemes] Classified ${updates.length} schemes in memory. Saving to DB...`);

  // Bulk save using unnest for maximum speed
  console.log(`[TagSchemes] Saving ${updates.length} schemes to DB in bulk...`);

  const ids     = updates.map(u => u.id);
  const groups  = updates.map(u => u.groups);
  const states  = updates.map(u => u.states);

  try {
    // Use unnest to update all at once
    await query(
      `UPDATE schemes SET
         target_groups  = data.groups::text[],
         eligible_states = data.states::text[]
       FROM (SELECT unnest($1::int[]) as id,
                    unnest($2::text[][]) as groups,
                    unnest($3::text[][]) as states) as data
       WHERE schemes.id = data.id`,
      [ids, groups, states]
    );
    processed = updates.length;
  } catch (e) {
    console.log(`Bulk update failed (${e.message}), falling back to batches...`);
    // Fallback: batches of 100
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      for (const u of batch) {
        try {
          await query('UPDATE schemes SET target_groups=$1, eligible_states=$2 WHERE id=$3', [u.groups, u.states, u.id]);
          processed++;
        } catch { failed++; }
      }
      process.stdout.write(`\r[TagSchemes] Saved ${processed}/${updates.length}...`);
    }
  }

  console.log(`\n[TagSchemes] === COMPLETE ===`);
  console.log(`Processed: ${processed} | Failed: ${failed}`);
  await showSummary();
  process.exit(0);
}

async function showSummary() {
  const groupSummary = await query(
    `SELECT unnest(target_groups) as grp, COUNT(*) as cnt
     FROM schemes WHERE is_active=TRUE AND target_groups != '{}'
     GROUP BY grp ORDER BY cnt DESC`
  );
  const stateSummary = await query(
    `SELECT unnest(eligible_states) as st, COUNT(*) as cnt
     FROM schemes WHERE is_active=TRUE AND eligible_states != '{}'
     GROUP BY st ORDER BY cnt DESC LIMIT 10`
  );
  const national = await query(
    `SELECT COUNT(*) FROM schemes WHERE is_active=TRUE AND (eligible_states IS NULL OR eligible_states = '{}')`
  );

  console.log('\nTarget group distribution:');
  groupSummary.rows.forEach(r => console.log(`  ${r.grp.padEnd(12)}: ${r.cnt}`));
  console.log(`\nNational schemes: ${national.rows[0].count}`);
  console.log('\nTop state-specific schemes:');
  stateSummary.rows.forEach(r => console.log(`  ${(r.st||'').padEnd(25)}: ${r.cnt}`));
}

main().catch(e => {
  console.error('[TagSchemes] Fatal:', e.message);
  process.exit(1);
});

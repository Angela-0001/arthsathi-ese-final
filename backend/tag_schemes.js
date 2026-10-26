/**
 * ArthSathi — Scheme Tagger
 *
 * Uses Groq to classify all schemes into:
 * - target_groups: TEXT[] (women, disabled, bpl, elderly, farmers, sc, st, obc, students, general)
 * - eligible_states: TEXT[] (empty = national/all states, else specific states)
 *
 * Both stored as PostgreSQL TEXT[] — queryable with: 'women' = ANY(target_groups)
 *
 * Run once:        node tag_schemes.js
 * Re-tag all:      node tag_schemes.js --update-all
 */

require('dotenv').config();
const { query } = require('./src/db');
const Groq = require('groq-sdk');

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const BATCH = 15;    // schemes per Groq call (smaller = more accurate)
const DELAY = 1500;  // ms between batches

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

async function addColumns() {
  await query(`ALTER TABLE schemes ADD COLUMN IF NOT EXISTS target_groups TEXT[] DEFAULT '{}'`);
  await query(`ALTER TABLE schemes ADD COLUMN IF NOT EXISTS eligible_states TEXT[] DEFAULT '{}'`);
  // Add GIN indexes for fast array queries
  await query(`CREATE INDEX IF NOT EXISTS idx_schemes_target_groups ON schemes USING GIN(target_groups)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_schemes_eligible_states ON schemes USING GIN(eligible_states)`);
  console.log('[TagSchemes] Columns and indexes ensured');
}

async function classifyBatch(schemes) {
  const list = schemes.map((s, i) => {
    const name = typeof s.name === 'object' ? (s.name.en || s.name.hi || '') : (s.name || '');
    const desc = typeof s.description === 'object' ? (s.description.en || s.description.hi || '') : (s.description || '');
    return `${i}: ${`${name}. ${desc}`.slice(0, 250)}`;
  }).join('\n');

  const stateList = INDIAN_STATES.join(', ');

  const prompt = `Analyze each Indian government scheme and extract:
1. target_groups: who is this scheme FOR?
2. eligible_states: which Indian states (empty array if national/central scheme for all states)

TARGET GROUPS (use only these exact values):
- "women" = for women/girls/mothers/widows/self-help groups
- "disabled" = for disabled/divyang/handicapped persons
- "bpl" = for BPL/very poor/below poverty line/AAY card holders
- "elderly" = for senior citizens/old age (60+ years)/pension
- "farmers" = for farmers/kisan/agriculture/crop/fishermen
- "sc" = for Scheduled Castes/Dalits specifically
- "st" = for Scheduled Tribes/Adivasi/Tribal specifically
- "obc" = for OBC/Other Backward Classes specifically
- "students" = for students/education/scholarship/youth
- "general" = open to all / no specific group restriction

STATES: ${stateList}
Use exact names from above. Empty array [] means national scheme (available in all states).

RULES:
- A scheme can belong to MULTIPLE groups
- If central/national scheme: eligible_states = []
- If state-specific: put only that state(s) in eligible_states
- Schemes for "minorities" → use "general" unless specifically SC/ST/OBC
- Schemes for "poor families" → "bpl"
- Schemes for "girl child" → "women" + "students" if education

Schemes:
${list}

Reply ONLY with a JSON array, one object per scheme, in order:
[{"groups":["women","bpl"],"states":[]},{"groups":["farmers"],"states":["Maharashtra","Karnataka"]},...]`;

  try {
    const r = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 800,
    });

    const raw = r.choices[0]?.message?.content?.trim() || '[]';
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    console.error('[TagSchemes] Groq error:', e.message);
    return null;
  }
}

const VALID_GROUPS = ['women','disabled','bpl','elderly','farmers','sc','st','obc','students','general'];

async function main() {
  console.log('[TagSchemes] Starting scheme classification (groups + states)...');

  await addColumns();

  const condition = UPDATE_ALL
    ? 'is_active = TRUE'
    : "is_active = TRUE AND (target_groups IS NULL OR target_groups = '{}')";

  const result = await query(
    `SELECT id, name, description FROM schemes WHERE ${condition} ORDER BY id LIMIT 3000`
  );
  const schemes = result.rows;
  console.log(`[TagSchemes] Schemes to process: ${schemes.length}`);

  if (schemes.length === 0) {
    console.log('[TagSchemes] All schemes already tagged! Use --update-all to re-tag.');
    await showSummary();
    process.exit(0);
  }

  let processed = 0, failed = 0;

  for (let i = 0; i < schemes.length; i += BATCH) {
    const batch = schemes.slice(i, i + BATCH);
    const batchNum = Math.floor(i/BATCH) + 1;
    const total = Math.ceil(schemes.length/BATCH);
    process.stdout.write(`\r[TagSchemes] Batch ${batchNum}/${total} | done: ${processed} | failed: ${failed}`);

    const results = await classifyBatch(batch);

    if (!results || results.length !== batch.length) {
      console.warn(`\n[TagSchemes] Batch ${batchNum} failed, skipping`);
      failed += batch.length;
      await new Promise(r => setTimeout(r, DELAY * 2));
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const scheme = batch[j];
      const item   = results[j] || {};

      const groups = Array.isArray(item.groups)
        ? item.groups.filter(g => VALID_GROUPS.includes(g))
        : [];
      const finalGroups = groups.length ? groups : ['general'];

      const states = Array.isArray(item.states)
        ? item.states.filter(s => INDIAN_STATES.includes(s))
        : [];

      try {
        await query(
          'UPDATE schemes SET target_groups = $1, eligible_states = $2 WHERE id = $3',
          [finalGroups, states, scheme.id]
        );
        processed++;
      } catch (e) {
        console.error(`\n[TagSchemes] DB error id=${scheme.id}:`, e.message);
        failed++;
      }
    }

    if (i + BATCH < schemes.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  console.log(`\n\n[TagSchemes] === COMPLETE ===`);
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
    `SELECT unnest(eligible_states) as state, COUNT(*) as cnt
     FROM schemes WHERE is_active=TRUE AND eligible_states != '{}'
     GROUP BY state ORDER BY cnt DESC LIMIT 10`
  );
  const national = await query(
    `SELECT COUNT(*) FROM schemes WHERE is_active=TRUE AND eligible_states = '{}'`
  );

  console.log('\nTarget group distribution:');
  groupSummary.rows.forEach(r => console.log(`  ${r.grp.padEnd(10)}: ${r.cnt} schemes`));
  console.log(`\nNational schemes (all states): ${national.rows[0].count}`);
  console.log('\nTop state-specific schemes:');
  stateSummary.rows.forEach(r => console.log(`  ${r.state.padEnd(20)}: ${r.cnt} schemes`));
}

main().catch(e => {
  console.error('[TagSchemes] Fatal:', e.message);
  process.exit(1);
});

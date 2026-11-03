require('dotenv').config();
const { getProfileSchemes } = require('./src/services/recommendationEngine');

async function run() {
  console.log('--- ABLE-BODIED WOMAN, GENERAL, MAHARASHTRA ---');
  const profile = { age: 28, gender: 'female', caste_category: 'general', occupation: 'daily_wage_worker', monthly_income: 5000, bpl_card: false, state: 'Maharashtra', is_disabled: false, has_girl_child: false };
  const schemes = await getProfileSchemes(profile, 8);
  let allOk = true;
  schemes.forEach(s => {
    const n = typeof s.name === 'object' ? s.name.en : s.name;
    const g = s.target_groups || [];
    const bad = g.includes('disabled') || g.includes('sc') || g.includes('st') || g.includes('obc') || g.includes('elderly');
    if (bad) allOk = false;
    console.log(`${bad ? '❌' : '✅'} ${n?.slice(0,55)} | ${g.join(',')}`);
  });
  console.log(allOk ? '\n🎉 All correct!' : '\n⚠️  Some wrong schemes showing');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });

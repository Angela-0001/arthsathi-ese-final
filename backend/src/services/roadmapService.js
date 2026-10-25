'use strict';

const { fetchUserProfile } = require('./profileService');
const Groq = require('groq-sdk');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

function str(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.en || v.hi || v.mr || '';
  return String(v);
}

async function generate(userId) {
  const user = await fetchUserProfile(userId);

  const income = Number(user.monthly_income) || 0;

  // Estimate expenses based on occupation and income
  const expenseRatio = income < 5000 ? 0.85 : income < 15000 ? 0.75 : 0.65;
  const expenses = Math.round(income * expenseRatio);
  const disposable = Math.max(0, income - expenses);
  const emergencyFund = income * 3;

  const currentState = {
    monthly_income: income,
    monthly_expenses: expenses,
    monthly_savings: disposable,
    emergency_fund_target: emergencyFund,
  };

  // Parse goals
  let goals = [];
  try {
    if (user.goals) {
      const g = typeof user.goals === 'string' ? JSON.parse(user.goals) : user.goals;
      if (Array.isArray(g)) goals = g;
      else if (g && g.goal) goals = [{ title: str(g.goal), amount: g.amount, urgency: g.urgency }];
    }
  } catch {}

  // Budget breakdown
  const budgetBreakdown = {
    needs: Math.round(income * 0.50),       // 50% needs (food, rent, transport)
    wants: Math.round(income * 0.20),       // 20% wants (entertainment etc)
    savings: Math.round(income * 0.20),     // 20% savings
    emergency: Math.round(income * 0.10),   // 10% emergency fund
  };

  // Immediate actions (0-3 months) - financial habits
  const immediateActions = [];

  if (income > 0) {
    immediateActions.push({
      title: 'Track every expense this month',
      type: 'habit',
      description: 'Write down every rupee spent. Use a notebook or free app. This is the foundation of financial control.',
      estimated_benefit: 0,
      effort_level: 'low',
      deadline_days: 7,
    });

    immediateActions.push({
      title: `Save Rs.${Math.round(income * 0.10).toLocaleString('en-IN')} this month`,
      type: 'savings_plan',
      description: `Start with 10% of income. Even Rs.${Math.round(income * 0.10)} saved monthly = Rs.${Math.round(income * 1.2).toLocaleString('en-IN')}/year.`,
      estimated_benefit: Math.round(income * 1.2),
      effort_level: 'medium',
      deadline_days: 30,
    });

    if (disposable > 200) {
      immediateActions.push({
        title: `Open a recurring deposit for Rs.${disposable}`,
        type: 'savings_plan',
        description: `Put your monthly savings into a bank RD. Safe, earns ~6% interest. After 1 year you will have Rs.${Math.round(disposable * 12 * 1.06).toLocaleString('en-IN')}.`,
        estimated_benefit: Math.round(disposable * 12 * 1.06),
        effort_level: 'low',
        deadline_days: 30,
        link: 'https://www.sbi.co.in/web/personal-banking/deposits/recurring-deposit',
      });
    }
  }

  // Short term (3-12 months)
  const shortTermActions = [];

  shortTermActions.push({
    title: `Build Rs.${emergencyFund.toLocaleString('en-IN')} emergency fund`,
    type: 'savings_plan',
    description: `3 months of income as emergency fund. Save Rs.${Math.round(emergencyFund / 6).toLocaleString('en-IN')}/month for 6 months. This protects you from job loss or medical emergencies.`,
    estimated_benefit: emergencyFund,
    effort_level: 'medium',
    deadline_days: 180,
  });

  if (income < 5000) {
    shortTermActions.push({
      title: 'Apply for PMJJBY life insurance (Rs.20/year)',
      type: 'insurance',
      description: 'Rs.2 lakh life cover for just Rs.20/year. Protects your family if something happens to you. Available at any bank.',
      estimated_benefit: 200000,
      effort_level: 'low',
      deadline_days: 45,
      link: 'https://jansuraksha.gov.in/PMJJBY.aspx',
    });
    shortTermActions.push({
      title: 'Apply for PMSBY accident insurance (Rs.20/year)',
      type: 'insurance',
      description: 'Rs.2 lakh accident cover for Rs.20/year. Essential protection for daily wage workers.',
      estimated_benefit: 200000,
      effort_level: 'low',
      deadline_days: 45,
      link: 'https://jansuraksha.gov.in/PMSBY.aspx',
    });
  }

  if (income >= 3000) {
    shortTermActions.push({
      title: 'Start a Jan Dhan or savings account',
      type: 'banking',
      description: 'A bank account earns interest and keeps your money safe. Jan Dhan accounts are free and come with Rs.10,000 overdraft.',
      estimated_benefit: 0,
      effort_level: 'low',
      deadline_days: 60,
      link: 'https://pmjdy.gov.in/',
    });
  }

  // Long term (1+ year)
  const longTermActions = [];

  for (const goal of goals.slice(0, 3)) {
    const title = goal.title || goal.goal || '';
    const amount = Number(goal.amount) || 0;
    if (title) {
      const monthsNeeded = amount > 0 && disposable > 0 ? Math.ceil(amount / (disposable * 0.5)) : null;
      longTermActions.push({
        title: `Financial goal: ${title}`,
        type: 'goal',
        description: amount > 0
          ? `Target Rs.${amount.toLocaleString('en-IN')}. Save Rs.${Math.round(amount / 24).toLocaleString('en-IN')}/month to reach this in 2 years.`
          : `Work towards your goal: ${title}. Break it into monthly savings targets.`,
        estimated_benefit: amount,
        effort_level: 'medium',
        deadline_days: 365,
      });
    }
  }

  if (user.occupation === 'farmer' || user.occupation === 'marginal_farmer') {
    longTermActions.push({
      title: 'Build a crop insurance habit',
      type: 'insurance',
      description: 'Pradhan Mantri Fasal Bima Yojana covers crop loss. Enrol every season before sowing. Small premium, big protection.',
      estimated_benefit: 0,
      effort_level: 'low',
      deadline_days: 365,
      link: 'https://pmfby.gov.in/',
    });
  }

  if (income >= 8000) {
    longTermActions.push({
      title: 'Start a PPF account for retirement',
      type: 'investment',
      description: 'Public Provident Fund: tax-free, 7.1% interest, government-backed. Minimum Rs.500/year. Perfect long-term savings.',
      estimated_benefit: 0,
      effort_level: 'low',
      deadline_days: 365,
      link: 'https://www.nsiindia.gov.in/',
    });
  }

  // Timeline
  const allActions = [...immediateActions, ...shortTermActions, ...longTermActions];
  const timeline = allActions
    .sort((a, b) => a.deadline_days - b.deadline_days)
    .map(a => ({ title: a.title, type: a.type, days_from_now: a.deadline_days, benefit: a.estimated_benefit }));

  // AI advice using Groq — respond in user's language
  let aiSummary = null;
  if (groq) {
    try {
      const langInstruction = {
        hi: 'हिंदी में जवाब दो।',
        mr: 'मराठीत उत्तर द्या.',
        en: 'Respond in English.',
      }[user.preferred_language || 'hi'] || 'हिंदी में जवाब दो।';

      const prompt = `${langInstruction}
Give practical 2-sentence financial advice for:
Age: ${user.age}, Gender: ${user.gender}, Occupation: ${user.occupation}, Monthly income: Rs.${income}, State: ${user.state}.
Focus on saving money, budgeting, and building financial security. Be direct and specific.`;
      const completion = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
      });
      aiSummary = completion.choices[0]?.message?.content?.trim() || null;
    } catch {}
  }

  return {
    user_id: userId,
    profile_used: {
      age: user.age, gender: user.gender, occupation: user.occupation,
      income, state: user.state,
    },
    current_state: currentState,
    budget_breakdown: budgetBreakdown,
    goals,
    ai_summary: aiSummary,
    recommendations: {
      immediate_actions: immediateActions,
      short_term_plans: shortTermActions,
      long_term_plans: longTermActions,
    },
    timeline,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { generate };
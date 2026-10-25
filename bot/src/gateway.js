import axios from "axios";
import { translate } from "./translate.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const MAX_LEN = 3800;

function truncate(text) {
  return text.length <= MAX_LEN ? text : text.slice(0, MAX_LEN) + "\n...";
}

// Escape Markdown special chars in dynamic text to prevent Telegram parse errors
function escapeMd(text) {
  if (!text) return "";
  return String(text).replace(/[*_`\[\]]/g, "\\$&");
}

// Resolve telegram_id / whatsapp_number -> DB user id
async function resolveUserId(channelUserId, channel) {
  try {
    let param, value;
    if (channel === "telegram") {
      param = "telegram_id";
      value = channelUserId;
    } else {
      // Twilio sends "whatsapp:+918424960449" — strip the "whatsapp:" prefix
      param = "whatsapp";
      value = channelUserId.replace(/^whatsapp:/i, "");
    }
    const resp = await axios.get(`${BACKEND_URL}/api/users`, {
      params: { [param]: value },
      timeout: 8000,
    });
    const users = resp.data?.data || [];
    return users.length ? String(users[0].id) : null;
  } catch {
    return null;
  }
}

export async function sendToBackend(msg) {
  const userLang = msg.detected_language || "hi";

  try {
    // ── Scheme recommendations ────────────────────────────────────────
    if (msg.intent === "scheme_match") {
      const dbUserId = await resolveUserId(msg.user_id, msg.channel);
      if (!dbUserId) {
        return { text_response: await translate("Please link your profile first. Type /link followed by your phone number.", userLang) };
      }

      const resp = await axios.post(`${BACKEND_URL}/api/schemes/recommend`, {
        user_id: dbUserId, limit: 5,
      }, { timeout: 45000 });

      const schemes = resp.data?.data || [];
      if (!schemes.length) {
        return { text_response: await translate("No matching schemes found. Please complete your profile on the web app.", userLang) };
      }

      const header = await translate("Government Schemes matched to your profile:", userLang);
      let text = `\u{1F33E} *${header}*\n\n`;
      for (let i = 0; i < schemes.length; i++) {
        const s    = schemes[i];
        const name = escapeMd(await translate(s.name || "", userLang));
        const desc = escapeMd(await translate((s.description || "").slice(0, 120), userLang));
        text += `${i + 1}. *${name}*\n${desc}...\n`;
        if (s.application_url) text += `\u{1F517} ${s.application_url}\n`;
        text += "\n";
      }
      return { text_response: truncate(text) };
    }

    // ── Insurance recommendations ─────────────────────────────────────
    if (msg.intent === "insurance_recommend") {
      const dbUserId = await resolveUserId(msg.user_id, msg.channel);
      if (!dbUserId) {
        return { text_response: await translate("Please link your profile first. Type /link followed by your phone number.", userLang) };
      }

      const resp = await axios.post(`${BACKEND_URL}/api/insurance/recommend`, {
        user_id: dbUserId, limit: 4,
      }, { timeout: 45000 });

      const plans = resp.data?.data || [];
      if (!plans.length) {
        return { text_response: await translate("No insurance plans found. Visit the web app to complete your profile.", userLang) };
      }

      const header = await translate("Insurance Plans matched to your profile:", userLang);
      let text = `\u{1F6E1}\uFE0F *${header}*\n\n`;
      for (let i = 0; i < plans.length; i++) {
        const p       = plans[i];
        const nameRaw = typeof p.name === "object" ? (p.name.en || p.name.hi || "") : (p.name || "");
        const descRaw = typeof p.description === "object" ? (p.description.en || p.description.hi || "") : (p.description || "");
        const name    = escapeMd(await translate(nameRaw, userLang));
        const desc    = escapeMd(await translate(descRaw.slice(0, 100), userLang));
        text += `${i + 1}. *${name}*\n`;
        if (desc) text += `${desc}...\n`;
        if (p.annual_premium)  text += `\u{1F4B0} \u20B9${p.annual_premium}/yr  `;
        if (p.coverage_amount) text += `\u{1F6E1}\uFE0F \u20B9${p.coverage_amount} cover`;
        text += "\n";
        if (p.application_url) text += `\u{1F517} ${p.application_url}\n`;
        text += "\n";
      }
      return { text_response: truncate(text) };
    }

    // ── Profile ────────────────────────────────────────────────────────
    if (msg.intent === "profile") {
      const dbUserId = await resolveUserId(msg.user_id, msg.channel);
      if (!dbUserId) {
        return { text_response: await translate("Please link your profile first. Type /link followed by your phone number.", userLang) };
      }

      try {
        const resp = await axios.get(`${BACKEND_URL}/api/users/${dbUserId}`, { timeout: 10000 });
        const u = resp.data?.data;
        if (!u) {
          return { text_response: await translate("Profile not found. Please complete onboarding on the web app.", userLang) };
        }

        let text = `👤 *${await translate("Your Profile", userLang)}*\n\n`;
        if (u.full_name) text += `${await translate("Name", userLang)}: ${escapeMd(u.full_name)}\n`;
        if (u.phone) text += `${await translate("Phone", userLang)}: ${escapeMd(u.phone)}\n`;
        if (u.age) text += `${await translate("Age", userLang)}: ${u.age}\n`;
        if (u.gender) text += `${await translate("Gender", userLang)}: ${escapeMd(u.gender)}\n`;
        if (u.state) text += `${await translate("State", userLang)}: ${escapeMd(u.state)}\n`;
        if (u.occupation) text += `${await translate("Occupation", userLang)}: ${escapeMd(u.occupation)}\n`;
        if (u.monthly_income) text += `${await translate("Monthly Income", userLang)}: ₹${Number(u.monthly_income).toLocaleString('en-IN')}\n`;
        if (u.caste_category) text += `${await translate("Category", userLang)}: ${escapeMd(u.caste_category)}\n`;
        if (u.preferred_language) text += `${await translate("Language", userLang)}: ${u.preferred_language}\n`;

        const completeness = [];
        const missing = [];
        for (const [field, label] of [
          ['age', 'Age'], ['gender', 'Gender'], ['state', 'State'],
          ['occupation', 'Occupation'], ['monthly_income', 'Income'], ['caste_category', 'Category'],
        ]) {
          if (u[field]) completeness.push(label);
          else missing.push(label);
        }

        text += `\n${completeness.length}/${completeness.length + missing.length} ${await translate("profile complete", userLang)}`;
        if (missing.length) {
          text += `\n⚠️ ${await translate("Missing", userLang)}: ${missing.join(", ")}`;
          text += `\n${await translate("Complete your profile on the web app for better recommendations.", userLang)}`;
        } else {
          text += `\n✅ ${await translate("Profile complete!", userLang)}`;
        }

        return { text_response: truncate(text) };
      } catch (err) {
        console.error("[gateway] Profile error:", err.response?.data || err.message);
        return { text_response: await translate("Could not fetch profile. Please try again.", userLang) };
      }
    }

    // ── Financial roadmap ─────────────────────────────────────────────
    if (msg.intent === "financial_roadmap") {
      const dbUserId = await resolveUserId(msg.user_id, msg.channel);
      if (!dbUserId) {
        return { text_response: await translate("Please link your profile first. Type /link followed by your phone number.", userLang) };
      }

      try {
        const resp = await axios.get(`${BACKEND_URL}/api/roadmap/${dbUserId}`, { timeout: 60000 });
        const r = resp.data?.data;
        if (!r) {
          return { text_response: await translate("Could not generate roadmap. Please complete your profile on the web app first.", userLang) };
        }

        let text = `🗺️ *${await translate("Your Financial Roadmap", userLang)}*\n\n`;

        // AI summary
        if (r.ai_summary) {
          text += `💡 *${await translate("AI Advice", userLang)}:*\n${escapeMd(r.ai_summary)}\n\n`;
        }

        // Current state
        if (r.current_state) {
          text += `📊 *${await translate("Current State", userLang)}*\n`;
          text += `Income: ₹${(r.current_state.monthly_income || 0).toLocaleString('en-IN')}/mo\n`;
          text += `Expenses: ₹${(r.current_state.monthly_expenses || 0).toLocaleString('en-IN')}/mo\n`;
          text += `Savings: ₹${(r.current_state.monthly_savings || 0).toLocaleString('en-IN')}/mo\n`;
          text += `Emergency fund target: ₹${(r.current_state.emergency_fund_target || 0).toLocaleString('en-IN')}\n\n`;
        }

        // Immediate actions
        if (r.recommendations?.immediate_actions?.length) {
          text += `⚡ *${await translate("Immediate Actions (0-3 months)", userLang)}*\n`;
          for (const a of r.recommendations.immediate_actions) {
            text += `\n• *${escapeMd(await translate(a.title, userLang))}*\n`;
            if (a.description) text += `${escapeMd(await translate(a.description, userLang))}\n`;
            if (a.estimated_benefit > 0) text += `💰 ${await translate("Benefit", userLang)}: ₹${a.estimated_benefit.toLocaleString('en-IN')}\n`;
          }
          text += "\n";
        }

        // Short term
        if (r.recommendations?.short_term_plans?.length) {
          text += `📅 *${await translate("Short-term (3-12 months)", userLang)}*\n`;
          for (const a of r.recommendations.short_term_plans) {
            text += `\n• *${escapeMd(await translate(a.title, userLang))}*\n`;
            if (a.description) text += `${escapeMd(await translate(a.description, userLang))}\n`;
            if (a.link) text += `🔗 ${a.link}\n`;
          }
          text += "\n";
        }

        // Long term
        if (r.recommendations?.long_term_plans?.length) {
          text += `🎯 *${await translate("Long-term (1+ year)", userLang)}*\n`;
          for (const a of r.recommendations.long_term_plans) {
            text += `\n• *${escapeMd(await translate(a.title, userLang))}*\n`;
            if (a.description) text += `${escapeMd(await translate(a.description, userLang))}\n`;
            if (a.link) text += `🔗 ${a.link}\n`;
          }
        }

        return { text_response: truncate(text) };
      } catch (err) {
        console.error("[gateway] Roadmap error:", err.response?.data || err.message);
        if (err.response?.status === 400) {
          return { text_response: await translate("Income data required for roadmap. Please complete your profile on the web app.", userLang) };
        }
        return { text_response: await translate("Could not generate roadmap. Please try again later.", userLang) };
      }
    }

    // ── General ───────────────────────────────────────────────────────
    return { text_response: await translate("Type 1 for Schemes, 2 for Insurance, 3 for Roadmap, 4 for Document Analysis, 5 for My Profile.", userLang) };

  } catch (err) {
    console.error("[gateway] Error:", err.response?.data || err.message);
    return { text_response: await translate("Having trouble connecting. Please try again shortly.", userLang) };
  }
}
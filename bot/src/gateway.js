import axios from "axios";
import { translate, detectLanguage } from "./translate.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

export async function sendToBackend(msg) {
  try {
    // Detect user's language
    const userLang = msg.detected_language || detectLanguage(msg.raw_text || "");

    // Search schemes based on user query
    if (msg.intent === "scheme_match" || msg.intent === "general_query") {
      const query = msg.raw_text || "";
      const resp = await axios.get(`${BACKEND_URL}/api/schemes`, {
        params: { q: query, limit: 3 },
        timeout: 15000,
      });
      const schemes = resp.data?.data || [];
      if (!schemes.length) {
        const noResultMsg = await translate("No schemes found for your query. Try asking about PM Kisan, Ayushman Bharat, or PMJJBY.", userLang);
        return { text_response: noResultMsg };
      }

      const header = await translate("Government Schemes for you:", userLang);
      let text = `🌾 *${header}*\n\n`;

      for (let i = 0; i < Math.min(3, schemes.length); i++) {
        const s = schemes[i];
        const nameEn = typeof s.name === "object" ? (s.name.en || s.name.hi) : s.name;
        const descEn = typeof s.description === "object" ? (s.description.en || s.description.hi) : s.description;

        // Translate to user's language
        const name = await translate(nameEn, userLang);
        const desc = await translate((descEn || "").slice(0, 100), userLang);

        text += `${i + 1}. *${name}*\n${desc}...\n\n`;
      }
      return { text_response: text };
    }

    if (msg.intent === "insurance_recommend") {
      const resp = await axios.get(`${BACKEND_URL}/api/insurance`, {
        params: { limit: 3 },
        timeout: 15000,
      });
      const plans = resp.data?.data || [];
      if (!plans.length) {
        const noResultMsg = await translate("No insurance plans found. Try PMJJBY or PMSBY.", userLang);
        return { text_response: noResultMsg };
      }

      const header = await translate("Insurance Plans for you:", userLang);
      let text = `🛡️ *${header}*\n\n`;

      for (let i = 0; i < Math.min(3, plans.length); i++) {
        const p = plans[i];
        const nameEn = typeof p.name === "object" ? (p.name.en || p.name.hi) : p.name;
        const name = await translate(nameEn, userLang);
        text += `${i + 1}. *${name}*\n`;
      }
      return { text_response: text };
    }

    const helpMsg = await translate("I can help you with government schemes and insurance. Type *1* for schemes, *2* for insurance, or ask your question directly.", userLang);
    return { text_response: helpMsg };

  } catch (err) {
    console.error("[gateway] Backend error:", err.response?.data || err.message);
    return { text_response: "I'm having trouble connecting right now. Please try again shortly." };
  }
}

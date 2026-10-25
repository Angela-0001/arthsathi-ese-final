import twilio from "twilio";
import axios from "axios";
import FormData from "form-data";
import { sendToBackend } from "./gateway.js";
import { translate, detectLanguage } from "./translate.js";

const { twiml } = twilio;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const WEBAPP_URL  = process.env.WEBAPP_URL  || "http://localhost:3000";

// Store user language preferences (in-memory, resets on restart)
const userLanguages = new Map();

function getLanguageSelectionMessage() {
  return `🙏 नमस्ते! Welcome to ArthSathi

🌐 भाषा चुनें / Select language / भाषा निवडा:

🇮🇳 Type HI for हिंदी (Hindi)
🇬🇧 Type EN for English
🇮🇳 Type MR for मराठी (Marathi)`;
}

function getMainMenu(lang = 'hi') {
  const menus = {
    hi: `🙏 नमस्ते! ArthSathi में आपका स्वागत है

कृपया चुनें:
1️⃣ सरकारी योजनाएँ
2️⃣ बीमा पॉलिसी
3️⃣ वित्तीय रोडमैप
4️⃣ दस्तावेज़ विश्लेषण और जोखिम जांच
5️⃣ मेरा प्रोफाइल

📎 प्रोफाइल लिंक करें:
link <फ़ोन नंबर>
उदाहरण: link 9876543210

🌐 वेब ऐप: ${WEBAPP_URL}`,

    en: `🙏 Welcome to ArthSathi!

Please select:
1️⃣ Government Schemes
2️⃣ Insurance Policies
3️⃣ Financial Roadmap
4️⃣ Document Analysis & Risk Check
5️⃣ My Profile

📎 Link your profile:
link <phone number>
Example: link 9876543210

🌐 Web app: ${WEBAPP_URL}`,

    mr: `🙏 नमस्कार! ArthSathi मध्ये आपले स्वागत आहे

कृपया निवडा:
1️⃣ सरकारी योजना
2️⃣ विमा पॉलिसी
3️⃣ आर्थिक रोडमॅप
4️⃣ दस्तऐवज विश्लेषण आणि जोखीम तपासणी
5️⃣ माझा प्रोफाइल

📎 प्रोफाइल लिंक करा:
link <फोन नंबर>
उदाहरण: link 9876543210

🌐 वेब अॅप: ${WEBAPP_URL}`
  };

  return menus[lang] || menus.en;
}


export async function whatsappWebhook(req, res) {
  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;

  const text = (Body || "").trim();
  const textLower = text.toLowerCase();
  const textUpper = text.toUpperCase();
  let userLang = userLanguages.get(From);
  let replyText = "";

  try {
    // ── If no language selected yet ────────────────────────────────────
    if (!userLang) {
      if (["HI", "EN", "MR"].includes(textUpper)) {
        // Language chosen
        userLang = textUpper === "HI" ? "hi" : textUpper === "EN" ? "en" : "mr";
        userLanguages.set(From, userLang);
        replyText = getMainMenu(userLang);
        return _sendReply(res, replyText);
      }
      // Allow link command without language set
      if (textLower.startsWith("link ")) {
        userLang = "en";
      } else {
        // Everything else — ask for language first
        replyText = getLanguageSelectionMessage();
        return _sendReply(res, replyText);
      }
    }

    // ── Language already set — allow changing via HI/EN/MR ────────────
    if (["HI", "EN", "MR"].includes(textUpper) && userLang) {
      userLang = textUpper === "HI" ? "hi" : textUpper === "EN" ? "en" : "mr";
      userLanguages.set(From, userLang);
      replyText = getMainMenu(userLang);
      return _sendReply(res, replyText);
    }

    // ── Image/document sent ────────────────────────────────────────────
    if (parseInt(NumMedia) > 0 && MediaUrl0) {
      replyText = await _analyzeDocument(MediaUrl0, MediaContentType0 || "image/jpeg", userLang || 'hi');
    }

    // ── link <phone> ───────────────────────────────────────────────────
    else if (textLower.startsWith("link ")) {
      const rawPhone = text.replace(/^link\s+/i, "").replace(/\D/g, "").slice(-10);
      if (rawPhone.length < 10) {
        replyText = await translate("To link your profile, send: link 9876543210\n\nUse the same phone number you registered with on the web app.", userLang || 'hi');
      } else {
        replyText = await _linkProfile(From, rawPhone, userLang || 'hi');
      }
    }

    // ── Number shortcuts ───────────────────────────────────────────────
    else if (text === "1" && userLang) {
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "scheme_match",
        detected_language: userLang,
      });
      const fallback = await translate("No schemes found. Complete your profile on the web app first.", userLang);
      replyText = result.text_response || fallback;
    }

    else if (text === "2" && userLang) {
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "insurance_recommend",
        detected_language: userLang,
      });
      const fallback = await translate("No insurance plans found. Visit the web app to complete your profile.", userLang);
      replyText = result.text_response || fallback;
    }

    else if (text === "3" && userLang) {
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "financial_roadmap",
        detected_language: userLang,
      });
      const fallback = await translate("Could not generate roadmap. Please complete your profile first.", userLang);
      replyText = result.text_response || fallback;
    }

    else if (text === "4" && userLang) {
      replyText = await translate("Please send a photo or PDF of any document (loan agreement, insurance policy, rental deed, etc). I will explain it in plain language and flag any risky clauses.", userLang);
    }

    else if (text === "5" && userLang) {
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "profile",
        detected_language: userLang,
      });
      const fallback = await translate("Could not fetch profile. Please try again.", userLang);
      replyText = result.text_response || fallback;
    }

    // ── hi / hello / start — reset language selection ─────────────────
    else if (["hi", "hello", "start", "नमस्ते", "हेलो", "नमस्कार"].includes(textLower)) {
      userLanguages.delete(From);
      replyText = getLanguageSelectionMessage();
    }

    // ── General message ────────────────────────────────────────────────
    else {
      if (!userLang) {
        replyText = getLanguageSelectionMessage();
      } else {
        const result = await sendToBackend({
          user_id: From,
          channel: "whatsapp",
          intent: "general_query",
          raw_text: text,
          detected_language: userLang,
        });
        replyText = result.text_response || getMainMenu(userLang);
      }
    }

  } catch (err) {
    console.error("[WhatsApp] Error:", err.message);
    replyText = await translate("Sorry, something went wrong. Please try again.", userLang || 'hi');
  }

  return _sendReply(res, replyText);
}


function _sendReply(res, text) {
  const response = new twiml.MessagingResponse();
  response.message(text);
  res.type("text/xml").send(response.toString());
}


async function _analyzeDocument(mediaUrl, contentType, userLang = 'hi') {
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    const fileResp = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      auth: { username: sid, password: token },
      timeout: 30000,
    });

    const ext = contentType.includes("pdf")  ? "document.pdf"
              : contentType.includes("word") ? "document.docx"
              : "document.jpg";

    const form = new FormData();
    form.append("file", Buffer.from(fileResp.data), { filename: ext, contentType });

    const resp = await axios.post(
      `${BACKEND_URL}/api/documents/analyze?lang=${userLang}`,
      form,
      { headers: form.getHeaders(), timeout: 60000 }
    );

    const data   = resp.data;
    const flags  = data.risk_flags || [];
    const high   = flags.filter(f => (f.severity || f.risk_level) === "high").length;
    const medium = flags.filter(f => (f.severity || f.risk_level) === "medium").length;
    const low    = flags.filter(f => (f.severity || f.risk_level) === "low").length;

    const summaryHeader = await translate("Analysis Summary", userLang);
    let reply = `📋 *${summaryHeader}*\n${data.summary}\n`;
    reply += `\n🔴 High: ${high}  🟡 Medium: ${medium}  🔵 Low: ${low}\n`;

    if (flags.length > 0) {
      const clausesHeader = await translate("Detected Clauses:", userLang);
      reply += `\n*${clausesHeader}*\n`;
      for (const f of flags.slice(0, 5)) {
        const level = f.severity || f.risk_level || 'medium';
        const emoji = level === "high" ? "🔴" : level === "medium" ? "🟡" : "🔵";
        const explanation = await translate(f.explanation || f.context || '', userLang);
        reply += `\n${emoji} *${level.toUpperCase()}*\n${explanation}\n`;
      }
    } else {
      const noRisk = await translate("No risky clauses detected.", userLang);
      reply += `\n✅ ${noRisk}`;
    }

    return reply;
  } catch (err) {
    console.error("[WhatsApp] Document analysis error:", err.message);
    return await translate("Could not analyze document. Please send a clearer image or typed PDF.", userLang);
  }
}


async function _linkProfile(whatsappFrom, phone, userLang = 'hi') {
  try {
    // Try phone as-is, then with 91 prefix, then last 10 digits
    const phone10 = phone.replace(/\D/g, '').slice(-10);
    const phone91 = '91' + phone10;

    let users = [];
    for (const p of [phone10, phone91, phone]) {
      const resp = await axios.get(`${BACKEND_URL}/api/users`, {
        params: { phone: p },
        timeout: 10000,
      });
      users = resp.data?.data || [];
      if (users.length) break;
    }

    if (users.length === 0) {
      const notFound = await translate(`No account found for ${phone}. Make sure you registered on the web app with this exact number.`, userLang);
      return `❌ ${notFound}\n\n🌐 Register at: ${WEBAPP_URL}/auth`;
    }

    // Save whatsapp_number to the user's profile (strip whatsapp: prefix, fit varchar(20))
    const userId = users[0].id;
    const waNumber = whatsappFrom.replace(/^whatsapp:/i, "").slice(0, 20);
    try {
      await axios.put(`${BACKEND_URL}/api/users/${userId}`, {
        whatsapp_number: waNumber,
      }, { timeout: 10000 });
    } catch (e) {
      console.warn('[WhatsApp] Could not save whatsapp_number:', e.message);
    }

    const name = users[0].full_name ? `, ${users[0].full_name}` : '';
    const success = await translate(`Profile linked${name}! Your ArthSathi profile is now connected.`, userLang);
    const instructions = await translate("Type 1 for your personalised schemes\nType 2 for insurance recommendations\nType 3 for your financial roadmap", userLang);
    return `✅ ${success}\n\n${instructions}\n\n🌐 ${WEBAPP_URL}`;
  } catch (err) {
    console.error("[WhatsApp] Link error:", err.message);
    const error = await translate(`Could not link profile. Is the backend running?`, userLang);
    return `❌ ${error}`;
  }
}

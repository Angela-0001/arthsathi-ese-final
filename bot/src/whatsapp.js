import twilio from "twilio";
import axios from "axios";
import FormData from "form-data";
import { sendToBackend } from "./gateway.js";
import { translate, detectLanguage } from "./translate.js";

const { twiml } = twilio;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const WEBAPP_URL  = process.env.WEBAPP_URL  || "http://localhost:3000";

const WELCOME = `🙏 नमस्ते! ArthSathi में आपका स्वागत है।

Hello! I'm ArthSathi. Type:
1️⃣ *1* — Government Schemes | सरकारी योजनाएँ
2️⃣ *2* — Insurance Policies | बीमा योजनाएँ
3️⃣ *3* — Financial Roadmap | वित्तीय रोडमैप
4️⃣ *4* — Analyze a Document | दस्तावेज़ जाँच

📎 To get personalised results, type:
*link <your phone number>*
Example: link 9876543210

Or send a photo/PDF of any document to check for risky clauses.

🌐 Web app: ${WEBAPP_URL}`;


export async function whatsappWebhook(req, res) {
  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;

  const text = (Body || "").trim();
  const textLower = text.toLowerCase();
  const userLang = detectLanguage(text);
  let replyText = "";

  try {
    // ── Image/document sent ────────────────────────────────────────────
    if (parseInt(NumMedia) > 0 && MediaUrl0) {
      replyText = await _analyzeDocument(MediaUrl0, MediaContentType0 || "image/jpeg", userLang);
    }

    // ── link <phone> ───────────────────────────────────────────────────
    else if (textLower.startsWith("link ")) {
      const rawPhone = text.replace(/^link\s+/i, "").replace(/\D/g, "").slice(-10);
      if (rawPhone.length < 10) {
        replyText = await translate("To link your profile, send: link 9876543210\n\nUse the same phone number you registered with on the web app.", userLang);
      } else {
        replyText = await _linkProfile(From, rawPhone, userLang);
      }
    }

    // ── Number shortcuts ───────────────────────────────────────────────
    else if (text === "1" || textLower === "schemes" || textLower === "scheme") {
      const loading = await translate("Fetching eligible government schemes...", userLang);
      _sendReply(res, `⏳ ${loading}`);
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "scheme_match",
        detected_language: userLang,
      });
      const fallback = await translate("No schemes found. Complete your profile on the web app first.", userLang);
      return _sendReply(res, result.text_response || fallback);
    }

    else if (text === "2" || textLower === "insurance") {
      const loading = await translate("Fetching insurance recommendations...", userLang);
      _sendReply(res, `⏳ ${loading}`);
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "insurance_recommend",
        detected_language: userLang,
      });
      const fallback = await translate(`Visit the web app for insurance: ${WEBAPP_URL}/insurance`, userLang);
      return _sendReply(res, result.text_response || fallback);
    }

    else if (text === "3" || textLower === "roadmap") {
      const loading = await translate("Building your financial roadmap...", userLang);
      _sendReply(res, `⏳ ${loading}`);
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "financial_roadmap",
        detected_language: userLang,
      });
      const fallback = await translate("Could not generate roadmap. Please complete your profile first.", userLang);
      return _sendReply(res, result.text_response || fallback);
    }

    else if (text === "4" || textLower === "document") {
      replyText = await translate("Please send a photo or PDF of the document you want to analyze.", userLang);
      replyText += "\nकृपया अपने दस्तावेज़ की फ़ोटो भेजें।";
    }

    // ── hi / hello / start ─────────────────────────────────────────────
    else if (["hi", "hello", "start", "नमस्ते", "हेलो"].includes(textLower)) {
      replyText = WELCOME;
    }

    // ── General message ────────────────────────────────────────────────
    else {
      const result = await sendToBackend({
        user_id: From,
        channel: "whatsapp",
        intent: "general_query",
        raw_text: text,
        detected_language: userLang,
      });
      replyText = result.text_response || WELCOME;
    }

  } catch (err) {
    console.error("[WhatsApp] Error:", err.message);
    replyText = await translate("Sorry, something went wrong. Please try again.", userLang);
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
    // Check if user exists with this phone
    const resp = await axios.get(`${BACKEND_URL}/api/users`, {
      params: { phone },
      timeout: 10000,
    });

    const users = resp.data?.data || [];
    if (users.length === 0) {
      const notFound = await translate(`No account found for ${phone}. Make sure you registered on the web app with this exact number.`, userLang);
      return `❌ ${notFound}\n\n🌐 Register at: ${WEBAPP_URL}/auth`;
    }

    const success = await translate("Profile linked! Your ArthSathi profile is now connected.", userLang);
    const instructions = await translate("Type *1* for your personalised schemes\nType *2* for insurance recommendations\nType *3* for your financial roadmap", userLang);
    return `✅ ${success}\n\n${instructions}\n\n🌐 ${WEBAPP_URL}`;
  } catch (err) {
    console.error("[WhatsApp] Link error:", err.message);
    const error = await translate(`Could not link profile. Try again or visit ${WEBAPP_URL}/auth`, userLang);
    return `❌ ${error}`;
  }
}

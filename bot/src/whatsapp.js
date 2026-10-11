import twilio from "twilio";
import axios from "axios";
import FormData from "form-data";

const { twiml } = twilio;
const WEBAPP_URL = process.env.WEBAPP_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

export async function whatsappWebhook(req, res) {
  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;

  const text = (Body || "").trim().toLowerCase();
  let replyText = "";

  try {
    // Image/document sent
    if (parseInt(NumMedia) > 0 && MediaUrl0) {
      replyText = await _analyzeDocument(MediaUrl0, MediaContentType0 || "image/jpeg");
    }
    // Link profile: "link 9876543210"
    else if (text.startsWith("link ")) {
      const rawPhone = Body.trim().replace(/^link\s+/i, "");
      const phone = rawPhone.replace(/\D/g, "").slice(-10); // last 10 digits
      replyText = await _linkProfile(From, phone);
    }
    // Text commands
    else if (text === "1" || text === "schemes") {
      replyText = await _callBackend(From, "scheme_match", "", "hi");
    }
    else if (text === "2" || text === "insurance") {
      replyText = await _callBackend(From, "insurance_recommend", "", "hi");
    }
    else if (text === "3" || text === "roadmap") {
      replyText = await _callBackend(From, "financial_roadmap", "", "hi");
    }
    else if (text === "4" || text === "document") {
      replyText = "📸 Please send a photo or PDF of your document and I will analyze it for risky clauses.\nकृपया अपने दस्तावेज़ की फ़ोटो भेजें।";
    }
    else if (text === "5" || text === "summary") {
      replyText = await _getLatestSummary();
    }
    else {
      // General message or unknown
      replyText = await _callBackend(From, "general_query", Body || "", "hi");
    }
  } catch (err) {
    console.error("[WhatsApp] Error:", err.message);
    replyText = "क्षमा करें, कुछ गलत हुआ। Sorry, something went wrong. Please try again.";
  }

  const response = new twiml.MessagingResponse();
  response.message(replyText);
  res.type("text/xml").send(response.toString());
}


async function _analyzeDocument(mediaUrl, contentType) {
  try {
    // Download from Twilio (needs auth)
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    const fileResp = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      auth: { username: sid, password: token },
      timeout: 30000,
    });

    const ext = contentType.includes("pdf") ? "document.pdf"
              : contentType.includes("word") ? "document.docx"
              : "document.jpg";

    const form = new FormData();
    form.append("file", Buffer.from(fileResp.data), { filename: ext, contentType });

    const resp = await axios.post(
      `${BACKEND_URL}/api/documents/analyze?lang=en`,
      form,
      { headers: form.getHeaders(), timeout: 60000 }
    );

    const data  = resp.data;
    const flags = data.risk_flags || [];
    const high   = flags.filter(f => f.risk_level === "high").length;
    const medium = flags.filter(f => f.risk_level === "medium").length;

    let reply = `📋 Document Analysis\n\n${data.summary}\n\n`;

    if (flags.length > 0) {
      reply += `🔴 ${high} High  🟡 ${medium} Medium\n\nRisk Clauses:\n`;
      flags.slice(0, 5).forEach(f => {
        const emoji = f.risk_level === "high" ? "🔴" : f.risk_level === "medium" ? "🟡" : "🔵";
        reply += `${emoji} ${f.explanation}\n`;
      });
      reply += "\nReply *4* for full summary anytime.";
    } else {
      reply += "✅ No risky clauses detected.";
    }

    return reply;
  } catch (err) {
    console.error("[WhatsApp] Document analysis error:", err.message);
    return "❌ Could not analyze document. Please send a clearer image or typed PDF.";
  }
}


async function _getLatestSummary() {
  try {
    const resp = await axios.get(`${BACKEND_URL}/api/documents/summary/latest`, { timeout: 10000 });
    const data = resp.data;

    if (data.message) return "📭 " + data.message;

    const flags  = data.risk_flags || [];
    const high   = flags.filter(f => f.risk_level === "high").length;
    const medium = flags.filter(f => f.risk_level === "medium").length;

    let reply = `📋 Last Document Summary\n\n${data.summary}\n\n`;
    reply += `🔴 High: ${high}  🟡 Medium: ${medium}\n`;
    if (flags.length > 0) {
      reply += "\nKey Risks:\n";
      flags.slice(0, 3).forEach(f => {
        reply += `• ${f.explanation}\n`;
      });
    }
    return reply;
  } catch {
    return "Could not fetch summary. Send a document first.";
  }
}


async function _callBackend(userId, intent, rawText, lang) {
  try {
    const resp = await axios.post(
      `${BACKEND_URL}/api/gateway/message`,
      { user_id: userId, channel: "whatsapp", intent, raw_text: rawText || null, detected_language: lang },
      { timeout: 15000 }
    );
    return resp.data.text_response || "Sorry, something went wrong.";
  } catch {
    return "क्षमा करें, सेवा अभी उपलब्ध नहीं है।\nSorry, service unavailable. Try again.";
  }
}


async function _linkProfile(whatsappFrom, phone) {
  try {
    await axios.post(`${BACKEND_URL}/api/auth/link-telegram`, {
      phone,
      whatsapp_number: whatsappFrom,
    }, { timeout: 10000 });
    return `✅ Profile linked! Your ArthSathi profile is now connected.\n\nType *1* for your personalised schemes\nType *2* for your financial roadmap\n\n🌐 ${WEBAPP_URL}`;
  } catch (err) {
    const msg = err.response?.data?.detail || "Could not link profile.";
    return `❌ ${msg}\n\nMake sure you registered on the web app with this number first.`;
  }
}

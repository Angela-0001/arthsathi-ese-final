import axios from "axios";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

const tokenStore = new Map(); // user_id → jwt token

export async function sendToBackend(msg) {
  try {
    const token = tokenStore.get(msg.user_id);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const resp = await axios.post(`${BACKEND_URL}/api/gateway/message`, msg, {
      headers,
      timeout: 30000,
    });
    return resp.data;
  } catch (err) {
    console.error("[gateway] Backend error:", err.response?.data || err.message);
    return { text_response: "I'm having trouble connecting right now. Please try again shortly." };
  }
}

export function storeToken(userId, token) {
  tokenStore.set(userId, token);
}

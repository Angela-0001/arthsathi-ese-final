# -*- coding: utf-8 -*-
"""ArthSathi OCR + Risk Analysis Pipeline"""
import os, sys, re, json, logging, argparse
from pathlib import Path

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import cv2, numpy as np
from PIL import Image
import pytesseract

log = logging.getLogger("ocr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

TESSERACT_CMD = os.getenv("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
if os.path.exists(TESSERACT_CMD):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

OLLAMA_HOST  = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# ---------------------------------------------------------------------------
# Direct text extraction (docx / pdf / txt) � no OCR needed
# ---------------------------------------------------------------------------
def extract_text_from_file(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in (".docx", ".doc"):
        try:
            import docx as python_docx
            doc = python_docx.Document(file_path)
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            log.warning(f"docx extraction failed: {e}")
    if ext == ".pdf":
        try:
            import pdfplumber
            parts = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t: parts.append(t)
            return "\n".join(parts)
        except Exception as e:
            log.warning(f"PDF extraction failed: {e}")
    if ext == ".txt":
        try:
            return Path(file_path).read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass
    return ""

# ---------------------------------------------------------------------------
# Image pre-processing
# ---------------------------------------------------------------------------
def preprocess_image(image_path: str) -> np.ndarray:
    img = cv2.imread(image_path)
    if img is None:
        pil_img = Image.open(image_path).convert("RGB")
        img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    if max(h, w) < 1200:
        scale = 1200 / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)
    return cv2.fastNlMeansDenoising(binary, h=10)

# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------
def run_ocr(processed_img: np.ndarray, lang: str = "en") -> dict:
    lang_map = {"hi": "hin", "mr": "mar", "ta": "tam", "te": "tel", "bn": "ben", "en": "eng"}
    tess_lang = "+".join(lang_map.get(l, l) for l in lang.split("+"))
    try:
        data = pytesseract.image_to_data(processed_img, lang=tess_lang,
               output_type=pytesseract.Output.DICT, config="--oem 3 --psm 6")
    except Exception as e:
        log.warning(f"OCR lang={tess_lang} failed, falling back to eng: {e}")
        data = pytesseract.image_to_data(processed_img, lang="eng",
               output_type=pytesseract.Output.DICT, config="--oem 3 --psm 6")
    words, confidences = [], []
    for i, word in enumerate(data["text"]):
        conf = data["conf"][i]
        if conf > 0 and word.strip():
            words.append(word.strip())
            confidences.append(conf)
    text = " ".join(words)
    avg_conf = float(np.mean(confidences)) if confidences else 0.0
    return {"text": text, "confidence": round(avg_conf, 1), "word_count": len(words)}

# ---------------------------------------------------------------------------
# Risk detection
# ---------------------------------------------------------------------------

def detect_risks_with_groq(text: str, language: str = "en") -> list:
    """Use Groq to identify actual financial/legal risks in the document contextually.
    Returns a list of risk flags, or None if Groq is unavailable/fails."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key or len(text.strip().split()) < 10:
        return None
    try:
        import urllib.request
        prompt = (
            "You are a financial document risk analyzer. Analyze the following document text and identify "
            "ONLY genuine financial or legal risks that could harm the signer/party. "
            "Only flag risks that are ACTUALLY PRESENT in the text � do not invent or assume risks. "
            "If this is not a financial/legal agreement (e.g. a resume, letter, essay), return an empty list. "
            "Return ONLY a JSON array. Each element: "
            '{"risk_type": "short_name", "severity": "high|medium|low", '
            '"explanation": "one sentence explanation", "context": "exact quote from document"}. '
            "Maximum 5 flags. If no risks, return [].\n\n"
            f"Document text:\n{text[:3000]}\n\nJSON array:"
        )
        payload = json.dumps({
            "model": "openai/gpt-oss-120b",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 500,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            content = data["choices"][0]["message"]["content"].strip()
            # Extract JSON array from response
            start = content.find("[")
            end   = content.rfind("]")
            if start == -1 or end == -1:
                return []
            flags = json.loads(content[start:end+1])
            # Validate structure
            valid = []
            for f in flags:
                if isinstance(f, dict) and "risk_type" in f and "explanation" in f:
                    f.setdefault("severity", "medium")
                    f.setdefault("context", "")
                    if f["severity"] not in ("high", "medium", "low"):
                        f["severity"] = "medium"
                    valid.append(f)
            return valid
    except Exception as e:
        log.warning(f"Groq risk detection failed: {e}")
        return None

# Stricter patterns � require multi-word financial context, not single common words
RISK_PATTERNS = [
    {"pattern": r"transfer\s+(?:of\s+)?ownership|transfer\s+(?:of\s+)?title|vest\s+(?:the\s+)?property",
     "risk_type": "ownership_transfer", "severity": "high",
     "explanation": "This clause transfers ownership or property rights. Understand exactly what you are giving up before signing."},
    {"pattern": r"penalty\s+(?:clause|charge|fee|for|of)|forfeit\s+(?:the\s+)?deposit|liquidated\s+damages|penalty\s+for\s+(?:late|default|breach)",
     "risk_type": "penalty_clause", "severity": "high",
     "explanation": "This document contains penalty terms. You may be required to pay money if conditions are not met."},
    {"pattern": r"irrevocable|non[- ]refundable|no\s+cooling[- ]off\s+period|cannot\s+be\s+cancelled|final\s+and\s+binding",
     "risk_type": "no_cooling_off", "severity": "high",
     "explanation": "This agreement may be irrevocable. You may not be able to cancel or get a refund after signing."},
    {"pattern": r"auto\s*(?:renew|renewal)|automatic\s+renewal|deemed\s+renewal|auto[- ]renew",
     "risk_type": "auto_renewal", "severity": "medium",
     "explanation": "This agreement automatically renews unless you take action. You may be charged again without notice."},
    {"pattern": r"amount\s+(?:as|to be)\s+(?:determined|filled|decided)|to\s+be\s+decided|TBD|blank\s+space",
     "risk_type": "blank_amount", "severity": "high",
     "explanation": "Amount or key terms are left blank. Do not sign until all amounts are filled in."},
    {"pattern": r"interest\s+rate\s*(?:of)?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:per\s+annum|p\.?a\.|interest)",
     "risk_type": "interest_rate", "severity": "medium",
     "explanation": "This document specifies an interest rate. Verify it is reasonable before agreeing."},
    {"pattern": r"pledge.{0,15}(?:as\s+)?collateral|hypothecat\w+|mortgage.{0,15}(?:the\s+)?property|lien\s+on|encumber\w+\s+(?:the\s+)?property|collateral\s+security",
     "risk_type": "collateral", "severity": "high",
     "explanation": "You are pledging property as collateral. You could lose this property if you default."},
    {"pattern": r"power\s+of\s+attorney|authoriz\w+\s+(?:to\s+)?act\s+on\s+(?:my|your|his|her)\s+behalf",
     "risk_type": "power_of_attorney", "severity": "high",
     "explanation": "This grants someone else authority to act on your behalf. This is a serious legal right."},
    {"pattern": r"binding\s+arbitration|waive\s+(?:the\s+)?right\s+to\s+sue|no\s+right\s+to\s+(?:sue|go\s+to\s+court)",
     "risk_type": "arbitration_clause", "severity": "medium",
     "explanation": "Disputes must go to arbitration, not court. This may limit your legal rights."},
    {"pattern": r"(?:agricultural\s+land|farm\s+land).{0,20}(?:pledge|mortgage|collateral|security|hypothecat)",
     "risk_type": "farm_land_pledge", "severity": "high",
     "explanation": "Your farming land is being used as security. You could lose your land if you cannot repay."},
    {"pattern": r"terminate.{0,20}without\s+(?:cause|notice)|terminate\s+at\s+will|notice\s+period\s+of\s+\d+\s+days",
     "risk_type": "termination_clause", "severity": "medium",
     "explanation": "This document contains termination terms. Check the notice period and conditions."},
    {"pattern": r"waive\s+(?:my|your|the|any)\s+right|waiver\s+of\s+claim|surrender\s+(?:my|your|the)\s+right",
     "risk_type": "rights_waiver", "severity": "high",
     "explanation": "You may be giving up important legal rights. Read this carefully before signing."},
    {"pattern": r"personal\s+guarantee|personal\s+liability|acting\s+as\s+guarantor",
     "risk_type": "personal_guarantee", "severity": "high",
     "explanation": "You are personally guaranteeing this agreement. Your personal assets may be at risk."},
    {"pattern": r"non[- ]disclosure\s+agreement|shall\s+not\s+disclose|confidentiality\s+obligation",
     "risk_type": "confidentiality", "severity": "medium",
     "explanation": "This document contains confidentiality obligations. Breaching this may result in legal action."},
]

def detect_risk_clauses(text: str) -> list:
    flags = []
    text_lower = text.lower()
    for rp in RISK_PATTERNS:
        match = re.search(rp["pattern"], text_lower, re.IGNORECASE)
        if match:
            start = max(0, match.start() - 80)
            end   = min(len(text), match.end() + 80)
            flags.append({
                "risk_type":   rp["risk_type"],
                "severity":    rp["severity"],
                "explanation": rp["explanation"],
                "context":     text[start:end].strip(),
            })
    return flags

def overall_risk_level(flags: list) -> str:
    if any(f["severity"] == "high" for f in flags): return "high"
    if any(f["severity"] == "medium" for f in flags): return "medium"
    return "low"

# ---------------------------------------------------------------------------
# Summarization
# ---------------------------------------------------------------------------
def summarize_with_groq(text: str, language: str = "en") -> str:
    """Use Groq API for summarization � much faster and no local install needed."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        return None
    try:
        import urllib.request, urllib.error
        lang_names = {"hi": "Hindi", "mr": "Marathi", "en": "English"}
        lang_name = lang_names.get(language, "English")
        prompt = (
            f"Summarize this document in simple {lang_name} for a rural Indian user. "
            f"Use 3-5 bullet points. If it is a financial or legal agreement, highlight any risks or important clauses. "
            f"If it is not a financial/legal document, just summarize what it says.\n\n"
            f"Document:\n{text[:3000]}\n\nSummary in {lang_name}:"
        )
        payload = json.dumps({
            "model": "openai/gpt-oss-120b",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 400,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        log.warning(f"Groq summarization failed: {e}")
        return None

def answer_question_ollama(text: str, question: str, language: str = "en") -> str:
    """Use Groq to answer a question about a document."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        return None
    try:
        import urllib.request
        lang_names = {"hi": "Hindi", "mr": "Marathi", "en": "English"}
        lang_name = lang_names.get(language, "English")
        prompt = (
            f"Based on this document, answer the following question in {lang_name}. "
            f"Be concise and factual.\n\nDocument:\n{text[:2000]}\n\nQuestion: {question}\n\nAnswer in {lang_name}:"
        )
        payload = json.dumps({
            "model": "openai/gpt-oss-120b",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 200,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        log.warning(f"Groq Q&A failed: {e}")
        return None

def summarize_rule_based(text: str, risk_flags: list) -> str:
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    doc_type = "Document"
    tl = text.lower()
    if any(w in tl for w in ["loan agreement", "borrower", "promissory"]): doc_type = "Loan Agreement"
    elif any(w in tl for w in ["sale deed", "conveyance", "sell and transfer"]): doc_type = "Sale Deed"
    elif any(w in tl for w in ["rent agreement", "tenant", "landlord", "lessee"]): doc_type = "Rental Agreement"
    elif any(w in tl for w in ["insurance", "policy", "premium", "insured"]): doc_type = "Insurance Policy"
    elif any(w in tl for w in ["employment", "appointment", "salary", "designation"]): doc_type = "Employment Document"
    amounts = re.findall(r"(?:rs\.?|[?]|inr)\s*([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
    dates   = re.findall(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", text)
    rates   = re.findall(r"(\d+(?:\.\d+)?)\s*%\s*(?:per annum|p\.?a\.?|interest|rate)", text, re.IGNORECASE)
    parts = [f"Document Type: {doc_type}", ""]
    if amounts: parts.append(f"Amounts: {', '.join(['Rs.' + a for a in amounts[:4]])}")
    if dates:   parts.append(f"Dates: {', '.join(dates[:3])}")
    if rates:   parts.append(f"Interest Rate: {rates[0]}% per year")
    if risk_flags:
        parts += ["", "IMPORTANT - Check these clauses:"]
        for f in risk_flags: parts.append(f"  - {f['explanation']}")
    parts.append("\nThis is an automated summary. Consult a legal expert for important decisions.")
    return "\n".join(parts)

# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def process_document(image_path: str, language: str = "en", question: str = None) -> dict:
    result = {"success": False, "raw_text": "", "confidence": 0.0, "word_count": 0,
              "summary": "", "risk_flags": [], "risk_level": "low", "error": None}
    try:
        # 1. Try direct text extraction first (docx, pdf, txt)
        direct_text = extract_text_from_file(image_path)
        if direct_text and len(direct_text.split()) >= 5:
            log.info(f"Direct text extraction: {len(direct_text.split())} words")
            result["raw_text"]   = direct_text
            result["confidence"] = 100.0
            result["word_count"] = len(direct_text.split())
        else:
            # 2. Image OCR
            log.info(f"OCR processing: {image_path}")
            processed  = preprocess_image(image_path)
            ocr_result = run_ocr(processed, lang=language)
            result["raw_text"]   = ocr_result["text"]
            result["confidence"] = ocr_result["confidence"]
            result["word_count"] = ocr_result["word_count"]

            # Quality gate: reject low-confidence OCR
            if ocr_result["word_count"] < 10 or ocr_result["confidence"] < 50:
                result["error"]   = "Image quality too low. Please provide a clearer photo with better lighting."
                result["summary"] = result["error"]
                result["risk_flags"] = []
                result["risk_level"] = "unknown"
                result["success"] = True
                return result

        # 3. Risk detection � try Groq (contextual) first, fall back to regex
        groq_flags = detect_risks_with_groq(result["raw_text"], language)
        if groq_flags is not None:
            log.info(f"Groq risk detection: {len(groq_flags)} flags")
            risk_flags = groq_flags
        else:
            risk_flags = detect_risk_clauses(result["raw_text"])
        result["risk_flags"] = risk_flags
        result["risk_level"] = overall_risk_level(risk_flags)

        # 4. Summarize � try Groq first, fall back to rule-based
        llm_summary = summarize_with_groq(result["raw_text"], language)
        result["summary"] = llm_summary if llm_summary else summarize_rule_based(result["raw_text"], risk_flags)

        result["success"] = True
    except Exception as e:
        log.error(f"Pipeline error: {e}")
        result["error"]   = str(e)
        result["summary"] = f"Error: {e}"
    return result

def answer_question_rule_based(text: str, question: str) -> str:
    keywords  = [w for w in question.lower().split() if len(w) > 3]
    sentences = re.split(r"[.!?]", text)
    matching  = [s.strip() for s in sentences if any(kw in s.lower() for kw in keywords)]
    return ("Based on the document: " + " ".join(matching[:2])) if matching else "The document does not clearly address this question."

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image",    required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--question", default=None)
    args   = parser.parse_args()
    result = process_document(args.image, args.language, args.question)
    print(json.dumps(result, ensure_ascii=False, indent=2))

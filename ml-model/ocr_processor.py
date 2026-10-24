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
# Direct text extraction (docx / pdf / txt) — no OCR needed
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
RISK_PATTERNS = [
    {"pattern": r"ownership.{0,30}transfer|transfer.{0,20}ownership|property.{0,20}vest|title.{0,20}transfer",
     "risk_type": "ownership_transfer", "severity": "high",
     "explanation": "This clause transfers ownership or property rights. Understand exactly what you are giving up before signing."},
    {"pattern": r"penalty|forfeiture|forfeit|liquidated damage|compensation.{0,20}breach|damages.{0,20}default",
     "risk_type": "penalty_clause", "severity": "high",
     "explanation": "This document contains penalty terms. You may be required to pay money if conditions are not met."},
    {"pattern": r"irrevocable|non.?refundable|no.{0,10}cooling.off|cannot.{0,10}cancel|final.{0,10}binding",
     "risk_type": "no_cooling_off", "severity": "high",
     "explanation": "This agreement may be irrevocable. You may not be able to cancel or get a refund after signing."},
    {"pattern": r"auto.{0,10}renew|automatic.{0,10}renewal|deemed.{0,10}renew|rollover",
     "risk_type": "auto_renewal", "severity": "medium",
     "explanation": "This agreement automatically renews unless you take action. You may be charged again without notice."},
    {"pattern": r"amount.{0,20}as.{0,20}determined|amount.{0,20}to.{0,20}be.{0,20}filled|TBD|to be decided",
     "risk_type": "blank_amount", "severity": "high",
     "explanation": "Amount or key terms are left blank. Do not sign until all amounts are filled in."},
    {"pattern": r"(?:interest|rate).{0,20}(?:\d+(?:\.\d+)?)\s*%",
     "risk_type": "interest_rate", "severity": "medium",
     "explanation": "This document specifies an interest rate. Verify it is reasonable before agreeing."},
    {"pattern": r"collateral|pledge|hypothecat|mortgage|lien|encumber|charge.{0,20}property|security.{0,20}interest",
     "risk_type": "collateral", "severity": "high",
     "explanation": "You are pledging property as collateral. You could lose this property if you default."},
    {"pattern": r"power.{0,10}of.{0,10}attorney|authorise.{0,20}to.{0,20}act|act.{0,20}on.{0,20}behalf",
     "risk_type": "power_of_attorney", "severity": "high",
     "explanation": "This grants someone else authority to act on your behalf. This is a serious legal right."},
    {"pattern": r"arbitration.{0,30}binding|waive.{0,20}right.{0,20}court|no.{0,20}right.{0,20}sue",
     "risk_type": "arbitration_clause", "severity": "medium",
     "explanation": "Disputes must go to arbitration, not court. This may limit your legal rights."},
    {"pattern": r"agricultural.{0,20}land.{0,20}(?:pledge|mortgage|collateral|security)|farm.{0,20}(?:pledge|mortgage)",
     "risk_type": "farm_land_pledge", "severity": "high",
     "explanation": "Your farming land is being used as security. You could lose your land if you cannot repay."},
    {"pattern": r"termination.{0,30}without.{0,10}cause|terminate.{0,20}at.{0,20}will|notice.{0,20}period.{0,20}\d+.{0,10}day",
     "risk_type": "termination_clause", "severity": "medium",
     "explanation": "This document contains termination terms. Check the notice period and conditions."},
    {"pattern": r"waive.{0,20}right|waiver.{0,20}claim|surrender.{0,20}right",
     "risk_type": "rights_waiver", "severity": "high",
     "explanation": "You may be giving up important legal rights. Read this carefully before signing."},
    {"pattern": r"personal.{0,10}guarantee|personal.{0,10}liability|guarantor",
     "risk_type": "personal_guarantee", "severity": "high",
     "explanation": "You are personally guaranteeing this agreement. Your personal assets may be at risk."},
    {"pattern": r"confidential|non.?disclosure|NDA|shall not disclose",
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
    """Use Groq API for summarization — much faster and no local install needed."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        return None
    try:
        import urllib.request, urllib.error
        lang_names = {"hi": "Hindi", "mr": "Marathi", "en": "English"}
        lang_name = lang_names.get(language, "English")
        prompt = (
            f"Summarize this legal/financial document in simple {lang_name} for a rural Indian user. "
            f"Use 3-5 bullet points. Highlight any risks or important clauses.\n\n"
            f"Document:\n{text[:3000]}\n\nSummary in {lang_name}:"
        )
        payload = json.dumps({
            "model": "llama-3.3-70b-versatile",
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
            "model": "llama-3.3-70b-versatile",
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
            if ocr_result["word_count"] < 5:
                result["error"]   = "Very little text extracted. Retake photo with better lighting."
                result["summary"] = result["error"]
                result["success"] = True
                return result

        # 3. Risk detection
        risk_flags = detect_risk_clauses(result["raw_text"])
        result["risk_flags"] = risk_flags
        result["risk_level"] = overall_risk_level(risk_flags)

        # 4. Summarize — try Groq first, fall back to rule-based
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
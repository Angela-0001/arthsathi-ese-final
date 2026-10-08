"""
ArthSathi — OCR + Document Summarization Pipeline
===================================================

Accepts a local image path via command-line, runs:
  1. Image pre-processing (deskew, contrast, noise reduction)
  2. Tesseract OCR with confidence scoring
  3. Local LLM summarization via Ollama (falls back to rule-based if unavailable)
  4. Risk clause detection

Outputs JSON to stdout for consumption by the Express backend.

USAGE
-----
  python ocr_processor.py --image /path/to/doc.jpg [--language hin] [--question "What is the penalty?"]

SUPPORTED LANGUAGES
-------------------
  hin = Hindi, mar = Marathi, tam = Tamil, tel = Telugu, ben = Bengali, eng = English
  Combines multiple with +, e.g. "hin+eng"
"""

import os
import sys
import re
import json
import base64
import logging
import argparse
import subprocess
import tempfile
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import cv2
import numpy as np
from PIL import Image

# pytesseract — wraps Tesseract binary
import pytesseract

log = logging.getLogger("ocr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Tesseract path
# ---------------------------------------------------------------------------
TESSERACT_CMD = os.getenv("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
if os.path.exists(TESSERACT_CMD):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

# Ollama config
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# ---------------------------------------------------------------------------
# Image pre-processing
# ---------------------------------------------------------------------------

def preprocess_image(image_path: str) -> np.ndarray:
    """
    Pre-process a photographed document image to improve OCR accuracy.

    Steps:
    1. Load and convert to grayscale
    2. Deskew (detect and correct rotation up to ±45°)
    3. Adaptive thresholding (handles uneven lighting from phone camera)
    4. Mild denoising (removes phone camera sensor noise)
    5. Resize to 300 DPI equivalent if too small

    Returns an OpenCV image array ready for pytesseract.
    """
    # Load image
    img = cv2.imread(image_path)
    if img is None:
        # Try PIL for non-standard formats
        pil_img = Image.open(image_path).convert("RGB")
        img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    # Ensure minimum resolution for OCR (300 DPI equivalent on A4)
    h, w = img.shape[:2]
    min_dim = 1200
    if max(h, w) < min_dim:
        scale = min_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Deskew: detect rotation angle using Hough line transform
    gray = deskew(gray)

    # Adaptive thresholding — handles shadows and uneven lighting
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 10
    )

    # Mild denoising
    denoised = cv2.fastNlMeansDenoising(binary, h=10)

    return denoised


def deskew(gray_img: np.ndarray) -> np.ndarray:
    """Detect and correct document skew angle."""
    try:
        # Detect edges
        edges = cv2.Canny(gray_img, 50, 150, apertureSize=3)

        # Hough line transform
        lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=100)
        if lines is None or len(lines) < 5:
            return gray_img  # Can't determine angle confidently

        # Collect angles
        angles = []
        for line in lines[:50]:  # use top 50 lines
            rho, theta = line[0]
            angle = np.degrees(theta) - 90
            if abs(angle) < 45:  # Only correct small rotations
                angles.append(angle)

        if not angles:
            return gray_img

        median_angle = float(np.median(angles))
        if abs(median_angle) < 0.5:
            return gray_img  # Negligible skew

        log.info(f"Deskewing by {median_angle:.1f}°")
        h, w = gray_img.shape
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
        rotated = cv2.warpAffine(gray_img, M, (w, h), flags=cv2.INTER_CUBIC,
                                  borderMode=cv2.BORDER_REPLICATE)
        return rotated

    except Exception as e:
        log.warning(f"Deskew failed: {e}")
        return gray_img

# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------

def run_ocr(processed_img: np.ndarray, lang: str = "eng+hin") -> dict:
    """
    Run Tesseract OCR on the pre-processed image.

    Returns:
      {
        "text": str,          # full extracted text
        "confidence": float,  # average word confidence 0–100
        "word_count": int
      }
    """
    # Tesseract language mapping
    lang_map = {"hi": "hin", "mr": "mar", "ta": "tam", "te": "tel", "bn": "ben", "en": "eng"}
    tess_lang = "+".join(lang_map.get(l, l) for l in lang.split("+"))

    # Get text with confidence data
    try:
        data = pytesseract.image_to_data(
            processed_img,
            lang=tess_lang,
            output_type=pytesseract.Output.DICT,
            config="--oem 3 --psm 6"  # LSTM + uniform block assumption
        )
    except Exception as e:
        log.warning(f"OCR with lang={tess_lang} failed, falling back to eng: {e}")
        data = pytesseract.image_to_data(
            processed_img,
            lang="eng",
            output_type=pytesseract.Output.DICT,
            config="--oem 3 --psm 6"
        )

    words = []
    confidences = []
    for i, word in enumerate(data["text"]):
        conf = data["conf"][i]
        if conf > 0 and word.strip():
            words.append(word.strip())
            confidences.append(conf)

    text = " ".join(words)
    avg_confidence = float(np.mean(confidences)) if confidences else 0.0

    return {
        "text": text,
        "confidence": round(avg_confidence, 1),
        "word_count": len(words)
    }

# ---------------------------------------------------------------------------
# Risk clause detection (rule-based, works fully offline)
# ---------------------------------------------------------------------------

RISK_PATTERNS = [
    # Ownership / property transfer
    {"pattern": r"ownership.{0,30}transfer|transfer.{0,20}ownership|property.{0,20}vest|title.{0,20}transfer",
     "risk_type": "ownership_transfer",
     "severity": "high",
     "explanation": "This clause transfers ownership or property rights. Understand exactly what you are giving up before signing."},

    # Penalty / forfeiture
    {"pattern": r"penalty|forfeiture|forfeit|liquidated damage|compensation.{0,20}breach|damages.{0,20}default",
     "risk_type": "penalty_clause",
     "severity": "high",
     "explanation": "This document contains penalty terms. You may be required to pay money if conditions are not met."},

    # No cooling-off / irrevocable
    {"pattern": r"irrevocable|non.?refundable|no.{0,10}cooling.off|cannot.{0,10}cancel|final.{0,10}binding",
     "risk_type": "no_cooling_off",
     "severity": "high",
     "explanation": "This agreement may be irrevocable. You may not be able to cancel or get a refund after signing."},

    # Automatic renewal
    {"pattern": r"auto.{0,10}renew|automatic.{0,10}renewal|deemed.{0,10}renew|rollover",
     "risk_type": "auto_renewal",
     "severity": "medium",
     "explanation": "This agreement automatically renews unless you take action. You may be charged again without notice."},

    # Blank / variable amounts
    {"pattern": r"amount.{0,20}as.{0,20}determined|amount.{0,20}to.{0,20}be.{0,20}filled|TBD|to be decided",
     "risk_type": "blank_amount",
     "severity": "high",
     "explanation": "Amount or key terms are left blank or to be decided later. Do not sign until all amounts are filled in."},

    # Unusual interest rate
    {"pattern": r"(?:interest|rate).{0,20}(?:\d+(?:\.\d+)?)\s*%",
     "risk_type": "interest_rate",
     "severity": "medium",
     "explanation": "This document specifies an interest rate. Verify it is reasonable before agreeing."},

    # Collateral / pledge
    {"pattern": r"collateral|pledge|hypothecat|mortgage|lien|encumber|charge.{0,20}property|security.{0,20}interest",
     "risk_type": "collateral",
     "severity": "high",
     "explanation": "You are pledging property as collateral. You could lose this property if you default on obligations."},

    # Power of attorney
    {"pattern": r"power.{0,10}of.{0,10}attorney|authorise.{0,20}to.{0,20}act|act.{0,20}on.{0,20}behalf|attorney.{0,10}in.{0,10}fact",
     "risk_type": "power_of_attorney",
     "severity": "high",
     "explanation": "This grants someone else authority to act on your behalf. This is a serious legal right — be sure you trust the person."},

    # Arbitration / no court access
    {"pattern": r"arbitration.{0,30}binding|waive.{0,20}right.{0,20}court|no.{0,20}right.{0,20}sue|dispute.{0,20}arbitration",
     "risk_type": "arbitration_clause",
     "severity": "medium",
     "explanation": "Disputes must go to arbitration, not court. This may limit your legal rights."},

    # Land / farm pledged
    {"pattern": r"agricultural.{0,20}land.{0,20}(?:pledge|mortgage|collateral|security)|farm.{0,20}(?:pledge|mortgage)|khet.{0,20}girvee",
     "risk_type": "farm_land_pledge",
     "severity": "high",
     "explanation": "Your farming land is being used as security. You could lose your land if you cannot repay."},
]

def detect_risk_clauses(text: str) -> list:
    """
    Scan extracted OCR text for risky contract clauses.
    Returns a list of detected risk flags.
    """
    flags = []
    text_lower = text.lower()

    for rp in RISK_PATTERNS:
        match = re.search(rp["pattern"], text_lower, re.IGNORECASE)
        if match:
            # Extract the surrounding context (up to 100 chars either side)
            start = max(0, match.start() - 80)
            end   = min(len(text), match.end() + 80)
            context = text[start:end].strip()

            flags.append({
                "risk_type":   rp["risk_type"],
                "severity":    rp["severity"],
                "explanation": rp["explanation"],
                "context":     context,
            })

    return flags


def overall_risk_level(flags: list) -> str:
    if any(f["severity"] == "high" for f in flags):
        return "high"
    if any(f["severity"] == "medium" for f in flags):
        return "medium"
    return "low"

# ---------------------------------------------------------------------------
# LLM summarization (Ollama) with rule-based fallback
# ---------------------------------------------------------------------------

def summarize_with_ollama(text: str, language: str = "en") -> str:
    """
    Use Ollama (local LLM) to summarize a document in plain language.
    Returns None if Ollama is unavailable (triggers rule-based fallback).
    """
    try:
        import urllib.request, urllib.error
        lang_names = {"hi": "Hindi", "mr": "Marathi", "ta": "Tamil",
                      "te": "Telugu", "bn": "Bengali", "en": "English"}
        lang_name = lang_names.get(language, "English")

        prompt = f"""You are helping a rural Indian user understand a legal/financial document.
The user may have low literacy. Summarize the document below in {lang_name} using:
- Simple, clear language (no legal jargon)
- Short bullet points, one idea per point
- Call out anything unusual or dangerous
- Start with what the document IS (loan agreement, sale deed, rental agreement, etc.)

Document text:
---
{text[:3000]}
---

Provide a plain-language summary in {lang_name}:"""

        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.2, "num_predict": 500}
        }).encode()

        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            return result.get("response", "").strip()

    except Exception as e:
        log.warning(f"Ollama unavailable ({e}) — using rule-based fallback")
        return None


def summarize_rule_based(text: str, risk_flags: list) -> str:
    """
    Rule-based document summarizer — works fully offline without any LLM.

    Extracts key entities and patterns from the OCR text to produce a
    structured plain-language summary.
    """
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    words = text.lower().split()

    # Detect document type
    doc_type = "Document"
    if any(w in text.lower() for w in ["loan agreement", "loan deed", "promissory note", "borrower"]):
        doc_type = "Loan Agreement"
    elif any(w in text.lower() for w in ["sale deed", "conveyance", "sell and transfer"]):
        doc_type = "Sale Deed (Property Transfer)"
    elif any(w in text.lower() for w in ["rent agreement", "lease deed", "tenant", "landlord", "lessor", "lessee"]):
        doc_type = "Rental / Lease Agreement"
    elif any(w in text.lower() for w in ["insurance", "policy", "premium", "insured", "insurer"]):
        doc_type = "Insurance Policy"
    elif any(w in text.lower() for w in ["employment", "appointment letter", "salary", "designation"]):
        doc_type = "Employment Document"

    # Extract amounts
    amounts = re.findall(r"(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
    amount_str = f"Amounts mentioned: {', '.join(['₹' + a for a in amounts[:5]])}" if amounts else ""

    # Extract dates
    dates = re.findall(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", text)
    date_str = f"Dates mentioned: {', '.join(dates[:3])}" if dates else ""

    # Extract names (simple heuristic)
    names = re.findall(r"(?:Mr\.|Mrs\.|Ms\.|Shri|Smt\.|Kumar|Singh|Devi)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?", text)
    name_str = f"Parties: {', '.join(set(names[:3]))}" if names else ""

    # Extract interest rates
    rates = re.findall(r"(\d+(?:\.\d+)?)\s*%\s*(?:per annum|p\.?a\.?|interest|rate)", text, re.IGNORECASE)
    rate_str = f"Interest rate: {rates[0]}% per year" if rates else ""

    # Build summary
    summary_parts = [
        f"[DOC] Document Type: {doc_type}",
        "",
        "Key Information:",
    ]
    if name_str:   summary_parts.append(f"  - {name_str}")
    if amount_str: summary_parts.append(f"  - {amount_str}")
    if date_str:   summary_parts.append(f"  - {date_str}")
    if rate_str:   summary_parts.append(f"  - {rate_str}")

    if risk_flags:
        summary_parts += ["", "[!] Important Points to Check:"]
        for flag in risk_flags:
            summary_parts.append(f"  - {flag['explanation']}")

    if not amounts and not dates:
        summary_parts.append("  - This appears to be a partial or unclear scan. Please retake the photo with better lighting.")

    summary_parts += [
        "",
        "[i] This is an automated summary. For important decisions, consult a legal expert or trusted advisor."
    ]

    return "\n".join(summary_parts)


def answer_question_ollama(text: str, question: str, language: str = "en") -> str:
    """Answer a follow-up question about the document using Ollama."""
    try:
        import urllib.request
        lang_names = {"hi": "Hindi", "mr": "Marathi", "ta": "Tamil",
                      "te": "Telugu", "bn": "Bengali", "en": "English"}
        lang_name = lang_names.get(language, "English")

        prompt = f"""Answer the following question about this document. Answer ONLY based on what the document says.
Answer in {lang_name} in simple language.

Document:
---
{text[:3000]}
---

Question: {question}

Answer (based only on the document):"""

        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 300}
        }).encode()

        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
            return result.get("response", "").strip()
    except Exception:
        return f"I could not find specific information about '{question}' in this document. Please check the relevant section manually."


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def process_document(image_path: str, language: str = "en", question: str = None) -> dict:
    """
    Full pipeline: preprocess → OCR → risk detection → summarize → answer question.
    Returns a JSON-serializable dict.
    """
    result = {
        "success": False,
        "raw_text": "",
        "confidence": 0.0,
        "word_count": 0,
        "summary": "",
        "risk_flags": [],
        "risk_level": "low",
        "question_answer": None,
        "llm_used": "none",
        "error": None,
    }

    try:
        # 1. Pre-process image
        log.info(f"Pre-processing image: {image_path}")
        processed = preprocess_image(image_path)

        # 2. OCR
        log.info("Running Tesseract OCR...")
        ocr_result = run_ocr(processed, lang=language)
        result["raw_text"]   = ocr_result["text"]
        result["confidence"] = ocr_result["confidence"]
        result["word_count"] = ocr_result["word_count"]

        if ocr_result["word_count"] < 5:
            result["error"] = "OCR extracted very little text. Please retake the photo with better lighting and focus."
            result["summary"] = result["error"]
            result["success"] = True
            return result

        # 3. Risk detection
        log.info("Detecting risk clauses...")
        risk_flags = detect_risk_clauses(ocr_result["text"])
        result["risk_flags"] = risk_flags
        result["risk_level"] = overall_risk_level(risk_flags)

        # 4. Summarization
        log.info("Summarizing document...")
        llm_summary = summarize_with_ollama(ocr_result["text"], language)
        if llm_summary:
            result["summary"]  = llm_summary
            result["llm_used"] = OLLAMA_MODEL
        else:
            result["summary"]  = summarize_rule_based(ocr_result["text"], risk_flags)
            result["llm_used"] = "rule_based"

        # 5. Answer follow-up question
        if question:
            log.info(f"Answering: {question}")
            if llm_summary:
                result["question_answer"] = answer_question_ollama(ocr_result["text"], question, language)
            else:
                result["question_answer"] = answer_question_rule_based(ocr_result["text"], question)

        result["success"] = True

    except Exception as e:
        log.error(f"Pipeline error: {e}")
        result["error"] = str(e)

    return result


def answer_question_rule_based(text: str, question: str) -> str:
    """Simple keyword-based Q&A fallback."""
    q_lower = question.lower()
    # Find sentences containing question keywords
    keywords = [w for w in q_lower.split() if len(w) > 3]
    sentences = re.split(r'[.!?।]', text)

    matching = []
    for sent in sentences:
        if any(kw in sent.lower() for kw in keywords):
            matching.append(sent.strip())

    if matching:
        return "Based on the document: " + " ".join(matching[:2])
    return "The document does not clearly address this question. Please consult an advisor."


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image",    required=True, help="Path to document image")
    parser.add_argument("--language", default="en",  help="Language code: hi, mr, ta, te, bn, en")
    parser.add_argument("--question", default=None,  help="Follow-up question about the document")
    args = parser.parse_args()

    result = process_document(args.image, args.language, args.question)
    print(json.dumps(result, ensure_ascii=False, indent=2))

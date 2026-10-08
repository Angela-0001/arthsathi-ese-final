/**
 * ArthSathi — OCR Service (Node.js side)
 *
 * Spawns the Python ocr_processor.py as a child process, passing the
 * uploaded image path and returning the parsed JSON result.
 *
 * Why subprocess? Python has best-in-class OCR (pytesseract) and CV2
 * libraries. Running them from Node via spawn keeps the Express API
 * single-process while leveraging the full Python ecosystem.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const OCR_SCRIPT = path.join(__dirname, '../../../ml-model/ocr_processor.py');

/**
 * Process a document image through the OCR + summarization pipeline.
 *
 * @param {string}  imagePath — absolute path to the uploaded image file
 * @param {string}  language  — user's language code (hi, mr, ta, te, bn, en)
 * @param {string?} question  — optional follow-up question about the document
 * @returns {Promise<Object>} — parsed result from ocr_processor.py
 */
function processDocument(imagePath, language = 'en', question = null) {
  return new Promise((resolve, reject) => {
    // Validate image exists before spawning Python
    if (!fs.existsSync(imagePath)) {
      return reject(new Error(`Image file not found: ${imagePath}`));
    }

    const args = [
      OCR_SCRIPT,
      '--image',    imagePath,
      '--language', language,
    ];
    if (question) {
      args.push('--question', question);
    }

    const proc = spawn(PYTHON_BIN, args, {
      env: {
        ...process.env,
        TESSERACT_CMD: process.env.TESSERACT_CMD || 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
        OLLAMA_HOST:   process.env.OLLAMA_HOST   || 'http://localhost:11434',
        OLLAMA_MODEL:  process.env.OLLAMA_MODEL  || 'mistral',
      }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        return reject(new Error(`OCR process failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
      try {
        // Find the JSON in stdout (logs may prefix it)
        const jsonStart = stdout.indexOf('{');
        if (jsonStart === -1) {
          return reject(new Error('No JSON output from OCR processor'));
        }
        const result = JSON.parse(stdout.slice(jsonStart));
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse OCR output: ${e.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Could not spawn Python: ${err.message}. Ensure Python is in PATH.`));
    });

    // 3-minute timeout for large documents
    setTimeout(() => {
      proc.kill();
      reject(new Error('OCR processing timed out (3 min). Try a clearer, smaller image.'));
    }, 180_000);
  });
}

// answerFromText exported below after its definition

/**
 * Answer a question about a document using Ollama or keyword fallback.
 * @param {string} text      — raw OCR text
 * @param {string} question  — user's question
 * @param {string} language  — language code
 */
function answerFromText(text, question, language = 'en') {
  return new Promise((resolve, reject) => {
    const args = [
      OCR_SCRIPT,
      '--image',    '/dev/null', // placeholder — script won't OCR when question-only
      '--language', language,
      '--question', question,
    ];

    // Write text to a temp file and pass via env
    const fs   = require('fs');
    const os   = require('os');
    const tmp  = require('path').join(os.tmpdir(), `as_text_${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, 'utf8');

    const env = {
      ...process.env,
      AS_TEXT_FILE:  tmp,
      TESSERACT_CMD: process.env.TESSERACT_CMD || 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
      OLLAMA_HOST:   process.env.OLLAMA_HOST   || 'http://localhost:11434',
      OLLAMA_MODEL:  process.env.OLLAMA_MODEL  || 'mistral',
    };

    // Build a minimal script that just calls answer_question_ollama on text from env
    const miniScript = `
import os, sys, json
sys.path.insert(0, r'${path.join(__dirname, '../../../ml-model')}')
from ocr_processor import answer_question_ollama, answer_question_rule_based
text = open(os.environ['AS_TEXT_FILE'], encoding='utf-8').read()
question = sys.argv[1]
lang = sys.argv[2] if len(sys.argv) > 2 else 'en'
answer = answer_question_ollama(text, question, lang) or answer_question_rule_based(text, question)
print(json.dumps({"answer": answer}))
`.trim();

    const tmpScript = require('path').join(require('os').tmpdir(), `as_qa_${Date.now()}.py`);
    fs.writeFileSync(tmpScript, miniScript, 'utf8');

    const proc = spawn(PYTHON_BIN, [tmpScript, question, language], { env });
    let out = '', err = '';
    proc.stdout.on('data', c => out += c);
    proc.stderr.on('data', c => err += c);
    proc.on('close', (code) => {
      fs.unlink(tmp,       () => {});
      fs.unlink(tmpScript, () => {});
      try {
        const j = JSON.parse(out.slice(out.indexOf('{')));
        resolve(j.answer);
      } catch {
        resolve('Could not answer your question at this time. Please check the document manually.');
      }
    });
    proc.on('error', () => {
      resolve('Answer service temporarily unavailable.');
    });
  });
}

module.exports = { processDocument, answerFromText };

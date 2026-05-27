'use strict';
/**
 * OCR / text-extraction service (pluggable).
 *   OCR_MODE = off    -> only decode native text files (default; no cost)
 *            = vision -> Google Cloud Vision DOCUMENT_TEXT_DETECTION for images
 *                        (needs OCR_API_KEY). PDFs require async batch + GCS and
 *                        are skipped here — wire that in for production.
 *            = tesseract -> reserved (install tesseract.js and implement)
 *
 * Returns { text, status }  status: done | none | error.
 */
const MODE = process.env.OCR_MODE || 'off';
const OCR_API_KEY = process.env.OCR_API_KEY || '';
const VISION_URL = process.env.OCR_BASE_URL || 'https://vision.googleapis.com/v1/images:annotate';

function isTextLike(mime, name = '') {
  return /^text\//.test(mime || '') || /\.(txt|csv|md|json|xml)$/i.test(name || '');
}
function isImage(mime, name = '') {
  return /^image\//.test(mime || '') || /\.(png|jpe?g|tiff?|bmp|gif|webp)$/i.test(name || '');
}

async function visionOcr(buffer) {
  if (!OCR_API_KEY) return { text: '', status: 'none' };
  const body = {
    requests: [{
      image: { content: buffer.toString('base64') },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
    }],
  };
  const resp = await fetch(`${VISION_URL}?key=${OCR_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!resp.ok) return { text: '', status: 'error' };
  const data = await resp.json();
  const text = data.responses && data.responses[0] && data.responses[0].fullTextAnnotation
    ? data.responses[0].fullTextAnnotation.text : '';
  return { text: text || '', status: text ? 'done' : 'none' };
}

/** Extract text from a file buffer. */
async function extractText(buffer, mime, name = '') {
  try {
    if (!buffer || !buffer.length) return { text: '', status: 'none' };
    if (isTextLike(mime, name)) return { text: buffer.toString('utf8').slice(0, 20000), status: 'done' };
    if (MODE === 'vision' && isImage(mime, name)) return await visionOcr(buffer);
    return { text: '', status: 'none' };
  } catch (e) {
    return { text: '', status: 'error' };
  }
}

module.exports = { extractText, mode: MODE };

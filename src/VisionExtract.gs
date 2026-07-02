/**
 * VisionExtract.gs — Gemini vision call per spec §6.1. Extracts raw
 * post/comment text, platform hints, and visible date from a screenshot.
 *
 * Known gaps not handled here (see docs/open-issues.md #3):
 * - HEIC screenshots (common from iOS) are passed through with whatever
 *   MIME type Drive reports; not verified against Gemini's accepted
 *   image types.
 * - Multi-post / scrolling-capture screenshots are not detected or split.
 * - PII embedded in an attached image-within-the-screenshot (e.g. a
 *   boarding pass) is not addressed by this prompt.
 */

var VISION_EXTRACTION_PROMPT =
  'You are extracting text from a screenshot of a Facebook group post and its comments.\n' +
  'Return raw JSON only, no markdown fences, no commentary.\n\n' +
  'Extract:\n' +
  '- post_text: the original post content, verbatim as visible\n' +
  '- comments: array of comment text strings, in the order shown (no author names)\n' +
  '- visible_platform_hints: any mention of iOS, Android, app version, or "website"\n' +
  '- visible_date: any date/timestamp shown, or null\n' +
  '- legible: boolean — false if the screenshot is too blurry/cropped to confidently transcribe\n\n' +
  'Do NOT extract or include any names, profile photos, or profile links.\n' +
  'If a name is embedded in the post/comment text itself (e.g. "hi John, same happened to me"),\n' +
  'replace it with [name].';

/**
 * @param {string} fileId Drive file ID of the screenshot in Inbox/.
 * @returns {{post_text: string, comments: string[], visible_platform_hints: string, visible_date: ?string, legible: boolean}}
 * @throws {Error} if Gemini fails or returns unparseable/malformed output after one retry.
 */
function extractFromScreenshot(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var base64 = Utilities.base64Encode(blob.getBytes());
  var mimeType = blob.getContentType();

  var parts = [
    { text: VISION_EXTRACTION_PROMPT },
    { inline_data: { mime_type: mimeType, data: base64 } }
  ];

  var text = callGemini_(parts);
  var parsed = tryParseJson_(text);

  if (!parsed) {
    // Retry once with a stricter reminder before giving up (spec §10 requirement).
    var retryParts = [
      { text: VISION_EXTRACTION_PROMPT + '\n\nYour previous response was not valid JSON. Return valid JSON only.' },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ];
    var retryText = callGemini_(retryParts);
    parsed = tryParseJson_(retryText);
  }

  if (!parsed) {
    throw new Error('VisionExtract: Gemini returned non-JSON output after retry');
  }

  validateExtractionShape_(parsed);
  return parsed;
}

function validateExtractionShape_(obj) {
  if (typeof obj.post_text !== 'string') {
    throw new Error('VisionExtract: missing/invalid post_text');
  }
  if (!Array.isArray(obj.comments)) {
    throw new Error('VisionExtract: missing/invalid comments array');
  }
}

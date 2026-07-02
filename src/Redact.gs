/**
 * Redact.gs — deterministic second PII pass per spec §6.2, run after
 * VisionExtract regardless of what the vision prompt already stripped.
 *
 * Known gaps (see docs/open-issues.md #4): only catches names adjacent to
 * greetings, only common FB URL variants, and English-oriented name
 * patterns. This is a safety net, not a guarantee — tune against real
 * samples before trusting it fully.
 */

var NAME_GREETING_REGEX = /\b(hi|hey|hello|thanks|thank you|dear)[,!]?\s+([A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\b/g;
var FB_URL_REGEX = /https?:\/\/(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com|fb\.watch)\/[^\s)]+/gi;
var EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
var PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * @param {object} extractedObj Output of extractFromScreenshot().
 * @returns {object} Same shape, with post_text/comments redacted.
 */
function redactContent(extractedObj) {
  var counters = { names: 0, urls: 0, emails: 0, phones: 0 };

  var result = {
    post_text: redactField_(extractedObj.post_text, counters),
    comments: (extractedObj.comments || []).map(function (c) { return redactField_(c, counters); }),
    visible_platform_hints: extractedObj.visible_platform_hints,
    visible_date: extractedObj.visible_date,
    legible: extractedObj.legible
  };

  var total = counters.names + counters.urls + counters.emails + counters.phones;
  if (total > 0) {
    // Log that redaction fired and what categories, never the matched text itself.
    logEvent('Redact', null, 'INFO',
      'Redaction fired: names=' + counters.names + ' urls=' + counters.urls +
      ' emails=' + counters.emails + ' phones=' + counters.phones);
  }

  return result;
}

function redactField_(text, counters) {
  if (!text) return text;
  var out = text;
  out = out.replace(NAME_GREETING_REGEX, function (m, greeting) {
    counters.names++;
    return greeting + ' [name]';
  });
  out = out.replace(FB_URL_REGEX, function () {
    counters.urls++;
    return '[link removed]';
  });
  out = out.replace(EMAIL_REGEX, function () {
    counters.emails++;
    return '[email removed]';
  });
  out = out.replace(PHONE_REGEX, function () {
    counters.phones++;
    return '[phone removed]';
  });
  return out;
}

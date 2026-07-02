/**
 * Util.gs — small helpers shared across pipeline stages. Not in spec §10's
 * file list; split out to avoid duplicating this logic in every stage file
 * (see docs/coding-plan.md).
 */

/**
 * Calls Gemini's generateContent endpoint. `parts` follows the Gemini API
 * shape, e.g. [{text: '...'}] or [{text: '...'}, {inline_data: {...}}].
 * Retries once on HTTP failure or non-JSON output before throwing.
 */
function callGemini_(parts, attempt) {
  attempt = attempt || 1;
  var apiKey = getGeminiApiKey_();
  var url = GEMINI_CONFIG.API_BASE + '/' + getGeminiModel_() + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: parts }],
    generationConfig: { temperature: 0.1 }
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    if (attempt <= GEMINI_CONFIG.MAX_RETRIES) {
      return callGemini_(parts, attempt + 1);
    }
    throw new Error('Gemini request failed: ' + e.message);
  }

  var code = response.getResponseCode();
  if (code !== 200) {
    if (attempt <= GEMINI_CONFIG.MAX_RETRIES) {
      return callGemini_(parts, attempt + 1);
    }
    throw new Error('Gemini HTTP ' + code + ': ' + response.getContentText().slice(0, 300));
  }

  var json = JSON.parse(response.getContentText());
  var text = extractGeminiText_(json);
  if (text === null) {
    if (attempt <= GEMINI_CONFIG.MAX_RETRIES) {
      return callGemini_(parts, attempt + 1);
    }
    throw new Error('Gemini response had no text content');
  }
  return text;
}

function extractGeminiText_(json) {
  try {
    var candidate = json.candidates && json.candidates[0];
    if (!candidate) return null;
    var contentParts = candidate.content && candidate.content.parts;
    if (!contentParts || !contentParts.length) return null;
    return contentParts.map(function (p) { return p.text || ''; }).join('');
  } catch (e) {
    return null;
  }
}

/**
 * Parses JSON out of a Gemini text response defensively: strips ```json
 * fences models sometimes add despite instructions not to, and returns
 * null (not a throw) on failure so callers can decide retry/fallback.
 */
function tryParseJson_(text) {
  if (!text) return null;
  var cleaned = text.trim();
  cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
}

function sanitizeForFilename_(text, maxLen) {
  maxLen = maxLen || 40;
  return String(text || '')
    .replace(/[\/\\:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, maxLen);
}

function formatDateYYYYMMDD_(date) {
  if (!date) date = new Date();
  if (typeof date === 'string') {
    var parsed = new Date(date);
    if (!isNaN(parsed.getTime())) date = parsed;
    else return 'unknown-date';
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'UTC', 'yyyyMMdd');
}

/**
 * Moves a Drive file to targetFolder, idempotently — a no-op if the file
 * is already there (StatusSync re-runs shouldn't error or duplicate work).
 */
function moveFileToFolder_(file, targetFolder) {
  var parents = file.getParents();
  var alreadyThere = false;
  var toRemove = [];
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() === targetFolder.getId()) {
      alreadyThere = true;
    } else {
      toRemove.push(p);
    }
  }
  if (!alreadyThere) {
    targetFolder.addFile(file);
  }
  toRemove.forEach(function (p) { p.removeFile(file); });
}

function tokenize_(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(function (w) { return w.length > 2; });
}

function jaccardSimilarity_(tokensA, tokensB) {
  var setA = new Set(tokensA);
  var setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;
  var intersection = 0;
  setA.forEach(function (t) { if (setB.has(t)) intersection++; });
  var union = new Set(tokensA.concat(tokensB)).size;
  return union === 0 ? 0 : intersection / union;
}

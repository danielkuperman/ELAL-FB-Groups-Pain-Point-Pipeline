/**
 * Dedup.gs — cross-reference logic per spec §7. Split out of SpecGen.gs
 * since it reads Drive state (existing specs) rather than calling Gemini.
 *
 * v1: keyword + journey-stage overlap heuristic, per spec §7's "simpler
 * heuristic to start" option — no embedding calls, no extra Gemini cost.
 * Only scans Pending-Review/ + Approved/ per spec §7 (Rejected/ excluded —
 * see docs/open-issues.md #6, a deliberate spec limitation worth revisiting).
 */

/**
 * @returns {Array<{specId: string, painPointText: string, journeyStage: string}>}
 */
function buildExistingSpecsIndex() {
  var index = [];
  ['PENDING_REVIEW', 'APPROVED'].forEach(function (key) {
    var files = getFolder(key).getFilesByType(MimeType.GOOGLE_DOCS);
    while (files.hasNext()) {
      var file = files.next();
      var meta = readSpecMetadataFromDoc_(file.getId());
      if (meta) index.push(meta);
    }
  });
  return index;
}

/**
 * @param {string} newPainPointText
 * @param {string} journeyStage
 * @param {Array} index From buildExistingSpecsIndex().
 * @returns {string[]} Spec IDs judged related, per DEDUP_CONFIG.SIMILARITY_THRESHOLD.
 */
function findRelatedSpecs(newPainPointText, journeyStage, index) {
  var newTokens = tokenize_(newPainPointText);
  var related = [];
  (index || []).forEach(function (entry) {
    var score = jaccardSimilarity_(newTokens, tokenize_(entry.painPointText));
    if (entry.journeyStage === journeyStage) {
      score += DEDUP_CONFIG.JOURNEY_STAGE_BONUS;
    }
    if (score >= DEDUP_CONFIG.SIMILARITY_THRESHOLD) {
      related.push(entry.specId);
    }
  });
  return related;
}

/**
 * Parses the "Spec ID:" / "Journey stage:" labeled lines that DocBuilder
 * writes at the top of every spec doc. Returns null (not a throw) for
 * docs that don't match — e.g. a Not-Actionable doc with no such fields —
 * so the index build can just skip them.
 */
function readSpecMetadataFromDoc_(docId) {
  var text = DocumentApp.openById(docId).getBody().getText();
  var specId = firstMatch_(text, /Spec ID:\s*(FB-\d+)/);
  var journeyStage = firstMatch_(text, /Journey stage:\s*(.+)/);
  var painPointText = extractBetween_(text, 'Pain point description:', 'Evidence:');
  if (!specId || !painPointText) return null;
  return {
    specId: specId,
    journeyStage: journeyStage ? journeyStage.trim() : '',
    painPointText: painPointText.trim()
  };
}

function firstMatch_(text, regex) {
  var m = text.match(regex);
  return m ? m[1] : null;
}

function extractBetween_(text, startLabel, endLabel) {
  var startIdx = text.indexOf(startLabel);
  if (startIdx === -1) return null;
  startIdx += startLabel.length;
  var endIdx = text.indexOf(endLabel, startIdx);
  var chunk = endIdx === -1 ? text.slice(startIdx) : text.slice(startIdx, endIdx);
  // Strip the [STATUS: ...] tag line that sits right under the label.
  return chunk.replace(/\[STATUS:\s*[A-Za-z-]+\]/, '').trim();
}

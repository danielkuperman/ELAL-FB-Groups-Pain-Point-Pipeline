/**
 * SpecGen.gs — Gemini reasoning call per spec §6.3. Produces a structured
 * spec matching §5's schema, or {actionable: false, reason}.
 *
 * Output is validated against Config.gs's ENUMS rather than trusted as-is
 * (see docs/open-issues.md #5 — LLM JSON output drifts from schema).
 */

function enumHint_(allowed) {
  return 'one of: ' + allowed.join(' | ');
}

function buildSpecGenPrompt_(redactedObj, existingSpecsIndex) {
  var trimmedIndex = (existingSpecsIndex || []).slice(-DEDUP_CONFIG.MAX_INDEX_ENTRIES_IN_PROMPT);
  var indexText = trimmedIndex.length
    ? trimmedIndex.map(function (e) { return e.specId + ': ' + e.painPointText; }).join('\n')
    : '(none yet)';

  // sourceGroup is not part of the schema Gemini fills in — it's known
  // from which Inbox/<Group> subfolder the screenshot came from (Main.gs
  // passes it in and SpecGen.generateSpec assigns it after parsing). See
  // docs/open-issues.md #12.
  //
  // Enum fields are written as "one of: A | B | C" description strings,
  // not raw arrays — an earlier version embedded the allowed-values array
  // directly as the field's example value, which Gemini sometimes copied
  // literally (e.g. postType: ["Complaint","Question"]) instead of picking
  // one. See docs/open-issues.md #5.
  var schemaText = JSON.stringify({
    postType: enumHint_(ENUMS.POST_TYPE),
    platform: enumHint_(ENUMS.PLATFORM),
    journeyStage: enumHint_(ENUMS.JOURNEY_STAGE),
    painPointDescription: 'string, self-contained narrative',
    severity: enumHint_(ENUMS.SEVERITY),
    frequency: enumHint_(ENUMS.FREQUENCY),
    evidence: 'string, paraphrased/anonymized excerpts',
    shortTitle: 'string, <= 6 words, filename-safe',
    solutions: [{
      title: 'string',
      description: 'string',
      category: enumHint_(ENUMS.SOLUTION_CATEGORY),
      effort: enumHint_(ENUMS.EFFORT),
      impact: enumHint_(ENUMS.IMPACT)
    }]
  }, null, 2);

  return 'You are a senior product analyst. You will receive redacted post + comment text from a\n' +
    'private airline customer Facebook group. Produce a structured product spec in JSON matching\n' +
    'this exact schema:\n' + schemaText + '\n\n' +
    'Rules:\n' +
    '- Every field described as "one of: ..." must be filled with exactly one of those strings —\n' +
    '  never an array, never multiple values, never a value outside that list.\n' +
    '- Write the pain point description as a self-contained narrative — assume the reader never\n' +
    '  saw the original post.\n' +
    '- Severity: High = blocks a core task (booking, check-in, boarding) or causes financial harm.\n' +
    '  Med = degrades experience but has a workaround. Low = cosmetic/minor annoyance.\n' +
    '- Frequency: infer from number and tone of corroborating comments, not post count alone.\n' +
    '- Draft 1-4 solutions. Range from quick fix to more ambitious ideas — do not default to only\n' +
    '  one obvious fix. At least one solution should be a Quick Fix if a plausible one exists.\n' +
    '- If the post is praise, off-topic, or has no actionable product angle, return\n' +
    '  {"actionable": false, "reason": "<one line>"} instead of a full spec.\n' +
    '- Never include names or profile links in any field, even if present in the input.\n\n' +
    'Existing specs (for context only — do not merge, just be aware of overlap):\n' + indexText + '\n\n' +
    'Redacted post text:\n' + redactedObj.post_text + '\n\n' +
    'Redacted comments:\n' + JSON.stringify(redactedObj.comments || []) + '\n\n' +
    'Visible platform hints: ' + (redactedObj.visible_platform_hints || 'none') + '\n' +
    'Visible date: ' + (redactedObj.visible_date || 'none') + '\n\n' +
    'Return raw JSON only, no markdown fences, no commentary.';
}

/**
 * @param {object} redactedObj Output of redactContent().
 * @param {Array} existingSpecsIndex From Dedup.buildExistingSpecsIndex().
 * @param {string} sourceGroup Known from which Inbox/<Group> subfolder the
 *   screenshot came from (see docs/open-issues.md #12) — not asked of Gemini.
 * @returns {object} A spec matching §5's schema, or {actionable: false, reason}.
 * @throws {Error} on unparseable/invalid output after one retry.
 */
function generateSpec(redactedObj, existingSpecsIndex, sourceGroup) {
  var prompt = buildSpecGenPrompt_(redactedObj, existingSpecsIndex);

  var parsed = attemptGenerateSpec_(prompt);
  if (!parsed) {
    // Single retry per spec §10, covering *any* failure (non-JSON output
    // or JSON that fails schema validation) — not just parse failures.
    var retryPrompt = prompt + '\n\nYour previous response was invalid: either not valid JSON, ' +
      'or an enum field held an array/invalid value instead of a single allowed string. ' +
      'Return valid JSON only, strictly matching the schema.';
    parsed = attemptGenerateSpec_(retryPrompt);
  }

  if (!parsed) {
    throw new Error('SpecGen: Gemini returned invalid output after retry');
  }

  if (parsed.actionable === false) {
    return parsed;
  }

  // attemptGenerateSpec_ already ran validateSpecShape_ (which normalizes
  // enum casing in place), so parsed is known-valid here.
  parsed.sourceGroup = requireEnum_(sourceGroup, ENUMS.SOURCE_GROUP, 'sourceGroup');
  parsed.specId = getNextSpecId();
  parsed.painPointApproval = 'Pending';
  parsed.solutions.forEach(function (s) { s.approval = 'Pending'; });
  return parsed;
}

// Returns a validated spec object (or a valid {actionable:false, reason}),
// or null on any failure — non-JSON output, or JSON that fails schema
// validation. Callers retry once on null before giving up.
function attemptGenerateSpec_(prompt) {
  var text;
  try {
    text = callGemini_([{ text: prompt }]);
  } catch (e) {
    return null;
  }

  var parsed = tryParseJson_(text);
  if (!parsed) return null;

  if (parsed.actionable === false) {
    return (parsed.reason && typeof parsed.reason === 'string') ? parsed : null;
  }

  try {
    validateSpecShape_(parsed);
  } catch (e) {
    return null;
  }
  return parsed;
}

function validateSpecShape_(spec) {
  spec.postType = requireEnum_(spec.postType, ENUMS.POST_TYPE, 'postType');
  spec.platform = requireEnum_(spec.platform, ENUMS.PLATFORM, 'platform');
  spec.journeyStage = requireEnum_(spec.journeyStage, ENUMS.JOURNEY_STAGE, 'journeyStage');
  spec.severity = requireEnum_(spec.severity, ENUMS.SEVERITY, 'severity');
  spec.frequency = requireEnum_(spec.frequency, ENUMS.FREQUENCY, 'frequency');

  if (!spec.painPointDescription || typeof spec.painPointDescription !== 'string') {
    throw new Error('SpecGen: missing painPointDescription');
  }
  if (!Array.isArray(spec.solutions) || spec.solutions.length < 1 || spec.solutions.length > 4) {
    throw new Error('SpecGen: solutions must be an array of 1-4 items');
  }
  spec.solutions.forEach(function (s, i) {
    if (!s.title || typeof s.title !== 'string') {
      throw new Error('SpecGen: solution[' + i + '] missing title');
    }
    s.category = requireEnum_(s.category, ENUMS.SOLUTION_CATEGORY, 'solutions[' + i + '].category');
    s.effort = requireEnum_(s.effort, ENUMS.EFFORT, 'solutions[' + i + '].effort');
    s.impact = requireEnum_(s.impact, ENUMS.IMPACT, 'solutions[' + i + '].impact');
  });
}

function requireEnum_(value, allowed, fieldName) {
  var normalized = normalizeEnum_(value, allowed);
  if (normalized === null) {
    throw new Error('SpecGen: invalid ' + fieldName + ': ' + JSON.stringify(value));
  }
  return normalized;
}

// Case-insensitive match against an allow-list, normalized to the
// canonical casing (guards against e.g. "feature request" vs "Feature Request").
// Also tolerates Gemini occasionally returning an array instead of a single
// value (see docs/open-issues.md #5) by matching against its first element.
function normalizeEnum_(value, allowed) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i].toLowerCase() === value.toLowerCase()) return allowed[i];
  }
  return null;
}

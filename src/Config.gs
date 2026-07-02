/**
 * Config.gs — shared constants, folder resolution, Gemini config, enums.
 * See docs/coding-plan.md and docs/open-issues.md for the design decisions
 * behind these values.
 */

// Root Drive folder Daniel created ("FB-groups-intake"). All pipeline
// subfolders are created directly inside it by Setup.gs. See
// docs/open-issues.md Open Issue #11.
var ROOT_INTAKE_FOLDER_ID = '1PBf_pqjlkpplkQ0hmfm5bRzjW6f9UIa0';

// Subfolder names. The folders Daniel actively reviews are numbered to
// read chronologically in Drive's alphabetical sort; Processed-Raw/,
// Failed-Extraction/, and Needs-Manual-Review/ are backend/audit/error
// folders he doesn't walk through in order, so they're left unnumbered.
// (Failed-Extraction/ and Needs-Manual-Review/ aren't in spec §4's list but
// are required by spec §10's error-handling section — see
// docs/open-issues.md Open Issue #9.)
//
// These are matched by name only during setupFolders() (create-if-missing);
// every other function resolves folders by their stored ID, so renaming
// the actual Drive folders to match is safe and needs no re-run.
var FOLDER_NAMES = {
  INBOX: '1- Inbox',
  PENDING_REVIEW: '2- Pending-Review',
  NEEDS_EDIT: '3- Needs-Edit',
  APPROVED: '4- Approved',
  REJECTED: '5- Rejected',
  NOT_ACTIONABLE: '6- Not-Actionable',
  PROCESSED_RAW: 'Processed-Raw',
  FAILED_EXTRACTION: 'Failed-Extraction',
  NEEDS_MANUAL_REVIEW: 'Needs-Manual-Review'
};

var ENUMS = {
  SOURCE_GROUP: ['Group A', 'Group B'],
  POST_TYPE: ['Complaint', 'Question', 'Feature Request'],
  PLATFORM: ['iOS', 'Android', 'Web', 'Unclear'],
  JOURNEY_STAGE: ['Booking', 'Check-in', 'Day of Travel', 'Post-flight', 'Support', 'Account', 'Payments', 'Other'],
  SEVERITY: ['Low', 'Med', 'High'],
  FREQUENCY: ['Low', 'Med', 'High'],
  APPROVAL_STATUS: ['Approved', 'Rejected', 'Pending'],
  SOLUTION_CATEGORY: ['Quick Fix', 'Enhancement', 'Net-New', 'Moonshot'],
  EFFORT: ['S', 'M', 'L'],
  IMPACT: ['Low', 'Med', 'High']
};

var GEMINI_CONFIG = {
  // Both vision and reasoning calls use the same multimodal generateContent
  // endpoint. Override via Script Property GEMINI_MODEL if a different
  // model is preferred later.
  MODEL: 'gemini-2.5-flash',
  API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  MAX_RETRIES: 1
};

// Dedup heuristic tuning (§7) — keyword/journey-stage overlap, v1 per
// docs/coding-plan.md §4. Untuned; expect to adjust once real specs exist
// (docs/open-issues.md Open Issue #6).
var DEDUP_CONFIG = {
  SIMILARITY_THRESHOLD: 0.25,
  JOURNEY_STAGE_BONUS: 0.15,
  MAX_INDEX_ENTRIES_IN_PROMPT: 50 // cap existingSpecsIndex injected into the SpecGen prompt (Open Issue #5)
};

function getGeminiApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('GEMINI_API_KEY not set. Add it in Apps Script Project Settings > Script Properties.');
  }
  return key;
}

function getGeminiModel_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || GEMINI_CONFIG.MODEL;
}

/**
 * Resolves a folder by its FOLDER_NAMES key. Reads the ID cached by
 * setupFolders() in Script Properties; throws with a clear message if
 * setup hasn't been run yet.
 */
function getFolderId(key) {
  if (!FOLDER_NAMES[key]) {
    throw new Error('Unknown folder key: ' + key);
  }
  var id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID_' + key);
  if (!id) {
    throw new Error('Folder ID for ' + key + ' not found — run setupFolders() first (Setup.gs).');
  }
  return id;
}

function getFolder(key) {
  return DriveApp.getFolderById(getFolderId(key));
}

// Inbox/ is split into per-group subfolders so the source group (§5 schema)
// is known from where Daniel drops the screenshot, not guessed by Gemini —
// nothing in the redacted post/comment text reliably reveals which of the
// two groups a screenshot came from. See docs/open-issues.md #12.
function getInboxGroupFolder(groupLabel) {
  var propKey = 'FOLDER_ID_INBOX_' + groupLabel.replace(/\s+/g, '_');
  var id = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!id) {
    throw new Error('Folder ID for Inbox/' + groupLabel + ' not found — run setupFolders() first (Setup.gs).');
  }
  return DriveApp.getFolderById(id);
}

/**
 * Atomically issues the next Spec ID (FB-0001, FB-0002, ...). Uses
 * LockService because Apps Script has no built-in atomic counter and the
 * weekly trigger + manual Debug runs could otherwise race — see
 * docs/open-issues.md Open Issue #7.
 */
function getNextSpecId() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var current = parseInt(props.getProperty('SPEC_ID_COUNTER') || '0', 10);
    var next = current + 1;
    props.setProperty('SPEC_ID_COUNTER', String(next));
    return 'FB-' + ('0000' + next).slice(-4);
  } finally {
    lock.releaseLock();
  }
}

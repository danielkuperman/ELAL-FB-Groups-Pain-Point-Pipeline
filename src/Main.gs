/**
 * Main.gs — weekly batch orchestration: Inbox/ -> extract -> redact ->
 * generate spec -> dedup -> file doc -> archive transcript -> delete
 * source screenshot.
 *
 * Processed-Raw/ stores the redacted transcript only, never the raw
 * screenshot (Open Issue #1, resolved 2026-07-02) — the source screenshot
 * is deleted once its transcript and spec doc are both filed.
 *
 * Handles two constraints the spec's build order doesn't call out
 * explicitly (see docs/coding-plan.md §7 / docs/open-issues.md #8):
 * - Apps Script's ~6 minute execution cap: runWeeklyBatch stops early and
 *   schedules a one-off continuation trigger if Inbox/ still has files.
 * - Partial-failure idempotency: a file is only considered "done" (and
 *   deleted) after its doc is confirmed filed; a Script Property marks
 *   completion so a re-run after a mid-batch crash doesn't refile it.
 */

var BATCH_TIME_BUDGET_MS = 5 * 60 * 1000; // soft limit inside the 6-minute hard cap
var MAX_FILES_PER_RUN = 25;

function runWeeklyBatch() {
  var startTime = Date.now();
  var queue = collectInboxQueue_();
  var existingSpecsIndex = buildExistingSpecsIndex();
  var processedCount = 0;
  var ranOutOfBudget = false;

  for (var i = 0; i < queue.length; i++) {
    if (Date.now() - startTime > BATCH_TIME_BUDGET_MS || processedCount >= MAX_FILES_PER_RUN) {
      ranOutOfBudget = true;
      break;
    }
    var item = queue[i];
    try {
      processOneFile_(item.file, item.sourceGroup, existingSpecsIndex);
    } catch (e) {
      logEvent('Main', item.file.getId(), 'ERROR', 'processOneFile failed: ' + e.message);
      safeRoute_(item.file, 'FAILED_EXTRACTION');
    }
    processedCount++;
  }

  logEvent('Main', null, 'INFO', 'runWeeklyBatch processed ' + processedCount + ' file(s), ranOutOfBudget=' + ranOutOfBudget);

  if (ranOutOfBudget) {
    ScriptApp.newTrigger('runWeeklyBatch').timeBased().after(60 * 1000).create();
  }
}

// Flattens both Inbox/<Group> subfolders into one ordered queue so the
// source group travels with each file (see Config.gs getInboxGroupFolder).
function collectInboxQueue_() {
  var queue = [];
  ENUMS.SOURCE_GROUP.forEach(function (groupLabel) {
    var files = getInboxGroupFolder(groupLabel).getFiles();
    while (files.hasNext()) {
      queue.push({ file: files.next(), sourceGroup: groupLabel });
    }
  });
  return queue;
}

function processOneFile_(file, sourceGroup, existingSpecsIndex) {
  var fileId = file.getId();
  var doneKey = 'done_' + fileId;
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty(doneKey)) {
    // A prior run already filed this file's doc but crashed before deleting
    // the source screenshot — finish that cleanup without reprocessing.
    file.setTrashed(true);
    props.deleteProperty(doneKey);
    return;
  }

  var extracted;
  try {
    extracted = extractFromScreenshot(fileId);
  } catch (e) {
    logEvent('VisionExtract', fileId, 'ERROR', e.message);
    safeRoute_(file, 'FAILED_EXTRACTION');
    return;
  }

  if (extracted.legible === false) {
    logEvent('VisionExtract', fileId, 'WARN', 'Screenshot flagged as not legible');
    safeRoute_(file, 'NEEDS_MANUAL_REVIEW');
    return;
  }

  var redacted = redactContent(extracted);

  var spec;
  try {
    spec = generateSpec(redacted, existingSpecsIndex, sourceGroup);
  } catch (e) {
    logEvent('SpecGen', fileId, 'ERROR', e.message);
    safeRoute_(file, 'NEEDS_MANUAL_REVIEW');
    return;
  }

  var docResult;
  if (spec.actionable === false) {
    docResult = buildNotActionableDoc({
      reason: spec.reason,
      sourceGroup: sourceGroup,
      dateCaptured: extracted.visible_date
    });
  } else {
    spec.dateCaptured = spec.dateCaptured || extracted.visible_date;
    spec.relatedSpecs = findRelatedSpecs(spec.painPointDescription, spec.journeyStage, existingSpecsIndex);
    docResult = buildSpecDoc(spec);
    existingSpecsIndex.push({
      specId: spec.specId,
      painPointText: spec.painPointDescription,
      journeyStage: spec.journeyStage
    });
  }

  archiveRedactedTranscript_(docResult.fileName, redacted);

  props.setProperty(doneKey, docResult.docId);
  file.setTrashed(true);
  props.deleteProperty(doneKey);
}

function archiveRedactedTranscript_(baseFileName, redactedObj) {
  var folder = getFolder('PROCESSED_RAW');
  folder.createFile(baseFileName + '-transcript.json', JSON.stringify(redactedObj), MimeType.PLAIN_TEXT);
}

function safeRoute_(file, folderKey) {
  try {
    moveFileToFolder_(file, getFolder(folderKey));
  } catch (e) {
    logEvent('Main', file.getId(), 'ERROR', 'Failed to route to ' + folderKey + ': ' + e.message);
  }
}

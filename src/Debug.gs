/**
 * Debug.gs — manual, single-item test runners for each pipeline stage.
 * Run these from the Apps Script editor (select function, Run) while
 * building/validating each stage in isolation, per docs/coding-plan.md's
 * build order.
 */

function debugExtractOne(fileId) {
  var result = extractFromScreenshot(fileId);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function debugRedactOne(fileId) {
  var extracted = extractFromScreenshot(fileId);
  var redacted = redactContent(extracted);
  Logger.log(JSON.stringify(redacted, null, 2));
  return redacted;
}

// sourceGroup must be supplied manually here since in the real pipeline it
// comes from which Inbox/<Group> subfolder the file was in (Main.gs), not
// from the file itself — pass 'Group A' or 'Group B'.
function debugSpecGenOne(fileId, sourceGroup) {
  var extracted = extractFromScreenshot(fileId);
  var redacted = redactContent(extracted);
  var index = buildExistingSpecsIndex();
  var spec = generateSpec(redacted, index, sourceGroup || 'Group A');
  Logger.log(JSON.stringify(spec, null, 2));
  return spec;
}

function debugDocBuildOne(specObj) {
  var result = buildSpecDoc(specObj);
  Logger.log(JSON.stringify(result));
  return result;
}

function debugStatusSyncDryRun() {
  ['PENDING_REVIEW', 'NEEDS_EDIT'].forEach(function (key) {
    var folder = getFolder(key);
    var files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    while (files.hasNext()) {
      var file = files.next();
      var text = DocumentApp.openById(file.getId()).getBody().getText();
      var statuses = parseDocStatuses(text);
      var target = statuses ? resolveTargetFolder(statuses) : null;
      Logger.log(file.getName() + ': ' + JSON.stringify(statuses) + ' -> ' + (target || 'no move'));
    }
  });
}

// End-to-end smoke test on a single screenshot, without deleting it —
// useful before trusting runWeeklyBatch on real Inbox files.
function debugFullPipelineOne(fileId, sourceGroup) {
  var extracted = extractFromScreenshot(fileId);
  var redacted = redactContent(extracted);
  var index = buildExistingSpecsIndex();
  var spec = generateSpec(redacted, index, sourceGroup || 'Group A');

  var docResult;
  if (spec.actionable === false) {
    docResult = buildNotActionableDoc({ reason: spec.reason, sourceGroup: sourceGroup, dateCaptured: extracted.visible_date });
  } else {
    spec.dateCaptured = spec.dateCaptured || extracted.visible_date;
    spec.relatedSpecs = findRelatedSpecs(spec.painPointDescription, spec.journeyStage, index);
    docResult = buildSpecDoc(spec);
  }
  Logger.log('Built: ' + JSON.stringify(docResult));
  return docResult;
}

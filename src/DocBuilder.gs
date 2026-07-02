/**
 * DocBuilder.gs — builds the Google Doc per spec §5's schema. Field labels
 * and the "[STATUS: ...]" tag format here are load-bearing: Dedup.gs and
 * StatusSync.gs both parse doc text against these exact labels via
 * readSpecMetadataFromDoc_() and parseDocStatuses(). Keep them in sync if
 * this format changes.
 */

/**
 * @param {object} specObj A validated spec from SpecGen.generateSpec().
 * @returns {{docId: string, fileName: string}}
 */
function buildSpecDoc(specObj) {
  var fileName = buildSpecFileName_(specObj);
  var doc = DocumentApp.create(fileName);
  var body = doc.getBody();
  body.clear();

  appendHeading_(body, 'Spec ' + specObj.specId, DocumentApp.ParagraphHeading.HEADING1);

  appendField_(body, 'Spec ID', specObj.specId);
  appendField_(body, 'Date captured', specObj.dateCaptured || '');
  appendField_(body, 'Source group', specObj.sourceGroup);
  appendField_(body, 'Post type', specObj.postType);
  appendField_(body, 'Platform', specObj.platform);
  appendField_(body, 'Journey stage', specObj.journeyStage);
  appendField_(body, 'Severity', specObj.severity);
  appendField_(body, 'Frequency', specObj.frequency);
  appendField_(body, 'Related specs', (specObj.relatedSpecs && specObj.relatedSpecs.length) ? specObj.relatedSpecs.join(', ') : 'None');

  appendHeading_(body, 'Pain point description:', DocumentApp.ParagraphHeading.HEADING2);
  appendStatusTag_(body, specObj.painPointApproval || 'Pending');
  body.appendParagraph(specObj.painPointDescription);

  appendHeading_(body, 'Evidence:', DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(specObj.evidence || '');

  appendHeading_(body, 'Solutions:', DocumentApp.ParagraphHeading.HEADING2);
  (specObj.solutions || []).forEach(function (sol, i) {
    var titlePara = body.appendParagraph((i + 1) + '. ' + sol.title);
    titlePara.editAsText().setBold(true);
    appendField_(body, 'Category', sol.category);
    appendField_(body, 'Effort', sol.effort);
    appendField_(body, 'Impact', sol.impact);
    appendStatusTag_(body, sol.approval || 'Pending');
    body.appendParagraph(sol.description);
  });

  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  file.setName(fileName);
  moveFileToFolder_(file, getFolder('PENDING_REVIEW'));
  return { docId: doc.getId(), fileName: fileName };
}

/**
 * @param {{reason: string, sourceGroup: ?string, dateCaptured: ?string}} obj
 * @returns {{docId: string, fileName: string}}
 */
function buildNotActionableDoc(obj) {
  var specId = getNextSpecId();
  var fileName = 'NotActionable-' + formatDateYYYYMMDD_(obj.dateCaptured) + '-' + specId;
  var doc = DocumentApp.create(fileName);
  var body = doc.getBody();
  body.clear();

  appendHeading_(body, 'Not Actionable ' + specId, DocumentApp.ParagraphHeading.HEADING1);
  appendField_(body, 'Spec ID', specId);
  appendField_(body, 'Date captured', obj.dateCaptured || '');
  appendField_(body, 'Source group', obj.sourceGroup || 'Unclear');
  appendField_(body, 'Reason', obj.reason);

  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  file.setName(fileName);
  moveFileToFolder_(file, getFolder('NOT_ACTIONABLE'));
  return { docId: doc.getId(), fileName: fileName };
}

function buildSpecFileName_(specObj) {
  var short = sanitizeForFilename_(specObj.shortTitle || specObj.painPointDescription, 40);
  var dateStr = formatDateYYYYMMDD_(specObj.dateCaptured);
  return [specObj.severity, specObj.platform, short, dateStr, specObj.specId].join('-');
}

function appendField_(body, label, value) {
  var p = body.appendParagraph(label + ': ' + (value === null || value === undefined ? '' : value));
  p.editAsText().setBold(0, label.length - 1, true);
}

function appendHeading_(body, text, level) {
  var p = body.appendParagraph(text);
  p.setHeading(level);
}

function appendStatusTag_(body, status) {
  body.appendParagraph('[STATUS: ' + status + ']');
}

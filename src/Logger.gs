/**
 * Logger.gs — PII-free event log to a control Sheet, per spec's error
 * handling requirement ("Log ... to a running Sheet or Doc ... without
 * logging any raw PII"). Not in spec §10's file list — added because that
 * requirement needs a home. See docs/open-issues.md Open Issue #9.
 *
 * Callers must never pass raw extracted/redacted post or comment text into
 * `message` — log field names, lengths, counts, booleans, not content.
 */

function logEvent(stage, fileId, level, message) {
  var sheet = getOrCreateLogSheet_();
  sheet.appendRow([new Date(), stage, fileId || '', level, message]);
}

function getOrCreateLogSheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('LOG_SHEET_ID');
  var ss = null;
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      ss = null; // sheet was deleted/moved out from under us; recreate below
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('FB-Intake Pipeline Log');
    var file = DriveApp.getFileById(ss.getId());
    var root = DriveApp.getFolderById(ROOT_INTAKE_FOLDER_ID);
    root.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    var sheet = ss.getActiveSheet();
    sheet.appendRow(['Timestamp', 'Stage', 'FileId', 'Level', 'Message']);
    sheet.setFrozenRows(1);
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  return ss.getActiveSheet();
}

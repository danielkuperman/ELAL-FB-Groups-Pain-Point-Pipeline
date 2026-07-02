/**
 * Setup.gs — one-time (idempotent) folder + trigger setup. Run
 * setupFolders() once after deploying, then setupTriggers() to install the
 * Monday batch trigger.
 */

function setupFolders() {
  var root = DriveApp.getFolderById(ROOT_INTAKE_FOLDER_ID);
  var props = PropertiesService.getScriptProperties();
  Object.keys(FOLDER_NAMES).forEach(function (key) {
    var name = FOLDER_NAMES[key];
    var folder = getOrCreateChildFolder_(root, name);
    props.setProperty('FOLDER_ID_' + key, folder.getId());
    Logger.log(key + ' -> ' + name + ' (' + folder.getId() + ')');
  });

  var inboxFolder = DriveApp.getFolderById(props.getProperty('FOLDER_ID_INBOX'));
  ENUMS.SOURCE_GROUP.forEach(function (groupLabel) {
    var sub = getOrCreateChildFolder_(inboxFolder, groupLabel);
    var propKey = 'FOLDER_ID_INBOX_' + groupLabel.replace(/\s+/g, '_');
    props.setProperty(propKey, sub.getId());
    Logger.log('Inbox/' + groupLabel + ' (' + sub.getId() + ')');
  });

  Logger.log('Folder setup complete.');
}

function getOrCreateChildFolder_(parent, name) {
  var existing = parent.getFoldersByName(name);
  if (existing.hasNext()) {
    return existing.next();
  }
  return parent.createFolder(name);
}

/**
 * Installs the weekly Monday trigger for runWeeklyBatch. Safe to re-run —
 * removes any existing runWeeklyBatch trigger first so this never creates
 * duplicates.
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeeklyBatch') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runWeeklyBatch')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();
  Logger.log('Weekly trigger installed (Mondays, ~6am script timezone).');
}

/**
 * Setup.gs — one-time (idempotent) folder + trigger setup. Run
 * setupFolders() once after deploying, then setupTriggers() to install the
 * Monday batch trigger and the daily status-sync trigger — without both,
 * "automatic" only covers filing new specs, not moving reviewed ones.
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
 * Installs both recurring triggers. Safe to re-run — removes any existing
 * triggers for these two handlers first so this never creates duplicates.
 *
 * - runWeeklyBatch: Mondays, ingests Inbox/ screenshots into specs.
 * - syncStatuses: daily, moves docs to Approved/Rejected once you've
 *   edited their [STATUS: ...] tags — without this, syncing only happens
 *   when someone remembers to run it manually.
 */
function setupTriggers() {
  ['runWeeklyBatch', 'syncStatuses'].forEach(function (handler) {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === handler) {
        ScriptApp.deleteTrigger(t);
      }
    });
  });

  ScriptApp.newTrigger('runWeeklyBatch')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();

  ScriptApp.newTrigger('syncStatuses')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log('Triggers installed: runWeeklyBatch (Mondays ~6am), syncStatuses (daily ~8am), script timezone.');
}

/**
 * StatusSync.gs — reads "[STATUS: ...]" tags per spec §8 and moves docs
 * between folders. Routing policy (Open Issue #2 in docs/open-issues.md,
 * resolved 2026-07-02): route on the pain point's status alone; solution
 * statuses travel with the doc into backlog intake and do not gate the
 * folder move.
 */

var STATUS_TAG_REGEX = /\[STATUS:\s*([A-Za-z-]+)\]/g;

/**
 * Scans Pending-Review/ and Needs-Edit/, moves each doc per its parsed
 * status. Malformed/missing tags are left in place and logged rather than
 * guessed at. Idempotent — re-running on an already-correctly-filed doc
 * is a no-op (moveFileToFolder_ skips files already in the target).
 */
function syncStatuses() {
  ['PENDING_REVIEW', 'NEEDS_EDIT'].forEach(function (key) {
    var folder = getFolder(key);
    var files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
    while (files.hasNext()) {
      var file = files.next();
      try {
        syncOneDoc_(file);
      } catch (e) {
        logEvent('StatusSync', file.getId(), 'ERROR', 'Sync failed: ' + e.message);
      }
    }
  });
}

function syncOneDoc_(file) {
  var text = DocumentApp.openById(file.getId()).getBody().getText();
  var statuses = parseDocStatuses(text);
  if (!statuses) {
    logEvent('StatusSync', file.getId(), 'WARN', 'Missing or malformed [STATUS: ...] tags — left in place');
    return;
  }
  var targetKey = resolveTargetFolder(statuses);
  if (!targetKey) return; // Pending, or an inconsistent state flagged for manual review — stays put
  moveFileToFolder_(file, getFolder(targetKey));
}

/**
 * @param {string} docText Full text of a spec doc (DocumentApp Body.getText()).
 * @returns {?{painPoint: string, solutions: string[]}} null if no valid tags found.
 */
function parseDocStatuses(docText) {
  var matches = docText.match(STATUS_TAG_REGEX);
  if (!matches || matches.length === 0) return null;

  var statuses = matches.map(function (m) {
    var inner = m.match(/\[STATUS:\s*([A-Za-z-]+)\]/);
    return inner ? inner[1] : null;
  });

  if (statuses.indexOf(null) !== -1) return null;
  for (var i = 0; i < statuses.length; i++) {
    if (ENUMS.APPROVAL_STATUS.indexOf(statuses[i]) === -1) return null;
  }

  return { painPoint: statuses[0], solutions: statuses.slice(1) };
}

/**
 * @param {{painPoint: string, solutions: string[]}} statuses
 * @returns {?string} A FOLDER_NAMES key to move to, or null to leave in place.
 */
function resolveTargetFolder(statuses) {
  if (statuses.painPoint === 'Approved') {
    return 'APPROVED';
  }
  if (statuses.painPoint === 'Rejected') {
    if (statuses.solutions.indexOf('Approved') !== -1) {
      logEvent('StatusSync', null, 'WARN', 'Rejected pain point has an Approved solution — inconsistent, left in place for manual review');
      return null;
    }
    return 'REJECTED';
  }
  return null; // Pending -> stays in Pending-Review/ or Needs-Edit/
}

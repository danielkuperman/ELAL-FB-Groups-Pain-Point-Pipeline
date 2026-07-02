# FB Groups → Product Backlog Pipeline

Google Apps Script pipeline that turns manually-screenshotted Facebook group
posts into structured, PII-redacted product specs in Drive, per
`docs/spec.md`. Design plan and resolved/open decisions are in
`docs/coding-plan.md` and `docs/open-issues.md`.

## Layout

```
src/            Apps Script source (.gs files), pushed via clasp
src/appsscript.json   Apps Script manifest (scopes, timezone, runtime)
docs/spec.md            Original product spec
docs/coding-plan.md     Implementation plan / file-by-file breakdown
docs/open-issues.md     Edge cases, ambiguities, and decisions (resolved + open)
```

## One-time deployment

None of this can be done from an automated session — each step needs an
interactive Google OAuth login as Daniel. All commands below run locally.

1. **Install clasp** (if not already): `npm install -g @google/clasp`
2. **Log in**: `clasp login` — opens a browser, authorizes clasp against
   your Google account.
3. **Create the Apps Script project**, bound to this source:
   ```
   clasp create --type standalone --title "FB Groups Pain Point Pipeline" --rootDir ./src
   ```
   This writes a real `.clasp.json` with your new `scriptId` at the repo
   root (`.clasp.json` is gitignored — see `.clasp.json.example` for the
   shape). Alternatively, create the project at script.google.com first and
   copy its script ID into `.clasp.json` yourself.
4. **Push the code**: `clasp push`
5. **Set the Gemini API key**: open the project in the Apps Script editor
   (`clasp open`) → Project Settings → Script Properties → add
   `GEMINI_API_KEY` with a key you generate yourself (Google AI Studio or
   Cloud Console). Never commit this key or paste it into a chat/doc.
6. **Run `setupFolders()`** once from the Apps Script editor (select the
   function in `Setup.gs`, click Run). First run will prompt you to
   authorize the script's Drive/Docs/Sheets scopes — that's expected.
   Creates all pipeline subfolders (including `Inbox/Group A/` and
   `Inbox/Group B/`) inside the root folder
   (`ROOT_INTAKE_FOLDER_ID` in `Config.gs`, currently the
   ["FB-groups-intake"](https://drive.google.com/drive/u/0/folders/1PBf_pqjlkpplkQ0hmfm5bRzjW6f9UIa0)
   folder Daniel created).
7. **Test each stage in isolation** using `Debug.gs` before trusting the
   full batch — see the build/verification order in `docs/coding-plan.md`.
   Drop a couple of real sample screenshots into `Inbox/Group A/` or
   `Inbox/Group B/` and run `debugExtractOne(fileId)`,
   `debugRedactOne(fileId)`, `debugSpecGenOne(fileId, 'Group A')`, then
   `debugFullPipelineOne(fileId, 'Group A')` (does not delete the source
   screenshot, unlike the real batch).
8. **Run `setupTriggers()`** once to install the Monday weekly trigger for
   `runWeeklyBatch`.

## Weekly usage

Drop screenshots into `Inbox/Group A/` or `Inbox/Group B/` (whichever group
the post is from) any time during the week. The Monday trigger runs
`runWeeklyBatch()`, which files specs into `Pending-Review/` or
`Not-Actionable/`. After reviewing, edit each doc's `[STATUS: Pending]`
tags to `Approved`/`Rejected`/keep `Pending`, then run `syncStatuses()`
(manually, or wire up your own trigger) to move docs into `Approved/` or
`Rejected/`.

## Known gaps

See `docs/open-issues.md` for the full list — notably: HEIC screenshot
support is unverified, redaction is a best-effort regex pass (not a
guarantee), and the dedup similarity threshold is untuned against real
data.

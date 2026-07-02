# Coding Plan: FB Groups → Product Backlog Pipeline

Companion to `docs/spec.md` (Section 10 in particular). This expands the spec's
build order into concrete files, function signatures, sequencing, and the
infrastructure decisions the spec leaves implicit. See `docs/open-issues.md`
for the ambiguities and edge cases that should be resolved (by Daniel) before
or during each phase.

Note: this repo currently has no prior code (the "Fathom→Gemini" pipeline the
spec says to mirror isn't available here) — see Open Issue #10. The plan below
assumes standard Apps Script + clasp conventions until that project is
provided.

## 0. Project scaffold

```
/
├── .clasp.json            # scriptId, rootDir
├── appsscript.json         # manifest: scopes, timezone, advanced services
├── src/
│   ├── Config.gs
│   ├── Setup.gs
│   ├── VisionExtract.gs
│   ├── Redact.gs
│   ├── SpecGen.gs
│   ├── DocBuilder.gs
│   ├── StatusSync.gs
│   ├── Dedup.gs           # split out of SpecGen per §7 (see below)
│   ├── Logger.gs           # not named in spec §10 but required by its own
│   │                       #  error-handling section — see Open Issue #9
│   ├── Main.gs
│   └── Debug.gs
```

Required OAuth scopes: `drive`, `documents`, `script.external_request`
(Gemini calls), `script.scriptapp` (triggers). Gemini API key stored in
`PropertiesService.getScriptProperties()`, never hardcoded in `Config.gs`.

## 1. Config.gs + Setup.gs

**Config.gs**
- `FOLDER_IDS` — object with keys for all folders in spec §4 **plus** the two
  folders referenced only in §10/error-handling and never added to §4's list:
  `Failed-Extraction/` and `Needs-Manual-Review/` (Open Issue #9). Resolve IDs
  lazily via `Setup.gs`, cache in Script Properties.
- `GEMINI_CONFIG` — model name(s) for vision vs. reasoning calls, endpoint,
  timeout, retry count.
- Enum constants as frozen arrays: `PLATFORM`, `JOURNEY_STAGE`, `POST_TYPE`,
  `SEVERITY`, `FREQUENCY`, `SOLUTION_CATEGORY`, `EFFORT`, `IMPACT`,
  `APPROVAL_STATUS`. These are the single source of truth used both to build
  Gemini prompts (injected schema) and to validate Gemini's JSON output.
- `SPEC_ID_PREFIX = "FB-"` and the counter mechanism (see below).

**Spec ID generation.** Apps Script has no atomic auto-increment primitive.
Use `LockService.getScriptLock()` around a read-increment-write on a Script
Property (or a dedicated "Counters" row in a control Sheet, if a Sheet is
already needed for logging — see Logger.gs). This matters once the weekly
trigger and a manual Debug run could overlap (Open Issue #7).

**Setup.gs**
- `setupFolders()` — idempotent: creates any missing folder under a root
  `FB-Intake/` folder, writes resulting IDs to Script Properties, safe to
  re-run. Root parent folder (Daniel's Drive, under which `FB-Intake/` and
  its subfolders get created):
  `https://drive.google.com/drive/u/0/folders/11Ik2P7yxe83BtP7ErKXsDx00QDjJDiKY`
  (folder ID `11Ik2P7yxe83BtP7ErKXsDx00QDjJDiKY`) — hardcode this as
  `ROOT_PARENT_FOLDER_ID` in `Config.gs`, resolved via
  `DriveApp.getFolderById(...)`.
- `setupTriggers()` — installs the Monday time-based trigger for
  `runWeeklyBatch` and (if chunking is needed, see §6 below) any
  continuation trigger.

**Done when:** running `setupFolders()` on a clean Drive produces the full
folder tree and `Config.gs` can resolve every folder by name.

## 2. VisionExtract.gs

```js
function extractFromScreenshot(fileId) -> {
  post_text, comments[], visible_platform_hints, visible_date
} | throws ExtractionError
```

- Reads the Drive file as bytes, base64-encodes, calls Gemini vision with the
  §6.1 prompt.
- Strips markdown fences defensively before `JSON.parse` (models sometimes
  wrap JSON in ```json fences despite instructions).
- On parse failure or missing required keys: retry once with a stricter
  "return valid JSON only" reminder appended; on second failure, throw
  `ExtractionError` — caller (Main.gs) routes the file to `Failed-Extraction/`
  rather than crashing the batch, per spec's error-handling requirement.
- Does **not** attempt HEIC→JPEG conversion or multi-image stitching in v1 —
  flag as Open Issue #3 (iOS screenshots are frequently HEIC; Gemini's vision
  input support for HEIC should be verified before this is assumed to work).

**Done when:** tested standalone (via `Debug.gs`) against 2–3 real sample
screenshots per spec's own build-order guidance, producing correctly
shaped JSON with no names leaking into `post_text`/`comments`.

## 3. Redact.gs

```js
function redactContent(extractedObj) -> cleanedObj
```

- Deterministic second pass per §6.2: regex for name-adjacent-to-greeting
  patterns, regex for any `facebook.com/*`-style URL (also match `fb.com`,
  `m.facebook.com`, `mbasic.facebook.com` — Open Issue #4).
- Also strip email addresses and phone-number-shaped strings encountered in
  post/comment text — not explicitly in §6.2 but required by §2's "PII
  redaction is mandatory and non-negotiable," which is broader than just
  names/photos/links (Open Issue #4).
- `Logger.gs` records *that* a redaction fired (file id, field, pattern
  category) without storing the matched substring itself, per spec.
- Runs on the vision-extracted **text only**. It has no ability to redact
  PII baked into screenshot pixels (embedded boarding passes, profile
  photos) — see Open Issue #1, which is the most consequential gap in the
  spec as written.

**Done when:** run against VisionExtract output for a small human-curated
test set that intentionally includes tricky cases (mid-sentence names,
non-English names, alternate FB URL formats) and 0 PII strings survive.

## 4. SpecGen.gs + Dedup.gs

```js
function generateSpec(redactedObj, existingSpecsIndex) ->
  specObj | { actionable: false, reason }
```

- Calls Gemini reasoning with §6.3 prompt, schema injected from `Config.gs`
  enums (not hand-copied into the prompt string, to avoid drift between
  prompt and validator).
- **Validate, don't trust:** after parsing, check every enum field against
  `Config.gs` allow-lists (case-insensitive match, then normalize), check
  `solutions.length` is between 1 and 4 for actionable specs, check pain
  point description is non-empty. Any failure → treat like a parse failure
  (retry once, then `Needs-Manual-Review/`).
- `existingSpecsIndex` is built by `Dedup.gs` from `Pending-Review/` +
  `Approved/` doc titles/pain-point text (§7 explicitly excludes
  `Rejected/` — flagged as Open Issue #6, since it means a previously
  rejected complaint can resurface with no signal that it was already
  rejected).

**Dedup.gs**
```js
function buildExistingSpecsIndex() -> [{specId, painPointText, journeyStage}]
function findRelatedSpecs(newPainPointText, index) -> [specId, ...]
```
- v1: keyword + journey-stage overlap heuristic (cheap, no extra API calls,
  matches the spec's "simpler heuristic to start" option).
- v2 (if heuristic proves too noisy/quiet in practice): Gemini embeddings,
  cosine similarity, embeddings cached per spec (e.g., in Script Properties
  or a control Sheet keyed by Spec ID) so they aren't recomputed every run.
- Similarity threshold is not defined by the spec — starts as a tunable
  constant in `Config.gs`, expected to need calibration against real data
  (Open Issue #6).

**Done when:** run against redacted sample text, output validated
field-by-field against the §5 schema, dedup heuristic produces sane
`Related specs` links on a small set of intentionally-similar test inputs.

## 5. DocBuilder.gs

```js
function buildSpecDoc(specObj) -> {docId, fileName}
function buildNotActionableDoc(obj) -> {docId, fileName}
```

- Filename: `[Severity]-[Platform]-ShortTitle-YYYYMMDD`. Sanitize
  `ShortTitle` (strip `/ \ : * ? " < > |`, truncate length) and disambiguate
  collisions by appending the Spec ID (Open Issue #7) since severity +
  platform + date + a short title is not guaranteed unique.
- Body: field labels per §5, one `[STATUS: Pending]` tag per approvable
  field — pain point and each solution — written as **plain text on its own
  line** with a fixed, greppable prefix (`[STATUS: `) so `StatusSync.gs` can
  parse with a simple regex regardless of surrounding rich-text formatting.
- Store `Spec ID` and a machine-readable field index (which paragraph is
  which status tag) in the Doc's own properties or a leading hidden-ish
  metadata line, so `StatusSync.gs` doesn't have to rely purely on prose
  order matching §5 field order.

**Done when:** a generated doc is visually clean, every status tag is
findable by exact regex `\[STATUS:\s*(\w[\w-]*)\]`, and round-tripping
(build → manually edit a tag → re-read) gives the expected parsed value.

## 6. StatusSync.gs

```js
function syncStatuses() // scans Pending-Review/ + Needs-Edit/
function parseDocStatuses(docId) -> {painPoint: status, solutions: [status,...]}
function resolveTargetFolder(statuses) -> folderKey
```

- **Blocked on a decision the spec itself flags as unresolved:** what
  folder does a doc land in when pain point is Approved but only some
  solutions are Approved (others Pending/Rejected)? The spec's own §10 text
  says "consider whether partial approval needs a note — flag this as a
  design question back to Daniel if ambiguous." This *is* ambiguous — see
  Open Issue #2. Do not finalize `resolveTargetFolder`'s logic until that's
  answered; build the parsing/reading half first (independent of the
  routing decision) and stub routing behind a single function so the
  decision only touches one place.
- Malformed or missing status tags (typo'd status word, tag deleted by
  accident): doc is left in place, logged to `Logger.gs`, not silently
  mis-routed.
- Idempotent: re-running `syncStatuses()` on an already-moved doc should be
  a no-op, not an error (a doc that's already in `Approved/` with all-approved
  tags shouldn't be treated as needing another move each run).

**Done when:** unit-style tests via `Debug.gs` cover: all-approved →
Approved/, any-rejected pain point → Rejected/, mixed solution statuses
(routing per whatever policy gets decided) → correct folder, malformed tag
→ left in place + logged.

## 7. Main.gs

```js
function runWeeklyBatch() // trigger entry point
function processOneFile(fileId) // extract → redact → generate → dedup → file → archive
```

- Iterates `Inbox/` files; each file processed independently inside its own
  try/catch so one bad screenshot never aborts the batch (spec requirement).
- **Execution-time budget:** Apps Script caps a single trigger execution at
  6 minutes. A weekly batch of a few dozen screenshots, each needing 2+
  Gemini calls (vision + reasoning, sometimes a dedup embedding call), can
  plausibly exceed that. `runWeeklyBatch` should process a bounded number
  of files per invocation and, if `Inbox/` still has unprocessed files when
  time runs low (`Utilities` elapsed-time check against a ~5 min soft
  limit), install a one-off continuation trigger a minute out and return
  cleanly rather than getting hard-killed mid-file (Open Issue #7). This is
  not mentioned in the spec's build order at all.
- **Idempotency / partial-failure safety:** a file should only move out of
  `Inbox/` once its doc has been successfully filed. Don't archive to
  `Processed-Raw/` before the doc exists — if the run dies between those two
  steps, a re-run would otherwise either double-file or silently lose the
  source screenshot. Recommended order per file: extract → redact →
  generate → dedup → **build doc** → **then** move screenshot to
  `Processed-Raw/`. If doc-build succeeds but archiving fails, that's a safe
  state to detect and retry (doc exists, screenshot lingering in Inbox) —
  make `processOneFile` tolerant of "doc already filed for this source" so
  a retry doesn't create a duplicate doc.
- `Processed-Raw/` contradiction (Open Issue #1) is resolved: it stores the
  **redacted transcript only**. `processOneFile` writes the redacted JSON/
  text object there (e.g. as a small Doc or JSON blob) and **deletes** the
  original screenshot from Drive (`file.setTrashed(true)` or hard delete)
  once that transcript + the spec doc are both filed successfully — the
  raw image with PII in its pixels does not persist anywhere past
  extraction.

**Done when:** a run over a small batch (including one intentionally
malformed screenshot) produces the correct docs in the correct folders,
moves/archives correctly, and the one bad file lands in
`Failed-Extraction/` without affecting the others.

## 8. Debug.gs

Manual runners, one per stage, each operating on a single file/object so a
stage can be validated without running the full batch:
`debugExtractOne(fileId)`, `debugRedactOne(fileId)`, `debugSpecGenOne(fileId)`,
`debugDocBuildOne(specObj)`, `debugStatusSyncDryRun()` (reads and logs
parsed statuses without moving anything).

## 9. Logger.gs (addition to spec's file list — Open Issue #9)

`logEvent(stage, fileId, level, message)` appending to a control Sheet
(`Pipeline-Log`), used by every other file's catch blocks. Keep messages
PII-free by construction (never interpolate raw extracted text into a log
message — log field names/lengths/booleans, not content).

## Suggested build/verification order

Matches the spec's own recommended order (§10), with two insertions:

1. Config.gs + Setup.gs
2. **Resolve Open Issue #2 with Daniel** (partial-approval routing) — still
   blocks `StatusSync.gs`'s routing logic. (Open Issue #1 — Processed-Raw
   contents — and the Drive root folder location are now resolved; see
   `docs/open-issues.md`.)
3. VisionExtract.gs — test on 2–3 real sample screenshots
4. Redact.gs — test on VisionExtract output
5. SpecGen.gs + Dedup.gs — test on redacted sample text
6. DocBuilder.gs — confirm status tags are unambiguous to parse
7. StatusSync.gs — build/test read-back + move logic (routing policy now
   resolvable per step 2)
8. Main.gs — wire together with chunked/continuation-safe batch loop
9. Add the Monday time trigger last, as the spec specifies

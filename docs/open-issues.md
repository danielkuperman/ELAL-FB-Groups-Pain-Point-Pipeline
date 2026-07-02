# Open Issues, Edge Cases & Gaps in the Spec

Ranked roughly by how much they block correct/safe behavior. Items marked
**[DECISION NEEDED]** should go back to Daniel before or during the build;
the rest are edge cases to design/handle in code, listed so nothing gets
discovered mid-build.

## 1. [RESOLVED] `Processed-Raw/` contradicts the PII guarantee

**Decision (Daniel, 2026-07-02):** store the redacted transcript and delete
the raw screenshot after successful extraction — i.e. option (a) below.
`Processed-Raw/` never holds a raw image; the source screenshot is deleted
from Drive once its redacted transcript and spec doc are both filed. See
`docs/coding-plan.md` §7 (Main.gs).

<details>
<summary>Original analysis</summary>


- §4 describes `Processed-Raw/` as holding **"redacted text only"**.
- §10's `Main.gs` description says to **"archive raw screenshot to
  `Processed-Raw/`."**
- These can't both be true. The raw screenshot *image* itself contains PII
  in its pixels — the commenter's name and profile photo as rendered by the
  Facebook UI — regardless of what the text-extraction/redaction steps do
  to the *transcribed text*. Redaction (§6.2) only ever touches
  `extractedObj`'s text fields; it has no mechanism to redact an image.
- This directly conflicts with §2: "PII redaction is mandatory and
  non-negotiable... must never persist past the extraction step."
  If the raw screenshot is archived, PII persists indefinitely in Drive,
  past the extraction step, in violation of that constraint.
- **Options:**
  a. `Processed-Raw/` stores a redacted-text transcript (JSON/Doc) only;
     the original screenshot is deleted after successful extraction.
  b. The raw screenshot is kept, but in a locked-down, short-retention
     location, and §2's language is understood as applying only to the
     *structured spec output*, not the audit trail — i.e., a deliberate,
     scoped exception. This weakens the "non-negotiable" guarantee and
     should be an explicit, conscious call, not a byproduct of two
     sections of the spec disagreeing.
  c. Keep the raw screenshot but auto-delete after N days/weeks (time-boxed
     audit trail instead of indefinite).
- Recommend (a): it's what §4 already says, it satisfies §2 without caveats,
  and Daniel manually holds the original screenshots on his device/upload
  source anyway if a true original is ever needed.

</details>

## 2. [RESOLVED] Partial-approval routing (flagged by the spec itself)

**Decision (Daniel, 2026-07-02):** locked in the recommended policy below —
route on the pain point's status alone; solution statuses travel with the
doc and don't gate the folder move.

<details>
<summary>Original analysis</summary>


§10 explicitly says: "moves files to the correct folder based on combined
pain-point + solutions status (e.g. all approved → `Approved/`; ... consider
whether partial approval needs a note — flag this as a design question back
to Daniel if ambiguous)." It is ambiguous. Concrete case: pain point
Approved, 2 of 3 solutions Approved, 1 Rejected. Or: pain point Approved,
all solutions still Pending. Questions to resolve:

- Does the doc move to `Approved/` as soon as the **pain point** is
  Approved, independent of per-solution status (solutions just carry their
  own status forward into backlog intake)?
- Or does the doc stay in `Needs-Edit/`/`Pending-Review/` until every field
  (pain point + all solutions) has a non-Pending status?
- If a doc has zero Rejected and zero Pending but a mix of Approved
  solutions plus explicitly-Rejected ones — does that still count as fully
  resolved (Rejected is a terminal state, not a blocker) and route to
  `Approved/`?
- Does `Rejected/` mean "the whole pain point rejected" only, or can a spec
  end up with a Rejected pain point but Approved solutions (contradiction —
  should probably be disallowed/flagged rather than silently filed)?

Recommend as a starting policy (confirm with Daniel): route on the **pain
point's** status alone (Approved→`Approved/`, Rejected→`Rejected/`,
anything else including any Pending solution→stays in
`Pending-Review/`/`Needs-Edit/`); individual solution statuses travel with
the doc into backlog intake as-is and don't gate the folder move. This
avoids specs sitting in limbo forever waiting for every last solution to be
triaged.

</details>

## 3. Vision extraction edge cases

- **iOS screenshots may be HEIC.** Untested whether Gemini's vision input
  accepts HEIC directly; may need conversion to PNG/JPEG before the API
  call.
- **Multi-post or scrolling-capture screenshots.** The schema assumes one
  screenshot = one post + its comments. A screenshot spanning multiple
  posts, or a long comment thread split across several screenshots, isn't
  addressed. Need either an ingestion convention (e.g., matching filenames
  like `postA-1.png`, `postA-2.png` to indicate "same thread, part N") or
  a rule that Daniel keeps screenshots to one post each.
- **Embedded PII inside the *content* of a post**, not just the FB chrome —
  e.g., someone posts a photo of their boarding pass or booking
  confirmation showing full name/PNR as part of describing the bug. The
  vision prompt (§6.1) only asks to omit names in surrounding *comment
  text*; it says nothing about describing/redacting PII visible in an
  attached image-within-the-screenshot. This compounds Issue #1.
- **Illegible/blurry screenshots** risk the vision model hallucinating
  plausible-looking but wrong text rather than failing cleanly. No
  confidence signal is requested from Gemini in §6.1; consider asking it to
  return a `confidence` or `legible: bool` field so low-confidence extracts
  can route to `Needs-Manual-Review/` instead of silently generating a spec
  from guessed text.
- **Non-English posts** (groups likely have Hebrew/other-language members
  given this is an airline's group). Spec doesn't say whether extraction
  should translate or preserve original language, and downstream severity/
  frequency reasoning in SpecGen assumes English-quality nuance.
- **Gemini safety-filter refusals** on sensitive content (medical
  emergencies, discrimination complaints, self-harm mentions in a
  travel-disruption context) aren't addressed as a distinct failure mode
  from "malformed JSON" — worth its own handling path since a retry won't
  fix a refusal.
- **Non-post screenshots** accidentally dropped (memes, group rules,
  unrelated photos) — should resolve to `Not-Actionable/` via SpecGen's
  `actionable:false` path, but only if extraction succeeds enough to reach
  that stage; a screenshot with no legible text at all needs to fail out
  before SpecGen rather than being sent in as empty input.
- **Accidental duplicate drops** (same screenshot uploaded twice) will
  currently produce two independent specs with no linkage, since Dedup only
  compares *generated* pain-point text, and near-identical source images
  would generate near-identical text — likely caught by dedup as
  "related," but not deduped outright (spec explicitly says don't merge/
  block filing, so this may be acceptable, just worth confirming it's
  intended for exact re-drops too, not only genuinely-separate reports of
  the same underlying bug).

## 4. Redaction edge cases

- §6.2's regex approach ("common name patterns adjacent to greetings")
  will miss names introduced without a greeting — e.g., "As John mentioned
  above..." or "my friend Sarah had this too" — anywhere a name appears
  mid-sentence without a greeting cue.
- Regex name-matching tuned for English given-names will under- or
  over-match names in other scripts/naming conventions likely present in
  these groups.
- §6.2 only lists `facebook.com/*` for URL stripping — misses `fb.com`,
  `m.facebook.com`, `mbasic.facebook.com`, `fb.watch`, and share-link
  redirects, all of which can carry profile/identity info.
- §2's "PII redaction is mandatory and non-negotiable" is broader than
  "names, profile photos, profile links" (§2's own examples) — phone
  numbers and email addresses volunteered in a complaint's text (e.g. "call
  me at ...") are PII too and aren't in §6.2's scope as written.
- Risk of **false positives**: a redaction pass aggressive enough to catch
  varied name patterns can misfire on airline/place/product names that look
  like personal names (destinations, competitor brand names). Needs a small
  labeled test corpus to tune against before trusting it on real data.
- Redaction runs on text only (see Issue #1/#3) — cannot touch PII baked
  into any images that persist past this stage.

## 5. Spec generation edge cases

- **Schema drift.** LLM JSON output won't always match the schema exactly
  (extra/missing fields, wrong enum casing, e.g. `"feature request"` vs
  `"Feature Request"`). Spec doesn't call for a validation step beyond "JSON
  shape matches Section 5" during manual testing — needs to be a runtime
  check on every call, not just a one-time manual verification during
  build, with defined fallback (retry → `Needs-Manual-Review/`).
- **Multiple distinct pain points in one post/thread.** E.g. a post
  complaining about both a booking bug and a separate check-in bug in the
  same comment thread. Schema is one spec per screenshot/post — no policy
  for splitting vs. conflating multiple issues into one narrative.
- **`existingSpecsIndex` scaling.** Stuffing every prior pending+approved
  pain-point description into the prompt for cross-reference works early on
  but grows unbounded over weeks/months, eventually blowing prompt-length
  and cost budgets. No cap or summarization strategy specified.
- **Severity/Frequency consistency over time** — definitions are given but
  no calibration examples; different weekly batches (different Gemini
  sessions, no memory between them) may drift in how strictly "blocks a
  core task" gets applied. Worth a small set of few-shot examples embedded
  in the prompt once real data exists.
- **Zero solutions returned** for an actionable spec (schema wants 1–4) —
  needs explicit validation + retry, not just a documentation note in the
  prompt.

## 6. Dedup / cross-reference open questions

- **Similarity threshold is undefined** ("if similarity crosses a
  threshold") — needs an actual number/tunable, and will need calibration
  against real specs once volume exists.
- §7 only checks `Pending-Review/` + `Approved/`. A near-duplicate of a
  previously **Rejected** complaint will file as new with no "this was
  already rejected, here's why" signal — likely worth including
  `Rejected/` in the corpus too, purely for visibility (still "do not
  merge/block filing," just surface the history).
- **Linking direction:** does filing a new related spec also update the
  *older* spec's `Related specs` field (bidirectional), or is the link
  one-way from new→old only? Retroactively editing an already-`Approved/`
  doc to add a backlink is a mutation of a "finished" artifact and may be
  undesirable/surprising.
- **Storage for embeddings** (if the embedding-based option is used instead
  of the keyword heuristic) isn't specified — Apps Script has no vector DB;
  would need embeddings cached in a control Sheet/Script Properties and
  compared via manual cosine similarity, which only scales to a few hundred
  specs before becoming slow inside a 6-minute execution budget.

## 7. Filing / Spec ID / filename edge cases

- **Filename collisions:** `[Severity]-[Platform]-ShortTitle-YYYYMMDD` has
  no uniqueness guarantee — two same-day, same-platform, same-severity
  complaints with a similarly-generated short title collide. Needs the
  Spec ID appended or a collision check before doc creation.
- **Spec ID counter race condition:** Apps Script has no atomic
  auto-increment; concurrent executions (weekly trigger firing while a
  manual `Debug.gs` run or a continuation-trigger run is also active) could
  generate duplicate IDs without an explicit lock (`LockService`).
- **Filename-illegal characters** in an LLM-generated `ShortTitle` (slashes,
  colons, quotes) need sanitizing before doc creation.
- If Daniel **manually renames** a filed doc (people do this), does
  `StatusSync.gs`'s Spec ID lookup still work? Should rely on a Spec ID
  stored in the doc body/properties, not solely on parsing the filename.

## 8. Orchestration / scale limits (not addressed in spec's build order)

- **Apps Script's 6-minute execution cap.** A weekly batch of even a
  modest number of screenshots, each requiring 2+ Gemini calls, can
  plausibly exceed this. The spec's `Main.gs` description doesn't mention
  chunking or continuation triggers at all — needs to be designed in,
  not bolted on later.
- **Partial-batch failure/idempotency.** If a run dies mid-batch (timeout,
  quota error), files must not be double-processed or lost on the next
  run. Requires processing order where a screenshot only leaves `Inbox/`
  after its doc is confirmed filed.
- **UrlFetchApp/Gemini quota** — Apps Script has daily URL-fetch quotas;
  worth knowing expected weekly screenshot volume to confirm this is a
  non-issue (likely fine at "weekly batch" scale, but not validated here).

## 9. Documentation gaps in the spec itself

- `Failed-Extraction/` (mentioned in §10's `VisionExtract.gs` description)
  and `Needs-Manual-Review/` (mentioned in §10's error-handling section)
  are never added to §4's canonical folder list. Both need to actually
  exist in `Setup.gs`/`Config.gs`.
- The error-handling section requires logging failures "to a running Sheet
  or Doc" but no file in §10's list owns this (`Logger.gs` isn't listed) —
  proposed as an addition in `docs/coding-plan.md`.
- Gemini API key/credential storage isn't mentioned — should be
  `PropertiesService`, not a literal in `Config.gs`.

## 10. External dependency the plan currently can't verify

- The spec says to mirror "the Fathom→Gemini meeting summarizer pipeline"'s
  file structure and patterns, but that project isn't present in this repo
  (repo was empty at the start of this task). The coding plan follows
  standard Apps Script/clasp conventions instead. If specific conventions
  from the Fathom project (naming, error-handling helpers, deployment
  scripts) should be reused verbatim, point me at that repo/its files.
- No sample screenshots or existing specs exist yet to test against — each
  build-order phase in `docs/coding-plan.md` that says "test against sample
  screenshots" needs Daniel to supply a handful of representative real (or
  realistic mock) screenshots, including at least one deliberately messy
  one (blurry, non-English, multi-issue) to exercise the edge cases above.

## 11. [RESOLVED] Drive root location for the intake folder tree

**Decision (Daniel, 2026-07-02):** Daniel created the root folder himself:
`https://drive.google.com/drive/u/0/folders/1PBf_pqjlkpplkQ0hmfm5bRzjW6f9UIa0`
named **"FB-groups-intake"**. This folder **is** the pipeline root itself
(not a parent to nest another folder under) — `setupFolders()` creates
`Inbox/`, `Processed-Raw/`, `Pending-Review/`, `Needs-Edit/`, `Approved/`,
`Rejected/`, `Not-Actionable/`, `Failed-Extraction/`, and
`Needs-Manual-Review/` directly inside it. `ROOT_INTAKE_FOLDER_ID` in
`Config.gs` is set to `1PBf_pqjlkpplkQ0hmfm5bRzjW6f9UIa0`.

## 12. [RESOLVED] Nothing in the pipeline determines "Source group"

Found while implementing `SpecGen.gs`: §5's schema requires `Source group`
(`Group A`/`Group B`), but neither the §6.1 vision prompt nor the §6.3
reasoning prompt asks for or can reliably infer which of the two groups a
screenshot came from — the redacted post/comment text has no group
identifier in it, and asking Gemini to guess would be unreliable.

**Fix implemented:** `Inbox/` is split into `Inbox/Group A/` and
`Inbox/Group B/` subfolders (`Setup.gs`). Daniel drops each screenshot into
the correct one; `Main.gs`'s `collectInboxQueue_()` reads the source group
from which subfolder a file came from and passes it into
`SpecGen.generateSpec()` as a trusted parameter — Gemini is no longer asked
to produce `sourceGroup` at all.

## 13. Lightly flagged, not blocking

- Screenshotting private group content for internal product use likely sits
  fine within the group's/Meta's ToS for personal use, but wasn't asked
  about — flagging once, not a legal opinion.
- Access to the Drive folder tree and the script itself should probably be
  restricted to Daniel (and whoever else reviews specs), since even
  redacted complaints are sensitive customer/business content.

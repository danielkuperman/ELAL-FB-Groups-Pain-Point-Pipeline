# Product Spec: Facebook Groups → Product Backlog Pipeline

**Owner:** Daniel, VP Product
**Status:** Ready for build
**Stack pattern:** Google Apps Script + clasp + Gemini API (same pattern as the Fathom→Gemini meeting summarizer pipeline)

---

## 1. Problem Statement

Two private Facebook groups (10K+ members each, active daily) contain a continuous, unfiltered stream of real user pain: bugs, broken flows, and friction across our mobile app and website. This signal never reaches the backlog in a structured way — it's scattered across posts and comment threads, mixed with praise and off-topic noise, and requires manual reading to extract anything actionable.

**Goal:** Turn raw screenshots of group posts into structured, evidence-backed product specs — pain point + candidate solutions — that a VP can approve or reject in minutes, with output ready to feed the existing backlog process.

## 2. Constraints (read before building)

- **Meta's Groups API is fully deprecated** (removed in all versions as of April 22, 2024). There is no programmatic read access to group posts/comments, for public or private groups. Do not attempt Graph API calls against groups — they will fail.
- **Private group + personal membership** means ingestion must be human-initiated. Daniel manually screenshots posts/threads that look like genuine product complaints. This is not a scraping pipeline.
- **PII redaction is mandatory and non-negotiable.** Commenter names, profile photos, and profile links must never persist past the extraction step. Only content survives into the spec.
- **Weekly cadence.** This is a batch process, not real-time.

## 3. High-Level Flow

```
[Daniel screenshots posts/threads]
        ↓
[Drive/FB-Intake/Inbox/]  ← manual drop, any time during the week
        ↓ (weekly trigger, Monday)
[VisionExtract.gs] → Gemini vision → raw text (post + comments, platform hints, approx date)
        ↓
[Redact.gs] → strips names/photos/profile links → content-only object
        ↓
[SpecGen.gs] → Gemini reasoning → structured spec (pain point + solutions drafted together)
        ↓
[Dedup/CrossRef check] → soft "possibly related to" link against existing specs
        ↓
[DriveFile.gs] → Google Doc created, filed by type:
   - Pending-Review/   (actionable, awaiting approval)
   - Not-Actionable/   (praise, off-topic, refund-only — with 1-line reason)
        ↓
[Daniel reviews weekly] → marks pain point + each solution Approved/Rejected/Needs-Edit
        ↓
[Status sync] → doc moved to Approved/ / Rejected/ / Needs-Edit/ accordingly
```

Monday.com sync is explicitly **out of scope for this phase** — Drive is the system of record for now.

## 4. Folder Structure (Google Drive)

```
FB-Intake/
├── Inbox/                 ← raw screenshots land here
├── Processed-Raw/         ← archived after extraction (audit trail, redacted text only)
├── Pending-Review/        ← generated specs awaiting Daniel's approval
├── Needs-Edit/            ← partially approved / sent back
├── Approved/              ← fully approved specs, ready for backlog intake
├── Rejected/               
└── Not-Actionable/        ← praise / off-topic / no product angle, with reason
```

## 5. Spec Sheet Schema

One Google Doc per post. Filename convention: `[Severity]-[Platform]-ShortTitle-YYYYMMDD`

| Field | Type | Notes |
|---|---|---|
| Spec ID | string | auto-generated, e.g. `FB-0042` |
| Date captured | date | from screenshot metadata or extraction timestamp |
| Source group | enum | `Group A` / `Group B` — no member identifiers |
| Post type | enum | `Complaint` / `Question` / `Feature Request` |
| Platform | enum | `iOS` / `Android` / `Web` / `Unclear` |
| Journey stage | enum | `Booking`, `Check-in`, `Day of Travel`, `Post-flight`, `Support`, `Account`, `Payments`, `Other` |
| Pain point description | rich text | narrative, self-contained — must make sense to someone who never saw the original post |
| Severity | enum | `Low` / `Med` / `High` |
| Frequency | enum | `Low` / `Med` / `High` — inferred from corroborating comments ("same happened to me") |
| Evidence | text | paraphrased excerpts, anonymized, no verbatim names |
| Related specs | list of Spec IDs | soft cross-reference when root cause overlaps |
| Pain point approval | enum | `Approved` / `Rejected` / `Pending` |
| Solutions | list (1–N) | see below |

**Each solution:**

| Field | Type |
|---|---|
| Title | string |
| Description | rich text |
| Category | enum: `Quick Fix` / `Enhancement` / `Net-New` / `Moonshot` |
| Effort | enum: `S` / `M` / `L` |
| Impact | enum: `Low` / `Med` / `High` |
| Approval | enum: `Approved` / `Rejected` / `Pending` |

**Not-Actionable doc (shorter format):** Spec ID, date, source group, one-line reason (e.g. "Pure praise, no product angle" / "Refund complaint, not a product bug" / "Off-topic").

## 6. Gemini Prompts

### 6.1 Extraction prompt (vision, on screenshot)

```
You are extracting text from a screenshot of a Facebook group post and its comments.
Return raw JSON only, no markdown fences, no commentary.

Extract:
- post_text: the original post content, verbatim as visible
- comments: array of comment text strings, in the order shown (no author names)
- visible_platform_hints: any mention of iOS, Android, app version, or "website"
- visible_date: any date/timestamp shown, or null

Do NOT extract or include any names, profile photos, or profile links.
If a name is embedded in the post/comment text itself (e.g. "hi John, same happened to me"),
replace it with [name].
```

### 6.2 Redaction pass (deterministic, not Gemini)

Run a regex/allowlist pass after extraction as a second safety net — do not rely on the vision prompt alone to guarantee no PII survives. Strip anything matching common name patterns adjacent to greetings, and strip any URL matching `facebook.com/*` (profile links).

### 6.3 Spec generation prompt (reasoning)

```
You are a senior product analyst. You will receive redacted post + comment text from a
private airline customer Facebook group. Produce a structured product spec in JSON matching
this exact schema: [insert schema from Section 5].

Rules:
- Write the pain point description as a self-contained narrative — assume the reader never
  saw the original post.
- Severity: High = blocks a core task (booking, check-in, boarding) or causes financial harm.
  Med = degrades experience but has a workaround. Low = cosmetic/minor annoyance.
- Frequency: infer from number and tone of corroborating comments, not post count alone.
- Draft 1-4 solutions. Range from quick fix to more ambitious ideas — do not default to only
  one obvious fix. At least one solution should be a Quick Fix if a plausible one exists.
- If the post is praise, off-topic, or has no actionable product angle, return
  {"actionable": false, "reason": "<one line>"} instead of a full spec.
- Never include names or profile links in any field, even if present in the input.
```

## 7. Duplicate / Cross-Reference Logic

Before filing a new spec, compare its pain point description against existing specs in `Pending-Review/` + `Approved/` (e.g. embedding similarity via Gemini's embedding endpoint, or a simpler keyword/journey-stage overlap heuristic to start). If similarity crosses a threshold, add the matched Spec ID(s) to `Related specs` — **do not merge or block filing**. Each spec remains independently approvable per Daniel's decision.

## 8. Approval Mechanism

Each Google Doc includes an approval block (checkboxes or a status dropdown, whichever is more reliable to parse programmatically — recommend a simple `[STATUS: Pending]` text tag per field that Daniel edits directly, since Google Docs checkboxes are harder to read via API). A trigger (time-based or manual "Sync Status" run) reads all docs in `Pending-Review/` and `Needs-Edit/`, checks their status tags, and moves the file to the matching folder.

## 9. Out of Scope (this phase)

- Monday.com auto-sync (phase 2)
- Real-time/automated screenshot capture
- Any Graph API / Groups API integration
- Merging duplicate specs into one

---

## 10. Technical Instructions for Claude Code

**Project setup**

- New Apps Script project, managed via `clasp`, mirroring the Fathom pipeline's file structure.
- Files to create:
  - `Config.gs` — folder IDs (Inbox, Processed-Raw, Pending-Review, Needs-Edit, Approved, Rejected, Not-Actionable), Gemini API config, enum constants for Platform/JourneyStage/Category/Effort/Impact.
  - `VisionExtract.gs` — function `extractFromScreenshot(fileId)` → calls Gemini vision with the Section 6.1 prompt, returns parsed JSON. Handle non-JSON/malformed responses defensively (retry once, then flag to a `Failed-Extraction/` folder rather than crash the batch).
  - `Redact.gs` — function `redactContent(extractedObj)` → deterministic regex pass per Section 6.2, returns cleaned object. Log (without storing raw PII) when redaction actually strips something, for auditability.
  - `SpecGen.gs` — function `generateSpec(redactedObj, existingSpecsIndex)` → calls Gemini with Section 6.3 prompt, returns spec JSON or `{actionable: false, reason}`. Include `existingSpecsIndex` (lightweight list of prior pain point descriptions + Spec IDs) for the cross-reference step in Section 7.
  - `DocBuilder.gs` — function `buildSpecDoc(specObj)` → creates a Google Doc from the schema in Section 5, formatted with clear field labels and a `[STATUS: Pending]` tag per approvable field (pain point + each solution). Also `buildNotActionableDoc(obj)` for the shorter format.
  - `StatusSync.gs` — function `syncStatuses()` → scans `Pending-Review/` and `Needs-Edit/`, parses `[STATUS: ...]` tags per doc, moves files to the correct folder based on combined pain-point + solutions status (e.g. all approved → `Approved/`; any rejected → still routes to `Approved/` for approved items, but consider whether partial approval needs a note — flag this as a design question back to Daniel if ambiguous).
  - `Main.gs` — orchestration: `runWeeklyBatch()` triggers on Inbox files → extract → redact → generate spec → dedup check → file doc → archive raw screenshot to `Processed-Raw/`.
  - `Setup.gs` — one-time folder creation/ID resolution, mirroring the Fathom project's setup pattern.
  - `Debug.gs` — manual test runners for each stage in isolation (test extraction on one screenshot, test spec gen on sample redacted text, etc.), same pattern as the existing pipeline.

**Build order (recommended)**

1. `Config.gs` + `Setup.gs` — get folder structure live in Drive first.
2. `VisionExtract.gs` — test against 2-3 sample screenshots before building anything downstream.
3. `Redact.gs` — test on VisionExtract output, confirm no PII leaks through.
4. `SpecGen.gs` — test against redacted sample text, validate JSON shape matches Section 5 exactly.
5. `DocBuilder.gs` — confirm doc formatting is clean and status tags are unambiguous to parse.
6. `StatusSync.gs` — build and test the read-back/move logic.
7. `Main.gs` — wire it all together, add the weekly time trigger last.

**Error handling requirements**

- Every Gemini call needs a try/catch with a fallback path (route to a `Needs-Manual-Review/` folder rather than silently dropping a post).
- Never let a malformed screenshot or a JSON parse failure halt the whole weekly batch — process independently per file.
- Log extraction/generation failures to a running Sheet or Doc for Daniel to spot-check, without logging any raw PII.

**Explicitly do not build**

- Any Facebook Graph API / Groups API calls (deprecated, will fail).
- Any auto-posting or write-back to Facebook.
- Monday.com integration (phase 2, not now).

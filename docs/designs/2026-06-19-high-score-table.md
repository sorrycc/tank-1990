# Tank 1990 — Persistent top-N high-score table on Title + GameOver

> A small, focused META pass that closes the arcade loop: the meta already persists a single
> `bestScore`/`bestStage`, but there is no high-score TABLE — the classic arcade reward. This adds a
> persisted top-5 list (`highScores`), shown on the Title attract and on GameOver with the just-finished
> run highlighted. NO new scene, NO new save migration, NO change to the combat/spawn/advance spine.
> Format mirrors the base-destroyed-sequence + rich-playability docs.

---

## 1. Background

`util/save.ts` shapes the persistent meta (`currency`, the per-player `upgrades`, `bestScore`,
`bestStage`) and `core/MetaState.ts` wraps it; `bankRun({score, stage})` is the SINGLE writer of the
bests (it bumps `bestScore`/`bestStage` to the max on the run-over edge). The Title shows a single BEST
line and GameOver shows score / stage / banked / best score / best stage. But a single best is not the
arcade reward a player remembers — Battle City (and the read-only reference) keep a top-N TABLE of
finished runs. The rich-playability doc explicitly listed a "high-score TABLE" as out of its scope (it
shipped only the single best), so it is a genuine, named gap.

The fix stays entirely inside the existing meta plumbing: `save.ts` extends the round-tripped schema
with a `highScores: {score, stage}[]` field (default `[]` — the spread back-fill + clone-no-alias
discipline the existing `upgrades` field uses); `MetaState` gains a `getHighScores()` reader and the
EXISTING single-writer `bankRun()` inserts the finished run, sorts descending by score, slices to the
top 5, and persists (alongside the bests it already bumps — one writer, one save). The Title + GameOver
render the table with `t()` chrome off the FIXED design resolution. The verifier's existing save
round-trip is extended to assert the new field's `[]` default + the clone-no-alias contract.

**Conventions mirrored from the existing code:** the save schema is owned ONCE in `util/save.ts`
(`DEFAULT_META` is the identity + `loadMeta` clones the mutable containers so a back-filled field never
ALIASES the frozen default); `MetaState` keeps reads pure and the writes (`buy`/`bankRun`) the only
savers; `bankRun` stays the SINGLE writer of the persisted run stats (DRY — the table insert lives next
to the bests bump); all UI text goes through `t()` with keys in BOTH locales (ZH ⊆ EN, the verifier's
check); layouts derive from `DESIGN_WIDTH`/`DESIGN_HEIGHT` (never `window.innerWidth`); programmer-art
text only. Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** persist a top-5 high-score table and surface it on the Title (under the BEST line) and on
GameOver (with the just-finished run's row highlighted), without a save migration or any spine change.

**In scope:**

- **`src/util/save.ts` (CHANGED, PURE):** `MetaState` gains `highScores: { score: number; stage:
  number }[]`; `DEFAULT_META` gains `highScores: []`; `loadMeta` CLONES the array (maps each entry to a
  fresh `{score, stage}`) so a back-filled field never aliases the frozen default (the SAME no-alias
  discipline the `upgrades` containers use). No migration — the spread back-fills a save written by an
  older build (it had no `highScores`) to `[]`.
- **`src/core/MetaState.ts` (CHANGED, PURE of Phaser):** `MetaStateInstance` gains
  `getHighScores(): { score: number; stage: number }[]` (a read). The EXISTING `bankRun({score,
  stage})` — already the single writer + saver — additionally pushes `{score, stage}`, sorts the array
  DESCENDING by score, slices to `HIGH_SCORE_COUNT` (5), and persists (the same `saveMeta(meta)` it
  already calls). No new writer, no new save call.
- **`src/scenes/TitleScene.ts` (CHANGED):** under the existing BEST line, render the top-5 (rank ·
  score · stage) via `t()` chrome, off the FIXED design resolution. Empty on a fresh save (no rows).
- **`src/scenes/GameOverScene.ts` (CHANGED):** the scene-start DATA already carries the run summary;
  add the `highScores` array + the current run's `{score, stage}` so the scene renders the table with
  the matching row HIGHLIGHTED. GameScene reads `getHighScores()` AFTER `bankRun` (so the table already
  includes the finished run) and passes it as DATA (the scene stays decoupled — it never reads
  MetaState; it only displays the snapshot).
- **`src/scenes/GameScene.ts` (CHANGED, tiny):** the `_triggerGameOver` GameOver `scene.start` DATA
  gains `highScores: this.meta.getHighScores()` (read after `bankRun`). One extra field on the existing
  payload — no logic change.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** the new chrome keys (a table heading, a
  row template, an empty-state line) in BOTH locales (ZH ⊆ EN).
- **`scripts/verify-gen.mjs` (CHANGED):** EXTEND the existing save round-trip (section 3) to assert the
  new field's `[]` default AND the clone-no-alias contract (a fresh load's `highScores` is an empty
  array that does NOT alias `DEFAULT_META.highScores`).

**Out of scope (explicitly NOT built):** a player NAME / initials entry (the classic asks for initials,
but a name-entry flow needs new input plumbing + a keyboard scene — YAGNI for this pass; the rows are
score · stage); a separate high-scores SCENE (the table is a read rendered on the existing Title +
GameOver — no scene); a configurable N or a per-difficulty table (top-5 is the fixed classic count —
KISS); clearing / resetting scores from the UI; any save MIGRATION (the spread back-fill handles older
saves → `[]`); any change to `bestScore`/`bestStage` (kept — the table is additive); any change to the
combat / spawn / advance / boss spine or the pure generator (the verifier's stage sweep is byte-
unchanged — only the save round-trip section is extended).

---

## 3. Acceptance Criteria

1. **AC1 — the schema round-trips the new field with a `[]` default + no alias.** `util/save.ts`
   `MetaState` has `highScores: {score, stage}[]`; `DEFAULT_META.highScores === []`; `loadMeta()` on a
   fresh (or older) save returns `highScores` as an empty array that does NOT `===` `DEFAULT_META`'s
   frozen array (the clone-no-alias contract). The verifier's save section asserts both.
2. **AC2 — `bankRun` maintains the top-5 (the single writer).** After `bankRun({score, stage})`,
   `getHighScores()` includes `{score, stage}`, is sorted DESCENDING by score, and has length ≤ 5; a
   sixth lower run does not enter; a sixth higher run evicts the lowest. The bests bump + the save are
   unchanged (one writer, one `saveMeta`).
3. **AC3 — the Title shows the top-5 under the BEST line.** `TitleScene` renders up to 5 rows (rank ·
   score · stage) under the existing BEST line via `t()`, off the FIXED design resolution. A fresh save
   (empty table) shows a sane empty-state line (never a blank/crash).
4. **AC4 — GameOver shows the table with the current run highlighted.** `GameOverScene` renders the
   table from the scene-start DATA `highScores`; the row whose `{score, stage}` matches the current run
   is highlighted (a distinct colour). Launched bare (no DATA) it shows the empty state — never crashes.
5. **AC5 — i18n keys exist in BOTH locales (ZH ⊆ EN).** Every new `t()` key (the table heading, the
   row template, the empty-state line) exists in `en.ts` AND `zh-CN.ts`; the verifier's ZH ⊆ EN check
   stays green.
6. **AC6 — pure/coupled split + green gate.** `npm run typecheck` (strict) + `npm run build` exit 0;
   `npm run verify` prints OK + exits 0 with the EXTENDED save round-trip (the new default + no-alias
   assertions) and every other section byte-unchanged. `util/save.ts` + `i18n/*` import NO Phaser
   (node-imported by the verifier — re-proving purity); the scenes are Phaser-coupled, never imported.

---

## 4. Decision Log

1. **D1 — The table is a new `highScores: {score, stage}[]` field on the EXISTING save schema, defaulting
   to `[]`, with the clone-no-alias discipline the `upgrades` field already uses — NO migration.** The
   schema is owned once in `save.ts`: `DEFAULT_META` is the identity (so `loadMeta`'s spread back-fills
   the field for an older save → `[]`), and `loadMeta` already CLONES the mutable containers out of the
   frozen default. The new array gets the SAME treatment (`(stored.highScores ?? []).map(e => ({score,
   stage}))`) so a back-filled / loaded table never aliases `DEFAULT_META.highScores` (a frozen array —
   a later `bankRun` push would otherwise mutate the shared default / throw). *Rationale:* the existing
   doc says "extend the schema the verifier round-trips; no migration needed" — the spread back-fill IS
   the migration-free path. KISS — one field + one clone line; DRY — the no-alias pattern already exists;
   SOLID — the schema stays owned in one module. PURE — verifier-imported.
2. **D2 — The top-5 maintenance lives in the EXISTING single-writer `bankRun`, next to the bests bump —
   no new writer, no new save.** `bankRun` is ALREADY the one place that records a finished run (it bumps
   `bestScore`/`bestStage` + `saveMeta`s). Inserting into the table there keeps a SINGLE writer of all
   persisted run stats: push `{score, stage}`, sort descending by score, `slice(0, HIGH_SCORE_COUNT)`,
   then the existing `saveMeta(meta)`. *Rationale:* a second writer (e.g. a `recordHighScore`) would
   duplicate the save + risk a divergent table; folding it into `bankRun` is DRY + keeps the table and
   the bests consistent by construction (they record the same run in the same call). KISS — three lines;
   SOLID — `bankRun` owns "record the finished run", reads stay pure.
3. **D3 — `HIGH_SCORE_COUNT = 5` is a local const in `MetaState`, not `constants.ts`.** The count is a
   single private detail of the table-maintenance writer (the slice length) — it is NOT a shared number
   the pure generator / verifier / other modules read (the DRY rule is "shared numbers live ONCE in
   constants"). *Rationale:* a one-use slice length local to its only reader is clearer than a constant
   imported across the pure boundary for one consumer (YAGNI — no second reader). KISS.
4. **D4 — GameOver renders the table from scene-start DATA (the decoupled snapshot), NOT a MetaState
   read; GameScene reads `getHighScores()` AFTER `bankRun` and passes it.** `GameOverScene` is already
   decoupled (it reads a run-summary SNAPSHOT from DATA, never the live MetaState). The table follows the
   same rule: GameScene calls `bankRun` (which inserts the run), THEN reads `getHighScores()` (now
   including the finished run) and passes it + the run's `{score, stage}` as DATA; the scene highlights
   the row matching the run. *Rationale:* it preserves the scene's decoupling (the reference's HUD/
   registry split — the scene never reaches into state) and guarantees the passed table already contains
   the just-finished run (bankRun ran first), so the highlight always matches a present row. KISS/DRY —
   reuse the existing DATA seam; SOLID — GameScene owns WHEN (snapshot), the scene owns HOW (render).
5. **D5 — The Title reads `getHighScores()` in `create()` (the impure boundary) and renders under the
   BEST line; the rows derive from the FIXED design resolution.** The Title already news a
   `createMetaState()` in `create()` for the BEST line — the table is one extra `getHighScores()` read on
   the same instance (DRY). Rows lay out off `cx` + a fixed Y below the existing BEST line, the Title's
   existing layout discipline (never `window.innerWidth`). An empty table shows a single empty-state line.
   *Rationale:* a read + a loop is the minimal surface; no new state, no scene (KISS/YAGNI).
6. **D6 — The rows are score · stage (no name/initials), rendered via `t()` in BOTH locales.** The classic
   asks for initials, but name entry needs an input/keyboard flow (a new scene + plumbing) — disproportionate
   to a meta polish pass (YAGNI). The row template (`hi.row` = "{rank}. {score} · STAGE {stage}"), the
   heading (`hi.title`), and the empty line (`hi.empty`) live in `en.ts` + `zh-CN.ts` (ZH ⊆ EN — the
   verifier's check). *Rationale:* score · stage is the information the run earned; keys-in-both-locales is
   the project's locked i18n rule (AC5). KISS/DRY — one row template, two render sites (Title + GameOver).

---

## 5. Design

### 5.1 Module layout (this phase)

CHANGES `util/save.ts` (the `highScores` field + default + clone), `core/MetaState.ts` (`getHighScores`
+ the `bankRun` table insert), `scenes/TitleScene.ts` + `scenes/GameOverScene.ts` (render the table),
`scenes/GameScene.ts` (pass `highScores` in the GameOver DATA), `i18n/en.ts` + `i18n/zh-CN.ts` (the new
chrome), and `scripts/verify-gen.mjs` (the extended save round-trip). NO new file (besides this doc).

```
src/
  util/
    save.ts          # CHANGED (PURE): + highScores field + [] default + loadMeta clone (no alias). Verifier-imported.
  core/
    MetaState.ts     # CHANGED (PURE of Phaser): + getHighScores(); bankRun inserts/sorts/slices to top 5 + saves (D2).
  scenes/
    TitleScene.ts    # CHANGED: render top-5 under the BEST line (D5).
    GameOverScene.ts # CHANGED: render the table from DATA with the current run's row highlighted (D4).
    GameScene.ts     # CHANGED (tiny): pass highScores in the GameOver scene-start DATA (read after bankRun).
  i18n/
    en.ts            # CHANGED (PURE): + hi.title / hi.row / hi.empty (the EN source).
    zh-CN.ts         # CHANGED (PURE): + the zh-CN overrides (ZH ⊆ EN).
scripts/
  verify-gen.mjs     # CHANGED: extend the save round-trip — assert highScores [] default + clone-no-alias.
```

### 5.2 The schema (`util/save.ts`)

- **`MetaState`** gains `highScores: { score: number; stage: number }[]` (a list of finished runs, kept
  sorted descending by score, capped at 5 by the writer).
- **`DEFAULT_META`** gains `highScores: []` (the identity — a fresh save has no runs).
- **`loadMeta`** CLONES the array out of the back-filled merge: `merged.highScores = (Array.isArray(
  merged.highScores) ? merged.highScores : []).map((e) => ({ score: e?.score ?? 0, stage: e?.stage ?? 0
  }))` — so the loaded table owns its OWN entry objects + array (never aliases the frozen default; the
  SAME discipline as the `upgrades` containers). Defensive against a corrupt non-array / malformed entry.

### 5.3 The reader + writer (`core/MetaState.ts`)

- **`MetaStateInstance`** gains `getHighScores(): { score: number; stage: number }[]` — returns
  `meta.highScores` (a read; reads never write).
- **`bankRun({score, stage})` (CHANGED — the single writer):** after bumping `bestScore`/`bestStage`
  (unchanged) and BEFORE the existing `saveMeta(meta)`: `meta.highScores.push({ score, stage })`,
  `meta.highScores.sort((a, b) => b.score - a.score)`, `meta.highScores = meta.highScores.slice(0,
  HIGH_SCORE_COUNT)`. The single `saveMeta(meta)` persists the bests + the table together. Returns the
  banked currency (unchanged).
- **`HIGH_SCORE_COUNT = 5`** — a local const (D3).

### 5.4 The render sites (`TitleScene` + `GameOverScene` + `GameScene`)

- **`TitleScene` (CHANGED):** after the BEST line, `const scores = meta.getHighScores()`. Render
  `t('hi.title')` as a small heading, then up to 5 rows `t('hi.row', { rank: i + 1, score, stage })`
  stacked at a fixed `ROW_H` below the heading (off `cx`, centered). If `scores.length === 0`, render
  `t('hi.empty')` instead. All Y off the FIXED design resolution.
- **`GameOverScene` (CHANGED):** `RunSummary` gains `highScores: { score; stage }[]` (default `[]`).
  After the existing summary block, render `t('hi.title')` + the rows (same template). The row whose
  `score === summary.score && stage === summary.stage` is highlighted (gold — the just-finished run);
  the rest are the normal text colour. The FIRST matching row is highlighted (so a tie highlights one
  row). Empty DATA → the empty state (never crashes — the existing safe-defaults discipline).
- **`GameScene._triggerGameOver` (CHANGED — tiny):** the GameOver `scene.start('GameOver', {...})` DATA
  gains `highScores: this.meta.getHighScores()` — read AFTER `bankRun` (so the table already includes the
  finished run; D4). The existing fields (score / stage / currencyBanked / bestScore / bestStage) are
  unchanged.

### 5.5 Integration points with existing code (what does NOT change)

- `bestScore`/`bestStage` + their bump in `bankRun` are kept (the table is additive); `buy` + the reads
  are unchanged. The single `saveMeta(meta)` in `bankRun` now persists the table too — no new save call.
- The combat / spawn / advance / boss / banner spine, the pure generator, `config/*`, and the verifier's
  stage sweep are UNTOUCHED — only the save round-trip section of the verifier is extended (5.6).
- `GameOverScene` stays decoupled (it reads DATA, never MetaState); the Title's MetaState read is the
  existing impure boundary (one extra `getHighScores()` call).

### 5.6 Verifier extension (`scripts/verify-gen.mjs`)

The existing save round-trip (section 3) asserts the `currency`/`bestScore`/`bestStage`/`upgrades`
defaults + the upgrades clone-no-alias. EXTEND it: assert `Array.isArray(m.highScores)` + length 0 (the
`[]` default), and `m.highScores !== DEFAULT_META.highScores` (the clone-no-alias contract for the new
field). No other section changes (the stage sweep + the pin are byte-unchanged).

---

## 6. Files

**Changed:**

- `src/util/save.ts` — `MetaState.highScores` + `DEFAULT_META.highScores: []` + `loadMeta` clone (no alias).
- `src/core/MetaState.ts` — `getHighScores()`; `bankRun` inserts/sorts/slices to top 5 + the existing save.
- `src/scenes/TitleScene.ts` — render the top-5 under the BEST line.
- `src/scenes/GameOverScene.ts` — render the table from DATA with the current run's row highlighted.
- `src/scenes/GameScene.ts` — pass `highScores` in the GameOver scene-start DATA (read after `bankRun`).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — `hi.title` / `hi.row` / `hi.empty` (both locales; ZH ⊆ EN).
- `scripts/verify-gen.mjs` — extend the save round-trip (the `highScores` `[]` default + clone-no-alias).
- `docs/designs/2026-06-19-high-score-table.md` — this design doc.

---

## 7. Verification

- **AC1 (schema round-trip + default + no alias) — `npm run verify`.** The extended save section asserts
  `loadMeta().highScores` is an empty array NOT aliasing `DEFAULT_META.highScores`. `npm run typecheck`
  proves the `MetaState`/`RunSummary` types.
- **AC2 (bankRun top-5) — read + `npm run typecheck`.** `bankRun` pushes/sorts-descending/slices to 5
  next to the bests bump, before the single `saveMeta`. (Headless localStorage is a no-op under node, so
  the table can't be round-tripped there — the logic is proved by type + read; the verifier's job is the
  schema default/no-alias.)
- **AC3 (Title table) — grep + manual drive.** Grep `getHighScores` / `hi.title` / `hi.row` in
  `TitleScene.ts`. Manual `npm run dev`: finish a few runs → return to Title → the top-5 shows under the
  BEST line; a fresh save shows the empty-state line.
- **AC4 (GameOver highlighted row) — grep + manual drive.** Grep `highScores` + the highlight match in
  `GameOverScene.ts`. Manual: finish a run → GameOver shows the table with the just-finished run's row in
  gold; launched bare shows the empty state.
- **AC5 (i18n both locales) — `npm run verify`.** The verifier's ZH ⊆ EN check covers the new
  `hi.*` keys (they exist in both `en.ts` + `zh-CN.ts`).
- **AC6 (green gate + pure/coupled) — `npm run typecheck` + `npm run build` + `npm run verify`.** All
  exit 0 / print OK. `util/save.ts` + `i18n/*` are node-imported by the verifier (re-proving purity); the
  scenes import Phaser and are never imported. Every verifier section except the save round-trip is
  byte-unchanged.
</content>
</invoke>

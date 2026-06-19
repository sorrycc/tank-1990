# Title Screen — Fix Overflow/Overlap by Reflowing into a Two-Column Lower Band

## 1. Background

The title screen (`src/scenes/TitleScene.ts`) renders a tall single-column stack of sections,
each positioned with a hard-coded Y literal off the fixed `1280×720` design resolution
(`Scale.FIT`). Over many feature additions (difficulty/seed/start-stage selectors, Settings +
Construction hints, controls reference, high-score table) the stack grew taller than the 720px
canvas. Traced from live source:

- heading y=120 · subtitle y=196 · BEST line y=234
- difficulty row y=258 · start-stage y=286 · diff hint y=308
- seed row y=322 · seed hint y=342 · settings/construction hints y=358
- controls title y=376 · 6 control rows at `ROW_H=28` from y=408 → y=548
- high-score title y=594 · up to 5 rows at `HI_ROW_H=26` from y=626 → **y=730**
- start prompt pinned at `DESIGN_HEIGHT - 72` = **y=648**

Two defects result: the start prompt (648) lands on top of high-score rows 1–2 (626/652), and the
high-score table runs off the bottom of the canvas (730 > 720). This matches the user's screenshot
where `高分榜` and its rows collide with the green `按 SPACE / ENTER 开始或点击开始` prompt.

## 2. Requirements Summary

- **Goal:** Reflow the title screen so every section fits within the 1280×720 design canvas with no
  overlap, stays horizontally centered, stays readable, and keeps every existing section + feature
  functional. Pure positioning change — no behavior change.
- **Scope:** Layout coordinates in `src/scenes/TitleScene.ts` only. No i18n change, no new constants
  module, no change to any keyboard/pointer handler logic or the Title→Hub flow.
- **Key decision:** The lower band (controls reference + high-score table) is split into two
  side-by-side columns; the top stack is compressed upward. Everything stays derived from the fixed
  design resolution.

## 3. Acceptance Criteria

1. No two text elements overlap at 1280×720 — specifically the start prompt no longer collides with the high-score table.
2. All content fits within the 720px canvas; nothing renders below y=720 (the last high-score row, at the max 5-row case, is fully on-screen with a clear gap above the start prompt).
3. Every section stays present + functional: heading, subtitle, BEST line, difficulty chooser (←/→), start-stage readout (↑/↓), seed row (S/R + hex entry), diff/seed hints, Settings (O) + Construction (T) hints, controls reference (6 rows), high-score table (heading + up to 5 rows or empty state), start prompt.
4. All anchors stay derived from `DESIGN_WIDTH`/`DESIGN_HEIGHT` (never `window.innerWidth`) so the layout centers under Scale.FIT; columns use fixed-x anchors (the CJK-safe discipline, never label pixel-width).
5. All keyboard handlers, the seed-entry latch, and the start/pointer flow work unchanged (the captured `chips` / `startStageText` / `seedText` objects keep their roles; only creation coordinates change).
6. `npm run typecheck` and `npm run verify` both pass.

## 4. Problem Analysis

- **Approach A — GameOver-style single-column re-anchor** (the precedent in
  `2026-06-18`/`2026-06-19-gameover-layout-overlap.md`: pull content up, worst-case-check the bottom)
  -> rejected here. GameOver stacks 5 stats + ≤5 high-score rows. Title's lower band is ~2× denser:
  a controls block (title + **6** rows) *and* a high-score block (title + **5** rows) *and* the start
  prompt. Single-column, even at minimal readable line height (~26px), the 13 lower-band lines + two
  section gaps need ~370px, which on top of an ~330px top stack leaves no room for the bottom prompt.
  It would only fit by cramming to unreadable spacing — the exact "cramped" complaint.
- **Approach B — drop/trim the high-score table** (the BEST line already shows row 1's score+stage)
  -> rejected. YAGNI cuts the wrong way: each section was added deliberately by a prior feature; rows
  2–5 carry information the BEST line doesn't. Removing content to fit is a regression, not a fix.
- **Approach C — runtime layout engine / flex container** -> rejected: YAGNI. The content is a fixed,
  bounded set; a layout engine is overkill (same call the GameOver doc made).
- **Chosen — compress the top stack upward + split the lower band into two columns** (controls left,
  high-scores right). Halving the lower band's height is the natural, content-preserving way to fit a
  too-tall stack into 720px. Worked the geometry for the 5-row / 6-row worst case so nothing collides
  and nothing leaves the canvas.

## 5. Decision Log

**1. How to make the content fit**

- Options: A) single-column re-anchor (GameOver style) · B) drop the high-score table · C) two-column lower band
- Decision: **C)** — split controls (left) and high-scores (right) into a side-by-side band; compress
  the top stack upward. Keeps all content, halves the lower-band height, fits with margin. (A) can't
  fit Title's denser lower band at readable spacing; (B) regresses information.

**2. Which two blocks become the columns**

- Options: A) controls | high-scores · B) high-scores | controls · C) some other pairing
- Decision: **A)** — controls left, high-scores right. They are the two tallest blocks (6 and 5 rows),
  so pairing them gives the biggest height saving; left-to-right reading puts the action reference
  first. The single-line sections (heading … hints) stay a centered top stack.

**3. Spacing strategy**

- Options: A) tight (~20px) · B) generous, worst-case-checked
- Decision: **B)** — worst-case-checked at 6 control rows + 5 high-score rows. Lower-band rows end at
  y≈550, a clear ~90px above the start prompt; the top stack ends ~328, ~38px above the band titles.

**4. Column horizontal anchors (CJK-safe)**

- Options: A) center-derived fixed offsets off `cx` · B) measure label widths at runtime
- Decision: **A)** — fixed x anchors off `cx` (`LEFT_CX = cx-230`, `RIGHT_CX = cx+230`), and within the
  controls column fixed `LABEL_X`/`KEYS_X` columns. Never derive x from a label's pixel width — the
  existing CJK-safe discipline (D9). The two blocks span ~[290,569] and ~[765,975]: a ~196px gap, no
  overlap, both inside the 1280px width.

## 6. Design

`cx = DESIGN_WIDTH/2 = 640`, canvas height 720. All `add.text(...).setOrigin(...)` calls keep their
fonts/colors/origins; only coordinates move and the two lower blocks gain an x anchor.

**Top stack (centered single column), anchors pulled up:**

- `HEADING_Y = 80` (font 80 bold) — was 120
- `SUBTITLE_Y = 150` (font 24) — was 196 (70px center-gap below the 80px heading; Phase-4 review widened this from 62px)
- `BEST_Y = 188` (font 18) — was 234
- `DIFF_Y = 224` (font 20) — was 258. Captured children keep their existing relative offsets:
  `startStageText` at `DIFF_Y + 28` (252), `diffHint` at `DIFF_Y + 50` (274).
- `SEED_Y = DIFF_Y + 64` (288) — `seedText` at `SEED_Y`, `seedHint` at `SEED_Y + 20` (308),
  Settings/Construction hint halves at `SEED_Y + 36` (324). Top stack bottom ≈ 332.

The internal relative offsets (`DIFF_Y + 28/50`, `SEED_Y + 20/36`) are unchanged — only the two base
anchors `DIFF_Y`/`SEED_Y` shift — so every handler that re-renders these objects in place is untouched.

**Lower band (two columns):**

- `BAND_TITLE_Y = 376` (font 22 bold) — both column headers: `controls.title` centered at `LEFT_CX`,
  `hi.title` centered at `RIGHT_CX`. ~44px below the top stack (Phase-4 review centered the band in the
  available space rather than leaving a ~106px void above the start prompt).
- `LEFT_CX = cx - 230` (410), `RIGHT_CX = cx + 230` (870).
- `BAND_ROW_H = 30`, `BAND_ROWS_TOP = 410` (both columns' first row aligns).
- Controls (left): `LABEL_X = LEFT_CX - 120` (290, origin 0,0.5), `KEYS_X = LEFT_CX + 14` (424,
  origin 0,0.5); 6 rows at 410/440/470/500/530/**560**. Widest keys (`SPACE / ENTER`, ~145px) ends ~569.
- High-scores (right): heading + rows centered at `RIGHT_CX` (870, origin 0.5), `HI_ROW_H = 30`; up to
  5 rows at 410/440/470/500/**530**, or the single empty-state line at 410. Rows span ~[765,975].
- Start prompt stays at `DESIGN_HEIGHT - 72` = 648 (unchanged), ~88px below the lowest band row.

Worst case (5 high-score rows, 6 control rows): lowest band content at y≈560, start prompt 648 —
~88px clear; nothing exceeds y=720, and all content stays within [290,975] of the 1280px width. The
two column blocks span ~[290,569] (controls) and ~[765,975] (high-scores), a ~196px gap — no overlap.

## 7. Files Changed

- `src/scenes/TitleScene.ts` — move top-stack Y anchors up (`heading 120→80`, `subtitle 196→150`,
  `best 234→188`, `DIFF_Y 258→224`); restructure the controls block and high-score block from a single
  centered column into two fixed-x columns (`LEFT_CX`/`RIGHT_CX`) sharing one `BAND_TITLE_Y` /
  `BAND_ROWS_TOP`; start prompt Y unchanged. No handler/logic changes. Update the section comments to
  describe the two-column band.

## 8. Verification

1. [AC1/AC2] `npm run dev`, open the title screen; confirm no overlap and that the full 5-row
   high-score table is on-screen with a clear gap above the start prompt. (Seed a 5-row table via prior
   runs, or temporarily confirm against the empty-state line.)
2. [AC3] Visually confirm every section renders: heading, subtitle, BEST, difficulty chooser,
   start-stage, seed row, hints, Settings/Construction, controls (6 rows), high-scores, start prompt.
3. [AC4] Resize the window; layout stays centered (anchors are off the fixed resolution).
4. [AC5] Exercise ←/→ (difficulty), ↑/↓ (start stage), S/R + hex entry (seed), O (Settings), T
   (Construction), SPACE/ENTER/click (start) — all behave as before.
5. [AC6] `npm run typecheck` and `npm run verify` pass.

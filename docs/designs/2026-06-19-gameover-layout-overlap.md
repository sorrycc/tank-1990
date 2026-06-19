# GameOver Screen — Fix Heading/Stats Vertical Overlap

## 1. Background

The run-end screen (`GameOverScene`) renders the red `游戏结束` heading on top of the
summary stats block. In the live screenshot the first stat line (`分数 5700`) sits dead-center
over the heading glyphs. Root cause: the heading and the summary block are positioned at the
**same Y** (`cy - 150`), so they collide instead of stacking.

## 2. Requirements Summary

- **Goal:** The heading and the stats/high-score content form a clean, collision-free vertical
  stack with deliberate spacing.
- **Scope:** Layout coordinates in `src/scenes/GameOverScene.ts` only. No logic/behavior change,
  no i18n change, no new constants module.
- **Key decision:** Pull the heading up and start the stats block below it; keep all anchors
  derived from the fixed design resolution (`cy = DESIGN_HEIGHT/2`).

## 3. Acceptance Criteria

1. The red `游戏结束` heading has clear vertical spacing above the first stat line (`分数`) — no overlap.
2. The five summary stats (`分数` / `到达关卡` / `存入货币` / `最高分数` / `最高关卡`) render as a clean vertical stack, one per line.
3. The high-score table (`高分榜` + up to **5** rows) sits below the summary with spacing and never collides with the bottom continue prompt — verified at the max 5-row case.
4. All Y positions stay derived from the fixed design resolution; the only change is layout coordinates.
5. `npm run typecheck` and `npm run verify` both pass.

## 4. Problem Analysis

- **Approach A — only move `blockTop` down, keep heading at `cy-150`** -> rejected: at the max
  5-row high-score table the last row lands at y≈664, colliding with the continue prompt at
  `DESIGN_HEIGHT-56` (664). Fixes the heading overlap but introduces a bottom collision.
- **Approach B — switch to a runtime layout engine / flex container** -> rejected: YAGNI. Content
  is a fixed, bounded stack (5 stats + ≤5 high-score rows); a layout engine is overkill.
- **Chosen — re-anchor the heading up and the stats block below it, worst-case-checked** ->
  pull the heading to `cy-210`, start the stats block at `cy-110`. Re-derive everything else from
  the existing formulas. Worked the geometry for the 5-row worst case so nothing collides.

## 5. Decision Log

**1. How much to move, and which anchors change**

- Options: A) move only `blockTop` · B) move both heading and `blockTop` · C) introduce a layout helper
- Decision: **B)** — two literal Y anchors change (`headingY: cy-150 → cy-210`,
  `blockTop: cy-150 → cy-110`); `hiTop` re-derives from its existing formula and the continue
  prompt stays at `DESIGN_HEIGHT-56`. Smallest change that also fixes the latent bottom collision.

**2. Spacing values**

- Options: A) tight (~40px gaps) · B) generous, worst-case-checked
- Decision: **B)** — ≈51px clear gap between heading-bottom and first stat-top; ≈30px clear below
  the last possible high-score row and the continue prompt. Balanced and collision-free at max content.

## 6. Design

`cy = DESIGN_HEIGHT/2 = 360`. New fixed anchors (origin 0.5, centered):

- `headingY = cy - 210` (150), 72px bold red — spans ~114–186.
- `blockTop = cy - 110` (250), `rowH = 40` (unchanged) — stats rows at 250/290/330/370/410.
- `hiTop = blockTop + lines.length*rowH + 28` = 478 (formula unchanged) — `高分榜` title, then rows
  at `hiTop + 32 + i*26` → 510/536/562/588/614 for the max 5 rows.
- Continue prompt at `DESIGN_HEIGHT - 56` = 664 (unchanged) — ≈30px below the last possible row.

Only the two anchor literals change; the per-row math, colors, highlight logic, and input routing
are untouched.

## 7. Files Changed

- `src/scenes/GameOverScene.ts` — heading Y `cy-150 → cy-210`; `blockTop` `cy-150 → cy-110`.

## 8. Verification

1. [AC1/AC2] Run the game to a GameOver; confirm `游戏结束` sits clearly above `分数`, stats stack cleanly.
2. [AC3] With a full 5-row high-score table, confirm the bottom row clears the continue prompt.
3. [AC4] Diff shows only the two Y-anchor literals changed.
4. [AC5] `npm run typecheck` and `npm run verify` pass.

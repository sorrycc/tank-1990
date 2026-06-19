# Tank 1990 — Difficulty select (Easy / Normal / Hard) + starting stage

> A small PLAYABILITY pass: a Title-screen difficulty chooser (Easy / Normal / Hard) plus an optional
> starting-stage offset. Difficulty is a PURE per-level SCALAR applied to the EXISTING closed-form stage
> ramps (enemy bullet-speed / spawn-cadence) and to the run-start lives — NOT a rewrite of the ramps, so the
> verifier's monotonicity/bounds sweep stays green by construction (it sweeps the Normal = identity default).
> The choice persists via the EXISTING util/save.ts pattern (a new tiny `settings` key — NO meta-schema
> change) and is read ONCE in GameScene run setup. i18n both locales. Format mirrors the extra-life +
> high-score-table docs.

---

## 1. Background

The flow is **Title → Hub → Game** (`scene.start('Hub')` → `scene.start('Game')`, no data payload). GameScene's
`create()` is the single run-setup site: it `createMetaState()`s, builds the per-slot `{lives, tier}` seed map
(`lives = START_LIVES + spec.startLivesBonus`), then `createRunState(this._mintSeed(), seeds)`. The enemy
pressure rises through TWO pure closed-form ramps in `config/stages.ts` — `bulletSpeedScale(stageIndex)`
(non-decreasing, ∈[1, MAX]) and `spawnIntervalScale(stageIndex)` (non-increasing, ∈[MIN_SCALE, 1]) — read at
the spawn sites in GameScene (`_spawnStep` line ~1030/1059). `config/stages.ts` + `RunState.ts` are PURE
(node-imported by the verifier — a stray Phaser import throws under node). The verifier (§5) sweeps
`stageConfig/bulletSpeedScale/spawnIntervalScale(0..30)` asserting monotone + bounded; §7f drives RunState.

What is MISSING is any way to pick difficulty. Today every run is the one fixed ramp from stage 0. The classic
Battle City has no difficulty menu, but a modern playability pass wants Easy/Normal/Hard + a "skip to stage N"
practice option.

**Conventions mirrored:** shared numbers live ONCE in `config/constants.ts`; the difficulty math is a PURE
function in `config/stages.ts` (so the verifier node-imports it + asserts the contract); the choice persists
through `util/save.ts`'s defensive get/set (the SAME wrapper meta uses — no new storage code); all UI text goes
through `t()` with keys in BOTH locales (ZH ⊆ EN). Governing principles: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** a Title-screen Easy/Normal/Hard selector + an optional starting-stage offset; difficulty scales the
existing ramps (enemy speed/cadence) and starting lives via a PURE per-level multiplier; persist the choice;
thread it into RunState/GameScene run setup; keep verify green.

**In scope:**

- **`src/config/constants.ts` (CHANGED, PURE):** add the difficulty SCALAR table as named constants (DRY owner)
  — `DIFFICULTY_LIVES_BONUS = { easy: +1, normal: 0, hard: -1 }` (added to `START_LIVES`, clamped ≥ 1) and the
  enemy-pressure multipliers `DIFFICULTY_PRESSURE = { easy: 0.85, normal: 1.0, hard: 1.2 }`. **Normal is the
  IDENTITY (1.0 / +0)** so the verifier's default sweep is byte-unchanged. Plus `MAX_START_STAGE` (the
  starting-stage offset cap, e.g. 20) so the Title clamps the picker.
- **`src/config/stages.ts` (CHANGED, PURE):** add a `Difficulty = 'easy' | 'normal' | 'hard'` type and a PURE
  `difficultyPressure(level)` returning the bounded multiplier (folds the constants table; defends an unknown
  level → `normal`'s 1.0). Add TWO thin OPTIONAL-`difficulty` overloads of the ramps that COMPOSE the scalar
  with the existing closed-form ramp WITHOUT changing the closed forms: `bulletSpeedScale(stageIndex,
  difficulty?)` → `clamp(rawRamp · difficultyPressure(d), BASE, BULLET_SPEED_SCALE_MAX)` and
  `spawnIntervalScale(stageIndex, difficulty?)` → `clamp(rawRamp / difficultyPressure(d), MIN_SCALE, BASE)` (a
  HIGHER pressure shortens the spawn interval). Omitting the arg = `'normal'` = the IDENTITY = today's value, so
  EVERY existing caller + the verifier's existing sweep is unchanged. Both stay clamped to the SAME named caps,
  so they remain bounded; and for a FIXED difficulty each stays monotone in `stageIndex` (the scalar is a
  per-level constant — it shifts the curve, never un-orders it).
- **`src/util/settings.ts` (NEW, PURE):** a tiny persisted-settings wrapper layered over `util/save.ts`'s
  defensive `get/set` — the SAME pattern as the meta wrapper, but a SEPARATE `tank-1990:settings` key (NO
  meta-schema migration — the run economy and the player's difficulty preference are different concerns, SOLID).
  Shape `{ difficulty: Difficulty; startStage: number }`; `DEFAULT_SETTINGS = { difficulty: 'normal',
  startStage: 0 }` (the IDENTITY); `loadSettings()` / `saveSettings()` mirror `loadMeta`/`saveMeta` (back-fill +
  clamp on read so a corrupt/old value degrades to the default, never throws). PURE of Phaser (importable
  headless — re-proving purity).
- **`src/core/RunState.ts` (CHANGED, PURE):** `createRunState(startSeed, seeds, startStage = 0)` gains an
  OPTIONAL `startStage` arg (defaulted 0 → the F4 behaviour byte-unchanged). When > 0 it seeds `stageIndex =
  startStage` and the spawn ledger from `stageConfig(startStage)` (instead of stage 0), so a run can begin deep.
  `advance()` is untouched (it already increments from the run-global index). Lives/difficulty are NOT stored on
  RunState — lives are folded into the per-slot seed by GameScene (the existing seam); difficulty is read where
  the ramps are consumed (it does not belong on the run-economy object — SOLID).
- **`src/scenes/TitleScene.ts` (CHANGED):** add a small difficulty row (Easy / Normal / Hard, the selected one
  highlighted) + an optional starting-stage readout, both off the FIXED design resolution (centered under
  Scale.FIT — the Title's discipline). Cursor keys cycle difficulty (e.g. ←/→ or A/D) and adjust the start
  stage (e.g. ↑/↓ within [0, MAX_START_STAGE]); each change `saveSettings()`s + re-renders the row + plays the
  existing `sfx.uiMove()`/`uiSelect()`. The SPACE/ENTER/pointer start still routes to `'Hub'` (flow unchanged).
  Read the current value via `loadSettings()` in `create()` (the impure save boundary, like `createMetaState()`).
- **`src/scenes/GameScene.ts` (CHANGED):** in `create()`, `loadSettings()` ONCE (beside `createMetaState()`).
  Cache `this.difficulty` + pass `settings.startStage` to `createRunState(seed, seeds, settings.startStage)`.
  Fold `DIFFICULTY_LIVES_BONUS[difficulty]` into each slot's seed lives (`Math.max(1, START_LIVES +
  spec.startLivesBonus + bonus)`). At the TWO ramp-read sites (`_spawnStep`) pass `this.difficulty`:
  `bulletSpeedScale(this.runState.stageIndex, this.difficulty)` /
  `spawnIntervalScale(this.runState.stageIndex, this.difficulty)`. No other scene change.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** add the Title keys (`title.difficulty`,
  `title.diff.easy/normal/hard`, `title.startStage`, `title.diffHint`) in BOTH locales (ZH ⊆ EN).
- **`scripts/verify-gen.mjs` (CHANGED):** extend §5 — for EACH difficulty level, sweep `bulletSpeedScale(s, d)` /
  `spawnIntervalScale(s, d)` over `0..STAGE_K` asserting STILL bounded (∈ caps) AND monotone for that fixed
  level; assert `bulletSpeedScale(s, 'normal') === bulletSpeedScale(s)` (the no-arg default IS the identity —
  the existing sweep is unaffected) and likewise for spawn. Extend §7f — `createRunState(seed, seeds, 7)` seeds
  `stageIndex === 7` and its ledger from `stageConfig(7)`; the no-arg form still seeds `stageIndex === 0`. Drive
  `difficultyPressure` over the three levels (easy < normal === 1 < hard) + an unknown → 1.

**Out of scope (NOT built):** changing the CLOSED-FORM ramps in `config/stages.ts` (difficulty is a multiplier
ON them — YAGNI/DRY); a per-stage or continuous difficulty slider (three named levels — KISS); persisting
difficulty INTO the meta save schema (a separate `settings` key — SOLID, no migration); a Hub-side or in-run
difficulty switch (Title-only — the choice is set before a run, the SAME life-cycle as locale — YAGNI);
difficulty affecting terrain density / enemy roster / boss HP (only the speed/cadence ramps + start lives, the
brief's scope — KISS); changing `RunState.advance()` or the stage sweep's STAGE_K/seeds (only the additive
overloads + §7f are extended).

---

## 3. Acceptance Criteria

1. **AC1 — the difficulty scalars are shared ONCE + Normal is the identity.** `DIFFICULTY_PRESSURE` +
   `DIFFICULTY_LIVES_BONUS` live in `config/constants.ts`; `normal` = `1.0` / `+0`, so a Normal run is
   byte-identical to today (no inlined duplicate — DRY).
2. **AC2 — `difficultyPressure(level)` is a PURE, bounded, ordered helper.** `easy < normal === 1 < hard`; an
   unknown/garbage level falls back to `normal`'s `1.0`. The verifier drives it.
3. **AC3 — the ramps stay bounded + per-level monotone, and the no-arg default is unchanged.** For EVERY
   difficulty, `bulletSpeedScale(s, d)` ∈ `[1, BULLET_SPEED_SCALE_MAX]` and `spawnIntervalScale(s, d)` ∈
   `[SPAWN_INTERVAL_MIN_SCALE, 1]` across `0..STAGE_K`, and each is monotone in `s` for that fixed `d`.
   `bulletSpeedScale(s)` (no arg) `=== bulletSpeedScale(s, 'normal')` (and spawn likewise), so the EXISTING §5
   sweep is byte-unaffected.
4. **AC4 — the starting stage threads through purely.** `createRunState(seed, seeds, n)` seeds `stageIndex ===
   n` + its ledger from `stageConfig(n)`; `createRunState(seed, seeds)` (no arg) still seeds `stageIndex === 0`
   (the verifier asserts both).
5. **AC5 — difficulty folds into the run.** GameScene reads `loadSettings()` once, passes `startStage` to
   `createRunState`, folds `DIFFICULTY_LIVES_BONUS` into each slot's seed lives (clamped ≥ 1), and passes
   `this.difficulty` to the two ramp reads — so a Hard run streams faster/harder-hitting enemies + fewer lives,
   an Easy run the opposite.
6. **AC6 — the choice persists.** `loadSettings()`/`saveSettings()` round-trip `{difficulty, startStage}`
   through the `tank-1990:settings` key; a disabled/corrupt storage degrades to `DEFAULT_SETTINGS` (never
   throws — inherits save.ts's try/catch).
7. **AC7 — the Title chooser works + is localised.** The Title shows the three levels (selected highlighted) +
   the start-stage readout; cursor keys cycle/adjust + save + blip; SPACE/ENTER/pointer still starts the flow.
   Every new string is in `en.ts` AND `zh-CN.ts` (the verifier's ZH ⊆ EN check stays green).
8. **AC8 — green gate + pure/coupled split.** `npm run typecheck` + `npm run build` exit 0; `npm run verify`
   prints OK + exits 0 with the extended §5/§7f. `constants.ts` / `stages.ts` / `RunState.ts` / `util/settings.ts`
   import NO Phaser (node-imported by the verifier); the scenes import Phaser and are never node-imported.

---

## 4. Decision Log

1. **D1 — Difficulty is a PURE per-level SCALAR applied ON the existing closed-form ramps, NOT a ramp rewrite.**
   The verifier's monotonicity/bounds gate is the load-bearing constraint. A per-level constant multiplier
   (composed then re-clamped to the SAME caps) SHIFTS each curve up/down but cannot un-order it in `stageIndex`
   — so for any fixed difficulty the ramp stays monotone + bounded BY CONSTRUCTION, and Normal = 1.0 is the
   literal identity (the default sweep is untouched). *Rationale:* KISS/DRY — one scalar table, no second ramp
   to keep in sync; the gate stays green without weakening it.
2. **D2 — The scalars compose by MULTIPLY (bullet speed) / DIVIDE (spawn interval), then re-clamp.** Higher
   pressure = faster bullets (×) AND a shorter spawn interval (÷, so enemies arrive faster). Re-clamping to the
   existing named caps keeps both within their proven bounds, so even Hard never exceeds `BULLET_SPEED_SCALE_MAX`
   / drops below `SPAWN_INTERVAL_MIN_SCALE` (deep+Hard is hard, never un-reactable — the "bounded" stance). *Rationale:*
   correctness + the bound stays the SAME named owner (DRY).
3. **D3 — A SEPARATE `tank-1990:settings` save key, NOT the meta schema.** Difficulty/start-stage are a
   pre-run PREFERENCE; currency/upgrades/bestScore are the persistent run economy. Mixing them would force a
   meta-schema migration + couple two concerns. A second tiny wrapper over the SAME defensive `save.ts`
   get/set reuses all the error-swallowing for free. *Rationale:* SOLID (one concern per module) + DRY (reuse
   save.ts) + YAGNI (no migration).
4. **D4 — Difficulty lives where it is CONSUMED (GameScene passes it to the ramps), NOT on RunState.** RunState
   owns the run ECONOMY (seed/stage/lives/score/ledger); the difficulty multiplier is a render/spawn input read
   at the ramp sites. Threading it through RunState would bloat the pure object + the verifier's §7f for no
   gain. Only `startStage` touches RunState (it seeds the run-global `stageIndex` — that IS run identity).
   *Rationale:* SOLID — keep RunState's surface minimal; the ramps already take `stageIndex`, so adding an
   optional `difficulty` arg is the natural seam.
5. **D5 — Start-stage is an OPTIONAL defaulted arg on `createRunState`, default 0.** A defaulted arg keeps every
   existing call site + the verifier's existing §7f `createRunState(seed, seeds)` calls byte-unchanged; only the
   NEW Title-driven deep-start path passes a non-zero value. *Rationale:* KISS — smallest seam; backward-
   compatible by default.
6. **D6 — The lives bonus is clamped ≥ 1.** Hard's `−1` must never zero out a player's starting lives (a 0-life
   run is unplayable). `Math.max(1, START_LIVES + startLivesBonus + DIFFICULTY_LIVES_BONUS[d])`. *Rationale:*
   defensive — a difficulty tweak can never produce a degenerate run.

---

## 5. Design

### 5.1 Module layout (this phase)

```
src/
  config/
    constants.ts     # CHANGED (PURE): + DIFFICULTY_PRESSURE / DIFFICULTY_LIVES_BONUS / MAX_START_STAGE (the shared scalars).
    stages.ts        # CHANGED (PURE): + Difficulty type, difficultyPressure(level), and the difficulty? overloads of the two ramps.
  core/
    RunState.ts      # CHANGED (PURE): createRunState(..., startStage = 0) — optional deep-start seeding.
  util/
    settings.ts      # NEW (PURE): loadSettings/saveSettings over the tank-1990:settings key (the save.ts pattern).
  scenes/
    TitleScene.ts    # CHANGED: the difficulty/start-stage chooser row + key cycling + saveSettings + blip.
    GameScene.ts     # CHANGED: loadSettings once → pass startStage + fold lives bonus + pass difficulty to the ramps.
  i18n/
    en.ts            # CHANGED (PURE): + title.difficulty / title.diff.* / title.startStage / title.diffHint.
    zh-CN.ts         # CHANGED (PURE): the same keys (ZH ⊆ EN).
scripts/
  verify-gen.mjs     # CHANGED: extend §5 (per-level ramp sweep + no-arg identity) + §7f (startStage seed + difficultyPressure table).
```

### 5.2 `config/stages.ts` (the pure scalar + overloads)

```
export type Difficulty = 'easy' | 'normal' | 'hard'
export function difficultyPressure(level: Difficulty): number {
  return DIFFICULTY_PRESSURE[level] ?? DIFFICULTY_PRESSURE.normal   // unknown → 1.0
}
// existing closed form unchanged; only compose+re-clamp with the per-level constant:
export function bulletSpeedScale(stageIndex, difficulty: Difficulty = 'normal'): number {
  const raw = BASE + PER_STAGE * s
  return clamp(raw * difficultyPressure(difficulty), BASE, BULLET_SPEED_SCALE_MAX)
}
export function spawnIntervalScale(stageIndex, difficulty: Difficulty = 'normal'): number {
  const raw = BASE + PER_STAGE * s
  return clamp(raw / difficultyPressure(difficulty), SPAWN_INTERVAL_MIN_SCALE, BASE)
}
```
Default `'normal'` ⇒ `difficultyPressure === 1.0` ⇒ `raw` unchanged ⇒ identical to today (AC3).

### 5.3 `util/settings.ts` (the persisted preference)

Mirrors `util/save.ts`'s meta wrapper: `SETTINGS_KEY = 'tank-1990:settings'`; `DEFAULT_SETTINGS = { difficulty:
'normal', startStage: 0 }`; `loadSettings()` reads + back-fills + clamps (`difficulty` ∈ the three levels else
`normal`; `startStage` clamped to `[0, MAX_START_STAGE]`); `saveSettings(s)` writes. All over save.ts's
try/catch get/set (never throws — AC6).

### 5.4 GameScene wiring (run setup)

```
const settings = loadSettings()
this.difficulty = settings.difficulty
// seed map — fold the difficulty lives bonus (clamped ≥ 1):
seeds[slot] = { lives: Math.max(1, START_LIVES + (spec.startLivesBonus ?? 0) + DIFFICULTY_LIVES_BONUS[this.difficulty]), tier: spec.startTier ?? 0 }
this.runState = createRunState(this._mintSeed(), seeds, settings.startStage)
// at the two _spawnStep ramp reads: pass this.difficulty as the 2nd arg.
```

### 5.5 What does NOT change

The closed-form ramp constants in `stages.ts`, `stageConfig`, `RunState.advance()`, the stage sweep's
seeds/STAGE_K, the meta save schema, and the combat/boss spine are UNTOUCHED. The verifier's existing §5 sweep
(no-arg calls) + the byte-pinned §6 generator output stay identical (the no-arg path is the identity — AC3).

### 5.6 Verifier extension

- **§5:** after the existing no-arg checks, for `d ∈ {easy, normal, hard}` sweep both ramps over `0..STAGE_K`
  asserting in-bounds + per-level monotone; assert `bulletSpeedScale(s) === bulletSpeedScale(s, 'normal')` +
  the spawn analogue (the default IS the identity).
- **§7f:** `const deep = createRunState(RS_SEED, {1:{lives:3,tier:0}}, 7)` → `deep.stageIndex === 7` +
  `deep.enemiesQueued === stageConfig(7).totalEnemies`; the existing no-arg `createRunState` calls still assert
  `stageIndex === 0`. Drive `difficultyPressure`: `easy < 1`, `normal === 1`, `hard > 1`, unknown → `1`.

---

## 6. Files

**New:** `src/util/settings.ts`.
**Changed:** `src/config/constants.ts`, `src/config/stages.ts`, `src/core/RunState.ts`, `src/scenes/TitleScene.ts`,
`src/scenes/GameScene.ts`, `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `scripts/verify-gen.mjs`, this design doc.

**i18n keys to add (both locales):** `title.difficulty`, `title.diff.easy`, `title.diff.normal`,
`title.diff.hard`, `title.startStage`, `title.diffHint`.

---

## 7. Verification

- **AC1/AC2/AC3/AC4 — `npm run verify`:** §5 sweeps the three levels (bounded + per-level monotone) + the
  no-arg identity; §7f drives `difficultyPressure` + the deep-start seeding + the no-arg `stageIndex === 0`.
- **AC5 — grep + manual:** grep `loadSettings` / `this.difficulty` / `DIFFICULTY_LIVES_BONUS` in GameScene + the
  `bulletSpeedScale(..., this.difficulty)` calls. Manual `npm run dev`: pick Hard → fewer lives + faster stream;
  Easy → the reverse; pick a start stage → the run begins there (STAGE label).
- **AC6/AC7 — `npm run verify` (ZH ⊆ EN) + manual:** cycle the Title chooser, restart → the choice persists.
- **AC8 — `npm run typecheck` + `npm run build` + `npm run verify`:** all exit 0. `constants.ts` / `stages.ts` /
  `RunState.ts` / `util/settings.ts` are node-imported by the verifier (re-proving purity); the scenes import
  Phaser and are never imported.

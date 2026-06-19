# Tank 1990 — 1UP score milestones (extra-life)

> A small, focused PLAYABILITY pass: the classic arcade 1UP. Every `EXTRA_LIFE_SCORE` points the run earns,
> grant +1 life to ALL present player slots, with the existing `oneUp()` chime and a brief celebratory HUD
> banner. The threshold lives on RunState (so it fires once per crossing and SURVIVES a stage advance), with a
> PURE, verifier-tested threshold-crossing helper. NO new scene, NO save-schema change, NO spine change.
> Format mirrors the high-score-table + bullet-tracer docs.

---

## 1. Background

`runState.score` is the single shared run score, banked in `GameScene._onEnemyKilled` (`this.runState.score +=
enemy.spec.scoreValue`) and mirrored to the HUD via `r.set('hud.score', …)`. The `tank` power-up already proves
the "+1 life" mechanic — `_applyPowerUp` does `this.runState.lives[slot] = (… ?? 0) + 1` and plays
`sfx.oneUp()` (a three-note rising chime). The STAGE-CLEARED / STAGE-INTRO banners already prove the timed,
registry-decoupled CENTERED overlay pattern (`bannerTimer`/`bannerStage` → `r.set('hud.banner', …)` → HUDScene's
`bannerLabel`). What is MISSING is the score-MILESTONE life award — the Battle City "extra tank every 20000".

The fix reuses all three existing seams. RunState gains ONE carried field, `nextExtraLifeScore` (the next
threshold), seeded to `EXTRA_LIFE_SCORE` and CARRIED across `advance()` (like `score`/`lives`). A PURE helper
`extraLivesCrossed(prevThreshold, score, step)` computes how many thresholds a score has reached (handles a
single big kill — e.g. the boss — crossing two at once) and the new next threshold; the verifier node-imports
RunState and drives it. GameScene, right after banking a kill's score, calls the helper; for each life awarded
it bumps EVERY present slot's lives, plays `oneUp()`, and arms a short `oneUpTimer` whose localised banner the
HUD renders (the SAME registry path as the clear banner, its own key so the two never clobber).

**Conventions mirrored:** shared numbers live ONCE in `config/constants.ts` (`EXTRA_LIFE_SCORE`); RunState stays
100% PURE (no Phaser) so the verifier drives it headlessly; the threshold helper is PURE + tested there; all UI
text goes through `t()` with keys in BOTH locales (ZH ⊆ EN); the HUD overlay is registry-decoupled (GameScene
owns WHEN, HUD owns HOW). Governing principles: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** every `EXTRA_LIFE_SCORE` (20000) points earned in a run, award +1 life to all PRESENT slots, with the
`oneUp()` chime + a brief centered HUD cue; fire ONCE per crossing; survive stage advance. Keep verify green.

**In scope:**

- **`src/config/constants.ts` (CHANGED, PURE):** add `EXTRA_LIFE_SCORE = 20000` — the points per 1UP milestone.
  The single shared owner (RunState seeds the threshold from it; the verifier reads it).
- **`src/core/RunState.ts` (CHANGED, PURE):** add the carried field `nextExtraLifeScore: number` (seeded to
  `EXTRA_LIFE_SCORE` in `createRunState`, CARRIED untouched by `advance()`/`tickTimers` — like `score`). Add the
  PURE module-level helper `extraLivesCrossed(prevThreshold, score, step) → { lives: number; nextThreshold:
  number }`: while `score >= nextThreshold`, count one life + add `step` to the threshold; returns the count +
  the new threshold. Exported so GameScene + the verifier both call the ONE implementation (DRY).
- **`src/scenes/GameScene.ts` (CHANGED):** in `_onEnemyKilled`, immediately AFTER `this.runState.score +=
  enemy.spec.scoreValue`, call `extraLivesCrossed(this.runState.nextExtraLifeScore, this.runState.score,
  EXTRA_LIFE_SCORE)`. If `lives > 0`: write back `this.runState.nextExtraLifeScore = nextThreshold`; for each of
  the `lives` granted, add +1 to EVERY present slot (`for (const slot of Object.keys(this.runState.lives))`);
  call `this.sfx.oneUp()`; arm `this.oneUpTimer = ONE_UP_BANNER_SEC` (a new scene field, like `bannerTimer`).
  In `_publishHud`, mirror the localised cue while the timer is live: `r.set('hud.oneUp', this.oneUpTimer > 0 ?
  t('hud.oneUp') : '')`. Decay `oneUpTimer` on the REAL dt in `update()` (beside `bannerTimer`, so it shows
  through the run-end freeze beat). NOT reset by `_buildStage` (the cue is transient; it decays on its own).
- **`src/scenes/HUDScene.ts` (CHANGED):** add a small centered `oneUpLabel` (its own depth/geometry, a distinct
  gold celebratory tint) and mirror `r.get('hud.oneUp')` into it each frame (the SAME pattern as `introLabel` /
  `bannerLabel`). Placed clear of the clear/intro banner so a same-frame overlap is legible.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** add `hud.oneUp` in BOTH locales (ZH ⊆ EN).
- **`scripts/verify-gen.mjs` (CHANGED):** in section 7f (RunState), assert the fresh `nextExtraLifeScore ===
  EXTRA_LIFE_SCORE`, that it is CARRIED across `advance()` (like `score`), and drive `extraLivesCrossed` over a
  table of cases (no crossing; one crossing; a SINGLE step that crosses TWO thresholds; the returned
  `nextThreshold` is always `> score`).

**Out of scope (NOT built):** a SEPARATE 1UP particle/explosion effect (the `oneUp()` chime + the centered HUD
banner ARE the celebration — a bespoke particle is YAGNI; reuse, don't invent); a per-slot threshold (the
milestone is on the SHARED run score, so it grants to all slots at once — the classic — KISS); persisting the
1UP count across runs / a save field (the milestone is run-scoped — YAGNI, no save change); a configurable
milestone count or escalating thresholds (fixed `EXTRA_LIFE_SCORE` step — KISS); auto-respawning a downed
player on the life gain (a life gain never force-respawns — it respawns on its next death if a life remains, the
SAME rule the `tank` pickup follows — AC4 of the powerups doc); any change to the combat/spawn/advance/boss
spine, the pure generator, or the verifier's stage sweep (only RunState section 7f is extended).

---

## 3. Acceptance Criteria

1. **AC1 — the milestone constant is shared ONCE.** `EXTRA_LIFE_SCORE = 20000` lives in `config/constants.ts`;
   RunState seeds its threshold from it and the verifier reads it (no inlined duplicate — DRY).
2. **AC2 — the threshold is carried on RunState + seeded.** A fresh `createRunState` has `nextExtraLifeScore ===
   EXTRA_LIFE_SCORE`; `advance()` and `tickTimers()` leave it UNTOUCHED (it survives a stage advance — the
   verifier asserts both, like the `score` carry).
3. **AC3 — `extraLivesCrossed` is a PURE, tested helper.** Given `(prevThreshold, score, step)` it returns
   `{ lives, nextThreshold }` where `lives` = number of `step`-multiples the score has reached past
   `prevThreshold`, and `nextThreshold > score`. A single big score jump crossing TWO thresholds returns
   `lives === 2`. No crossing returns `lives === 0` and the threshold unchanged. The verifier drives a case
   table.
4. **AC4 — a crossing grants +1 to every present slot, once per crossing.** When a banked kill pushes the score
   past `nextExtraLifeScore`, GameScene adds +1 life to EVERY present slot, advances the threshold (so the SAME
   crossing never re-fires), plays `oneUp()`, and arms the HUD cue. In co-op both P1 and P2 gain the life.
5. **AC5 — a brief HUD cue shows.** A localised centered "EXTRA LIFE" banner renders for `ONE_UP_BANNER_SEC`
   (decayed on the real dt, shown through the freeze beat), via the registry-decoupled `hud.oneUp` key →
   HUDScene's `oneUpLabel`. Blank otherwise (never a stray/crash).
6. **AC6 — i18n in BOTH locales.** `hud.oneUp` exists in `en.ts` AND `zh-CN.ts` (the verifier's ZH ⊆ EN check
   stays green).
7. **AC7 — green gate + pure/coupled split.** `npm run typecheck` (strict) + `npm run build` exit 0; `npm run
   verify` prints OK + exits 0 with the EXTENDED section 7f and every other section byte-unchanged.
   `constants.ts` + `RunState.ts` import NO Phaser (node-imported by the verifier — re-proving purity); the
   scenes import Phaser and are never node-imported.

---

## 4. Decision Log

1. **D1 — `EXTRA_LIFE_SCORE = 20000` in `constants.ts` (the shared owner); the threshold-CROSSING logic in a
   PURE helper on RunState.** The score number is read by two pure consumers (RunState seeds the threshold, the
   verifier reads it) — the DRY rule puts a SHARED number in `constants.ts` ONCE. The crossing arithmetic is a
   single pure function so GameScene and the verifier call the SAME implementation (one owner of "how many
   thresholds did this score reach"). *Rationale:* KISS/DRY — a constant + a tiny pure helper, no new module.
2. **D2 — The next threshold is a CARRIED RunState field (`nextExtraLifeScore`), not a recomputed `floor(score /
   STEP)`.** Storing the threshold (rather than deriving the count each frame) makes "fire ONCE per crossing"
   trivial and AUTOMATICALLY survives a stage advance (it is carried like `score`/`lives`, untouched by
   `advance()`). A derived `floor` would also work but needs a separate "last granted count" to dedupe — more
   state, not less. *Rationale:* SOLID — RunState owns the run economy; KISS — one field + the existing carry
   discipline; the verifier already proves carry for `score`, so this slots in.
3. **D3 — `extraLivesCrossed` handles a MULTI-threshold single jump (a `while` loop, not one subtract).** A boss
   kill (`scoreValue` is the largest) or a grenade clearing many tanks can bank a big delta in one step — which
   could cross two milestones at once. The helper LOOPS so the grant count is exact (and the `while` self-
   terminates: `nextThreshold` strictly increases by `step > 0`). *Rationale:* correctness over the boss/grenade
   edge for ~3 lines; the verifier pins the 2-at-once case. YAGNI guard: no escalating-step complexity.
4. **D4 — The +1 is applied to ALL PRESENT slots (`Object.keys(runState.lives)`), once per life, NOT to a single
   slot.** The milestone is on the SHARED run score, so the classic awards the run a life — in co-op that means
   both players (the present-slots set IS `Object.keys(lives)`, the same scoping RunState/`tickTimers` use).
   *Rationale:* matches the classic + the shared-score model; DRY — reuses the present-slots key set; no
   "which player earned it" bookkeeping (YAGNI).
5. **D5 — The celebration REUSES `oneUp()` + the registry banner seam; NO new effect/particle.** The chime
   already exists (the `tank` pickup) and the timed centered banner pattern already exists
   (`bannerTimer`→`hud.banner`→`bannerLabel`). The 1UP cue gets its OWN scene timer (`oneUpTimer`) + registry key
   (`hud.oneUp`) + HUD label (`oneUpLabel`) so it never clobbers the clear/intro banners, but it adds NO new
   synthesis or particle code. *Rationale:* DRY/KISS/YAGNI — reuse two proven seams; the chime + banner ARE the
   juice. The cue decays on the REAL dt (shows through the run-end freeze) like the other banners.
6. **D6 — The crossing check fires from `_onEnemyKilled` (the ONE place score is banked), right after the add.**
   Score is banked in exactly one site; checking the milestone there keeps a SINGLE causal path (a kill banks →
   maybe crosses → maybe 1UPs) and avoids a per-frame poll. *Rationale:* SOLID — co-located with the only score
   writer; KISS — no new update branch for the crossing itself (only the cue timer decays per frame).

---

## 5. Design

### 5.1 Module layout (this phase)

CHANGES `config/constants.ts` (`EXTRA_LIFE_SCORE`), `core/RunState.ts` (the carried field + the pure helper),
`scenes/GameScene.ts` (the crossing check + grant + cue timer), `scenes/HUDScene.ts` (the cue label),
`i18n/en.ts` + `i18n/zh-CN.ts` (`hud.oneUp`), and `scripts/verify-gen.mjs` (extend section 7f). NO new file
(besides this doc). `ONE_UP_BANNER_SEC` is a LOCAL const in GameScene (a single-use cue duration, not shared —
mirrors how `EAGLE_FLASH_MS`/`MUZZLE_OFFSET` are scene-local; D3 of the high-score doc's "local detail" rule).

```
src/
  config/
    constants.ts     # CHANGED (PURE): + EXTRA_LIFE_SCORE = 20000 (the shared milestone step). Verifier-imported.
  core/
    RunState.ts      # CHANGED (PURE): + nextExtraLifeScore (seeded EXTRA_LIFE_SCORE, carried) + extraLivesCrossed() helper.
  scenes/
    GameScene.ts     # CHANGED: _onEnemyKilled crosses-check + grants all slots + oneUp() + arms oneUpTimer; _publishHud mirrors hud.oneUp; update() decays it.
    HUDScene.ts      # CHANGED: + oneUpLabel mirroring hud.oneUp (the registry-decoupled cue — D5).
  i18n/
    en.ts            # CHANGED (PURE): + hud.oneUp (EN source).
    zh-CN.ts         # CHANGED (PURE): + hud.oneUp (ZH ⊆ EN).
scripts/
  verify-gen.mjs     # CHANGED: extend section 7f — nextExtraLifeScore seed/carry + extraLivesCrossed case table.
```

### 5.2 RunState (`core/RunState.ts`)

- **`RunState`** gains `nextExtraLifeScore: number` (the next score that awards a 1UP).
- **`createRunState`** seeds it from `EXTRA_LIFE_SCORE` (imported from `config/constants.js` — PURE).
- **`advance()` + `tickTimers()`** leave it UNTOUCHED (it is run-economy, CARRIED like `score`/`lives`/`tier`).
- **`extraLivesCrossed(prevThreshold, score, step)` (PURE, module-level export):**
  ```
  let lives = 0, nextThreshold = prevThreshold
  while (score >= nextThreshold) { lives += 1; nextThreshold += step }
  return { lives, nextThreshold }
  ```
  `step > 0` ⇒ the loop terminates; `nextThreshold > score` always holds on return.

### 5.3 GameScene (`scenes/GameScene.ts`)

- New scene field `oneUpTimer = 0` (beside `bannerTimer`); local const `ONE_UP_BANNER_SEC` (~2.0 s).
- In `_onEnemyKilled`, AFTER `this.runState.score += enemy.spec.scoreValue`:
  ```
  const { lives, nextThreshold } = extraLivesCrossed(this.runState.nextExtraLifeScore, this.runState.score, EXTRA_LIFE_SCORE)
  if (lives > 0) {
    this.runState.nextExtraLifeScore = nextThreshold
    for (let i = 0; i < lives; i++)
      for (const slot of Object.keys(this.runState.lives)) this.runState.lives[Number(slot)] += 1
    this.sfx.oneUp()
    this.oneUpTimer = ONE_UP_BANNER_SEC
  }
  ```
- In `_publishHud`: `r.set('hud.oneUp', this.oneUpTimer > 0 ? t('hud.oneUp') : '')`.
- In `update()` (beside `bannerTimer`): `this.oneUpTimer = Math.max(0, this.oneUpTimer - dt)` (REAL dt, BEFORE
  the gameOver early-return so the cue finishes showing through the freeze beat). NOT reset by `_buildStage`.

### 5.4 HUDScene (`scenes/HUDScene.ts`)

- Add `oneUpLabel` (centered over the playfield, distinct gold tint, its own depth, placed clear of the
  clear/intro banner). Each frame: `this.oneUpLabel.setText((r.get('hud.oneUp') as string | undefined) ?? '')`.

### 5.5 What does NOT change

- The `tank` power-up's existing per-slot +1 (`_applyPowerUp`) is UNTOUCHED — the milestone is an ADDITIONAL,
  score-driven path that reuses the SAME `lives[]` ledger + `oneUp()` chime (DRY, no conflict).
- The combat/spawn/advance/boss/banner spine, the pure generator, `config/stages.ts`, and the verifier's stage
  sweep are UNTOUCHED — only section 7f of the verifier is extended (5.6).

### 5.6 Verifier extension (`scripts/verify-gen.mjs`, section 7f)

Import `EXTRA_LIFE_SCORE` + `extraLivesCrossed` from the (already node-imported) `constants`/`RunState`. Assert:
fresh `a.nextExtraLifeScore === EXTRA_LIFE_SCORE`; after the `advance()` loop it is STILL `=== EXTRA_LIFE_SCORE`
(carried, like the `score === 4200` check). Then a case table for `extraLivesCrossed`: `(S, S-1, S) → lives 0`;
`(S, S, S) → lives 1, next 2S`; `(S, 2S+1, S) → lives 2, next 3S` (the two-at-once boss edge); every return's
`nextThreshold > score`. No other section changes (the stage sweep + the pin stay byte-unchanged).

---

## 6. Files

**Changed:**

- `src/config/constants.ts` — `EXTRA_LIFE_SCORE = 20000` (the shared milestone step).
- `src/core/RunState.ts` — `nextExtraLifeScore` (seeded + carried) + the PURE `extraLivesCrossed` helper.
- `src/scenes/GameScene.ts` — the crossing check + all-slot grant + `oneUp()` + the `oneUpTimer` cue; `_publishHud` + `update()` wiring.
- `src/scenes/HUDScene.ts` — the `oneUpLabel` mirroring `hud.oneUp`.
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — `hud.oneUp` (both locales; ZH ⊆ EN).
- `scripts/verify-gen.mjs` — extend section 7f (the seed/carry + the `extraLivesCrossed` case table).
- `docs/designs/2026-06-19-extra-life.md` — this design doc.

---

## 7. Verification

- **AC1/AC2/AC3 (constant + carry + helper) — `npm run verify`.** Section 7f asserts the seed + the carry across
  `advance()` and drives the `extraLivesCrossed` case table (no-cross / one-cross / two-at-once / `next > score`).
- **AC4/AC5 (grant + HUD cue) — grep + manual drive.** Grep `extraLivesCrossed` / `nextExtraLifeScore` /
  `oneUpTimer` in `GameScene.ts` and `hud.oneUp` in `HUDScene.ts`. Manual `npm run dev`: rack up ≥ 20000 → all
  present slots gain +1 life, the chime plays, the centered EXTRA-LIFE banner shows briefly; in co-op both gain.
- **AC6 (i18n) — `npm run verify`.** The ZH ⊆ EN check covers `hud.oneUp` in both locales.
- **AC7 (green gate + pure/coupled) — `npm run typecheck` + `npm run build` + `npm run verify`.** All exit 0 /
  print OK. `constants.ts` + `RunState.ts` are node-imported by the verifier (re-proving purity); the scenes
  import Phaser and are never imported. Every verifier section except 7f is byte-unchanged.

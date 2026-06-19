# Tank 1990 — between-stage Bonus tally [stage-bonus]

> Design doc for a focused PLAYABILITY pass on the finished Tank 1990 (a faithful Battle City /
> 坦克大战 clone). Format mirrors the existing F-feature docs (the `hud-stage-flow` / `extra-life`
> convention): Background → Requirements Summary → Acceptance Criteria → Decision Log → Design →
> Files → Verification. This pass adds the classic **between-stage bonus tally**: a brief overlay on
> EVERY stage clear listing kills-by-enemy-type (count × points) plus a stage-clear bonus, before the
> next stage's intro curtain. It tracks a per-stage kills-by-type ledger on RunState (PURE — the
> verifier proves its reset/determinism) and renders the overlay via the SAME registry-mirror +
> GameScene-state-gate idiom the intro curtain already uses (no new scene, no new input plumbing).

---

## 1. Background

Tank 1990 clears a stage and advances on the same beat: a non-boss stage runs straight to
`transitioning = true; delayedCall(0, _advanceStage)` out of `_onEnemyKilled` (a boss stage first arms
the gold STAGE-N-CLEARED banner, then falls through to the SAME advance). The original Battle City
shows a **HI-SCORE / bonus tally** between stages — per enemy TYPE a `count × points` line, a total,
then the next stage. Tank 1990 has the kill score (banked per kill) but no end-of-stage breakdown.

The feature slots into the EXISTING seams with no new architecture:

- **The per-stage tally is run-scoped numeric state → it lives on RunState** (PURE), beside the spawn
  ledger: a `killsByStage: Record<string, number>` keyed by enemy spec `id` (`basic`/`fast`/`power`/
  `armor`/`boss`), zeroed at run start + RESET each `advance()` (the SAME lifecycle as `enemiesAlive`).
  `_onEnemyKilled` already runs on every kill (incl. the boss) and already reads `enemy.spec.id` — it
  bumps the tally there. PURE → the headless verifier node-imports RunState + asserts the reset.
- **The tally OVERLAY is a GameScene state gate**, mirroring the intro curtain (`curtainTimer`) VERBATIM:
  a `tallyTimer` counts a brief window down on the REAL dt; while it is up the world is frozen the SAME
  way the curtain freezes enemy spawn/AI; GameScene publishes the tally rows + bonus to the registry;
  HUDScene renders a centered programmer-art panel. When the window elapses (or the player taps fire)
  GameScene fires the DEFERRED advance — so the tally sits BETWEEN clear and the next stage's curtain.
- **The advance stays deferred + one-shot.** `_onEnemyKilled` already defers `_advanceStage` via
  `transitioning` + `delayedCall`. We keep `transitioning` as the one-shot latch but move the actual
  `_advanceStage()` call to fire when `tallyTimer` reaches 0 (or on the skip edge) — NOT immediately.
  The boss banner + the intro curtain are untouched (the tally plays AFTER the clear, BEFORE the curtain).

**Conventions mirrored from the existing code:** the run-scoped numeric ledger on RunState (reset in
`advance()`, seeded in `createRunState`, PURE — verifier-proven); the GameScene `curtainTimer` freeze-
gate + REAL-dt decay idiom; the registry-mirror banner pattern (GameScene owns WHEN, HUDScene owns HOW);
the one-shot `transitioning` defer discipline (AC10 footgun); all UI text via `t(...)` with keys in BOTH
locales (the verifier asserts ZH ⊆ EN); programmer-art primitives only. Governing: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** on EVERY stage clear show a brief, skippable bonus tally (per-type `count × points` + a stage
bonus) before the next stage begins, without breaking the deferred one-shot advance or the green gate.

**In scope:**

- **`src/core/RunState.ts` (CHANGED, PURE):** ADD `killsByStage: Record<string, number>` (keyed by enemy
  spec id). Seed all five ids to 0 in `createRunState`; RESET them to 0 in `advance()` (beside the ledger
  reset). ADD a `tallyKill(id: string)` method that increments `killsByStage[id]` (KISS — one writer,
  guards an unknown id). PURE — no Phaser.
- **`src/config/constants.ts` (CHANGED, PURE):** ADD `STAGE_BONUS_SEC` (the tally-window duration, ~2.2 s)
  and `STAGE_CLEAR_BONUS` (the flat per-stage clear bonus points). Shared numerics live here ONCE (DRY).
- **`src/scenes/GameScene.ts` (CHANGED):** call `runState.tallyKill(enemy.spec.id)` in `_onEnemyKilled`
  (where score is already banked). ADD a `tallyTimer` state gate (armed at the clear, decayed on REAL dt,
  skippable on the P1 fire edge); while it is up the world freezes (the SAME pair the curtain gates) and
  the DEFERRED `_advanceStage()` is held until it elapses/skips. Bank `STAGE_CLEAR_BONUS` into
  `runState.score` once at the clear. Publish the tally rows + bonus + total to the registry.
- **`src/scenes/HUDScene.ts` (CHANGED):** ADD a centered tally overlay (a framed panel + per-type rows +
  the bonus + total), mirrored from the registry while `hud.tally` is non-empty ('' otherwise). The SAME
  registry-decoupled render idiom as the clear/intro banners.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED):** ADD the tally label keys in BOTH locales.

**Out of scope (explicitly NOT built):** a separate Scene or an input-bound modal object like
PauseOverlay (the curtain's state-gate + registry-mirror is strictly less plumbing — KISS/YAGNI); a
running per-type animated count-up (a static breakdown is the faithful KISS read); a HI-SCORE compare
line (YAGNI — no per-type high-score store exists); any change to the PURE generator/stages or the boss
banner timing (the tally plays after the banner arms, before the curtain — no overlap).

---

## 3. Acceptance Criteria

1. **AC1 — per-stage kills-by-type ledger on RunState (PURE).** `killsByStage` holds one count per enemy
   id (`basic`/`fast`/`power`/`armor`/`boss`), all 0 at run start (`createRunState`) and RESET to 0 on
   every `advance()`. `tallyKill(id)` increments the matching count (and no-ops an unknown id). No Phaser
   import is added to RunState — the headless verifier node-imports it.
2. **AC2 — the tally shows on EVERY stage clear.** On clearing ANY stage (boss OR non-boss) a centered
   overlay shows for ~`STAGE_BONUS_SEC`: a row per enemy type that was killed this stage (`count × points
   = subtotal`), the `STAGE_CLEAR_BONUS`, and a total. The stage-clear bonus is banked to `runState.score`
   exactly ONCE per clear.
3. **AC3 — snappy + skippable.** The window is a couple seconds and ends early on the P1 fire/start edge.
   The next stage's intro curtain plays AFTER the tally dismisses (clear → tally → curtain → play).
4. **AC4 — the deferred one-shot advance is intact.** The stage advances EXACTLY once per clear: the
   `transitioning` latch still fires once; `_advanceStage()` runs OUT of the death/overlap callback (via
   the deferred path), now gated behind the tally window. A run-end racing the tally cancels cleanly (the
   existing `gameOver` re-check). The boss capstone spawn (return-before-guard) is unchanged.
5. **AC5 — green gate + offline.** `npm run typecheck` (strict) + `npm run build` exit 0; `npm run verify`
   prints OK + exits 0 (the verifier's RunState block additionally proves `killsByStage` seeds 0 + resets
   on advance + `tallyKill` increments — the determinism/monotonicity assertions stay green). New i18n keys
   exist in BOTH locales (ZH ⊆ EN). Programmer-art primitives only.

---

## 4. Decision Log

1. **D1 — the per-stage tally is a `Record<string,number>` on RunState, reset in `advance()`.** It is
   run-scoped numeric state with the EXACT lifecycle of the spawn ledger (seeded in `createRunState`, reset
   each stage). *Rationale:* RunState already owns this shape + is the single writer; PURE so the verifier
   proves the reset (DRY with the existing ledger discipline). Keyed by `enemy.spec.id` — the value
   `_onEnemyKilled` ALREADY holds — so the kill funnel bumps it with zero new lookup (KISS).
2. **D2 — the overlay is a GameScene `tallyTimer` STATE GATE mirroring the intro curtain, NOT a
   PauseOverlay-style input-bound object.** The curtain already proves the pattern: a timer decayed on REAL
   dt, a world-freeze while up, a registry-mirrored label. The tally is the SAME shape (one more timer + one
   more registry write). *Rationale:* a PauseOverlay-style object would add its own keyboard plumbing + a
   teardown handshake; the curtain's state-gate is strictly less (KISS/YAGNI/DRY). GameScene owns WHEN,
   HUDScene owns HOW (SOLID — the reference HUD/registry split).
3. **D3 — the DEFERRED advance is HELD behind the tally, not run immediately.** Today `_onEnemyKilled` sets
   `transitioning = true` then `delayedCall(0, _advanceStage)`. We KEEP the `transitioning` one-shot latch
   (so the clear fires once) but arm `tallyTimer` instead of advancing now; `update()` fires
   `_advanceStage()` when `tallyTimer` decays to 0 OR the skip edge hits. *Rationale:* the one-shot guard is
   the AC10 footgun fix — we preserve it verbatim and only DELAY the advance, so the bonus screen sits
   between clear and the next stage (KISS). `_advanceStage` still runs outside any overlap/death callback
   (it runs from `update()`, which is never inside a collision step), so the deferred-safety holds.
4. **D4 — the tally freezes the SAME world the curtain freezes (enemy spawn/AI), and the bonus banks
   once.** While `tallyTimer > 0` the existing `!frozen && !curtain && !transitioning` enemy-pair guard also
   excludes the tally (the world is mid-clear; there are no enemies left anyway). The player + bullets stay
   live (consistent with the curtain). `STAGE_CLEAR_BONUS` is added to `runState.score` at the SAME site the
   tally arms (once, under `transitioning`'s one-shot), so it is banked exactly once. *Rationale:* reuse the
   one freeze idiom (DRY); banking at the one-shot site guarantees once (KISS).
5. **D5 — a single `hud.tally` registry STRING (the fully-formatted multi-line block), NOT a structured
   payload.** GameScene formats the rows (each `t('bonus.row', { name, count, points, sub })`), the bonus,
   and the total into ONE newline-joined string published to `hud.tally` while the tally is up ('' otherwise);
   HUDScene mirrors it into one multi-line Text in a framed panel. *Rationale:* the registry already carries
   pre-localised strings (`hud.banner`, `hud.stageIntro`); a string keeps HUDScene a pure mirror with zero
   formatting logic (SOLID — GameScene owns the run data + formatting, HUDScene owns layout). One key, one
   write, one Text (KISS). Per-type points come from `ENEMY_SPECS[id].scoreValue` / `BOSS_BASE.scoreValue`
   (DRY — the same numbers banked on the kill).
6. **D6 — skip on the P1 fire/start edge already sampled in `update()`.** `update()` already reads
   `s = this.input2.sample()` each frame; the P1 fire edge (`s.p1.firePressed`) ends the window early when
   `tallyTimer > 0`. *Rationale:* the snapshot is already in hand (no new input owner — the sole-sample
   invariant holds); fire/start is the natural "next" button (KISS). No consumePause-style race exists (the
   tally binds no Phaser keyboard handlers of its own — it reads the one sampled edge).

---

## 5. Design

### 5.1 Module layout (this pass)

```
src/
  core/
    RunState.ts   # CHANGED (PURE): + killsByStage{} (seeded 0, reset in advance()) + tallyKill(id) (D1, AC1).
  config/
    constants.ts  # CHANGED (PURE): + STAGE_BONUS_SEC + STAGE_CLEAR_BONUS (shared numerics, DRY).
  scenes/
    GameScene.ts  # CHANGED: tallyKill in _onEnemyKilled; + tallyTimer gate (arm at clear, hold the deferred
                  #   advance, decay on REAL dt, skip on fire); bank bonus once; publish hud.tally (D2/D3/D4/D6).
    HUDScene.ts   # CHANGED: + a centered tally panel mirrored from hud.tally (registry-decoupled, D5, AC2).
  i18n/
    en.ts         # CHANGED (PURE): + bonus.* keys (EN source).
    zh-CN.ts      # CHANGED (PURE): + bonus.* keys (zh-CN override).
docs/designs/
  2026-06-19-stage-bonus.md  # NEW: this design doc.
```

### 5.2 RunState (PURE — D1, AC1)

- ADD `killsByStage: Record<string, number>` to the interface (a per-stage kills-by-id ledger; an intent
  comment noting it RESETS each stage, like the spawn ledger).
- In `createRunState`, seed `killsByStage = { basic: 0, fast: 0, power: 0, armor: 0, boss: 0 }`.
- In `advance()`, reset every count to 0 (beside the spawn-ledger reseed — a fresh stage starts at 0 kills).
- ADD `tallyKill(this, id: string)`: `if (id in this.killsByStage) this.killsByStage[id]++` (guards an id
  outside the roster — KISS/defensive). PURE — no Phaser, node-constructible.

### 5.3 GameScene (D2/D3/D4/D6, AC2/AC3/AC4)

- ADD `private tallyTimer = 0` (SECONDS remaining on the bonus overlay), beside `curtainTimer`, with the
  same intent-comment style. `STAGE_BONUS_SEC` (constants) owns the duration.
- In `_onEnemyKilled`, after banking score, call `this.runState.tallyKill(enemy.spec.id)` (one line, DRY —
  the boss routes here too, so its kill tallies for FREE).
- At the clear (the `transitioning = true` site — the one-shot): instead of `delayedCall(0, _advanceStage)`,
  bank `this.runState.score += STAGE_CLEAR_BONUS` ONCE and arm `this.tallyTimer = STAGE_BONUS_SEC`. The
  `transitioning` latch is still set here (so the clear fires once); the advance is now driven from `update`.
- In `update()`, beside the `curtainTimer` decay: decay `tallyTimer` on the REAL dt (so it ends in real time
  through any freeze). While `tallyTimer > 0`: (a) extend the enemy-pair guard to `&& tallyTimer <= 0` (no
  enemy spawn/AI — there are none left, but the guard stays consistent); (b) on `s.p1.firePressed` set
  `tallyTimer = 0` (skip — D6). When `tallyTimer` crosses to 0 AND `transitioning` (the clear is pending),
  fire `_advanceStage()` ONCE (a `tallyAdvancePending` boolean or the existing `transitioning` latch gates
  the single call). `_advanceStage` re-checks `gameOver` (the existing guard) so a run-end racing the window
  cancels cleanly.
- In `_publishHud`, build the tally string while `tallyTimer > 0`: for each id with a non-zero count, a
  `t('bonus.row', { name: t('bonus.<id>'), count, points, sub })` line; append `t('bonus.clearBonus', {
  pts })` and `t('bonus.total', { pts })`; join with `\n` and publish to `hud.tally` ('' otherwise). The
  per-type points read from `ENEMY_SPECS[id].scoreValue` (boss from `BOSS_BASE.scoreValue` — DRY).

### 5.4 HUDScene (D5, AC2)

- ADD a `tallyLabel` (multi-line Text) + a framing rectangle, centered over the playfield (the SAME
  `PLAYFIELD_X/Y/W/H` geometry the banners use), depth above the readouts. Mirror `hud.tally` into the Text
  each frame; show the frame + text only while the string is non-empty (the SAME mirror discipline as
  `bannerLabel`). Programmer-art rectangle + Text only. A neutral/gold chrome distinct from the clear banner.

### 5.5 Integration points (what does NOT change)

- The boss capstone spawn (return-before-guard in `_onEnemyKilled`), the gold STAGE-N-CLEARED banner, the
  intro curtain, pause, run-end, and the spawn/AI freeze idiom are otherwise UNCHANGED — the tally is one
  extra timer gate + one extra registry write + a held (not removed) deferred advance.
- The PURE generator, `config/stages.ts`, and the verifier's generator/roster blocks are UNTOUCHED.

---

## 6. Files

**New:** `docs/designs/2026-06-19-stage-bonus.md` — this design doc.

**Changed:**

- `src/core/RunState.ts` — `killsByStage` ledger + `tallyKill` (PURE; seeded 0, reset in `advance()`).
- `src/config/constants.ts` — `STAGE_BONUS_SEC` + `STAGE_CLEAR_BONUS` (shared numerics, DRY).
- `src/scenes/GameScene.ts` — tally the kill; the `tallyTimer` gate (arm at clear, hold the deferred advance,
  decay on REAL dt, skip on fire); bank the clear bonus once; publish `hud.tally`.
- `src/scenes/HUDScene.ts` — the centered tally panel mirrored from `hud.tally` (registry-decoupled).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — the `bonus.*` keys (both locales).
- `scripts/verify-gen.mjs` — EXTEND the existing RunState block: assert `killsByStage` seeds all-0,
  `tallyKill` increments, and `advance()` resets it to 0 (the PURE-state proof; keeps the gate green/honest).

**i18n keys to add (BOTH locales):**

- `bonus.title` — `BONUS` / `奖励结算`
- `bonus.row` — `{name} {count} × {points} = {sub}` / `{name} {count} × {points} = {sub}`
- `bonus.clearBonus` — `STAGE CLEAR {pts}` / `通关奖励 {pts}`
- `bonus.total` — `TOTAL {pts}` / `合计 {pts}`
- `bonus.basic` / `bonus.fast` / `bonus.power` / `bonus.armor` / `bonus.boss` — the per-type display names
  (e.g. `BASIC` / `普通`, `FAST` / `快速`, `POWER` / `火力`, `ARMOR` / `装甲`, `BOSS` / `首领`).

---

## 7. Verification

- **AC1 (PURE ledger) — `npm run verify`.** The RunState block asserts `killsByStage` seeds all ids to 0,
  `tallyKill('basic')` etc. increment the right count (and an unknown id no-ops), and `advance()` resets
  every count to 0 — all under plain node (no Phaser import added).
- **AC2/AC3 (tally on every clear, skippable) — manual drive + grep.** Clear a non-boss stage → a centered
  bonus panel shows the per-type breakdown + the stage-clear bonus + total for ~`STAGE_BONUS_SEC`; tapping
  fire dismisses it early; THEN the next stage's intro curtain plays. Same on a boss stage (after the gold
  banner arms). Grep `tallyTimer` / `tallyKill` / `hud.tally` in `GameScene.ts` + `HUDScene.ts`.
- **AC4 (one-shot advance intact) — drive + read.** The stage advances exactly once per clear; a run-end
  during the tally cancels via the `gameOver` re-check; the boss capstone still spawns instead of advancing
  on the normal-roster clear.
- **AC5 (green gate) — `npm run typecheck` + `npm run build` + `npm run verify`.** All exit 0 / print OK; the
  `bonus.*` keys exist in BOTH `en.ts` + `zh-CN.ts` (ZH ⊆ EN stays green). Programmer-art primitives only.

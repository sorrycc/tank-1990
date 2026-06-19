# Tank 1990 — Scene & lifecycle audio (more SFX, zero new assets)

## 1. Background

F6 added `src/audio/Sound.ts` — a procedural WebAudio façade (zero asset files; every sound synthesized
at runtime from `_tone`/`_noise` through gain envelopes) and wired it at the combat event sites in
`GameScene` (fire / brick-hit / steel-clink / explosion / power-up / 1-up / boss-spawn / stage-cleared /
game-over) plus a single `uiSelect()` on the Title's start gesture. Several **scene and lifecycle events
remain silent**: there is no stage-START cue, the meta `HubScene` has no `Sound` at all (navigation, buy,
start-run are silent), the `GameOverScene` screen is silent, and player respawn / pause-resume / power-up
drop have no audio. The user asked to "add more scene audio ... e.g. start the game and others".

## 2. Requirements Summary

- **Goal:** Add procedural SFX for currently-silent scene/lifecycle events, consistent with the existing
  zero-asset synth façade (the audio twin of `effects/Effects.ts`).
- **Scope (4 groups):** (1) stage-start fanfare; (2) Hub scene audio — move / buy-ok / buy-denied /
  start-run; (3) GameOver screen audio — continue blip; (4) respawn cue, pause-resume blip, power-up-drop cue.
- **Non-goals (explicit):** no background music; no asset files / no `load.*`; no i18n strings (audio has
  none); no config/constants changes; the headless verifier stays green (it never imports `Sound.ts` or scenes).

## 3. Acceptance Criteria

1. `src/audio/Sound.ts` gains five new methods — `stageStart()`, `respawn()`, `uiMove()`, `denied()`,
   `itemDrop()` — each `_gateOk`-guarded, composed only from the existing `_tone`/`_noise` primitives,
   distinct by ear from one another and from the existing methods, and a safe no-op under NoAudio / when muted.
2. A stage-start fanfare plays when each stage's intro curtain is armed (`GameScene._buildStage`) — on the
   first stage and on every advance — and is audibly distinct from the `stageCleared()` win flourish.
3. `HubScene` constructs a `Sound`; cursor navigation plays `uiMove()` **only on an actual cursor change**
   (clamped no-move at a list end is silent); a successful buy plays `uiSelect()`, a rejected buy (maxed /
   unaffordable) plays `denied()`; start-run plays `uiSelect()`.
4. `GameOverScene` constructs a `Sound`; the continue gesture (key / pointer → Hub) plays `uiSelect()`.
5. Player respawn plays `respawn()` (death→respawn path only); a carrier power-up drop plays `itemDrop()`.
   Pause already blips on OPEN (`_openPause` calls `uiSelect()` today, GameScene.ts:805) — this adds the
   matching blip on RESUME (`_closePause`), also `uiSelect()`; the pause toggle intentionally shares one
   confirm blip on both edges (see Decision 7).
6. `npm run typecheck`, `npm run build`, and `npm run verify` all pass.

## 4. Problem Analysis

- **Add SFX inside the entities (Tank, Base, PowerUpPool)** — rejected. Violates the established D6 stance:
  the SCENE is the single audio owner; entities stay audio-free. Would scatter `new Sound` / context
  handling across entities.
- **A new dedicated method per new event, fully bespoke** — partially adopted. Genuinely new *semantic*
  events (stage start, respawn, Hub denied, item drop, nav tick) get their own method so they read distinctly.
  But menu-confirm style events reuse the existing `uiSelect()` (DRY) rather than minting near-duplicates.
- **Chosen approach** — extend the `Sound` façade with five new semantic methods built from the *existing*
  `_tone`/`_noise`/`_gateOk` primitives (no new synthesis machinery), and wire each at the scene event site
  that already exists. Reuse `uiSelect()` for the three "menu confirm" beats (Hub buy-ok, Hub start-run,
  GameOver continue, pause resume). This mirrors F6 exactly: one semantic method per event, called from the
  scene orchestrator. Two scenes (`HubScene`, `GameOverScene`) gain a `Sound` instance, same pattern as
  `TitleScene` / `GameScene`.

## 5. Decision Log

**1. Where do new sounds live — entity or scene?**
- Options: A) call audio from entities · B) keep the scene as the single audio owner (the F6/D6 stance)
- Decision: **B)** — entities stay audio-free; the scene calls `sfx.*` at the resolution site. Matches every
  existing call site and keeps WebAudio/context handling in one place.

**2. New methods vs. reusing existing ones.**
- Options: A) a bespoke method for every new event · B) new methods only for genuinely new timbres, reuse
  `uiSelect()` for menu-confirm beats
- Decision: **B)** — DRY. New: `stageStart`, `respawn`, `uiMove`, `denied`, `itemDrop`. Reuse `uiSelect()`
  for Hub buy-success, Hub start-run, GameOver continue, and pause resume (all are "confirm/advance" beats,
  which is exactly what `uiSelect()` already is).

**3. GameOver screen entry sting?**
- Options: A) continue-blip only (no entry sting) · B) add a distinct soft entry tone
- Decision: **A)** — continue-blip only. `gameOver()` already plays in `GameScene._triggerGameOver()` under
  the run-end freeze beat (~700 ms before this screen loads, where it belongs dramatically). A second entry
  sound would be redundant. KISS. (Reversible — flag in Phase 4 if the user wants B.)

**4. Hub cursor-move blip — every keypress or only on real movement?**
- Options: A) every nav keypress · B) only when the clamped cursor actually changes
- Decision: **B)** — capture `cursor` before/after the `Phaser.Math.Clamp`; play `uiMove()` only when it
  changed, so hammering into a list end is silent (no machine-gun tick). KISS, less noise.

**5. respawn() — every spawn or only the death→respawn?**
- Options: A) every player spawn (incl. per-stage `_buildPlayer`) · B) only the in-stage death→respawn path
- Decision: **B)** — the per-stage initial spawn beat is already covered by `stageStart()`; playing respawn
  for every player on every stage build would double up and feel noisy. `respawn()` marks the clear
  "I came back" moment in `_onPlayerDeath` after `respawnAt`.

**7. Pause OPEN vs RESUME — distinct beat or shared confirm blip?**
- Options: A) shared `uiSelect()` on both edges (pause "toggle" sound) · B) a distinct descending `uiBack()`
  on resume so close ≠ open
- Decision: **A)** — `_openPause()` ALREADY calls `this.sfx.uiSelect()` (GameScene.ts:805); this design adds
  ONLY the matching RESUME blip in `_closePause()`. Both edges share one confirm blip (a classic pause
  toggle). KISS / YAGNI / DRY (the user's stated convention) and the user explicitly approved `uiSelect()`
  for `_closePause`. AC1's "distinct by ear" goal governs the five NEW methods, not the open/resume pair —
  the requirement ("audio feedback on pause + resume") is met either way. Reversible: a distinct `uiBack()`
  is a one-method add later if the user prefers B in review.

**6. Sound design (timbres) — keep each new sound distinct.**
- Decision: parameters below; each uses a distinct waveform/direction so it doesn't collide with neighbours.
  - `stageStart()` — two ascending square tones (G4→C5 with a lift); a "get-ready / go". Distinct from
    `stageCleared()`'s A-major three-note arpeggio. Throttle gap 0.2 s.
  - `respawn()` — a soft ascending **triangle** sweep (materialize); softer + different waveform than the
    square `powerUp()`. Throttle 0.1 s.
  - `uiMove()` — a quiet, short low square tick; far quieter/lower than the bright `uiSelect()` sweep.
    Throttle 0.02 s (matches `uiSelect`'s tight gap for snappy nav).
  - `denied()` — a low **descending sawtooth** buzz (a "nope"). Throttle 0.05 s.
  - `itemDrop()` — a short **descending sine** sparkle + a high noise tick ("an item appeared"); descending
    sine vs. `powerUp()`'s ascending square keeps drop ≠ collect. Throttle 0.1 s.

## 6. Design

### `src/audio/Sound.ts` — five new semantic methods (additive only)

Each method follows the exact shape of the existing ones: a `_gateOk(key, gap)` early-return guard, then one
or two `_tone`/`_noise` calls. No new primitives, no new fields, no constructor change. Indicative params
(may be tuned during impl; the *shape* is fixed by Decision 6):

```ts
// stageStart — a short two-note "get-ready / go" fanfare for the STAGE-N intro curtain (distinct from the
// stageCleared win arpeggio). Throttled like the other jingles so a same-frame double-build can't stack it.
stageStart(): void {
  if (!this._gateOk('stageStart', 0.2)) return
  this._tone({ freq: 392, type: 'square', dur: 0.14, gain: 0.28 })                          // G4
  this._tone({ freq: 523, type: 'square', dur: 0.2, gain: 0.28, delay: 0.13, sweepTo: 587 }) // C5 → D5 lift
}

// respawn — a soft ascending triangle "materialize" blip (the audio twin of the spawn-shield visual).
respawn(): void {
  if (!this._gateOk('respawn', 0.1)) return
  this._tone({ freq: 300, type: 'triangle', dur: 0.18, gain: 0.2, sweepTo: 760 })
}

// uiMove — a quiet low tick for Hub cursor navigation (deliberately softer/lower than uiSelect).
uiMove(): void {
  if (!this._gateOk('uiMove', 0.02)) return
  this._tone({ freq: 420, type: 'square', dur: 0.05, gain: 0.14 })
}

// denied — a low descending sawtooth buzz for a rejected Hub buy (maxed / can't afford).
denied(): void {
  if (!this._gateOk('denied', 0.05)) return
  this._tone({ freq: 200, type: 'sawtooth', dur: 0.14, gain: 0.22, sweepTo: 120 })
}

// itemDrop — a short descending sine sparkle + a high noise tick when a carrier drops a power-up
// (descending vs. powerUp's ascending collect, so drop ≠ collect by ear).
itemDrop(): void {
  if (!this._gateOk('itemDrop', 0.1)) return
  this._tone({ freq: 1180, type: 'sine', dur: 0.1, gain: 0.18, sweepTo: 760 })
  this._noise({ dur: 0.04, gain: 0.1, type: 'highpass', freq: 3000 })
}
```

### Scene wiring

`src/scenes/GameScene.ts` (already owns `this.sfx`):
- `_buildStage()` — at the line that arms `this.curtainTimer = STAGE_INTRO_SEC`, add `this.sfx.stageStart()`.
  Deliberate overlap note: on a BOSS-stage advance, `_onEnemyKilled` plays `stageCleared()` (GameScene.ts:973,
  inside the `if (isBossStage())` branch at L968 — normal-stage advances do NOT play it) and then defers
  `_advanceStage` → `_buildStage` (GameScene.ts:1036), which plays `stageStart()` ~same beat. The two use
  different `_gateOk` keys, so neither throttles the other — the clear flourish tails briefly into the next
  "get-ready". This is intentional and acceptable (they are distinct timbres, Decision 6).
- `_onPlayerDeath()` — inside the `if (remaining > 0)` block, after `tank.respawnAt(sp.x, sp.y)`, add
  `this.sfx.respawn()`.
- `_closePause()` — `_openPause()` ALREADY plays `this.sfx.uiSelect()` on the OPEN edge (GameScene.ts:805).
  Add the matching RESUME blip: after the overlay is torn / `paused` cleared, add `this.sfx.uiSelect()`
  (shared pause-toggle blip — Decision 7).
- `_markDrop()` — add `this.sfx.itemDrop()` (alongside the existing kill burst).

`src/scenes/HubScene.ts` (currently NO audio — add a `Sound`):
- Import `Sound`; add a `private sfx!: Sound` field; `this.sfx = new Sound(this)` at the top of `create()`.
- `_move(slot, dir)` — capture the cursor before the clamp; after clamping, `if (col.cursor !== before)
  this.sfx.uiMove()` before `_render()`.
- `_buy(slot)` — **REPLACE** the existing bare `this.meta.buy(slot, row.id)` call (HubScene.ts:167) with a
  return-capturing one: `const ok = this.meta.buy(slot, row.id)` (do NOT add a second `buy()` call — a second
  call would double-debit the shared bank). Then `if (ok) this.sfx.uiSelect(); else this.sfx.denied()`; then
  `_render()`.
- `_startRun()` — `this.sfx.uiSelect()` before `this.scene.start('Game')`.

`src/scenes/GameOverScene.ts` (currently NO audio — add a `Sound`):
- Import `Sound`; `const sfx = new Sound(this)` in `create()` (local is fine — only the `toHub` closure uses it).
- In `toHub`, call `sfx.uiSelect()` before `this.scene.start('Hub')`.

### Data flow / safety

- WebAudio context is resumed on the first user gesture (the Title click). By the Hub / Game / GameOver the
  context is already running, so every new sound plays reliably. No context handling changes.
- `_gateOk` already early-returns under NoAudio and when `this.sm.mute` is set, so every new method is a safe
  no-op headless and respects the `M` mute + global volume for free.
- The HUB `Sound` is constructed per scene `create()`; the field is reset each entry (scenes are
  single-instance and torn down on transition), so no leak.

## 7. Files Changed

- `src/audio/Sound.ts` — add 5 semantic methods (`stageStart`, `respawn`, `uiMove`, `denied`, `itemDrop`),
  each from existing primitives.
- `src/scenes/GameScene.ts` — call `stageStart()` (`_buildStage`), `respawn()` (`_onPlayerDeath`),
  `uiSelect()` (`_closePause`), `itemDrop()` (`_markDrop`).
- `src/scenes/HubScene.ts` — construct `Sound`; `uiMove()` on real cursor move; in `_buy`, REPLACE the bare
  `meta.buy(...)` with a return-capturing call and branch `uiSelect()` (bought) / `denied()` (no-op); `uiSelect()`
  on start-run.
- `src/scenes/GameOverScene.ts` — construct `Sound`; `uiSelect()` on continue.

## 8. Verification

1. [AC1] Read `Sound.ts`: 5 new methods present, each starts with `_gateOk(...)` and only calls
   `_tone`/`_noise`; no new fields/imports. `npm run typecheck` clean.
2. [AC2] `npm run dev`, start a run → a stage-start fanfare plays as the "STAGE N" curtain shows; clear a
   stage → the start fanfare plays again on the next stage and is distinct from the clear flourish.
3. [AC3] In the Hub: arrow/WASD nav ticks (`uiMove`) and is silent at a list end; buying an affordable
   upgrade plays the confirm blip, a maxed/unaffordable row plays the denied buzz; Enter (start-run) blips.
   Confirm the shared currency debits exactly ONCE per successful buy (the `meta.buy` call was replaced, not
   duplicated) — i.e. the currency drop matches the upgrade cost.
4. [AC4] On GAME OVER, press Space/Enter/click → continue blip plays before the Hub loads.
5. [AC5] Lose a life with lives remaining → respawn blip; pause (P/ESC) blips on open (existing) AND on
   resume (new); kill a red-flashing carrier → item-drop sparkle when the pickup appears.
6. [AC6] `npm run typecheck && npm run build && npm run verify` all pass (verify is unaffected — it never
   imports `Sound.ts` or the scenes).

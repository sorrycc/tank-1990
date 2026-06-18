# Tank 1990 — F6 Boss milestones, co-op finish, audio & balance (the capstone polish pass)

> Design doc for **F6 Boss & co-op polish**, the FINAL feature of Tank 1990 (a faithful Battle City /
> 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design docs EXACTLY: Background →
> Requirements Summary → Acceptance Criteria → Decision Log → Design → Files → Verification. F0 stood up
> the booting skeleton (six scenes, pure RNG, defensive `util/save.ts` carrying the meta schema). F1 made
> a drivable tank that fires pooled bullets. F2 built the PURE, SEEDED, headlessly-VERIFIED 13×13 stage.
> F3 made the bullets MATTER (every collision resolved, the eagle-loss run-over, pooled FX, respawn, co-op
> FF off). F4 filled in the game loop (the four classic enemy types on the ONE Tank FSM, the
> staggered/capped spawn loop, the stage-clear advance, the run economy on `core/RunState.ts`). F5 closed
> the meta loop (the six classic power-ups, the two-column Hub, banking, the full HUD, the i18n layer).
> **F6 is the capstone:** it adds the BOSS MILESTONE tank (a 5th `config/tanks.ts` entry + a `'boss'`
> behaviour tag on the SAME Tank entity — the locked decision — with a telegraphed wind-up borrowed from
> the reference's `Boss` telegraph idea), spawned on every `BOSS_STAGE_EVERY` (=5) stage, with an in-HUD
> "STAGE N CLEARED" banner on its defeat; FINALIZES 2-player co-op (P2 spawn/lives/shared-base/shared-score
> fully wired end-to-end, friendly-fire-off honoured, the run ending only on base-loss or all shared lives
> spent); adds `src/audio/Sound.ts` (the reference's PURE-of-assets WebAudio façade — synthesized SFX, NO
> asset files — with a mute toggle) and wires its call sites; adds a both-players controls reference to the
> Title; and runs a DATA-ONLY balance pass over the PURE config tables for a winnable-but-tense feel. It
> ships NO new entity, NO new scene, and leaves the headless verifier GREEN (the boss spec gets REAL
> well-formedness assertions; the balance numbers stay within the existing monotone envelopes).

---

## 1. Background

In Battle City, every few stages the roster culminates in a tougher fight, and the classic's pacing is
carried as much by its iconic blips (the fire "pew", the brick crunch, the steel "tink", the explosion,
the power-up jingle, the 1-up chime, the game-over knell) as by its tanks. Tank 1990 has, through F5, a
complete endless run loop with the four classic enemy types, the six power-ups, the meta Hub, and a full
HUD — but four threads are deliberately left for this final pass:

- **No boss.** `config/stages.ts` already flags every 5th stage `isBoss: true`; `core/RunState.ts` already
  exposes `isBossStage()`; the F4 doc + the `tanks.ts` header both pre-declare "the boss is a 5th spec + a
  'boss' tag on this SAME entity/FSM (the locked decision)". But **no boss spec exists**, the spawn loop
  (`GameScene._spawnStep`) only ever picks the four normal archetypes via `rosterPick`, and **nothing
  shows a "STAGE N CLEARED" banner**. The seam is fully prepared; F6 fills it.
- **Co-op is wired but never declared finished.** F3/F4/F5 already built co-op CORRECTLY: `Input.sample()`
  returns BOTH players; `GameScene` spawns/drives P2 under the `TWO_PLAYER` flag; lives are a per-slot
  `RunState.lives` ledger; `score` is shared; the base + currency are shared; `FRIENDLY_FIRE` is OFF and
  the bullet×tank / bullet×bullet filters honour it; `_checkRunOver` tallies ONLY the present players, so a
  run ends when the base falls (`base.onDestroyed → _triggerGameOver`) OR every present player's lives are
  spent. **What's missing is a deliberate END-TO-END finalization + the verifier/grep proof that it holds**
  (plus the boss interaction: a co-op grenade/normal kill must route the boss through the SAME funnel).
- **No audio.** The F5 doc explicitly scoped audio OUT ("an audio layer — the reference's `Sound` blips —
  Tank 1990 has none; YAGNI"). The reference's `src/audio/Sound.ts` is a PURE-of-assets WebAudio façade:
  ONE semantic method per event, all synthesis hidden, ZERO `load.*` calls, a null-safe no-op under
  NoAudio, a per-key throttle, and a mute proxy over Phaser's global mute. F6 ports that façade trimmed to
  Tank 1990's events and wires the call sites.
- **The Title has no controls reference.** F5 swapped the Title literals to `t(...)` but it shows only the
  heading/subtitle/start prompt. The reference's `TitleScene` renders a `CONTROLS_ROWS` reference so a
  first-time player discovers every binding; Tank 1990's brief wants the Title to show **both** players'
  schemes (P1 = WASD + J fire; P2 = arrows + Numpad0 fire).

F6 resolves all four, mirroring the reference's conventions EXACTLY, adapted to the faithful-classic shape:

- **The boss is the reference's TELEGRAPH idea on Tank 1990's ONE FSM — NOT the reference's separate `Boss`
  class.** The reference's `entities/Boss.ts` is a bespoke choose→telegraph→strike→recover phase FSM
  (a platformer boss). Tank 1990's LOCKED decision is the opposite: the boss is the SAME `Tank` entity +
  the SAME enemy AI (wander/seek + fire), distinguished by a `'boss'` behaviour TAG + a heavy spec (high
  HP / faster-or-multi-shot fire) and ONE borrowed idea — a **telegraphed fire wind-up** (a brief, visible
  blink before the boss shoots, so its heavier volley is readable/dodgeable, the reference's "every attack
  is telegraphed" contract). No new entity, no new scene, no new FSM — a behaviour tag + a spec + a small
  pre-fire blink branch in `Tank.updateAI` (D1/D2).
- **The "STAGE N CLEARED" banner is a SIMPLE timed text overlay on the existing HUD registry — NO new
  scene.** GameScene already owns the stage-clear edge (`_onEnemyKilled` → `_advanceStage`) and the
  registry-decoupled HUD. F6 publishes a `hud.banner` string (+ an expiry) the HUD renders as a centered
  timed overlay, exactly as the F5 HUD renders the active power-up line — a banner is a registry value, not
  a scene (D5).
- **Audio is the reference's `Sound` façade, trimmed (YAGNI) + wired at the existing event sites.** The
  brief's SFX set: `fire`, `brick-hit`, `steel-clink`, `explosion`, `power-up`, `1-up`, `game-over`. F6
  ports the reference's `_tone`/`_noise` primitives + `_gateOk` throttle + the mute proxy VERBATIM in
  shape, exposes ONE method per event, and calls them at the sites that already exist (Tank.tryFire, the
  bullet×brick/steel/explosion resolutions, the power-up pickup, the +1-life pickup, the run-over edge). A
  mute toggle (the `M` key) flips Phaser's global mute (D7/D8).
- **The Title controls reference is the reference's `CONTROLS_ROWS` pattern, trimmed to Tank 1990's two
  schemes.** A small i18n `CONTROLS_ROWS` table + two fixed-x columns (action | keys), positioned off the
  FIXED design resolution — the reference's exact CJK-safe alignment discipline (D9).
- **Balance is DATA-ONLY in the PURE config tables — the verifier stays the gate.** F6 tunes only numbers
  in `config/constants.ts` / `config/tanks.ts` / `config/stages.ts` (tank speeds, fire cadence, spawn
  cadence, currency ratio) for a winnable-but-tense feel, every `stages.ts`/`tanks.ts` change kept WITHIN
  the existing monotone/clamped envelopes the verifier already proves; the invariant-bearing `constants.ts`
  SCALARS the existing sweeps DON'T read (`CURRENCY_RATIO`, `FIRE_COOLDOWN`) get NEW guard assertions, the
  rest are documented out-of-gate — so the gate is HONESTLY complete, not green-by-handwave (D10, issue #3).

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split (the boss
spec + the balance numbers live in PURE `config/*` node-imported by the verifier; `audio/Sound.ts`,
`TitleScene`, `HUDScene`, `Tank`, `GameScene` are Phaser-coupled and NEVER imported by the verifier);
`audio/Sound.ts` IS the reference's WebAudio façade (no assets, a NoAudio no-op, a per-key throttle, a mute
proxy); the registry-decoupled HUD (the banner is a registry value, like the active power-up); `dt` in
SECONDS at the boundary (the telegraph + banner timers tick on the GAMEPLAY/REAL `dt` like every other
timer); the ONE-FSM behaviour-tag stance (the boss is a tag, not a subclass — `tanks.ts` already pins it);
the deferred-destructive-teardown footgun discipline (a boss kill routes through the SAME deferred
`_advanceStage`); heavy intent-revealing comments citing the section + AC + Decision numbers. Governing
conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Spawn a heavy BOSS tank on every `BOSS_STAGE_EVERY`-th stage (a 5th `config/tanks.ts` spec + a
`'boss'` behaviour tag on the SAME `Tank` entity, with a telegraphed fire wind-up), as the stage's
CAPSTONE (it spawns as the LAST enemy of the boss stage, after the normal roster is cleared); show an
in-HUD "STAGE N CLEARED" banner (a simple timed text overlay — no separate scene) when a boss stage is
cleared; FINALIZE 2-player co-op end-to-end (P2 spawn/lives/shared-base/shared-score, FF off, run ends on
base-loss or all shared lives spent — the boss honours the same funnels); add `src/audio/Sound.ts` (the
reference's PURE-of-assets WebAudio façade with `fire`/`brickHit`/`steelClink`/`explosion`/`powerUp`/
`oneUp`/`gameOver` + a mute toggle) and wire its call sites; add a both-players controls reference to the
Title; run a DATA-ONLY balance pass in the PURE config tables; all green on `typecheck`/`build`/`verify`.

**In scope (F6):**

- **`src/config/tanks.ts` (CHANGED, PURE):** ADD the `'boss'` behaviour to the `TankBehavior` union, ADD a
  `BOSS` `TankSpec` (the 5th spec — heavy `maxHp` ≥ the armor tank, a faster/heavier fire profile, a
  telegraph window field, a high `scoreValue`), and a `BOSS_SPEC` export + a `bossSpecForStage(stageIndex)`
  PURE fold that scales the boss's `maxHp` (and only that — never its telegraph) with the stage so a deeper
  boss is tankier but EQUALLY readable (the reference's `scaleBossSpec` philosophy, trimmed). The
  `TankSpec` gains an OPTIONAL `telegraphSec?` field (default 0 = no telegraph, the IDENTITY for every
  non-boss spec, so the existing four archetypes + the player fold byte-unchanged). The boss is NOT added
  to `ENEMY_ARCHETYPES`/`ENEMY_SPECS` (those are the `rosterPick` pool — the boss is spawned EXPLICITLY by
  the scene on the boss stage, not weighted into the roster — D3). All PURE — the verifier node-imports it.
- **`src/config/constants.ts` (CHANGED, PURE):** ADD the boss tunables (`BOSS_TELEGRAPH_SEC`,
  `BOSS_HP_PER_BOSS_STAGE` the per-boss-stage HP ramp, the boss's base `BOSS_TANK_HP`) + the
  "STAGE N CLEARED" banner duration (`STAGE_CLEARED_BANNER_SEC`) + the balance-pass numbers (any retuned
  speeds/cadences live here as the existing DRY owners). All PURE.
- **`src/config/stages.ts` (CHANGED, PURE — balance only):** retune ONLY the existing ramp CONSTANTS (the
  base densities/ramps, the enemy-count ramps, the spawn-cadence ramp) for the winnable-but-tense feel —
  WITHIN the existing clamps so the verifier's monotonicity + cap sweep stays green by construction. No new
  fields, no new functions (the balance pass is a number edit — D10).
- **`src/audio/Sound.ts` (NEW; Phaser-coupled — the WebAudio façade):** the reference's `Sound` façade,
  TRIMMED to Tank 1990's events. The `_tone`/`_noise` synthesis primitives + the `_gateOk` per-key throttle
  + the `MASTER_GAIN`/headroom + the `mute` proxy over `scene.sound.mute` are ported VERBATIM in shape (the
  reference's Decisions 1–7). The semantic methods: `fire()` (a short pew), `brickHit()` (a dry crunch),
  `steelClink()` (a bright metallic tink), `explosion(opts?)` (a noise thud, louder for a `big` burst),
  `powerUp()` (an ascending blip), `oneUp()` (a three-note 1-up chime), `gameOver()` (a low descending
  knell), `bossSpawn()` (a low ominous swell), `stageCleared()` (a short win flourish for the banner). A
  `Sound` instance is constructed per scene that needs it (GameScene owns the gameplay one; TitleScene/Hub
  reuse the menu blips if desired — YAGNI: F6 wires gameplay + the run-end + a Title-driven mute hint).
  NoAudio → every method no-ops (AC). NEVER imported by the verifier (it imports Phaser/WebAudio).
- **`src/entities/Tank.ts` (CHANGED, Phaser-coupled):** ADD a `telegraphSec`/`telegraphTimer` field +
  a pre-fire TELEGRAPH branch in `updateAI` for the `'boss'` behaviour (and any spec with `telegraphSec >
  0`): instead of firing the frame the cooldown elapses, the boss ARMS a telegraph timer + sets a
  `telegraphing` flag; `firePressed` is suppressed until the telegraph elapses, then fires; the visual
  blinks the barrel/body a warning colour during the wind-up (the reference's telegraph idea, on the ONE
  FSM). A non-boss spec (`telegraphSec === 0`) takes the EXISTING immediate-fire path byte-unchanged (the
  identity — DRY/no second code path). The boss reuses the SAME movement spine, the SAME `onHit` HP funnel
  (its high `maxHp` gives multi-hit "for free" — exactly like the armor tank), the SAME `onDeath`. NO new
  entity. (The audio `fire()`/hit hooks are called from GameScene, not the entity — the entity stays
  Phaser-render-coupled but audio-free, SOLID — see D6.)
- **`src/scenes/GameScene.ts` (CHANGED):** on a BOSS stage (`runState.isBossStage()`), spawn the BOSS as
  the stage CAPSTONE — the normal roster streams first, and when the last NORMAL enemy is cleared the scene
  spawns ONE boss (from `bossSpecForStage(stageIndex)`) instead of advancing; the boss is registered
  through the SAME `_registerTankOverlap` + `_collideTankWithTerrain` + carrier/onDeath/onDropFlag seams
  (DRY — it's a `Tank`). When the BOSS dies, the stage clears: publish the "STAGE N CLEARED" banner to the
  registry (a timed value), play `sound.stageCleared()`, then defer `_advanceStage` (the SAME one-shot
  guard). Wire the audio façade: construct ONE `Sound` in `create()`; call `sound.fire()` on a successful
  `tryFire`, `sound.brickHit()`/`sound.steelClink()`/`sound.explosion()` in the bullet×solid resolution,
  `sound.explosion({big})` on a tank/base kill, `sound.powerUp()`/`sound.oneUp()` on a pickup (oneUp for
  the `tank` kind), `sound.bossSpawn()` on the boss spawn, `sound.gameOver()` under the run-over guard.
  Bind the `M` mute toggle (the single owner). Publish `hud.banner`/`hud.bannerSecs` each frame. The co-op
  finalization is mostly a CONFIRMATION (the seams already hold) + the boss routing through the present-
  player funnels.
- **`src/scenes/HUDScene.ts` (CHANGED):** render the "STAGE N CLEARED" banner — a centered, large, timed
  text line read from `hud.banner` (blank when no banner active), exactly as the active-power-up line is
  read from `hud.powerKind` (the registry-decoupled pattern — D5). Add a small "MUTED" indicator when
  `hud.muted` is set (optional, KISS). Positioned off the FIXED design resolution.
- **`src/scenes/TitleScene.ts` (CHANGED):** render a both-players controls reference (the reference's
  `CONTROLS_ROWS` pattern): a small i18n table of (action, keys) rows for P1 (WASD move · J fire) + P2
  (arrows move · Numpad0 fire) + the shared keys (SPACE/ENTER start · M mute), in fixed-x columns off the
  design resolution. Flow unchanged (→ Hub). Optionally construct a `Sound` so the start blip plays (YAGNI:
  reuse `uiSelect`-style — but keep it minimal).
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** ADD the new chrome strings — the
  `controls.*` rows (title + each action/keys label), the `hud.stageCleared` banner template, the
  `hud.muted` label — in BOTH locales. ADD `CONTROLS_ROWS` (the ordered `[actionKey, keysKey]` pairs) to
  `i18n/index.ts` (the reference's export shape) so the Title reads ONE shared table (DRY). PURE.
- **`scripts/verify-gen.mjs` (CHANGED):** ADD a boss-spec well-formedness section (the `BOSS` spec is a
  valid `TankSpec` with `behavior === 'boss'`, `maxHp` ≥ the armor tank's HP, a positive `scoreValue`, a
  `telegraphSec > 0`; PLUS a CONCRETE, headless, monotone-safe HEAVIER-FIRE data check — issue #2:
  `BOSS.bulletSpeed >= POWER.bulletSpeed` AND `BOSS.fireCooldown <= BASIC.fireCooldown` (the verifier
  already imports `BASIC`/`POWER`), so "heavier fire" is an actual ASSERTION on the spec table, not a
  manual-drive claim — `bulletSpeed`/`fireCooldown` are the spec's RAW, pre-`bulletSpeedScale` numbers the
  verifier can read directly, so the comparison is well-defined headlessly; `bossSpecForStage(s)` is PURE +
  deterministic + MONOTONE non-decreasing in `maxHp` across boss stages + NEVER weaker than the base boss +
  leaves `telegraphSec` AND the fire fields (`bulletSpeed`/`fireCooldown`) UNSCALED — readability + the
  heavier-fire profile preserved at depth). ASSERT the boss is NOT in `ENEMY_ARCHETYPES`/`ENEMY_SPECS` (it's
  spawned explicitly, not weighted — D3) and that `rosterPick` therefore still only ever returns the four
  normal ids (the F4 check, reaffirmed). The `stages.ts` balance retune is covered for free by the EXISTING
  stage-monotonicity + cap sweep, and the `tanks.ts` retune by the EXISTING four-types-distinct + star-fold
  checks — but the `constants.ts` SCALAR balance edits (`CURRENCY_RATIO`/`FIRE_COOLDOWN`/`TANK_SPEED`/
  `BULLET_SPEED`/`SPAWN_STAGGER_BASE`) are NOT read by any existing sweep, so F6 ADDS two small guard
  assertions for the invariant-bearing ones (`0 < CURRENCY_RATIO < 1`, `FIRE_COOLDOWN > 0`) and documents the
  rest as out-of-gate (issue #3 — see §7 AC8 + D10). The new i18n `controls.*` keys are covered by the
  EXISTING `ZH_CN.ui ⊆ EN.ui` structural check. EXTEND (do NOT rewrite) the verifier; every F0–F5 section
  stays byte-unchanged.

**Out of scope (F6 — explicitly NOT built):** a separate boss SCENE or a bespoke boss ENTITY/FSM (the
locked decision is a behaviour tag on the ONE `Tank` — F6 honours it; the reference's `Boss.ts`
phase-FSM/dash/volley/sweep/summon patterns are NOT ported — only the telegraph IDEA is); music/background
loops (the reference's `Sound` has none either — only SFX blips; YAGNI); audio asset files of any kind (the
façade synthesizes everything — the project's no-asset constraint); a volume SLIDER or a persisted mute
preference (the `M` toggle flips Phaser's runtime global mute; persisting it is a `language`-row-style later
feature — YAGNI: F6 does NOT add a `muted` field to the save schema); ICE low-friction feel; STEEL becoming
bullet-destructible by a max-star tank (the `canBreakSteel` flag is DATA from F4 — no bullet reads it; F6
does NOT change that); any new power-up/enemy type; a 3-player+ mode (the locked decision is 2-player
co-op). F6 ships ONLY the boss milestone + banner, the co-op finalization, the audio façade + wiring, the
Title controls reference, and the balance pass.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a manual
> `npm run dev` drive-test. The boss SPEC + the `bossSpecForStage` fold + the balance numbers are PURE and
> gain REAL headless assertions in the verifier; the boss SPAWN, the banner, the audio, the controls
> reference, and the co-op end-to-end flow are Phaser-coupled (the scenes/entity/façade) and are proved by
> grep + the manual drive.

1. **AC1 — a boss tank appears on every 5th stage as the stage capstone.** On a stage where
   `runState.isBossStage()` is true (`stageConfig(stageIndex).isBoss`, the 0-based indices 4, 9, 14, …),
   the normal roster streams + clears as usual, and when the last NORMAL enemy is cleared `GameScene`
   spawns exactly ONE BOSS tank (from `bossSpecForStage(stageIndex)`) at a top spawn — NOT a normal
   archetype. The boss is the SAME `Tank` entity (a `'boss'` behaviour tag), drives the SAME grid-snap
   movement, and is registered through the SAME terrain-collide + bullet×tank overlap seams. A non-boss
   stage spawns NO boss (the four archetypes only).
2. **AC2 — the boss is heavy + telegraphs its fire.** The `BOSS` spec has `maxHp` ≥ the armor tank's HP
   (multi-hit "for free" via the F3 HP funnel — it survives many hits) and a CONCRETE heavier fire profile,
   data-checked headlessly (issue #2): `BOSS.bulletSpeed >= POWER.bulletSpeed` AND
   `BOSS.fireCooldown <= BASIC.fireCooldown` (a fast bolt AND a shorter beat than a basic tank). Before each
   shot the boss TELEGRAPHS: it arms a `BOSS_TELEGRAPH_SEC` wind-up (a visible barrel/body warning blink) and
   only fires when it elapses (the reference's "every attack is telegraphed/dodgeable" idea, on the ONE FSM).
   `bossSpecForStage(s)` scales the boss's `maxHp` up with deeper boss stages (tankier) but leaves
   `telegraphSec` AND the fire fields UNSCALED (equally readable + equally heavy-fire at depth — the dodge
   contract). The fire-profile half is thus a verifier ASSERTION, not a manual-drive claim.
3. **AC3 — clearing a boss stage shows a "STAGE N CLEARED" banner (a timed overlay, no new scene).** When
   the boss dies, the stage-clear edge publishes a "STAGE N CLEARED" string to the scene REGISTRY with a
   `STAGE_CLEARED_BANNER_SEC` expiry; the parallel HUD renders it as a centered timed text overlay (the
   registry-decoupled pattern — like the active-power-up line) and clears it when the timer elapses. No
   separate scene is created. The banner shows the human stage number just cleared.
4. **AC4 — the boss routes through the SAME kill/score/advance funnels (DRY).** The boss takes damage via
   the SAME `Tank.onHit` funnel (its high HP gives multi-hit — like armor); a player bullet OR a co-op
   grenade kills it through the SAME `onDeath`; its death banks its `scoreValue` to the shared `score`, and
   the stage advance defers through the SAME one-shot `transitioning` guard / `_advanceStage`. **The grenade
   timing edge is pinned (issue #5):** on a boss stage, a grenade fired while only NORMAL enemies are alive
   clears the roster and routes the last kill through `_onEnemyKilled`'s capstone branch → it SPAWNS the boss
   (it does NOT advance the stage — the boss may not exist yet); a grenade fired while the BOSS is the one
   alive enemy kills the boss in one (`onHit(boss.maxHp)` bypasses its multi-hit HP, exactly as it one-shots
   armor) → that kill routes to the banner + advance. So "a co-op grenade kills the boss" requires the boss to
   already be SPAWNED — the grenade-clears-roster case spawns it, never skips it (§5.4 issue (b)). The boss is
   pinned a NON-carrier so the boss fight stays clean — no `onDropFlag` drop, no power-up on its death-center
   mid-transition (D11). No new kill path.
5. **AC5 — 2-player co-op is fully playable end-to-end.** With `TWO_PLAYER` true: P1 (WASD + J) and P2
   (arrows + Numpad0) both spawn at their generated spawns, share the eagle base + the run `score` + the
   meta currency, have INDEPENDENT per-slot lives, and friendly-fire is OFF (a player bullet passes an
   allied player tank; same-side bullets don't cancel). The run ends ONLY when the base falls
   (`base.onDestroyed`) OR EVERY present player's lives are spent (`_checkRunOver` tallies only the present
   slots). A solo session (`TWO_PLAYER` false) spawns/drives only P1, hides the P2 HUD line, and ends when
   P1's last life is spent — no phantom P2 blocks the run-over. The boss fight honours all of this (both
   players can damage the boss; the boss can kill either player or the base).
6. **AC6 — programmer-synth SFX are wired with a mute toggle.** `src/audio/Sound.ts` synthesizes every
   sound at runtime from `OscillatorNode`/noise-buffer through gain envelopes (ZERO asset files, no
   `load.*`). The wired events fire audibly: `fire()` on a shot, `brickHit()`/`steelClink()` on a
   brick/steel hit, `explosion()` on a kill/impact, `powerUp()` on a pickup, `oneUp()` on the `tank`
   (+1-life) pickup, `bossSpawn()` on the boss spawn, `stageCleared()` on the banner, `gameOver()` on the
   run-over. The `M` key toggles mute (flipping Phaser's global mute — every later sound respects it). Under
   a NoAudio manager (headless / no WebAudio) every method is a safe no-op that never throws.
7. **AC7 — the Title shows BOTH control schemes.** `TitleScene` renders a controls reference listing P1's
   bindings (WASD move · J fire), P2's bindings (arrows move · Numpad0 fire), and the shared keys
   (SPACE/ENTER start · M mute), positioned off the FIXED design resolution (centered under Scale.FIT) and
   localised via `t(...)`/`CONTROLS_ROWS`. The user (zh-CN) sees Chinese chrome with literal key tokens
   (WASD/J/Numpad0 stay literal — they name physical keys).
8. **AC8 — balance is tuned in the PURE config tables for a winnable-but-tense feel.** The retune lives
   ONLY in `config/constants.ts` / `config/tanks.ts` / `config/stages.ts` (tank speeds, fire cadence, spawn
   cadence, currency ratio, the boss HP/telegraph) — DATA edits, no logic. Every retuned `stages.ts` value
   stays WITHIN its existing clamp so the verifier's monotonicity + cap sweep stays green; every retuned
   tank stat keeps the four archetypes pairwise-distinct + the star fold monotone (the F4 checks stay
   green). The balance pass changes no module's SHAPE (no new fields beyond the boss/banner additions).
9. **AC9 — the boss spec + the `bossSpecForStage` fold are headlessly PROVEN well-formed + monotone +
   heavier-fire.** The verifier node-imports `config/tanks.ts` (re-proving purity) and asserts: `BOSS` is a
   well-formed `TankSpec` (`behavior === 'boss'`, positive numeric feel fields, integer `maxBullets`,
   `scoreValue ≥ 0`), `BOSS.maxHp ≥ ARMOR.maxHp` (heavier than the armor tank), `BOSS.telegraphSec > 0`, AND
   the CONCRETE heavier-fire data check `BOSS.bulletSpeed ≥ POWER.bulletSpeed` AND
   `BOSS.fireCooldown ≤ BASIC.fireCooldown` (issue #2 — both raw spec numbers, comparable headlessly);
   `bossSpecForStage(s)` is deterministic, returns a NEW spec (no aliasing), is MONOTONE non-decreasing in
   `maxHp` across boss stages, is NEVER weaker than `BOSS` at the base, and leaves `telegraphSec` AND the fire
   fields (`bulletSpeed`/`fireCooldown`) UNSCALED (equal heavier-fire + readability at depth); and the boss is
   ABSENT from `ENEMY_ARCHETYPES`/`ENEMY_SPECS` so `rosterPick` still only ever returns the four normal ids
   (the F4 distinctness/known-id checks stay green — the boss is never weighted into the roster, D3).
10. **AC10 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run build`
    exit 0; `npm run verify` prints OK + exits 0 with the NEW F6 boss-spec assertions PLUS the F0–F5 sweep
    UNCHANGED (the balance retune passes the existing stage sweep by construction — the numbers stay in the
    clamps; §7f's `createRunState` calls + every other block are byte-unchanged). `config/tanks.ts`,
    `config/constants.ts`, `config/stages.ts` import NO Phaser (node-imported by the verifier — re-proving
    purity); `audio/Sound.ts`, `entities/Tank.ts`, `world/*`, and the scenes import Phaser/WebAudio and are
    NEVER imported by the verifier. Programmer-art primitives + synthesized audio only; runs offline /
    `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — The boss is a 5th `config/tanks.ts` spec + a `'boss'` behaviour TAG on the SAME `Tank` entity,
   NOT a new entity/scene/FSM (the LOCKED decision, already pre-declared).** `config/tanks.ts`'s header +
   the F4 doc both say "the boss is a 5th spec + a 'boss' tag on this SAME entity/FSM"; `core/RunState.ts`
   already exposes `isBossStage()` "for the boss feature to read"; the `TankBehavior` union already reserves
   the slot ("the boss adds 'boss' here"). F6 fills exactly that: add `'boss'` to the union, add a `BOSS`
   spec, and spawn `new Tank(scene, x, y, 'enemy', BOSS_SPEC)` — the boss IS an enemy `Tank` with the boss
   spec. It drives the SAME grid-snap movement (F1), the SAME wander/seek AI (F4), the SAME `onHit` HP
   funnel (F3 — its high `maxHp` is multi-hit "for free", exactly like ARMOR), the SAME `onDeath`/score/
   advance. *Rationale:* the decision is LOCKED + the seam is fully prepared — implementing it as a tag is
   the minimal, DRY, faithful path (no second movement/AI/combat code path; the reference's separate
   `Boss.ts` would be speculative complexity Tank 1990 explicitly rejected — YAGNI). SOLID: a boss is a
   data spec, the entity is the behaviour. PURE/coupled split: the spec is PURE config (verifier-imported),
   the entity stays coupled (never imported).
2. **D2 — The ONE idea borrowed from the reference's `Boss.ts` is the TELEGRAPH: a brief, visible fire
   wind-up, implemented as an OPTIONAL `telegraphSec` spec field + a small branch in `Tank.updateAI` (the
   identity for every non-boss).** The reference's boss telegraphs every attack so it stays dodgeable; Tank
   1990 borrows ONLY that, expressed as data. `TankSpec` gains an OPTIONAL `telegraphSec?` (default 0). In
   `Tank.updateAI`, when `telegraphSec > 0` and the fire cooldown elapses, instead of setting
   `firePressed = true` immediately the boss ARMS a `telegraphTimer = telegraphSec` + a `telegraphing`
   flag, holds fire during the wind-up (`firePressed = false`), blinks a warning colour, then sets
   `firePressed = true` the frame the telegraph elapses. A spec with `telegraphSec === 0` (the four
   archetypes + the player) takes the EXISTING immediate-fire branch BYTE-UNCHANGED — the new branch is
   gated behind `telegraphSec > 0`, so it's purely additive (no behaviour change for existing tanks).
   *Rationale:* the telegraph is the one thing that makes a heavy-fire boss FAIR (its faster/heavier shot
   is readable) — borrowing the IDEA (not the FSM) keeps the ONE-FSM decision intact while honouring the
   brief's "a telegraphed wind-up reusing the reference's telegraph idea". KISS — one optional field, one
   gated branch. DRY — no second fire path; the default-0 identity keeps the existing tanks unchanged. The
   telegraph window is UNSCALED by depth (D3's `bossSpecForStage` only scales HP) so a deeper boss stays
   equally dodgeable (the reference's "telegraph preserved at depth" stance).
3. **D3 — The boss is spawned EXPLICITLY by the scene on the boss stage, NOT weighted into `rosterPick`;
   `bossSpecForStage(stageIndex)` scales ONLY `maxHp` (the reference's `scaleBossSpec`, trimmed).** The
   boss is NOT added to `ENEMY_ARCHETYPES`/`ENEMY_SPECS` (the four-id `rosterPick` pool the F4 verifier
   proves only-ever-returns-a-known-id) — keeping it out means the roster picks stay the four normal types
   (the F4 distinctness + known-id checks stay green untouched). Instead, on a boss stage the scene streams
   the normal roster, and when the last NORMAL enemy clears, spawns ONE boss from
   `bossSpecForStage(stageIndex)` — a PURE fold that returns a NEW `BOSS_SPEC` clone with `maxHp` scaled up
   by the boss-stage count (e.g. `maxHp = BOSS_TANK_HP + BOSS_HP_PER_BOSS_STAGE · bossNumber`), clamped, and
   `telegraphSec`/feel UNSCALED. *Rationale:* a boss weighted into `rosterPick` would (a) break the F4
   verifier's "only four ids" check and (b) let the boss spawn mid-stage at random — wrong. An explicit
   capstone spawn is the classic (the boss is the stage's finale), and a PURE `maxHp`-only fold mirrors the
   reference's `scaleBossSpec` (tankier-but-equally-readable) trimmed to Tank 1990's single scalar (KISS —
   one ramp, the verifier proves it monotone + never-weaker; DRY — reuses `BOSS_SPEC` as the base). PURE —
   verifier-imported.
4. **D4 — The boss spawns as the stage CAPSTONE (after the normal roster clears), reusing the EXISTING
   stage-clear edge — NOT a parallel spawn system.** F4's `_onEnemyKilled` already detects "no more queued
   AND none alive → stage clear" and defers `_advanceStage`. F6 inserts ONE branch there: if this is a boss
   stage AND the boss hasn't spawned yet, spawn the boss (instead of advancing); the boss's own death
   re-reaches the clear edge (now `bossSpawned && boss dead`), which fires the banner + advances. The boss
   is spawned via the SAME `_spawnStep`-style construction (a `Tank` + `_registerTankOverlap` +
   `_collideTankWithTerrain` + `onDeath`) factored into a small `_spawnBoss()` helper (DRY with
   `_spawnStep`). *Rationale:* reusing the stage-clear edge means the boss needs NO new spawn-cadence/cap
   logic — it's a single capstone enemy gated by a `bossSpawned` flag (KISS). The normal roster still
   streams via the unchanged `_spawnStep` (the boss-stage `totalEnemies` is the normal count; the boss is
   EXTRA, after). SOLID — `_spawnStep` streams the roster, `_spawnBoss` places the capstone, `_onEnemy
   Killed` orchestrates the transition. The deferred `_advanceStage` + one-shot `transitioning` guard are
   reused verbatim (the footgun discipline — AC4/AC10).
5. **D5 — The "STAGE N CLEARED" banner is a REGISTRY VALUE the HUD renders timed — NOT a new scene.** The
   brief says "a simple timed text overlay; no separate scene". GameScene already publishes the full HUD
   state to the registry each frame (`_publishHud`) and the HUD reads it (the F5 registry-decoupling). F6
   adds two registry keys: `hud.banner` (the localised "STAGE N CLEARED" string, or empty) +
   `hud.bannerSecs` (the remaining seconds). On the boss-stage clear, GameScene sets a
   `bannerTimer = STAGE_CLEARED_BANNER_SEC` (decayed on the REAL `dt` like the FX, so it shows even during
   the run-end freeze beat) and publishes the string while `bannerTimer > 0`. The HUD renders it as ONE
   centered large timed text line, exactly as it renders the active-power-up line — created once, filled
   each frame, blank when no banner. *Rationale:* a banner is presentation state → the registry is its home
   (the reference's HUD/registry split); a new scene for a 2-second text overlay is over-engineering (KISS/
   YAGNI). DRY — reuses `_publishHud` + the HUD's fixed-text-line pattern. SOLID — GameScene owns WHEN the
   banner shows (the clear edge + the timer), the HUD owns HOW it renders (decoupled, registry-only).
6. **D6 — Audio is wired at the SCENE (the event orchestrator), NOT inside the entities — the `Sound`
   façade lives in `GameScene` (+ optionally the menu scenes); entities stay audio-free.** The reference's
   hit/fire sites call `sound.*` from the SCENE that resolves the event (GameScene's overlap callbacks +
   `tryFire` call site), keeping the entity a pure render/physics actor. F6 follows: `Tank.tryFire` returns
   whether it fired (it already arms cooldown on success — the scene reads the result and calls
   `sound.fire()`); the bullet×solid / bullet×tank / pickup / run-over resolutions (all already in
   GameScene) call the matching `sound.*`. The boss spawn calls `sound.bossSpawn()`; the banner edge calls
   `sound.stageCleared()`. *Rationale:* one audio owner (GameScene) mirrors the one Input owner + the one
   Effects owner (SOLID — the scene orchestrates world events; the entity doesn't reach for the audio
   graph); it avoids threading a `Sound` into every entity (KISS/DRY). The façade is constructed once per
   scene that needs it (the reference's per-scene `new Sound(this)`). PURE/coupled: `Sound` is Phaser/
   WebAudio-coupled (never verifier-imported); the entity stays coupled-but-audio-free.
7. **D7 — `src/audio/Sound.ts` is the reference's WebAudio façade, ported VERBATIM in SHAPE + TRIMMED to
   Tank 1990's events (YAGNI).** The `_tone(o)` (oscillator → gain envelope, optional sweep), `_noise(o)`
   (white-noise buffer → biquad → envelope), `_gateOk(key, minGap)` (no-ctx / muted / throttled → silence),
   the `MASTER_GAIN`/`THROTTLE_GAP` headroom, the `ctx = scene.sound.context ?? null` source + the NoAudio
   null-guard, and the schedule-on-the-WebAudio-clock discipline are copied FAITHFUL in shape from the
   reference (its Decisions 1–7). The SEMANTIC methods are Tank 1990's: `fire`/`brickHit`/`steelClink`/
   `explosion`/`powerUp`/`oneUp`/`gameOver`/`bossSpawn`/`stageCleared` (the reference's `swing`/`shoot`/
   `parry`/`wallJump`/… are OMITTED — Tank 1990 has no melee/parry/wall-jump; YAGNI). Each composes the two
   primitives into a distinct timbre. *Rationale:* the brief mandates "the reference's WebAudio façade (no
   asset files)" — porting the proven primitives + throttle + mute + NoAudio guard verbatim is the DRY,
   low-risk path (the synthesis is hard to get right; the reference already did); trimming the method set to
   the events Tank 1990 actually fires keeps it minimal (KISS/YAGNI). NoAudio → silent no-op (the verifier/
   headless never breaks; AC6). NEVER imported by the verifier (it touches WebAudio — coupled).
8. **D8 — The mute toggle is the `M` key flipping Phaser's GLOBAL mute via the façade's `mute` proxy — NO
   separate flag, NO persisted preference (YAGNI).** The reference's `Sound.mute` getter/setter proxies
   `scene.sound.mute` (Phaser's global mute), so every sound everywhere flips at once and the façade owns
   no separate flag. F6 binds `M` (a `keydown-M` once-per-press, in GameScene — the one audio owner) to
   `sound.mute = !sound.mute` and publishes `hud.muted` so the HUD shows a "MUTED" cue. The mute is RUNTIME
   only (not saved) — persisting it would need a save-schema field (a later feature, like the language row —
   YAGNI). *Rationale:* the global-mute proxy is the reference's exact stance (KISS — the façade owns no
   mute flag; DRY — one Phaser-level mute respected by every sound); a runtime toggle is all the brief asks
   ("a mute toggle"). SOLID — GameScene (the audio owner) owns the toggle; the HUD reads the cue from the
   registry (decoupled).
9. **D9 — The Title controls reference is the reference's `CONTROLS_ROWS` pattern: a SHARED i18n table +
   fixed-x columns off the design resolution.** `i18n/index.ts` exports `CONTROLS_ROWS` (the reference's
   shape — an ordered list of `[actionKey, keysKey]` pairs); `TitleScene` renders each row as two fixed-x
   text columns (action label | keys), positioned from `DESIGN_WIDTH`/`DESIGN_HEIGHT` (never
   `window.innerWidth` — the F0 layout discipline, CJK-safe: fixed-x columns, never `padEnd`). The rows
   cover P1 (move/fire), P2 (move/fire), and the shared keys (start/mute). The key TOKENS (WASD, J,
   Numpad0, SPACE, ENTER, M) stay literal (they name physical keys — not translatable), the ACTION labels
   localise. *Rationale:* mirroring the reference's `CONTROLS_ROWS` export + fixed-x render is the DRY way
   to put the bindings in ONE place (the i18n table) read by the Title (KISS — no per-row UI code); the
   fixed-x columns are the proven CJK-safe alignment (the reference's discipline). SOLID — the i18n table
   owns the binding text, the Title owns the layout. The bindings themselves stay owned by `core/Input.ts`
   (the single key owner) — the table is a human-readable MIRROR, documented as such (a comment ties the
   token strings to `Input`'s `addKeys`, so a rebind updates both — KISS-honest about the small duplication).
10. **D10 — The balance pass is DATA-ONLY in the PURE config tables, kept WITHIN the existing
    monotone/clamped envelopes so the verifier stays green BY CONSTRUCTION.** The retune touches only NAMED
    constants/ramps in `config/constants.ts` (tank/bullet speeds, fire cooldown, the spawn-stagger base,
    `CURRENCY_RATIO`) + `config/stages.ts` (the base densities/ramps, the count ramps, the spawn-cadence
    ramp) + `config/tanks.ts` (the per-archetype feel numbers + the boss spec). Every `stages.ts` edit
    keeps `base + k·s` within the existing `CAP` (the verifier's cap sweep) and keeps each `k ≥ 0`
    (terrain/counts) / `k ≤ 0` (spawn interval) so monotonicity holds by construction; every `tanks.ts`
    edit keeps the four archetypes pairwise-distinct on `{moveSpeed,bulletSpeed,maxHp}` + keeps the star
    fold monotone (the F4 checks). **HONESTY on coverage (issue #3):** "green by construction" is TRUE for the
    `stages.ts` ramps (the cap/monotone sweep reads them) and the `tanks.ts` feel numbers (the distinctness +
    star-fold checks read them) — but it was NOT true for the `constants.ts` SCALARS `CURRENCY_RATIO`/
    `FIRE_COOLDOWN`/`TANK_SPEED`/`BULLET_SPEED`/`SPAWN_STAGGER_BASE`, which NO existing block reads. So D10 no
    longer CLAIMS construction-greenness for those: F6 ADDS two guard assertions for the invariant-bearing
    scalars (`0 < CURRENCY_RATIO < 1` so the meta economy stays sane; `FIRE_COOLDOWN > 0` so the player spec
    stays well-formed) and documents the remaining speeds as OUT-OF-GATE-as-standalone-scalars (covered only
    transitively via their derived specs' positivity/distinctness — §7 AC8). *Rationale:* the brief says
    "data-only tuning in the PURE config tables … Keep the verifier green" — keeping the table edits inside
    the proven envelopes keeps the sweeps the balance gate, and the two NEW scalar guards close the gap the
    sweeps didn't cover, so the gate is now HONESTLY complete (no silent invariant break). KISS — a number
    edit + two one-line guards; DRY — the constants are already the single owners; SOLID — balance is data.
11. **D11 — The boss is a NON-carrier (no power-up drop) so the boss fight stays clean; its `scoreValue` is
    the highest (the capstone reward).** F4's carrier flag drops a power-up on a red-flashing enemy's death;
    the boss could be a guaranteed carrier, but pinning it a NON-carrier keeps the boss fight about the
    boss (not a scramble for its drop) and avoids a power-up spawning ON the boss's death-center mid-
    transition (a footgun edge). The boss's `scoreValue` is set ABOVE the armor tank's (the capstone is the
    biggest single reward). *Rationale:* KISS — the boss is a fight, not a loot piñata; pinning the carrier
    decision (NON-carrier) keeps the death path simple (no drop, no extra deferred body — AC4). YAGNI — a
    boss drop is not required by the brief (the banner + score IS the reward). The seam stays OPEN (a future
    tune could flag it a carrier — `enemy.carrier` is just a bool) without F6 needing it.

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F6 ADDS `audio/Sound.ts`; CHANGES `config/tanks.ts`/`constants.ts`/
`stages.ts` (the boss spec + balance), `entities/Tank.ts` (the telegraph branch), `scenes/GameScene.ts`
(the boss spawn + banner + audio wiring + co-op finalize), `scenes/HUDScene.ts` (the banner line),
`scenes/TitleScene.ts` (the controls reference), `i18n/*` (the new chrome + `CONTROLS_ROWS`), and the
verifier:

```
src/
  audio/
    Sound.ts            # NEW (Phaser/WebAudio-coupled): the reference's Sound façade, trimmed —
                        #   fire/brickHit/steelClink/explosion/powerUp/oneUp/gameOver/bossSpawn/stageCleared
                        #   + _tone/_noise/_gateOk + the mute proxy. NoAudio no-op. NEVER verifier-imported.
  config/
    constants.ts        # CHANGED (PURE): + BOSS_TANK_HP / BOSS_TELEGRAPH_SEC / BOSS_HP_PER_BOSS_STAGE /
                        #   STAGE_CLEARED_BANNER_SEC + the retuned balance numbers. No Phaser.
    tanks.ts            # CHANGED (PURE): + 'boss' behaviour + BOSS spec + telegraphSec? + bossSpecForStage().
                        #   The boss is NOT in ENEMY_ARCHETYPES/ENEMY_SPECS (D3). No Phaser. Verifier-imported.
    stages.ts           # CHANGED (PURE, balance only): retuned ramp constants within the existing clamps. No Phaser.
  core/
    RunState.ts         # (F4/F5, unchanged — isBossStage() already exists; the scene reads it)
    Input.ts            # (F1, unchanged — already returns BOTH players; the Title mirrors its bindings)
  entities/
    Tank.ts             # CHANGED (Phaser-coupled): + telegraphSec/telegraphTimer + the gated telegraph
                        #   branch in updateAI (identity for telegraphSec===0). NEVER verifier-imported.
  scenes/
    BootScene.ts        # (unchanged)
    TitleScene.ts       # CHANGED: + the both-players controls reference (CONTROLS_ROWS, fixed-x columns).
    HubScene.ts         # (F5, unchanged — co-op two-column already wired)
    GameScene.ts        # CHANGED: _spawnBoss capstone on a boss stage; the STAGE-N-CLEARED banner;
                        #   the Sound façade + the M mute; the co-op finalization (confirm the seams +
                        #   route the boss through the present-player funnels). 
    HUDScene.ts         # CHANGED: + the banner line (registry-read, timed) + an optional MUTED cue.
    GameOverScene.ts    # (F5, unchanged — gameOver() sound is called from GameScene at the run-over edge)
  i18n/
    index.ts            # CHANGED (PURE): + CONTROLS_ROWS export (the reference's shape). No Phaser.
    en.ts               # CHANGED (PURE): + controls.* + hud.stageCleared + hud.muted chrome (the EN source).
    zh-CN.ts            # CHANGED (PURE): + the zh-CN overrides for the new chrome.
  main.ts               # (F5, unchanged)
scripts/
  verify-gen.mjs        # CHANGED: + the boss-spec well-formedness + bossSpecForStage monotone/never-weaker
                        #   section + the boss-absent-from-roster reaffirmation. F0–F5 sections byte-unchanged.
```

### 5.2 Key types + data (PURE — `config/tanks.ts` + `config/constants.ts`)

- **`TankBehavior` (CHANGED):** add `'boss'` → `'basic' | 'fast' | 'power' | 'armor' | 'player' | 'boss'`
  (the union the F4 header already reserved the slot in). The verifier's `KNOWN_BEHAVIORS` set gains
  `'boss'`.
- **`TankSpec.telegraphSec?` (NEW OPTIONAL, default 0 — the IDENTITY):** seconds of pre-fire wind-up. The
  four archetypes + the player OMIT it (→ 0 → the existing immediate-fire path, byte-unchanged). Only the
  boss sets it (`BOSS_TELEGRAPH_SEC`). Defaulting to 0 keeps every existing spec + the star/upgrade folds
  byte-unchanged (the verifier's identity pins hold).
- **`BOSS` (NEW `TankSpec`):** `{ id:'boss', behavior:'boss', maxHp: BOSS_TANK_HP (≥ ARMOR_TANK_HP),
  moveSpeed: ~TANK_SPEED (a heavy, deliberate cruise), bulletSpeed: a fast bolt — pinned `≥ POWER.bulletSpeed`
  (the heavier-fire data check, AC2/AC9), fireCooldown: a measured beat — pinned `≤ BASIC.fireCooldown` (the
  other half of the heavier-fire check; the telegraph wind-up keeps the heavier shot FAIR), maxBullets: 1–2,
  telegraphSec: BOSS_TELEGRAPH_SEC, color/colorFlash: a distinct heavy fill, scoreValue: the highest
  (> ARMOR.scoreValue) }`. Heavy-armor + (verifier-asserted) heavy-fire, telegraphed.
- **`bossSpecForStage(stageIndex)` (NEW PURE fold):** returns a NEW `BOSS` clone with `maxHp` scaled by the
  boss number: `maxHp = round(min(BOSS_HP_MAX, BOSS_TANK_HP + BOSS_HP_PER_BOSS_STAGE · bossNumber))` where
  `bossNumber = floor((stageIndex+1)/BOSS_STAGE_EVERY)` (1 on the first boss stage, 2 on the second, …).
  `telegraphSec` AND the fire fields (`bulletSpeed`/`fireCooldown`) are UNSCALED — so a deeper boss is tankier
  but EQUALLY readable AND keeps the same `bulletSpeed ≥ POWER` / `fireCooldown ≤ BASIC` heavier-fire profile
  (the verifier asserts the fold leaves these fields equal to `BOSS`'s — issue #2). The reference's
  `scaleBossSpec` philosophy, trimmed to the single `maxHp` scalar. NEVER mutates `BOSS` (referential safety —
  the aliasing discipline `scaleSpec`/`scaleBossSpec` keep). PURE — verifier-imported.
- **`config/constants.ts` (NEW):** `BOSS_TANK_HP` (the base boss HP, ≥ `ARMOR_TANK_HP`),
  `BOSS_TELEGRAPH_SEC` (the wind-up window), `BOSS_HP_PER_BOSS_STAGE` (the per-boss-stage HP ramp),
  `BOSS_HP_MAX` (the clamp), `STAGE_CLEARED_BANNER_SEC` (the banner duration). Plus the retuned balance
  numbers (any changed `TANK_SPEED`/`BULLET_SPEED`/`FIRE_COOLDOWN`/`SPAWN_STAGGER_BASE`/`CURRENCY_RATIO`).

### 5.3 The telegraph branch (`entities/Tank.ts`)

`Tank` gains `telegraphSec` (copied from spec in the ctor) + `telegraphTimer`/`telegraphing` (runtime
state). In `updateAI`, the fire decision changes ONLY when `telegraphSec > 0`:

```
// (existing, telegraphSec === 0): fire on the beat — the identity, byte-unchanged.
this.aiIntent.firePressed = this.cooldownTimer <= 0

// (new, telegraphSec > 0 — gated): a telegraphed wind-up before each shot (D2).
//   • cooldown elapsed AND not yet telegraphing → ARM the telegraph (telegraphTimer = telegraphSec,
//     telegraphing = true); firePressed stays false (holding fire during the wind-up).
//   • telegraphing → decay telegraphTimer on dt; firePressed = (telegraphTimer <= 0); when it elapses,
//     fire THIS frame + clear telegraphing (the cooldown then re-arms on the successful tryFire).
//   • the visual blinks a warning colour while telegraphing (a render cue in update()).
```

The branch is purely additive (gated behind `telegraphSec > 0`) — a non-boss tank never enters it, so the
four archetypes + the player are unchanged (DRY — one fire path, the boss is a gated variant). The
telegraph decays on the GAMEPLAY `dt` the scene already passes (so a clock freeze pauses the wind-up too —
consistent with every other timer; the stall is pinned in §5.4 issue (a)).

**The telegraph RENDER cue — a DISTINCT `update()` branch keyed on `this.telegraphing` (issue #4 — pinned).**
The earlier draft said the blink "reuses the existing carrier-flash render hook shape". That is WRONG as a
render PATH: the carrier-flash hook (the current `Tank.update` lines 245–248) is gated on
`this.carrier && this.spawnIframe <= 0`, and D11 pins the boss a NON-carrier — so the boss can NEVER enter
that branch and the telegraph would have NO render path. F6 therefore adds its OWN branch in `update()`,
placed RIGHT AFTER the carrier-flash block (lines 245–248), reusing only the SHAPE (a clock-driven
`setFillStyle` swap), not that branch's condition:
```
// (existing carrier-flash block, lines 245–248 — unchanged; the boss is a non-carrier so never enters it.)
if (this.carrier && this.spawnIframe <= 0) { … }

// NEW telegraph render cue (issue #4): a DISTINCT branch — fires for any tank actively winding up a shot,
// regardless of carrier. Gated on `this.telegraphing && this.spawnIframe <= 0` so it does NOT fight the
// spawn-blink alpha branch (lines 166–172, which owns the alpha while spawnIframe > 0). Swaps the body +
// barrel FILL to a warning colour at ~5 Hz off the scene clock (a fill swap only — never touches alpha):
else if (this.telegraphing && this.spawnIframe <= 0) {
  const warn = Math.floor(this.scene.time.now / 100) % 2 === 0  // ~5 Hz blink (faster than the carrier pulse).
  this.rect.setFillStyle(warn ? TELEGRAPH_FILL : this.spec.color)   // body warns; resting fill between blinks.
  this.barrel.setFillStyle(warn ? TELEGRAPH_FILL : BARREL_COLOR)     // the barrel co-warns (the "charging" cue).
}
```
Two collision concerns, both pinned:
- **vs the carrier-flash branch:** the boss is a non-carrier (D11), so `this.carrier` is false and the
  carrier `if` is never taken; making the telegraph an `else if` is belt-and-braces (a future carrier-boss
  would prefer the carrier pulse while resting and the telegraph would still drive `firePressed` — fill is
  cosmetic). The two are mutually exclusive on a non-carrier boss.
- **vs the spawn-blink ALPHA branch (lines 166–172):** that branch owns `setAlpha` while `spawnIframe > 0`;
  the telegraph branch is gated on `spawnIframe <= 0` and only ever calls `setFillStyle` (NEVER `setAlpha`),
  so even in the worst overlap the two write DIFFERENT visual channels. The overlap CAN happen: `_spawnBoss`
  arms `spawnIframe = SPAWN_BLINK_TIME`, and a telegraph cannot be ARMED until the first fire-cooldown elapses
  — but to be safe the telegraph render is gated on `spawnIframe <= 0` so during the spawn-blink window the
  boss shows ONLY the spawn-blink alpha pulse (no fill warn), and the warn fill begins only after the blink
  ends. (The telegraph LOGIC in `updateAI` — §5.3 above — should likewise not arm while `spawnIframe > 0`; the
  AI tick is skipped during the blink in `_tickEnemies` (line 693–696, the spawn-blink `IDLE_INTENT` branch),
  so the timer can't arm during the blink anyway — the render gate just mirrors that for safety.)

`TELEGRAPH_FILL` is a new constant in `config/constants.ts` (a warning colour distinct from every tank's
`color`/`colorFlash`); `BARREL_COLOR` is the existing module-local barrel fill in `Tank.ts` (`0xdfe6e9`,
line 50) the boss resets to between warn frames. No new visual SYSTEM — one extra branch reusing the
`setFillStyle`-off-the-clock shape.

### 5.4 The boss spawn + banner + audio (`scenes/GameScene.ts`)

- **`create()`:** construct `this.sound = new Sound(this)` (the one audio owner). Bind the `M` mute toggle:
  `this.input.keyboard.on('keydown-M', () => { this.sound.mute = !this.sound.mute })`. Add the boss/banner
  state: `private bossSpawned = false`, `private boss: Tank | null = null`, `private bannerTimer = 0`,
  `private bannerStage = 0`. Reset them in `create()`/`_buildStage` (a fresh stage hasn't spawned its boss).
- **`_spawnStep` (unchanged for the roster).** The normal roster streams exactly as F4 — the boss-stage
  `totalEnemies` is the normal count; the boss is EXTRA (the capstone), spawned by `_onEnemyKilled`'s edge.
- **`_spawnBoss()` (NEW, factored — DRY with `_spawnStep`'s construction):** build
  `new Tank(this, point.x, point.y, 'enemy', bossSpecForStage(this.runState.stageIndex))` at a top spawn,
  `_collideTankWithTerrain` + `_registerTankOverlap` + `onDeath = () => this._onEnemyKilled(boss)` (the
  SAME funnel), `enemy.carrier = false` (D11), `enemy.spawnIframe = SPAWN_BLINK_TIME` (the spawn blink),
  push to `enemies`. **NOTE (issue #2 consistency):** unlike `_spawnStep` (line 658, which multiplies the
  normal enemy's `bulletSpeed` by `bulletSpeedScale(stageIndex)`), `_spawnBoss` does NOT apply
  `bulletSpeedScale` — the boss's `bulletSpeed` is the RAW spec value from `bossSpecForStage` (which the fold
  leaves UNSCALED), so the boss's heavier-fire profile is exactly the fixed, verifier-asserted
  `BOSS.bulletSpeed ≥ POWER.bulletSpeed` quantity at every depth (a `bulletSpeedScale`-multiplied boss would
  drift unboundedly and make the readable, asserted profile meaningless). THE LEDGER WRITE (pinned, issue #1): set `this.boss = enemy`, `this.bossSpawned = true`,
  then `this.runState.enemiesAlive = 1` and `this.runState.enemiesRemaining = 1` (NOT `enemiesQueued`, which
  stays 0 — the boss is EXTRA, never a queued-roster member). Writing `enemiesAlive = 1` (rather than a `+= 1`)
  is safe because `_spawnBoss` is only ever reached from the capstone edge where `enemiesAlive` is already 0;
  writing `enemiesRemaining = 1` HERE — at spawn, not deferring to the next `_onEnemyKilled` — is what makes
  the HUD read `ENEMIES 1` while the boss is alive (see the readout note below). Finally `this.sound.bossSpawn()`.
- **`_onEnemyKilled` (CHANGED — the EXACT ordering against the current lines 708–726, issue #1):** the
  current body runs, in this order: (709) the kill burst; (710) `score += spec.scoreValue`; (711)
  `enemiesAlive = max(0, enemiesAlive − 1)`; (712) `enemiesRemaining = enemiesQueued + enemiesAlive`;
  (715–718) the one-shot carrier drop; (722) the clear predicate `enemiesQueued <= 0 && enemiesAlive <= 0
  && !transitioning && !gameOver` → set `transitioning` + defer `_advanceStage`. F6 INSERTS the boss branch
  INSIDE that predicate's `if`-body, BEFORE the `transitioning`/`_advanceStage` lines, so the decrement (a) +
  recompute (b) at 711–712 have ALREADY run when the branch is evaluated:
  ```
  // (a) line 711 already decremented enemiesAlive; (b) line 712 already recomputed enemiesRemaining.
  // (c) the clear predicate (line 722) is reached: enemiesQueued===0 && enemiesAlive===0.
  if (this.runState.enemiesQueued <= 0 && this.runState.enemiesAlive <= 0 && !this.transitioning && !this.gameOver) {
    if (this.runState.isBossStage() && !this.bossSpawned) {
      this._spawnBoss()           // the capstone — spawn the boss INSTEAD of advancing (D4). _spawnBoss
      return                       //   sets enemiesAlive=1 + enemiesRemaining=1; we return WITHOUT touching
    }                              //   `transitioning` (so the stage does NOT advance — the boss is now alive).
    if (this.runState.isBossStage()) {  // (d) the boss's OWN onDeath re-enters here → enemiesAlive 1→0 at 711,
      this.bannerStage = this.runState.stageIndex + 1  //   predicate true again, bossSpawned already true →
      this.bannerTimer = STAGE_CLEARED_BANNER_SEC      //   fall through to the banner + advance (AC3).
      this.sound.stageCleared()
    }
    this.transitioning = true
    this.time.delayedCall(0, () => this._advanceStage())
  }
  ```
  THE PINNED SEQUENCE for the capstone (issue #1): the LAST NORMAL kill → (a) `enemiesAlive` decremented to 0,
  (b) `enemiesRemaining` recomputed to 0, (c) predicate true → boss-stage & `!bossSpawned` → `_spawnBoss()`
  (which sets `enemiesAlive = 1`, `enemiesRemaining = 1`) → `return` BEFORE the `transitioning` guard (no
  advance). Later the BOSS's own `_onEnemyKilled` → (a) `enemiesAlive` 1→0, (b) `enemiesRemaining` 0,
  (c) predicate true → `isBossStage() && bossSpawned` so we SKIP the spawn branch → banner + set `transitioning`
  + defer `_advanceStage`. Because the spawn-branch sits INSIDE the predicate and BEFORE the guard, the boss
  never enters the transitioning guard on its spawn frame, and the advance fires exactly once on its death.
- **THE `ENEMIES` HUD READOUT during the boss fight (issue #1 — pinned):** the HUD's `ENEMIES` line reads
  `r.get('hud.enemies')`, which `_publishHud` publishes from `this.runState.enemiesRemaining` (line 472).
  Because `_spawnBoss` sets `enemiesRemaining = 1` at spawn (above), the player sees **`ENEMIES 1` while the
  boss is alive** and `ENEMIES 0` only after the boss dies (the same frame the banner shows + the advance
  defers). Without the explicit `enemiesRemaining = 1` write in `_spawnBoss`, the readout would be wrong:
  `enemiesQueued` is 0 and the last normal kill's line-712 recompute already left `enemiesRemaining = 0`, so
  the player would see `ENEMIES 0` standing next to a live boss. The `_spawnBoss` write is therefore REQUIRED,
  not cosmetic. The verifier doesn't touch this (it's scene-coupled); the manual drive proves it (AC1/AC3).
- **`Tank.tryFire` gains a `boolean` return — a SIGNATURE CHANGE, flagged (issue #6).** Today `tryFire(pool):
  void` (the current lines 308–317): it early-returns on cooldown/cap, and on a successful `pool.acquire`
  arms the cooldown + bumps `liveBullets`. F6 changes the signature to `tryFire(pool): boolean` — it returns
  `false` on the early-return / failed acquire and `true` on the successful shot (the existing internal `got`
  boolean is simply RETURNED; the cooldown-arm logic is unchanged). **This is purely ADDITIVE for existing
  callers:** a caller that IGNORES the return is byte-unchanged in behaviour (JS/TS discards an unused return),
  so the change does not break any of the FOUR existing call sites — it only ENABLES the new audio consumer.
  The four existing call sites + the comment that change:
  - **`GameScene` line 828** (`this.p1.tryFire(this.bullets)`) — wrap with the new consumer: `if (this.p1.tryFire(this.bullets)) this.sound.fire()`.
  - **`GameScene` line 834** (`this.p2.tryFire(this.bullets)`) — same: `if (this.p2.tryFire(this.bullets)) this.sound.fire()`.
  - **`GameScene` line 699** (`enemy.tryFire(this.bullets)`, inside `_tickEnemies`) — the ENEMY fire site. See
    the enemy-fire decision below; this site becomes `if (enemy.tryFire(this.bullets)) this.sound.fire()`.
  - **The F1 AC4 comment block on `Tank.tryFire` (lines 304–317)** — update the JSDoc to document the
    `boolean` return ("returns whether a shot was fired this call, so the SCENE — the one audio owner, D6 —
    can play `sound.fire()` on success; a `false` return means cooldown/cap blocked the shot"). The return is
    the ONLY new consumer of `tryFire`; no other code reads it.
  The `boolean` return is the ONLY signature change in F6; it touches exactly these four sites + the JSDoc.
- **Audio wiring (D6) — at the EXISTING resolution sites:** `sound.fire()` after a successful `tryFire` at ALL
  THREE fire sites (P1 line 828, P2 line 834, AND the enemy site line 699 — **enemy fire audio is IN scope**,
  routed through the scene exactly like the players' so AC6's "fire() on a shot" is unambiguous: EVERY tank's
  shot — player OR enemy — plays `fire()`, since all three sites already live in GameScene and all three now
  read `tryFire`'s boolean; the throttle in `Sound._gateOk` collapses a same-frame multi-shot pile-up into one
  transient so a busy frame doesn't machine-gun the blip). `sound.brickHit()` / `sound.steelClink()` in
  `_onBulletHitSolid`'s BRICK / STEEL branches; `sound.explosion({big})` on a tank/base kill, `sound.explosion()`
  on a brick/bullet-vs-bullet spark; `sound.powerUp()` in `_applyPowerUp` (all kinds) + `sound.oneUp()`
  additionally for the `tank` kind; `sound.gameOver()` under the `_triggerGameOver` guard. All null-safe (the
  façade no-ops under NoAudio).
- **`_publishHud` (CHANGED):** publish `hud.banner` (the localised `t('hud.stageCleared',{n:bannerStage})`
  while `bannerTimer > 0`, else `''`) + `hud.muted` (`this.sound.mute`). `bannerTimer` decays on the REAL
  `dt` in `update()` (like the FX — so it shows through the run-end freeze beat).
- **Co-op finalization (AC5) — mostly CONFIRMATION:** the present-player spawn/lives/shared-base/shared-
  score/FF-off/`_checkRunOver` seams already hold (F3/F4/F5). F6's deltas are: (a) the boss routes through
  the present-player funnels (a co-op grenade kills the boss via the SAME deferred `onHit(maxHp)`; the boss
  can kill either player or the base via the SAME bullet×tank/bullet×base overlaps); (b) the doc + the §7
  grep + the manual co-op drive-test PROVE the end-to-end flow (two players, shared base, run ends on
  base-loss or all-lives-spent). No new co-op CODE is needed — F6 declares it FINISHED + verifies it.
- **Clock-freeze × telegraph × the capstone spawn (issue #5 — pinned, NO new code needed but the behaviour is
  SPECIFIED):** `update()` skips BOTH `_spawnStep` and `_tickEnemies` while frozen (the current lines 844–848:
  `const frozen = freezeTimer > 0; if (!transitioning && !frozen) { _spawnStep; _tickEnemies }`). Two
  consequences, both correct-by-construction, both pinned:
  - **(a) A telegraph armed before a freeze STALLS mid-wind-up.** The telegraph timer decays inside
    `Tank.updateAI`/`update`, which run only via `_tickEnemies`; while frozen `_tickEnemies` is skipped, so a
    boss caught mid-telegraph holds its wind-up (the warning blink uses the scene clock, so it keeps blinking
    cosmetically — see §5.3/issue #4 — but `telegraphTimer` does NOT decay and `firePressed` stays false). When
    the freeze ends, the wind-up resumes from where it stalled and the boss fires normally. This is the SAME
    "freeze pauses every gameplay timer" contract every other enemy obeys (a frozen `power` tank likewise
    doesn't advance its cooldown), so no special-casing is needed — it is DESIRABLE (the clock power-up should
    pause a boss's shot, not let it fire through the freeze). Stated explicitly so it is not mistaken for a bug.
  - **(b) A grenade that clears the LAST NORMAL enemy on a boss stage SPAWNS the boss — it does NOT advance.**
    The grenade's deferred loop (the current lines 431–435) iterates `this.enemies` calling `enemy.onHit(maxHp)`;
    each lethal hit funnels through `onDeath → _onEnemyKilled` exactly like a bullet kill. So the grenade
    routes through the SAME capstone branch added to `_onEnemyKilled` above: when its loop kills the last
    NORMAL enemy on a boss stage with `!bossSpawned`, that kill hits the clear predicate, enters the
    `_spawnBoss()` branch, and `return`s — the boss SPAWNS, the stage does NOT advance. AC4's "a co-op grenade
    kills the boss" therefore means: on a boss stage, the FIRST grenade (fired while only normal enemies are
    alive) clears the roster and SPAWNS the boss; a LATER grenade (fired while the boss is the one alive enemy)
    kills the boss — `enemy.onHit(boss.maxHp)` is lethal in one (the `>= maxHp` damage bypasses the boss's
    multi-hit HP, exactly as it one-shots an armor tank), and THAT kill routes to the banner + advance branch.
    Edge note: the grenade loop snapshots `this.enemies` at defer time (the comment at line 429), and
    `_spawnBoss` pushes the boss INSIDE `_onEnemyKilled` (called from within the loop body's `onHit`), so the
    boss is appended to `this.enemies` AFTER the snapshot's iteration cursor — the same `delayedCall(0)` loop
    will NOT also hit the freshly-spawned boss (it iterates the array it captured; `for…of` over the array,
    not a re-read each step — but to be safe the spec pins that a grenade-spawned boss is NEVER killed by the
    SAME grenade's loop, so the boss always gets a spawn-blink before it can be hit). No new code: the existing
    grenade loop + the `_onEnemyKilled` capstone branch compose correctly; this bullet just PINS the edge so
    AC4 is unambiguous (a grenade that empties the normal roster spawns the boss, it does not skip it).

### 5.5 The audio façade (`audio/Sound.ts`)

The reference's `Sound` ported verbatim in shape (D7): `constructor(scene)` grabs
`scene.sound.context ?? null` (NoAudio → null → every method no-ops), builds a `master` GainNode →
destination; `mute` get/set proxies `scene.sound.mute`; `_gateOk(key, minGap)` returns false on
no-ctx/muted/throttled (stamping the ctx clock); `_tone(o)` + `_noise(o)` are the synthesis primitives
(byte-faithful to the reference). The semantic methods (each `_gateOk`-guarded, composing distinct
timbres):

| method | timbre intent | classic event |
|---|---|---|
| `fire()` | a short bright "pew" (a quick downward square sweep) | a tank shot |
| `brickHit()` | a dry low crunch (filtered noise thud) | a bullet chips brick |
| `steelClink()` | a bright metallic "tink" (a high noise blip + a high tone) | a bullet off steel |
| `explosion(opts?)` | a noise thud (louder/longer for `{big}`) | a tank/base/kill burst |
| `powerUp()` | an ascending blip (the "gained" sweep) | walking over a power-up |
| `oneUp()` | a three-note rising chime | the `tank` (+1 life) pickup |
| `bossSpawn()` | a low ominous swell | the capstone boss appears |
| `stageCleared()` | a short ascending win flourish | the STAGE-N-CLEARED banner |
| `gameOver()` | a low descending knell | the run ends |

The per-key throttle collapses a multi-hit frame (e.g. several bricks chipped at once) into one transient
(the reference's pile-up guard). NoAudio → silent; mute → silent. No assets, no `load.*` — synthesized at
runtime (AC6).

---

## 6. Files

**New:**

- `src/audio/Sound.ts` — the WebAudio façade (D7; Phaser/WebAudio-coupled; NEVER verifier-imported).

**Changed:**

- `src/config/tanks.ts` — `'boss'` behaviour + `BOSS` spec + `telegraphSec?` + `bossSpecForStage()`; the
  boss is NOT added to `ENEMY_ARCHETYPES`/`ENEMY_SPECS` (D1/D2/D3; PURE; verifier-imported).
- `src/config/constants.ts` — `BOSS_TANK_HP`/`BOSS_TELEGRAPH_SEC`/`BOSS_HP_PER_BOSS_STAGE`/`BOSS_HP_MAX`/
  `STAGE_CLEARED_BANNER_SEC`/`TELEGRAPH_FILL` (the warn colour, issue #4) + the retuned balance numbers
  (D3/D5/D10; PURE). The retuned balance constants `CURRENCY_RATIO`/`FIRE_COOLDOWN`/`TANK_SPEED`/
  `BULLET_SPEED`/`SPAWN_STAGGER_BASE` — see §7 AC8 for which are gate-covered vs out-of-gate (issue #3).
- `src/config/stages.ts` — balance-only retune of the existing ramp constants, within the clamps (D10/AC8;
  PURE).
- `src/entities/Tank.ts` — the gated telegraph LOGIC branch in `updateAI` + the DISTINCT telegraph RENDER
  branch in `update()` keyed on `this.telegraphing` (issue #4, NOT the carrier-flash hook) + `telegraphSec`/
  `telegraphTimer`/`telegraphing` fields + the `boolean` `tryFire` return (a SIGNATURE change, additive —
  issue #6) + the F1 `tryFire` JSDoc note (D2/D6; coupled).
- `src/scenes/GameScene.ts` — `_spawnBoss` capstone + the STAGE-N-CLEARED banner + the `Sound` façade + the
  `M` mute + the co-op finalization (D4/D5/D6/D8/AC1/AC3/AC4/AC5/AC6; coupled).
- `src/scenes/HUDScene.ts` — the registry-read timed banner line + an optional MUTED cue (D5/D8; coupled).
- `src/scenes/TitleScene.ts` — the both-players controls reference (D9/AC7; coupled).
- `src/i18n/index.ts` — `CONTROLS_ROWS` export (D9; PURE).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — `controls.*` + `hud.stageCleared` + `hud.muted` chrome, both
  locales (D9/AC7; PURE).
- `scripts/verify-gen.mjs` — the boss-spec well-formedness (incl. the heavier-fire data check
  `BOSS.bulletSpeed ≥ POWER.bulletSpeed` + `BOSS.fireCooldown ≤ BASIC.fireCooldown`, issue #2) +
  `bossSpecForStage` monotone/never-weaker/fire-fields-unscaled + boss-absent-from-roster section + the two
  balance guards `0 < CURRENCY_RATIO < 1` and `FIRE_COOLDOWN > 0` (issue #3 — ADD the `CURRENCY_RATIO`/
  `FIRE_COOLDOWN` imports from `constants.js`); F0–F5 byte-unchanged (AC9/AC10).

**Unchanged (relied upon):** `core/RunState.ts` (`isBossStage()` already exists), `core/Input.ts` (already
returns both players), `scenes/HubScene.ts`/`GameOverScene.ts` (F5 — co-op two-column + the summary already
wired; `gameOver()` sound is called from GameScene), `world/*`, `effects/*`, `combat/*`, `entities/Base.ts`/
`PowerUp.ts`, `main.ts`.

---

## 7. Verification

> Each AC maps to a `typecheck`/`build` pass, a headless `verify` assertion, a code-presence grep, or a
> manual `npm run dev` drive-test. The boss SPEC + the `bossSpecForStage` fold + the balance numbers are
> PURE → REAL headless proofs; the boss SPAWN, the banner, the audio, the controls, and the co-op flow are
> Phaser-coupled → grep + manual drive.

- **AC1 (boss on every 5th stage, as capstone):** grep `GameScene.ts` for `isBossStage()` + `_spawnBoss` +
  `bossSpecForStage`; manual drive — clear stages to stage 5 (index 4), confirm the normal roster clears
  first, then ONE distinct heavy boss spawns; a non-boss stage spawns no boss.
- **AC2 (heavy + telegraphed):** `verify` asserts `BOSS.maxHp ≥ ARMOR.maxHp` + `BOSS.telegraphSec > 0` + the
  CONCRETE heavier-fire profile `BOSS.bulletSpeed ≥ POWER.bulletSpeed` AND `BOSS.fireCooldown ≤
  BASIC.fireCooldown` (issue #2 — a falsifiable data check, not a manual claim); grep `Tank.ts` for the
  `telegraphSec`/`telegraphTimer` LOGIC branch + the `this.telegraphing` RENDER branch; manual drive — the
  boss survives many hits + visibly winds up (the fill-warn blink) before firing.
- **AC3 (STAGE N CLEARED banner, no scene):** grep `GameScene.ts` for `bannerTimer`/`hud.banner` +
  `STAGE_CLEARED_BANNER_SEC`, grep `HUDScene.ts` for the banner line + `t('hud.stageCleared')`; confirm NO
  new scene file / no `scene.start`/`scene.launch` for a banner; manual drive — the banner shows centered +
  expires.
- **AC4 (boss routes through the SAME funnels):** grep that `_spawnBoss` uses `_registerTankOverlap` +
  `onDeath = _onEnemyKilled` + `carrier = false`; manual drive — a normal bullet AND a co-op grenade both
  kill the boss; its score banks; the stage advances after the banner.
- **AC5 (co-op end-to-end):** grep `constants.ts` `FRIENDLY_FIRE === false` + `TWO_PLAYER`; grep
  `_checkRunOver` (present-slots tally) + `_bulletCanHitTank` (FF filter); manual co-op drive — both
  players spawn/fire, FF off (a P1 bullet passes P2), shared score/base/currency, independent lives; the
  run ends on base-loss OR all shared lives spent; a solo session hides P2 + ends on P1's last life.
- **AC6 (synth SFX + mute):** grep `audio/Sound.ts` for `createOscillator`/`createBuffer` + no `load.`/no
  asset import; grep `GameScene.ts` for `new Sound(this)` + `sound.fire()`/`brickHit()`/`steelClink()`/
  `explosion`/`powerUp`/`oneUp`/`bossSpawn`/`stageCleared`/`gameOver` + the `keydown-M` mute; manual drive
  — sounds fire on the events, `M` toggles silence; headless `verify`/`build` never touch WebAudio (the
  façade is never verifier-imported).
- **AC7 (Title shows both schemes):** grep `i18n/index.ts` for `CONTROLS_ROWS`, grep `TitleScene.ts` for
  the rows render + `t('controls.…')`; manual drive — the Title lists P1 (WASD·J), P2 (arrows·Numpad0), and
  the shared keys (SPACE/ENTER·M), in Chinese chrome (zh).
- **AC8 (balance in config) — HONEST coverage table (issue #3).** The retune touches three files; state
  explicitly which constants an EXISTING (or NEW) verifier block reads, and which are out-of-gate:
  - **`stages.ts` ramp constants** (base densities/ramps, count ramps, the spawn-cadence ramp) — COVERED by
    the EXISTING stage-monotonicity + cap sweep (§ "5) stages", lines ~190–210): every `base + k·s` is asserted
    within its `*_DENSITY_MAX`/`TOTAL_ENEMIES_MAX`/`BULLET_SPEED_SCALE_MAX` clamp and each ramp monotone. A
    retune that overshoots a clamp or flips a ramp sign FAILS the sweep. GATE-COVERED.
  - **`tanks.ts` per-archetype feel numbers** — COVERED by the EXISTING four-types-distinct (7c) + star-fold
    monotone (7e) checks: a retune that makes two archetypes identical on `{moveSpeed,bulletSpeed,maxHp}` or
    breaks the star fold's non-decreasing offence FAILS. The boss spec adds the NEW heavier-fire check (issue
    #2). GATE-COVERED.
  - **`constants.ts` SCALAR balance edits** — these are NOT read by ANY existing sweep (the verifier imports
    `ARMOR_TANK_HP`, `SPAWN_INTERVAL_MIN_SCALE`, the grid/`BOSS_STAGE_EVERY`/`ENEMIES_PER_STAGE`/
    `MAX_CONCURRENT_ENEMIES` constants — but NOT `CURRENCY_RATIO`/`FIRE_COOLDOWN`/`TANK_SPEED`/`BULLET_SPEED`/
    `SPAWN_STAGGER_BASE`). So "green by construction" was DISHONEST for these. F6 makes it honest:
    - `CURRENCY_RATIO` — the run-end banking fraction MUST stay in `(0,1)` (a `≥1` banks the whole/over score;
      a `≤0` banks nothing — both break the meta economy). **NEW guard assertion** added to the verifier:
      `0 < CURRENCY_RATIO < 1` (import it from `constants.js`). GATE-COVERED after F6.
    - `FIRE_COOLDOWN` — the player base spec's `fireCooldown` (the well-formedness check 7a asserts every spec
      has a numeric `> 0` `fireCooldown`; `PLAYER_BASE.fireCooldown = FIRE_COOLDOWN`, so 7a ALREADY proves
      `FIRE_COOLDOWN > 0` TRANSITIVELY via the player spec). F6 ALSO adds an explicit `FIRE_COOLDOWN > 0`
      guard for directness (belt-and-braces — the player-spec well-formedness depends on it). GATE-COVERED.
    - `TANK_SPEED` / `BULLET_SPEED` / `SPAWN_STAGGER_BASE` — these feed the archetype specs + the spawn cadence
      and are TRANSITIVELY covered (the archetype distinctness/positivity checks read the derived spec numbers;
      the spawn-cadence ramp's clamp covers `SPAWN_STAGGER_BASE × SPAWN_INTERVAL_MIN_SCALE` as the floor). No
      DEDICATED scalar assertion is added for these (they have no standalone invariant beyond "positive", which
      the spec well-formedness already enforces transitively). Documented **OUT-OF-GATE as standalone scalars**
      (covered only via their derived specs) so the claim is honest — a retune that keeps the derived specs
      well-formed + distinct passes; one that zeroes a speed FAILS via the spec positivity check (7a).
  - grep confirms the retune is data-only (no logic change). Net: every balance constant is either
    GATE-COVERED (the sweeps + the two NEW guards) or explicitly documented OUT-OF-GATE — no silent gap.
- **AC9 (boss spec proven):** `verify`'s NEW section asserts `BOSS` well-formed (`behavior==='boss'`,
  positive feel fields, integer `maxBullets`, `scoreValue ≥ 0`), `maxHp ≥ ARMOR_TANK_HP`, `telegraphSec > 0`,
  AND the heavier-fire data check `BOSS.bulletSpeed ≥ POWER.bulletSpeed` + `BOSS.fireCooldown ≤
  BASIC.fireCooldown` (issue #2); `bossSpecForStage(s)` deterministic + a NEW object + `maxHp` MONOTONE
  non-decreasing across boss stages + ≥ `BOSS.maxHp` at the base + `telegraphSec`/`bulletSpeed`/`fireCooldown`
  UNSCALED (equal to `BOSS`'s — readability + heavier-fire preserved at depth); and the boss is ABSENT from
  `ENEMY_ARCHETYPES`/`ENEMY_SPECS` so `rosterPick` still only returns the four normal ids. PLUS the two NEW
  balance guards (issue #3): `0 < CURRENCY_RATIO < 1` and `FIRE_COOLDOWN > 0`.
- **AC10 (split + green + offline):** `npm run typecheck` + `npm run build` exit 0; `npm run verify` prints
  OK + exits 0 (the NEW boss section + the byte-unchanged F0–F5 sweep); confirm `config/tanks.ts`/
  `constants.ts`/`stages.ts` import no Phaser (the verifier node-imports them — a stray import throws);
  confirm `audio/Sound.ts`/`Tank.ts`/the scenes are NEVER imported by the verifier; load `file://` offline
  — synthesized audio + programmer-art only.

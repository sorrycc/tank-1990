# Tank 1990 — F4 Enemy tanks + the stage loop (the AI, the roster, staggered spawns, stage clear)

> Design doc for **F4 Enemy tanks**, the enemy-AI + stage-progression feature of Tank 1990 (a faithful
> Battle City / 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design docs EXACTLY:
> Background → Requirements Summary → Acceptance Criteria → Decision Log → Design → Files →
> Verification. F0 stood up the booting skeleton (six scenes, pure RNG, defensive save, shared
> constants, a green `typecheck`/`build`/`verify` STUB). F1 made a drivable tank that fires pooled
> bullets. F2 replaced the test arena with a PURE, SEEDED, headlessly-VERIFIED 13×13 stage (terrain +
> an enclosed reachable eagle + spawn points + a `TileMap` renderer/bodier with a `destroyBrickSubCell`
> erosion seam). F3 made the bullets MATTER (every collision pair resolved, the eagle-loss run-over,
> pooled FX, player respawn-with-i-frames, co-op friendly-fire off) and DELIBERATELY left the
> bullet×tank + tank-death seams GENERIC over `side` so this feature plugs `side:'enemy'` tanks into
> them with NO refactor. F4 fills the actual game in: the ONE Tank FSM gains enemy behaviours (a
> behaviour TAG, not subclasses), a `config/tanks.ts` roster of the four classic enemy types + the
> player tank base spec + star tiers, staggered/capped spawns from the top spawn points, and the
> STAGE-CLEAR loop that advances to the next procedural stage in place when every enemy is dead. The
> boss tank, the 6 power-ups, the score/lives HUD readouts, and the Hub upgrade trees stay OUT of scope
> (each lands in its own later feature — YAGNI); F4 wires the SEAMS they plug into.

---

## 1. Background

In Battle City the stage IS the game loop: ~20 enemy tanks stream in from three spawn points at the top
of the 13×13 field, capped at 4 on-screen at once; each enemy wanders the grid, periodically pushes
toward the eagle base or the nearest player, and fires on an attack beat; you clear the stage by
destroying every enemy, then the next (harder) stage builds in place. Four classic enemy types differ
meaningfully — basic, fast, power (fast bullet), armor (multi-hit, four flashes to kill). Some enemies
flash red: killing one drops a power-up (the pickup itself is F5; F4 just FLAGS the carrier + marks the
drop point on death).

F3 left the world combat-complete but EMPTY of opponents: bullets resolve against terrain/tanks/the
eagle, the eagle-loss ends the run, players respawn — but nothing spawns to shoot at, and clearing a
stage is impossible (there is nothing to clear). The whole scene is a fixed dev seed/stage that never
advances.

F4 resolves that, mirroring the reference's enemy/stage conventions EXACTLY, adapted from a
side-scrolling platformer to a top-down grid bullet duel:

- **The ONE FSM, a behaviour TAG, not subclasses.** The reference keeps a SINGLE `Enemy` state machine
  (`idle/patrol/chase/attack/hurt/dead`) and gets variety from a `spec.behavior` tag + a handful of
  guarded branches in the existing ticks — NOT four subclasses (which would duplicate the
  patrol/chase/hurt/dead scaffolding, a DRY violation — its Decision 68). F4 mirrors this: the ONE
  Tank entity (already carrying a `behavior` tag — F1 D7) gains an enemy-AI tick driven by ONE switch
  over a small grid-AI FSM; the four enemy types are a `behavior` + a spec, never a subclass.
- **PURE config + a headless verifier as the quality gate.** The reference's `config/enemies.ts` is a
  100%-PURE archetype table the verifier node-imports to assert every spec is well-formed (its AC59);
  its `config/difficulty.ts` is a PURE monotone depth curve the verifier proves non-decreasing (its
  AC42). F4's `config/tanks.ts` is the same: a PURE roster (NO Phaser) the verifier sweeps for
  well-formedness + roster-id validity, and the EXISTING `config/stages.ts` difficulty envelope (already
  swept for monotonicity by F2's verifier §5) is EXTENDED with the enemy-derived monotone quantities so
  the verifier's monotonicity check covers the F4 difficulty ramp too.
- **Staggered, capped spawns + an in-place stage rebuild under a one-shot guard.** The reference spawns
  enemies from generated spawn points up to a concurrency cap, tracks `enemiesRemaining/queued/alive`,
  and rebuilds the level IN PLACE on clear via a deferred teardown + a `transitioning` one-shot guard
  carrying HP/score across (its `_nextLevel`/`_continueTransition`/`_teardownLevel`/`_buildLevel`). F4
  mirrors that discipline 1:1 for the stage→stage advance (F3 already reserved the `transitioning` flag
  for exactly this).

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split
(`config/tanks.ts` + the `config/stages.ts` extension are PURE — NO Phaser — and node-imported by the
verifier; the Tank-AI code, `GameScene`, and the new `core/RunState.ts` reads are Phaser-coupled where
they touch the scene and PURE where they hold run-scoped numbers); the ONE FSM + behaviour-tag variety;
the deterministic seed chain owned by `RunState.advance()`; deferred-destructive-teardown via the
`transitioning` one-shot guard; `dt = Math.min(delta/1000, MAX_DT)` in SECONDS at the boundary; object
pooling reused (the F1 `BulletPool` is the enemy bullets' pool too — `side:'enemy'`); heavy
intent-revealing comments citing the section + AC + Decision numbers. Governing conventions:
**KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Spawn enemy tanks staggered + capped on-screen from the top spawn points; give them a grid AI
(wander, seek the eagle/nearest player, fire on a beat, turn at obstacles) on the ONE Tank FSM via a
behaviour tag; ship the four classic enemy types (basic/fast/power/armor) + the player base spec + star
tiers in a PURE `config/tanks.ts`; carry run-scoped state (stage index, per-player lives+tier, shared
score, enemies remaining/queued/alive, placeholder power-up timers) in a PURE-leaning `core/RunState.ts`;
advance to the next procedural stage IN PLACE when every enemy is dead (carrying lives/score under a
one-shot guard); scale difficulty monotonically; flag red-flashing power-up carriers (drop point marked
on death, pickup wired in F5); all green on `typecheck`/`build`/`verify`.

**In scope (F4):**

- **`src/config/tanks.ts` (PURE, NEW):** the roster table (NO Phaser — node-imported by the verifier).
  - `TankSpec` shape: `id`, `behavior` ('basic'|'fast'|'power'|'armor'|'player'), `maxHp`,
    `moveSpeed` (px/s), `bulletSpeed` (px/s), `fireCooldown` (s), `maxBullets`, `color`/`colorFlash`
    (programmer-art fills, consumed ONLY by the coupled Tank — the verifier ignores them, mirroring how
    `tiles.ts` colours are render-only), `scoreValue` (points the killer banks — read in F4, displayed
    in the HUD feature).
  - The four classic enemy specs: `BASIC` (medium move, 1 HP, normal bullet), `FAST` (quick move, 1 HP,
    normal bullet), `POWER` (medium move, 1 HP, FAST bullet — a higher `bulletSpeed`), `ARMOR`
    (medium move, `ARMOR_TANK_HP`=4 HP multi-hit — the four-flash tank; reuses F3's HP funnel "for
    free"). **`ARMOR_TANK_HP` is CHANGED from 3 → 4** (it is currently 3 in `constants.ts` line 108 —
    see §6 Files): the classic armor tank flashes four times (white→grey→…) and dies on the FOURTH hit,
    so the constant must be 4 for AC4's "survives 4 hits" to be literally true, not silently off by one.
    The differences are MEANINGFUL: move speed, bullet speed, and HP each vary across the four.
  - The PLAYER base spec (`PLAYER_BASE`) + STAR TIERS: a small ordered `PLAYER_STAR_TIERS` array of
    additive stat deltas (`+bulletSpeed`, `+maxBullets`, `+fireRate`, and the max-star
    `canBreakSteel` flag) folded over the base by `applyStarTier(tier)` → a `TankSpec`. F4 ships the
    tiers as DATA + the pure fold; the star POWER-UP that raises a player's tier is F5, the Hub
    permanent-upgrade fold is the Hub feature — F4 only provides the data + the pure `applyStarTier`
    the later features call (YAGNI on the UI/economy here).
  - `ENEMY_SPECS` (id → spec) lookup + `ENEMY_ARCHETYPES` ordered list (the verifier sweep source),
    mirroring the reference's `ENEMY_SPECS`/`ENEMY_ARCHETYPES`.
  - `rosterPick(rng, weights)` — a PURE weighted pick over the four enemy ids given a stage's
    `enemyWeights` (from `config/stages.ts`), used by the scene's spawn loop AND assertable headlessly.
- **`src/config/stages.ts` (CHANGED, PURE):** EXTEND the existing difficulty envelope with the
  enemy-derived monotone quantities the verifier proves non-decreasing — specifically EXPOSE the
  already-present `hardShare` (F2) as the per-stage "enemy hardness" the F4 verifier check reads, and
  add a small monotone `bulletSpeedScale(stageIndex)`/`spawnIntervalScale(stageIndex)` pure ramp (the
  enemy fire/spawn pressure that rises with the stage). NO change to terrain/count ramps (already
  monotone + swept). KISS: a couple of clamped linear ramps beside the existing ones.
- **`src/core/RunState.ts` (NEW, PURE-leaning — NO Phaser):** the active-run value, a factory (not a
  class) mirroring the reference's `createRunState`. Owns: `seed` (chained deterministically by
  `advance()`), `stageIndex` (the run-global stage, never resets — the difficulty curve climbs across
  the whole run), per-player `lives` + `tier` maps, shared `score`, the per-stage spawn ledger
  (`enemiesRemaining`/`enemiesQueued`/`enemiesAlive` — the clear predicate reads these), and PLACEHOLDER
  power-up timers (`freezeTimer`/`shovelTimer` seeded 0 = inactive, the neutral identity, consumed in
  F5). `advance()` chains the next seed + increments `stageIndex` (the same deterministic Knuth advance
  the reference uses) and reseeds the per-stage spawn ledger from `stageConfig(stageIndex)`. PURE +
  node-constructible so the verifier drives the SAME `advance()` chain the game does (determinism +
  monotone stage progression — the reference's RunState verifier walk).
- **`src/entities/Tank.ts` (CHANGED):** the ONE FSM gains an enemy-AI tick (a behaviour TAG, NOT
  subclasses — D2). `update(dt, intent)` already drives a `PlayerIntent`; F4 adds `updateAI(dt, ctx)`
  that PRODUCES a `PlayerIntent`-shaped grid-AI snapshot (wander/seek/turn-at-obstacle + a fire beat)
  and feeds it through the SAME movement spine — so the enemy reuses the F1 4-dir grid movement +
  turn-snap VERBATIM (DRY; no second movement code path). The enemy holds a tiny FSM
  (`wander`/`seek`) + timers (a re-decide timer, a fire-beat timer) + a `carrier` flag (the red-flash
  power-up carrier) + an `onDropFlag` hook (fired ONCE at death with the death center — F5 wires the
  pickup; F4 leaves it a no-op-able callback). The death/respawn/HP funnel (F3) is reused unchanged.
- **`src/scenes/GameScene.ts` (CHANGED):** construct ONE `RunState` in `create()` (the single writer);
  spawn enemies STAGGERED from the three top spawn points up to `concurrentEnemies` on-screen,
  `totalEnemies` per stage, with a spawn-BLINK before active (a brief invuln/telegraph reusing the F3
  `spawnIframe`); track the spawn ledger on the `RunState`; tick every live enemy's `updateAI` on the
  GAMEPLAY dt; register the enemy tanks into the EXISTING bullet×tank overlap + bullet×bullet scan
  (generic over `side` — F3's seam) so player bullets kill enemies + enemy bullets kill players/the
  eagle; on the LAST enemy's death advance the stage (deferred teardown + the F3 `transitioning`
  one-shot guard, carrying lives/score/tier) and rebuild in place. Banking score on a kill +
  flagging/marking the red carrier's drop point are wired here.
- **`src/config/constants.ts` (CHANGED, PURE):** ADD the spawn-loop + AI numbers (`SPAWN_BLINK_TIME`,
  `SPAWN_STAGGER_BASE` s between spawns, `AI_REDECIDE_MIN`/`AI_REDECIDE_MAX` s, `AI_SEEK_BIAS` 0..1,
  `CARRIER_RATE` 0..1) AND change `ARMOR_TANK_HP` 3 → 4 (F3 reserved it at 3; the classic armor tank is
  the FOUR-flash multi-hit tank, so AC4's "survives 4 hits" needs 4 — one-line value change, see §6).
  All PURE data (no Phaser).
- **`scripts/verify-gen.mjs` (CHANGED):** ADD a section that node-imports `config/tanks.ts` +
  `core/RunState.ts` and asserts: every `TankSpec` is well-formed (positive numbers, a known
  `behavior`, the armor spec has `maxHp > 1`, the four enemy types DIFFER on at least one stat);
  `rosterPick` only ever returns a known enemy id + is deterministic for a fixed rng; `applyStarTier`
  is monotone-non-decreasing in bullet speed/maxBullets across tiers; `RunState.advance()` is
  deterministic (same start seed → same seed/stageIndex chain) and `stageIndex` is strictly increasing;
  and the EXISTING §5 monotonicity sweep gains the F4 `bulletSpeedScale`/`spawnIntervalScale` ramps
  (bullet speed non-decreasing; spawn interval non-INCREASING — i.e. enemies arrive no slower) +
  `hardShare` already covered. EXTEND, do NOT rewrite, the verifier (its F0–F2 sections stay green).

**Out of scope (F4 — later features):** the BOSS tank (every 5th stage — F4 emits `isBoss` from
`stageConfig` already, and the boss is a 5th `config/tanks.ts` spec + a behaviour tag reusing this same
entity/FSM — but F4 spawns the normal roster only; the boss + the "STAGE N CLEARED" banner land in the
boss feature); the 6 POWER-UPS (F4 FLAGS the red carrier + fires an `onDropFlag` death hook with the
drop center — F5 spawns the pickup + wires helmet/clock/shovel/star/grenade/tank; the placeholder
`freezeTimer`/`shovelTimer` on RunState are the seam the clock/shovel read); the live HUD readouts
(lives/score/next-enemy queue — the HUD feature reads RunState; F4 only KEEPS the score/lives on
RunState); the Hub META currency banking + the two per-player upgrade trees (the Hub feature folds
`applyUpgrades(slot)` over the base spec — F4 provides `PLAYER_BASE` + `applyStarTier` as the fold
target); STEEL becoming destructible by a max-star tank (the `canBreakSteel` flag exists on the
max-star tier as DATA, but no bullet sets/reads it yet — F4's steel branch is F3's identity; the seam
is the bullet's reserved combat context); ICE low-friction feel; i18n strings. F4 ships ONLY the enemy
AI + the roster + staggered/capped spawns + the stage-clear advance + the monotone difficulty
extension.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a
> manual `npm run dev` drive-test. The AI/spawn/rebuild logic is Phaser-coupled (the scene + the Tank's
> AI tick); the roster, the difficulty ramps, and `RunState.advance()` are PURE and gain REAL headless
> assertions in the verifier (the F4 quality gate).

1. **AC1 — enemies spawn STAGGERED from the top spawn points, never exceeding the on-screen cap.** At
   stage start the scene streams enemies from the three generated top enemy spawns (`enemyL/C/R`), one
   at a time on a `SPAWN_STAGGER`-second cadence, NEVER putting more than `stageConfig.concurrentEnemies`
   (≤ `MAX_CONCURRENT_ENEMIES`=4) ALIVE on-screen at once; the rest queue. Exactly
   `stageConfig.totalEnemies` enemies spawn over the stage (`enemiesRemaining` counts down from there to
   0). A spawn is placed at a `tankFits` window-center spawn point (F2 D13) — never inside terrain.
2. **AC2 — a spawn BLINKS before it is active/lethal.** A freshly spawned enemy blinks for
   `SPAWN_BLINK_TIME` seconds (reusing the F3 `spawnIframe` cue): during the blink it is NOT hittable and
   does NOT fire (the classic spawn telegraph), then it becomes a live combatant. This prevents an enemy
   materialising on top of a player bullet or a player tank.
3. **AC3 — the AI moves on the grid, fires on a beat, and SEEKS the eagle/nearest player.** Each live
   enemy drives the SAME 4-directional grid movement spine as a player (no diagonals — the F1 invariant
   holds for enemies too), wanders by periodically re-deciding a cardinal, turns at an obstacle/wall
   (it re-decides when blocked), BIASES its movement toward the eagle base or the nearest player (a
   weighted seek — `AI_SEEK_BIAS`), and fires on a periodic attack beat (its `fireCooldown`). An enemy
   bullet that reaches a player tank or the eagle resolves through the EXISTING F3 overlaps (kills the
   player → life/respawn; destroys the eagle → run over) — proving the enemy is a real combatant.
4. **AC4 — the four enemy types DIFFER meaningfully.** `BASIC`/`FAST`/`POWER`/`ARMOR` differ on at least
   one of {move speed, bullet speed, HP}: FAST moves faster, POWER fires a faster bullet, ARMOR survives
   `ARMOR_TANK_HP` (4) hits (the four-flash multi-hit tank — reusing F3's HP funnel), BASIC is the
   baseline. The verifier asserts the four specs are pairwise distinct on the tunable stats (AC4 is a
   headless data check, not eyeballing).
5. **AC5 — killing ALL enemies advances the stage IN PLACE (state carried).** When the LAST enemy of the
   stage dies (`enemiesRemaining===0 && enemiesAlive===0`), the scene advances `RunState` (next seed +
   `stageIndex+1`), tears down the current tilemap/enemies/bullets, and rebuilds the next (harder)
   procedural stage IN PLACE — carrying each present player's LIVES + TIER and the shared SCORE across —
   under a one-shot `transitioning` guard (a multi-frame final-kill can't double-advance). The players
   are repositioned at the new stage's spawns; the eagle is rebuilt; the run continues seamlessly.
6. **AC6 — difficulty scales MONOTONICALLY with the stage.** Across `stageConfig(0..K)` the enemy
   hardness (`hardShare`), the enemy `bulletSpeedScale`, and the spawn pressure (`spawnIntervalScale`
   non-increasing — enemies arrive no slower) are monotone in the stage index, and `applyStarTier` is
   monotone-non-decreasing in the player's bullet speed/maxBullets across tiers. The verifier RE-derives
   each and asserts it (extending F2's §5 monotonicity sweep — a PROOF, not eyeballing).
7. **AC7 — red-flashing power-up carriers are FLAGGED + their drop point marked on death (pickup is
   F5).** A fraction (`CARRIER_RATE`) of spawned enemies are flagged `carrier` (a red-flash visual cue);
   on a carrier's death its `onDropFlag(x,y)` hook fires ONCE with the death center (the same one-shot
   discipline as F3's `onDeath`). F4 wires the hook to a no-op/marker (a brief FX marker); F5 swaps in
   the pickup spawn. NO power-up is spawned in F4 (YAGNI) — only the flag + the marked drop point.
8. **AC8 — `RunState` is the single deterministic run owner (PURE, node-constructible).** `RunState` is
   a plain factory holding the run-scoped state; `advance()` chains the seed deterministically and
   increments `stageIndex` (run-global, never resets) and reseeds the per-stage spawn ledger. The same
   start seed replays the same seed/stage chain (the verifier drives the SAME `advance()` chain the game
   does). The score/lives/tier are CARRIED across `advance()` (the stage rebuild reads them). It imports
   NOTHING from Phaser (a stray import throws under the verifier's node import — re-proving purity).
9. **AC9 — co-op + single-player both work; the F3 seams are reused, not duplicated.** Enemy tanks plug
   into the EXISTING F3 bullet×tank overlap + bullet×bullet scan generically over `side:'enemy'` (no new
   overlap shape); friendly-fire stays OFF between players AND between enemies (an enemy bullet doesn't
   kill another enemy — same-side filter); both players' bullets kill enemies; a solo run (P2 absent)
   spawns + clears identically. The stage rebuild repositions the PRESENT players only (D11's
   present-players scoping, kept).
10. **AC10 — deferred teardown + one-shot guards (the stage rebuild leaks nothing).** The stage→stage
    rebuild defers its destructive teardown out of any overlap/death callback (the final-kill advance is
    routed through a `time.delayedCall(0)` like F3's brick-chip) and is gated by the one-shot
    `transitioning` flag (F3 reserved it for exactly this). Every per-stage object (enemies, the tilemap,
    in-flight bullets, the eagle) is destroyed on teardown via the existing `TileMap.destroy()` /
    `BulletPool.releaseAll()` / a `forceDespawn`-style enemy teardown so a rebuild leaks no GameObject.
    The run-over `gameOver` guard (F3) still funnels the eagle-loss/all-lives-spent edges to one
    transition.
11. **AC11 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run build`
    exit 0; `npm run verify` prints OK + exits 0 with the NEW F4 assertions (roster well-formedness,
    `rosterPick`/`applyStarTier`/`RunState.advance` determinism + monotonicity) PLUS the unchanged
    F0–F2 sweep. `config/tanks.ts`, the `config/stages.ts` extension, and `core/RunState.ts` import NO
    Phaser (node-imported by the verifier — re-proving purity); the Tank-AI code + `GameScene` import
    Phaser and are NEVER imported by the verifier. Programmer-art primitives only; runs offline /
    `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — `config/tanks.ts` is a 100%-PURE roster table (the reference's `config/enemies.ts` role),
   node-imported by the verifier; the player base + star tiers live here too.** The reference keeps every
   archetype spec in a PURE `config/enemies.ts` so the verifier asserts well-formedness headlessly (its
   Decision 68 — "the canonical specs live in a PURE config, NOT the entity"). F4 mirrors this: the four
   enemy specs, the `PLAYER_BASE` spec, the `PLAYER_STAR_TIERS` deltas + the pure `applyStarTier` fold,
   the `ENEMY_SPECS` lookup, and the pure `rosterPick` weighted-pick ALL live in `config/tanks.ts` with
   NO Phaser import. *Rationale:* one source of truth for tank tuning (DRY); a pure module the verifier
   proves correct (the quality gate) + the coupled Tank/GameScene consume (the pure/coupled split). The
   colours are on the spec but consumed ONLY by the coupled Tank (exactly like `tiles.ts` colours — the
   generator/verifier ignore them). KISS — flat data + two tiny pure functions, no classes.
2. **D2 — Enemy variety is a `behavior` TAG on the ONE Tank entity + a small grid-AI FSM, NOT four
   subclasses.** The reference keeps a SINGLE `Enemy` FSM and branches on `spec.behavior` in a few
   guarded spots (its Decision 68 — four subclasses would duplicate the patrol/chase/hurt/dead
   scaffolding, a DRY violation). Tank 1990's Tank ALREADY carries a `behavior` tag (F1 D7) and a `side`.
   F4 adds ONE `updateAI(dt, ctx)` to Tank that runs a tiny `wander`/`seek` FSM and emits a
   `PlayerIntent`-shaped snapshot, then feeds it through the SAME `update(dt, intent)` movement spine the
   player uses. The four types differ ONLY by their `TankSpec` (move/bullet speed, HP) — same FSM, same
   movement code. *Rationale:* the genre's enemies are not behaviourally complex (wander + occasionally
   seek + fire); ONE FSM + a spec is the KISS/DRY model the reference proved. Reusing the player's
   movement spine means the no-diagonal grid-snap invariant (F1) holds for enemies FOR FREE (no second
   movement path to keep in sync — DRY). The boss (later) is a 5th spec + a 'boss' behaviour tag on the
   SAME entity/FSM (the locked decision), so this scales to the boss with no new entity.
3. **D3 — The AI emits a `PlayerIntent` and drives the EXISTING movement spine (DRY); it never
   hand-moves the body.** `updateAI` produces `{dirX,dirY,firePressed,...}` exactly as `Input` does for
   a player, and the scene calls `tank.update(gdt, aiIntent)` — so the enemy uses the F1 4-dir drive +
   turn-time re-center VERBATIM. The AI's "fire on a beat" sets `firePressed` on the beat frame; the
   scene calls `tank.tryFire(bullets)` on it (the same edge-driven fire path the player uses). *Rationale:*
   the alternative (a second movement implementation inside the enemy) would duplicate the load-bearing
   no-diagonal grid-snap logic and drift from it — a DRY/correctness hazard. Feeding the SAME intent shape
   through the SAME spine is the cleanest reuse (SOLID — Input and the AI are two producers of one intent
   contract; the Tank is the one consumer). KISS — the AI is a small intent-builder, not a physics actor.
4. **D4 — The grid-AI is `wander` with a periodic re-decide + a weighted `seek` bias toward the eagle or
   nearest player; it re-decides when blocked.** The FSM: every `AI_REDECIDE` seconds (a runtime random
   in `[AI_REDECIDE_MIN, AI_REDECIDE_MAX]` — OFF the level pin, like the reference's idle jitter) it
   picks a new cardinal: with probability `AI_SEEK_BIAS` it steps toward its target (the eagle base, or
   the nearest player if closer — a Manhattan-greedy cardinal), else a random cardinal (wander). When the
   movement spine reports the body is BLOCKED on its drive axis (Arcade `body.blocked`), it re-decides
   immediately (turn at the obstacle). It fires on its own `fireCooldown` beat whenever it has a free
   bullet slot. *Rationale:* this reproduces the classic Battle City enemy feel (mostly wandering,
   periodically pushing on the base, shooting on a cadence) with the SIMPLEST correct model — a few
   timers + a greedy-cardinal seek (KISS). No pathfinding (YAGNI — the generator guarantees a carved
   corridor to the fort, F2, so a seek bias reaches it; A* would be speculative complexity). The runtime
   randomness is explicitly OUTSIDE the seeded level pin (the verifier never imports the Tank — the
   pure/coupled split), exactly as the reference keeps its per-frame attack choice off the pin (its
   Decision 4).
5. **D5 — `RunState` is a PURE factory (the reference's `createRunState`), the SINGLE run owner, driven
   by `advance()`; the verifier drives the SAME chain.** `core/RunState.ts` is a plain object factory
   (not a class, not a singleton) holding the run-scoped state + the `advance()` method, importing NOTHING
   from Phaser. GameScene constructs ONE in `create()` and is the single writer (no module-level singleton
   — that invites spooky mutation + breaks determinism reasoning — the reference's exact stance).
   `advance()` chains the next seed via the SAME Knuth multiplicative advance the reference owns
   (`(s*2654435761 + 0x9e3779b9) >>> 0`) and increments `stageIndex` (run-global). *Rationale:* a PURE
   run owner is node-constructible, so the verifier drives the EXACT `advance()` chain the game does and
   proves the seed/stage sequence deterministic + monotone (the reference's RunState verifier walk, its
   Decision 44/46). The seed chain has ONE owner (DRY — GameScene's old fixed `DEV_SEED` is replaced by
   `RunState.seed`). KISS — a factory with one method + plain fields.
6. **D6 — `stageIndex` is run-global and NEVER resets, so the difficulty curve climbs across the WHOLE
   run.** `advance()` always `stageIndex += 1`. `stageConfig(stageIndex)` (F2, already monotone + swept)
   is sampled at the run-global index, so every axis (terrain densities, enemy counts, `hardShare`, and
   the F4 `bulletSpeedScale`/`spawnIntervalScale`) rises monotonically across the endless run.
   *Rationale:* this is the reference's BLOCKER-1 fix applied to an endless game — depth never resets, so
   "rises with the stage" is structural (the verifier's sweep is a proof). ENDLESS divergence from the
   reference (no terminal biome list — F2 D3): there is no "run complete", a run ends ONLY on eagle-loss
   or all-lives-spent (the locked decision); `advance()` is always callable (no `isRunComplete` gate).
   KISS — one counter, monotone by construction.
7. **D7 — The stage-clear advance reuses F3's `transitioning` one-shot guard + defers teardown out of the
   death callback (the reference's `_nextLevel`/`_teardownLevel`/`_buildLevel` discipline).** F3 RESERVED
   `this.transitioning` for exactly this. On the LAST enemy's death the scene checks
   `enemiesRemaining===0 && enemiesAlive===0`, and if so (and not already transitioning) sets
   `transitioning=true` and `time.delayedCall(0, () => this._advanceStage())` — deferring the destructive
   teardown out of the bullet×tank overlap/death callback (the F3 footgun discipline). `_advanceStage`
   calls `runState.advance()`, tears down the per-stage world (`tileMap.destroy()`,
   `bullets.releaseAll()`, force-despawn every enemy, destroy the eagle visual), rebuilds via a shared
   `_buildStage()` (extracted from `create()` — DRY), repositions the present players, re-seeds the spawn
   ledger, and clears `transitioning`. *Rationale:* mirrors the reference's transition seam 1:1 (deferred
   teardown + one-shot guard → no double-advance, no body destroyed mid-iteration — AC10). Extracting
   `_buildStage()` from `create()` keeps the first build and every rebuild on ONE path (DRY/SOLID). KISS —
   one guard, one deferred call, one shared builder.
8. **D8 — Staggered/capped spawns are a scene timer reading the per-stage ledger on `RunState`.** The
   scene holds a `spawnTimer` (decays on gdt); when it elapses AND `enemiesAlive < concurrentEnemies` AND
   `enemiesQueued > 0`, it spawns one enemy at the NEXT top spawn point (round-robin L→C→R), picks its
   archetype via the PURE `rosterPick(rng, stageConfig.enemyWeights)`, flags it a `carrier` on a
   `CARRIER_RATE` roll, blinks it (`SPAWN_BLINK_TIME`), and updates the ledger (`enemiesQueued--`,
   `enemiesAlive++`). The stagger interval scales by the stage's `spawnIntervalScale` (deeper stages
   stream faster — but never instant, clamped). *Rationale:* the spawn cadence/cap is a scene concern (it
   owns the world + the timer); the COUNTS/weights live on the pure stage config + the ledger on RunState
   (DRY — one source). KISS — a timer + three ledger checks. The round-robin over the three F2 spawn
   points reuses the generated `tankFits` window-centers (no new placement math — DRY/D13).
9. **D9 — Enemy tanks plug into the EXISTING F3 overlaps generically over `side`; friendly-fire stays off
   between enemies too.** F3 wired the bullet×tank overlap + the bullet×bullet scan GENERIC over `side`
   (its D12 seam). F4 registers each spawned enemy's collider into the bullet×tank overlap (the same
   per-tank `physics.add.overlap` shape F3 uses for players) and the enemy bullets ride the SAME
   `BulletPool` with `ownerSide:'enemy'`. The `FRIENDLY_FIRE=false` filter (F3 D8) already skips
   same-side pairs, so an enemy bullet doesn't kill another enemy and a player bullet doesn't kill an
   ally — for FREE. *Rationale:* the seam exists precisely so F4 needs NO new collision architecture
   (the F3 doc promised it). One pool, one overlap shape, the existing FF filter (DRY/KISS). The enemy
   tank's death funnels through the SAME `onDeath` hook the player uses (F3) — F4 wires the enemy's
   `onDeath` to "bank score + decrement `enemiesAlive` + maybe drop-flag + check stage-clear".
10. **D10 — Score + lives + tier are CARRIED on RunState across `advance()`; the score banks on a kill.**
    `RunState` holds `score` (shared) + per-player `lives`/`tier` maps. An enemy kill banks
    `spec.scoreValue` to `score` (read by the HUD feature later; F4 only accumulates it). Lives are
    moved from the scene's F3 `lives` map ONTO RunState so the stage rebuild carries them (the scene reads
    RunState as the source of truth, keeping the F3 present-players scoping — D11). Tier defaults to 0
    (the base spec); the star power-up (F5) bumps it, `applyStarTier(tier)` re-folds the player's spec on
    a rebuild. *Rationale:* the run economy is run-scoped state → it belongs on RunState (the reference's
    stance — `kills`/`cells`/`hp` live on RunState, carried across levels). KISS — a couple of maps + a
    scalar; the stage rebuild reads them so nothing is lost. YAGNI — the HUD/Hub features render/spend
    them; F4 only owns the numbers.
11. **D11 — `core/RunState.ts` is PURE-leaning but the scene is its only writer; the verifier proves the
    determinism/monotonicity properties, NOT the gameplay balance (honest scope).** The verifier
    node-imports RunState + drives `advance()` to assert the seed chain is deterministic and `stageIndex`
    strictly increases (the determinism property). It does NOT assert "the game is winnable" (it can't —
    that's emergent). The roster well-formedness + the `applyStarTier`/ramp monotonicity are likewise
    DATA properties the verifier owns. *Rationale:* the reference is explicit that the verifier proves
    well-formedness + monotonicity, not balance (its "HONEST VERIFICATION SCOPE"). Keeping F4's verifier
    claims to provable data properties keeps the gate trustworthy (a green verify means the contracts
    hold, not "the game is fun"). KISS — assert what's provable, manual-test the feel.

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F4 adds `config/tanks.ts` + `core/RunState.ts`, and updates
`Tank`/`BulletPool`/`GameScene`/`stages`/`constants`/the verifier:

```
src/
  config/
    constants.ts     # CHANGED (PURE): + SPAWN_BLINK_TIME, SPAWN_STAGGER_BASE, AI_REDECIDE_MIN/MAX,
                     #   AI_SEEK_BIAS, CARRIER_RATE; ARMOR_TANK_HP 3 → 4 (four-flash armor). No Phaser.
    stages.ts        # CHANGED (PURE): + bulletSpeedScale(s)/spawnIntervalScale(s) monotone ramps;
                     #   hardShare (F2) exposed as the F4 enemy-hardness check. No Phaser.
    tanks.ts         # NEW (PURE): TankSpec + 4 enemy specs + PLAYER_BASE + PLAYER_STAR_TIERS +
                     #   applyStarTier + ENEMY_SPECS/ENEMY_ARCHETYPES + rosterPick. No Phaser.
  core/
    Input.ts         # (F1, unchanged)
    RunState.ts      # NEW (PURE): createRunState factory — seed/stageIndex/lives/tier/score/spawn ledger
                     #   /placeholder power-up timers + advance(). No Phaser (node-constructible).
  combat/
    BulletPool.ts    # CHANGED: acquire(owner,cx,cy,facing,speed) — + a per-shot `speed` param so POWER's
                     #   faster bullet works; the four facing branches use it instead of BULLET_SPEED.
  entities/
    Tank.ts          # CHANGED: ctor (scene,x,y,side,spec:TankSpec) — copies moveSpeed/bulletSpeed/
                     #   fireCooldown/maxBullets/maxHp onto per-tank fields (replacing the hardcoded
                     #   TANK_SPEED/FIRE_COOLDOWN/MAX_PLAYER_BULLETS reads); + updateAI(dt, ctx) (the
                     #   wander/seek FSM emitting a PlayerIntent) + carrier + onDropFlag. F3 hit funnel kept.
  scenes/
    GameScene.ts     # CHANGED: construct RunState; _buildStage() (extracted from create, DRY); staggered
                     #   /capped spawn loop; enemy AI tick; register enemies into the F3 overlaps; the
                     #   stage-clear _advanceStage (deferred teardown + transitioning guard).
scripts/
  verify-gen.mjs     # CHANGED: + tanks/RunState well-formedness + determinism + monotonicity (extend §5/§6).
```

### 5.2 Key types & constants

**`src/config/constants.ts`** (PURE — F4 ADDS the five tunables below + CHANGES `ARMOR_TANK_HP` 3 → 4):

- `SPAWN_BLINK_TIME` (s) — the spawn-blink telegraph (reuses the F3 `spawnIframe` window; AC2).
- `SPAWN_STAGGER_BASE` (s) — base seconds between staggered spawns (scaled by `spawnIntervalScale`; D8).
- `AI_REDECIDE_MIN` / `AI_REDECIDE_MAX` (s) — the wander re-decide window (runtime random; D4).
- `AI_SEEK_BIAS` (0..1) — probability a re-decide steps toward the eagle/nearest player vs. wandering.
- `CARRIER_RATE` (0..1) — fraction of spawns flagged red-flash power-up carriers (AC7).
- `ARMOR_TANK_HP` — CHANGED `3 → 4` (line 108). F3 reserved it at 3, but the classic armor tank flashes
  four times and dies on the FOURTH hit; AC4 ("survives `ARMOR_TANK_HP` hits") + the verifier check
  `ARMOR.maxHp === ARMOR_TANK_HP (>1)` are both satisfied either way, but the human-readable "4 hits"
  needs the value to be 4. The `ARMOR` spec's `maxHp` reads this constant (one owner — DRY).

(Existing reused, NO new copies: `ENEMIES_PER_STAGE`, `MAX_CONCURRENT_ENEMIES`, `BOSS_STAGE_EVERY`,
`START_LIVES`, `TWO_PLAYER`, `MAX_DT`, `FRIENDLY_FIRE`, the grid/layout/feel values incl. `TANK_SPEED`,
`BULLET_SPEED`, `FIRE_COOLDOWN`, `MAX_PLAYER_BULLETS` — the latter four are now the PLAYER_BASE spec's
default stats, NOT the only path the entity reads, see §5.2/§5.5. `ARMOR_TANK_HP` is CHANGED, not reused.)

**`src/config/tanks.ts`** (PURE — the roster; the verifier node-imports it):

```ts
export type TankBehavior = 'basic' | 'fast' | 'power' | 'armor' | 'player'
export interface TankSpec {
  id: string
  behavior: TankBehavior
  maxHp: number          // 1 for basic/fast/power + the player; ARMOR_TANK_HP (4) for armor (multi-hit)
  moveSpeed: number      // px/s — the grid drive speed (FAST > the rest)
  bulletSpeed: number    // px/s — the fired bullet's speed (POWER > the rest)
  fireCooldown: number   // s — the attack-beat cadence
  maxBullets: number     // live-bullet cap (classic 1; star tiers raise it)
  color: number          // programmer-art resting fill (coupled Tank ONLY; verifier ignores)
  colorFlash: number     // red-carrier flash fill (coupled Tank ONLY)
  scoreValue: number     // points banked to RunState.score on this enemy's death
  canBreakSteel?: boolean // max-star player only — RESERVED (no bullet reads it in F4; the seam)
}
export const BASIC: TankSpec; export const FAST: TankSpec
export const POWER: TankSpec; export const ARMOR: TankSpec   // the four classic enemy types (AC4)
export const PLAYER_BASE: TankSpec                            // the player tank base spec
export interface StarTierDelta { bulletSpeed?: number; maxBullets?: number; fireCooldownMult?: number; canBreakSteel?: boolean }
export const PLAYER_STAR_TIERS: StarTierDelta[]               // ordered additive deltas (tier 0 = base)
export function applyStarTier(tier: number): TankSpec         // PURE fold: PLAYER_BASE + tiers[0..tier]
export const ENEMY_SPECS: Record<string, TankSpec>           // id → spec (the scene + verifier lookup)
export const ENEMY_ARCHETYPES: TankSpec[]                    // ordered (the verifier sweep source)
export function rosterPick(rng: RNG, weights: { basic; fast; power; armor }): string  // PURE weighted id pick
```

**`src/core/RunState.ts`** (PURE — the active-run value; node-constructible):

```ts
export interface RunState {
  seed: number; stageIndex: number               // run identity + position (stageIndex never resets — D6)
  lives: Record<number, number>                   // per-PRESENT-player lives (carried across advance — D10)
  tier: Record<number, number>                    // per-player star tier (0 = base; F5 bumps it)
  score: number                                   // shared run score (banked on a kill — D10)
  // per-stage spawn ledger (the clear predicate reads these — AC5)
  enemiesRemaining: number; enemiesQueued: number; enemiesAlive: number
  // PLACEHOLDER power-up timers (seeded 0 = inactive; consumed in F5 — the neutral identity)
  freezeTimer: number; shovelTimer: number
  advance(): RunState                             // next seed + stageIndex++ + reseed the spawn ledger
  isBossStage(): boolean                          // stageConfig(stageIndex).isBoss (the boss feature reads it)
}
export function createRunState(startSeed: number, presentSlots: number[]): RunState
```

`createRunState` seeds `lives`/`tier` for the PRESENT players only (the F3 D11 scoping — solo → `[1]`,
co-op → `[1,2]`), `stageIndex=0`, `score=0`, the spawn ledger from `stageConfig(0)`, and the power-up
timers 0. `advance()` chains the next seed (the Knuth advance), `stageIndex++`, and reseeds
`enemiesRemaining/Queued = stageConfig(stageIndex).totalEnemies`, `enemiesAlive = 0`.

**`src/entities/Tank.ts`** (CHANGED — the constructor now takes a `TankSpec`, + additive AI state; the
F1 movement geometry + the F3 hit funnel are reused, but the hardcoded feel-constant reads are replaced
by per-tank spec fields so the roster's per-type stats ACTUALLY drive the running tank — issue #2):

```ts
// CONSTRUCTOR SIGNATURE CHANGE (issue #2). F1's ctor was
//   (scene, x, y, side, behavior='player', hp=TANK_MAX_HP)  — only hp threaded; speeds/cooldown/cap hardcoded.
// F4 replaces the trailing (behavior, hp) pair with a single TankSpec, the canonical source of ALL tunables:
//   constructor(scene, x, y, side: TankSide, spec: TankSpec)
// and the ctor copies the spec's stats onto per-tank fields (so update/tryFire read the FIELD, not a global):
this.spec = spec
this.behavior = spec.behavior          // (was the `behavior` arg)
this.maxHp = spec.maxHp; this.hp = spec.maxHp   // (was the `hp` arg — ARMOR passes ARMOR_TANK_HP=4 here)
this.moveSpeed = spec.moveSpeed        // NEW field — replaces the hardcoded TANK_SPEED in update (lines 172/174)
this.bulletSpeed = spec.bulletSpeed    // NEW field — passed into pool.acquire so POWER's bullet is faster (AC4)
this.fireCooldown = spec.fireCooldown  // NEW field — replaces the hardcoded FIRE_COOLDOWN in tryFire (line 269)
this.maxBullets = spec.maxBullets      // (was = MAX_PLAYER_BULLETS at line 88; now from the spec)

// HARDCODED-CONSTANT → PER-TANK-FIELD replacements inside the EXISTING methods (the movement GEOMETRY is
// byte-identical — only the magnitude source changes, so the no-diagonal/turn-snap invariant is untouched):
//   update() drive (was TANK_SPEED):  setVelocity(this.facing==='right'? this.moveSpeed : -this.moveSpeed, 0)
//                                     setVelocity(0, this.facing==='down'? this.moveSpeed : -this.moveSpeed)
//   tryFire() cooldown (was FIRE_COOLDOWN):  this.cooldownTimer = this.fireCooldown
//   tryFire() acquire (was implicit BULLET_SPEED): pool.acquire(this, cx, cy, this.facing, this.bulletSpeed)

// NEW AI + carrier fields (enemy-only; a player tank leaves carrier/onDropFlag at their defaults):
spec: TankSpec                                    // the per-tank stats (the coupled Tank also reads spec.color/colorFlash)
moveSpeed: number; bulletSpeed: number; fireCooldown: number  // copied from spec (the per-tank feel — issue #2)
carrier: boolean                                  // red-flash power-up carrier (AC7)
onDropFlag: ((x: number, y: number) => void) | null  // fired ONCE at death with the death center (F5 seam)
private aiRedecideTimer: number; private aiIntent: PlayerIntent  // the wander/seek FSM state
// new method:
updateAI(dt: number, ctx: { eagle; players; map }): void  // build aiIntent (wander/seek/turn) + fire beat;
//                                                           // the scene then calls update(gdt, this.aiIntent)
```

`update`/`tryFire` keep their EXACT F1 structure (same turn-snap geometry, same edge-driven fire path);
the only change is that the three hardcoded reads (`TANK_SPEED`, `FIRE_COOLDOWN`, `MAX_PLAYER_BULLETS`)
become reads of `this.moveSpeed` / `this.fireCooldown` / `this.maxBullets`, and `tryFire` passes
`this.bulletSpeed` into `pool.acquire`. So FAST out-drives the rest (its `moveSpeed`), POWER fires a
faster bullet (its `bulletSpeed`), ARMOR takes four hits (its `maxHp = ARMOR_TANK_HP`) — AC4 is honoured
by the RUNNING game, not merely provable in the spec data. `updateAI` re-decides a cardinal every
`AI_REDECIDE` seconds (or immediately when blocked), biasing toward the target on `AI_SEEK_BIAS`, sets
`aiIntent.firePressed` on the `this.fireCooldown` beat, and stores it; the scene drives
`tank.update(gdt, aiIntent)` (the SAME movement spine) + `tank.tryFire(bullets)` on the fire frame. The
F3 `onHit`/`isHittable`/`onDeath`/`respawnAt`/`spawnIframe` funnel is UNCHANGED.

> **`PLAYER_BASE`'s stats equal the current F1 constants** (`moveSpeed = TANK_SPEED`,
> `bulletSpeed = BULLET_SPEED`, `fireCooldown = FIRE_COOLDOWN`, `maxBullets = MAX_PLAYER_BULLETS`,
> `maxHp = TANK_MAX_HP`), so threading the spec is BEHAVIOUR-PRESERVING for the player (the F1 feel is
> unchanged) — the constants stay the single owner of the player's DEFAULT feel (DRY), now read via the
> `PLAYER_BASE` spec rather than inlined in the entity. GameScene constructs players as
> `new Tank(scene, x, y, 'player', applyStarTier(runState.tier[slot]))`.

**`src/combat/BulletPool.ts`** (CHANGED — `acquire` gains a `speed` parameter so a per-tank bullet speed
is honoured; issue #1). F1's `acquire(owner, cx, cy, facing)` HARDCODES the global `BULLET_SPEED` in its
four facing branches (lines 95/99/103/107) and stores the derived `vx/vy` on the bullet context — there
is NO speed input, so POWER's faster bullet (AC4) is UNREACHABLE without an API change. F4 makes the ONE
generalization:

```ts
// SIGNATURE CHANGE (issue #1): add a trailing `speed` param (px/s). The four facing branches use `speed`
// instead of the imported BULLET_SPEED constant; everything else (the muzzle standoff, vx/vy on the
// context, the hand-integrated tick, release) is BYTE-IDENTICAL.
acquire(owner: Tank, cx: number, cy: number, facing: Facing, speed: number): BulletRect | null
//   case 'up':    vy = -speed; my = cy - MUZZLE_STANDOFF; break
//   case 'down':  vy =  speed; my = cy + MUZZLE_STANDOFF; break
//   case 'left':  vx = -speed; mx = cx - MUZZLE_STANDOFF; break
//   case 'right': vx =  speed; mx = cx + MUZZLE_STANDOFF; break
```

The bullet context's `vx/vy` (already stored, F1) carry the per-shot velocity, so `tick(dt)` and the
bounds/release path are UNCHANGED — only the velocity MAGNITUDE source changes (a per-tank argument
instead of the module constant). The lone call site is `Tank.tryFire`, which now passes
`this.bulletSpeed` (a player passes `PLAYER_BASE.bulletSpeed = BULLET_SPEED`, behaviour-preserving;
POWER passes its higher `bulletSpeed`). `BULLET_SPEED` stays in `constants.ts` as `PLAYER_BASE`'s default
(the single owner — DRY); the pool no longer hardcodes it. This is the seam F1's comment promised; it is
a genuine (small) API change, NOT a no-op — so BulletPool is listed CHANGED in §6, not "unchanged".

### 5.3 Algorithms

**Staggered / capped spawn loop (the scene's per-frame spawn step, D8/AC1/AC2):**
```
spawnTimer -= gdt
interval = SPAWN_STAGGER_BASE * spawnIntervalScale(runState.stageIndex)   # deeper → smaller (no slower)
if (spawnTimer <= 0 && runState.enemiesQueued > 0 && runState.enemiesAlive < cfg.concurrentEnemies):
  point = topSpawns[spawnCursor % 3]; spawnCursor++                       # round-robin L→C→R (F2 D13)
  archetype = ENEMY_SPECS[ rosterPick(rng, cfg.enemyWeights) ]            # PURE weighted pick (D1/D8)
  enemy = new Tank(scene, point.x, point.y, 'enemy', archetype)          # the WHOLE spec → all per-type stats
  #   (the ctor copies moveSpeed/bulletSpeed/fireCooldown/maxBullets/maxHp onto the tank — issue #2; so the
  #    enemy DRIVES at archetype.moveSpeed, FIRES at archetype.fireCooldown, and tryFire passes
  #    archetype.bulletSpeed into pool.acquire — FAST/POWER/ARMOR actually differ at runtime, AC4)
  enemy.carrier = rng() < CARRIER_RATE                                    # red-flash carrier (AC7)
  enemy.spawnIframe = SPAWN_BLINK_TIME                                    # blink before active (AC2)
  enemy.onDeath  = () => onEnemyKilled(enemy)                             # bank score + ledger + clear-check
  enemy.onDropFlag = enemy.carrier ? (x,y)=>markDrop(x,y) : null          # F5 seam (AC7)
  register enemy.collider into the bullet×tank overlap (F3 seam, D9)
  enemies.push(enemy); runState.enemiesQueued--; runState.enemiesAlive++
  spawnTimer = interval
```

**Enemy AI tick → intent (Tank.updateAI, D2/D3/D4/AC3):**
```
aiRedecideTimer -= dt
blocked = body.blocked on the current drive axis (Arcade)               # turn at the obstacle/wall (D4)
if (aiRedecideTimer <= 0 || blocked):
  target = nearer(eagle, nearest live player)                            # Manhattan-nearest (AC3)
  if (rng() < AI_SEEK_BIAS): dir = greedyCardinalToward(target)          # seek bias (D4)
  else:                       dir = randomCardinal()                     # wander
  aiIntent.dirX/dirY = dir; aiIntent.up/down/left/right derived
  aiRedecideTimer = rand(AI_REDECIDE_MIN, AI_REDECIDE_MAX)               # runtime random, OFF the pin (D4)
aiIntent.firePressed = (cooldownTimer <= 0)                              # fire on the beat (the F1 fire path)
# the scene then: tank.update(gdt, aiIntent); if (aiIntent.firePressed) tank.tryFire(bullets)
```
(During the spawn blink `isHittable()` is false AND the scene skips `updateAI`/fire, so a blinking
enemy is inert — AC2. The greedy cardinal picks the axis with the larger Manhattan gap to the target,
tie-broken deterministically — KISS, no pathfinding, D4.)

**Enemy killed → score / ledger / stage-clear (the scene's onEnemyKilled, D7/D10/AC5):**
```
onEnemyKilled(enemy):
  effects.explosion(enemy.center, { big: true })                        # the kill burst (F3 FX)
  runState.score += enemy.spec.scoreValue                               # bank score (D10)
  runState.enemiesAlive--                                               # the ledger
  if (enemy.carrier && enemy.onDropFlag): enemy.onDropFlag(deathX, deathY)  # mark the drop (AC7; F5 spawns)
  remove enemy from the live list (forceDespawn after the F3 death pop)
  if (runState.enemiesRemaining == 0 ... ) ...                          # (enemiesRemaining decremented when queued runs out)
  if (runState.enemiesQueued == 0 && runState.enemiesAlive == 0 && !transitioning):
    transitioning = true
    time.delayedCall(0, () => _advanceStage())                         # deferred teardown out of the death cb (AC10)
```
(`enemiesRemaining` is the running "left to clear" = `enemiesQueued + enemiesAlive`; the clear predicate
is "no more queued AND none alive". The deferred `delayedCall(0)` + the `transitioning` one-shot guard
mean a multi-frame final-kill advances exactly once — AC10.)

**Stage advance (deferred — _advanceStage, D7/AC5/AC10):**
```
_advanceStage():
  runState.advance()                                                    # next seed + stageIndex++ + reseed ledger (D5/D6)
  _teardownStage()                                                      # tileMap.destroy(); bullets.releaseAll();
  #                                                                       forceDespawn every enemy; destroy eagle visual
  _buildStage()                                                         # the SHARED builder (extracted from create — DRY):
  #   generateStage(runState.seed, stageConfig(stageIndex)) → TileMap; rebuild eagle; reposition PRESENT players at
  #   the new spawns (lives/tier/score carried on RunState); re-register the F3 overlaps; re-seed spawnTimer/cursor.
  transitioning = false                                                 # re-arm for the next stage
```

**GameScene.update (additive over F3 — the AI tick + the spawn step):**
```
dt = min(delta/1000, MAX_DT); gdt = dt          # F3 dt/gdt seam (gdt=0 = the F5 freeze power-up later)
s = input2.sample()
if (gameOver) { effects.tick(dt); return }
# players (F3, unchanged): fire off the edge + drive on gdt
_spawnStep(gdt)                                  # staggered/capped spawn (D8)
for each live enemy: if (!blinking) { enemy.updateAI(gdt, ctx); enemy.update(gdt, enemy.aiIntent);
                                      if (enemy.aiIntent.firePressed) enemy.tryFire(bullets) }
                     else enemy.update(gdt, IDLE_INTENT)   # blink ticks the spawnIframe; no move/fire (AC2)
bullets.tick(gdt); _scanBulletVsBullet(); effects.tick(dt)   # F3, unchanged (enemy bullets ride the same pool)
```

### 5.4 GameScene integration

`create()` (refactored over F3):
- Construct the SINGLE `RunState`: `this.runState = createRunState(mintSeed(), presentSlots)` (the seed
  replaces F3's fixed `DEV_SEED`; `presentSlots` is `[1]` or `[1,2]` per `TWO_PLAYER` — D11 scoping).
- Call `this._buildStage()` — the SHARED builder extracted from F3's create body (generate the stage,
  TileMap, the eagle Base + back-ref, spawn the present players, the F3 tank×terrain colliders, register
  the bullet×solids + bullet×tank overlaps). The PRESENT players are constructed with the NEW spec ctor —
  `new Tank(scene, x, y, 'player', applyStarTier(runState.tier[slot]))` (the F1 player feel is preserved
  because `PLAYER_BASE`'s stats equal the F1 constants — §5.2; tier 0 = the base spec). `_buildStage`
  ALSO seeds the spawn ledger from `stageConfig(runState.stageIndex)` + resets
  `spawnTimer`/`spawnCursor`/the enemy list.
- Reset the one-shot guards (`gameOver=false`, `transitioning=false`).

`update()` — §5.3 (the spawn step + the enemy AI tick + the F3 player/bullet/FX ticks).

The enemy bullets ride the EXISTING `BulletPool` (`ownerSide:'enemy'`) and the EXISTING bullet×tank +
bullet×bullet + bullet×solids overlaps (F3 seams — D9), so an enemy bullet killing a player or the eagle
is resolved with NO new collision code.

### 5.5 Integration points with existing code

- **`config/stages.ts` (F2)** — F4 ADDS two monotone ramps (`bulletSpeedScale`/`spawnIntervalScale`)
  beside the existing ones + exposes `hardShare` (already present) as the F4 enemy-hardness signal. The
  existing terrain/count/`hardShare` ramps are UNCHANGED (still monotone + swept). Stays Phaser-free.
- **`config/constants.ts` (F0/F3)** — F4 ADDS the spawn/AI numbers AND CHANGES `ARMOR_TANK_HP` 3 → 4
  (issue #3 — the four-flash armor tank); REUSES `MAX_CONCURRENT_ENEMIES`, `ENEMIES_PER_STAGE`,
  `BOSS_STAGE_EVERY`, `START_LIVES`, `TWO_PLAYER`, `MAX_DT`, `FRIENDLY_FIRE`, and `TANK_SPEED`/
  `BULLET_SPEED`/`FIRE_COOLDOWN`/`MAX_PLAYER_BULLETS`/`TANK_MAX_HP` (now the `PLAYER_BASE` spec's default
  stats — §5.2). No renames; stays PURE.
- **`world/LevelGenerator.ts` (F2) — Unchanged** — F4 reuses `generateStage` + the three `enemySpawns`
  window-centers (D13) for the round-robin spawn points + the two `playerSpawns` for the rebuild
  reposition. No generator change (the spawns were emitted FOR this feature — F2's `which:'enemyL/C/R'`).
- **`world/TileMap.ts` (F2) — Unchanged** — F4 calls the existing `destroy()` (F2 D6) on a stage rebuild
  teardown; reuses `solidBodies`/`waterBodies` as the enemy tank×terrain collider targets (same as the
  player, F3). No TileMap change.
- **`entities/Tank.ts` (F1/F3) — CHANGED (the ctor takes a `TankSpec`; per-tank feel fields replace three
  hardcoded constant reads, §5.2 — issue #2)** — the constructor's trailing `(behavior, hp)` pair becomes
  a single `spec: TankSpec`, and the ctor copies `spec.moveSpeed/bulletSpeed/fireCooldown/maxBullets/maxHp`
  onto per-tank fields. The movement GEOMETRY is byte-identical, but `update`'s drive reads `this.moveSpeed`
  (was `TANK_SPEED`), `tryFire` arms `this.cooldownTimer = this.fireCooldown` (was `FIRE_COOLDOWN`) and
  passes `this.bulletSpeed` into `pool.acquire` (was the implicit `BULLET_SPEED`), and `maxBullets` comes
  from the spec (was `MAX_PLAYER_BULLETS`). F4 ALSO adds `updateAI` + the `carrier`/`onDropFlag` fields. The
  F3 `onHit`/`isHittable`/`onDeath`/`respawnAt`/`spawnIframe` HIT FUNNEL is unchanged (the AI is a new
  INTENT PRODUCER feeding the same consumer — D3; the spec only re-sources the feel MAGNITUDES). The
  reserved `side:'enemy'`/`behavior` tags (F1 D7) now carry the archetype via its spec.
- **`combat/BulletPool.ts` (F1/F3) — CHANGED (one signature generalization, §5.2)** — enemy bullets ride
  the SAME pool (`ownerSide:'enemy'`, the firing Tank passed in); `releaseAll()` (F1) is the stage-rebuild
  teardown; `forEachActive`/`release` (F3) are reused. The ONE change: `acquire` gains a trailing
  `speed: number` parameter and its four facing branches use it instead of the imported `BULLET_SPEED`
  constant (lines 95/99/103/107), storing the per-shot velocity on the already-present `vx/vy` context —
  so `tick`/release stay byte-identical. `Tank.tryFire` passes `this.bulletSpeed`, so POWER's faster
  bullet (AC4) is REAL, not a no-op. This is a genuine (small) API change — the seam F1's comment
  promised — NOT "unchanged" (the earlier draft mis-stated it as a no-op while also claiming the threading
  happened, a contradiction; this resolves it — issue #1).
- **`scenes/GameScene.ts` (F3)** — the F3 combat resolution + the `gameOver`/`transitioning` guards + the
  dt/gdt seam are KEPT; F4 adds the RunState, the shared `_buildStage`, the staggered spawn loop, the
  enemy AI tick, and the `_advanceStage` rebuild. F3's `lives` map MOVES onto RunState (the source of
  truth carried across the rebuild — D10).
- **`scenes/GameOverScene.ts` (F0 stub)** — F4 still routes there on run-over; the run-summary/score
  banking readout is a LATER feature (F4 carries `score`/`bestStage` on RunState for it to read).
- **Reserved for later features:** the boss tank (a 5th `config/tanks.ts` spec + a 'boss' behaviour tag +
  the "STAGE N CLEARED" banner — the boss feature; `stageConfig.isBoss` + `RunState.isBossStage()`
  already flag it); the 6 power-ups (F4's `carrier` flag + `onDropFlag` hook + the placeholder
  `freezeTimer`/`shovelTimer` on RunState — F5); the live HUD readouts (the HUD reads RunState's
  `score`/`lives`/the spawn ledger — the HUD feature); the Hub `applyUpgrades(slot)` fold (over
  `PLAYER_BASE` + `applyStarTier` — the Hub feature); the star power-up bumping `tier` + the
  `canBreakSteel` max-star steel-break (the bullet's reserved `power` context, D4-of-F3); ICE
  low-friction feel.

---

## 6. Files

**New:**

- `src/config/tanks.ts` — the PURE roster: `TankSpec`, the 4 enemy specs, `PLAYER_BASE`,
  `PLAYER_STAR_TIERS` + `applyStarTier`, `ENEMY_SPECS`/`ENEMY_ARCHETYPES`, `rosterPick` (no Phaser).
- `src/core/RunState.ts` — the PURE active-run factory: `createRunState` + `advance()` (seed/stageIndex/
  lives/tier/score/spawn ledger/placeholder power-up timers; no Phaser, node-constructible).

**Changed:**

- `src/config/constants.ts` — ADD `SPAWN_BLINK_TIME`, `SPAWN_STAGGER_BASE`, `AI_REDECIDE_MIN/MAX`,
  `AI_SEEK_BIAS`, `CARRIER_RATE`; and CHANGE `ARMOR_TANK_HP` line 108 `3 → 4` (the four-flash armor tank —
  issue #3; the `ARMOR` spec's `maxHp` reads it, so AC4's "survives 4 hits" is literally true). PURE; no
  Phaser.
- `src/config/stages.ts` — ADD `bulletSpeedScale(s)` + `spawnIntervalScale(s)` monotone ramps; keep the
  existing axes; expose `hardShare` as the F4 enemy-hardness signal (PURE; no Phaser).
- `src/combat/BulletPool.ts` — CHANGE `acquire`'s signature to take a trailing `speed: number` (px/s) and
  use it in the four facing branches instead of the imported `BULLET_SPEED` constant (lines 95/99/103/107);
  the stored `vx/vy` context + `tick`/`release` are otherwise byte-identical. This is what makes POWER's
  faster bullet (AC4) real — issue #1.
- `src/entities/Tank.ts` — CHANGE the constructor signature from `(scene,x,y,side,behavior,hp)` to
  `(scene,x,y,side,spec: TankSpec)`, copying `spec.moveSpeed/bulletSpeed/fireCooldown/maxBullets/maxHp`
  onto per-tank fields; REPLACE the hardcoded `TANK_SPEED` (lines 172/174), `FIRE_COOLDOWN` (line 269),
  and `MAX_PLAYER_BULLETS` (line 88) reads with `this.moveSpeed`/`this.fireCooldown`/`this.maxBullets`, and
  pass `this.bulletSpeed` into `pool.acquire`; ADD `updateAI(dt, ctx)` (the wander/seek FSM emitting a
  `PlayerIntent`), `carrier`, `onDropFlag`. The movement GEOMETRY + the F3 hit funnel are unchanged — only
  the feel-magnitude SOURCE moves from globals to the spec (issue #2).
- `src/scenes/GameScene.ts` — construct `RunState`; construct players with the new spec ctor
  (`new Tank(scene,x,y,'player',applyStarTier(tier))`); extract `_buildStage()` (DRY); the
  staggered/capped spawn loop (`new Tank(scene,x,y,'enemy',archetype)`); the enemy AI tick; register
  enemies into the F3 overlaps; the stage-clear `_advanceStage` (deferred teardown + the `transitioning`
  one-shot guard, carrying lives/score/tier). (The per-tank bullet speed is threaded INSIDE `Tank.tryFire`
  via `pool.acquire(..., this.bulletSpeed)` — not at a GameScene call site.)
- `scripts/verify-gen.mjs` — ADD the F4 section: roster well-formedness (positive stats, known behaviour,
  armor `maxHp > 1`, the four enemy types pairwise-distinct on a tunable stat), `rosterPick` returns a
  known id + is deterministic, `applyStarTier` monotone in bullet speed/maxBullets, `RunState.advance()`
  deterministic + `stageIndex` strictly increasing, and EXTEND §5's monotonicity sweep with
  `bulletSpeedScale` (non-decreasing) + `spawnIntervalScale` (non-increasing). Its F0–F2 sections stay.

**Unchanged:** `src/world/LevelGenerator.ts`, `src/world/TileMap.ts`, `src/config/tiles.ts`,
`src/entities/Base.ts`, `src/core/Input.ts`, `src/effects/*`, `src/util/rng.ts`, `src/util/save.ts`, the
other scenes. (`src/combat/BulletPool.ts` is NO LONGER here — it is CHANGED above: `acquire` gains a
`speed` parameter so POWER's faster bullet works — issue #1.)

---

## 7. Verification

How `typecheck`/`build`/`verify` + targeted greps + a manual drive-test prove each AC:

- **AC1 (staggered/capped spawns)** — `npm run dev`: enemies appear ONE at a time from the three top
  spawn points on a cadence, never more than `concurrentEnemies` alive at once; exactly `totalEnemies`
  over the stage. Code (read the spawn step): it spawns only when `spawnTimer<=0 && enemiesQueued>0 &&
  enemiesAlive < cfg.concurrentEnemies`, round-robins `topSpawns`, decrements the ledger. The verifier
  asserts `concurrentEnemies <= MAX_CONCURRENT_ENEMIES` + `totalEnemies >= concurrentEnemies` (F2 §5,
  kept) so the cap is sound.
- **AC2 (spawn blink)** — `npm run dev`: a new enemy blinks ~`SPAWN_BLINK_TIME`s before moving/firing,
  is unhittable during it. Code: the spawn sets `enemy.spawnIframe = SPAWN_BLINK_TIME` (F3 cue);
  `update` skips `updateAI`/fire while blinking; `isHittable()` is false (F3, reused).
- **AC3 (AI moves, fires, seeks)** — `npm run dev`: enemies wander, turn at walls, drift toward the
  eagle/players, and shoot; an enemy bullet kills a player (life/respawn) or the eagle (run over). Code:
  `updateAI` re-decides a cardinal (seek-biased) every `AI_REDECIDE`s or when `body.blocked`, sets
  `firePressed` on the `fireCooldown` beat; the enemy drives the SAME `Tank.update` spine + `tryFire`;
  the enemy bullet resolves through the F3 bullet×tank/solids overlaps (grep: enemy colliders are
  registered into the SAME overlap shape; enemy bullets carry `ownerSide:'enemy'`).
- **AC4 (the four types differ)** — `npm run verify`: the F4 section asserts `BASIC/FAST/POWER/ARMOR`
  are pairwise distinct on {moveSpeed, bulletSpeed, maxHp} and `ARMOR.maxHp === ARMOR_TANK_HP (>1)`.
  `npm run dev`: FAST visibly outruns the rest, POWER's bullet is faster, ARMOR takes four hits.
- **AC5 (clear advances the stage in place, state carried)** — `npm run dev`: destroy every enemy → the
  field rebuilds harder, the same players continue with their lives/score intact, the stage label
  increments. Code: `onEnemyKilled` checks `enemiesQueued===0 && enemiesAlive===0`, defers
  `_advanceStage` (`delayedCall(0)`) under the `transitioning` guard; `_advanceStage` calls
  `runState.advance()` (seed+stageIndex++), tears down, and `_buildStage`s — repositioning the present
  players, carrying `lives`/`tier`/`score` on RunState. The verifier asserts `advance()` increments
  `stageIndex` deterministically (AC8).
- **AC6 (monotone difficulty)** — `npm run verify`: §5's sweep (extended) asserts across
  `stageConfig(0..30)` that `hardShare` is non-decreasing (F2, kept), `bulletSpeedScale(s)` is
  non-decreasing, `spawnIntervalScale(s)` is non-INCREASING, and `applyStarTier(t)` is non-decreasing in
  bulletSpeed/maxBullets across tiers — each RE-derived (a proof, not eyeballing).
- **AC7 (red carriers flagged + drop marked, pickup F5)** — `npm run dev`: some enemies flash red; on a
  carrier's death a brief marker pops at the death center (no pickup yet). Code: the spawn sets
  `enemy.carrier = rng() < CARRIER_RATE` (red flash in the coupled Tank's visual); `onEnemyKilled` fires
  `enemy.onDropFlag(deathX, deathY)` ONCE for a carrier (the F5 seam — grep: no power-up entity is
  constructed in F4).
- **AC8 (RunState deterministic + node-constructible)** — `npm run verify`: the F4 section constructs
  `createRunState(SEED, [1,2])`, drives `advance()` K times, and asserts the `seed`/`stageIndex` chain is
  byte-identical to a second run from the same seed, and `stageIndex` strictly increases. The successful
  node-import of `core/RunState.ts` (no Phaser) re-proves its purity.
- **AC9 (co-op + solo; F3 seams reused)** — `npm run dev` (both players): both players' bullets kill
  enemies; an enemy bullet doesn't kill another enemy (same-side FF off — F3 filter); a solo run
  (`TWO_PLAYER=false`) spawns + clears identically. Code: enemies register into the SAME bullet×tank
  overlap as players (grep — one overlap shape over `side`); the FF filter (F3) skips same-side pairs;
  `_buildStage` repositions only the present players (D11 scoping, kept).
- **AC10 (deferred teardown + one-shot guards)** — read `_advanceStage`/`onEnemyKilled`: the stage
  advance is a `time.delayedCall(0)` closure gated by `transitioning` (set true BEFORE the defer); the
  teardown calls `tileMap.destroy()` / `bullets.releaseAll()` / force-despawn each enemy (no body
  destroyed inside an overlap/death callback). Grep the scene for `delayedCall(0)` on the advance path +
  `if (this.transitioning) return` and the `gameOver` guard (F3, kept).
- **AC11 (green gate / pure-coupled split / offline)** — `npm run typecheck` exits 0 (strict); `npm run
  build` exits 0; `npm run verify` prints OK + exits 0 with the NEW F4 assertions PLUS the unchanged
  F0–F2 sweep. Grep: `config/tanks.ts`, the `config/stages.ts` extension, and `core/RunState.ts` have NO
  `import 'phaser'` (the verifier imports them under node); `entities/Tank.ts`/`GameScene.ts` import
  Phaser and are NEVER imported by the verifier. Grep scenes/entities for `load.` (none); only
  rectangles/Graphics drawn. Runs from `file://`.

**Definition of done:** `npm run typecheck`, `npm run build`, and `npm run verify` all exit 0 (with the
F4 roster/RunState/monotonicity assertions); a manual `npm run dev` drive-test confirms AC1–AC10
(enemies stream staggered + capped from the top, blink before active, wander/seek/fire as real
combatants, the four types differ, clearing all enemies advances the stage in place with lives/score
carried, difficulty visibly rises, red carriers flash + mark a drop on death); the pure/coupled split is
preserved (the roster + RunState + the stages extension stay Phaser-free + node-imported by the
verifier), every destructive teardown is deferred out of its callback under the one-shot `transitioning`
guard, and the enemy tanks reuse the F1 movement spine + the F3 combat/overlap seams with no duplication.

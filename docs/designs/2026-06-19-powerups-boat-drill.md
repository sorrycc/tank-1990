# Boat + Drill — two new timed power-ups (the roster grows 6 → 8)

## 1. Background / Intent

The roster is the SIX classics (`config/powerups.ts`: helmet/clock/shovel/star/grenade/tank).
This adds TWO more, both TIMED, both leaning on seams that already exist:

- **BOAT** — for a window, the player tank may drive OVER `TILE.WATER` (the amphibious
  pickup). Water normally blocks tanks via `_collideTankWithTerrain`'s `waterBodies`
  collider. We toggle a per-slot boat flag the collider's PROCESS callback respects, then
  the timer expiry restores the block.
- **DRILL** — for a window, a PLAYER bullet PIERCES one brick layer: on a brick hit it chips
  the brick but does NOT despawn the FIRST time (carry a pierce flag on the bullet exactly
  like `bx.canBreakSteel`), then despawns on the next solid hit.

Both reuse the existing timed-power-up machinery (config tunable → POWERUPS row → RunState
timer → `tickTimers` decay → `_applyPowerUp` arm → HUD readout) — no new subsystem (KISS).

## 2. Key Decisions

1. **Add two rows to the PURE `POWERUPS` table, keep it Phaser-free.** Extend `PowerUpKind`
   with `'boat' | 'drill'`, add `BOAT_SAIL_SEC` / `DRILL_PIERCE_SEC` tunables (DRY — the ONE
   owner the scene reads), and push two TIMED rows (`durationSec > 0`). `POWERUP_BY_ID` /
   `POWERUP_KINDS` / `pickPowerUpKind` all derive from `POWERUPS`, so they grow for free and
   the carrier-death drop now picks 8 kinds uniformly. NO Phaser import added.

2. **BOAT = a per-slot RunState timer + a water-collider PROCESS callback (no body churn).**
   Add `boatTimer: Record<number, number>` to RunState — seeded 0, ticked by `tickTimers`,
   RESET on `advance()` — mirroring `shieldTimer` EXACTLY (per-slot, identity 0). The tank ×
   water collider gets a process callback `() => !(this.runState.boatTimer[slot] > 0)`:
   returning false SKIPS the separation for that frame, so the tank glides over water; on
   expiry the timer hits 0 and the block resumes — NO body add/remove, no terrain mutation
   (KISS, and it can't desync). The slot is captured in `_collideTankWithTerrain` (called
   per-tank at build, so we know the slot for player tanks). Enemy tanks pass no boat slot →
   always blocked.

3. **DRILL = a `bx.drill` bullet flag snapshotted at fire time, like `canBreakSteel`.** Add
   `drill: boolean` to `BulletContext` (init/park false). `acquire` sets it from a per-tank
   live flag the scene toggles when the power-up is active. On a BRICK hit in
   `_onBulletHitSolid`, if `bx.drill` is true we chip the sub-cell (deferred destroy, as
   today) but DO NOT `release` the bullet, and CLEAR `bx.drill` so the SECOND brick stops it
   (pierces ONE layer — the spec). A STEEL/BASE hit still despawns (drill pierces brick only).
   YAGNI: no multi-layer pierce, no drill-vs-steel.

4. **Carry the drill state from RunState onto the firing tank (read at fire time).** Add
   `drillTimer: number` (shared, scalar — drill is a player-fire buff, ticked + reset like
   `freezeTimer`). `acquire` can't read RunState, so the scene sets a live `tank.drill`
   boolean each frame in `update()` from `this.runState.drillTimer > 0` (only player tanks),
   and `acquire` snapshots `owner.drill === true` onto `bx.drill`. KISS — one scalar timer,
   the tank carries the live flag the bullet snapshots (the `ownerSide`/`canBreakSteel`
   stance). NOTE: drill is shared across present players (like freeze), keeping RunState
   small; if per-slot is wanted later it mirrors `boatTimer` — not now (YAGNI).

5. **HUD priority + verifier counts updated CONSISTENTLY.** The `_publishHud` active-timer
   chain gains `boat`/`drill` arms (after freeze/shovel, before shield) reading their
   timers + `*_SEC` max. The verifier's `EXPECTED_KINDS` / timed-list / count assertions are
   updated to 8 kinds with boat+drill in the TIMED set (still well-formed).

## 3. Files to touch

- **`src/config/powerups.ts`** (PURE) — extend `PowerUpKind` with `'boat' | 'drill'`; add
  `export const BOAT_SAIL_SEC = 12` and `DRILL_PIERCE_SEC = 12` next to the existing SEC
  tunables; push two rows to `POWERUPS` (`boat` ocean-blue, `drill` slate-grey, both
  `durationSec` = the new tunable). No Phaser. `POWERUP_BY_ID`/`POWERUP_KINDS`/
  `pickPowerUpKind` derive — no edit needed.

- **`src/core/RunState.ts`** (PURE) — add `boatTimer: Record<number, number>` (per-slot,
  seeded 0 per present slot in `createRunState`, RESET in `advance()`, decayed in
  `tickTimers` — mirror `shieldTimer` line-for-line) and `drillTimer: number` (scalar,
  seeded 0, RESET in `advance()`, decayed in `tickTimers` — mirror `freezeTimer`). No Phaser.

- **`src/combat/BulletPool.ts`** (coupled) — add `drill: boolean` to `BulletContext`; init
  `false` in the ctor `bx`; set `bx.drill = owner.drill === true` in `acquire`; reset
  `bx.drill = false` in `_disable`.

- **`src/entities/Tank.ts`** (coupled) — add a public `drill = false` field (the live flag
  the scene sets + `acquire` snapshots; default false so enemies never drill).

- **`src/scenes/GameScene.ts`** (coupled) —
  - `_applyPowerUp`: add `case 'boat'` (`this.runState.boatTimer[slot] = BOAT_SAIL_SEC`) and
    `case 'drill'` (`this.runState.drillTimer = DRILL_PIERCE_SEC`).
  - `_collideTankWithTerrain(tank, slot?)`: pass the water collider a process callback that
    returns `false` (skip) when `slot !== undefined && this.runState.boatTimer[slot] > 0`.
    Thread the slot from the player-build call; enemy/eagle builds pass none → always block.
  - `_onBulletHitSolid` BRICK branch: when `bx.drill`, chip (deferred) but SKIP `release`
    and set `bx.drill = false` (clear after one pierce). Reorder so the shared
    `release(bulletRect)` is GATED by `!piercedThisHit`.
  - `update()`: set `tank.drill = this.runState.drillTimer > 0` for each player tank (so the
    next `acquire` snapshots it).
  - `_publishHud`: add `boat`/`drill` arms to the active-power-up priority chain.
  - import `BOAT_SAIL_SEC`, `DRILL_PIERCE_SEC` from `config/powerups`.

- **`scripts/verify-gen.mjs`** — update §8a: `EXPECTED_KINDS` → 8 (add `boat`,`drill`); the
  timed list → `['helmet','clock','shovel','boat','drill']`; add
  `POWERUP_BY_ID.boat.durationSec === BOAT_SAIL_SEC` + `.drill === DRILL_PIERCE_SEC` checks;
  import the two new constants. The success banner's "6 kinds" wording → "8 kinds".

- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts`** — add `power.boat` / `power.drill` labels.

## 4. Acceptance criteria

1. With BOAT active, a player tank drives over WATER tiles; on expiry water blocks again
   (no leftover passability, no body churn). Enemy tanks are NEVER amphibious.
2. With DRILL active, a player bullet hitting a brick chips that sub-cell and CONTINUES,
   then despawns on its SECOND solid hit (pierces exactly ONE layer). STEEL/eagle still
   despawn the drill shot. Non-drill bullets are unchanged.
3. Both timers decay on the gameplay dt, RESET on a stage advance (no bleed-through), and
   surface in the HUD active-power-up readout with their localised label + seconds.
4. The roster is 8 well-formed kinds; the carrier-death drop picks boat/drill uniformly via
   the unchanged `pickPowerUpKind`.
5. `npm run typecheck`, `npm run verify`, and `npm run build` all stay green.

## 5. How `npm run verify` stays green

- `config/powerups.ts` and `core/RunState.ts` stay PURE (no Phaser import) — the verifier
  node-imports them exactly as today; the new fields/rows are plain data + numbers.
- The verifier's power-up assertions are updated IN LOCKSTEP with the table (8 kinds, the
  two new timed durations tied to their constants) — so the "well-formed roster" gate proves
  the new shape instead of failing on the old count. `pickPowerUpKind` stays total +
  deterministic over the now-8 kinds (its sweep is count-agnostic).
- `tickTimers`/`advance` keep their clamp-at-0 + reset contracts (the new timers mirror the
  existing ones); the determinism/monotonicity gates touch RNG/stage-gen only — unaffected.
- All Phaser-coupled edits (BulletPool/Tank/GameScene) live outside the verifier's import set.

## 6. i18n keys to add

- `power.boat` → EN `'BOAT'`, ZH `'船'`
- `power.drill` → EN `'DRILL'`, ZH `'钻头'`

(Read via the existing HUD `t('power.<kind>')` path — no new call sites.)

# Steel-break — wire the reserved `canBreakSteel` flag (max-star player breaks STEEL)

## 1. Background / Intent

`config/tanks.ts` already ships the classic four-star ramp, and tier 3 (max star) sets
`canBreakSteel: true` on its `StarTierDelta` — folded by `applyStarTier` onto the player
spec. But the flag is a DEAD seam today:

- `BulletPool.acquire` never copies it onto the fired bullet's `BulletContext`.
- `GameScene._onBulletHitSolid`'s STEEL branch is an explicit no-op
  (`// STEEL: NO terrain change (indestructible this phase …)`).
- `TileMap` has no whole-tile STEEL removal (only `destroyBrickSubCell`, a quarter-chip).

GOAL: a max-star (tier 3) PLAYER tank's bullets destroy a whole STEEL tile on hit. Every
other bullet (enemy, boss, sub-tier player) still clinks off steel exactly as today.

## 2. Key Decisions

1. **Carry the firer's `canBreakSteel` onto the bullet (read at fire time, not hit time).**
   `acquire(owner, …)` already has the firing `Tank`; the Tank stores its full `spec`
   (`this.spec`, `tanks.ts` `TankSpec.canBreakSteel?`). Add one boolean to `BulletContext`
   and set it from `owner.spec.canBreakSteel === true` in `acquire`. The hit site then
   reads a plain bullet flag — it never re-derives star tier or reaches back into the Tank
   (which may already be dead by the deferred destroy). KISS/DRY: the spec is the single
   source of the flag; the bullet snapshots it like it already snapshots `ownerSide`.

2. **Mirror the brick-chip discipline, whole-tile.** Add `TileMap.destroySteelTile(col,row)`
   shaped exactly like `destroyBrickSubCell` (idempotent, removes the rect+body from
   `solidBodies` via `remove(rect, true, true)`), but matching the WHOLE-tile STEEL body
   (one `_addSolidTile` rect per steel tile, not four sub-cells). It also drops the steel's
   bodiless bevel/rivet decoration rects so no orphan decor lingers (those live in
   `_objects`, tagged with `tileCol/tileRow`). YAGNI: no partial-steel, no HP-on-steel.

3. **DEFER the destroy out of the overlap step (the footgun discipline, D1/AC10).** Like
   the brick branch, capture `tileCol/tileRow` NOW and run
   `time.delayedCall(0, () => tileMap.destroySteelTile(col,row))` so no Arcade body is
   destroyed inside `world.step` iteration. The bullet still despawns immediately
   (`bullets.release` already runs in the shared BRICK/STEEL tail).

4. **Effect: reuse the existing `effects.explosion(x,y)` impact spark.** It already fires in
   the shared BRICK/STEEL tail. For a break we additionally play the existing brick-break
   crunch (`sfx.brickHit()`) instead of the metallic clink, signalling "this one broke". No
   new effect primitive (KISS) — the whole-tile spark + crunch reads as a break.

5. **Gate strictly on `bx.canBreakSteel`.** The STEEL branch destroys ONLY when the struck
   bullet carries the flag; otherwise it keeps the current clink-and-despawn. Enemy/boss
   specs never set `canBreakSteel`, sub-tier players fold it to `undefined` → `false`.

## 3. Files to touch

- **`src/combat/BulletPool.ts`** —
  - Add `canBreakSteel: boolean` to `BulletContext` (init `false` in the ctor's `bx`).
  - In `acquire`, set `bx.canBreakSteel = owner.spec.canBreakSteel === true`.
  - In `_disable`, reset `bx.canBreakSteel = false` (park clean, like `vx/vy`).
  Phaser-coupled file (already imports Phaser) — no purity concern.

- **`src/scenes/GameScene.ts`** — in `_onBulletHitSolid`, the STEEL branch (currently the
  `// STEEL: NO terrain change` no-op after the shared spark/release tail): when
  `kind === TILE.STEEL && bulletRect.bx.canBreakSteel`, capture `solidRect.tileCol/tileRow`
  and `time.delayedCall(0, () => this.tileMap.destroySteelTile(col,row))`. Swap the sfx so a
  BREAK plays `sfx.brickHit()` (the crunch) and a non-break steel still plays
  `sfx.steelClink()`. (The shared `effects.explosion` + `bullets.release` stay as-is.)

- **`src/world/TileMap.ts`** — add `destroySteelTile(col,row)` next to `destroyBrickSubCell`:
  find the whole-tile STEEL rect in `solidBodies` by `(tileCol,tileRow)` + `tileKind===STEEL`,
  `solidBodies.remove(rect, true, true)`, and remove the matching bevel/rivet decoration rects
  from `_objects` (destroy them). Idempotent (a missing tile is a no-op — a same-tile double
  overlap is safe). Phaser-coupled (lives in `world/TileMap.ts`, the allowed seam).

No change to any PURE module: `tanks.ts` already carries the flag (no edit), and the bullet
reads it off the already-built spec. The pure/coupled split is untouched.

## 4. Acceptance criteria

1. A tier-3 player's bullet hitting STEEL destroys that whole steel tile (rect + body +
   bevel/rivet decor gone), the shot despawns, and a break spark + crunch plays.
2. A tier 0/1/2 player's bullet hitting STEEL does NOT destroy it (clink + despawn, as today).
3. An ENEMY or BOSS bullet hitting STEEL never destroys it (their specs omit `canBreakSteel`).
4. `destroySteelTile` is idempotent — a second overlap on the same (already-gone) tile is a
   no-op (no throw, mirroring `destroyBrickSubCell`).
5. The destroy is DEFERRED via `delayedCall(0)`; no Arcade body is destroyed inside the
   bullet×terrain overlap step (no stale-iteration crash on a multi-steel frame).
6. Brick erosion, the eagle hit, water pass-over, and bullet×tank are all unchanged.
7. `npm run typecheck`, `npm run verify`, and `npm run build` all stay green.

## 5. How `npm run verify` stays green

- The verifier node-imports only the PURE modules (`config/*`, `world/LevelGenerator.ts`,
  `util/*`). This feature edits ONLY Phaser-coupled files (`BulletPool.ts`, `GameScene.ts`,
  `world/TileMap.ts`) — none of which the verifier imports — so the pure/coupled enclosure
  is untouched. We add NO Phaser import to any pure file.
- The `tanks.ts` `applyStarTier` monotonicity / identity-fold checks already pass and are
  NOT modified (the flag is pre-existing data). No determinism/monotonicity gate moves.
- `destroySteelTile` performs no RNG and no stage generation, so the
  determinism/procedural-stage gate is unaffected.

## 6. i18n keys to add

NONE. Steel-break is a pure gameplay/feel mechanic with NO new user-facing text (no HUD
label, menu entry, or banner). It surfaces only as terrain destruction + the existing spark
and the existing `sfx.brickHit()` crunch. So `src/i18n/en.ts` / `zh-CN.ts` need no change.
(If a later feature adds a "STEEL BREAK" pickup label, that string — and only then — is added
to BOTH locale files via `t()`.)

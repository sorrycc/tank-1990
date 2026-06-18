# Tank Playfield Bounds — Keep Tanks Inside the Scene

## 1. Background

Both player and enemy tanks can currently drive straight out of the centered
13×13 playfield into the surrounding empty canvas — nothing physically stops a
tank at the playfield edge. This is a clear gameplay bug ("tank should not move
out of the scene").

The cause is a stale assumption left over from the F1 milestone: `Tank` opts its
Arcade body OUT of world-bounds collision (`setCollideWorldBounds(false)`,
`Tank.ts:160`) with a comment claiming "the test arena's STEEL walls (static
bodies) bound it". That test arena existed only in F1. F2 replaced it with the
procedural `LevelGenerator`, which never places border walls — the grid edge is
treated as a "wall" only conceptually by the headless verifier's enclosure BFS.
No physical Arcade body exists at the playfield boundary, and no
`physics.world.setBounds(...)` is ever called, so the tank body is free to leave.

## 2. Requirements Summary

- **Goal:** Tanks must not be able to drive out of the 13×13 playfield.
- **Scope:** All tanks — player 1/2, every enemy archetype, and the boss. They
  are all the same `Tank` class, so one fix covers every side (DRY). The boundary
  is invisible (the playfield already draws an outline rect; no new visuals —
  YAGNI). Bullets are out of scope: they are already correctly bounded and
  decoupled from this change.
- **Key decisions:** Use Arcade world bounds set to the playfield rectangle and
  opt the tank body into world-bounds collision. No new GameObjects, no manual
  per-frame clamp.

## 3. Acceptance Criteria

1. A player tank driving toward any of the four playfield edges stops at the
   inner edge and cannot exit the 624×624 playfield.
2. Enemy tanks and the boss are bounded identically (same `Tank` body fix).
3. Bullet travel and despawn behavior are unchanged — a bullet still flies over
   the playfield and despawns when fully past the `PLAYFIELD_*` rectangle.
4. Within-playfield movement is behavior-preserving: the no-diagonal grid drive,
   the turn-time cross-axis lane re-center, and terrain/eagle collision are all
   unchanged.
5. `npm run typecheck` passes and no other physics body is unintentionally
   constrained by the new world bounds.

## 4. Problem Analysis

- **Approach A — Border-wall static bodies** (re-create the F1 test arena's four
  STEEL walls around the playfield, in `TileMap` or `GameScene`) -> rejected.
  Adds four bodies that must be built and torn down on every stage rebuild, and
  risks blocking the edge-row enemy spawns (anchored at col 0 / row 0). More code
  and more lifecycle for no extra benefit over world bounds.
- **Approach B — Per-frame position clamp** (clamp `body.x/y` to the playfield in
  `Tank.update`) -> rejected. Re-implements by hand exactly what Arcade's
  world-bounds clamp already does, and adds branching to the hot movement path.
- **Chosen approach — Arcade world bounds** -> set the physics world bounds to the
  playfield rectangle once, and flip the tank body to `collideWorldBounds = true`.
  Reuses the existing `PLAYFIELD_*` constants (DRY), adds zero GameObjects, needs
  no per-stage teardown, and Arcade does the clamping. Smallest correct change.

## 5. Decision Log

**1. How to bound the tanks (world bounds vs. wall bodies vs. manual clamp)?**
- Options: A) Arcade world bounds · B) four STEEL border-wall static bodies ·
  C) per-frame position clamp in `Tank.update`
- Decision: **A)** — KISS/DRY/YAGNI: one `world.setBounds` call plus flipping one
  flag, reusing existing constants; no new objects, no per-stage lifecycle, no hot
  path branching. B and C add complexity for no benefit.

**2. Where to set the world bounds?**
- Options: A) once in `GameScene.create()` · B) in `_buildStage()` every stage ·
  C) in `main.ts` global physics config
- Decision: **A)** — the Arcade world persists across the in-place stage rebuild
  (`_buildStage` rebuilds tiles/tanks, not the world), so setting bounds once in
  `create()` is correct and DRY. B would redundantly re-set identical bounds each
  stage; C cannot (world bounds are per-scene and only GameScene runs a physics
  world with gameplay bodies).

**3. Should bullets also be constrained by the new bounds?**
- Options: A) leave bullets as-is (manual `PLAYFIELD_*` despawn) ·
  B) switch bullets to world-bounds collision too
- Decision: **A)** — bullets never set `collideWorldBounds`, so the new world
  bounds do not affect them; they keep their own manual despawn check
  (`BulletPool.tick`, `BulletPool.ts:144-150`) and park off-field at
  `(-1000,-1000)` when disabled. Touching bullets would be scope creep and could
  break the off-field parking (YAGNI).

**4. Visible border walls or invisible boundary?**
- Options: A) invisible boundary only · B) draw visible border walls
- Decision: **A)** — the playfield already has a drawn outline rect; the bug is
  purely physical, so only the collision needs fixing. Visible walls are a visual
  change nobody asked for (YAGNI).

## 6. Design

Two edits, both behavior-additive for the in-bounds case.

### 6.1 GameScene — set the world bounds to the playfield

In `GameScene.create()`, alongside the existing playfield-outline draw, set the
Arcade world bounds to the playfield rectangle:

```ts
// Bound the Arcade world to the playfield so tanks (collideWorldBounds) stop at
// its edges. Bullets are unaffected — they never opt into world bounds and keep
// their own PLAYFIELD_* despawn check. Set once; the world persists across the
// in-place stage rebuild (_buildStage rebuilds bodies, not the world).
this.physics.world.setBounds(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)
```

`PLAYFIELD_X/Y/W/H` are already imported in `GameScene.ts`.

### 6.2 Tank — opt the body into world-bounds collision

In the `Tank` constructor, flip line 160 from `false` to `true` and replace the
stale "test arena STEEL walls" comment with the real reason. Keep the comment to
the world-bounds reason only — do NOT re-assert that "internal walls bound it"
(that was the stale comment's framing used to justify `false`; repeating it would
let a future reader re-derive the old wrong conclusion):

```ts
// The Arcade world bounds are set to the playfield rectangle (GameScene.create),
// so opting the body in here makes a tank stop at the playfield edges — it can
// no longer drive out of the scene. (Was `false` with a stale F1 comment about a
// "test arena" of steel border walls that the procedural generator never builds.)
this.body.setCollideWorldBounds(true)
```

### 6.3 Why this is isolated and safe

- **Only tanks opt in.** A repo-wide grep shows `setCollideWorldBounds` appears
  only at `Tank.ts:160`. After the change, tanks are the only bodies with
  `collideWorldBounds = true`, so `world.setBounds` clamps nothing else.
- **Bullets unaffected.** `BulletPool` members are physics-group bodies but never
  set `collideWorldBounds`; world bounds ignore them. Their manual despawn and
  off-field parking are untouched.
- **Spawns fit.** Every spawn window-center sits inside the bounds (top/left edge
  windows put the 92px body's near edge ~2px inside the playfield; right/bottom
  windows ~2px inside the far edge), so enabling world bounds never displaces a
  spawn.
- **Turn-snap unaffected.** `Tank._recenterCross` writes `body.position[cross]`
  only to lane targets inside the grid; even a hypothetical out-of-bounds write
  would be re-clamped by Arcade on the next step. No conflict.
- **Edge `blocked` is intended, not a surprise.** A tank pinned against a
  world-bound edge reports `body.blocked.{left,right,up,down}` on that axis — the
  exact signal the enemy AI's blocked-axis re-decide (`Tank.updateAI`) and the
  turn-snap collision guard already consume. This is a *feature*: enemies now turn
  at the playfield edge instead of grinding into invisible nothing, and it is
  behavior-preserving for AC4 because those paths already handle `blocked`.

## 7. Files Changed

- `src/scenes/GameScene.ts` — add one `physics.world.setBounds(...)` call in
  `create()` to fence the world to the playfield rectangle.
- `src/entities/Tank.ts` — flip `setCollideWorldBounds(false)` to `true` and
  update the stale F1 comment to describe the world-bounds fence.

## 8. Verification

1. [AC1] Run the game (`npm run dev`), drive P1 into the top, bottom, left, and
   right playfield edges — the tank stops at each inner edge and cannot leave.
2. [AC2] Let enemies/boss roam to the edges (or drive P2 there) — they stop at
   the edges too.
3. [AC3] Fire toward an edge — the bullet still flies and despawns at the
   playfield bound exactly as before (no early stop, no pass-through change).
4. [AC4] Within the field: turning between cardinals still snaps to lanes, no
   diagonal drift, and tanks still collide with brick/steel/water/the eagle.
5. [AC5] `npm run typecheck` passes. Grep confirms only `Tank.ts` sets
   `collideWorldBounds`, so no other body is constrained.

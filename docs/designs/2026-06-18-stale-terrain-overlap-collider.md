# Fix: stale bullet×terrain overlap collider crashes on stage advance

## 1. Background

On every stage advance the game throws:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'size')
    at StaticPhysicsGroup.getLength (phaser.js)
    at World.collideGroupVsGroup (phaser.js)
    at World.collideHandler / collideObjects / Collider.update / World.update
```

The crash fires inside Phaser's Arcade `world.step`, on the first frame after a stage
teardown. It is a hard, uncaught error — the run dies the moment a stage is cleared.

## 2. Requirements Summary

- **Goal:** Eliminate the crash so a stage advance (and any teardown) is clean.
- **Scope:** `src/scenes/GameScene.ts` only. No gameplay/behavior change.
- **Constraint:** Keep the existing per-stage rebuild model (`TileMap` is recreated each
  stage); do not refactor group ownership.

## 3. Acceptance Criteria

1. Clearing a stage (stage advance) no longer throws; the next stage runs normally.
2. The stale `bullets.group × solidBodies` overlap collider is destroyed during
   `_teardownStage()`, and a fresh one is registered by the rebuilt stage.
3. No overlap-collider leak accumulates across N stage advances — exactly one
   bullet×terrain overlap is active at any time.
4. Bullet×brick / bullet×steel / bullet×eagle behavior within a stage is unchanged.
5. `npm run typecheck` passes.

## 4. Problem Analysis

### Mechanism (verified against `node_modules/phaser/dist/phaser.js`)

`_buildStage()` registers the bullet×terrain overlap (`GameScene.ts:306`):

```js
this.physics.add.overlap(this.bullets.group, this.tileMap.solidBodies, ...)
```

This is a **group-vs-group** collider with a lifetime mismatch:

- `bullets.group` is **run-scoped** — the `BulletPool` is created once and survives every
  stage teardown (`_teardownStage()` only `releaseAll()`s in-flight bullets, never
  destroys the pool).
- `tileMap.solidBodies` is **stage-scoped** — `_teardownStage()` → `tileMap.destroy()`
  calls `solidBodies.destroy(true)` (`TileMap.ts:283`), which sets the group's
  `children` to `null`.

Phaser removes an Arcade collider **only** through `Collider.destroy()`
(`phaser.js` — `this.world.removeCollider(this)`). It never auto-removes a collider when
one of its referenced groups is destroyed. So the overlap survives teardown pointing at a
dead group. On the next `world.step`:

`collideGroupVsGroup(bullets.group, solidBodies)` → `solidBodies.getLength()` →
`return this.children.size` → `children` is `null` → **TypeError**.

### Why the sibling colliders do NOT crash

Phaser's `collideHandler` dispatches by inspecting each object
(`phaser.js` — `collideHandler`):

- **Tank terrain colliders** are *sprite-vs-group* (`collider(tank.collider, solidBodies)`).
  Teardown destroys the sprite (`tank.collider.destroy()`), so `object1.body === null`,
  the object is not `isParent`/`isTilemap`, and `collideHandler` **falls through
  harmlessly** before any `getLength()` call.
- **Bullet×tank overlaps** are *group-vs-sprite* — the tank sprite (object2) is destroyed,
  so it likewise falls through.
- The **bullet×terrain overlap** is the only collider whose surviving side
  (`bullets.group`) is `isParent` **and** whose dead side (`solidBodies`) is still a Group
  object (`isParent` true, `children` null). That combination is the one path routed into
  the unguarded `collideGroupVsGroup` — hence it is the only one in the stack trace.

### Approaches evaluated

- **Approach A — capture the `Collider` handle, destroy it in `_teardownStage()`** ->
  one field + one assignment + one destroy call. Symmetric with how tank GameObjects are
  torn down (destroy the owner of the binding). Zero behavior change. **Chosen.**
- **Approach B — make `solidBodies` run-scoped and `clear(true,true)` instead of
  `destroy()`** -> requires moving group ownership out of `TileMap` (which is recreated
  per stage), touching `TileMap` construction/teardown and every `tileMap.solidBodies`
  consumer. Larger blast radius for no extra benefit. Rejected (YAGNI).
- **Approach C — re-target the existing overlap's `object2` each stage** -> Phaser has no
  clean public API to swap a collider's object; relies on internals. Rejected.

## 5. Decision Log

**1. How to stop the leaked overlap from running against a dead group?**

- Options: A) store the `Collider` handle and `destroy()` it on teardown · B) make
  `solidBodies` persistent and `clear()` it · C) re-target the collider
- Decision: **A)** — minimal, symmetric with the existing GameObject teardown discipline,
  no `TileMap` ownership refactor, no Phaser-internal reliance.

**2. Where does the destroy live — `_teardownStage()` or `TileMap.destroy()`?**

- Options: A) `_teardownStage()` (GameScene) · B) `TileMap.destroy()`
- Decision: **A)** — the overlap binds `bullets.group`, which is a `GameScene`-owned,
  run-scoped resource that `TileMap` has no reference to. The scene owns the overlap, so
  the scene destroys it. Place it next to the existing `tileMap.destroy()` call.

**3. Guard for first build (no prior overlap) and idempotency?**

- Options: A) optional-chain `this._bulletTerrainOverlap?.destroy()` · B) explicit
  null-check block
- Decision: **A)** — the first `_buildStage()` (from `create()`) runs with the field
  `undefined`; the optional chain no-ops. Every later teardown destroys the prior overlap
  before the rebuild assigns a new one. Reassigning the field in `_buildStage()` keeps a
  single source of truth.

## 6. Design

Add one private field to `GameScene`:

```ts
// The run-scoped × stage-scoped bullet×terrain overlap (bullets.group survives teardown;
// solidBodies does not). Held so _teardownStage() can destroy it before tileMap.destroy()
// nulls solidBodies.children — otherwise the stale collider crashes collideGroupVsGroup.
private _bulletTerrainOverlap?: Phaser.Physics.Arcade.Collider
```

In `_buildStage()`, capture the handle when registering the overlap (line ~306):

```ts
this._bulletTerrainOverlap = this.physics.add.overlap(
  this.bullets.group,
  this.tileMap.solidBodies,
  (bulletRect, solidRect) => this._onBulletHitSolid(bulletRect as BulletRect, solidRect as SolidRect),
  (bulletRect) => !this.gameOver && !this.transitioning && (bulletRect as BulletRect).bx.active,
  this,
)
```

In `_teardownStage()`, destroy the overlap **before** `tileMap.destroy()` (order is not
strictly required since destroy just unregisters the collider, but doing it alongside the
tilemap teardown keeps the lifetime story local):

```ts
this._bulletTerrainOverlap?.destroy() // drop the run-scoped × stage-scoped overlap before
this._bulletTerrainOverlap = undefined // solidBodies dies — else it crashes collideGroupVsGroup.
this.tileMap.destroy()
```

### Error handling / edge cases

- **First build:** field is `undefined`; `?.destroy()` no-ops.
- **Game-over path (not a teardown):** `_triggerGameOver()` calls `scene.start('GameOver')`
  and never runs `_teardownStage()` / `tileMap.destroy()`. On scene shutdown Phaser tears
  down the whole physics world (overlap **and** `solidBodies` together), so no stale-group
  window opens there. The only path that destroys `solidBodies` while `bullets.group`
  survives is the stage-advance teardown — exactly what this fix targets.
- **Double-destroy:** field is set back to `undefined` after destroy, so a second teardown
  before a rebuild is also a no-op.

## 7. Files Changed

- `src/scenes/GameScene.ts` — add `_bulletTerrainOverlap` field; capture the overlap
  handle in `_buildStage()`; destroy it in `_teardownStage()`.

## 8. Verification

1. [AC1] `npm run dev`, clear stage 1 (destroy all enemies / let it advance) — the game
   advances to stage 2 with no console error.
2. [AC2] The overlap is reassigned each `_buildStage()` and destroyed each
   `_teardownStage()` — confirmed by code inspection + no crash across an advance.
3. [AC3] Advance through several stages — only one bullet×terrain overlap exists at a time
   (each teardown destroys the prior before the rebuild creates the next).
4. [AC4] Within a stage, shoot brick (chips), steel (bullet despawns), and the eagle
   (game over) — unchanged.
5. [AC5] `npm run typecheck` exits clean.

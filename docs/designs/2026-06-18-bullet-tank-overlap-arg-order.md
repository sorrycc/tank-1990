# Fix bullet×tank overlap argument-order crash

## 1. Background

`GameScene._bulletCanHitTank` throws on the first bullet-vs-tank overlap:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'active')
    at GameScene._bulletCanHitTank (GameScene.ts:553:13)
    at GameScene.<anonymous> (GameScene.ts:331:38)
```

Line 553 reads `bx.active` where `bx = bulletRect.bx`. The crash means `bulletRect.bx` is
`undefined` — i.e. the object bound to `bulletRect` is not a bullet at all.

## 2. Requirements Summary

- Goal: bullet↔tank collisions resolve without throwing, with friendly-fire / i-frame /
  dead-tank / stale-bullet filtering preserved exactly as designed (F3 §5.3, D7/D8, AC5/AC9).
- Scope: the closure parameter binding in `_registerTankOverlap` only. No change to the
  `_bulletCanHitTank` / `_onBulletHitTank` internal signatures, nor to the terrain or
  power-up overlaps.
- This single fix repairs hit-detection for BOTH players and enemy tanks — both register
  their bullet×tank overlap through `_registerTankOverlap` (GameScene.ts:296/661 → 326).

## 3. Acceptance Criteria

1. A bullet overlapping an opposing tank no longer throws `TypeError: …reading 'active'`.
2. A player bullet damages/destroys an opposing enemy tank (the hit funnel runs through
   `_onBulletHitTank` → `tank.onHit`).
3. Friendly-fire filter intact: a same-side bullet passes through an ally with no damage and
   no despawn (FRIENDLY_FIRE off).
4. i-frame / dead-tank / stale-bullet guards still gate hits correctly
   (`isHittable()` + `bx.active`).
5. `npm run typecheck`, `npm run verify`, and `npm run build` all pass.

## 4. Problem Analysis

The overlap is registered as `overlap(this.bullets.group, tank.collider, …)` (GROUP first,
SPRITE second) with callbacks written `(bulletRect, tankRect) => …`. The assumption: arg1 is
the group member (bullet), arg2 is the sprite (tank). That assumption is wrong for a
group-vs-sprite pair.

Verified against `node_modules/phaser/src/physics/arcade/World.js` (Phaser 3.90):

- `collideHandler` (lines 1967–1971): when object1 is a group (`isParent`) and object2 is a
  sprite (`body`), it calls `collideSpriteVsGroup(object2 /* sprite */, object1 /* group */, …)`
  — sprite first, group second, regardless of the order passed to `overlap()`.
- `collideSpriteVsGroup` (lines 2115 / 2142): always invokes the COLLIDE callback as
  `callback(bodyA.gameObject /* sprite */, bodyB.gameObject /* group member */)`.
- `separate` (line 1400): fires the PROCESS callback as
  `processCallback(body1.gameObject, body2.gameObject)` in the SAME `(sprite, member)` order.
  This is the load-bearing line for this crash: `_bulletCanHitTank` is the PROCESS callback
  (it runs BEFORE the collide callback), so both closures must be swapped — and the fix swaps
  both.

So both the collide and process callbacks receive `(tankCollider, bullet)`. The code binds
them as `(bulletRect, tankRect)`, so `bulletRect` is actually the tank collider — which has no
`.bx` → `bulletRect.bx.active` throws.

Why only this call site:

- **Approach used by bullet×terrain (line 271)** — `overlap(bullets.group, solidBodies)` is
  GROUP-vs-GROUP. Phaser's `collideGroupVsGroup` iterates object1's children, so the callback
  gets `(bulletChild, solidChild)` — arg1 is the bullet. Correct; not affected.
- **Approach used by player×power-up (line 370)** — `overlap(tank.collider, powerups.group)` is
  SPRITE-vs-GROUP. Callback gets `(sprite, member)` = `(tank, pu)`; the code reads
  `(_tankRect, puRect)`. Correct; this is the convention the fix follows.
- **The bullet×tank site (line 327)** is the lone GROUP-vs-SPRITE call where `tank.collider` is
  a single sprite, so Phaser swaps and the existing `(bulletRect, tankRect)` binding is inverted.

## 5. Decision Log

**1. How to correct the binding**
- Options:
  A) Swap the closure params to `(tankRect, bulletRect)` and document the Phaser invariant ·
  B) Order-independent detection — sniff which arg carries `.bx` at runtime ·
  C) Add `if (!bx) return false` guard to swallow the crash
- Decision: **A)** — KISS/DRY. It matches the already-correct sprite-vs-group power-up call
  site (line 370), adds zero hot-path branching, and a comment pins the Phaser invariant so it
  cannot silently regress. B) adds per-overlap branching and hides the real invariant; C) masks
  the crash but leaves every hit a silent no-op (combat stays broken) — rejected.

**2. Where the swap lives**
- Options: A) at the registration closure in `_registerTankOverlap` · B) inside
  `_bulletCanHitTank` / `_onBulletHitTank`
- Decision: **A)** — keep the two handler signatures `(bulletRect, tankRect)` untouched so
  their bodies and call-order read naturally; the closure is the single place that knows the
  Phaser arg order, so it is the single place to bind it.

## 6. Design

In `_registerTankOverlap`, bind the callback arguments in Phaser's actual sprite-vs-group
order — sprite (tank collider) first, group member (bullet) second — then pass them into the
unchanged handlers in their expected order:

```ts
private _registerTankOverlap(tank: Tank): void {
  this.physics.add.overlap(
    this.bullets.group,
    tank.collider,
    // Phaser invokes a sprite-vs-group overlap callback as (sprite, groupMember) — World.collideHandler
    // swaps a group/sprite pair into collideSpriteVsGroup(sprite, group), which calls back
    // (bodyA=sprite, bodyB=member). tank.collider is the SPRITE, the bullet is the GROUP member, so the
    // tank collider is arg1 and the bullet is arg2 — the inverse of the group-vs-group terrain overlap
    // above (where bullets.group is object1, so the bullet is arg1). Mirrors the power-up sprite-vs-group
    // binding in _registerPowerUpOverlap.
    (tankRect, bulletRect) => this._onBulletHitTank(bulletRect as BulletRect, tankRect as TankCollider),
    (tankRect, bulletRect) => this._bulletCanHitTank(bulletRect as BulletRect, tankRect as TankCollider),
    this,
  )
}
```

`_bulletCanHitTank` and `_onBulletHitTank` are unchanged: they still receive
`(bulletRect: BulletRect, tankRect: TankCollider)` and their existing `bx.active` / `tankRef` /
`isHittable()` / FRIENDLY_FIRE logic now operates on the correct objects.

## 7. Files Changed

- `src/scenes/GameScene.ts` — swap the two closure parameter names in `_registerTankOverlap` to
  `(tankRect, bulletRect)` and add a comment documenting Phaser's sprite-vs-group callback order.

## 8. Verification

1. [AC1] `npm run dev`, fire at an enemy tank — no `TypeError` in the console on contact.
2. [AC2] A player bullet on contact destroys/damages an enemy (explosion + HP/death path runs).
3. [AC3] With FRIENDLY_FIRE off, an ally-aimed shot passes through a same-side tank (no hit).
4. [AC4] A shot at a just-respawned (i-frame) or dead tank does not register (filter returns false).
5. [AC5] `npm run typecheck && npm run verify && npm run build` all pass.

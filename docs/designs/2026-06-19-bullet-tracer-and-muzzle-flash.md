# Tank 1990 — Bullet travel tracer + muzzle-flash on fire

> A focused JUICE micro-pass over the finished Tank 1990 (a faithful Battle City / 坦克大战 clone), in
> the F7 "rich playability" spirit. It is the LOWEST-priority of the three polish beats — pure
> cosmetics on top of already-solid impact FX (F3 `Effects` + F8 blooms). No gameplay/collision change,
> no new pool, no new asset, and the verifier path (`config/*` + `world/LevelGenerator.ts`) is untouched
> (`combat/BulletPool.ts` + `effects/*` are NEVER verifier-imported). Governing conventions: KISS,
> YAGNI, DRY, SOLID.

---

## 1. Problem

Two flat spots in the firing feel:

- **Bullets read as static dots.** Every pooled bullet is the SAME 8×8 light-khaki square
  (`combat/BulletPool.ts`). A POWER/boss bolt's distinguishing stat is its HIGHER `bulletSpeed`, but a
  fast square that looks identical to a slow one is hard to perceive as moving — the speed difference
  (a real per-tank stat since F4) is visually lost.
- **Firing has no kick.** A successful shot pops a bullet into the world with NO feedback at the
  muzzle. Impacts already crunch (sparks + bloom + shake via `Effects.explosion`), but the moment of
  FIRING is inert.

This is the classic "tracer + muzzle spark" juice beat. It reuses the existing pooled spark primitive
(`ParticlePool.spawnSparks`, via the `Effects` façade) — no new pool, no asset.

---

## 2. Decisions

1. **The tracer is a cosmetic shape tweak on the EXISTING pooled rect — no body/size/collision change.**
   `BulletPool.acquire` already orients each bullet along exactly one cardinal (`vx`/`vy`). We ELONGATE
   the visible rect along its travel axis (a long thin streak: long on the travel axis, the normal 8px
   on the cross axis) and give it a slightly brighter tint than the resting khaki, so a moving bolt
   reads as a streak, not a dot — and a faster bolt's streak is the same length but covers more ground
   per frame, which is exactly the "this one is faster" cue. The ARCADE BODY stays the fixed 8×8
   (`body.setSize` is never called) — only `rect.setSize`/`setFillStyle` change, so every collision
   (bullet×tank, bullet×terrain, bullet×bullet) is byte-identical. KISS — `setSize` + `setFillStyle` on
   acquire; YAGNI — no trailing-segment second GameObject, no per-frame alpha gradient (a single
   elongated bright rect is enough to read as motion); DRY — reuses the `vx`/`vy` the muzzle switch
   already computed to pick the axis.

2. **The muzzle flash is a tiny `Effects.spawnSparks` cue at the muzzle — reusing the spark pool.** A
   new `Effects.muzzleFlash(x, y)` pops a SMALL cool/white spark burst (count ~3) at the muzzle point
   via the existing `ParticlePool.spawnSparks` (the same no-alloc pooled primitive the impacts use —
   DRY). It is distinct from `explosion()` (which adds a bloom + camera shake — too heavy for a shot;
   firing fires many times a second, a shake per shot would be nauseating). NO shake, NO bloom — just a
   few sparks. The cool/white colour distinguishes it from the warm-yellow impact spark.

3. **The cue is called ONCE per shot, behind the existing `tryFire` boolean.** All three fire sites in
   `GameScene` already gate sound on `tryFire(...)` returning `true` (a shot actually fired, not a
   cooldown/cap no-op). The muzzle flash piggybacks on that SAME boolean at the SAME three sites, so it
   fires exactly once per real shot. The muzzle point is the tank's `body.center` offset a few px along
   its `facing` (the same standoff idea `BulletPool` uses for the bullet spawn) so the spark sits at the
   gun mouth, not the tank center. A small private `GameScene._muzzleFlash(tank)` computes the offset
   from `tank.facing` + `tank.body.center` (DRY — one helper, three call sites).

---

## 3. Per-file changes

- **`src/combat/BulletPool.ts` (CHANGED; Phaser-coupled, NEVER verifier-imported):** add a
  `BULLET_TRACER_LEN` constant (the streak length along travel) + a brighter `BULLET_TRACER_COLOR`. In
  `acquire`, after the facing switch computes `vx`/`vy`, set the rect's VISIBLE size to a streak
  oriented along the travel axis (`rect.setSize(...)`) + the brighter tint (`rect.setFillStyle(...)`).
  The Arcade BODY size is left at the fixed 8×8 (never resized) — comment updated to call out that the
  visible streak is purely cosmetic and the collision body is unchanged. `_disable` already parks the
  rect; no reset of the visible size is needed (acquire always re-sets it before the rect is shown).

- **`src/effects/Effects.ts` (CHANGED; Phaser-coupled, NEVER verifier-imported):** add
  `muzzleFlash(x, y)` — a small cool/white spark burst via `this.pool.spawnSparks` (count ~3, a slower
  speed than an impact, a cool colour). NO bloom, NO shake (a shot is not an impact). One new façade
  method beside `explosion`/`spawnShield`/`scorePopup`.

- **`src/scenes/GameScene.ts` (CHANGED):** add a tiny private `_muzzleFlash(tank)` that computes the
  muzzle point (`tank.body.center` offset along `tank.facing`) and calls `this.effects.muzzleFlash(...)`.
  Call it at the THREE fire sites, behind the SAME `tryFire(...)` boolean the `sfx.fire()` cue already
  uses: P1 (`update`), P2 (`update`), enemies (`_tickEnemies`).

No other files change. No i18n keys (the cue is purely visual — no text). No constants.ts change (the
tracer length/colour + the muzzle offset are render-only locals owned by their one file, like the
existing `BULLET_W`/`SPARK_COLOR`/`SHAKE_MS` locals — they are NOT shared numbers, so per the DRY rule
they stay out of the verifier-imported `constants.ts`).

---

## 4. Verification

- **typecheck / build / verify all green.** The change is confined to `combat/BulletPool.ts`,
  `effects/Effects.ts`, and `scenes/GameScene.ts` — none verifier-imported, so `npm run verify` is
  UNAFFECTED (no PIN re-compute, no new assertion: the generator + configs are byte-untouched). `npm run
  typecheck` + `npm run build` exit 0.
- **No collision regression (by construction).** The Arcade body size is never changed (`body.setSize`
  is not called) — only `rect.setSize`/`setFillStyle` (the VISIBLE rect). Every bullet collision path
  reads the body, so the tracer cannot alter bullet×tank / bullet×terrain / bullet×bullet resolution.
- **Manual `npm run dev` drive:** fire a shot → a short cool muzzle spark pops at the gun mouth; the
  bullet reads as a moving streak (a POWER/boss bolt's streak visibly covers more ground per frame than
  a base shot). A blocked shot (cooldown / live-cap) pops NO muzzle flash (the `tryFire` boolean gates
  it). Programmer-art primitives only — runs offline.

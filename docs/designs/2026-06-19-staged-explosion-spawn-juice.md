# Tank 1990 — Staged expanding kill explosion + spawn-in materialize cue

> A small, focused JUICE pass on the two most-repeated moments in the run — every KILL and every
> SPAWN — entirely inside the existing pooled-effects façade (`effects/ParticlePool.ts` +
> `effects/Effects.ts`) plus one line per GameScene spawn site. NO new subsystem, NO new asset, NO
> change to the pure/coupled split or the verifier. Format mirrors the F7 rich-playability doc.

---

## 1. Background

Every kill currently fires the SAME generic yellow spark burst (`effects.explosion(x, y, {big})` →
`pool.spawnSparks`) and every spawn is just a flat alpha-blink (the `SPAWN_BLINK_TIME` i-frame the
tank renders during). Yet these are the two highest-FREQUENCY beats in a run — a stage streams 20
enemies in and the player blasts most of them. Battle City's signature feel is its multi-frame
EXPANDING explosion (a small flash growing into a big bloom, then fading) plus the star MATERIALIZE
before a tank appears. Tank 1990 has the spark debris (the arc-down sparks) but NOT the bloom flash,
and no spawn cue beyond the alpha-blink the tank already does.

Adding both to the EXISTING pooled-effects façade is the single highest-frequency juice win and it
touches NOTHING structural: the pool already owns a fixed Float32Array-backed slot pool, a
rotating free-slot cursor, a REAL-dt tick, and the no-per-frame-allocation discipline. A bloom is
just one more pooled rect kind that grows + fades over the SAME tick; a spawn shield is the SAME
bloom played in reverse (a contracting ring). The single `effects.explosion` kill call site upgrades
for FREE (the bloom is added INSIDE `explosion`), and each spawn site gets ONE `effects.spawnShield`
call.

**Conventions mirrored from the existing pool:** the FIXED pool pre-created once in the ctor; flat
parallel `Float32Array` lifetime state (no per-bloom object in the hot path); a rotating free-slot
cursor that recycles the oldest on exhaustion (never allocates mid-combat); the REAL-dt `tick` (the
freeze stops the WORLD, never the FX); programmer-art rectangle primitives ONLY (no `load.image`).
Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Upgrade the KILL and SPAWN beats with pooled programmer-art rect FX, inside the effects
façade, with no new allocation and no change to the pure/coupled split.

**In scope:**

- **`src/effects/ParticlePool.ts` (CHANGED, Phaser-coupled):** ADD a small FIXED pool of BLOOM
  rectangles (their own parallel `Float32Array` lifetime state + a rotating cursor, the SAME shape as
  the spark pool) and `spawnBloom(x, y, { big })` — grows a bright square from a small flash to a
  bigger bloom and fades over ~0.25 s, NO per-frame allocation. The existing `tick(dt)` advances them
  on REAL dt alongside the sparks + numbers.
- **`src/effects/Effects.ts` (CHANGED, Phaser-coupled):** `explosion(x, y, { big })` ALSO calls
  `pool.spawnBloom(x, y, { big })` (bigger/longer when `big`) so the ONE kill call site upgrades for
  free. ADD `spawnShield(x, y, duration)` — a CONTRACTING ring cue (a bloom-rect played inward) for
  the spawn-in materialize.
- **`src/scenes/GameScene.ts` (CHANGED):** ONE `effects.spawnShield(...)` call at each of the three
  spawn centers — `_buildPlayer` (the player spawn), `_spawnStep` (an enemy spawn), `_spawnBoss` (the
  boss spawn). Purely additive — no existing path changes.

**Out of scope (explicitly NOT built):** any change to `world/LevelGenerator.ts` / `config/*` /
`scripts/verify-gen.mjs` (this is COUPLED FX only — the pure generator + the verifier are untouched);
a new i18n string (the FX are wordless — no `t(...)`); a new asset of any kind (programmer-art rects
only); a new pool TYPE beyond the bloom (the spawn shield REUSES the bloom rect played inward — DRY,
no second pool); making the bloom interactive / a real shield that blocks damage (it is a wordless
COSMETIC cue — the actual spawn-invuln is the existing `SPAWN_BLINK_TIME` i-frame, untouched).

---

## 3. Acceptance Criteria

1. **AC1 — a staged expanding bloom on every impact.** `ParticlePool` owns a FIXED bloom pool
   (pre-created in the ctor) + `spawnBloom(x, y, { big })`; `tick(dt)` GROWS each live bloom from a
   small flash toward a bigger square and FADES it over ~0.25 s (longer/bigger on `big`), with ZERO
   per-frame allocation (the lifetime state is flat `Float32Array`s + a rotating cursor, like the
   sparks).
2. **AC2 — the kill call site upgrades for free.** `Effects.explosion(x, y, { big })` calls
   `pool.spawnBloom(x, y, { big })` in ADDITION to the existing sparks + shake, so every existing
   `effects.explosion(...)` (the kill + chip sites in GameScene) gains the bloom with NO new call site.
3. **AC3 — a spawn-in materialize cue.** `Effects.spawnShield(x, y, duration)` plays a CONTRACTING
   ring cue at the spawn center; GameScene calls it ONCE at each of `_buildPlayer` / `_spawnStep` /
   `_spawnBoss`. Programmer-art rect only (no asset).
4. **AC4 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run
   build` exit 0; `npm run verify` prints OK + exits 0 UNCHANGED (this feature touches ONLY
   `effects/*` + GameScene — all Phaser-coupled, NEVER verifier-imported, so the headless gate is
   byte-identical). Programmer-art rect primitives only; runs offline.

---

## 4. Decision Log

1. **D1 — The bloom is a NEW small pool that REUSES the spark pool's exact discipline (flat
   Float32Array state + rotating cursor + REAL-dt tick), NOT a new subsystem.** The spark pool already
   proves the shape; the bloom is a SECOND set of parallel arrays + a second cursor + a second `tick`
   loop, sized for the worst-case concurrent on-screen blooms (one per kill + a few chips). *Rationale:*
   blooms have a DIFFERENT motion (grow-then-fade, no gravity arc) than sparks (arc-down debris), so
   folding them into the spark arrays would muddy the spark tick with a mode flag (YAGNI). A tiny
   parallel pool is the KISS/DRY answer — same discipline, separate state. NO per-frame allocation
   (AC1). Coupled — never verifier-imported.
2. **D2 — `spawnBloom` GROWS the rect (small flash → big bloom) over its life; the `big` flag scales
   the peak size + lifetime.** A single bright square `setScale`-grown from a small flash to a peak and
   alpha-faded over ~0.25 s reads as the classic multi-frame explosion at zero geometry cost (we scale
   a fixed 8 px rect — no `setSize` geometry regen per frame, the spark pool's note). `big` (a tank/base
   kill) gets a bigger peak + a slightly longer life than a chip. *Rationale:* the classic bloom IS
   "flash that expands then fades" — a grow+fade scale curve IS that, KISS. SOLID — `Effects` chooses
   `big`; the pool owns the curve.
3. **D3 — The kill site upgrades for free by adding the bloom INSIDE `Effects.explosion`, not at the
   call sites.** `Effects` is the single juice façade (the kill/chip sites only call `explosion`), so
   adding `pool.spawnBloom` inside `explosion` upgrades every existing impact with NO GameScene churn.
   *Rationale:* DRY/SOLID — one façade edit lights up all impacts. KISS — no new call site for the kill.
4. **D4 — The spawn cue is a CONTRACTING ring that REUSES the bloom rect played inward — one new
   façade method, no new pool kind.** `Effects.spawnShield(x, y, duration)` drives a pooled bloom rect
   that starts BIG + faint and CONTRACTS toward the spawn center as it fades (the inverse curve), so a
   spawn reads as "materializing in" — the mirror of a kill's "blooming out". *Rationale:* the spawn
   cue is the visual INVERSE of the bloom, so reusing the bloom slot with an inward curve is DRY (no
   second primitive) and KISS. The pool exposes a `contract` flag on the bloom; `Effects.spawnShield`
   sets it. YAGNI — not a real damage-blocking shield (the spawn-invuln is the existing
   `SPAWN_BLINK_TIME` i-frame, untouched) — purely a wordless cosmetic cue.
5. **D5 — One `spawnShield` call per spawn site; the player/enemy/boss spawns all get it.** The three
   spawn constructors (`_buildPlayer`, `_spawnStep`, `_spawnBoss`) each gain ONE `effects.spawnShield`
   at the spawn center. *Rationale:* these ARE the three spawn moments — one line each, no shared
   helper needed (KISS; a helper for three one-liners is over-abstraction — YAGNI).
6. **D6 — REAL dt, like the rest of the pool.** The bloom + the shield tick on REAL dt (the pool's
   existing `tick(dt)` contract): a pause / clock-freeze stops the WORLD, never the FX, so a bloom
   started just before a freeze still completes. *Rationale:* the pool's locked dt convention (DRY) —
   no new dt boundary.

---

## 5. Design

### 5.1 Module layout (this phase)

CHANGES `effects/ParticlePool.ts` (the bloom pool + `spawnBloom`), `effects/Effects.ts` (the bloom
call inside `explosion` + `spawnShield`), `scenes/GameScene.ts` (one `spawnShield` per spawn site).
NO new file; the pure modules + the verifier are untouched.

```
src/
  effects/
    ParticlePool.ts   # CHANGED (Phaser-coupled): + a fixed bloom pool (parallel Float32Array state +
                      #   rotating cursor + a tick loop) + spawnBloom(x,y,{big}) (grow/contract + fade). No alloc.
    Effects.ts        # CHANGED (Phaser-coupled): explosion() also spawnBloom; + spawnShield(x,y,duration).
  scenes/
    GameScene.ts      # CHANGED: one effects.spawnShield(...) per spawn site (_buildPlayer/_spawnStep/_spawnBoss).
```

### 5.2 The bloom pool (`ParticlePool`)

- **State (NEW, ctor):** a `bloomCap`-sized set of white 8 px rects (programmer-art, depth ABOVE the
  sparks so the flash reads over the debris) pre-created invisible, plus parallel `Float32Array`s for
  position, life/maxLife, peak scale, and a `contract` flag (1 = the inward spawn-shield curve, 0 = the
  outward kill bloom) + a rotating `_bNext` cursor. Built ONCE — no per-bloom GameObject churn.
- **`spawnBloom(x, y, { big, contract, color, peak, life })`:** acquire a slot off the rotating
  cursor (recycle the oldest on exhaustion — never allocates), set position + colour + peak/life, mark
  it `contract` or not, and show it. `big` scales the default peak + life up; `Effects` passes the rest.
- **`tick(dt)`:** for each live bloom advance `life -= dt`; the eased ratio drives `setScale` (an
  OUTWARD bloom grows from a small flash to `peak`; an INWARD shield starts at `peak` and contracts
  toward a point) and `setAlpha` (fade out). Released when life hits 0. REAL dt (D6). No allocation.

### 5.3 The façade (`Effects`)

- **`explosion(x, y, { big })`:** unchanged sparks + shake, PLUS `this.pool.spawnBloom(x, y, { big })`
  — the bloom is bigger + longer on `big` (the pool's `big` scaling). One line; the single kill site
  upgrades for free (D3/AC2).
- **`spawnShield(x, y, duration)`:** `this.pool.spawnBloom(x, y, { contract: true, peak: …, life:
  duration, color: … })` — a contracting ring cue in a cool spawn colour, distinct from the warm kill
  bloom. NO shake (a spawn is not an impact). The spawn-in materialize (D4/AC3).

### 5.4 The spawn sites (`GameScene`)

- **`_buildPlayer(slot, x, y)`:** after the tank is built + collided, `this.effects.spawnShield(x, y,
  …)` at the player spawn center.
- **`_spawnStep(gdt)`:** after the enemy is pushed, `this.effects.spawnShield(point.x, point.y, …)`.
- **`_spawnBoss()`:** after the boss is pushed, `this.effects.spawnShield(point.x, point.y, …)`.

A single shared shield duration constant in `Effects` keeps the three sites DRY (one truth).

### 5.5 Integration points with existing code (what does NOT change)

- The spark pool, the score-number pool, and the existing `tick`/`spawnSparks`/`spawnNumber` paths are
  UNCHANGED — the bloom is a SEPARATE pool + a separate `tick` loop.
- `Effects.explosion`'s sparks + shake are unchanged; the bloom is one ADDITIVE line. `scorePopup` is
  unchanged. The kill/chip GameScene sites are unchanged (they already call `explosion`).
- The pure generator, `config/*`, the i18n layer, and `scripts/verify-gen.mjs` are UNTOUCHED — this is
  Phaser-coupled FX only (never verifier-imported). No new asset.

---

## 6. Files

**Changed:**

- `src/effects/ParticlePool.ts` — the fixed bloom pool (parallel Float32Array state + rotating cursor
  + a tick loop) + `spawnBloom(x, y, opts)` (grow/contract + fade; no allocation).
- `src/effects/Effects.ts` — `explosion` also calls `spawnBloom`; + `spawnShield(x, y, duration)`.
- `src/scenes/GameScene.ts` — one `effects.spawnShield(...)` per spawn site.
- `docs/designs/2026-06-19-staged-explosion-spawn-juice.md` — this design doc.

---

## 7. Verification

- **AC1 / AC2 (bloom + free kill upgrade) — `npm run typecheck` + `npm run build` + grep.** Grep
  `spawnBloom` in `ParticlePool.ts` + `Effects.ts`; confirm `explosion` calls `spawnBloom`. Manual
  `npm run dev`: a kill shows a small flash expanding into a bigger bloom that fades (~0.25 s); a brick
  chip shows a smaller, shorter bloom.
- **AC3 (spawn cue) — grep + manual drive.** Grep `spawnShield` in `Effects.ts` + the three spawn
  sites in `GameScene.ts`. Manual: a player/enemy/boss spawn shows a contracting ring at the spawn
  center.
- **AC4 (green gate + pure/coupled + offline) — `npm run typecheck` + `npm run build` + `npm run
  verify`.** All exit 0 / print OK. The verifier is byte-unchanged (it never imports `effects/*` or the
  scenes — only the PURE generator + config). Programmer-art rect primitives only; runs offline.

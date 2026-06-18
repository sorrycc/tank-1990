# Tank 1990 — F3 Combat & Terrain (bullet collisions, the eagle base, explosions, respawn)

> Design doc for **F3 Combat & Terrain**, the combat-resolution feature of Tank 1990 (a faithful
> Battle City / 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design docs
> EXACTLY: Background → Requirements Summary → Acceptance Criteria → Decision Log → Design → Files →
> Verification. F0 stood up the booting skeleton (six scenes, pure RNG, defensive save, shared
> constants, a green `typecheck`/`build`/`verify` STUB). F1 made a drivable tank that fires pooled
> bullets. F2 replaced the test arena with a PURE, SEEDED, headlessly-VERIFIED 13×13 stage (terrain
> grid + an enclosed reachable eagle BASE tile + spawn points + a `TileMap` that renders/bodies it
> with a `destroyBrickSubCell` erosion seam). F3 makes the bullets MATTER: it resolves every bullet
> collision pair, gives the eagle base a real entity whose destruction ends the run, pools
> explosion/spark FX, costs a player a life on death (respawn at spawn with brief i-frames), and
> keeps co-op friendly-fire OFF. No enemy-tank AI / power-ups / score readouts yet (YAGNI — each
> lands in its own later feature); F3 wires the SEAMS the enemy feature plugs the bullet×enemy-tank
> path into without a refactor. This is the combat FOUNDATION the enemy/boss/power-up features extend.

---

## 1. Background

In Battle City a bullet is the whole game: it chips a quarter-brick off the wall, bounces off
(despawns on) steel, flies over water, **cancels** an oncoming bullet, kills a tank, and — the
loss condition — **destroys the eagle base**. F2 left the world fully built but inert: bullets
travel and despawn at the playfield bounds (F1), the terrain has tank-blocking bodies + a wired
`TileMap.destroyBrickSubCell` erosion seam, and the generated grid has a `TILE.BASE` cell at
bottom-center — but **nothing collides a bullet against any of it**, the base is just a yellow
square, and a tank cannot die.

F3 resolves all of that. It mirrors the reference's combat-resolution conventions EXACTLY,
adapting them from a side-scrolling melee/projectile brawler to a top-down grid bullet duel:

- **Overlap callbacks that DEFER destructive teardown.** The reference never destroys a body
  inside an Arcade overlap callback (it would corrupt `world.step`'s collider iteration — its
  documented footgun). It disables the body NOW (so a multi-frame overlap can't re-fire), runs the
  blast/FX, then defers the actual `destroy()` to `time.delayedCall(0)` (runs next tick, after the
  step). F3 mirrors this for every brick-chip / base-destruction / bullet-despawn that mutates a
  body (see `_breakBarrel`, the door-transition discipline).
- **A one-shot `gameOver` guard.** The reference fires every run-end edge (`_onPlayerDeath`,
  `_onBossDefeated`, `_completeRun`) under a single `if (this.gameOver) return; this.gameOver =
  true` guard so a same-frame double-trigger banks/transitions exactly once. F3 reuses that exact
  shape for the eagle's destruction.
- **A pooled FX façade.** The reference's `Effects` is the SINGLE juice call site over a
  `ParticlePool` (a fixed pool of spark rectangles + floating Text, ZERO per-hit allocation after
  warm-up, ticked on REAL dt). F3 ships a TRIMMED `effects/ParticlePool.ts` + `effects/Effects.ts`
  pair — sparks + a short-lived explosion burst — copied from the reference's discipline, dropping
  the damage-numbers / hit-stop / status machinery F3 has no use for (YAGNI).
- **The hit-resolution funnel.** The reference routes every damage event through ONE entry on the
  victim (`onHit(result)`) guarded by an `isHittable()` check (dead / i-frame filter), and the
  scene's overlap callbacks just compute the result + call it. F3 gives `Tank` an `onHit()` +
  `isHittable()` (HP, multi-hit armor, i-frames) and gives `Base` an `onHit()`/`destroy` guard.

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split
(F3 touches NO pure module's behaviour — the new `effects/*`, `entities/Base.ts`, and the
`GameScene`/`Tank`/`BulletPool` changes are ALL Phaser-coupled and NEVER imported by the verifier;
`config/constants.ts` gains only PURE data); the pooled-FX discipline (fixed members, reset-only,
REAL-dt tick); defer-destructive-teardown-out-of-overlap via `delayedCall(0)`; a one-shot
`transitioning`/`gameOver` guard for any rebuild/run-end; the single hit funnel (`onHit` +
`isHittable`); `dt = Math.min(delta/1000, MAX_DT)` in SECONDS at the boundary; heavy
intent-revealing comments citing the section + AC + Decision numbers. Governing conventions:
**KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Resolve every bullet collision interaction on the generated stage — bullet×BRICK
(sub-cell erosion), bullet×STEEL (despawn), bullet×WATER (pass), bullet×bullet (mutual despawn),
bullet×tank (damage; armor multi-hit), bullet×EAGLE (run over) — back it with pooled explosion FX,
make player death cost a life + respawn with i-frames, keep co-op friendly-fire OFF, all green on
`typecheck`/`build`/`verify`.

**In scope (F3):**

- **`src/effects/ParticlePool.ts` (Phaser-coupled, NEW):** a TRIMMED port of the reference's pool
  — a FIXED pool of small spark rectangles (flat parallel state, gravity + drag + life-ratio fade,
  ZERO per-burst allocation after warm-up), `spawnSparks(x,y,{count,color,speed})`, a `tick(dt)` on
  REAL dt. DROP the floating-number Text pool (F3 shows no damage numbers — YAGNI).
- **`src/effects/Effects.ts` (Phaser-coupled, NEW):** the SINGLE juice façade over the pool. ONE
  call per impact: `explosion(x,y,{big?})` (a spark burst sized for a small bullet-impact vs. a big
  tank/base kill) + a small camera shake. NO hit-stop / damage-number / status machinery (the
  reference's are for a melee brawler; F3 is a bullet game — YAGNI). `tick(dt)` forwards REAL dt to
  the pool.
- **`src/entities/Base.ts` (Phaser-coupled, NEW):** the eagle entity — a primitive eagle rect
  drawn at the BASE tile's window-center, holding a `destroyed` flag + an `onDestroyed` callback the
  scene wires to its run-over edge. `isHittable()` (false once destroyed) + `onHit()` flip
  `destroyed` ONCE (a guard, like the reference's `gameOver`/`broken`), swap the visual to a
  rubble/cross sprite-rect, and fire `onDestroyed`. The base does NOT create its own collision body:
  F2's `TileMap` ALREADY emits a tank-blocking static body for the `TILE.BASE` cell inside
  `solidBodies` (tagged `tileKind=TILE.BASE`). The scene back-references THAT existing body to the
  `Base` (`solidRect.baseRef = base`), and the SINGLE `bullet × solidBodies` terrain callback
  resolves a `tileKind===TILE.BASE` hit to `base.onHit()` (D3). So one body does double duty: tanks
  still cannot drive onto the eagle (it is in `solidBodies`, which tanks collide with — F2's collider,
  kept) AND a bullet reaching it triggers the eagle-loss. No second base body, no merged super-group.
- **`src/entities/Tank.ts` (CHANGED):** add HP/combat state — `hp`, `maxHp`, `isHittable()`,
  `onHit(damage)`, a death path (`alive`/`onDeath` hook), and brief spawn i-frames (`spawnIframe`
  timer ticked in `update`). Armor tanks survive multiple hits (HP > 1). A player tank's death
  fires `onDeath` (the scene spends a life + respawns or ends the run). The i-frame blink is a
  visual cue (rect alpha pulse). `side`/`behavior` already exist (F1 D7).
- **`src/combat/BulletPool.ts` (CHANGED):** expose the live bullets to the scene's overlap
  registration — the pool's `group` is already a physics group; F3 registers overlaps against it.
  Add a `forEachActive(fn)` iterator (KISS — the scene's bullet×bullet pass reads live shots) and
  keep `release(rect)` (the hit despawn path already exists; F1 wired it). No new pooling machinery.
- **`src/scenes/GameScene.ts` (CHANGED):** register the F3 overlaps + colliders and resolve each
  pair (the heart of the feature — §5.4):
  - **bullet × terrain solids** (`tileMap.solidBodies`: BRICK sub-cells + STEEL + the F2-emitted
    `TILE.BASE` body): ONE overlap callback that switches on the struck body's `tileKind` — BRICK →
    chip the sub-cell (deferred `destroyBrickSubCell`); STEEL → despawn only; `TILE.BASE` → resolve
    the eagle hit via the back-referenced `solidRect.baseRef.onHit()` (which fires the run-over once);
    the bullet despawns in every branch (deferred-safe). Because the BASE body already lives in
    `solidBodies` (F2), there is NO separate bullet×base overlap — the terrain callback owns the eagle
    branch (the reviewer's integration fix; D3).
  - **bullet × WATER** (`tileMap.waterBodies`): NO overlap registered — bullets fly OVER water (the
    classic). Tanks still collide with water (F2 collider kept).
  - **bullet × bullet:** a per-frame scan over the pool's live shots (the cheapest correct way for a
    handful of bullets — KISS) that despawns BOTH on an AABB overlap of opposing-side shots.
  - **bullet × tank** (the pool's group vs. each tank's collider): friendly-fire filtered (a bullet
    never hits a tank of its OWN side — co-op FF off, D-config); on a hittable victim, `tank.onHit`
    (armor multi-hit) + despawn the bullet; a player-tank death fires the life/respawn path.
  - **bullet × base** (folded into the terrain callback above — the BASE body is in `solidBodies`):
    `solidRect.baseRef.onHit()` → run over (the `gameOver` guard) + despawn the bullet. NO separate
    overlap is registered for the base (D3).
  - **player death → life/respawn:** a per-player `lives` counter seeded ONLY for the PRESENT players
    (P1 always; P2 only when `TWO_PLAYER` — D11); on death spend that player's life and (if any
    remain) respawn the tank at its generated spawn with `SPAWN_IFRAME` i-frames, else that player
    stays down and the run-over check runs. The eagle's destruction OR every PRESENT player out of
    lives → `_triggerGameOver` (once) → `GameOverScene`. The run-over tally counts only the spawned
    players, so a SOLO player running out of lives ends the run (the reviewer's single-player fix).
  - Wire `effects.explosion(...)` at every despawn/kill; tick `effects` on REAL dt and the tanks/
    pool on the GAMEPLAY dt (a `gdt` seam — 0 reserved for a future freeze power-up; F3 sets
    `gdt = dt`, the identity, so nothing changes feel-wise but the boundary exists for the clock
    power-up later — the reference's hit-stop dt boundary, KISS-deferred).
- **Constants (added to PURE `constants.ts`):** `BULLET_DAMAGE` (1), the per-type tank HP via a
  small `TANK_MAX_HP` default + an `ARMOR_TANK_HP` (3) reserved for the enemy feature, `SPAWN_IFRAME`
  (s — the post-respawn invulnerability window), `BASE_HP` (1 — a single bullet ends the run, the
  classic). Existing `START_LIVES`/`MAX_DT`/`PLAYFIELD_*`/`SUB_CELL_SIZE`/`TILE_SIZE` REUSED (DRY).

**Out of scope (F3 — later features):** enemy-tank AI + the ONE FSM + the 4 enemy types + staggered
spawns (F3 wires the bullet×tank + tank-death SEAMS generically over `side` so the enemy feature
constructs `side:'enemy'` tanks that plug in with NO refactor — but spawns NO enemies); the boss
tank; the 6 power-ups (incl. the shovel that fortifies the base walls to steel + the clock freeze
that the reserved `gdt` boundary anticipates); STEEL becoming destructible by a max-star tank
(D: bullet carries no `power` flag yet — steel always resists in F3, the seam is the bullet's
reserved combat context); score / the live HUD readouts (lives/score panel); the Hub upgrade trees;
i18n strings; stage→stage rebuild on clear (no enemies to clear yet). F3 ships ONLY the bullet
collision matrix + the eagle-loss run-over + pooled FX + player respawn-with-i-frames + FF-off.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a
> manual `npm run dev` drive-test. F3's logic is ENTIRELY Phaser-coupled (overlaps, the FX pool, the
> Base/Tank entities), so the headless verifier gains NO new assertions (its pure-module asserts —
> rng/constants/tiles/stages/generator — stay green, which RE-PROVES the new code did not leak Phaser
> into a pure module). The new PURE constants are data, not an algorithm, so they need no headless pin.

1. **AC1 — bullet × BRICK erodes ONE sub-cell per hit.** A bullet striking a BRICK sub-cell body
   chips exactly that sub-cell (the other three of the tile remain, with their bodies) via
   `tileMap.destroyBrickSubCell(col,row,subCol,subRow)`, deferred out of the overlap callback. The
   bullet despawns on the hit (a brick stops it). Four hits clear a whole brick tile.
2. **AC2 — bullet × STEEL despawns, no damage.** A bullet striking a STEEL body despawns with NO
   terrain change (steel is indestructible this phase — no `bullet.power` break-steel flag exists in
   F3; the seam is the bullet's reserved combat context). An explosion FX pops at the impact.
3. **AC3 — bullet × WATER passes.** A bullet flies OVER water unobstructed (no overlap is registered
   against `tileMap.waterBodies`); it continues until it hits something else or the bounds. Tanks
   still cannot drive into water (the F2 tank×water collider is kept).
4. **AC4 — bullet × bullet mutual despawn.** Two opposing-side bullets whose bodies overlap BOTH
   despawn (neither passes through). Same-side bullets do NOT cancel (FF off — D). The despawn is
   deferred-safe (no body destroyed inside iteration).
5. **AC5 — bullet × TANK damages; armor survives multiple hits.** A bullet hitting a HITTABLE tank
   of the OPPOSING side applies `BULLET_DAMAGE`; the bullet despawns. A 1-HP tank dies in one hit; an
   armor tank (`hp > 1`) survives until its HP is spent. A bullet NEVER damages a tank of its own side
   (co-op friendly-fire OFF, D). A tank in spawn-i-frames is not hittable (`isHittable()` false).
6. **AC6 — bullet × EAGLE → GAME OVER, exactly once.** A bullet reaching the eagle's `TILE.BASE`
   body (the F2-emitted body in `solidBodies`, back-referenced to the `Base`) is resolved by the
   bullet×terrain callback's `tileKind===TILE.BASE` branch: it calls `base.onHit()`, which destroys
   the base (the visual swaps to rubble) and triggers the run-over handoff to `GameOverScene` EXACTLY
   ONCE, guarded by the one-shot `gameOver` flag (a multi-frame overlap / a same-frame second bullet
   cannot double-fire). The base's destruction also fires on the SHARED eagle for co-op (one base,
   both players lose). Tanks still cannot drive onto the eagle (the BASE body is tank-blocking — F2's
   tank×`solidBodies` collider, kept).
7. **AC7 — explosions are pooled (no leak).** Every impact/kill pops a spark burst from a FIXED
   `ParticlePool` (pre-created in the constructor, reset-only, ZERO per-burst allocation after
   warm-up). The pool ticks on REAL dt; a burst self-returns to the pool when its sparks' life
   expires (no GameObject is created or destroyed per impact).
8. **AC8 — player death costs a life + respawns with i-frames.** A player tank reaching 0 HP fires
   its death path: a kill explosion pops, a life is spent, and — if lives remain — the tank respawns
   at its generated spawn point with a `SPAWN_IFRAME` invulnerability window (visually blinking,
   `isHittable()` false during it). With NO lives left, that player stays down; the run ends only when
   the eagle is destroyed OR every PRESENT player is out of lives (the run-over check tallies only the
   spawned players — so a single-player run ends when P1 spends its last life, AC scoped to present
   players, D11).
9. **AC9 — friendly-fire OFF (co-op).** A player bullet PASSES THROUGH an allied player tank (no
   damage, no despawn) — gated by a single config toggle read at the bullet×tank filter. The same
   filter governs bullet×bullet (same-side shots don't cancel). The toggle's default is OFF
   (friendly-fire disabled).
10. **AC10 — deferred teardown + one-shot guards.** The body-DESTROYING resolution (the brick sub-cell
    chip — the only one F3 has) is DEFERRED out of the overlap callback via `time.delayedCall(0)` and
    is idempotent (`destroyBrickSubCell` is a no-op on a missing key). The eagle hit destroys NO body
    (the reused `solidBodies` BASE body stays as tank-blocking rubble — D3), so it needs no defer; it
    flips `Base.destroyed` under a one-shot guard and fires the (idempotent) run-over. The run-over edge
    is gated by the one-shot `gameOver` flag and a rebuild (if any) by a `transitioning` flag —
    mirroring the reference's footgun discipline.
11. **AC11 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run
    build` exit 0; `npm run verify` stays green (its pure-module sweep unchanged — re-proving F3 leaked
    no Phaser into a pure module). `effects/*`, `entities/Base.ts`, `entities/Tank.ts`,
    `combat/BulletPool.ts`, and the scenes import Phaser and are NEVER imported by the verifier;
    `config/constants.ts` stays PURE (its new combat constants are Phaser-free data). Programmer-art
    primitives only (rectangles/Graphics); runs offline / from `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — Resolve bullet collisions in GameScene via Arcade overlaps, ONE callback per pair, every
   destructive mutation DEFERRED out of the callback.** The reference's combat is overlap-driven
   (`physics.add.overlap(group, group, cb, processFilter, this)`) and never destroys a body inside a
   callback — it disables NOW, defers `destroy()` to `delayedCall(0)`. F3 registers: bullet-group ×
   `solidBodies` (brick/steel/BASE — the eagle body F2 already emits into this group, resolved by the
   ONE terrain callback's `tileKind` switch, D3), bullet-group × each tank collider; and a per-frame
   bullet×bullet scan. There is NO separate bullet×base overlap. *Rationale:* this is the reference's
   proven shape (KISS/DRY) — the
   scene OWNS the world resolution (SOLID; `Tank`/`Base`/`BulletPool` stay dumb data+behaviour
   holders). Deferring the brick-chip / base-removal out of the callback avoids the `world.step`
   collider-iteration footgun the reference documents (AC10). No new architecture.
2. **D2 — The bullet's hit reads the struck terrain via the body's grid tag, NOT a tile-coordinate
   recompute (DRY).** F2's `TileMap` already stamps each terrain body with `tileCol/tileRow/subCol/
   subRow/tileKind`. The bullet×solids callback reads those off the struck body to decide chip-vs-
   despawn + which sub-cell to erode — it never re-derives the cell from the bullet's pixel position.
   *Rationale:* the grid tag is the single source the render/erosion already share (DRY); reading it
   keeps the resolution exact (the body the bullet actually overlapped) and trivial (KISS). It reuses
   F2's wired `destroyBrickSubCell` seam verbatim — F3 is the feature that finally CALLS it (the F2
   doc promised "nothing shoots them yet … the damage feature calls the seam").
3. **D3 — BRICK chips one sub-cell + stops the bullet; STEEL stops it with no change; WATER is not
   registered (passes); the eagle BASE is resolved INSIDE the terrain callback by reusing F2's
   existing `solidBodies` BASE body (NO second base body — the reviewer's F2-integration fix).** Per
   the `tiles.ts` props (`destructible`/`passableByBullet`): BRICK is destructible → chip the hit
   sub-cell; STEEL is indestructible → despawn only; WATER `passableByBullet:true` → F3 registers NO
   bullet×water overlap so bullets fly over (tanks keep their F2 water collider). The eagle BASE
   already has a tank-blocking static body: **F2's `TileMap` constructor bodies the `TILE.BASE` cell
   into `solidBodies` via `_addSolidTile` (TileMap.ts ~89-90), tagged `tileKind=TILE.BASE`.** F3 does
   NOT add a second base body and does NOT register a separate bullet×base overlap (that double-body
   path was the bug: a separate scene body would be unreachable because the bullet would hit the
   existing `solidBodies` BASE body FIRST and, lacking a BASE branch, just despawn — the eagle-loss
   would never fire). Instead the scene BACK-REFERENCES the existing body to the `Base`
   (`solidRect.baseRef = base`, found by scanning `solidBodies` for the child whose `tileKind` is
   `TILE.BASE` — or, equivalently, the body at the generated base cell), and the SINGLE
   bullet×`solidBodies` callback adds a `tileKind===TILE.BASE` branch that calls `solidRect.baseRef
   .onHit()`. *Rationale:* the terrain semantics live in `tiles.ts` (DRY); ONE body per cell, owned by
   `TileMap` (no merged super-group, no duplicate eagle body — KISS). TileMap stays genuinely
   **Unchanged**: F3 neither removes its BASE body nor edits it — it reads the body F2 emits and the
   tag F2 stamps, exactly as it reads the BRICK/STEEL tags (D2). Tanks still cannot drive onto the
   eagle because that one body is in `solidBodies`, which the F2 tank×`solidBodies` collider blocks
   against. The one-shot run-over consequence stays isolated in `Base.onHit` (SOLID). The future
   shovel power-up swaps the base-WALL bricks (the surrounding BRICK/STEEL cells) to steel — it never
   needs to touch the BASE cell's body, so a single shared base body costs the shovel nothing.
4. **D4 — STEEL stays indestructible in F3 (no `bullet.power` break-steel flag yet).** The locked
   design says steel is "indestructible until a max-star tank". F3 has no tank-star/upgrade system and
   no enemy tanks, so NO bullet can break steel yet. The bullet's reserved combat context (its `bx`
   struct) is where a later `power`/`breaksSteel` flag lands; F3's steel branch is the identity
   (always despawn-no-damage). *Rationale:* YAGNI — building a break-steel path with nothing to set
   the flag is speculative. The seam (the `bx` struct + the steel branch) is one `if` away from the
   later feature, mirroring how F1's `BulletPool` dropped the reference's pierce/status but kept the
   struct shape for later. KISS/SOLID.
5. **D5 — bullet × bullet is a per-frame scan over the pool's live shots, not an overlap group ×
   itself.** Arcade's `overlap(group, group)` against the SAME group is awkward (self-pairs, double
   callbacks). With a handful of live bullets (≤ `MAX_PLAYER_BULLETS × players` + later enemies, a
   single-digit count) a direct O(n²) AABB scan each frame is the simplest CORRECT thing. Opposing-side
   overlapping shots both despawn. *Rationale:* KISS — a tiny n makes the scan trivially cheap and
   obviously correct, with no Arcade self-overlap quirks. The pool exposes `forEachActive` (DRY — one
   iterator the scan + any later pass reuse). Same-side shots are skipped (FF off, D8). Deferred-safe:
   the scan only calls `pool.release` (disables the body; no destroy), so it never mutates inside
   physics iteration.
6. **D6 — `Base` is a plain entity with a ONE-SHOT `destroyed` guard + an `onDestroyed` callback the
   scene wires (SOLID), mirroring the reference's `gameOver`/`broken` guards.** `Base` holds the eagle
   rect + a destroyed flag; `isHittable()` is false once destroyed; `onHit()` flips the flag exactly
   once, swaps the visual to rubble, and fires `onDestroyed`. The scene's `onDestroyed = () =>
   this._triggerGameOver()`; `_triggerGameOver` is itself guarded by the scene's one-shot `gameOver`
   flag (so the base-destruction edge AND the all-lives-spent edge both funnel through one guarded
   run-over). *Rationale:* the reference's run-end edges all fire under a single guard so a same-frame
   double-trigger banks/transitions ONCE (its `_onPlayerDeath`/`_onBossDefeated` ordering). Reusing the
   exact shape (entity guard + scene `gameOver` guard) keeps the base self-contained (it never reaches
   into the scene — SOLID) and the run-over single-fire (AC6/AC10). KISS — one boolean + one callback.
7. **D7 — The hit funnel: `Tank.onHit(damage)` + `Tank.isHittable()`, the SAME entry both sides use
   (DRY), with HP for armor multi-hit + spawn i-frames.** The scene's bullet×tank callback computes
   nothing but "is this a valid, hittable, opposing-side victim?" then calls `tank.onHit(BULLET_DAMAGE)`
   — exactly the reference's `enemy.onHit(result)` / `_hurtPlayer` funnel. `onHit` subtracts HP, and at
   ≤0 runs the death path ONCE (a `dead` guard) firing `onDeath`. `isHittable()` returns false when
   dead OR within the post-respawn i-frame window (so a fresh spawn can't be instantly re-killed). HP
   defaults to 1 (`TANK_MAX_HP`); the enemy feature constructs an armor tank with `hp:3` (`ARMOR_TANK_HP`)
   — multi-hit "for free" via the same HP subtraction. *Rationale:* ONE hit entry (DRY) means the enemy
   feature reuses it unchanged; HP-as-armor is the simplest multi-hit model (KISS); i-frames via an
   `isHittable` gate mirror the reference's enemy hurt-iframe + player dodge-iframe (the genre's
   "respawn protection"). The class owns its combat state; the scene owns the pool/overlap (SOLID).
8. **D8 — Friendly-fire OFF is a SINGLE config toggle read at the bullet's victim filter (co-op).**
   `FRIENDLY_FIRE` (default `false`) in `constants.ts`. The bullet×tank callback skips when
   `bullet.ownerSide === tank.side && !FRIENDLY_FIRE` (a player bullet passes an allied player tank);
   the bullet×bullet scan skips same-side pairs the same way. *Rationale:* the locked decision is
   "co-op friendly-fire OFF (a config toggle)". One PURE boolean owned once (DRY) drives both filters;
   flipping it to `true` re-enables FF with no code change (the seam). KISS/SOLID — the policy is data,
   read at exactly the two filter sites. The bullet already carries `ownerSide` (F1), so no new field.
9. **D9 — Pooled FX = a TRIMMED `ParticlePool` + `Effects` façade, copied from the reference's
   discipline, dropping the numbers/hit-stop/status machinery (YAGNI).** Keep the reference's flat
   parallel-state spark pool (fixed `sparkCap`, gravity + exponential drag, scale/alpha = life ratio,
   a rotating free-slot cursor, REAL-dt tick, ZERO per-burst allocation) and the ONE-call-per-impact
   `Effects` façade (`explosion(x,y,{big})` = sparks + a small camera shake). DROP the floating
   damage-number Text pool, the hit-stop request, and the status-tick/parry calls — F3 has no damage
   numbers, no hit-stop, no statuses. *Rationale:* the brief says "reuse Effects/ParticlePool"; copying
   the proven pooling SHAPE (so a later feature could re-add numbers exactly as the reference does) is
   KISS/DRY, while shipping only sparks+shake is YAGNI-honest. No GameObject churn per impact (AC7).
10. **D10 — A GAMEPLAY-dt seam (`gdt`) is wired but is the IDENTITY in F3 (`gdt = dt`).** The reference
    splits a REAL dt (decays the hit-stop, ticks Effects) from a GAMEPLAY dt (`gdt`, driven to 0 during
    a freeze, ticks the world). F3 has no freeze yet, so `update` computes `dt = min(delta/1000, MAX_DT)`
    and sets `gdt = dt` (the identity — feel is byte-identical to F2): tanks/bullets tick on `gdt`,
    `effects` ticks on `dt`. *Rationale:* the locked CLOCK power-up (freeze all enemies, timed) needs
    exactly this boundary (set `gdt = 0` while frozen so the world stops but FX keep popping). Wiring
    the boundary NOW (one variable) means the power-up feature flips one assignment with no refactor —
    the reference's hit-stop dt boundary, KISS-deferred. The bullet pool ALREADY hand-integrates on the
    passed dt (F1 D8), so `gdt = 0` would freeze live shots for free. YAGNI: F3 adds NO freeze logic.
11. **D11 — Player respawn + lives live in the SCENE (the world owner), not the Tank — and lives +
    the run-over tally are scoped to the PRESENT players only (the reviewer's single-player fix).** A
    per-player `lives` counter (seeded `START_LIVES`) + the respawn placement (re-`reset` the tank's
    body to its generated spawn `x/y` + arm `SPAWN_IFRAME`) are scene concerns (the scene owns spawns +
    the run). CRITICAL: the `lives` map is seeded for ONLY the players that actually spawn — P1 always,
    P2 **only when `TWO_PLAYER`** — and `_checkRunOver` tallies ONLY those same present players (it
    iterates the spawned tanks / the seeded `lives` keys, NOT a hard-coded `{1,2}`). If F3 instead
    seeded `lives = {1: START_LIVES, 2: START_LIVES}` unconditionally while gating P2's spawn on
    `TWO_PLAYER`, the single-player all-lives-spent edge would be UNREACHABLE: P2's slot would sit at
    `START_LIVES` forever (P2 is never spawned/driven/killed), so "every player lives==0" could never
    become true and a solo run could ONLY end by losing the eagle — contradicting AC8. Scoping both the
    seed AND the tally to the present players means a SOLO P1 spending its last life ends the run. The
    Tank only fires `onDeath`; the scene decides spend-a-life-and-respawn vs. stay-down, then runs the
    run-over check (eagle destroyed OR every PRESENT player out of lives). *Rationale:* the reference
    owns player death/respawn in the scene (`_onPlayerDeath`), the entity just reports it (SOLID — the
    Tank has no business knowing the run's life economy). Reusing the generated spawn `x/y` (F2 D13)
    for the respawn (DRY) keeps the body straddling its cleared 2×2 footprint. KISS — one present-
    players-keyed counter + a re-place; the single `TWO_PLAYER` flag (F1 D2) is the ONE owner of
    "who is present", read once at spawn-and-seed time so the lives/tally can never disagree with it.
12. **D12 — No score / HUD readout / stage-rebuild / enemy spawns in F3 (YAGNI).** F3 wires the
    bullet×tank + tank-death seams GENERICALLY over `side`, but spawns NO enemy tanks (the enemy
    feature does), shows NO lives/score panel (the HUD-readout feature does), and does NOT rebuild the
    stage on clear (there's nothing to clear yet). *Rationale:* the feature scope is "resolve combat
    interactions" — building a score economy / live HUD / enemy roster here would be speculative and
    would contradict the later features that own them. F3's seams (the generic `side`-keyed bullet×tank
    callback, the `onDeath` hook, the `gameOver` guard) are exactly what those features plug into. KISS.

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F3 adds the `effects/` layer + `entities/Base.ts`, and updates
`Tank`/`BulletPool`/`GameScene`/`constants`:

```
src/
  config/
    constants.ts          # CHANGED (PURE): + BULLET_DAMAGE, TANK_MAX_HP, ARMOR_TANK_HP, BASE_HP,
                          #   SPAWN_IFRAME, FRIENDLY_FIRE (no Phaser)
  effects/
    ParticlePool.ts       # NEW (Phaser-coupled): fixed spark pool — spawnSparks + REAL-dt tick (no Text pool)
    Effects.ts            # NEW (Phaser-coupled): the juice façade — explosion(x,y,{big}) = sparks + shake
  entities/
    Base.ts               # NEW (Phaser-coupled): the eagle — destroyed guard + onDestroyed cb + onHit/isHittable
    Tank.ts               # CHANGED: + hp/maxHp, isHittable(), onHit(dmg), death path + onDeath hook, spawnIframe
  combat/
    BulletPool.ts         # CHANGED: + forEachActive(fn) iterator (the bullet×bullet scan); release() reused
  scenes/
    GameScene.ts          # CHANGED: register F3 overlaps/colliders; resolve every pair; lives/respawn; FX; gdt seam
```

### 5.2 Key types & constants

**`src/config/constants.ts`** (PURE — no Phaser; F3 ADDS these, reusing every existing value):

- `BULLET_DAMAGE = 1` — HP a bullet removes from a tank/base (the classic single-hit shot).
- `TANK_MAX_HP = 1` — default tank HP (a basic/fast/power tank dies in one hit). Player tanks use it.
- `ARMOR_TANK_HP = 3` — RESERVED for the enemy armor type (multi-hit); F3 sets no enemy but pins the
  number here so the enemy feature reads ONE owner (DRY).
- `BASE_HP = 1` — the eagle dies to a single bullet (the classic instant loss).
- `SPAWN_IFRAME = 1.5` — seconds of post-respawn invulnerability (the blink window). `isHittable()`
  is false while it ticks down.
- `FRIENDLY_FIRE = false` — the co-op friendly-fire toggle (D8). The scene's two filters read it.

(Existing reused, NO new copies: `MAX_DT`, `START_LIVES`, `TWO_PLAYER`, `PLAYFIELD_X/Y/W/H`,
`TILE_SIZE`, `SUB_CELL_SIZE`, `TANK_SIZE`, `BULLET_SPEED`, `FIRE_COOLDOWN`, `MAX_PLAYER_BULLETS`.)

**`src/effects/ParticlePool.ts`** (Phaser-coupled — the reference pool, sparks-only):

```ts
export class ParticlePool {
  constructor(scene: Phaser.Scene, opts?: { sparkCap?: number })   // pre-creates sparkCap rect members (fixed)
  spawnSparks(x, y, opts?: { count?: number; color?: number; speed?: number }): void  // a burst (no alloc)
  tick(dt: number): void                                            // REAL dt — integrate + fade + recycle
}
```

Flat parallel `Float32Array` state (x/y/vx/vy/life/max/scale) + a `boolean[] active` + a rotating
`_sNext` free-slot cursor — copied from the reference's discipline (gravity arc + exponential drag +
`alpha/scale = life/max`). NO Text/number pool.

**`src/effects/Effects.ts`** (Phaser-coupled — the single juice façade):

```ts
export class Effects {
  constructor(scene: Phaser.Scene)
  explosion(x: number, y: number, opts?: { big?: boolean }): void  // sparks (count/speed scale w/ big) + camera shake
  tick(dt: number): void                                           // forwards REAL dt to the pool
}
```

`explosion` = the ONE impact call (a small burst for a bullet hitting terrain; a `big` burst +
stronger shake for a tank/base kill). No hit-stop / numbers / status (YAGNI).

**`src/entities/Base.ts`** (Phaser-coupled):

```ts
export class Base {
  scene: Phaser.Scene
  rect: Phaser.GameObjects.Rectangle       // the eagle (programmer-art); swaps to rubble on destroy
  destroyed: boolean                        // one-shot guard (D6)
  onDestroyed: (() => void) | null          // the scene wires its run-over edge (SOLID)
  constructor(scene: Phaser.Scene, x: number, y: number)   // (x,y) = the BASE tile window-center (F2 D13)
  isHittable(): boolean                      // false once destroyed
  onHit(): void                              // flip destroyed ONCE → swap visual → fire onDestroyed
}
```

The base's tank-blocking STATIC BODY is NOT created by the scene — F2's `TileMap` already emitted one
for the `TILE.BASE` cell into `solidBodies` (tagged `tileKind=TILE.BASE`). `Base.rect` is just the
VISUAL drawn over that cell (the reference's collider/rect split). In `create()` the scene back-refs
that EXISTING `solidBodies` child to the `Base` (`solidRect.baseRef = base`), so the SINGLE
bullet×`solidBodies` terrain callback's `tileKind===TILE.BASE` branch resolves the eagle hit via
`solidRect.baseRef.onHit()` (D3) — no second body, no separate overlap. Because that one body lives in
`solidBodies`, the F2 tank×`solidBodies` collider already keeps tanks off the eagle (kept, unchanged).

**`src/entities/Tank.ts`** (CHANGED — additive combat state):

```ts
// new fields:
hp: number; maxHp: number
alive: boolean
spawnIframe: number                          // s — post-respawn invulnerability (ticks down in update)
onDeath: (() => void) | null                 // the scene wires the life/respawn path (SOLID, D11)
// new methods:
isHittable(): boolean                        // alive && spawnIframe <= 0
onHit(damage: number): void                  // hp -= damage; at <=0 run the death path ONCE → onDeath
respawnAt(x: number, y: number): void        // re-place the body + refill hp + arm SPAWN_IFRAME (scene calls, D11)
```

`update(dt, intent)` additionally decays `spawnIframe` and blinks the rect alpha while it's > 0 (the
i-frame cue). A dead tank (alive=false) skips movement/fire (the scene stops driving it until respawn).

**`src/combat/BulletPool.ts`** (CHANGED — one iterator):

```ts
forEachActive(fn: (rect: BulletRect) => void): void   // the bullet×bullet scan reads live shots (DRY)
```

`release(rect)` (F1) is the hit-despawn entry; `group` (F1) is the overlap target. No new pooling.

### 5.3 Algorithms

**bullet × terrain solids (the ONE solids overlap callback — brick/steel/BASE, deferred):**
`solidBodies` holds the BRICK sub-cells, the STEEL tiles, AND the eagle's `TILE.BASE` body (all
emitted by F2's `TileMap`). One callback switches on the struck body's `tileKind` tag (D2/D3):
```
on overlap(bulletRect, solidRect):
  bx = bulletRect.bx; if (!bx.active) return            # stale-handle guard (a multi-frame overlap)
  kind = solidRect.tileKind                              # F2's body tag (D2)
  if (kind === TILE.BASE):                               # the eagle — F2's BASE body, back-reffed (D3)
    base = solidRect.baseRef
    if (!base || !base.isHittable()) { bullets.release(bulletRect); return }   # already rubble → just despawn
    effects.explosion(bulletRect.x, bulletRect.y, { big: true })
    bullets.release(bulletRect)
    base.onHit()                                         # flips destroyed ONCE → onDestroyed → _triggerGameOver (gameOver guard)
    return                                               # the BASE body STAYS (still tank-blocking rubble); no destroyBrickSubCell
  effects.explosion(bulletRect.x, bulletRect.y)          # impact spark (REAL-dt pool) — brick/steel
  bullets.release(bulletRect)                            # despawn the shot (disables body; owner count--)
  if (kind === TILE.BRICK):
    # defer the body removal out of world.step (footgun, D1/AC10)
    time.delayedCall(0, () => tileMap.destroyBrickSubCell(solidRect.tileCol, .tileRow, .subCol, .subRow))
  # STEEL: no terrain change (D3/D4)
```
`bullets.release` only DISABLES the body (F1), so calling it inside the callback is safe; the
`destroyBrickSubCell` (which destroys a body) is what we defer. The BASE branch destroys NO body
(the eagle's rubble stays tank-blocking — the classic), so it needs no `delayedCall`. There is NO
separate bullet×base overlap — this one solids callback owns the eagle branch (the reviewer's fix).

**bullet × tank (overlap callback):**
```
on overlap(bulletRect, tankCollider):
  bx = bulletRect.bx; tank = tankCollider.tankRef
  if (!bx.active || !tank || !tank.isHittable()) return                 # stale / dead / i-frame guard
  if (bx.ownerSide === tank.side && !FRIENDLY_FIRE) return              # FF off (D8/AC9) — pass through
  effects.explosion(bulletRect.x, bulletRect.y)
  bullets.release(bulletRect)                                           # one shot, one hit (despawn)
  tank.onHit(BULLET_DAMAGE)                                             # the hit funnel (D7) — armor multi-hit
```
`Tank.onHit` runs the death path at ≤0 HP ONCE (the `alive` guard) → `effects.explosion(big)` is
fired by the scene's `onDeath` wiring + the life/respawn logic.

**bullet × base:** there is NO separate bullet×base overlap. The eagle's `TILE.BASE` body lives in
`solidBodies` (F2), so the `tileKind===TILE.BASE` branch of the SINGLE bullet×terrain-solids callback
above resolves it (`solidRect.baseRef.onHit()`). This is the reviewer's F2-integration fix: a second
scene-owned base body would be UNREACHABLE behind the existing `solidBodies` BASE body (D3/D1).

**bullet × bullet (per-frame scan, after the tanks/pool tick — D5):**
```
live = []; bullets.forEachActive(r => live.push(r))
for i in 0..live.length:
  for j in i+1..live.length:
    a = live[i], b = live[j]
    if (!a.bx.active || !b.bx.active) continue
    if (a.bx.ownerSide === b.bx.ownerSide && !FRIENDLY_FIRE) continue   # same side don't cancel (D8)
    if (aabbOverlap(a, b)):
      effects.explosion(midpoint)                                       # a small spark where they meet
      bullets.release(a); bullets.release(b)                            # mutual despawn (disables bodies)
```
`aabbOverlap` is a plain rect-overlap test on the two bullet bodies (KISS — n is single-digit).

**player death → life/respawn (the scene's `onDeath` wiring, D11):**
```
# lives is seeded for PRESENT players ONLY: keys = [1] (solo) or [1,2] (TWO_PLAYER) — see §5.4.
tank.onDeath = () => {
  effects.explosion(tank.body.center, { big: true })       # the kill burst (AC8)
  lives[slot]--
  if (lives[slot] > 0):
    tank.respawnAt(spawn.x, spawn.y)                        # re-place + refill hp + arm SPAWN_IFRAME (D11)
  else:
    # that player stays down; run-over only when the eagle dies OR EVERY PRESENT player is out of lives
  _checkRunOver()
}

# _checkRunOver tallies ONLY the PRESENT players (the seeded lives keys), NOT a hard-coded {1,2}:
_checkRunOver() {
  for (slot of Object.keys(lives))                         # solo → just [1]; co-op → [1,2]
    if (lives[slot] > 0) return                            # someone still has a life → run continues
  _triggerGameOver()                                       # every PRESENT player spent → run over (once)
}
```
Scoping `lives` AND this tally to the present players is the reviewer's single-player fix: a solo P1
is the ONLY key, so spending P1's last life makes the loop find no survivor and ends the run (AC8). A
phantom P2 slot can never block run-over because it is never seeded when `TWO_PLAYER` is false (D11).
`_triggerGameOver()` is guarded by the one-shot `gameOver` flag (D6/AC6/AC10): it bursts the base/
flash, snapshots a minimal summary, and `scene.start('GameOver')` ONCE. (The base's `onDestroyed`
funnels through the SAME `_triggerGameOver`, so the eagle-loss edge and the all-lives-spent edge fire
exactly once between them.)

**GameScene.update(_, delta):**
```
dt  = min(delta/1000, MAX_DT)          # REAL dt (AC of F1 reused)
gdt = dt                               # GAMEPLAY dt — IDENTITY in F3 (D10); the clock power-up sets 0 later
s   = input2.sample()                  # ONCE (F1 invariant)
if (gameOver) { effects.tick(dt); return }   # frozen once the run ended (FX still settle)
# drive each ALIVE player (a down player isn't driven until respawn)
for each player tank: if (s.fire) tank.tryFire(bullets); tank.update(gdt, s)
bullets.tick(gdt)                      # hand-integrated travel (gdt=0 would freeze shots — D10)
_scanBulletVsBullet()                  # D5
effects.tick(dt)                       # REAL dt — FX pop even if the world were frozen
```
Arcade resolves the registered overlaps (bullet×solids — brick/steel/BASE, and bullet×tank) during
its world step; the eagle is the `tileKind===TILE.BASE` branch of the bullet×solids callback (NOT a
separate overlap — D3). The callbacks above run inside the step and DEFER any body destroy (AC10).

### 5.4 GameScene integration

`create()` (additive over F2):
- Build the stage (F2, unchanged): `generateStage` → `TileMap`; spawn P1 (+P2 if `TWO_PLAYER`);
  tank×`solidBodies` + tank×`waterBodies` colliders (F2, kept).
- `this.effects = new Effects(this)`.
- `this.base = new Base(this, desc.base.x, desc.base.y)` (the eagle VISUAL only). The tank-blocking
  static body ALREADY exists: F2's `TileMap` emitted the `TILE.BASE` cell into `solidBodies`. Find
  that body (scan `tileMap.solidBodies.getChildren()` for the child whose `tileKind === TILE.BASE` —
  there is exactly one) and back-ref it: `baseBody.baseRef = this.base`. Do NOT create a second body
  and do NOT add a tank×base collider — the F2 tank×`solidBodies` collider already blocks tanks off
  the eagle (the BASE body is in that group). Wire `base.onDestroyed = () => this._triggerGameOver()`.
- Seed `this.lives` for the PRESENT players ONLY (D11): `this.lives = { 1: START_LIVES }`, and add
  `this.lives[2] = START_LIVES` ONLY when `TWO_PLAYER` (i.e. only when P2 is actually spawned). Wire
  each spawned player tank's `onDeath`. `_checkRunOver` later iterates these seeded keys, so a phantom
  P2 can never block a solo run-over.
- Register overlaps: `bullets.group × tileMap.solidBodies` (brick/steel/BASE — the ONE solids
  callback resolves all three via `tileKind`, incl. the eagle branch), `bullets.group × each
  tank.collider` (FF-filtered). NO bullet×water overlap (AC3). NO separate bullet×base overlap (the
  BASE body is in `solidBodies` — D3). Each overlap uses a `processCallback` that early-returns while
  `gameOver` (the reference's filter style).
- `this.gameOver = false; this.transitioning = false` (the one-shot guards).

`update()` — §5.3 (the dt/gdt split, the bullet×bullet scan, the FX tick, the `gameOver` freeze).

### 5.5 Integration points with existing code

- **`constants.ts`** — F3 ADDS six PURE constants; reuses `START_LIVES`/`MAX_DT`/`TWO_PLAYER`/grid +
  layout values. No renames. Stays Phaser-free (verifier import unaffected — AC11).
- **`TileMap` (F2) — genuinely Unchanged** — F3 CALLS the already-wired `destroyBrickSubCell` seam
  (no `TileMap` change) and reuses the `tileKind`/`tileCol/row/subCol/subRow` body tags (D2).
  CRUCIALLY, F3 ALSO reuses the BASE body F2 already emits: F2's constructor bodies the `TILE.BASE`
  cell into `solidBodies` via `_addSolidTile` (TileMap.ts ~89-90), tagging it `tileKind=TILE.BASE`.
  F3 does NOT remove, re-body, or otherwise edit that — it back-refs it (`baseRef`) and resolves the
  eagle hit in the bullet×`solidBodies` callback's `TILE.BASE` branch (D3). So TileMap is touched in
  NO way (it remains in the Unchanged list, §6), the double-body bug is gone, and tanks stay blocked
  off the eagle by the same F2 tank×`solidBodies` collider. `solidBodies`/`waterBodies` groups are
  reused as overlap/collider targets exactly as F2 designed (D7's group split pays off here).
- **`Tank` (F1)** — F3 ADDS combat fields/methods additively; the F1 movement/fire/turn-snap spine is
  UNCHANGED. The reserved `side`/`behavior` tags (F1 D7) now drive the FF filter + the (later) enemy
  path. A player tank is constructed exactly as F1; F3 only wires its `onDeath` + gives it HP.
- **`BulletPool` (F1)** — F3 ADDS `forEachActive`; reuses `group`/`release`/`releaseAll`. The
  hand-integrated `tick(dt)` (F1 D8) means `gdt=0` (the later freeze) stops shots for free (D10).
- **`GameScene` (F2)** — the stage build + tank spawns + tank×terrain colliders are KEPT; F3 adds the
  base, the FX, the lives/respawn, the overlaps, and the dt/gdt + bullet-scan tick additions.
- **`GameOverScene` (F0 stub)** — F3 routes to it on run-over; the stub's "Press SPACE → Title" is
  unchanged (the summary/banking readout is a LATER feature — F3 passes nothing it doesn't own).
- **Reserved for later features:** the bullet `bx` struct's future `power`/`breaksSteel` flag (D4);
  `gdt=0` for the clock freeze power-up (D10); the generic `side`-keyed bullet×tank + `onDeath` seams
  for enemy tanks (D12); the base-WALL bricks' swap-to-steel for the shovel power-up (the surrounding
  BRICK cells, NOT the eagle's own BASE body, which the shovel never touches — D3); `ARMOR_TANK_HP`
  for the enemy armor type (D7); score/lives HUD readouts (D12).

---

## 6. Files

**New:**

- `src/effects/ParticlePool.ts` — the fixed sparks-only pool (REAL-dt tick, zero per-burst alloc).
- `src/effects/Effects.ts` — the single juice façade (`explosion` = sparks + camera shake).
- `src/entities/Base.ts` — the eagle entity (destroyed guard + `onDestroyed` cb + `onHit`/`isHittable`).

**Changed:**

- `src/config/constants.ts` — ADD `BULLET_DAMAGE`, `TANK_MAX_HP`, `ARMOR_TANK_HP`, `BASE_HP`,
  `SPAWN_IFRAME`, `FRIENDLY_FIRE` (PURE; no Phaser import).
- `src/entities/Tank.ts` — ADD `hp`/`maxHp`/`alive`/`spawnIframe`/`onDeath`, `isHittable()`,
  `onHit(damage)`, `respawnAt(x,y)`, i-frame decay+blink in `update` (the F1 spine unchanged).
- `src/combat/BulletPool.ts` — ADD `forEachActive(fn)` (the bullet×bullet scan iterator).
- `src/scenes/GameScene.ts` — build the Base VISUAL; back-ref the F2-emitted `solidBodies` BASE body
  (`baseRef`); the FX; the present-players-scoped lives/respawn; register the F3 overlaps/colliders
  (bullet×`solidBodies` — incl. the eagle branch — and bullet×tank; NO separate base or water overlap);
  resolve every pair; the dt/gdt split + the bullet×bullet scan + the FX tick + the
  `gameOver`/`transitioning` one-shot guards.

**Unchanged:** `src/world/LevelGenerator.ts`, `src/world/TileMap.ts`, `src/config/tiles.ts`,
`src/config/stages.ts`, `src/core/Input.ts`, `src/util/rng.ts`, `src/util/save.ts`, the other scenes,
`scripts/verify-gen.mjs` (F3 adds NO headless assertions — its logic is Phaser-coupled, AC11).

---

## 7. Verification

How `typecheck`/`build`/`verify` + targeted greps + a manual drive-test prove each AC:

- **AC1 (brick erosion)** — `npm run dev`: shoot a brick wall — one quarter-brick vanishes per hit,
  four hits clear a tile; the bullet despawns on impact. Code (read the bullet×solids callback): on
  `tileKind === TILE.BRICK` it calls `tileMap.destroyBrickSubCell(tileCol,tileRow,subCol,subRow)` from
  the struck body's tags, DEFERRED via `time.delayedCall(0)`; the bullet is `release`d.
- **AC2 (steel despawns, no damage)** — `npm run dev`: shoot a steel block — the bullet vanishes, the
  steel is unchanged; an explosion pops. Code: the steel branch does NO `destroyBrickSubCell`, only the
  explosion + `release` (no `bullet.power` flag exists — D4).
- **AC3 (water passes)** — `npm run dev`: shoot across water — the bullet flies over it and hits what's
  beyond; a tank still can't drive into water. Code: NO `physics.add.overlap` is registered against
  `tileMap.waterBodies` (grep the scene → only `solidBodies` and the per-tank colliders are overlap
  targets; the eagle rides inside `solidBodies`, so there is NO `waterBodies` and NO separate base
  overlap); the F2 tank×water collider is kept.
- **AC4 (bullet × bullet)** — `npm run dev`: two tanks firing head-on — the bullets annihilate at the
  meet point (neither passes). Code: `_scanBulletVsBullet` releases BOTH on an AABB overlap of
  opposing-side shots; same-side skipped (FF off).
- **AC5 (bullet × tank, armor multi-hit)** — manual: spawn a second player tank (`TWO_PLAYER`), flip
  `FRIENDLY_FIRE` to `true` temporarily and shoot it — it takes `BULLET_DAMAGE`; a `hp:1` tank dies in
  one, an `hp:3` (armor, set in a scratch test) survives three. Code: the bullet×tank callback gates on
  `isHittable()` + the FF filter, then `tank.onHit(BULLET_DAMAGE)`; `onHit` subtracts HP + runs the
  death path once at ≤0.
- **AC6 (eagle → GAME OVER once)** — `npm run dev`: shoot the eagle — it turns to rubble and the scene
  transitions to GAME OVER exactly once (spamming the base does not double-transition). Code: the
  bullet×`solidBodies` callback's `tileKind===TILE.BASE` branch calls `solidRect.baseRef.onHit()`
  (the F2-emitted BASE body, back-reffed in `create()`); `Base.onHit` flips `destroyed` under a guard
  → `onDestroyed` → `_triggerGameOver` which is gated by the one-shot `gameOver` flag. Grep the scene:
  it registers NO separate bullet×base overlap and creates NO second base body — there is exactly the
  one F2 `solidBodies` BASE body, tagged `tileKind=TILE.BASE`, with a `baseRef` back-pointer.
- **AC7 (pooled explosions)** — read `ParticlePool`: a fixed member array built in the ctor; `spawnSparks`
  reuses slots via the rotating cursor (no `new`); `tick` integrates+fades with no steady-state alloc.
  `npm run dev`: sustained firing shows no GC stutter; bursts fade and recycle.
- **AC8 (death costs a life + i-frames; solo run-over reachable)** — manual (FF on, two players): kill
  a player tank — a kill burst pops, a life is spent, it respawns at its spawn blinking + invulnerable
  for `SPAWN_IFRAME`s (shooting it during the blink does nothing). Code: `onDeath` decrements
  `lives[slot]` + `respawnAt` (arms `spawnIframe`); `isHittable()` is false while it ticks. SOLO
  run-over (the reviewer's fix): with `TWO_PLAYER=false`, `lives` is seeded `{1: START_LIVES}` ONLY
  (no `2` key), and `_checkRunOver` iterates `Object.keys(lives)` (just `[1]`), so spending P1's last
  life triggers `_triggerGameOver` — a solo run CAN end on lives, not only on the eagle. Grep the
  scene: `lives[2]` is assigned ONLY inside the `TWO_PLAYER` branch; `_checkRunOver` loops the seeded
  keys, never a literal `{1,2}`.
- **AC9 (friendly-fire OFF)** — `npm run dev` (default `FRIENDLY_FIRE=false`, two players): a P1 bullet
  passes straight through P2's tank (no damage, no despawn); two same-side bullets don't cancel. Code:
  both filters early-return on `ownerSide === side && !FRIENDLY_FIRE`.
- **AC10 (deferred teardown + guards)** — read the callbacks: the brick chip (the ONE body-destroying
  resolution) is in a `time.delayedCall(0)` closure (never destroyed inside the overlap). The eagle
  branch destroys NO body — the BASE body stays as tank-blocking rubble — so it needs no defer; it just
  flips `Base.destroyed` under a guard and fires the (idempotent) `_triggerGameOver`. `_triggerGameOver`
  is `gameOver`-guarded; `release` only disables a body (safe inside iteration). Grep the scene for
  `delayedCall(0)` (present on the brick-chip path) and `if (this.gameOver) return` (present in
  `_triggerGameOver`).
- **AC11 (green gate / pure-coupled split / offline)** — `npm run typecheck` exits 0 (strict); `npm run
  build` exits 0; `npm run verify` prints OK + exits 0 (its pure sweep unchanged — re-proving no Phaser
  leaked into a pure module). Grep: `effects/*`/`Base.ts`/`Tank.ts`/`BulletPool.ts`/scenes import
  `phaser`; `scripts/verify-gen.mjs` imports NONE of them; `constants.ts` has no `import 'phaser'`.
  Grep scenes/entities/effects for `load.` (none); only rectangles/Graphics drawn. Runs from `file://`.

**Definition of done:** `npm run typecheck`, `npm run build`, and `npm run verify` all exit 0; a manual
`npm run dev` drive-test confirms AC1–AC10 (brick erodes per sub-cell, steel resists, bullets pass
water, bullets cancel, the eagle's destruction ends the run exactly once, explosions are pooled, a
killed player costs a life + respawns with i-frames, friendly-fire is off); the pure/coupled split is
preserved and every destructive teardown is deferred out of its overlap callback under a one-shot guard.

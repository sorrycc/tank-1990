# Tank 1990 — F8 Visual richness (textured programmer-art tanks + terrain)

> Design doc for **F8 Visual richness**, a focused PRESENTATION pass over the finished Tank 1990. Format
> mirrors the existing design docs: Background → Requirements → Acceptance → Decisions → Design → Files →
> Verification. F1 made a drivable tank (one flat visible rect + a barrel marker over an invisible
> collider). F2 built the seeded stage; F7 added stage motifs/pause/juice. **F8 is purely cosmetic:** it
> replaces the FLAT solid-rectangle rendering of the tank and the terrain with richer PROGRAMMER-ART
> detail (composed Phaser primitives ONLY — no external asset / `load.*`), with ZERO change to any Arcade
> body, passability, collider, the no-diagonal movement spine, or the pure/coupled split. It is COUPLED
> code (Tank.ts + TileMap.ts) the headless verifier never imports, so the gate is typecheck + build green
> + leak-free teardown.

---

## 1. Background

Through F7 the game is complete + playable, but it reads FLAT: every tank is one solid square + a barrel
stub, and every terrain tile is one solid fill (brick = 4 plain sub-cell squares, steel/water/trees one
flat rect). The classic Battle City silhouette (a hull with tread strips + a turret) and the textured
terrain (brick mortar lines, steel rivets/bevel, rippling water, dappled trees) are missing. F8 adds that
readable detail with COMPOSED primitives — no sprite sheet, no asset load (the "programmer-art only"
constraint stays intact).

Two files own all the visible terrain/tank rendering, so F8 touches exactly two:

- **`src/entities/Tank.ts`** still owns the collider/visual split (the collider is the invisible rect that
  owns the Arcade body; the visible art is positioned to the body center each frame). F8 swaps the single
  visible square for a small set of child primitives, preserving every existing visual cue.
- **`src/world/TileMap.ts`** builds the terrain GameObjects. F8 layers DECORATION-only detail over the
  existing tiles (no body / passability change), tracking every new object/tween so `destroy()` stays
  leak-free across the stage→stage rebuild.

---

## 2. Requirements Summary

**Goal:** richer programmer-art rendering of tanks + terrain, with NO gameplay/body/collider change.

**In scope (F8):**

- **`src/entities/Tank.ts` (CHANGED, Phaser-coupled):** keep `collider` (the invisible body owner)
  UNCHANGED. Replace the single visible `rect` Rectangle with a `Phaser.GameObjects.Container` (still named
  `rect` so GameScene's `setVisible`/`destroy` contract is byte-unchanged) holding child primitives built
  ONCE: a HULL rect, two TREAD strips, a TURRET block, plus the existing `barrel` (now a container child).
  Per frame: position the container to the body center + rotate it by facing (cheap — no per-frame
  allocation). Route every cue that used to call `this.rect.setFillStyle`/`setAlpha` to the HULL element
  (spawn-iframe blink → container alpha; carrier flash → hull fill; boss telegraph → hull + barrel fill).
  `spec.color` stays the hull fill. Death/respawn `setVisible` hides/shows the whole container.
- **`src/world/TileMap.ts` (CHANGED, Phaser-coupled):** texture the terrain (DECORATION ONLY — no body /
  passability change): BRICK gets darker mortar lines; STEEL a lighter bevel edge + corner rivet dots;
  WATER a cheap two-tone ripple via a slow tween; TREES a dappled canopy (lighter/darker blobs) still drawn
  ABOVE tanks at `DEPTH_TREES`. Track EVERY new decoration object + the ripple tween so `destroy()` tears it
  all down (the stage→stage rebuild leaks nothing).

**Out of scope:** any Arcade body / passability / collider / movement change; any new tile kind; any
external asset / `load.*`; any change to the pure generator, the verifier, the i18n, or the constants
(F8 adds NO shared number — the decoration sizes are local render constants in their owning file). The
brick sub-cell EROSION seam (`destroyBrickSubCell`) is left as-is — the mortar lines are loose decorations
that are NOT re-removed on a chip (a chipped sub-cell hides its body+rect; a stray mortar line over an
eroded cell is acceptable cosmetic noise — wiring per-sub-cell mortar teardown is YAGNI for a polish pass).

---

## 3. Acceptance Criteria

1. **AC1 — the tank has a readable silhouette.** The visible tank is a composed Container (hull + two tread
   strips + a turret + the barrel), oriented by facing, positioned to the body center each frame. The
   invisible `collider` (the Arcade body owner) is UNCHANGED.
2. **AC2 — every existing cue still reads.** Spawn-iframe blink (alpha), carrier red-flash
   (`spec.color`↔`spec.colorFlash`), and the boss telegraph (`TELEGRAPH_FILL` on body + barrel) all still
   fire — routed to the hull (+ barrel for the telegraph). `spec.color` is the hull fill. Death/respawn
   `setVisible` hides/shows the whole visual.
3. **AC3 — cheap.** Child shapes are built ONCE in the ctor; per frame only reposition/rotate (no
   per-frame `add.*`).
4. **AC4 — terrain is textured (decoration only).** BRICK shows mortar lines; STEEL a bevel + rivets;
   WATER a slow two-tone ripple; TREES a dappled canopy ABOVE tanks. NO Arcade body / passability changes.
5. **AC5 — leak-free teardown.** Every new decoration GameObject + the ripple tween is tracked +
   destroyed/killed in `TileMap.destroy()` (the stage→stage rebuild leaks nothing).
6. **AC6 — green gate + offline.** `npm run typecheck` + `npm run verify` + `npm run build` all exit 0.
   No external asset / `load.*`. The pure/coupled split is unchanged (the verifier never imports Tank.ts /
   TileMap.ts — they stay Phaser-coupled).

---

## 4. Decision Log

1. **D1 — The visible tank becomes a Container (still named `rect`), keeping GameScene's contract.** The
   spec calls for composed primitives positioned to the body center + oriented by facing. A
   `Phaser.GameObjects.Container` is the KISS holder: `setVisible`/`destroy`/`setPosition`/`setAlpha`/
   `setRotation` all cascade to children, so GameScene's existing `tank.rect.setVisible(false)` /
   `tank.rect.destroy()` calls work UNCHANGED (no GameScene edit). The cues that called `rect.setFillStyle`
   route to a stored `hull` child (a Rectangle that DOES have setFillStyle). DRY/KISS — one rename of the
   field's TYPE, no new public surface.
2. **D2 — Children are LOCAL-SPACE + the container rotates; built once.** The four child shapes are drawn
   ONCE in the ctor in the canonical "facing up" local frame (centered on 0,0). Each frame `update`/
   `_orientBarrel` set the container's position (body center) + rotation (0/90/180/270° by facing). This
   kills the per-frame `setSize`/reposition the old flat barrel did and matches the "build once, only
   reposition/rotate" cost requirement (AC3). The barrel is a child too, so it rotates WITH the hull (the
   facing cue is structural — the turret + barrel always point the driven way).
3. **D3 — The alpha cue goes on the CONTAINER, the fill cues on the HULL.** The spawn-iframe blink set the
   old rect's ALPHA; a Container's `setAlpha` fades all children (the whole tank blinks — the same read).
   The carrier flash + the boss telegraph set the FILL; only a Rectangle has `setFillStyle`, so they target
   `hull` (the telegraph also recolors `barrel`, a Rectangle). The two channels never fight (alpha on the
   container, fill on the hull) — the same separation the old code relied on.
4. **D4 — Terrain detail is DECORATION ONLY — no body / passability touch.** TileMap already separates the
   tank-blocking bodies (`solidBodies`/`waterBodies`) from the bodiless decorations (`_objects`). F8 adds
   the textures as loose, bodiless GameObjects layered over the EXISTING body rects (mortar lines over the
   brick sub-cells, bevel/rivets over the steel rect, a ripple overlay over the water rect, canopy blobs
   over the trees rect) — so no passability or body changes (AC4). KISS — the existing per-cell builders
   gain a few `_objects.push(...)` decorations.
5. **D5 — Water ripple is ONE slow scene tween on a tracked overlay, killed in destroy().** The cheapest
   "animated" water is a single overlay Rectangle per water tile whose alpha tweens between two values on a
   slow yoyo loop (a two-tone shimmer). The tween handles are tracked in `_waterTweens` + killed in
   `destroy()` BEFORE the objects go (so a stage rebuild leaks no live tween). YAGNI — no per-frame ripple
   math, no timer; the tween engine ticks it for free + Phaser pauses tweens with the scene.
6. **D6 — No new shared constant.** The decoration sizes/colors are LOCAL render constants in each owning
   file (the mortar/rivet/canopy palette in TileMap; the hull/tread/turret geometry in Tank), exactly like
   the existing `BARREL_*`/`DEPTH_*` locals. They are used by ONE file each, so the constants.ts owner
   (shared numbers only) stays untouched (DRY — a single-file number does not belong in the shared owner).

---

## 5. Design

### 5.1 Tank silhouette (`src/entities/Tank.ts`)

- **Fields:** `rect` retyped to `Phaser.GameObjects.Container`; add a private `hull`
  (`Phaser.GameObjects.Rectangle`) field for the fill cues. `barrel` stays a `Rectangle` (now a container
  child). `collider`/`body` UNCHANGED.
- **Ctor:** build the container at the body center; build hull (a near-tile rect, `spec.color`), two tread
  strips (a darker tint, down the left/right sides), a turret (a small lighter block centered), and the
  barrel — ALL in local space (origin 0,0 = body center, canonical facing up). `container.add([...])`.
  `_orientBarrel()` → `_orient()` sets the container rotation for the initial facing.
- **Per frame (`update` step 5):** `this.rect.setPosition(cx, cy)` + `_orient()` (set container rotation by
  facing). The barrel no longer needs its own per-frame resize/reposition (it rides the container).
- **Cues:** the spawn-iframe blink calls `this.rect.setAlpha(...)` (container — fades all children); the
  carrier flash calls `this.hull.setFillStyle(...)`; the boss telegraph calls `this.hull.setFillStyle(...)`
  + `this.barrel.setFillStyle(...)`. `respawnAt` restores `this.rect.setAlpha(1)` + `this.hull.setFillStyle
  (spec.color)` + `this.barrel.setFillStyle(BARREL_COLOR)` (a defensive reset so a respawn clears a
  mid-telegraph/flash tint) and `setVisible(true)`. `onHit` death hides the container (`rect.setVisible
  (false)`) — the barrel rides it (the separate `barrel.setVisible(false)` in GameScene stays a harmless
  no-op since it's a child of the now-hidden container; left for clarity).

### 5.2 Terrain texture (`src/world/TileMap.ts`)

- **BRICK (`_addBrickSubCell`):** after adding the body rect, push ONE thin darker MORTAR line decoration
  per sub-cell (a horizontal + vertical hairline, a darker tint of the brick color) into `_objects` at
  `DEPTH_TERRAIN` (just over the body). Decoration only — the body/erosion seam is unchanged.
- **STEEL (`_addSolidTile`, kind === STEEL):** push a lighter BEVEL edge (a thin inset frame rect, lighter
  tint) + four small RIVET dots at the corners into `_objects`. BASE keeps its plain fill (the eagle reads
  on its own).
- **WATER (`_addWaterTile`):** push a two-tone RIPPLE overlay rect (a lighter tint, partial alpha) into
  `_objects` + start a slow yoyo alpha tween on it (`scene.tweens.add`), tracking the tween in a new
  `_waterTweens` array.
- **TREES (`_addDecoration`, kind === TREES):** push a couple of lighter/darker CANOPY blobs at
  `DEPTH_TREES` (above tanks) into `_objects` so the canopy reads dappled.
- **`destroy()`:** kill every `_waterTweens` tween FIRST (so no live tween references a destroyed object),
  then the existing `_objects` loop destroys every decoration (mortar/bevel/rivets/ripple/canopy) — the
  rebuild leaks nothing (AC5). `_waterTweens` is nulled like the other tracked collections.

### 5.3 What does NOT change

The Arcade bodies, the `solidBodies`/`waterBodies` groups, passability, `destroyBrickSubCell` erosion, the
F5 fortify/revert seam, the no-diagonal movement spine, the collider, GameScene, the pure generator, the
verifier, i18n, and constants.ts are all UNCHANGED. F8 is render-only.

---

## 6. Files

**Changed:**

- `src/entities/Tank.ts` — the visible tank becomes a composed Container (hull + treads + turret + barrel)
  oriented by facing; cues routed to the hull/container.
- `src/world/TileMap.ts` — brick mortar / steel bevel+rivets / water ripple / tree canopy decorations +
  the ripple tween, all tracked + torn down in `destroy()`.
- `docs/designs/2026-06-19-visual-richness.md` — this design doc.

---

## 7. Verification

- **AC1/AC2/AC3 (tank) — `npm run typecheck` + `npm run build` + grep + manual drive.** The container build
  is once-in-ctor; the cues compile against the hull/container. Manual `npm run dev`: drive a tank (the
  silhouette rotates by facing); a fresh respawn blinks; a carrier flashes; the boss telegraphs.
- **AC4/AC5 (terrain) — `npm run build` + manual drive.** Brick shows mortar, steel shows rivets/bevel,
  water ripples, trees are dappled + above tanks. Advance a stage (the rebuild) repeatedly — no leak
  (every decoration + the ripple tween is destroyed/killed in `destroy()`).
- **AC6 (green gate) — `npm run typecheck` && `npm run verify` && `npm run build`.** All exit 0. The
  verifier (which imports the pure generator/constants, NOT Tank.ts/TileMap.ts) is byte-unchanged — F8
  touches only coupled render code, so its assertions are untouched. No `load.*`; offline.

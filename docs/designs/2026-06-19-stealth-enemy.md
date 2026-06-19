# Tank 1990 — STEALTH enemy archetype [stealth-enemy]

> A new ENEMY ARCHETYPE over the finished Tank 1990 roster. Format mirrors the read-only reference design
> docs (and the F-feature siblings under `docs/designs/`): Background → Requirements → Acceptance Criteria →
> Decision Log → Design → Files → Verification. It adds a 5th weighted enemy TankSpec (`STEALTH`) — a new
> `behavior` TAG on the ONE Tank FSM, distinct on a REAL stat — plus a render-only visibility cue in
> `entities/Tank.ts`, the roster wiring (`tanks.ts` + `stages.ts`), the verifier's archetype sweep, and one
> i18n key per locale. The pure/coupled split is preserved (the new spec data is PURE; the alpha cue is
> coupled). KISS/YAGNI/DRY/SOLID.

---

## 1. Background

Classic Battle City has no stealth tank, but the project already ships everything a stealth archetype needs:
TREES tiles render at `DEPTH_TREES` (50) ABOVE tanks (the overdraw-cover decoration — `world/TileMap.ts`),
the ONE Tank FSM reads any `TankSpec` by a `behavior` TAG (never subclasses — `config/tanks.ts` D2), and the
Tank already owns a scene-injected tile-kind probe `onSampleTile(x,y)` (the F-ice-slide seam — today wired
only on player tanks). A STEALTH tank rides all three: it is a normal spec with one distinguishing stat, and
its only NEW behaviour is a presentation cue — it drops to a low alpha when it is sitting on TREES and NOT
moving or firing, so it melts into the canopy (the trees already overdraw it) and reappears the instant it
breaks cover or shoots. That cue is a render-only branch in `Tank.update()` exactly like the existing
carrier-pulse / telegraph / hit-flash / spawn-blink cues — it touches only `setAlpha`, never the physics
body or the verifier-imported pure path.

The roster is the only structurally interesting part: the four classic ids (`basic/fast/power/armor`) are
hard-wired in the `EnemyWeights` interface, in `ENEMY_ARCHETYPES`/`ENEMY_SPECS`, in `stageConfig`'s
`enemyWeights`, in `rosterPick`'s id list, in `hardShare`, and — load-bearing — in the verifier (the 7c
distinctness loop over `[BASIC,FAST,POWER,ARMOR]`, the `ENEMY_ARCHETYPES.length !== 4` pin at line 567, and
the all-zero degenerate roster test). Adding a 5th id means threading it through every one of those single
sources of truth (DRY) AND retuning the two verifier pins that hard-code "4 / the four ids" — both stay green
by re-deriving against the REAL source, never by handwave.

---

## 2. Requirements Summary

**Goal:** Add a STEALTH enemy archetype — a 5th weighted `TankSpec` (a `'stealth'` behaviour TAG on the ONE
Tank FSM, distinct on a real stat), nearly invisible while resting on TREES, visible when moving in the open
or firing — wired into the roster sensibly (appears but not overwhelming) with all verifier invariants green.

**In scope:**

- **`src/config/tanks.ts` (PURE, CHANGED):** add the `'stealth'` tag to `TankBehavior`; add a `STEALTH`
  `TankSpec` distinct on a REAL swept stat (`moveSpeed`); add it to `ENEMY_SPECS` + `ENEMY_ARCHETYPES`; add
  `stealth` to the `EnemyWeights` interface + `rosterPick`'s id list. NO Phaser import.
- **`src/config/stages.ts` (PURE, CHANGED):** add `stealth` to `StageConfig.enemyWeights` + the per-stage
  ramp (a sensible base + a gentle climb) and include it in `hardShare`'s denominator (it is an EASY-share
  type — see D5). NO Phaser import.
- **`src/entities/Tank.ts` (Phaser-coupled, CHANGED):** wire the stealth visibility cue — a render-only
  ALPHA branch (NOT a fill cue): when `behavior === 'stealth'`, the tank is centered on TREES, is idle (no
  velocity) and not firing/telegraphing, fade the container to `STEALTH_HIDDEN_ALPHA`; otherwise full alpha.
  Reuses the existing `onSampleTile` probe. NEVER verifier-imported.
- **`src/scenes/GameScene.ts` (Phaser-coupled, CHANGED):** wire `onSampleTile` on the spawned ENEMY tank too
  (today only players get it) so the stealth cue can sample TREES; track its `lastFiredAt`/idle if needed via
  existing state (see D3 — no new field). One line in `_spawnStep`.
- **`scripts/verify-gen.mjs` (CHANGED):** retune the two hard-coded "four enemy types" pins to the REAL
  source — sweep `ENEMY_ARCHETYPES` (not a literal `[BASIC,FAST,POWER,ARMOR]`) for pairwise distinctness, and
  assert `ENEMY_ARCHETYPES.length === ENEMY_SPECS` key count (a non-boss-roster count derived from the data,
  not a magic `4`); thread `stealth` into the all-zero degenerate roster object.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED):** add `bonus.stealth` to BOTH (the stage-bonus tally
  reads `t('bonus.${id}')` per killed type — a missing key would render a literal `bonus.stealth`).

**Out of scope:** a new TILE / a new TREES variant (the existing TREES + its `DEPTH_TREES` overdraw IS the
concealment — YAGNI); any AI change (stealth uses the SAME wander/seek FSM — distinctness is a stat + the
render cue, not new AI); a new pure constant in `constants.ts` for the stealth ALPHA/base-weights (the alpha
is LOCAL render-only feel owned by `Tank.ts` like its `HIT_FLASH_*`/`DAMAGED_TINT` locals; the roster weights
are owned by `stages.ts` like every other ramp — D6); making stealth multi-hit (it is a 1-HP tank — its
distinguishing stat is `moveSpeed`, NOT HP, so it never collides with ARMOR's "the multi-hit tank" verifier
pin); the boss roster (the boss stays the ONE explicit non-weighted spec — unchanged).

---

## 3. Acceptance Criteria

1. **AC1 — STEALTH is a distinct, well-formed weighted archetype.** `STEALTH` is a valid `TankSpec` with the
   `'stealth'` behaviour, present in `ENEMY_SPECS` + `ENEMY_ARCHETYPES`, pairwise-distinct from every other
   archetype on `{moveSpeed,bulletSpeed,maxHp}` (it sets a `moveSpeed` no other type shares). `rosterPick`
   can return `'stealth'` and ONLY ever returns a known `ENEMY_SPECS` key.
2. **AC2 — it conceals on TREES and reveals on move/fire.** A `'stealth'` enemy centered on a TREES cell while
   idle (zero velocity, not firing/telegraphing) renders at a low alpha (it melts under the canopy the trees
   already overdraw); the instant it moves, fires, or leaves TREES it is at full alpha. The cue touches ONLY
   the container alpha — never the physics body, the fill, or `isHittable()` (it is still a normal target).
3. **AC3 — the roster appears but is not overwhelming + stays monotone-bounded.** Every stage's
   `enemyWeights` gains a `stealth` field with a sensible base + a gentle non-negative ramp; the NORMALIZED
   `hardShare` stays non-decreasing across `stageConfig(0..K)` (stealth counts in the denominator as an easy
   type — D5), so the existing monotonicity gate is unbroken.
4. **AC4 — green gate + pure/coupled split.** `npm run typecheck` (strict) + `npm run build` exit 0;
   `npm run verify` prints OK + exits 0. `tanks.ts`/`stages.ts` stay PURE (the verifier node-imports them);
   the verifier's archetype distinctness + length pins are re-derived from `ENEMY_ARCHETYPES`/`ENEMY_SPECS`
   (the REAL source), so the 5-type roster passes honestly. `Tank.ts`/`GameScene.ts` are never
   verifier-imported, so the alpha cue + the spawn wiring are invisible to the gate.
5. **AC5 — i18n complete.** `bonus.stealth` exists in BOTH `en.ts` and `zh-CN.ts`, read via `t()`; the
   stage-bonus tally shows a localized STEALTH row when stealth tanks were killed.

---

## 4. Decision Log

1. **D1 — STEALTH is a 5th SPEC + a `'stealth'` TAG on the ONE Tank FSM, never a subclass.** The roster
   header (`tanks.ts` D2) locks "the enemy types are a `behavior` TAG + a spec — NEVER subclasses; the SAME
   Tank entity reads any spec." STEALTH follows that exactly: a new tag in `TankBehavior`, a new `TankSpec`
   row, into `ENEMY_SPECS`/`ENEMY_ARCHETYPES`. *Rationale:* the movement/AI/combat spine is reused for FREE
   (DRY/SOLID); the only NEW code is the render cue (D2). Adding the tag to the verifier's `KNOWN_BEHAVIORS`
   set keeps 7a well-formedness green.
2. **D2 — the visibility cue is a render-only ALPHA branch in `Tank.update()`, like the existing cues.**
   `update()` already owns an alpha cue (the spawn-iframe blink → `rect.setAlpha`) and a mutually-exclusive
   FILL-cue chain (carrier/telegraph/hit-flash/HP-tint → `hull.setFillStyle`). The stealth cue is the
   carrier/telegraph ANALOGUE but on the ALPHA channel: gated on `behavior === 'stealth'` and `spawnIframe
   <= 0` (the spawn-blink owns the alpha while it ticks — D3 of the HP-tint doc), fade the CONTAINER to
   `STEALTH_HIDDEN_ALPHA` when concealed, else restore full alpha. *Rationale:* it reuses the proven cue
   pattern, writes a DIFFERENT visual channel than the fill chain (so it never fights it), and — because the
   spawn-blink also writes alpha — it is explicitly gated OFF the spawn-iframe window so at most one alpha
   writer runs per frame (the same discipline the fill chain documents). KISS — a pure per-frame derivation
   of `onSampleTile` + body velocity, no new timer.
3. **D3 — "concealed" = on TREES AND idle AND not firing — derived from state the Tank already owns.** The
   tank is concealed iff: `onSampleTile(center) === TILE.TREES` (it must be UNDER the canopy), AND the body
   is at rest (`body.velocity.x === 0 && body.velocity.y === 0` — it is not "moving in the open"), AND it is
   not actively winding up/just-fired (reuse the existing `telegraphing` flag and the `cooldownTimer`/
   `liveBullets` it already tracks — a tank with a live bullet out or a freshly-armed cooldown reads as
   "firing", so it flashes visible). *Rationale:* every input is existing per-tank state — NO new field, NO
   new ctx (YAGNI). The scene must wire `onSampleTile` on the enemy too (D4), but a null probe (any tank the
   scene doesn't wire) simply never conceals — fully backward-compatible.
4. **D4 — the scene wires `onSampleTile` on the spawned ENEMY tank.** Today `_spawnStep` wires the probe only
   on players (the ice-slide seam). The stealth cue needs the enemy to sample TREES, so add
   `enemy.onSampleTile = (px,py) => this._tileKindAt(px,py)` in `_spawnStep` (the SAME closure players use —
   DRY, the same SOLID "scene owns the tilemap, Tank sees only a tile-kind int" contract). *Rationale:*
   wiring it on every enemy is harmless for non-stealth types (the F-ice-slide glide is gated on TILE.ICE +
   only meaningful for the player's momentum feel, but enemies have no glide momentum to carry — the probe is
   ONLY read by the new stealth branch for non-stealth enemies it is inert), and it is one line vs. a
   stealth-only special case (KISS). The ice-glide path for enemies stays a no-op because enemies release
   keys instantly via the AI intent — but to be safe the design keeps the glide unaffected (the stealth
   branch only READS the probe; it does not touch the drive step).
5. **D5 — STEALTH counts as an EASY-share type in `hardShare`; its ramp is gentle so it appears but does not
   swamp.** `hardShare = (power + armor) / (basic + fast + power + armor)` is the monotone quantity the
   verifier pins (D16). Adding `stealth` to the DENOMINATOR only (an easy-share type — it is a 1-HP, slightly
   off-speed grunt, not a "hard" power/armor) keeps `hardShare` well-defined; to keep it NON-DECREASING, the
   stealth weight ramp must be NON-INCREASING-or-flat relative to the hard climb — simplest correct choice: a
   small FLAT-or-tapering `stealth` weight (like `basic`/`fast`), so the hard share still rises monotonically.
   *Rationale:* the verifier re-derives `hardShare` from the SAME exported function (DRY), so as long as
   stealth lands on the easy side with a flat/tapering ramp, the existing monotonicity sweep passes by
   construction. A sensible base (e.g. ~3, between `fast`'s 6 and `armor`'s 1) + a gentle taper makes stealth
   a regular-but-uncommon sight, not overwhelming (AC3).
6. **D6 — the new numbers live with their existing owners; NO new `constants.ts` entries.** The stealth ALPHA
   (`STEALTH_HIDDEN_ALPHA`) is LOCAL render-only feel owned by `Tank.ts` — exactly like its `HIT_FLASH_SEC`/
   `HIT_FLASH_COLOR`/`DAMAGED_TINT` locals (their D6: "LOCAL render constants owned by this ONE file — not
   shared, so they do NOT belong in the constants.ts owner"). The roster base-weights + ramps are owned by
   `stages.ts` (the `*_BASE`/`*_PER_STAGE` privates), like every other axis. The spec's stat values anchor on
   the existing `constants.ts` owners (`TANK_SPEED`/`BULLET_SPEED`/`TANK_MAX_HP`) so no duplicate base number
   is introduced (DRY). *Rationale:* keeps the verifier-imported pure path free of a new presentation number
   and matches each file's established ownership discipline.
7. **D7 — STEALTH's distinguishing stat is `moveSpeed` (a slow creeper), NOT HP.** The verifier's 7c pins
   pairwise distinctness on `{moveSpeed,bulletSpeed,maxHp}`. STEALTH stays 1-HP (so it never collides with
   ARMOR's "the multi-hit tank" pin and is the classic "one hit kills it" ambusher) and reads as a SLOW
   creeper — a `moveSpeed` strictly between/below the others, distinct from BASIC's `TANK_SPEED`, FAST's
   `×1.75`, etc. *Rationale:* a slow tank that hides in trees and pops out is the readable fantasy; it is a
   real swept stat (distinctness is a DATA check), so the 7c loop passes.

---

## 5. Design

### 5.1 The STEALTH spec (`config/tanks.ts`, PURE)

- `TankBehavior` gains `'stealth'`.
- `STEALTH: TankSpec` — `id: 'stealth'`, `behavior: 'stealth'`, `maxHp: TANK_MAX_HP` (1 — one-hit),
  `moveSpeed` a slow creeper distinct from every other type (e.g. `Math.round(TANK_SPEED * 0.8)` — below
  BASIC, so the `{moveSpeed,...}` distinctness holds), `bulletSpeed: BULLET_SPEED`, a measured `fireCooldown`,
  `maxBullets: 1`, a muted programmer-art `color`/`colorFlash` (render-only — D1 of the roster header), a
  `scoreValue` (e.g. 300 — an ambusher worth a touch more than a grunt).
- `ENEMY_SPECS` gains `stealth: STEALTH`; `ENEMY_ARCHETYPES` gains `STEALTH`; `EnemyWeights` gains
  `stealth: number`; `rosterPick`'s `ids` list gains `'stealth'` (so it can be picked + the floating-point
  tail guard still returns a known id).

### 5.2 The roster ramp (`config/stages.ts`, PURE)

- `StageConfig.enemyWeights` gains `stealth: number`.
- A `STEALTH_BASE` + `STEALTH_PER_STAGE` private (a small base ~3, a flat or gently-tapering ramp clamped ≥ 1
  like `basic`/`fast`), folded into `stageConfig`'s `enemyWeights.stealth`.
- `hardShare` adds `stealth` to the DENOMINATOR total ONLY (easy-share — D5); the numerator stays
  `power + armor`. The existing monotonicity sweep passes by construction (D5).

### 5.3 The visibility cue (`entities/Tank.ts`, Phaser-coupled)

- A LOCAL render constant `STEALTH_HIDDEN_ALPHA` (~0.12 — nearly invisible but a faint ghost) near the
  `HIT_FLASH_*`/`DAMAGED_TINT` locals, with an intent comment (D6).
- In `update()`'s visual section, AFTER the spawn-iframe alpha branch and gated on `spawnIframe <= 0` (so the
  spawn-blink owns the alpha first — D2): if `behavior === 'stealth'`, compute `concealed` (D3 — on TREES +
  zero body velocity + not telegraphing + no live shot/fresh cooldown) and `rect.setAlpha(concealed ?
  STEALTH_HIDDEN_ALPHA : 1)`. A non-stealth tank never enters this branch (byte-unchanged). The branch reads
  `this.onSampleTile?.(center)` — a null probe (un-wired tank) never conceals.

### 5.4 Scene wiring (`scenes/GameScene.ts`, Phaser-coupled)

- In `_spawnStep`, after constructing the enemy: `enemy.onSampleTile = (px, py) => this._tileKindAt(px, py)`
  (the SAME closure the player gets — D4). One line; inert for non-stealth enemies (only the stealth branch
  reads it).

### 5.5 Verifier (`scripts/verify-gen.mjs`)

- 7c distinctness: sweep `ENEMY_ARCHETYPES` (re-derived from the real source) for pairwise distinctness on
  `{moveSpeed,bulletSpeed,maxHp}` instead of the literal `[BASIC,FAST,POWER,ARMOR]` — so the 5th type is
  checked and a future 6th needs no edit (DRY).
- The `ENEMY_ARCHETYPES.length !== 4` pin (line 567) becomes `ENEMY_ARCHETYPES.length !==
  Object.keys(ENEMY_SPECS).length` (the roster + the lookup table must agree — derived, not a magic `4`),
  keeping the "boss absent from the roster" intent (the boss is still absent from both).
- The all-zero degenerate roster object gains `stealth: 0`.
- `hardShare` import + sweep are UNCHANGED (it reads the exported fn — D5).

### 5.6 What does NOT change

The Tank movement/AI/combat spine, `isHittable`/`onHit` (stealth is a normal 1-HP target — concealment is
visual only), the fill-cue chain, the boss roster (still the ONE explicit non-weighted spec), the
determinism pins, `applyStarTier`, every other archetype, and the F2 generator. The verifier's purity proof
is unchanged (the new spec data is PURE — it node-imports fine).

---

## 6. Files

**Changed:**

- `src/config/tanks.ts` (PURE) — `'stealth'` tag + `STEALTH` spec + roster/`EnemyWeights`/`rosterPick` wiring.
- `src/config/stages.ts` (PURE) — `stealth` weight field + ramp + `hardShare` denominator.
- `src/entities/Tank.ts` (coupled) — `STEALTH_HIDDEN_ALPHA` local + the gated stealth alpha cue in `update()`.
- `src/scenes/GameScene.ts` (coupled) — wire `onSampleTile` on the spawned enemy (one line).
- `scripts/verify-gen.mjs` — re-derive the 7c distinctness sweep + the archetype-count pin; `stealth: 0` in
  the degenerate roster.
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — `bonus.stealth`.

**New:**

- `docs/designs/2026-06-19-stealth-enemy.md` — this design doc.

---

## 7. Verification

- **AC1/AC3/AC4 (data + gate) — `npm run verify`.** The 7c sweep over `ENEMY_ARCHETYPES` proves STEALTH
  pairwise-distinct; the length pin (now `=== Object.keys(ENEMY_SPECS).length`) proves the roster + lookup
  agree (boss still absent from both); `rosterPick` over the stage weights returns ONLY known ids (now incl.
  `stealth`); the §5 monotonicity sweep proves `hardShare` still non-decreasing with stealth in the
  denominator. `npm run typecheck` + `npm run build` exit 0.
- **AC2 (conceal/reveal) — manual `npm run dev` drive + read.** A stealth tank parked on trees fades to a
  ghost; it snaps to full alpha when it moves, leaves the trees, or fires. The branch reads only
  `rect.setAlpha`, is gated on `spawnIframe <= 0`, and is keyed on `behavior === 'stealth'`, so no other type
  changes and the alpha is never written twice in a frame.
- **AC4 (pure/coupled) — read.** `tanks.ts`/`stages.ts` add NO Phaser import (the verifier node-imports them);
  `Tank.ts`/`GameScene.ts` are never verifier-imported, so the alpha cue + spawn wiring are invisible to the
  gate.
- **AC5 (i18n) — read.** `bonus.stealth` is present in BOTH locales; the tally renders a localized STEALTH row.

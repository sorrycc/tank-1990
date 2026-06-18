# Tank 1990 — HP-stage hull tint for armored/boss tanks

> A small COMBAT-LEGIBILITY fix over the finished Tank 1990. Format mirrors the read-only reference
> `dead-cell` design docs: Background → Requirements → Acceptance Criteria → Decision Log → Design →
> Files → Verification. It changes exactly ONE file — the Phaser-coupled `entities/Tank.ts` (a resting
> hull tint derived from `hp/maxHp`, only for `maxHp > 1` tanks) — and touches NOTHING the headless
> verifier proves (`Tank.ts` is never verifier-imported; the tank spec colours are render-only per
> `tanks.ts`'s own D1 note). KISS/YAGNI/DRY/SOLID.

---

## 1. Background

Classic Battle City visibly degrades the armored tank's appearance as it loses armor — the hull
darkens / changes shade with each surviving hit, so a player can read at a glance how much wall is
left to chew through. Tank 1990 leaves this flat: an ARMOR tank (`ARMOR_TANK_HP` = 4 HP) and
especially the boss (`BOSS_TANK_HP` up to `BOSS_HP_MAX` HP) render at their FULL resting `spec.color`
right up until they pop. The per-hit white flash (the prior fix) gives a momentary "that hit landed"
pop, but the instant it decays the hull is back to full-health colour — so the most important
sustained combat-state signal (how worn down is this wall?) is invisible between flashes.

One small Tank-only change fixes it: a RESTING hull tint that lerps `spec.color` (full HP) toward a
darker/damaged shade as `hp/maxHp` drops, computed ONLY when `maxHp > 1`. Because it is gated on
`maxHp > 1`, the four 1-HP archetypes (basic/fast/power) and the player are byte-UNCHANGED — their
resting fill stays exactly `spec.color`. It rides the existing pure/coupled split (the entity reads
the spec's render-only colour; the verifier never imports `Tank.ts`), reuses the proven `lerpColor`
channel-lerp pattern from `Base.ts`, and adds NO new pure number to the verifier path. It is smaller
and lower-risk than the per-hit flash (no new timer, no `onHit` change — a pure derivation of existing
state), so it is the cleaner of the two combat-legibility cues to land next.

---

## 2. Requirements Summary

**Goal:** Make a wall fight legible by visibly degrading the resting hull colour of multi-hit tanks
(ARMOR, boss) as their HP drops, in one minimal Tank-only change. The 1-HP archetypes + the player are
byte-unchanged. All green on `typecheck` / `build` / `verify`.

**In scope:**

- **`src/entities/Tank.ts` (CHANGED, Phaser-coupled):** in `update()`'s visual fill-cue chain, add a
  resting HP-stage hull tint computed ONLY for `maxHp > 1` tanks. When the tank is not carrier-pulsing,
  not telegraphing, and not hit-flashing (the existing fill cues take priority), and `spawnIframe <= 0`,
  set the hull fill to `lerpColor(spec.color, DAMAGED_TINT, 1 - hp/maxHp)` — i.e. `spec.color` at full
  HP, lerping toward a darker damaged shade as HP drops. For `maxHp === 1` the branch is SKIPPED, so the
  archetypes + the player rest at exactly `spec.color` (byte-unchanged). Reuse a local channel-lerp
  (mirroring `Base.ts`'s `lerpColor`) — NOT a tween (KISS). NEVER verifier-imported.

**Out of scope:** any scene change; a new pure constant in `constants.ts` (the damaged tint + the lerp
are LOCAL render-only feel owned by `Tank.ts`, like its existing `HULL_INSET`/`TREAD_W`/`HIT_FLASH_*`
locals — they are not shared, so they do NOT belong in the constants owner); recolouring the player or
any 1-HP archetype (the tint is gated on `maxHp > 1`, so they never change); a `tanks.ts` data field
for the damaged colour (YAGNI — one inline tint reads for every multi-hit spec); a tween (a per-frame
derivation from existing `hp`/`maxHp` is simpler and needs no lifecycle — KISS); changing the per-hit
white flash (it already arms/decays on the hit-flash branch — the resting tint is what shows BETWEEN
flashes); a sound on damage (the audio owner is the scene; YAGNI).

---

## 3. Acceptance Criteria

1. **AC1 — multi-hit tanks visibly degrade as HP drops.** An ARMOR tank (4 HP) and the boss (12–40 HP)
   rest at `spec.color` at full HP and progressively DARKEN toward a damaged tint as `hp/maxHp` falls,
   so a player can read remaining armor at a glance. The tint is the RESTING fill (it shows between the
   per-hit white flashes, not just during a hit).
2. **AC2 — the 1-HP archetypes + the player are byte-unchanged.** The tint is computed ONLY when
   `maxHp > 1`. BASIC/FAST/POWER and the player (all `maxHp === 1`) skip the branch entirely and rest at
   exactly `spec.color` — no behaviour or visual change for them.
3. **AC3 — the tint never fights the spawn-blink or the carrier/telegraph/hit-flash cues.** The tint
   sits ALONGSIDE (not inside) the carrier-flash/telegraph/hit-flash branches in the SAME `if/else`
   chain, gated on `spawnIframe <= 0`, touching ONLY `setFillStyle` (never `setAlpha`). So at most one
   fill cue writes the hull per frame, and the spawn-blink (which owns the alpha) is never fought. A
   `respawnAt` resets the fill to `spec.color`, and the tint re-settles cleanly the next tick (the boss
   never respawns; ARMOR respawn is defensive — a fresh spawn is at full HP, so the tint is `spec.color`
   anyway).
4. **AC4 — green gate + pure/coupled split.** `npm run typecheck` (strict) + `npm run build` exit 0;
   `npm run verify` prints OK + exits 0. `entities/Tank.ts` is never verifier-imported (the verifier
   imports no `entities/*`), so the change is invisible to the gate; the tank spec colours stay
   render-only (`tanks.ts` D1) and the verifier asserts nothing on them.

---

## 4. Decision Log

1. **D1 — The HP-stage tint is a PURE per-frame derivation from existing `hp`/`maxHp`, NOT a tween or a
   new timer.** `update()` already runs each frame and has the tank's live `hp`/`maxHp` in hand. The
   resting tint is `lerpColor(spec.color, DAMAGED_TINT, 1 - hp/maxHp)` — a stateless function of state
   the entity already owns. *Rationale:* no tween lifecycle to track/kill (unlike `Base.ts`'s
   destroy-flash, which is a one-shot animated event), no new field to init/reset, and it auto-tracks
   HP — a hit drops HP, the next tick the resting tint is darker (KISS/DRY: it reuses the same
   `update()` fill-cue tick + the same `lerpColor` channel-lerp pattern `Base.ts` already proves).
   YAGNI — no animation, the discrete per-hit step IS the read (the white flash already punctuates each
   hit).
2. **D2 — The tint is GATED on `maxHp > 1`, so the 1-HP archetypes + the player are byte-unchanged.**
   For `maxHp === 1` the only HP stages are full (`hp === 1`) and dead, so a tint is meaningless — and
   the brief LOCKS that those archetypes + the player stay byte-identical. The branch's condition is
   `this.maxHp > 1`, so a 1-HP tank never enters it and rests at exactly `spec.color` (the prior
   behaviour). *Rationale:* the cue is ONLY meaningful for a multi-stage HP bar (ARMOR/boss); gating it
   keeps the change zero-risk for everything else (KISS/YAGNI). Every multi-hit spec (ARMOR, boss, any
   future one) gets it for free through the one gated branch (DRY/SOLID — no per-type code).
3. **D3 — The tint sits ALONGSIDE the carrier/telegraph/hit-flash branches in the SAME `if/else` chain,
   so it is the RESTING fill the others override.** `update()` already has a mutually-exclusive fill-cue
   chain: carrier-pulse → telegraph-warn → hit-flash, all gated on `spawnIframe <= 0`, all touching ONLY
   `setFillStyle`. The HP-stage tint is the FINAL `else if` (gated additionally on `maxHp > 1`): it only
   renders when none of the transient cues are active, so a carrier pulse / a telegraph warn / a hit
   flash still take priority on the frames they run (they are the louder, momentary cues), and the
   HP-stage tint is what the hull RESTS at between them. *Rationale:* placing it last in the chain makes
   it the default resting fill without fighting any transient cue (at most one fill write per frame —
   the chain's existing invariant). It only writes the fill (never the alpha) and is gated off the
   spawn-iframe window, so it can never clash with the spawn-blink (which owns the alpha) — the same
   discipline the telegraph/hit-flash branches document. SOLID — the tint is presentation owned by the
   entity's visual tick.
4. **D4 — The damaged tint + the channel-lerp are LOCAL render-only feel in `Tank.ts`, NOT new
   `constants.ts` numbers.** Like the file's existing `HULL_INSET`/`TREAD_W`/`HIT_FLASH_SEC`/
   `HIT_FLASH_COLOR` locals (its F8 D6: "LOCAL render constants owned by this ONE file — they are not
   shared, so they do NOT belong in the constants.ts owner"), `DAMAGED_TINT` is render-only feel
   consumed nowhere else. The channel-lerp is a tiny LOCAL `lerpColor` (the same body as `Base.ts`'s —
   per-channel lerp of two `0xRRGGBB` colours), inlined as a file-local helper rather than promoted to a
   shared util (the two call sites are in different coupled files, neither verifier-imported — a shared
   util would be premature coupling for a 10-line function; KISS/YAGNI, exactly the "no new util for a
   single call site" note `Base.ts`'s `lerpColor` carries). *Rationale:* keeps the change OUT of the
   verifier-imported path (no new pure number leaks into the gate) and matches the file's established
   local-render-constant discipline.

---

## 5. Design

### 5.2 The HP-stage hull tint (`entities/Tank.ts`)

- **A LOCAL render constant** `DAMAGED_TINT = 0x4a3b3b` (a dark, desaturated shade) near the other
  local render constants (`HIT_FLASH_SEC`/`HIT_FLASH_COLOR`), with a one-line intent comment (D4). The
  hull lerps from `spec.color` toward this as HP drops.
- **A LOCAL `lerpColor(from, to, t)`** at the bottom of the file (the same per-channel body `Base.ts`
  proves — extract each `0xRRGGBB` channel, lerp, recombine), with the same "no new util for a single
  call site (KISS)" note (D4).
- **`update()` (the fill-cue chain):** add a FINAL branch to the existing carrier/telegraph/hit-flash
  `if / else if` chain — `else if (this.maxHp > 1 && this.spawnIframe <= 0)`: set the hull fill to
  `lerpColor(this.spec.color, DAMAGED_TINT, 1 - this.hp / this.maxHp)`. At full HP (`hp === maxHp`) the
  lerp factor is 0 → exactly `spec.color`; as HP drops the factor rises toward 1 → toward `DAMAGED_TINT`.
  Gated on `maxHp > 1` (so 1-HP tanks + the player never enter it — D2) and `spawnIframe <= 0` (so it
  does not run during the spawn-blink, which owns the alpha) and touching ONLY `setFillStyle` (never
  `setAlpha`), exactly like the branches above it (D3). It is the LAST branch, so the carrier/telegraph/
  hit-flash cues take priority on the frames they render and the tint is the resting fill between them.

### 5.3 What does NOT change

`onHit`, the per-hit white flash (it still arms/decays on its own branch — the resting tint shows
between flashes), the death path, `isHittable`, the no-diagonal movement spine, the spawn-iframe blink,
the carrier/telegraph cues, `respawnAt` (it already resets the hull to `spec.color` — the tint
re-settles the next tick from the refilled HP), the 1-HP archetypes, the player, and every scene are
UNCHANGED. The verifier is UNCHANGED (it never imports `Tank.ts`, and asserts nothing on tank spec
colours — render-only per `tanks.ts` D1).

---

## 6. Files

**Changed:**

- `src/entities/Tank.ts` — `DAMAGED_TINT` local + a local `lerpColor` helper + the gated HP-stage hull
  tint branch (the final `else if`) in `update()`'s fill-cue chain.

**New:**

- `docs/designs/2026-06-19-armor-boss-hp-stage-color.md` — this design doc.

---

## 7. Verification

- **AC1 (multi-hit degrade) — manual `npm run dev` drive.** Shoot an ARMOR tank: its hull darkens a
  stage with each surviving hit and stays darkened (the resting fill, not just the white flash). Fight
  the boss: its hull progressively darkens as its many-HP bar is chewed down.
- **AC2 (1-HP unchanged) — read.** The tint branch is gated on `this.maxHp > 1`; BASIC/FAST/POWER and
  the player (all `maxHp === 1`) skip it and rest at exactly `spec.color`.
- **AC3 (no cue clash) — read.** The tint is the FINAL `else if` after the carrier/telegraph/hit-flash
  branches, gated on `spawnIframe <= 0`, calling only `setFillStyle` — never `setAlpha`. `respawnAt`
  still resets the fill to `spec.color`.
- **AC4 (green gate + pure/coupled) — `npm run typecheck` + `npm run build` + `npm run verify`.** All
  exit 0 / print OK. `Tank.ts` is never verifier-imported (the verifier imports no `entities/*`); the
  verifier asserts nothing on tank spec colours, so the change is invisible to the gate.

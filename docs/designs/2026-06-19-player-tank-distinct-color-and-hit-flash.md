# Tank 1990 — Distinct player color + universal hit-flash feedback

> A small READABILITY + faithfulness fix over the finished Tank 1990. Format mirrors the read-only
> reference `dead-cell` design docs: Background → Requirements → Acceptance Criteria → Decision Log →
> Design → Files → Verification. It changes exactly TWO files — the PURE `config/tanks.ts` (a
> render-only colour swap) and the Phaser-coupled `entities/Tank.ts` (a brief per-hit hull flash) —
> and touches NOTHING the headless verifier proves (the tank spec colours are render-only per
> `tanks.ts`'s own D1 note; `Tank.ts` is never verifier-imported). KISS/YAGNI/DRY/SOLID.

---

## 1. Background

Two playability gaps surface in a live drive that the finished build leaves flat:

- **The player reads IDENTICALLY to the POWER enemy.** `PLAYER_BASE.color` is `0x6ab04c` — the EXACT
  same green as the POWER gunner archetype (`POWER.color = 0x6ab04c`). On a stage with a POWER tank on
  screen there are TWO same-green tanks; a player cannot tell their own tank from an enemy at a glance.
  This is an outright faithfulness + readability bug — the classic player tank is a tan/yellow, never
  the green gunner.
- **Multi-hit tanks give NO per-hit feedback.** ARMOR (4 HP) and the boss (up to `BOSS_HP_MAX` HP)
  funnel every hit through `Tank.onHit(damage)`, but a non-lethal hit produces NOTHING visible — the
  tank silently absorbs 4–40 hits with zero on-hit cue, so the player cannot read combat progress
  (is my shot even landing?). The death path pops an explosion; a SURVIVING hit pops nothing.

One small Tank-only change fixes both, stays programmer-art, and rides the existing pure/coupled
split. The player/POWER colour collision is a render-only data swap in the PURE config; the hit-flash
is a brief hull recolour on the surviving-hit branch of the EXISTING `onHit` funnel — so EVERY
multi-hit tank (ARMOR, boss, and any future multi-hit spec) gets per-hit feedback for FREE through
the one funnel (DRY), with no scene change and no new pure number leaking into the verifier path.

---

## 2. Requirements Summary

**Goal:** Make the player tank read DISTINCTLY from the POWER enemy, and give every non-lethal hit a
brief visible flash, in one minimal Tank-only change. All green on `typecheck` / `build` / `verify`.

**In scope:**

- **`src/config/tanks.ts` (CHANGED, PURE — render-only):** change `PLAYER_BASE.color` from `0x6ab04c`
  (the POWER green) to a classic tan/yellow `0xf6d860`, so the player no longer reads as a second
  green gunner. Keep `PLAYER_BASE.colorFlash` EQUAL to the new colour (`0xf6d860`) — a player never
  red-flashes (it is never a carrier), so its flash fill stays its resting fill (the existing
  invariant). `PLAYER_STAR_TIERS` does NOT recolour (no tier carries a `color` delta), so nothing else
  changes. The verifier IGNORES tank spec colours (D1 — render-only), so this is verifier-safe.
- **`src/entities/Tank.ts` (CHANGED, Phaser-coupled):** add a brief HULL-FLASH on a non-lethal hit. In
  `onHit(damage)`, when `hp > 0` after the subtraction (the SURVIVING branch), arm a short
  `hitFlashTimer` (~`HIT_FLASH_SEC` = 0.08s, a new private field). In `update()`, while
  `hitFlashTimer > 0`, decay it on `dt` and tint the hull WHITE; restore `spec.color` when it elapses.
  The flash branch is GATED exactly like the existing carrier / telegraph fill branches (only when
  `spawnIframe <= 0`, and it touches ONLY `setFillStyle` — never `setAlpha`) so it never fights the
  spawn-blink alpha cue. NEVER verifier-imported.

**Out of scope:** any scene change; a new pure constant in `constants.ts` (the flash duration is a
LOCAL render constant owned by `Tank.ts`, like its existing `HULL_INSET`/`TREAD_W`/`BARREL_LEN`
locals — it is not shared, so it does NOT belong in the constants owner — D6 of the F8 visual work); a
death-hit flash (the death path already pops an explosion — a flash there is redundant noise); a
sound on hit (the audio owner is the scene; YAGNI); recolouring any ENEMY or the star tiers.

---

## 3. Acceptance Criteria

1. **AC1 — the player reads DISTINCTLY from the POWER enemy.** `PLAYER_BASE.color` is no longer
   `0x6ab04c` (the POWER green) — it is the tan/yellow `0xf6d860`. `PLAYER_BASE.colorFlash` equals
   `PLAYER_BASE.color` (the player never red-flashes — it is never a carrier). On a stage with a POWER
   tank, the player tank and the POWER tank are different colours.
2. **AC2 — a non-lethal hit FLASHES the hull.** A hit that leaves `hp > 0` (an ARMOR tank's first
   three hits, a boss's hits) briefly tints the hull white (~0.08s) then restores `spec.color`. A
   LETHAL hit (the one that drops `hp` to 0) does NOT flash — it takes the existing death path. The
   flash works for EVERY multi-hit tank through the one `onHit` funnel (no per-type code).
3. **AC3 — the flash never fights the spawn-blink or the carrier/telegraph cues.** The flash branch is
   gated on `spawnIframe <= 0` (so it does not run during the spawn-blink, which owns the alpha) and
   touches ONLY `setFillStyle` (never `setAlpha`). It sits with the existing carrier/telegraph fill
   branches so at most one fill cue writes the hull per frame.
4. **AC4 — green gate + pure/coupled split.** `npm run typecheck` (strict) + `npm run build` exit 0;
   `npm run verify` prints OK + exits 0. `config/tanks.ts` imports NO Phaser (re-proven by the
   verifier's node import); the verifier asserts NOTHING on tank spec colours (render-only — D1), so
   the colour swap is invisible to the gate. `entities/Tank.ts` is never verifier-imported.

---

## 4. Decision Log

1. **D1 — The player colour swap is a RENDER-ONLY data edit in the PURE `tanks.ts`, exactly as the
   file's own header D1 note states ("THE COLOURS ARE RENDER-ONLY … the verifier IGNORES them").** The
   verifier node-imports `tanks.ts` but asserts only the TUNABLE stats (HP/speed/cooldown distinctness,
   `rosterPick`, `applyStarTier` monotonicity) — never `color`/`colorFlash`. So swapping
   `PLAYER_BASE.color` to `0xf6d860` is byte-invisible to the gate. `colorFlash` is held EQUAL to the
   new colour to preserve the existing "a player never red-flashes" invariant (it is never a carrier).
   *Rationale:* the cheapest faithful fix for the player/POWER green collision is a one-field colour
   change in the single colour owner (DRY — the spec is the colour source; the entity reads it). YAGNI
   — no new tier recolour, no enemy recolour.
2. **D2 — The hit-flash rides the EXISTING `onHit` funnel's SURVIVING branch, so every multi-hit tank
   gets it for free.** `onHit(damage)` already subtracts HP and branches on `hp <= 0` (death) vs
   survive. The flash arms `hitFlashTimer` in the SURVIVING branch (`hp > 0`) — so ARMOR, the boss,
   and any future multi-hit spec all flash per hit through the ONE funnel, with no per-type code (DRY/
   SOLID — `onHit` is the one hit entry; the flash is one more thing it does on survive). A lethal hit
   skips the flash (it takes the death path — the explosion is its feedback; a flash there is noise —
   YAGNI).
3. **D3 — The flash is a brief HULL recolour gated EXACTLY like the carrier/telegraph fill branches, so
   it never fights the spawn-blink alpha.** `update()` already has two mutually-aware fill-cue branches
   (carrier pulse, telegraph warn) both gated on `spawnIframe <= 0` and both touching ONLY
   `setFillStyle`. The flash is a THIRD such cue: while `hitFlashTimer > 0` and `spawnIframe <= 0`,
   tint the hull WHITE and decay the timer on `dt`; restore `spec.color` on elapse. Because it only
   writes the fill (never the alpha) and is gated off the spawn-iframe window, it can never clash with
   the spawn-blink (which owns the alpha) — the same discipline the telegraph branch documents.
   *Rationale:* reuse the proven fill-cue pattern verbatim (KISS/DRY); a ~0.08s window is a single
   readable pop per hit, not a strobe. SOLID — the flash is presentation owned by the entity's visual
   tick.
4. **D4 — The flash duration is a LOCAL render constant in `Tank.ts`, NOT a new `constants.ts`
   number.** Like the file's existing `HULL_INSET`/`TREAD_W`/`TURRET_SIZE` locals (its F8 D6: "LOCAL
   render constants owned by this ONE file — they are not shared, so they do NOT belong in the
   constants.ts owner"), `HIT_FLASH_SEC` is render-only feel owned solely by the entity. *Rationale:*
   it is consumed nowhere else (no scene/config reads it), so putting it in the shared owner would be
   premature coupling (YAGNI) — and crucially it keeps the change OUT of the verifier-imported path
   (no new pure number leaks into the gate — the brief's constraint). The flash TINT reuses the
   existing white-ish programmer-art palette inline (a one-off `0xffffff`, like the telegraph's
   `TELEGRAPH_FILL`).

---

## 5. Design

### 5.1 The colour swap (`config/tanks.ts`)

`PLAYER_BASE.color`: `0x6ab04c` → `0xf6d860` (a classic tan/yellow). `PLAYER_BASE.colorFlash`:
`0x6ab04c` → `0xf6d860` (held EQUAL to the new colour — the player never red-flashes; same fill keeps
it tan). The inline comments are updated from "green player tank" to the new colour. `PLAYER_STAR_TIERS`
carries NO `color` delta (it only raises offensive stats), so it does NOT recolour — nothing else
changes. POWER keeps its `0x6ab04c` green (the gunner is the green tank — unchanged).

### 5.2 The hit-flash (`entities/Tank.ts`)

- **A LOCAL render constant** `HIT_FLASH_SEC = 0.08` near the other local render constants (D4).
- **A new private field** `hitFlashTimer: number` (seconds, decays by dt; > 0 = flashing), initialised
  to 0 in the ctor and cleared in `respawnAt` (a fresh spawn carries no flash — defensive, matching the
  telegraph reset).
- **`onHit(damage)` (the surviving branch):** after `this.hp -= damage`, in the `else` of the
  `hp <= 0` death check (i.e. `hp > 0`), set `this.hitFlashTimer = HIT_FLASH_SEC`. The death branch is
  unchanged.
- **`update()` (the fill-cue chain):** add a THIRD branch to the existing carrier/telegraph
  `if/else if` chain — `else if (this.hitFlashTimer > 0 && this.spawnIframe <= 0)`: decay
  `hitFlashTimer` on `dt`, tint the hull WHITE (`0xffffff`) while > 0, and restore `spec.color` on the
  frame it reaches 0. Gated on `spawnIframe <= 0` and touching ONLY `setFillStyle` (never `setAlpha`),
  exactly like the branches above it (D3). The timer must decay regardless of which branch renders, so
  the decay happens inside this branch (it only renders when not spawn-blinking, and the brief flash is
  cosmetic — a spawn-blinking tank is invulnerable anyway, so a flash deferred under i-frames is moot).

### 5.3 What does NOT change

The combat/spawn/advance/boss paths, the no-diagonal movement spine, the carrier/telegraph cues, the
spawn-iframe blink, `isHittable`, the death path, and every scene are UNCHANGED. The verifier is
UNCHANGED (it asserts nothing on tank spec colours, and never imports `Tank.ts`).

---

## 6. Files

**Changed:**

- `src/config/tanks.ts` — `PLAYER_BASE.color`/`colorFlash` → `0xf6d860` (render-only; PURE).
- `src/entities/Tank.ts` — `HIT_FLASH_SEC` local + a `hitFlashTimer` field + the surviving-hit arm in
  `onHit` + the gated hull-flash branch in `update` + the `respawnAt` reset.

**New:**

- `docs/designs/2026-06-19-player-tank-distinct-color-and-hit-flash.md` — this design doc.

---

## 7. Verification

- **AC1 (distinct player colour) — read + grep.** `grep '0x6ab04c' src/config/tanks.ts` returns ONLY
  the POWER line (the player lines are now `0xf6d860`). `PLAYER_BASE.colorFlash === PLAYER_BASE.color`.
- **AC2 (non-lethal flash) — manual `npm run dev` drive.** Shoot an ARMOR tank: each of the first
  three hits flashes the hull white briefly; the fourth kills it (explosion, no flash). Shoot the boss:
  every hit flashes.
- **AC3 (no cue clash) — read.** The flash branch is `else if` after the carrier/telegraph branches,
  gated on `spawnIframe <= 0`, calling only `setFillStyle` — never `setAlpha`.
- **AC4 (green gate + pure/coupled) — `npm run typecheck` + `npm run build` + `npm run verify`.** All
  exit 0 / print OK. `config/tanks.ts` stays Phaser-free (the verifier node-imports it); the verifier
  asserts nothing on tank spec colours, so the swap is invisible to the gate. `Tank.ts` is never
  verifier-imported.

// ── Power-up roster (F5 Power-ups & meta §5.2, Decisions D1/D2/D3/D4, AC1/AC2) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts every kind is present + well-formed (numeric colour, duration ≥ 0) and `pickPowerUpKind` is total
// + deterministic (the F5 quality gate, AC1/AC11). This is Tank 1990's analogue of the read-only `dead-cell`
// reference's PURE pickup-kind data (its Pickup KINDS list): the canonical defs live in a PURE config, NOT the
// coupled `entities/PowerUp.ts` pool. The pool consumes them; the verifier proves them; nobody duplicates them.
//
// THE SIX CLASSICS (the locked decision, AC2): helmet (a timed shield) · clock (freeze every enemy) · shovel
// (fortify the eagle's brick ring → steel) · star (upgrade your tank one tier) · grenade (destroy every
// on-screen enemy) · tank (+1 extra life). Three are TIMED (helmet/clock/shovel — a `durationSec > 0` window
// the scene ticks down on RunState); three are INSTANT (star/grenade/tank — `durationSec = 0`, applied once).
//
// THE COLOURS ARE RENDER-ONLY (D1): `color` is consumed ONLY by the coupled PowerUp pool's pulse fill (exactly
// like tiles.ts / tanks.ts colours). The verifier asserts it is NUMERIC but never proves a particular hue (a
// colour is presentation, not a tunable). They're here so the entity reads ALL of a kind's presentation from one row.

import type { RNG } from '../util/rng.js'

// ── PowerUpKind (D1) ── the power-up kinds. A stable union the scene's _applyPowerUp switch + the HUD's
// active-power-up readout key off. NEVER subclassed — a kind is a TAG + a row (the reference's pickup-kind
// stance, mirrored): the SAME pooled rect renders any kind; the SCENE owns the effect. The roster grew 6 → 8
// with two more TIMED kinds (boat-drill): `boat` (amphibious — drive over WATER for a window) + `drill` (the
// player bullet PIERCES one brick layer for a window). Both lean on existing seams (the tank×water collider's
// process callback; the bullet's per-shot flag like `canBreakSteel`) — no new subsystem (KISS).
export type PowerUpKind = 'helmet' | 'clock' | 'shovel' | 'star' | 'grenade' | 'tank' | 'boat' | 'drill'

// ── PowerUpDef (D1) ── the canonical per-kind row. PLAIN DATA (no functions) so it is trivially comparable +
// the verifier sweeps it headlessly. The coupled PowerUp pool reads `color` (its pulse fill); the scene reads
// `kind` (the effect switch); the HUD reads `id`/`durationSec` (the active-power-up readout).
export interface PowerUpDef {
  id: string // === kind (a stable key the i18n `ui` chrome + the HUD read; mirrors tanks.ts `id`).
  kind: PowerUpKind
  color: number // programmer-art pulse fill (coupled PowerUp pool ONLY — the verifier ignores the hue, D1/AC11).
  durationSec: number // s — the timed effect's window (0 for the INSTANT kinds star/grenade/tank — D4).
}

// ── The run-effect TUNABLES (F5 §5.2, D4) — the ONE owner (DRY) the scene reads ── the three timed power-ups'
// effect windows in SECONDS. helmet → RunState.shieldTimer[slot]; clock → RunState.freezeTimer; shovel →
// RunState.shovelTimer (then TileMap.fortifyBaseRing / revertBaseRing on the rising/falling edge — D4a). These
// also seed the matching POWERUPS row's `durationSec`, so the def table + the scene read ONE truth (DRY).
export const HELMET_SHIELD_SEC = 8 // s — the helmet's timed shield / i-frame window (AC2).
export const CLOCK_FREEZE_SEC = 6 // s — the clock's "freeze every enemy" window (AC2).
export const SHOVEL_FORTIFY_SEC = 12 // s — the shovel's "fortify the eagle ring → steel" window (AC2).
// boat-drill — the two NEW timed windows (DRY — the ONE owner the scene reads + the POWERUPS rows below seed).
export const BOAT_SAIL_SEC = 12 // s — the boat's "drive over WATER tiles" amphibious window (RunState.boatTimer[slot]).
export const DRILL_PIERCE_SEC = 12 // s — the drill's "player bullet pierces one brick layer" window (RunState.drillTimer).

// ── POWERUPS (D1) ── the ordered def table (the verifier sweep source; mirrors tanks.ts ENEMY_ARCHETYPES). The
// timed kinds carry their effect window from the tunables above (DRY); the instant kinds carry 0 (applied once).
// Colours are programmer-art primitives (AC11) chosen to read distinctly on the dark playfield: shield-blue
// helmet, ice-cyan clock, earth-brown shovel, gold star, fire-orange grenade, life-green tank.
export const POWERUPS: PowerUpDef[] = [
  { id: 'helmet', kind: 'helmet', color: 0x4d96ff, durationSec: HELMET_SHIELD_SEC }, // blue — the timed shield.
  { id: 'clock', kind: 'clock', color: 0x00d2d3, durationSec: CLOCK_FREEZE_SEC }, // cyan — freeze all enemies.
  { id: 'shovel', kind: 'shovel', color: 0xb8651b, durationSec: SHOVEL_FORTIFY_SEC }, // brown — fortify the ring.
  { id: 'star', kind: 'star', color: 0xfeca57, durationSec: 0 }, // gold — upgrade your tank one tier (instant).
  { id: 'grenade', kind: 'grenade', color: 0xff6b6b, durationSec: 0 }, // orange — destroy every enemy (instant).
  { id: 'tank', kind: 'tank', color: 0x1dd1a1, durationSec: 0 }, // green — +1 extra life (instant).
  // boat-drill — the two NEW timed kinds (durationSec > 0). boat = ocean-blue (drive over water); drill =
  // slate-grey (the brick-piercing bit). Both carry their effect window from the tunables above (DRY).
  { id: 'boat', kind: 'boat', color: 0x2e86de, durationSec: BOAT_SAIL_SEC }, // ocean-blue — amphibious (drive over WATER).
  { id: 'drill', kind: 'drill', color: 0x8395a7, durationSec: DRILL_PIERCE_SEC }, // slate-grey — the bullet pierces one brick layer.
]

// ── POWERUP_BY_ID (D1) ── id → def lookup (the HUD's active-power-up colour/duration readout, the i18n key
// validation). DRY — one source, derived from POWERUPS (mirrors tanks.ts ENEMY_SPECS / the reference's *_BY_ID).
export const POWERUP_BY_ID: Record<string, PowerUpDef> = Object.fromEntries(POWERUPS.map((p) => [p.id, p]))

// ── POWERUP_KINDS (D3) ── the eight kinds in order — the list `pickPowerUpKind` draws a uniform pick from (the
// carrier-death drop now picks boat/drill too). Derived from POWERUPS so it can never drift from the def table (DRY).
export const POWERUP_KINDS: PowerUpKind[] = POWERUPS.map((p) => p.kind)

// ── pickPowerUpKind(rng) → PowerUpKind (D3, AC1) ── a PURE uniform pick over POWERUP_KINDS off the stage RNG.
// The carrier-death drop calls it with the per-stage `stageRng` (the SAME seeded source the roster picks use —
// DRY), so a fixed stage seed yields a deterministic power-up stream (reproducible for a replay). The verifier
// proves it total (only ever returns a known kind) + deterministic (two fresh rngs from one seed → the same
// sequence). KISS — a single floor over the kind count, never a divide-by-zero (POWERUP_KINDS is non-empty).
export function pickPowerUpKind(rng: RNG): PowerUpKind {
  const i = Math.floor(rng() * POWERUP_KINDS.length)
  // Clamp into range defensively — rng() ∈ [0,1) so `i` ∈ [0, len-1], but a 1.0 tail (shouldn't happen) clamps
  // to the last kind rather than indexing undefined (the total-fold discipline tanks.ts rosterPick keeps).
  return POWERUP_KINDS[Math.min(i, POWERUP_KINDS.length - 1)]
}

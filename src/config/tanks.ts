// ── Tank roster (F4 Enemy tanks §5.2, Decision D1, AC4) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and
// asserts every TankSpec is well-formed, the four enemy types DIFFER on a tunable stat, `rosterPick` only
// returns a known enemy id + is deterministic, and `applyStarTier` is monotone (the F4 quality gate, AC11).
// This is Tank 1990's analogue of the read-only `dead-cell` reference's PURE `config/enemies.ts` (its
// Decision 68): the canonical specs live in a PURE config, NOT the entity. The Phaser-coupled Tank consumes
// them; the verifier proves them; nobody duplicates them (DRY — one source of truth for tank tuning).
//
// THE ONE FSM, A BEHAVIOUR TAG (D2): the four enemy types are a `behavior` TAG + a spec — NEVER four
// subclasses. The SAME Tank entity reads any spec; FAST/POWER/ARMOR differ ONLY by their numbers (move
// speed, bullet speed, HP), so the no-diagonal grid-snap movement spine (F1) + the F3 HP funnel are reused
// for FREE. The boss (a later feature) is a 5th spec + a 'boss' tag on this SAME entity/FSM (the locked
// decision) — so this table scales to the boss with no new entity.
//
// THE COLOURS ARE RENDER-ONLY (D1): `color`/`colorFlash` live on the spec but are consumed ONLY by the
// coupled Tank's visual — exactly like `tiles.ts` colours. The verifier IGNORES them (a colour is not a
// tunable the data gate proves); they are here so the entity reads ALL of a type's presentation from one row.

import type { RNG } from '../util/rng.js'
import {
  TANK_SPEED,
  BULLET_SPEED,
  FIRE_COOLDOWN,
  MAX_PLAYER_BULLETS,
  TANK_MAX_HP,
  ARMOR_TANK_HP,
} from './constants.js'

// ── TankBehavior (D2) ── the behaviour TAG that selects the AI branch (the four enemy types + the player).
// The boss adds 'boss' here (a later feature) — the same entity/FSM, one more tag (the locked decision).
export type TankBehavior = 'basic' | 'fast' | 'power' | 'armor' | 'player'

// ── TankSpec (D1, AC4) ── the canonical per-type tuning row. PLAIN DATA (no functions) so it is trivially
// comparable + the verifier sweeps it headlessly. The coupled Tank copies the numeric fields onto per-tank
// fields in its ctor (so the RUNNING tank drives/fires at the spec's magnitudes — AC4 is honoured at runtime,
// not merely provable in data); the colours feed only the Tank's visual (D1).
export interface TankSpec {
  id: string
  behavior: TankBehavior
  maxHp: number // 1 for basic/fast/power + the player; ARMOR_TANK_HP (4) for armor (multi-hit, AC4).
  moveSpeed: number // px/s — the grid drive speed (FAST > the rest — AC4).
  bulletSpeed: number // px/s — the fired bullet's speed (POWER > the rest — AC4).
  fireCooldown: number // s — the attack-beat cadence.
  maxBullets: number // live-bullet cap (classic 1; the player star tiers raise it).
  color: number // programmer-art resting fill (coupled Tank visual ONLY — the verifier ignores it, D1).
  colorFlash: number // red-carrier flash fill (coupled Tank visual ONLY).
  scoreValue: number // points banked to RunState.score on this enemy's death (read in F4 — D10).
  canBreakSteel?: boolean // max-star player only — RESERVED (no bullet reads it in F4; the steel-break seam).
}

// ── The four classic enemy types (AC4) ── they DIFFER MEANINGFULLY on at least one of {moveSpeed,
// bulletSpeed, maxHp}: the verifier asserts pairwise distinctness (AC4 is a headless data check, not
// eyeballing). All HP/speed/cooldown defaults anchor on the constants.ts owners (DRY) so the player feel +
// the enemy feel scale around the SAME base numbers; each enemy then tweaks ONE axis to read distinctly.

// BASIC — the baseline grunt: medium move, normal bullet, 1 HP (the classic grey tank).
export const BASIC: TankSpec = {
  id: 'basic',
  behavior: 'basic',
  maxHp: TANK_MAX_HP, // 1 — dies in one hit.
  moveSpeed: TANK_SPEED, // the baseline drive speed.
  bulletSpeed: BULLET_SPEED, // a normal bullet.
  fireCooldown: 0.9, // a measured attack beat (slower than the player's twitch fire — they wander + shoot).
  maxBullets: 1,
  color: 0xeb4d4b, // red grunt (programmer-art primitive — AC11).
  colorFlash: 0xff7979, // the red-carrier flash tint.
  scoreValue: 100,
}

// FAST — the quick scout: clearly OUT-DRIVES the rest (a higher moveSpeed — AC4), 1 HP, normal bullet.
export const FAST: TankSpec = {
  id: 'fast',
  behavior: 'fast',
  maxHp: TANK_MAX_HP, // 1.
  moveSpeed: Math.round(TANK_SPEED * 1.75), // visibly faster than BASIC (the distinguishing stat — AC4).
  bulletSpeed: BULLET_SPEED,
  fireCooldown: 1.1, // it darts more than it shoots.
  maxBullets: 1,
  color: 0xf0932b, // orange scout.
  colorFlash: 0xffbe76,
  scoreValue: 200,
}

// POWER — the gunner: medium move, a FASTER bullet (a higher bulletSpeed — AC4), 1 HP. The fast shot is the
// distinguishing stat (the classic green tank whose bolt is hard to dodge).
export const POWER: TankSpec = {
  id: 'power',
  behavior: 'power',
  maxHp: TANK_MAX_HP, // 1.
  moveSpeed: TANK_SPEED,
  bulletSpeed: Math.round(BULLET_SPEED * 1.6), // a faster bullet than the rest (the distinguishing stat — AC4).
  fireCooldown: 0.75, // it shoots more readily.
  maxBullets: 1,
  color: 0x6ab04c, // green gunner.
  colorFlash: 0xbadc58,
  scoreValue: 300,
}

// ARMOR — the heavy: medium move, ARMOR_TANK_HP (4) HP multi-hit (the four-flash tank — AC4). Reuses F3's HP
// funnel "for free" via the same subtraction; the distinguishing stat is its HP. The highest score (hardest).
export const ARMOR: TankSpec = {
  id: 'armor',
  behavior: 'armor',
  maxHp: ARMOR_TANK_HP, // 4 — survives four hits (the four-flash multi-hit tank — AC4; reads the constants owner).
  moveSpeed: TANK_SPEED,
  bulletSpeed: BULLET_SPEED,
  fireCooldown: 1.0,
  maxBullets: 1,
  color: 0x686de0, // blue-violet heavy.
  colorFlash: 0xa29bfe,
  scoreValue: 400,
}

// ── PLAYER_BASE (D1) ── the player tank base spec. Its stats EQUAL the F1 constants (TANK_SPEED/BULLET_SPEED/
// FIRE_COOLDOWN/MAX_PLAYER_BULLETS/TANK_MAX_HP), so threading the spec is BEHAVIOUR-PRESERVING for the player
// (the F1 feel is byte-identical) — the constants stay the single owner of the player's DEFAULT feel (DRY),
// now read via this spec rather than inlined in the entity. GameScene constructs a player as
// `new Tank(scene, x, y, 'player', applyStarTier(tier))`; tier 0 folds to exactly this base.
export const PLAYER_BASE: TankSpec = {
  id: 'player',
  behavior: 'player',
  maxHp: TANK_MAX_HP, // 1 — a player tank is a one-hit tank (the classic default).
  moveSpeed: TANK_SPEED,
  bulletSpeed: BULLET_SPEED,
  fireCooldown: FIRE_COOLDOWN,
  maxBullets: MAX_PLAYER_BULLETS,
  color: 0x6ab04c, // the green player tank (programmer-art — AC11).
  colorFlash: 0x6ab04c, // a player never red-flashes (it is never a carrier); the same fill keeps it green.
  scoreValue: 0, // a player is never "killed for points".
}

// ── StarTierDelta (D1) ── one ordered ADDITIVE stat delta the player's star tier folds over PLAYER_BASE. The
// star POWER-UP (F5) raises a player's tier; the Hub permanent-upgrade fold is the Hub feature — F4 ships ONLY
// the data + the pure `applyStarTier` the later features call (YAGNI on the UI/economy here).
export interface StarTierDelta {
  bulletSpeed?: number // +px/s to the fired bullet speed.
  maxBullets?: number // +live-bullet cap (the classic star-2 "two shots out").
  fireCooldownMult?: number // ×factor on the fire cooldown (< 1 = fires faster).
  canBreakSteel?: boolean // the max-star steel-break flag (RESERVED — no bullet reads it in F4; the seam).
}

// ── PLAYER_STAR_TIERS (D1) ── the ordered additive deltas, tier 0 = PLAYER_BASE (an empty fold). Each entry
// ONLY raises (or holds) the player's bulletSpeed/maxBullets and only lowers the fireCooldown — so the fold is
// MONOTONE-NON-DECREASING in offensive power (the verifier asserts this — AC6). The classic four-star ramp:
//   tier 1: faster bullet · tier 2: two shots out + faster fire · tier 3: faster still + steel-break (max star).
export const PLAYER_STAR_TIERS: StarTierDelta[] = [
  {}, // tier 0 — the base (no delta).
  { bulletSpeed: 120 }, // tier 1 — a faster bullet.
  { bulletSpeed: 120, maxBullets: 1, fireCooldownMult: 0.8 }, // tier 2 — two shots out + a quicker beat.
  { bulletSpeed: 180, maxBullets: 1, fireCooldownMult: 0.7, canBreakSteel: true }, // tier 3 — max star (steel-break, reserved).
]

// ── applyStarTier(tier) → TankSpec (D1, AC6) ── the PURE fold: PLAYER_BASE + the cumulative deltas of tiers
// [0..tier]. Clamps the tier into the table range (defensive — a stray out-of-range tier never crashes). The
// deltas are ADDITIVE (bulletSpeed/maxBullets accumulate) + MULTIPLICATIVE on the cooldown (each tier's
// fireCooldownMult compounds), so the result is non-decreasing in offensive power across tiers (the verifier
// proves it). PURE (no Phaser) — the F5 star power-up + the Hub fold call this; F4 only provides it.
export function applyStarTier(tier: number): TankSpec {
  const t = Math.max(0, Math.min(PLAYER_STAR_TIERS.length - 1, Math.floor(tier || 0)))
  const out: TankSpec = { ...PLAYER_BASE }
  for (let i = 0; i <= t; i++) {
    const d = PLAYER_STAR_TIERS[i]
    if (d.bulletSpeed) out.bulletSpeed += d.bulletSpeed
    if (d.maxBullets) out.maxBullets += d.maxBullets
    if (d.fireCooldownMult) out.fireCooldown *= d.fireCooldownMult
    if (d.canBreakSteel) out.canBreakSteel = true
  }
  return out
}

// ── ENEMY_SPECS (id → spec) + ENEMY_ARCHETYPES (ordered) (D1) ── the scene's spawn loop looks an archetype up
// by the id `rosterPick` returns; the verifier sweeps the ordered list for well-formedness + pairwise
// distinctness (AC4). Mirrors the reference's ENEMY_SPECS/ENEMY_ARCHETYPES (one lookup, one sweep source).
export const ENEMY_SPECS: Record<string, TankSpec> = {
  basic: BASIC,
  fast: FAST,
  power: POWER,
  armor: ARMOR,
}
export const ENEMY_ARCHETYPES: TankSpec[] = [BASIC, FAST, POWER, ARMOR]

// ── EnemyWeights (D8) ── the per-stage raw roster weights (from stages.ts `enemyWeights`). The four ids the
// spawn loop weights its pick over. Raw (their sum need NOT be 1 — `rosterPick` normalizes via the running total).
export interface EnemyWeights {
  basic: number
  fast: number
  power: number
  armor: number
}

// ── rosterPick(rng, weights) → enemy id (D1/D8, AC4) ── a PURE weighted pick over the four enemy ids. The
// spawn loop calls it with the stage's `enemyWeights`; the verifier asserts it ONLY ever returns a known id +
// is deterministic for a fixed rng (AC4). The weights are clamped ≥ 0 (a negative weight is treated as 0 — it
// can't make a pick "go backwards"); a degenerate all-zero roster falls back to 'basic' (never divides by
// zero / returns undefined — the live stageConfig never produces one, but the fold is total). KISS — a single
// cumulative scan, no allocation.
export function rosterPick(rng: RNG, weights: EnemyWeights): string {
  const ids: (keyof EnemyWeights)[] = ['basic', 'fast', 'power', 'armor']
  let total = 0
  for (const id of ids) total += Math.max(0, weights[id])
  if (total <= 0) return 'basic' // degenerate roster → the baseline (total fold; never undefined).
  let roll = rng() * total
  for (const id of ids) {
    roll -= Math.max(0, weights[id])
    if (roll < 0) return id
  }
  return 'armor' // floating-point tail guard (roll landed exactly at total) — the last id.
}

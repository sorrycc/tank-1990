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
  BOSS_TANK_HP,
  BOSS_TELEGRAPH_SEC,
  BOSS_HP_PER_BOSS_STAGE,
  BOSS_HP_MAX,
  BOSS_STAGE_EVERY,
} from './constants.js'

// ── TankBehavior (D2 → F6 D1) ── the behaviour TAG that selects the AI branch (the four enemy types + the
// player). F6 fills the slot the F4 header reserved: the BOSS is a 5th spec + a 'boss' tag on this SAME
// entity/FSM (the LOCKED decision) — NOT a new entity/scene. One more tag, no new movement/AI/combat path.
export type TankBehavior = 'basic' | 'fast' | 'power' | 'armor' | 'player' | 'boss'

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

  // ── F6 boss telegraph (F6 §5.2/§5.3, D2, AC2) — OPTIONAL, default the IDENTITY (0 = no telegraph) ── seconds
  // of pre-fire wind-up. ONLY the BOSS sets it (BOSS_TELEGRAPH_SEC); the four archetypes + the player OMIT it →
  // 0 → Tank.updateAI takes the EXISTING immediate-fire path BYTE-UNCHANGED (the gated new branch fires only when
  // telegraphSec > 0 — purely additive, no behaviour change for any existing spec, so every identity-fold pin
  // the verifier asserts holds). A spec with telegraphSec > 0 ARMS a wind-up before each shot (a visible warning
  // blink), keeping a heavier/faster volley readable + dodgeable (the reference's telegraph idea on the ONE FSM).
  telegraphSec?: number // s — pre-fire wind-up (default 0 = fire on the beat, the existing path; boss sets it).

  // ── F5 run-SETUP fields (F5 §5.2, D7) — OPTIONAL, default the IDENTITY (0) ── two Hub permanent-upgrade
  // rows are run-SETUP, not per-tank FEEL: `+1 starting life` and `+star-start`. To keep applyUpgrades a PURE
  // `spec → spec` fold (DRY with applyStarTier), they fold into these two OPTIONAL spec fields that ONLY the
  // run-start setup reads (GameScene reads the folded MetaState.startSpec(slot) → seeds createRunState's
  // per-slot {lives,tier} map — D5b). The per-tank movement/fire code IGNORES them (they're not feel stats).
  // Defaulting to 0/undefined keeps a fresh meta byte-identical (the verifier's identity-fold pin holds).
  startLivesBonus?: number // F5 (D7) — +N extra starting lives this slot launches a run with (default 0).
  startTier?: number // F5 (D7) — the star tier this slot STARTS a run at (default 0 = the base spec).
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

// ── BOSS (F6 §5.2, D1/D2/D3/D11, AC1/AC2/AC9) ── the 5th spec: the heavy capstone tank spawned on every boss
// stage. It is the SAME `Tank` entity (a 'boss' behaviour TAG — the LOCKED decision), distinguished by a HEAVY
// spec + a telegraphed fire wind-up. The verifier asserts its well-formedness + the heavier-than-armor HP + the
// CONCRETE heavier-fire profile (AC9, issue #2):
//   • maxHp = BOSS_TANK_HP (≥ ARMOR_TANK_HP) — multi-hit "for free" via the F3 HP funnel (survives many hits, AC2).
//   • bulletSpeed pinned ≥ POWER.bulletSpeed (a fast bolt — the verifier reads the RAW spec number, issue #2). We
//     match POWER's exact bulletSpeed so the ≥ check is satisfied + the boss's bolt is the fastest in the game.
//   • fireCooldown pinned ≤ BASIC.fireCooldown (a shorter beat than a basic tank — the other half of the check).
//     Set below BASIC's 0.9 so the boss shoots more readily; the BOSS_TELEGRAPH_SEC wind-up keeps it FAIR (the
//     heavier/faster shot is telegraphed → readable, AC2).
//   • telegraphSec = BOSS_TELEGRAPH_SEC (> 0) — the pre-fire wind-up (the dodge contract; the verifier asserts > 0).
//   • scoreValue the HIGHEST (> ARMOR.scoreValue) — the capstone is the biggest single reward (D11).
// The boss is a NON-carrier (D11 — pinned at the spawn site in GameScene, not here: a spec field is data; the
// scene sets enemy.carrier=false so the boss fight stays clean, no power-up drop mid-transition). The boss is
// NOT added to ENEMY_ARCHETYPES/ENEMY_SPECS (D3) — it is spawned EXPLICITLY by the scene as the stage capstone,
// never weighted into rosterPick (so the F4 "rosterPick only returns the four normal ids" check stays green).
export const BOSS: TankSpec = {
  id: 'boss',
  behavior: 'boss',
  maxHp: BOSS_TANK_HP, // ≥ ARMOR_TANK_HP — the heavy capstone wall (multi-hit via the F3 funnel — AC2).
  moveSpeed: TANK_SPEED, // a heavy, deliberate cruise (the baseline drive — it does not out-run the player).
  bulletSpeed: POWER.bulletSpeed, // a fast bolt — pinned ≥ POWER.bulletSpeed (the heavier-fire check, AC2/AC9).
  fireCooldown: 0.7, // a measured beat — pinned ≤ BASIC.fireCooldown (0.9); the telegraph keeps it fair (AC2).
  maxBullets: 2, // the boss may have two shots out (heavier volume than the classic single — still capped).
  color: 0x2d3436, // a dark, heavy slate (programmer-art primitive — distinct from every archetype, AC1/AC11).
  colorFlash: 0xb2bec3, // a light flash tint (unused as a carrier — the boss is a non-carrier; kept for the spec shape).
  scoreValue: 1000, // the HIGHEST single reward (> ARMOR.scoreValue 400 — the capstone, D11/AC4).
  telegraphSec: BOSS_TELEGRAPH_SEC, // the pre-fire wind-up (> 0 — the dodge contract, AC2/AC9).
}

// ── bossSpecForStage(stageIndex) → TankSpec (F6 §5.2, D3, AC2/AC9) ── the PURE fold the scene calls to build the
// boss for a given boss stage. Returns a NEW BOSS clone (never mutates BOSS — the aliasing discipline) with ONLY
// `maxHp` scaled up by the boss NUMBER (1 on the first boss stage, 2 on the second, …) so a deeper boss is tankier
// but EQUALLY readable. `telegraphSec` AND the fire fields (`bulletSpeed`/`fireCooldown`) are left UNSCALED — so a
// deep boss keeps the same fixed telegraph window (the dodge contract) AND the same verifier-asserted heavier-fire
// profile (bulletSpeed ≥ POWER / fireCooldown ≤ BASIC) at every depth (issue #2). The reference's `scaleBossSpec`
// philosophy, trimmed to Tank 1990's single maxHp scalar. The maxHp ramp is clamped to BOSS_HP_MAX so the deepest
// boss stays winnable (the difficulty envelope stays bounded — D3). The verifier asserts the fold is deterministic,
// returns a NEW object, is monotone non-decreasing in maxHp across boss stages, is never weaker than BOSS at the
// base, and leaves telegraphSec/bulletSpeed/fireCooldown equal to BOSS's (AC9). PURE — verifier-imported.
export function bossSpecForStage(stageIndex: number): TankSpec {
  const s = Math.max(0, Math.floor(stageIndex || 0))
  // The boss NUMBER: 1 on the first boss stage (index BOSS_STAGE_EVERY-1 = 4), 2 on the second (index 9), … The
  // boss stages are the (BOSS_STAGE_EVERY·n − 1) indices, so floor((s+1)/BOSS_STAGE_EVERY) counts them (1,2,3,…).
  const bossNumber = Math.max(1, Math.floor((s + 1) / BOSS_STAGE_EVERY))
  const maxHp = Math.min(BOSS_HP_MAX, BOSS_TANK_HP + BOSS_HP_PER_BOSS_STAGE * (bossNumber - 1))
  // A NEW spec (spread BOSS, override ONLY maxHp). telegraphSec/bulletSpeed/fireCooldown ride along unchanged from
  // BOSS (the heavier-fire profile + the dodge window are preserved at depth — AC9). Math.round keeps maxHp integer.
  return { ...BOSS, maxHp: Math.round(maxHp) }
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

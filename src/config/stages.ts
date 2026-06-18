// ── Per-stage difficulty config (F2 Procedural stages §5.2, Decisions D3/D16, AC2/AC9) ──
// PURE module — NO Phaser import — so the seeded generator + the headless verifier node-import it (a
// stray `import 'phaser'` would throw under node — AC11). This is Tank 1990's analogue of the read-only
// `dead-cell` reference's `config/biomes.ts` + `config/difficulty.ts`: it owns the per-stage difficulty
// PARAMETERS (terrain densities + the enemy roster + counts) that the generator reads to shape a stage.
//
// THE ENDLESS DIVERGENCE (D3): the reference walks a FIXED ordered `BIOME_ORDER` list with per-biome
// bands + a `difficultyTier`. Tank 1990 is ENDLESS (the locked decision — a run ends only on eagle
// loss / lives spent), so there is NO terminal list. Instead `stageConfig(stageIndex)` is a closed-form
// PURE FUNCTION that scales each difficulty axis MONOTONICALLY with the stage number and CLAMPS it to a
// named cap (so deep stages stay PLAYABLE, not a solid wall of steel). The verifier sweeps
// `stageConfig(0..K)` asserting monotonicity (AC9) — the exact analogue of the reference's "tiers
// non-decreasing along BIOME_ORDER". It reuses `ENEMIES_PER_STAGE`/`MAX_CONCURRENT_ENEMIES`/
// `BOSS_STAGE_EVERY` from constants.ts (DRY) as the anchor values it scales around.

import {
  ENEMIES_PER_STAGE,
  MAX_CONCURRENT_ENEMIES,
  BOSS_STAGE_EVERY,
  SPAWN_INTERVAL_MIN_SCALE,
} from './constants.js'

// ── StageConfig — the params the generator reads (§5.2, AC2). ── Plain data (no functions) so it stays
// trivially serializable + comparable. Densities are a fraction of the eligible interior cells the
// terrain scatter draws a per-cell Bernoulli against (§5.3 step 5); the counts drive the enemy roster
// (consumed by the LATER enemy-spawn feature — F2 only flags `isBoss` + emits the numbers).
export interface StageConfig {
  stageIndex: number
  // Terrain densities (0..1) — the per-cell scatter probability for each kind (§5.3 step 5, D14).
  brickDensity: number
  steelDensity: number
  waterDensity: number
  treesDensity: number
  iceDensity: number
  // Enemy counts — `totalEnemies` to clear, `concurrentEnemies` the on-screen cap (≤ MAX_CONCURRENT_ENEMIES).
  totalEnemies: number
  concurrentEnemies: number
  // The weighted enemy roster (the four classic types). RAW weights — their sum need NOT be 1; the LATER
  // spawn feature normalizes them. D16: the monotone quantity is the NORMALIZED `hardShare`, NOT a raw weight.
  enemyWeights: { basic: number; fast: number; power: number; armor: number }
  isBoss: boolean // true on every BOSS_STAGE_EVERY-th stage (the heavy boss-tank milestone).
}

// ── Named caps (AC2) — the upper bounds each scaling axis CLAMPS to, owned here so the verifier asserts
// "monotone but bounded" against the REAL source (not a magic number duplicated in the test). Chosen so a
// deep stage is dense + dangerous yet still solvable (terrain never seals the playfield; D3 keeps it KISS).
export const BRICK_DENSITY_MAX = 0.32
export const STEEL_DENSITY_MAX = 0.18
export const WATER_DENSITY_MAX = 0.1
export const TREES_DENSITY_MAX = 0.12
export const ICE_DENSITY_MAX = 0.1
export const TOTAL_ENEMIES_MAX = 40 // cap on a stage's enemy total (ENEMIES_PER_STAGE ramps up to this).

// ── Base densities at stage 0 + the per-stage linear ramps (D3) ── all PRIVATE; `stageConfig` folds
// them. Each axis is `min(CAP, base + k·stageIndex)` — non-decreasing in stageIndex by construction
// (k ≥ 0, the clamp only flattens the top), which is exactly the monotonicity the verifier asserts (AC9).
const BRICK_BASE = 0.16
const BRICK_PER_STAGE = 0.012
const STEEL_BASE = 0.04
const STEEL_PER_STAGE = 0.01
const WATER_BASE = 0.03
const WATER_PER_STAGE = 0.005
const TREES_BASE = 0.05
const TREES_PER_STAGE = 0.004
const ICE_BASE = 0.03
const ICE_PER_STAGE = 0.004

// Enemy-count ramps: total climbs from ENEMIES_PER_STAGE toward TOTAL_ENEMIES_MAX; concurrent climbs
// from a gentle 1 toward MAX_CONCURRENT_ENEMIES (so early stages stagger fewer tanks on-screen).
const TOTAL_ENEMIES_PER_STAGE = 1 // +1 enemy to clear per stage (clamped to TOTAL_ENEMIES_MAX).
const CONCURRENT_BASE = 1
const CONCURRENT_PER_STAGES = 4 // +1 concurrent enemy every this-many stages (clamped to MAX_CONCURRENT_ENEMIES).

// Enemy-mix ramp (D16): the HARD types (power/armor) gain weight as the easy types (basic/fast) taper,
// so the NORMALIZED `hardShare` is monotonically non-decreasing. The easy weights MAY DECREASE — which
// is WHY the verifier checks `hardShare`, not each raw weight field (AC9/D16).
const BASIC_BASE = 10
const BASIC_PER_STAGE = -0.4 // easy types taper (may go down — the hard share still rises, D16).
const FAST_BASE = 6
const FAST_PER_STAGE = -0.1
const POWER_BASE = 2
const POWER_PER_STAGE = 0.5 // hard types climb.
const ARMOR_BASE = 1
const ARMOR_PER_STAGE = 0.5

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// ── stageConfig(stageIndex) → StageConfig (AC2, D3) ── the closed-form monotone selector. PURE +
// deterministic (no RNG — the SEED only feeds the terrain SCATTER inside the generator; the difficulty
// envelope is a pure function of the stage number). Every axis is `min(cap, base + k·stageIndex)` with
// k ≥ 0 (terrain/counts) so it is provably non-decreasing (AC9); the enemy weights ramp so `hardShare`
// rises (D16). `isBoss` flags every BOSS_STAGE_EVERY-th stage. A negative/NaN index is clamped to 0
// (defensive — the run-management feature always passes a non-negative integer; this never crashes).
export function stageConfig(stageIndex: number): StageConfig {
  const s = Math.max(0, Math.floor(stageIndex || 0))

  return {
    stageIndex: s,
    brickDensity: clamp(BRICK_BASE + BRICK_PER_STAGE * s, 0, BRICK_DENSITY_MAX),
    steelDensity: clamp(STEEL_BASE + STEEL_PER_STAGE * s, 0, STEEL_DENSITY_MAX),
    waterDensity: clamp(WATER_BASE + WATER_PER_STAGE * s, 0, WATER_DENSITY_MAX),
    treesDensity: clamp(TREES_BASE + TREES_PER_STAGE * s, 0, TREES_DENSITY_MAX),
    iceDensity: clamp(ICE_BASE + ICE_PER_STAGE * s, 0, ICE_DENSITY_MAX),
    // totalEnemies ramps from ENEMIES_PER_STAGE; concurrent ramps from CONCURRENT_BASE. Both clamped so a
    // deep stage stays the classic cap. `totalEnemies ≥ concurrentEnemies` holds for every stage (AC2):
    // total starts at ENEMIES_PER_STAGE (20) ≥ the concurrent cap (4) and only grows.
    totalEnemies: clamp(
      ENEMIES_PER_STAGE + TOTAL_ENEMIES_PER_STAGE * s,
      ENEMIES_PER_STAGE,
      TOTAL_ENEMIES_MAX,
    ),
    concurrentEnemies: clamp(
      CONCURRENT_BASE + Math.floor(s / CONCURRENT_PER_STAGES),
      CONCURRENT_BASE,
      MAX_CONCURRENT_ENEMIES,
    ),
    enemyWeights: {
      // Easy types taper (clamped ≥ 1 so the roster never empties); hard types climb. The NORMALIZED
      // hardShare (below) is the monotone quantity AC9/D16 pins — NOT these raw fields.
      basic: clamp(BASIC_BASE + BASIC_PER_STAGE * s, 1, BASIC_BASE),
      fast: clamp(FAST_BASE + FAST_PER_STAGE * s, 1, FAST_BASE),
      power: POWER_BASE + POWER_PER_STAGE * s,
      armor: ARMOR_BASE + ARMOR_PER_STAGE * s,
    },
    // Every BOSS_STAGE_EVERY-th stage is a boss milestone. Indexing is 0-based, so the cadence predicate
    // is `(s % BOSS_STAGE_EVERY) === BOSS_STAGE_EVERY - 1` — stages 4, 9, 14, … are boss stages (the 5th,
    // 10th, … in 1-based human terms). The verifier asserts exactly this cadence (AC2/AC9).
    isBoss: s % BOSS_STAGE_EVERY === BOSS_STAGE_EVERY - 1,
  }
}

// ── F4 enemy-pressure ramps (F4 Procedural stages extension §5.2/§5.5, Decisions D6, AC6) ──
// Two PURE closed-form monotone ramps the F4 spawn/AI pressure rises with: the enemy BULLET SPEED scale and
// the SPAWN INTERVAL scale. Both are pure functions of the stage number (NO RNG — like `stageConfig`); the
// verifier RE-derives + sweeps each for monotonicity (AC6), extending F2's §5 sweep. They sit BESIDE the
// existing terrain/count ramps (KISS — a couple of clamped linear ramps), keeping the difficulty envelope's
// single owner here (DRY). `hardShare` (below, F2) is the third F4 enemy-hardness signal the verifier reads.

// bulletSpeedScale base + ramp: every enemy's fired bullet speed is multiplied by this (≥ 1, NON-DECREASING),
// so deeper stages' shots arrive faster — the enemy fire PRESSURE that climbs with the stage (AC6). Clamped to
// a named cap so a deep-stage bullet stays dodgeable (never an un-reactable wall of fire — D3's "bounded" stance).
const BULLET_SPEED_SCALE_BASE = 1.0 // stage-0 multiplier (the identity — enemies fire at their spec speed).
const BULLET_SPEED_SCALE_PER_STAGE = 0.02 // +2% bullet speed per stage (non-decreasing by construction, k ≥ 0).
export const BULLET_SPEED_SCALE_MAX = 1.6 // cap — a deep-stage enemy bullet is at most 1.6× its base speed.

// spawnIntervalScale base + ramp: the staggered-spawn delay is multiplied by this (≤ 1, NON-INCREASING), so
// deeper stages stream enemies FASTER (they arrive no slower — AC6). Clamped to SPAWN_INTERVAL_MIN_SCALE (the
// shared floor, constants.ts) so the stream never becomes instant (a finite minimum cadence — D8). k ≤ 0.
const SPAWN_INTERVAL_SCALE_BASE = 1.0 // stage-0 multiplier (the identity — the base SPAWN_STAGGER_BASE cadence).
const SPAWN_INTERVAL_SCALE_PER_STAGE = -0.04 // −4% spawn delay per stage (non-increasing by construction, k ≤ 0).

// ── bulletSpeedScale(stageIndex) → [1, BULLET_SPEED_SCALE_MAX] (D6, AC6) ── the closed-form monotone enemy
// bullet-speed multiplier (NON-DECREASING in the stage). PURE + deterministic (no RNG). The spawn loop reads
// it to scale the archetype's `bulletSpeed`; the verifier RE-derives + asserts it non-decreasing (AC6).
export function bulletSpeedScale(stageIndex: number): number {
  const s = Math.max(0, Math.floor(stageIndex || 0))
  return clamp(BULLET_SPEED_SCALE_BASE + BULLET_SPEED_SCALE_PER_STAGE * s, BULLET_SPEED_SCALE_BASE, BULLET_SPEED_SCALE_MAX)
}

// ── spawnIntervalScale(stageIndex) → [SPAWN_INTERVAL_MIN_SCALE, 1] (D6/D8, AC6) ── the closed-form monotone
// spawn-cadence multiplier (NON-INCREASING in the stage — enemies arrive no slower). PURE + deterministic. The
// spawn loop multiplies SPAWN_STAGGER_BASE by it; the verifier RE-derives + asserts it non-increasing (AC6).
export function spawnIntervalScale(stageIndex: number): number {
  const s = Math.max(0, Math.floor(stageIndex || 0))
  return clamp(SPAWN_INTERVAL_SCALE_BASE + SPAWN_INTERVAL_SCALE_PER_STAGE * s, SPAWN_INTERVAL_MIN_SCALE, SPAWN_INTERVAL_SCALE_BASE)
}

// ── hardShare(cfg) → [0,1] (D16, AC9) ── the EXACT normalized share of the two HARD enemy types
// (power + armor) over the whole roster. This is the single monotone quantity the verifier asserts is
// non-decreasing across `stageConfig(0..K)` — NOT each raw weight (the easy weights may TAPER while this
// share climbs, which a naive per-field check would wrongly flag). Exported so BOTH `stageConfig`'s
// authoring intent AND the verifier's check read the SAME definition (DRY). Defends a degenerate
// all-zero roster with 0 (never divides by zero — the live stageConfig never produces one).
export function hardShare(cfg: StageConfig): number {
  const w = cfg.enemyWeights
  const total = w.basic + w.fast + w.power + w.armor
  if (total <= 0) return 0
  return (w.power + w.armor) / total
}

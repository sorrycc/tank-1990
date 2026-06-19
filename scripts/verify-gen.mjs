// ── Headless determinism + procedural-stage verifier (F0 scaffold §7 + F2 Procedural stages §7,
// Decisions D1/D9/D10/D13/D14/D15/D16, AC4–AC9/AC11) ──
// Run by `npm run verify` under plain node (via tsx) — NO Phaser, NO browser. It imports the EXACT PURE
// modules the game runs (util/rng.ts, config/constants.ts, util/save.ts, config/tiles.ts, config/stages.ts,
// world/LevelGenerator.ts) and asserts the contracts the procedural foundation depends on. A SUCCESSFUL
// import of those modules already RE-PROVES the purity convention (AC11): a Phaser-coupled module (any
// scene / world/TileMap.ts / main.ts) would throw under node — which is exactly why this script NEVER
// imports them. The check is an INDEPENDENT proof, not self-certification (D9): the enclosure +
// reachability + spawn validity + bounds are RE-DERIVED from the EMITTED `tiles`/`spawns`, so a bug in the
// generator's carve that "intended" a solvable stage is caught HERE, not trusted.
//
// F0 shipped a determinism + purity STUB; F2 fills in the REAL quality gate — the seeded-stage sweep the
// F0 doc always promised. Sections:
//   1. rng determinism + regression pin (AC — the foundation; unchanged from F0).
//   2. constants — the one trivial invariant (also re-proves node-importability / purity).
//   3. save — round-trip + the clone-no-alias contract (unchanged from F0).
//   4. tiles — TILE_PROPS totality + the helpers read the table (AC1).
//   5. stages — monotonic difficulty across stageConfig(0..K): densities + counts + hardShare +
//      boss cadence, all within named caps (AC2/AC9, D16).
//   6. stage sweep over N seeds × the first K stages (incl. a boss stage), RE-deriving every property
//      from the EMITTED description (AC4–AC8):
//        a. determinism — generateStage(seed,cfg) twice → DEEP-EQUAL (AC4).
//        b. regression pin — ONE fixed (seed,stageIndex) → a COMPUTED reference (deep-equal, AC5).
//        c. bounds — grid dims; valid TILE ints; enemy counts within cfg bounds; each terrain count ≤
//           scatterCells (the absolute max-count ceiling — D14, AC6).
//        d. eagle present + enclosed + REACHABLE via a footprint-aware BFS to a fort-approach window (AC7).
//        e. spawn validity — every spawn a tankFits anchor + its (x,y) == the window-center pin (AC8/D13).
// Exits non-zero on ANY failure so `npm run verify` gates CI; prints `OK` + exits 0 on success.

import { mulberry32, range } from '../src/util/rng.js'
import { DESIGN_WIDTH, GRID_COLS, GRID_ROWS, TILE_SIZE, PLAYFIELD_X, PLAYFIELD_Y, MAX_CONCURRENT_ENEMIES, BOSS_STAGE_EVERY, ENEMIES_PER_STAGE } from '../src/config/constants.js'
import { DEFAULT_META, loadMeta, saveMeta } from '../src/util/save.js'
// F2 PURE modules (D1/D9): the tile semantics, the difficulty selector, and the seeded generator + its
// SHARED predicates. Importing them here under node RE-PROVES their purity (a stray `import 'phaser'`
// throws) — the convention every pure module satisfies.
import { TILE, TILE_PROPS, isTankPassable, isBulletPassable, isDestructible } from '../src/config/tiles.js'
import { stageConfig, hardShare, bulletSpeedScale, spawnIntervalScale, difficultyPressure, BRICK_DENSITY_MAX, STEEL_DENSITY_MAX, WATER_DENSITY_MAX, TREES_DENSITY_MAX, ICE_DENSITY_MAX, TOTAL_ENEMIES_MAX, BULLET_SPEED_SCALE_MAX } from '../src/config/stages.js'
import { generateStage, tankFits, isFortApproachWindow, windowCenter, FOOTPRINT, STAGE_MOTIFS, selectMotif, MOTIF_PARAMS } from '../src/world/LevelGenerator.js'
// F4 PURE modules (D1/D5/D11): the tank roster + the active-run owner. Importing them here under node
// RE-PROVES their purity (a stray `import 'phaser'` throws) — the convention every pure module satisfies.
import { ENEMY_ARCHETYPES, ENEMY_SPECS, BASIC, FAST, POWER, ARMOR, BOSS, bossSpecForStage, PLAYER_BASE, PLAYER_STAR_TIERS, applyStarTier, rosterPick } from '../src/config/tanks.js'
import { ARMOR_TANK_HP, SPAWN_INTERVAL_MIN_SCALE, CURRENCY_RATIO, FIRE_COOLDOWN, EXTRA_LIFE_SCORE } from '../src/config/constants.js'
import { createRunState, extraLivesCrossed } from '../src/core/RunState.js'
// ── F5 PURE modules (D1/D3/D5/D6/D12): the power-up roster, the permanent upgrade rows + applyUpgrades, and
// the i18n core + the two dictionaries. Importing them here under node RE-PROVES their purity (a stray
// `import 'phaser'` throws) — the convention every pure module satisfies (AC9/AC11). The Phaser-coupled
// entities/PowerUp.ts, world/TileMap.ts, the scenes, and MetaState's storage methods are NEVER imported.
import { POWERUPS, POWERUP_BY_ID, POWERUP_KINDS, pickPowerUpKind, HELMET_SHIELD_SEC, CLOCK_FREEZE_SEC, SHOVEL_FORTIFY_SEC, BOAT_SAIL_SEC, DRILL_PIERCE_SEC } from '../src/config/powerups.js'
import { TANK_UPGRADES, TANK_UPGRADES_BY_ID, applyUpgrades } from '../src/config/tank-upgrades.js'
import { t, tName, tDesc, setLocale } from '../src/i18n/index.js'
import { EN } from '../src/i18n/en.js'
import { ZH_CN } from '../src/i18n/zh-CN.js'

function fail(msg) {
  console.error(`verify-gen FAILED: ${msg}`)
  process.exit(1)
}

// ── Element-wise deep-equal (the tiles grid is a 2-D int array, so `===` would test REFERENCE identity,
// not value; two fresh generations have different array objects). Handles plain objects, arrays (incl. the
// nested int grid), and primitives. KISS + sufficient for the pure-data descriptions (no functions on them).
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false // primitives that weren't === (incl. NaN) are unequal.
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1) rng determinism + regression pin — the determinism foundation (unchanged from F0).
// ════════════════════════════════════════════════════════════════════════════════════════════
const RNG_SEED = 0x1234abcd
const RNG_K = 5
// Pinned vector: mulberry32(0x1234abcd) → first 5 outputs (COMPUTED from the verbatim algorithm, never
// hand-invented; byte-identical to the read-only `dead-cell` reference's pin — proves the copy in
// src/util/rng.ts is byte-identical). If rng.ts changes algorithm this fails loudly.
const RNG_EXPECTED = [
  0.10277144517749548, 0.5144855019170791, 0.07858735416084528, 0.6312816452700645,
  0.978210358414799,
]
{
  const a = mulberry32(RNG_SEED)
  const b = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const va = a()
    const vb = b()
    if (va !== vb) fail(`rng determinism: draw ${i} differs (${va} !== ${vb})`)
  }
  const r = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const v = r()
    if (v !== RNG_EXPECTED[i]) fail(`rng pin: draw ${i} = ${v}, expected ${RNG_EXPECTED[i]}`)
  }
  const rr = mulberry32(RNG_SEED)
  const x = range(rr, 10, 20)
  if (!(x >= 10 && x < 20)) fail(`rng range: ${x} not in [10,20)`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2) constants — the one trivial invariant (also re-proves node-importability / purity).
// ════════════════════════════════════════════════════════════════════════════════════════════
if (DESIGN_WIDTH !== 1280) fail(`constants: DESIGN_WIDTH = ${DESIGN_WIDTH}, expected 1280`)
if (GRID_COLS !== 17 || GRID_ROWS !== 17) fail(`constants: grid is ${GRID_COLS}x${GRID_ROWS}, expected 17x17`)

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3) save — round-trip + the clone-no-alias contract (F0; EXTENDED with the highScores field — high-score table).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  saveMeta(loadMeta()) // round-trip; under node this is a defensive no-op (must not throw).
  const m = loadMeta()
  if (m.currency !== 0) fail(`save: currency = ${m.currency}, expected 0`)
  if (m.bestScore !== 0) fail(`save: bestScore = ${m.bestScore}, expected 0`)
  if (m.bestStage !== 0) fail(`save: bestStage = ${m.bestStage}, expected 0`)
  if (!m.upgrades || typeof m.upgrades !== 'object') fail(`save: upgrades missing/not an object`)
  if (!('1' in m.upgrades) || !('2' in m.upgrades)) fail(`save: upgrades missing per-player keys '1'/'2'`)
  if (m.upgrades['1'] === DEFAULT_META.upgrades['1']) fail(`save: upgrades['1'] ALIASES the frozen DEFAULT_META`)
  if (m.upgrades['2'] === DEFAULT_META.upgrades['2']) fail(`save: upgrades['2'] ALIASES the frozen DEFAULT_META`)
  // The high-score TABLE field round-trips with a [] default + the SAME clone-no-alias contract as upgrades:
  // a fresh/older save reads an EMPTY array that does NOT alias the frozen DEFAULT_META.highScores (a later
  // bankRun push would otherwise mutate the shared frozen default / throw).
  if (!Array.isArray(m.highScores)) fail(`save: highScores is not an array`)
  if (m.highScores.length !== 0) fail(`save: highScores length = ${m.highScores.length}, expected 0 (the [] default)`)
  if (m.highScores === DEFAULT_META.highScores) fail(`save: highScores ALIASES the frozen DEFAULT_META`)
  const m2 = loadMeta()
  if (m.upgrades['1'] === m2.upgrades['1']) fail(`save: two loads share the SAME upgrades['1'] container`)
  if (m.highScores === m2.highScores) fail(`save: two loads share the SAME highScores container`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4) tiles — TILE_PROPS totality + the helpers READ the table (AC1).
// Every TILE value has a TILE_PROPS row with the four fields, and the three helpers return the table's
// booleans (a defensive `false` for an out-of-range value). The classic semantics are spot-checked so a
// silent prop flip (e.g. making WATER block bullets) fails loudly.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const allTiles = Object.values(TILE)
  for (const t of allTiles) {
    const p = TILE_PROPS[t]
    if (!p) fail(`tiles: TILE_PROPS missing a row for tile ${t}`)
    for (const f of ['passableByTank', 'passableByBullet', 'destructible']) {
      if (typeof p[f] !== 'boolean') fail(`tiles: TILE_PROPS[${t}].${f} is not a boolean`)
    }
    if (typeof p.color !== 'number') fail(`tiles: TILE_PROPS[${t}].color is not a number`)
    // The helpers must READ the table, not re-encode literals (AC1) — assert they agree with it.
    if (isTankPassable(t) !== p.passableByTank) fail(`tiles: isTankPassable(${t}) disagrees with TILE_PROPS`)
    if (isBulletPassable(t) !== p.passableByBullet) fail(`tiles: isBulletPassable(${t}) disagrees with TILE_PROPS`)
    if (isDestructible(t) !== p.destructible) fail(`tiles: isDestructible(${t}) disagrees with TILE_PROPS`)
  }
  // Classic semantics spot-check (AC1): BRICK destructible+blocks both; STEEL blocks both, indestructible;
  // WATER blocks tanks, bullets PASS; TREES/ICE pass both; BASE blocks both; EMPTY passes both.
  if (!isDestructible(TILE.BRICK) || isTankPassable(TILE.BRICK) || isBulletPassable(TILE.BRICK)) fail(`tiles: BRICK semantics wrong`)
  if (isDestructible(TILE.STEEL) || isTankPassable(TILE.STEEL) || isBulletPassable(TILE.STEEL)) fail(`tiles: STEEL semantics wrong`)
  if (isTankPassable(TILE.WATER) || !isBulletPassable(TILE.WATER)) fail(`tiles: WATER must block tanks + pass bullets`)
  if (!isTankPassable(TILE.TREES) || !isBulletPassable(TILE.TREES)) fail(`tiles: TREES must pass both`)
  if (!isTankPassable(TILE.ICE) || !isBulletPassable(TILE.ICE)) fail(`tiles: ICE must pass both`)
  if (isTankPassable(TILE.BASE) || isBulletPassable(TILE.BASE)) fail(`tiles: BASE must block both`)
  if (!isTankPassable(TILE.EMPTY) || !isBulletPassable(TILE.EMPTY)) fail(`tiles: EMPTY must pass both`)
  // The defensive default: an out-of-range tile is impassable/indestructible (never crashes).
  if (isTankPassable(999) || isBulletPassable(999) || isDestructible(999)) fail(`tiles: out-of-range tile must default to false`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5) stages — MONOTONIC difficulty across stageConfig(0..K) (AC2/AC9, D16).
// Each terrain density + totalEnemies + concurrentEnemies is non-decreasing; the NORMALIZED hardShare
// (power+armor)/(basic+fast+power+armor) is non-decreasing (D16 — NOT each raw weight); every value is
// within its named cap; concurrent ≤ MAX_CONCURRENT_ENEMIES; total ≥ concurrent; isBoss matches the
// BOSS_STAGE_EVERY cadence. K spans several boss stages so the cadence is exercised.
// ════════════════════════════════════════════════════════════════════════════════════════════
const STAGE_K = 30 // sweep stageConfig(0..STAGE_K) — covers multiple boss milestones (every 5th).
{
  let prev = null
  for (let s = 0; s <= STAGE_K; s++) {
    const cfg = stageConfig(s)
    if (cfg.stageIndex !== s) fail(`stages: stageConfig(${s}).stageIndex = ${cfg.stageIndex}`)
    // Within-cap + sanity bounds (AC2).
    if (cfg.brickDensity < 0 || cfg.brickDensity > BRICK_DENSITY_MAX) fail(`stages: brickDensity ${cfg.brickDensity} out of [0,${BRICK_DENSITY_MAX}] at ${s}`)
    if (cfg.steelDensity < 0 || cfg.steelDensity > STEEL_DENSITY_MAX) fail(`stages: steelDensity ${cfg.steelDensity} out of [0,${STEEL_DENSITY_MAX}] at ${s}`)
    if (cfg.waterDensity < 0 || cfg.waterDensity > WATER_DENSITY_MAX) fail(`stages: waterDensity ${cfg.waterDensity} out of [0,${WATER_DENSITY_MAX}] at ${s}`)
    if (cfg.treesDensity < 0 || cfg.treesDensity > TREES_DENSITY_MAX) fail(`stages: treesDensity ${cfg.treesDensity} out of [0,${TREES_DENSITY_MAX}] at ${s}`)
    if (cfg.iceDensity < 0 || cfg.iceDensity > ICE_DENSITY_MAX) fail(`stages: iceDensity ${cfg.iceDensity} out of [0,${ICE_DENSITY_MAX}] at ${s}`)
    if (cfg.totalEnemies < ENEMIES_PER_STAGE || cfg.totalEnemies > TOTAL_ENEMIES_MAX) fail(`stages: totalEnemies ${cfg.totalEnemies} out of [${ENEMIES_PER_STAGE},${TOTAL_ENEMIES_MAX}] at ${s}`)
    if (cfg.concurrentEnemies < 1 || cfg.concurrentEnemies > MAX_CONCURRENT_ENEMIES) fail(`stages: concurrentEnemies ${cfg.concurrentEnemies} out of [1,${MAX_CONCURRENT_ENEMIES}] at ${s}`)
    if (cfg.totalEnemies < cfg.concurrentEnemies) fail(`stages: totalEnemies < concurrentEnemies at ${s}`)
    // Boss cadence (AC2): every BOSS_STAGE_EVERY-th stage (0-based: indices 4,9,14,…).
    const expectBoss = s % BOSS_STAGE_EVERY === BOSS_STAGE_EVERY - 1
    if (cfg.isBoss !== expectBoss) fail(`stages: isBoss(${s}) = ${cfg.isBoss}, expected ${expectBoss}`)
    // ── F4 enemy-pressure ramps (F4 §5.5, D6, AC6) — within bounds + monotone. bulletSpeedScale ∈ [1, MAX]
    // NON-decreasing; spawnIntervalScale ∈ [MIN_SCALE, 1] NON-increasing (enemies arrive no slower). ──
    const bss = bulletSpeedScale(s)
    const sis = spawnIntervalScale(s)
    if (bss < 1 || bss > BULLET_SPEED_SCALE_MAX) fail(`stages: bulletSpeedScale(${s}) = ${bss} out of [1,${BULLET_SPEED_SCALE_MAX}]`)
    if (sis < SPAWN_INTERVAL_MIN_SCALE || sis > 1) fail(`stages: spawnIntervalScale(${s}) = ${sis} out of [${SPAWN_INTERVAL_MIN_SCALE},1]`)
    // Monotonicity (AC9/D16 + F4 AC6) — each axis non-decreasing vs. the previous stage.
    if (prev) {
      if (cfg.brickDensity < prev.brickDensity) fail(`stages: brickDensity decreased at ${s}`)
      if (cfg.steelDensity < prev.steelDensity) fail(`stages: steelDensity decreased at ${s}`)
      if (cfg.waterDensity < prev.waterDensity) fail(`stages: waterDensity decreased at ${s}`)
      if (cfg.treesDensity < prev.treesDensity) fail(`stages: treesDensity decreased at ${s}`)
      if (cfg.iceDensity < prev.iceDensity) fail(`stages: iceDensity decreased at ${s}`)
      if (cfg.totalEnemies < prev.totalEnemies) fail(`stages: totalEnemies decreased at ${s}`)
      if (cfg.concurrentEnemies < prev.concurrentEnemies) fail(`stages: concurrentEnemies decreased at ${s}`)
      // The NORMALIZED hard-type share (D16) — non-decreasing (NOT each raw weight field).
      if (hardShare(cfg) < hardShare(prev) - 1e-12) fail(`stages: hardShare decreased at ${s} (${hardShare(prev)} → ${hardShare(cfg)})`)
      // F4 (AC6): bullet-speed scale non-DECREASING (enemy fire pressure rises); spawn-interval scale
      // non-INCREASING (enemies arrive no slower). The ±1e-12 absorbs float drift on a flat (clamped) span.
      if (bss < bulletSpeedScale(prev.stageIndex) - 1e-12) fail(`stages: bulletSpeedScale decreased at ${s}`)
      if (sis > spawnIntervalScale(prev.stageIndex) + 1e-12) fail(`stages: spawnIntervalScale increased at ${s}`)
    }
    prev = cfg
  }
}

// ── F-difficulty-select per-level ramp sweep + no-arg IDENTITY (difficulty-select §5.6, D1/D2, AC1/AC2/AC3) ──
// The Title difficulty is a PURE per-level SCALAR composed onto the SAME closed-form ramps then re-clamped to the
// SAME named caps. For EACH level the ramps must STILL be bounded (∈ the caps) AND per-level monotone in the stage
// (the scalar shifts the curve, never un-orders it); and the no-arg default MUST equal the `'normal'` path (the
// identity — so the existing no-arg §5 sweep above is byte-unaffected). difficultyPressure is driven for ordering +
// the unknown→1 fallback. This extends §5 WITHOUT touching the no-arg checks above (they ARE the identity case).
{
  // difficultyPressure: easy < normal === 1 < hard (ordered + bounded), and an unknown/garbage level → normal's 1.
  const pe = difficultyPressure('easy')
  const pn = difficultyPressure('normal')
  const ph = difficultyPressure('hard')
  if (pn !== 1) fail(`difficulty: difficultyPressure('normal') = ${pn}, expected 1 (the identity, AC1)`)
  if (!(pe < pn)) fail(`difficulty: difficultyPressure('easy') (${pe}) not < normal (${pn}) — AC2`)
  if (!(ph > pn)) fail(`difficulty: difficultyPressure('hard') (${ph}) not > normal (${pn}) — AC2`)
  if (difficultyPressure('__nope__') !== pn) fail(`difficulty: an unknown level must fall back to normal's 1.0 (AC2)`)

  // For each level, sweep both ramps over 0..STAGE_K: bounded ∈ the caps + per-level monotone. Each scalar is a
  // per-level CONSTANT, so a fixed level cannot un-order the curve (bullet non-decreasing / spawn non-increasing).
  for (const d of ['easy', 'normal', 'hard']) {
    let prevB = null
    let prevS = null
    for (let s = 0; s <= STAGE_K; s++) {
      const b = bulletSpeedScale(s, d)
      const i = spawnIntervalScale(s, d)
      if (b < 1 || b > BULLET_SPEED_SCALE_MAX) fail(`difficulty: bulletSpeedScale(${s}, '${d}') = ${b} out of [1,${BULLET_SPEED_SCALE_MAX}] (AC3)`)
      if (i < SPAWN_INTERVAL_MIN_SCALE || i > 1) fail(`difficulty: spawnIntervalScale(${s}, '${d}') = ${i} out of [${SPAWN_INTERVAL_MIN_SCALE},1] (AC3)`)
      if (prevB !== null && b < prevB - 1e-12) fail(`difficulty: bulletSpeedScale decreased at ${s} for '${d}' (AC3)`)
      if (prevS !== null && i > prevS + 1e-12) fail(`difficulty: spawnIntervalScale increased at ${s} for '${d}' (AC3)`)
      prevB = b
      prevS = i
    }
  }

  // The no-arg default IS the 'normal' identity (so the existing no-arg §5 sweep above is byte-unaffected — AC3).
  for (let s = 0; s <= STAGE_K; s++) {
    if (bulletSpeedScale(s) !== bulletSpeedScale(s, 'normal')) fail(`difficulty: bulletSpeedScale(${s}) != bulletSpeedScale(${s}, 'normal') — the no-arg default must be the identity (AC3)`)
    if (spawnIntervalScale(s) !== spawnIntervalScale(s, 'normal')) fail(`difficulty: spawnIntervalScale(${s}) != spawnIntervalScale(${s}, 'normal') — the no-arg default must be the identity (AC3)`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6) STAGE SWEEP over N seeds × the first K stages — RE-derive every property from the EMITTED
// description (D9, AC4–AC8). The verifier OWNS its own BFS + count scans + coordinate re-derivation; it
// trusts NOTHING from the generator's intent.
// ════════════════════════════════════════════════════════════════════════════════════════════

// Count a tile kind in the emitted grid (RE-derived — AC6).
function countTile(tiles, kind) {
  let n = 0
  for (const rowArr of tiles) for (const v of rowArr) if (v === kind) n++
  return n
}

// The four orthogonal steps — the BFS neighbourhood + the enclosure scan.
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// ── Footprint-aware reachability BFS (AC7, D5/D15) ── nodes are tankFits FOOTPRINT windows (RE-derived from the
// EMITTED tiles via the SHARED `tankFits` — same graph the generator carved, DRY); edges connect
// orthogonally-adjacent windows. PASS iff a GOAL window — one satisfying the SHARED `isFortApproachWindow`
// (a tankFits window orthogonally adjacent to a fort-ring BRICK cell) — is reached from the start window.
function bfsReachesFort(desc, startCol, startRow) {
  const { tiles, cols, rows, base } = desc
  if (!tankFits(tiles, cols, rows, startCol, startRow)) return false
  const seen = new Set()
  const key = (c, r) => `${c},${r}`
  const queue = [[startCol, startRow]]
  seen.add(key(startCol, startRow))
  while (queue.length) {
    const [c, r] = queue.shift()
    if (isFortApproachWindow(tiles, cols, rows, c, r, base)) return true
    for (const [dc, dr] of ORTHO) {
      const nc = c + dc
      const nr = r + dr
      if (seen.has(key(nc, nr))) continue
      if (!tankFits(tiles, cols, rows, nc, nr)) continue
      seen.add(key(nc, nr))
      queue.push([nc, nr])
    }
  }
  return false
}

// Assert one EMITTED description against AC6/AC7/AC8 (RE-derived). `cfg` is the stageConfig it was built
// with (for the enemy-count bounds). `label` localizes a failure to its (seed, stage).
function checkDescription(desc, cfg, label) {
  const { tiles, cols, rows, base, enemySpawns, playerSpawns } = desc

  // ── F7 AC1/AC2: the emitted layout MOTIF is one of the known STAGE_MOTIFS. Since the motif is chosen INSIDE
  // generateStage (off the off-the-main-thread sub-RNG) and only reshapes the NON-reserved scatter, every
  // invariant re-derived below (enclosure + footprint-BFS reachability + the scatterCells ceiling) covers the
  // EMITTED tiles FOR THIS MOTIF — so this one assertion + the existing checks prove AC2 for every motif the
  // sweep produces with ZERO new proof code (a motif that sealed a corridor or exposed the eagle FAILS loudly). ──
  if (typeof desc.motif !== 'string' || !STAGE_MOTIFS.includes(desc.motif)) fail(`${label}: desc.motif '${desc.motif}' is not one of STAGE_MOTIFS [${STAGE_MOTIFS.join(',')}] (F7 AC1)`)

  // ── AC6 bounds — grid dims + valid TILE ints. ──
  if (cols !== GRID_COLS || rows !== GRID_ROWS) fail(`${label}: grid is ${cols}x${rows}, expected ${GRID_COLS}x${GRID_ROWS}`)
  if (tiles.length !== rows) fail(`${label}: tiles has ${tiles.length} rows, expected ${rows}`)
  const validTiles = new Set(Object.values(TILE))
  for (let r = 0; r < rows; r++) {
    if (tiles[r].length !== cols) fail(`${label}: row ${r} has ${tiles[r].length} cols, expected ${cols}`)
    for (let c = 0; c < cols; c++) {
      if (!validTiles.has(tiles[r][c])) fail(`${label}: invalid tile ${tiles[r][c]} at (${c},${r})`)
    }
  }
  // ── AC6 enemy-count bounds — the description carries the stage flags; the counts come from cfg. ──
  if (desc.stageIndex !== cfg.stageIndex) fail(`${label}: stageIndex ${desc.stageIndex} != cfg ${cfg.stageIndex}`)
  if (desc.isBoss !== cfg.isBoss) fail(`${label}: isBoss ${desc.isBoss} != cfg ${cfg.isBoss}`)
  if (cfg.concurrentEnemies > MAX_CONCURRENT_ENEMIES) fail(`${label}: concurrentEnemies exceeds cap`)
  if (cfg.totalEnemies < cfg.concurrentEnemies) fail(`${label}: totalEnemies < concurrentEnemies`)
  // ── AC6 terrain max-count ceiling (D14) — each per-terrain count ≤ scatterCells (the EXACT eligible-cell
  // count the scatter visited, recorded in the description). The per-cell Bernoulli places AT MOST one tile
  // per eligible cell, so this hard ceiling holds on EVERY seed (NOT a flaky density·N mean). ──
  if (!(desc.scatterCells >= 0 && desc.scatterCells <= cols * rows)) fail(`${label}: scatterCells ${desc.scatterCells} out of range`)
  for (const kind of [TILE.BRICK, TILE.STEEL, TILE.WATER, TILE.TREES, TILE.ICE]) {
    const n = countTile(tiles, kind)
    if (n > desc.scatterCells) fail(`${label}: terrain kind ${kind} count ${n} exceeds scatterCells ceiling ${desc.scatterCells} (D14)`)
  }

  // ── AC7 eagle present + at bottom-center + fully enclosed. ──
  let baseCount = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (tiles[r][c] === TILE.BASE) baseCount++
  if (baseCount !== 1) fail(`${label}: expected exactly 1 BASE tile, found ${baseCount}`)
  if (tiles[base.row][base.col] !== TILE.BASE) fail(`${label}: base.col/row (${base.col},${base.row}) is not a BASE tile`)
  if (base.row !== rows - 1 || base.col !== Math.floor(cols / 2)) fail(`${label}: base not at bottom-center`)
  // Enclosure: every in-grid orthogonal neighbour that is not the base is BRICK or STEEL (the fort wall);
  // an out-of-grid neighbour (the bottom edge) is the grid wall — also "enclosed".
  for (const [dc, dr] of ORTHO) {
    const nc = base.col + dc
    const nr = base.row + dr
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue // grid edge = wall.
    const t = tiles[nr][nc]
    if (t !== TILE.BRICK && t !== TILE.STEEL) fail(`${label}: base neighbour (${nc},${nr}) is ${t}, not BRICK/STEEL (eagle exposed)`)
  }

  // ── AC8 spawn validity + coordinate pin (D13) ── every spawn is a tankFits anchor over the EMITTED
  // tiles, the spawns are distinct + in-bounds, AND each spawn's (x,y) (and base.x/y) EXACTLY equals the
  // FOOTPRINT-aware window center (PLAYFIELD_X+(col+FOOTPRINT/2)·TILE_SIZE, PLAYFIELD_Y+(row+FOOTPRINT/2)·TILE_SIZE).
  const allSpawns = [...enemySpawns, ...playerSpawns]
  if (enemySpawns.length !== 3) fail(`${label}: expected 3 enemy spawns, got ${enemySpawns.length}`)
  if (playerSpawns.length !== 2) fail(`${label}: expected 2 player spawns, got ${playerSpawns.length}`)
  const spawnKeys = new Set()
  for (const s of allSpawns) {
    if (!tankFits(tiles, cols, rows, s.col, s.row)) fail(`${label}: spawn ${s.which} at (${s.col},${s.row}) is not a tankFits anchor`)
    const k = `${s.col},${s.row}`
    if (spawnKeys.has(k)) fail(`${label}: duplicate spawn anchor at ${k}`)
    spawnKeys.add(k)
    const wc = windowCenter(s.col, s.row)
    const expX = PLAYFIELD_X + (s.col + FOOTPRINT / 2) * TILE_SIZE
    const expY = PLAYFIELD_Y + (s.row + FOOTPRINT / 2) * TILE_SIZE
    if (wc.x !== expX || wc.y !== expY) fail(`${label}: windowCenter formula drift at ${s.which}`)
    if (s.x !== expX || s.y !== expY) fail(`${label}: spawn ${s.which} (x,y)=(${s.x},${s.y}) != window-center (${expX},${expY}) — D13`)
  }
  // base.x/y obeys the SAME window-center formula (D13).
  {
    const expX = PLAYFIELD_X + (base.col + FOOTPRINT / 2) * TILE_SIZE
    const expY = PLAYFIELD_Y + (base.row + FOOTPRINT / 2) * TILE_SIZE
    if (base.x !== expX || base.y !== expY) fail(`${label}: base (x,y)=(${base.x},${base.y}) != window-center (${expX},${expY}) — D13`)
  }

  // ── AC7 reachability — a footprint-aware BFS from EACH top enemy spawn reaches a fort-approach goal
  // window (RE-derived from the EMITTED grid). All three must reach (enemies stream from all three lanes).
  for (const s of enemySpawns) {
    if (!bfsReachesFort(desc, s.col, s.row)) fail(`${label}: enemy spawn ${s.which} cannot reach the eagle fort (BFS, AC7/D15)`)
  }
}

// ── The sweep (AC4/AC5/AC6/AC7/AC8 + F7 AC1/AC2/AC3). N seeds × K stages, incl. a boss stage (BOSS_STAGE_EVERY-1). ──
const SWEEP_SEEDS = 200
const SWEEP_STAGES = [0, 1, 2, 3, BOSS_STAGE_EVERY - 1, 7, 12] // includes the first boss stage (index 4).
const SWEEP_MOTIFS = new Set() // F7 (AC1) — the distinct motifs the sweep exercises (≥ 2 → the shape space is used).
for (let i = 0; i < SWEEP_SEEDS; i++) {
  // Spread the seeds across the 32-bit space (the same shape the reference's sweep uses).
  const seed = (i * 0x9e3779b1) >>> 0
  for (const stageIndex of SWEEP_STAGES) {
    const cfg = stageConfig(stageIndex)
    const label = `seed=${seed} stage=${stageIndex}`
    // (a) Determinism (AC4 + F7 AC3 — the deep-equal now includes `motif`) — two generations DEEP-EQUAL.
    const d1 = generateStage(seed, cfg)
    const d2 = generateStage(seed, cfg)
    if (!deepEqual(d1, d2)) fail(`${label}: generateStage is non-deterministic (two calls differ, AC4/F7-AC3)`)
    // (b–e) Bounds / enclosure / reachability / spawn validity (AC6/AC7/AC8) + F7 known-motif (AC1/AC2) — RE-derived.
    checkDescription(d1, cfg, label)
    // F7 (AC1/AC3): selectMotif is DETERMINISTIC (two calls → the same id) AND agrees with the id generateStage
    // emitted (the generator selects via the SAME selectMotif off the SAME seed — DRY, one source of truth).
    const m1 = selectMotif(seed, cfg)
    const m2 = selectMotif(seed, cfg)
    if (m1 !== m2) fail(`${label}: selectMotif non-deterministic (${m1} !== ${m2}) — F7 AC3`)
    if (m1 !== d1.motif) fail(`${label}: selectMotif ${m1} != desc.motif ${d1.motif} (the generator must use selectMotif) — F7 AC1`)
    SWEEP_MOTIFS.add(d1.motif)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6a) F7 STAGE MOTIFS — the shape space is exercised + selectMotif is total (F7 §7, D1/D2, AC1/AC3).
// STAGE_MOTIFS has ≥ 3 known ids, each backed by a MOTIF_PARAMS row; the sweep above exercised ≥ 2 distinct
// motifs (no dead / collapsed shape space — the reference's "shape space is used" check); and selectMotif is
// TOTAL — even a degenerate all-zero-weights roster returns a known id (never undefined), the float-rounding fallback.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  if (!(STAGE_MOTIFS.length >= 3)) fail(`motifs: STAGE_MOTIFS has ${STAGE_MOTIFS.length} ids, expected ≥ 3 (F7 AC1)`)
  for (const m of STAGE_MOTIFS) {
    if (!MOTIF_PARAMS[m]) fail(`motifs: STAGE_MOTIFS id '${m}' has no MOTIF_PARAMS row (F7 D1)`)
  }
  if (!(SWEEP_MOTIFS.size >= 2)) fail(`motifs: the sweep exercised only ${SWEEP_MOTIFS.size} distinct motif(s), expected ≥ 2 (dead/collapsed shape space — F7 AC1)`)
  // selectMotif totality (F7 AC3): a degenerate all-zero-weights roster falls through to a KNOWN id (never
  // undefined — the reference's float-rounding fallback). Also an empty override falls back to the default mix.
  {
    const zero = selectMotif(0xdecaf, { ...stageConfig(0), motifWeights: [{ id: 'open', w: 0 }, { id: 'fortress', w: 0 }] })
    if (!STAGE_MOTIFS.includes(zero)) fail(`motifs: selectMotif({all-zero weights}) returned unknown id '${zero}' (F7 AC3)`)
    const empty = selectMotif(0xdecaf, { ...stageConfig(0), motifWeights: [] })
    if (!STAGE_MOTIFS.includes(empty)) fail(`motifs: selectMotif({empty weights}) returned unknown id '${empty}' (F7 AC3)`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6b) Regression pin (AC5, D10) — ONE fixed (seed, stageIndex) → a COMPUTED reference description (the
// real function's output, never hand-invented; computed once + pinned as literals). A silent generator
// change fails loudly here. The pin asserts the FULL int grid (a row-major digit serialization) + every
// spawn/base coord + scatterCells + isBoss.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const PIN_SEED = 0x1234abcd
  const PIN_STAGE = 2
  // The COMPUTED reference (from a one-off run of the REAL generateStage — D10). RE-PINNED for the 17×17 / 1-tile
  // geometry re-scale: the bigger board (17×17) + the FOOTPRINT-aware window center move EVERY pinned field — the
  // PIN_TILES grid (now 17×17) + PIN_SCATTER (more eligible cells) + the base/spawn anchors + their window-center
  // coords all legitimately change. Recomputed from the real output (never hand-invented). PIN_MOTIF + PIN_ISBOSS
  // are unaffected by the geometry (the seed-chosen motif + the stage flag don't depend on the grid size here).
  const PIN_TILES =
    '01410014022300020|01041421001100010|00000003000510100|00003100000105010|00211011003112050|00101021010015030|00401010020001200|00301111010011300|00000110011010210|00210001004000020|01002021002301200|01303005031030200|00210403001000000|05033200004400010|00000000000000000|14021510124120000|15010021610104121'
  const PIN_SCATTER = 224
  const PIN_MOTIF = 'fortress' // F7 (D8) — the seed-chosen motif at the pinned (seed, stage), computed from the real output.
  const PIN_BASE = [8, 16, 496, 680]
  const PIN_ENEMY = [['enemyL', 0, 0, 176, 40], ['enemyC', 8, 0, 496, 40], ['enemyR', 16, 0, 816, 40]]
  const PIN_PLAYER = [['p1', 5, 16, 376, 680], ['p2', 10, 16, 576, 680]]
  const PIN_ISBOSS = false

  const d = generateStage(PIN_SEED, stageConfig(PIN_STAGE))
  const tileStr = d.tiles.map((row) => row.join('')).join('|')
  if (tileStr !== PIN_TILES) fail(`pin: tile grid drifted\n  got: ${tileStr}\n  exp: ${PIN_TILES}`)
  if (d.scatterCells !== PIN_SCATTER) fail(`pin: scatterCells = ${d.scatterCells}, expected ${PIN_SCATTER}`)
  if (d.motif !== PIN_MOTIF) fail(`pin: motif = ${d.motif}, expected ${PIN_MOTIF} (F7 D8)`)
  if (!deepEqual([d.base.col, d.base.row, d.base.x, d.base.y], PIN_BASE)) fail(`pin: base drifted`)
  if (!deepEqual(d.enemySpawns.map((s) => [s.which, s.col, s.row, s.x, s.y]), PIN_ENEMY)) fail(`pin: enemy spawns drifted`)
  if (!deepEqual(d.playerSpawns.map((s) => [s.which, s.col, s.row, s.x, s.y]), PIN_PLAYER)) fail(`pin: player spawns drifted`)
  if (d.isBoss !== PIN_ISBOSS) fail(`pin: isBoss = ${d.isBoss}, expected ${PIN_ISBOSS}`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 7) F4 — tank roster well-formedness + rosterPick/applyStarTier + RunState.advance() determinism
// (F4 §7, Decisions D1/D5/D6/D11, AC4/AC6/AC8). The roster + RunState are PURE (node-imported above →
// re-proving purity, AC11). The verifier proves DATA properties (well-formedness + monotonicity +
// determinism), NOT gameplay balance (the HONEST scope — D11).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const KNOWN_BEHAVIORS = new Set(['basic', 'fast', 'power', 'armor', 'player', 'boss', 'stealth']) // F6 (D1) — + boss; stealth-enemy (D1) — + the stealth tag.

  // ── 7a) Every TankSpec is well-formed (AC4) ── positive numbers, a known behaviour, sane caps. Swept over
  // the four enemy archetypes + the player base + every star tier's folded spec (applyStarTier(t)).
  const allSpecs = [...ENEMY_ARCHETYPES, PLAYER_BASE, ...PLAYER_STAR_TIERS.map((_, t) => applyStarTier(t))]
  for (const spec of allSpecs) {
    if (typeof spec.id !== 'string' || spec.id.length === 0) fail(`tanks: spec.id missing on ${JSON.stringify(spec)}`)
    if (!KNOWN_BEHAVIORS.has(spec.behavior)) fail(`tanks: spec ${spec.id} has unknown behavior ${spec.behavior}`)
    for (const f of ['maxHp', 'moveSpeed', 'bulletSpeed', 'fireCooldown', 'maxBullets']) {
      if (typeof spec[f] !== 'number' || !(spec[f] > 0)) fail(`tanks: spec ${spec.id}.${f} = ${spec[f]} is not a positive number`)
    }
    if (!Number.isInteger(spec.maxBullets)) fail(`tanks: spec ${spec.id}.maxBullets = ${spec.maxBullets} is not an integer`)
    if (typeof spec.scoreValue !== 'number' || spec.scoreValue < 0) fail(`tanks: spec ${spec.id}.scoreValue = ${spec.scoreValue} invalid`)
  }

  // ── 7b) The armor spec is the multi-hit tank (AC4) ── maxHp > 1 AND === ARMOR_TANK_HP (the constants owner,
  // changed 3→4 in F4 — the four-flash tank). A silent off-by-one (armor maxHp ≠ ARMOR_TANK_HP) fails loudly.
  if (!(ARMOR.maxHp > 1)) fail(`tanks: ARMOR.maxHp = ${ARMOR.maxHp} must be > 1 (the multi-hit tank)`)
  if (ARMOR.maxHp !== ARMOR_TANK_HP) fail(`tanks: ARMOR.maxHp = ${ARMOR.maxHp} != ARMOR_TANK_HP ${ARMOR_TANK_HP}`)
  if (ARMOR_TANK_HP !== 4) fail(`tanks: ARMOR_TANK_HP = ${ARMOR_TANK_HP}, expected 4 (the four-flash armor tank, F4)`)

  // ── 7c) EVERY enemy archetype DIFFERS on a tunable stat (AC4) ── pairwise distinct on at least one of
  // {moveSpeed, bulletSpeed, maxHp}. A regression that makes two types identical fails loudly (AC4 is a data
  // check, not eyeballing). FAST out-moves BASIC; POWER out-shoots BASIC; ARMOR out-HPs BASIC (the spec intent).
  // stealth-enemy (§5.5): the sweep is over the REAL `ENEMY_ARCHETYPES` (re-derived from the source, NOT a literal
  // [BASIC,FAST,POWER,ARMOR]), so the 5th type (STEALTH — distinct on moveSpeed) is checked + a future 6th needs no
  // edit here (DRY). The named-spec spot-checks below still pin the classic four's distinguishing axes by name.
  const types = ENEMY_ARCHETYPES
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = types[i]
      const b = types[j]
      const distinct = a.moveSpeed !== b.moveSpeed || a.bulletSpeed !== b.bulletSpeed || a.maxHp !== b.maxHp
      if (!distinct) fail(`tanks: ${a.id} and ${b.id} are identical on {moveSpeed,bulletSpeed,maxHp} (AC4)`)
    }
  }
  if (!(FAST.moveSpeed > BASIC.moveSpeed)) fail(`tanks: FAST should out-move BASIC (${FAST.moveSpeed} vs ${BASIC.moveSpeed})`)
  if (!(POWER.bulletSpeed > BASIC.bulletSpeed)) fail(`tanks: POWER should out-shoot BASIC (${POWER.bulletSpeed} vs ${BASIC.bulletSpeed})`)
  if (!(ARMOR.maxHp > BASIC.maxHp)) fail(`tanks: ARMOR should out-HP BASIC (${ARMOR.maxHp} vs ${BASIC.maxHp})`)

  // ── 7d) rosterPick returns ONLY a known enemy id + is deterministic for a fixed rng (AC4) ── drive it over a
  // representative spread of stage weights; the result must always be a key of ENEMY_SPECS. Determinism: two
  // fresh rngs from the same seed → the SAME pick sequence (the seeded picks the spawn loop relies on, D8).
  for (const stageIndex of [0, 4, 12, 30]) {
    const w = stageConfig(stageIndex).enemyWeights
    const a = mulberry32(0xfeed1234)
    const b = mulberry32(0xfeed1234)
    for (let k = 0; k < 200; k++) {
      const ida = rosterPick(a, w)
      const idb = rosterPick(b, w)
      if (!(ida in ENEMY_SPECS)) fail(`tanks: rosterPick returned unknown id ${ida} at stage ${stageIndex}`)
      if (ida !== idb) fail(`tanks: rosterPick non-deterministic for a fixed rng (${ida} !== ${idb}) at stage ${stageIndex}`)
    }
  }
  // A degenerate all-zero roster falls back to a known id (the total fold — never undefined).
  {
    const id = rosterPick(mulberry32(1), { basic: 0, fast: 0, power: 0, armor: 0, stealth: 0 }) // stealth-enemy: + the 5th weight.
    if (!(id in ENEMY_SPECS)) fail(`tanks: rosterPick({all 0}) returned unknown id ${id}`)
  }

  // ── 7e) applyStarTier is MONOTONE-non-decreasing in bulletSpeed/maxBullets across tiers (AC6) ── each tier's
  // folded spec must not LOWER the offensive stats vs. the previous tier. tier 0 must equal PLAYER_BASE (the
  // identity fold — so threading the spec is behaviour-preserving for the player).
  const tier0 = applyStarTier(0)
  if (tier0.bulletSpeed !== PLAYER_BASE.bulletSpeed || tier0.maxBullets !== PLAYER_BASE.maxBullets || tier0.fireCooldown !== PLAYER_BASE.fireCooldown)
    fail(`tanks: applyStarTier(0) != PLAYER_BASE (the identity fold)`)
  let prevTier = tier0
  for (let t = 1; t < PLAYER_STAR_TIERS.length; t++) {
    const cur = applyStarTier(t)
    if (cur.bulletSpeed < prevTier.bulletSpeed) fail(`tanks: applyStarTier bulletSpeed decreased at tier ${t}`)
    if (cur.maxBullets < prevTier.maxBullets) fail(`tanks: applyStarTier maxBullets decreased at tier ${t}`)
    if (cur.fireCooldown > prevTier.fireCooldown + 1e-12) fail(`tanks: applyStarTier fireCooldown increased at tier ${t} (should fire no slower)`)
    prevTier = cur
  }

  // ── 7g) F6 BOSS spec well-formed + heavier-than-armor + the CONCRETE heavier-fire profile + bossSpecForStage
  // monotone/never-weaker/fire-fields-unscaled + boss ABSENT from the roster (F6 §7, D1/D2/D3/D11, AC2/AC9) ──
  // The BOSS is a PURE TankSpec (node-imported above → re-proving purity). The verifier proves DATA properties:
  // well-formedness, the heavier-than-armor HP, the falsifiable heavier-fire data check (issue #2), and the fold's
  // monotone/never-weaker/unscaled-fire contract — NOT gameplay balance (the HONEST scope).
  {
    // Well-formedness (AC9): a valid TankSpec with the 'boss' behaviour, positive feel fields, an integer
    // maxBullets, scoreValue ≥ 0 (re-using the same shape the 7a sweep asserts for the other specs).
    if (BOSS.id !== 'boss') fail(`tanks: BOSS.id = ${BOSS.id}, expected 'boss'`)
    if (BOSS.behavior !== 'boss') fail(`tanks: BOSS.behavior = ${BOSS.behavior}, expected 'boss'`)
    for (const f of ['maxHp', 'moveSpeed', 'bulletSpeed', 'fireCooldown', 'maxBullets']) {
      if (typeof BOSS[f] !== 'number' || !(BOSS[f] > 0)) fail(`tanks: BOSS.${f} = ${BOSS[f]} is not a positive number`)
    }
    if (!Number.isInteger(BOSS.maxBullets)) fail(`tanks: BOSS.maxBullets = ${BOSS.maxBullets} is not an integer`)
    if (typeof BOSS.scoreValue !== 'number' || BOSS.scoreValue < 0) fail(`tanks: BOSS.scoreValue = ${BOSS.scoreValue} invalid`)
    // Heavier than the armor tank (AC2) — multi-hit "for free" via the F3 HP funnel; survives many hits.
    if (!(BOSS.maxHp >= ARMOR.maxHp)) fail(`tanks: BOSS.maxHp ${BOSS.maxHp} must be ≥ ARMOR.maxHp ${ARMOR.maxHp} (AC2)`)
    // The telegraph window is armed (AC2/AC9) — the dodge contract; a non-boss spec leaves it 0/undefined.
    if (!(BOSS.telegraphSec > 0)) fail(`tanks: BOSS.telegraphSec = ${BOSS.telegraphSec} must be > 0 (the dodge window, AC2)`)
    // The CONCRETE heavier-fire data check (issue #2) — a fast bolt AND a shorter beat than a basic tank. Both
    // are the RAW, pre-bulletSpeedScale spec numbers the verifier reads directly, so the comparison is well-defined.
    if (!(BOSS.bulletSpeed >= POWER.bulletSpeed)) fail(`tanks: BOSS.bulletSpeed ${BOSS.bulletSpeed} must be ≥ POWER.bulletSpeed ${POWER.bulletSpeed} (heavier fire, AC2/AC9)`)
    if (!(BOSS.fireCooldown <= BASIC.fireCooldown)) fail(`tanks: BOSS.fireCooldown ${BOSS.fireCooldown} must be ≤ BASIC.fireCooldown ${BASIC.fireCooldown} (heavier fire, AC2/AC9)`)
    // The capstone reward (D11) — the highest single scoreValue (above the armor tank's).
    if (!(BOSS.scoreValue > ARMOR.scoreValue)) fail(`tanks: BOSS.scoreValue ${BOSS.scoreValue} must be > ARMOR.scoreValue ${ARMOR.scoreValue} (the capstone, D11)`)

    // bossSpecForStage (AC9): deterministic + returns a NEW object (no aliasing) + monotone non-decreasing in maxHp
    // across boss stages + never weaker than BOSS at the base + leaves telegraphSec/bulletSpeed/fireCooldown UNSCALED
    // (equal to BOSS's — readability + the heavier-fire profile preserved at depth). Sweep the boss-stage indices
    // (BOSS_STAGE_EVERY·n − 1: 4, 9, 14, …) for several milestones.
    const bossStages = []
    for (let n = 1; n <= 10; n++) bossStages.push(BOSS_STAGE_EVERY * n - 1)
    let prevBossHp = -Infinity
    for (const s of bossStages) {
      const a = bossSpecForStage(s)
      const b = bossSpecForStage(s)
      if (!deepEqual(a, b)) fail(`tanks: bossSpecForStage(${s}) is non-deterministic (two calls differ, AC9)`)
      if (a === BOSS) fail(`tanks: bossSpecForStage(${s}) ALIASES the base BOSS (must return a NEW object, AC9)`)
      if (a.behavior !== 'boss') fail(`tanks: bossSpecForStage(${s}).behavior = ${a.behavior}, expected 'boss'`)
      if (!(a.maxHp >= BOSS.maxHp)) fail(`tanks: bossSpecForStage(${s}).maxHp ${a.maxHp} weaker than BOSS.maxHp ${BOSS.maxHp} (AC9)`)
      if (a.maxHp < prevBossHp) fail(`tanks: bossSpecForStage maxHp decreased at stage ${s} (${prevBossHp} → ${a.maxHp}) — not monotone (AC9)`)
      // The fire fields + the telegraph are UNSCALED (equal to BOSS's — the heavier-fire + dodge contract at depth).
      if (a.telegraphSec !== BOSS.telegraphSec) fail(`tanks: bossSpecForStage(${s}).telegraphSec ${a.telegraphSec} != BOSS ${BOSS.telegraphSec} (must be UNSCALED, AC9)`)
      if (a.bulletSpeed !== BOSS.bulletSpeed) fail(`tanks: bossSpecForStage(${s}).bulletSpeed ${a.bulletSpeed} != BOSS ${BOSS.bulletSpeed} (must be UNSCALED, AC9)`)
      if (a.fireCooldown !== BOSS.fireCooldown) fail(`tanks: bossSpecForStage(${s}).fireCooldown ${a.fireCooldown} != BOSS ${BOSS.fireCooldown} (must be UNSCALED, AC9)`)
      prevBossHp = a.maxHp
    }

    // The boss is ABSENT from ENEMY_ARCHETYPES/ENEMY_SPECS (D3) — it is spawned EXPLICITLY by the scene as the
    // stage capstone, never weighted into rosterPick. So rosterPick still ONLY ever returns the four normal ids
    // (the F4 7c/7d distinctness + known-id checks stay green — the boss never enters the roster).
    if (ENEMY_SPECS.boss) fail(`tanks: the BOSS must NOT be in ENEMY_SPECS (it is spawned explicitly, not weighted — D3)`)
    for (const spec of ENEMY_ARCHETYPES) {
      if (spec.behavior === 'boss' || spec.id === 'boss') fail(`tanks: the BOSS must NOT be in ENEMY_ARCHETYPES (D3)`)
    }
    // stealth-enemy (§5.5): the count pin is RE-DERIVED — the ordered roster + the id→spec lookup must AGREE
    // (`ENEMY_ARCHETYPES.length === Object.keys(ENEMY_SPECS).length`), NOT a magic `4`. This keeps the "boss absent
    // from the roster" intent (the boss is in neither) while a 5th (stealth) or future Nth type needs no edit here.
    if (ENEMY_ARCHETYPES.length !== Object.keys(ENEMY_SPECS).length) fail(`tanks: ENEMY_ARCHETYPES (${ENEMY_ARCHETYPES.length}) and ENEMY_SPECS (${Object.keys(ENEMY_SPECS).length}) disagree (the roster + the lookup must match; the boss is in neither — D3)`)
  }

  // ── 7h) F6 balance-scalar guards (F6 §7, D10/issue #3, AC8) ── the constants.ts SCALARS the existing sweeps do
  // NOT read get explicit guards so the balance retune is HONESTLY gated, not green-by-handwave. CURRENCY_RATIO
  // MUST stay in (0,1) (the meta economy: ≥1 banks the whole/over score, ≤0 banks nothing — both break it).
  // FIRE_COOLDOWN > 0 keeps the player base spec well-formed (PLAYER_BASE.fireCooldown = FIRE_COOLDOWN, so 7a
  // proves it transitively; this is the belt-and-braces direct guard). TANK_SPEED/BULLET_SPEED/SPAWN_STAGGER_BASE
  // are covered TRANSITIVELY via their derived specs' positivity/distinctness (documented OUT-OF-GATE as standalone
  // scalars — §7 AC8), so no dedicated assertion is added for them (they have no standalone invariant beyond positive).
  if (!(CURRENCY_RATIO > 0 && CURRENCY_RATIO < 1)) fail(`constants: CURRENCY_RATIO = ${CURRENCY_RATIO} must be in (0,1) (the meta economy, AC8)`)
  if (!(FIRE_COOLDOWN > 0)) fail(`constants: FIRE_COOLDOWN = ${FIRE_COOLDOWN} must be > 0 (the player base spec, AC8)`)

  // ── 7f) RunState.advance() is deterministic + stageIndex strictly increases (AC8); the per-slot seed map +
  // the timed power-up decay/reset (F5 D5b/D5c/AC3/AC6) ── RE-PINNED to the F5 createRunState signature: the F4
  // scalar `startLives` is replaced by a PER-SLOT { [slot]: {lives, tier} } seed map (D5b — so each player's
  // INDEPENDENT Hub +startLife/+starStart fold lands at run start). The same fresh-state invariants are asserted
  // against the new shape; a new seeded case proves the per-slot lives/tier fold reaches run start (AC6). This is
  // the ONE F4 verifier block F5 edits (D5c — the rest of the F0–F4 sweep is byte-unchanged).
  {
    const RS_SEED = 0xc0ffee
    // The fresh-state map: both present, lives 3, tier 0 (the F4 fresh-meta behaviour, expressed per-slot).
    const FRESH = { 1: { lives: 3, tier: 0 }, 2: { lives: 3, tier: 0 } }
    const a = createRunState(RS_SEED, { 1: { lives: 3, tier: 0 }, 2: { lives: 3, tier: 0 } })
    const b = createRunState(RS_SEED, { 1: { lives: 3, tier: 0 }, 2: { lives: 3, tier: 0 } })
    // Initial state sanity (AC8): stageIndex 0, the ledger seeded from stage 0, lives seeded per slot, score 0.
    const cfg0 = stageConfig(0)
    if (a.stageIndex !== 0) fail(`RunState: fresh stageIndex = ${a.stageIndex}, expected 0`)
    if (a.score !== 0) fail(`RunState: fresh score = ${a.score}, expected 0`)
    // (extra-life, D2, AC2) — the carried 1UP threshold is SEEDED to EXTRA_LIFE_SCORE on a fresh run.
    if (a.nextExtraLifeScore !== EXTRA_LIFE_SCORE)
      fail(`RunState: fresh nextExtraLifeScore = ${a.nextExtraLifeScore}, expected ${EXTRA_LIFE_SCORE} (extra-life AC2)`)
    if (a.enemiesQueued !== cfg0.totalEnemies || a.enemiesRemaining !== cfg0.totalEnemies || a.enemiesAlive !== 0)
      fail(`RunState: fresh spawn ledger not seeded from stageConfig(0)`)
    // ── F-difficulty-select deep start (difficulty-select §5.6, D5, AC4) ── the OPTIONAL startStage arg seeds the
    // run-global stageIndex + its ledger from stageConfig(startStage), NOT stage 0. The no-arg form above still
    // seeds stageIndex === 0 (asserted just above — every existing call site is byte-unchanged). A non-zero start
    // begins the run deep (a "skip to stage N" practice run); advance() then keeps climbing from there.
    {
      const deep = createRunState(RS_SEED, { 1: { lives: 3, tier: 0 } }, 7)
      const cfg7 = stageConfig(7)
      if (deep.stageIndex !== 7) fail(`RunState: createRunState(..., 7) stageIndex = ${deep.stageIndex}, expected 7 (AC4)`)
      if (deep.enemiesQueued !== cfg7.totalEnemies || deep.enemiesRemaining !== cfg7.totalEnemies || deep.enemiesAlive !== 0)
        fail(`RunState: createRunState(..., 7) spawn ledger not seeded from stageConfig(7) (AC4)`)
    }
    for (const slot of Object.keys(FRESH)) {
      const s = Number(slot)
      if (a.lives[s] !== 3) fail(`RunState: fresh lives[${s}] = ${a.lives[s]}, expected 3`)
      if (a.tier[s] !== 0) fail(`RunState: fresh tier[${s}] = ${a.tier[s]}, expected 0`)
      if (a.shieldTimer[s] !== 0) fail(`RunState: fresh shieldTimer[${s}] = ${a.shieldTimer[s]}, expected 0 (the identity)`)
    }
    if (a.freezeTimer !== 0 || a.shovelTimer !== 0) fail(`RunState: fresh power-up timers not 0 (the neutral identity)`)
    // (stage-bonus, D1, AC1) — the per-stage kills-by-type ledger seeds every roster id (basic/fast/power/armor/
    // boss) to 0 on a fresh run (a fresh stage starts at 0 kills — the tally counts only the stage just cleared).
    for (const id of ['basic', 'fast', 'power', 'armor', 'boss']) {
      if (a.killsByStage[id] !== 0) fail(`RunState: fresh killsByStage['${id}'] = ${a.killsByStage[id]}, expected 0 (stage-bonus AC1)`)
    }
    // Mutate a's carried state, then drive advance() — the carried score/lives/tier must SURVIVE advance (D10).
    a.score = 4200
    a.lives[1] = 1
    const RS_K = 25
    for (let i = 0; i < RS_K; i++) {
      const prevStage = a.stageIndex
      a.advance()
      b.advance()
      if (a.seed !== b.seed) fail(`RunState: advance() seed diverged at step ${i} (${a.seed} !== ${b.seed})`)
      if (a.stageIndex !== b.stageIndex) fail(`RunState: advance() stageIndex diverged at step ${i}`)
      if (a.stageIndex !== prevStage + 1) fail(`RunState: stageIndex not strictly +1 at step ${i} (${prevStage} → ${a.stageIndex})`)
      // The ledger is reseeded from the NEW stage; the carried economy is untouched (D10).
      const cfg = stageConfig(a.stageIndex)
      if (a.enemiesQueued !== cfg.totalEnemies || a.enemiesAlive !== 0) fail(`RunState: ledger not reseeded at step ${i}`)
      if (a.score !== 4200) fail(`RunState: score NOT carried across advance() (got ${a.score}) — D10`)
      if (a.lives[1] !== 1) fail(`RunState: lives NOT carried across advance() — D10`)
      // (extra-life, D2, AC2) — the 1UP threshold is CARRIED untouched across advance() (like score — it survives a
      // stage advance so the milestone fires once per crossing across the whole run).
      if (a.nextExtraLifeScore !== EXTRA_LIFE_SCORE)
        fail(`RunState: nextExtraLifeScore NOT carried across advance() (got ${a.nextExtraLifeScore}) — extra-life AC2`)
    }

    // ── extraLivesCrossed(prevThreshold, score, step) is a PURE, tested helper (extra-life D1/D3, AC3) ── drive a
    // case table over the ONE implementation GameScene calls: no crossing → lives 0, threshold unchanged; an exact
    // hit → lives 1, threshold +step; a SINGLE big jump crossing TWO thresholds at once (the boss/grenade edge) →
    // lives 2; and EVERY return's nextThreshold is strictly > score (the loop terminator invariant).
    {
      const S = EXTRA_LIFE_SCORE
      const below = extraLivesCrossed(S, S - 1, S) // just under the first milestone — no crossing.
      if (below.lives !== 0) fail(`extraLivesCrossed: (S, S-1, S) lives = ${below.lives}, expected 0 (no crossing)`)
      if (below.nextThreshold !== S) fail(`extraLivesCrossed: no-cross must leave nextThreshold = ${S} (got ${below.nextThreshold})`)
      const one = extraLivesCrossed(S, S, S) // exactly at the first milestone — one 1UP.
      if (one.lives !== 1) fail(`extraLivesCrossed: (S, S, S) lives = ${one.lives}, expected 1`)
      if (one.nextThreshold !== 2 * S) fail(`extraLivesCrossed: (S, S, S) nextThreshold = ${one.nextThreshold}, expected ${2 * S}`)
      const two = extraLivesCrossed(S, 2 * S + 1, S) // a single jump past TWO milestones (the boss/grenade edge — D3).
      if (two.lives !== 2) fail(`extraLivesCrossed: (S, 2S+1, S) lives = ${two.lives}, expected 2 (two-at-once)`)
      if (two.nextThreshold !== 3 * S) fail(`extraLivesCrossed: (S, 2S+1, S) nextThreshold = ${two.nextThreshold}, expected ${3 * S}`)
      // Every return's nextThreshold is strictly > score (the loop self-terminates since step > 0 — AC3).
      for (const [prev, score] of [[S, S - 1], [S, S], [S, 2 * S + 1], [S, 5 * S]]) {
        const r = extraLivesCrossed(prev, score, S)
        if (!(r.nextThreshold > score)) fail(`extraLivesCrossed: nextThreshold (${r.nextThreshold}) not > score (${score}) — AC3`)
      }
    }

    // ── The per-slot lives/tier fold reaches run start (F5 D5b, AC6) ── a seeded { lives:5, tier:2 } map yields
    // lives[1]===5 / tier[1]===2 (the Hub +startLife / +starStart upgrades land), and a SOLO seed map seeds ONLY
    // the present slot (no phantom P2 — D11 present-scoping is the map's key set).
    {
      const solo = createRunState(0x5eed, { 1: { lives: 5, tier: 2 } })
      if (solo.lives[1] !== 5) fail(`RunState: per-slot lives fold — lives[1] = ${solo.lives[1]}, expected 5 (AC6)`)
      if (solo.tier[1] !== 2) fail(`RunState: per-slot tier fold — tier[1] = ${solo.tier[1]}, expected 2 (AC6)`)
      if (2 in solo.lives) fail(`RunState: a SOLO seed map seeded a phantom P2 (lives[2] present) — D11`)
      if (solo.shieldTimer[1] !== 0) fail(`RunState: per-slot fresh shieldTimer[1] != 0`)
    }

    // ── tickTimers(dt) decays the timed power-ups toward 0, clamped (F5 D5/AC3) ── set the three timers, drive
    // tickTimers PAST their values, and assert each lands at EXACTLY 0 (never negative). The carried economy is
    // UNTOUCHED by tickTimers (the F4 D10 invariant). Then advance() RESETS the timed power-ups (a clock/shovel/
    // shield does NOT bleed into the next stage — AC3).
    {
      const r = createRunState(0xa11, { 1: { lives: 3, tier: 0 } })
      r.freezeTimer = CLOCK_FREEZE_SEC
      r.shovelTimer = SHOVEL_FORTIFY_SEC
      r.shieldTimer[1] = HELMET_SHIELD_SEC
      r.score = 999
      // A partial step decays each by dt, never below 0; a step PAST the value lands at exactly 0.
      r.tickTimers(0.5)
      if (!(r.freezeTimer >= 0 && r.freezeTimer <= CLOCK_FREEZE_SEC)) fail(`RunState: tickTimers freezeTimer out of range`)
      r.tickTimers(1000) // drive every timer well past its value.
      if (r.freezeTimer !== 0) fail(`RunState: tickTimers freezeTimer = ${r.freezeTimer}, expected exactly 0 (clamped)`)
      if (r.shovelTimer !== 0) fail(`RunState: tickTimers shovelTimer = ${r.shovelTimer}, expected exactly 0 (clamped)`)
      if (r.shieldTimer[1] !== 0) fail(`RunState: tickTimers shieldTimer[1] = ${r.shieldTimer[1]}, expected exactly 0 (clamped)`)
      if (r.score !== 999) fail(`RunState: tickTimers must NOT touch the carried score (D10)`)
      // advance() RESETS the timed power-ups (AC3): set them again, advance, assert 0.
      r.freezeTimer = CLOCK_FREEZE_SEC
      r.shovelTimer = SHOVEL_FORTIFY_SEC
      r.shieldTimer[1] = HELMET_SHIELD_SEC
      r.advance()
      if (r.freezeTimer !== 0 || r.shovelTimer !== 0) fail(`RunState: advance() did NOT reset freeze/shovel timers (AC3)`)
      if (r.shieldTimer[1] !== 0) fail(`RunState: advance() did NOT reset shieldTimer (AC3)`)
    }

    // ── tallyKill(id) increments the per-stage kills-by-type ledger + advance() resets it (stage-bonus D1, AC1) ──
    // tallyKill('basic') etc. bump the matching count; an id OUTSIDE the roster no-ops (no stray key, defensive).
    // advance() then RESETS every count to 0 (a fresh stage starts at 0 kills — the SAME lifecycle as the spawn
    // ledger). The carried economy (score/lives) is UNTOUCHED by either (the D10 invariant holds for the new field).
    {
      const r = createRunState(0xba5, { 1: { lives: 3, tier: 0 } })
      r.score = 555
      r.tallyKill('basic')
      r.tallyKill('basic')
      r.tallyKill('armor')
      r.tallyKill('boss')
      r.tallyKill('__nope__') // an unknown id must NO-OP (no stray key, no throw).
      if (r.killsByStage.basic !== 2) fail(`RunState: tallyKill('basic')×2 → killsByStage.basic = ${r.killsByStage.basic}, expected 2 (AC1)`)
      if (r.killsByStage.armor !== 1) fail(`RunState: tallyKill('armor') → killsByStage.armor = ${r.killsByStage.armor}, expected 1 (AC1)`)
      if (r.killsByStage.boss !== 1) fail(`RunState: tallyKill('boss') → killsByStage.boss = ${r.killsByStage.boss}, expected 1 (AC1)`)
      if (r.killsByStage.fast !== 0 || r.killsByStage.power !== 0) fail(`RunState: tallyKill bumped an untouched type (AC1)`)
      if ('__nope__' in r.killsByStage) fail(`RunState: tallyKill('__nope__') created a stray key (must no-op an unknown id, AC1)`)
      if (r.score !== 555) fail(`RunState: tallyKill must NOT touch the carried score (D10)`)
      // advance() resets every count to 0 (the fresh stage starts at 0 kills — stage-bonus AC1).
      r.advance()
      for (const id of ['basic', 'fast', 'power', 'armor', 'boss']) {
        if (r.killsByStage[id] !== 0) fail(`RunState: advance() did NOT reset killsByStage['${id}'] (= ${r.killsByStage[id]}, expected 0) — stage-bonus AC1`)
      }
      if (r.score !== 555) fail(`RunState: advance() must carry the score across (D10) — got ${r.score}`)
    }

    // isBossStage() tracks stageConfig.isBoss (the boss-feature seam). Drive a fresh run to a boss stage.
    const c = createRunState(1, { 1: { lives: 3, tier: 0 } })
    while (c.stageIndex < BOSS_STAGE_EVERY - 1) c.advance()
    if (!c.isBossStage()) fail(`RunState: isBossStage() false at the first boss stage (index ${c.stageIndex})`)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 8) F5 — power-up roster + permanent upgrade rows + applyUpgrades + the i18n dictionary structure
// (F5 §7, Decisions D1/D3/D6/D7/D12, AC1/AC2/AC6/AC9/AC11). All PURE (node-imported above → re-proving
// purity, AC11). The verifier proves DATA properties (well-formedness + cost-monotone + the never-weaker
// fold + pick determinism + the i18n structure), NOT gameplay balance (the HONEST scope — D11).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── 8a) Power-up roster well-formed (AC1/AC2 + boat-drill) ── all EIGHT kinds present; every PowerUpDef has a
  // numeric colour + a duration ≥ 0; the FIVE timed kinds (helmet/clock/shovel/boat/drill) carry a duration > 0;
  // the THREE instant kinds (star/grenade/tank) carry 0; the lookup is total.
  const EXPECTED_KINDS = ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank', 'boat', 'drill']
  for (const kind of EXPECTED_KINDS) {
    if (!POWERUP_KINDS.includes(kind)) fail(`powerups: kind '${kind}' missing from POWERUP_KINDS`)
    const def = POWERUP_BY_ID[kind]
    if (!def) fail(`powerups: POWERUP_BY_ID missing '${kind}'`)
    if (def.kind !== kind || def.id !== kind) fail(`powerups: def '${kind}' id/kind mismatch`)
    if (typeof def.color !== 'number') fail(`powerups: def '${kind}'.color is not a number`)
    if (typeof def.durationSec !== 'number' || def.durationSec < 0) fail(`powerups: def '${kind}'.durationSec = ${def.durationSec} invalid`)
  }
  if (POWERUPS.length !== EXPECTED_KINDS.length) fail(`powerups: POWERUPS has ${POWERUPS.length} defs, expected ${EXPECTED_KINDS.length}`)
  for (const timed of ['helmet', 'clock', 'shovel', 'boat', 'drill']) {
    if (!(POWERUP_BY_ID[timed].durationSec > 0)) fail(`powerups: timed kind '${timed}' must have durationSec > 0`)
  }
  for (const instant of ['star', 'grenade', 'tank']) {
    if (POWERUP_BY_ID[instant].durationSec !== 0) fail(`powerups: instant kind '${instant}' must have durationSec 0`)
  }
  // The timed defs' durations must equal the run-effect tunables the scene reads (DRY — one truth).
  if (POWERUP_BY_ID.helmet.durationSec !== HELMET_SHIELD_SEC) fail(`powerups: helmet duration != HELMET_SHIELD_SEC`)
  if (POWERUP_BY_ID.clock.durationSec !== CLOCK_FREEZE_SEC) fail(`powerups: clock duration != CLOCK_FREEZE_SEC`)
  if (POWERUP_BY_ID.shovel.durationSec !== SHOVEL_FORTIFY_SEC) fail(`powerups: shovel duration != SHOVEL_FORTIFY_SEC`)
  if (POWERUP_BY_ID.boat.durationSec !== BOAT_SAIL_SEC) fail(`powerups: boat duration != BOAT_SAIL_SEC`)
  if (POWERUP_BY_ID.drill.durationSec !== DRILL_PIERCE_SEC) fail(`powerups: drill duration != DRILL_PIERCE_SEC`)

  // ── 8b) pickPowerUpKind is total + deterministic (AC1) ── over a long draw it ONLY ever returns a known kind;
  // two fresh rngs from the SAME seed → the SAME kind sequence (the seeded drop the carrier death relies on, D3).
  {
    const a = mulberry32(0xbeef)
    const b = mulberry32(0xbeef)
    for (let i = 0; i < 500; i++) {
      const ka = pickPowerUpKind(a)
      const kb = pickPowerUpKind(b)
      if (!POWERUP_KINDS.includes(ka)) fail(`powerups: pickPowerUpKind returned unknown kind '${ka}'`)
      if (ka !== kb) fail(`powerups: pickPowerUpKind non-deterministic for a fixed rng ('${ka}' !== '${kb}')`)
    }
  }

  // ── 8c) Permanent upgrade rows well-formed + cost-monotone (AC6) ── each row has a string id/name/desc, a
  // maxLevel ≥ 1, costs.length === maxLevel, and the costs are MONOTONE non-decreasing (deeper levels cost ≥
  // shallower). The id lookup is total. Mirrors the reference's upgrades.ts row contract.
  for (const row of TANK_UPGRADES) {
    if (typeof row.id !== 'string' || row.id.length === 0) fail(`upgrades: a row has no id`)
    if (typeof row.name !== 'string' || typeof row.desc !== 'string') fail(`upgrades: row '${row.id}' name/desc not a string`)
    if (!Number.isInteger(row.maxLevel) || row.maxLevel < 1) fail(`upgrades: row '${row.id}'.maxLevel = ${row.maxLevel} invalid`)
    if (!Array.isArray(row.costs) || row.costs.length !== row.maxLevel) fail(`upgrades: row '${row.id}'.costs.length != maxLevel`)
    for (let i = 0; i < row.costs.length; i++) {
      if (typeof row.costs[i] !== 'number' || row.costs[i] < 0) fail(`upgrades: row '${row.id}'.costs[${i}] invalid`)
      if (i > 0 && row.costs[i] < row.costs[i - 1]) fail(`upgrades: row '${row.id}'.costs not monotone non-decreasing at ${i}`)
    }
    if (TANK_UPGRADES_BY_ID[row.id] !== row) fail(`upgrades: row '${row.id}' missing from TANK_UPGRADES_BY_ID`)
  }

  // ── 8d) applyUpgrades — identity fold + the never-weaker contract (AC6) ── applyUpgrades(PLAYER_BASE, {})
  // deep-equals a CLONE of PLAYER_BASE (a fresh meta is byte-unchanged) and returns a NEW object (no aliasing).
  // For each row + each owned level, apply returns a NEW spec that NEVER WEAKENS the player on the field it
  // touches (the magnitude is ≥ the base / the bonus field is ≥ 0). Unknown ids + over-maxLevel levels degrade.
  {
    const identity = applyUpgrades(PLAYER_BASE, {})
    if (!deepEqual(identity, PLAYER_BASE)) fail(`upgrades: applyUpgrades(base, {}) != a clone of base (the identity fold)`)
    if (identity === PLAYER_BASE) fail(`upgrades: applyUpgrades(base, {}) must return a NEW object (no aliasing)`)
    // Per-row never-weaker: compare the touched magnitude field to the base.
    const FIELD = { maxBullets: 'maxBullets', bulletSpeed: 'bulletSpeed', tankSpeed: 'moveSpeed', baseArmor: 'maxHp' }
    for (const row of TANK_UPGRADES) {
      for (let lvl = 1; lvl <= row.maxLevel; lvl++) {
        const out = applyUpgrades(PLAYER_BASE, { [row.id]: lvl })
        if (out === PLAYER_BASE) fail(`upgrades: applyUpgrades('${row.id}') aliased the base`)
        const f = FIELD[row.id]
        if (f) {
          if (!(out[f] >= PLAYER_BASE[f])) fail(`upgrades: row '${row.id}' level ${lvl} WEAKENED ${f} (${out[f]} < ${PLAYER_BASE[f]})`)
        } else if (row.id === 'startLife') {
          if (!((out.startLivesBonus ?? 0) >= 0)) fail(`upgrades: row 'startLife' produced a negative startLivesBonus`)
          if (!(out.startLivesBonus >= lvl)) fail(`upgrades: row 'startLife' level ${lvl} did not raise startLivesBonus`)
        } else if (row.id === 'starStart') {
          if (!((out.startTier ?? 0) >= 0)) fail(`upgrades: row 'starStart' produced a negative startTier`)
          if (out.startTier !== lvl) fail(`upgrades: row 'starStart' level ${lvl} startTier = ${out.startTier}, expected ${lvl}`)
        }
      }
    }
    // Graceful degradation: an unknown id is skipped + an over-maxLevel stored level is clamped (no throw, no weaken).
    const degraded = applyUpgrades(PLAYER_BASE, { __nope__: 9, maxBullets: 999 })
    if (degraded.maxBullets < PLAYER_BASE.maxBullets) fail(`upgrades: a clamped/over-large level weakened the player`)
    if (degraded.maxBullets !== PLAYER_BASE.maxBullets + TANK_UPGRADES_BY_ID.maxBullets.maxLevel)
      fail(`upgrades: an over-maxLevel maxBullets did not clamp to maxLevel`)
  }

  // ── 8e) i18n dictionary structure (AC9) — re-scoped to what's headlessly PROVABLE (the scenes are NEVER
  // imported, and there is no shared scene-key registry, so "every key the scenes use exists" is unprovable;
  // this block proves the dictionary STRUCTURE instead). EN.ui is non-empty; ZH_CN.ui ⊆ EN.ui (no orphan zh
  // chrome key without an en fallback source); every `upgrade` content Entry in BOTH locales is well-formed
  // (name/desc, when present, are strings) and every id ZH_CN.upgrade overrides exists in TANK_UPGRADES_BY_ID
  // (no orphan content override); the fallback chain is correct (a missing zh key returns en, never blank; an
  // absent key returns itself verbatim; an un-overridden content id returns the passed-in en string).
  {
    if (!EN.ui || Object.keys(EN.ui).length === 0) fail(`i18n: EN.ui is empty`)
    for (const k of Object.keys(ZH_CN.ui)) {
      if (!(k in EN.ui)) fail(`i18n: ZH_CN.ui key '${k}' has no EN.ui fallback source (orphan chrome key)`)
    }
    // Content `upgrade` entries well-formed + keyed to real rows, in BOTH locales.
    for (const loc of [EN, ZH_CN]) {
      const up = loc.upgrade || {}
      for (const id of Object.keys(up)) {
        if (!(id in TANK_UPGRADES_BY_ID)) fail(`i18n: an 'upgrade' override id '${id}' is not a real TANK_UPGRADES row`)
        const e = up[id]
        if (e.name !== undefined && typeof e.name !== 'string') fail(`i18n: upgrade '${id}'.name is not a string`)
        if (e.desc !== undefined && typeof e.desc !== 'string') fail(`i18n: upgrade '${id}'.desc is not a string`)
      }
    }
    // The fallback chain with the live locale forced to zh-CN.
    setLocale('zh-CN')
    // Pick an EN-only chrome key (one present in EN.ui but ABSENT from ZH_CN.ui), if any, → t() returns the EN string.
    const enOnly = Object.keys(EN.ui).find((k) => !(k in ZH_CN.ui))
    if (enOnly && t(enOnly) !== EN.ui[enOnly]) fail(`i18n: t('${enOnly}') did not fall back to the EN string under zh-CN`)
    // A present zh key returns the zh string; a present-in-both key returns the zh override.
    const both = Object.keys(ZH_CN.ui)[0]
    if (both && t(both) !== ZH_CN.ui[both]) fail(`i18n: t('${both}') did not return the zh-CN override`)
    // An ABSENT key returns the key verbatim (never blank/undefined).
    if (t('__totally_absent_key__') !== '__totally_absent_key__') fail(`i18n: t(absent) did not return the key verbatim`)
    // A content id with NO zh override returns the passed-in EN string (never blank).
    const noOverrideId = Object.keys(TANK_UPGRADES_BY_ID).find((id) => !((ZH_CN.upgrade || {})[id]))
    if (noOverrideId) {
      if (tName('upgrade', noOverrideId, 'EN_NAME') !== 'EN_NAME') fail(`i18n: tName(no-override) did not return the en string`)
      if (tDesc('upgrade', noOverrideId, 'EN_DESC') !== 'EN_DESC') fail(`i18n: tDesc(no-override) did not return the en string`)
    }
    setLocale('en') // restore (defensive — the verifier exits after, but keep the module state clean).
  }
}

console.log(
  `verify-gen OK: rng deterministic + pinned; constants ${GRID_COLS}x${GRID_ROWS} (pure node-import); ` +
    `save clone-no-alias; tiles TILE_PROPS total + helpers read the table; ` +
    `stages monotonic over stageConfig(0..${STAGE_K}) (densities+counts+hardShare+boss cadence + F4 bulletSpeed/spawnInterval ramps, D16/F4-AC6); ` +
    `F-difficulty per-level ramps bounded+monotone + no-arg===normal-identity + difficultyPressure ordered/unknown→1 + deep-start seeds stageIndex/ledger (difficulty-select AC1/AC2/AC3/AC4); ` +
    `stage sweep ${SWEEP_SEEDS} seeds × ${SWEEP_STAGES.length} stages — determinism + bounds (≤scatterCells, D14) + ` +
    `eagle enclosed&reachable (footprint BFS, D15) + spawn validity & window-center pin (D13); ` +
    `F7 motifs known/deterministic + selectMotif total + shape-space-used (${SWEEP_MOTIFS.size} distinct) (F7 AC1/AC2/AC3); ` +
    `regression pin (D10, F7-repinned +motif); ` +
    `F4 roster well-formed + ${ENEMY_ARCHETYPES.length} types distinct (incl. stealth-enemy) + rosterPick known/deterministic + applyStarTier monotone + ` +
    `F6 BOSS well-formed (heavier-than-armor HP + telegraph>0 + heavier-fire bulletSpeed≥POWER/fireCooldown≤BASIC) + ` +
    `bossSpecForStage monotone/never-weaker/fire-unscaled + boss absent from roster (D3) + balance guards ` +
    `(0<CURRENCY_RATIO<1, FIRE_COOLDOWN>0) (F6 AC2/AC8/AC9); ` +
    `RunState.advance() deterministic & stageIndex strictly increasing & economy carried + per-slot seed fold + ` +
    `tickTimers decay/clamp + advance-reset (F5 D5b/D5c/AC3/AC6) + killsByStage seeds-0/tallyKill-increments/advance-resets (stage-bonus AC1); ` +
    `F5 power-ups well-formed (8 kinds incl. boat+drill, durations, pickPowerUpKind deterministic) + upgrade rows cost-monotone + ` +
    `applyUpgrades identity/never-weaker/graceful + i18n structure (ZH⊆EN, content keyed to real rows, fallback chain) ` +
    `(pure node-import, AC1/AC2/AC6/AC9/AC11). (FOOTPRINT=${FOOTPRINT} tiles.)`,
)
process.exit(0)

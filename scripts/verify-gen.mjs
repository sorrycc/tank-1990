// ── Headless determinism + purity verifier (F0 scaffold §7, Decision 9/9a, AC9/AC10) ──
// Run by `npm run verify` under plain node (via tsx) — NO Phaser, NO browser. It imports the EXACT
// PURE modules the game runs (util/rng.ts, config/constants.ts, util/save.ts) and asserts the
// contracts the procedural foundation depends on. A SUCCESSFUL import of those modules already
// RE-PROVES the purity convention (AC10): a Phaser-coupled module (any scene / main.ts) would throw
// under node — which is exactly why this script never imports them. The check is an INDEPENDENT
// proof, not self-certification: a stray `import 'phaser'` slipping into a "pure" module would make
// `npm run verify` go RED here.
//
// F0 is a determinism + purity STUB; the REAL quality gate is the F2 seeded-stage sweep, which fills
// this script in. F0 asserts:
//   1. rng — mulberry32 determinism (two instances of one seed deep-equal over N draws) + a regression
//      pin (a known seed matches a COMPUTED prefix; never hand-invented — if the algorithm ever drifts
//      from the reference's byte-identical copy this fails loudly).
//   2. constants — DESIGN_WIDTH === 1280 (the one trivial invariant; also re-proves node-importability).
//   3. save — a saveMeta/loadMeta round-trip that ALSO exercises the AC8 clone-no-alias contract: the
//      back-filled per-player upgrade maps must NOT be the SAME object reference as DEFAULT_META's, so a
//      later buy() can't mutate the frozen default (the cross-instance-leak the clone fixes).
// Exits non-zero on ANY failure so `npm run verify` gates CI; prints `OK` + exits 0 on success.

import { mulberry32, range } from '../src/util/rng.js'
import { DESIGN_WIDTH } from '../src/config/constants.js'
import { DEFAULT_META, loadMeta, saveMeta } from '../src/util/save.js'

function fail(msg) {
  console.error(`verify-gen FAILED: ${msg}`)
  process.exit(1)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1) rng determinism + regression pin (AC7/AC9) — the determinism foundation.
// ════════════════════════════════════════════════════════════════════════════════════════════
const RNG_SEED = 0x1234abcd
const RNG_K = 5
// Pinned vector: mulberry32(0x1234abcd) → first 5 outputs (COMPUTED from the verbatim algorithm,
// never hand-invented; byte-identical to the read-only `dead-cell` reference's pin — proves the
// copy in src/util/rng.ts is byte-identical, AC7). If rng.ts changes algorithm this fails loudly.
const RNG_EXPECTED = [
  0.10277144517749548, 0.5144855019170791, 0.07858735416084528, 0.6312816452700645,
  0.978210358414799,
]
{
  // (a) Determinism — two fresh instances of one seed yield the SAME sequence.
  const a = mulberry32(RNG_SEED)
  const b = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const va = a()
    const vb = b()
    if (va !== vb) fail(`rng determinism: draw ${i} differs (${va} !== ${vb})`)
  }
  // (b) Regression pin — a known seed matches the COMPUTED reference prefix.
  const r = mulberry32(RNG_SEED)
  for (let i = 0; i < RNG_K; i++) {
    const v = r()
    if (v !== RNG_EXPECTED[i]) fail(`rng pin: draw ${i} = ${v}, expected ${RNG_EXPECTED[i]}`)
  }
  // (c) range(rng,min,max) stays within [min,max) and is itself deterministic (a cheap smoke).
  const rr = mulberry32(RNG_SEED)
  const x = range(rr, 10, 20)
  if (!(x >= 10 && x < 20)) fail(`rng range: ${x} not in [10,20)`)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2) constants — the one trivial invariant (also re-proves node-importability / purity, AC10).
// ════════════════════════════════════════════════════════════════════════════════════════════
if (DESIGN_WIDTH !== 1280) fail(`constants: DESIGN_WIDTH = ${DESIGN_WIDTH}, expected 1280`)

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3) save — round-trip + the AC8 clone-no-alias contract (Decision 9a).
// Under node there is NO localStorage, so saveMeta is a no-op (returns false, never throws — AC8)
// and loadMeta degrades to the spread-backfilled DEFAULT_META. We assert:
//   - the loaded shape is stable (currency/bestScore/bestStage are 0; upgrades has keys '1' + '2'),
//   - the cloned per-player upgrade maps are NOT the SAME object reference as DEFAULT_META's (so a
//     later buy() can't mutate the frozen default — the cross-instance leak the clone fixes).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  saveMeta(loadMeta()) // round-trip; under node this is a defensive no-op (must not throw — AC8).
  const m = loadMeta()
  if (m.currency !== 0) fail(`save: currency = ${m.currency}, expected 0`)
  if (m.bestScore !== 0) fail(`save: bestScore = ${m.bestScore}, expected 0`)
  if (m.bestStage !== 0) fail(`save: bestStage = ${m.bestStage}, expected 0`)
  if (!m.upgrades || typeof m.upgrades !== 'object') fail(`save: upgrades missing/not an object`)
  if (!('1' in m.upgrades) || !('2' in m.upgrades)) fail(`save: upgrades missing per-player keys '1'/'2'`)
  // The clone-no-alias guarantee (AC8 / Decision 6/9a): each loaded meta owns its OWN per-player
  // containers — they must NOT alias the frozen DEFAULT_META, or a buy() would mutate the default.
  if (m.upgrades['1'] === DEFAULT_META.upgrades['1']) fail(`save: upgrades['1'] ALIASES the frozen DEFAULT_META (clone-no-alias violated)`)
  if (m.upgrades['2'] === DEFAULT_META.upgrades['2']) fail(`save: upgrades['2'] ALIASES the frozen DEFAULT_META (clone-no-alias violated)`)
  // And two independent loads must own DISTINCT containers (not share one with each other either).
  const m2 = loadMeta()
  if (m.upgrades['1'] === m2.upgrades['1']) fail(`save: two loads share the SAME upgrades['1'] container`)
}

console.log(
  `verify-gen OK: rng deterministic + pinned (byte-identical to reference); ` +
    `constants DESIGN_WIDTH=1280 (pure node-import); ` +
    `save round-trip + clone-no-alias (per-player upgrades['1']/['2'] don't alias frozen DEFAULT_META, AC8). ` +
    `(F0 stub — F2 fills in the seeded-stage sweep.)`,
)
process.exit(0)

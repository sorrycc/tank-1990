// ── Permanent per-player tank-upgrade table (F5 Power-ups & meta §5.2, Decisions D6/D7, AC6) ──
// 100% PURE data module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and asserts
// cost monotonicity + that `apply` never WEAKENS you (AC6/AC11). Keeping the upgrades as DATA (mirrors
// config/tanks.ts / config/stages.ts AND the read-only `dead-cell` reference's config/upgrades.ts — its
// Decision 57) means the Hub renders the two trees GENERICALLY (no per-upgrade UI code — D9), the running tank
// just reads the FOLDED TankSpec, and the verifier checks the contract — no hard-coded upgrade effects scattered
// in HubScene/Tank. This is the F5 analogue of the reference's upgrades.ts row shape, folded over the EXISTING
// F4 `TankSpec` (NOT a bespoke PlayerStats — DRY: the player already reads a TankSpec, so the Hub fold targets it).
//
// Each row is SELF-CONTAINED (D6):
//   id        — stable key stored in MetaState.upgrades[slot] { id: ownedLevel } (the save schema, util/save.ts).
//   name      — EN label the Hub lists (the i18n `upgrade` content key; the EN source of truth — tName/tDesc).
//   desc      — a short one-line EN effect summary for the Hub row.
//   maxLevel  — how many times it can be bought (= costs.length — the verifier asserts).
//   costs[]   — SHARED-currency cost to buy the NEXT level: costs[ownedLevel]. MONOTONE non-decreasing (the
//               verifier asserts, AC6) so deeper levels cost ≥ shallower ones.
//   apply(spec, level) — folds an OWNED level into a TankSpec. It NEVER mutates its input — it returns a NEW
//               spec (referential safety, AC6) — and only ever HELPS (the verifier asserts the output is ≥ base
//               on every numeric field it touches; the two run-SETUP fields default 0 → 0 + level ≥ 0, D7).
//
// THE TWO FOLDS (D4b/D5b — the locked compose, NOT replace): the run-START seed spec is
// `applyUpgrades(applyStarTier(0), upgrades[slot])` (MetaState.startSpec — GameScene reads its startLivesBonus/
// startTier to seed createRunState per slot); the run-TIME tank spec is
// `applyUpgrades(applyStarTier(tier[slot]), upgrades[slot])` (folded at the live build sites). Folding the Hub
// tree OVER the star tier means a star power-up COMPOSES with the bought stats (never strips them — AC2/AC6).

import type { TankSpec } from './tanks.js'

// ── Per-level effect STEPS (the ONE owner — DRY) ── the additive deltas each level of a feel row folds. Owned
// here as named constants so a tuning pass touches one place + the verifier's never-weaker check reasons about
// them. Each is bigger-is-better (a positive add), so the fold trivially satisfies "never weaker on a touched field".
const BULLET_SPEED_STEP = 60 // px/s — `bulletSpeed` row: +N fired-bullet speed per level (the genre's faster shot).
const TANK_SPEED_STEP = 16 // px/s — `tankSpeed` row: +N grid drive speed per level (a snappier tank).

// ── TankUpgrade (D6) ── one self-contained permanent-upgrade row. Exported so consumers (MetaState.buy /
// applyUpgrades, the Hub render, the verifier) type the rows they read from TANK_UPGRADES/TANK_UPGRADES_BY_ID.
export interface TankUpgrade {
  id: string
  name: string // EN source (the i18n `upgrade` content key).
  desc: string // EN one-line effect summary for the Hub row.
  maxLevel: number
  costs: number[] // SHARED-currency cost for the NEXT level: costs[ownedLevel]; MONOTONE non-decreasing.
  apply: (spec: TankSpec, level: number) => TankSpec // NEW spec; never weakens (the verifier asserts — AC6).
}

// ── TANK_UPGRADES (D6/D7) ── the six rows (the generic Hub render + the verifier sweep source). Each only ever
// HELPS the player (the verifier's never-weaker check). The first four fold a plain TankSpec FEEL field
// (maxBullets/bulletSpeed/moveSpeed/maxHp); the last two are run-SETUP (startLivesBonus/startTier — D7), which
// the per-tank feel code ignores but the run-start setup reads (GameScene seeds createRunState from them).
export const TANK_UPGRADES: TankUpgrade[] = [
  // ── +MAX BULLETS ── each level raises the live-bullet cap by 1 (the classic "more shots out at once"). Folds
  // spec.maxBullets, so the running tank may have +level bullets in flight from stage 1 (AC6: "two shots out").
  {
    id: 'maxBullets',
    name: '+Max Bullets',
    desc: '+1 simultaneous bullet per level',
    maxLevel: 2,
    costs: [400, 1200], // monotone non-decreasing.
    apply: (spec, level) => ({ ...spec, maxBullets: spec.maxBullets + level }),
  },
  // ── +BULLET SPEED ── each level adds BULLET_SPEED_STEP px/s to the fired bullet speed (a harder-to-dodge shot).
  {
    id: 'bulletSpeed',
    name: '+Bullet Speed',
    desc: `+${BULLET_SPEED_STEP} bullet speed per level`,
    maxLevel: 3,
    costs: [300, 600, 1000],
    apply: (spec, level) => ({ ...spec, bulletSpeed: spec.bulletSpeed + BULLET_SPEED_STEP * level }),
  },
  // ── +TANK SPEED ── each level adds TANK_SPEED_STEP px/s to the grid drive speed (a snappier tank).
  {
    id: 'tankSpeed',
    name: '+Tank Speed',
    desc: `+${TANK_SPEED_STEP} tank speed per level`,
    maxLevel: 3,
    costs: [300, 600, 1000],
    apply: (spec, level) => ({ ...spec, moveSpeed: spec.moveSpeed + TANK_SPEED_STEP * level }),
  },
  // ── +STARTING LIFE ── each level grants +1 extra life at run start (D7). Folds the OPTIONAL startLivesBonus
  // (default 0 → identity); GameScene reads it: lives = START_LIVES + spec.startLivesBonus (the per-slot seed).
  {
    id: 'startLife',
    name: '+Starting Life',
    desc: '+1 starting life per level',
    maxLevel: 2,
    costs: [500, 1500],
    apply: (spec, level) => ({ ...spec, startLivesBonus: (spec.startLivesBonus ?? 0) + level }),
  },
  // ── BASE ARMOR ── each level raises the run-start HP by 1 (a multi-hit start — the F3/F4 HP funnel gives the
  // multi-hit "for free"). Folds spec.maxHp directly (so the player starts a run able to take +level extra hits).
  {
    id: 'baseArmor',
    name: 'Base Armor',
    desc: '+1 starting HP per level',
    maxLevel: 2,
    costs: [600, 1800],
    apply: (spec, level) => ({ ...spec, maxHp: spec.maxHp + level }),
  },
  // ── STAR START ── start a run already at star tier N (D7). Folds the OPTIONAL startTier (default 0 → identity)
  // to the OWNED level (the highest owned level wins — it's the tier, not an additive). GameScene reads it:
  // tier = spec.startTier (the per-slot seed) → createRunState seeds runState.tier[slot], so the run BEGINS upgraded.
  {
    id: 'starStart',
    name: 'Star Start',
    desc: 'Start a run at star tier (per level)',
    maxLevel: 2,
    costs: [800, 2000],
    apply: (spec, level) => ({ ...spec, startTier: level }),
  },
]

// ── TANK_UPGRADES_BY_ID (id → row) (D6) ── the lookup MetaState.buy + applyUpgrades + the Hub's owned-level/
// affordability readout + the verifier's i18n-content-key validation read. DRY: one source, derived from the list.
export const TANK_UPGRADES_BY_ID: Record<string, TankUpgrade> = Object.fromEntries(TANK_UPGRADES.map((u) => [u.id, u]))

// ── applyUpgrades(base, upgrades) → a NEW TankSpec (PURE, D6/D7, AC6) ──
// Exported STANDALONE (and RE-exported from core/MetaState.ts) so the verifier imports the fold WITHOUT the
// save.ts-coupled MetaState instance (the reference's split). Folds each OWNED upgrade level into the spec via
// its row's pure `apply` (which itself returns a NEW object — never mutates). IDENTITY when `upgrades` is empty:
// a CLONE of base (so a fresh meta folds byte-unchanged — the verifier's identity pin; the caller may mutate the
// result freely without touching the frozen/shared base). Unknown ids in the stored map are skipped + a stored
// level is clamped to the row's maxLevel (a forward-compatible / corrupt save degrades gracefully — never throws).
export function applyUpgrades(base: TankSpec, upgrades: Record<string, number> = {}): TankSpec {
  let spec: TankSpec = { ...base } // start from a CLONE (the identity case returns this clone — never the input ref).
  for (const [id, level] of Object.entries(upgrades)) {
    const row = TANK_UPGRADES_BY_ID[id]
    if (!row || !level) continue // unknown id or level 0 → no-op (graceful, never weakens — AC6).
    const lvl = Math.min(level, row.maxLevel) // clamp a stored level to the cap (a corrupt/over-large save).
    spec = row.apply(spec, lvl) // each apply returns a NEW object (referential safety, AC6).
  }
  return spec
}

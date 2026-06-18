// ── MetaState — the PERSISTENT meta-progression wrapper (F5 Power-ups & meta §5.2, Decision D8, AC5/AC6) ──
// The between-runs seam: core/RunState.ts is the IN-MEMORY run (dropped on run end); THIS owns the PERSISTENT
// meta (the SHARED currency bank, the PER-PLAYER upgrade trees, bestScore/bestStage) saved to localStorage via
// the EXISTING util/save.ts. A run ends → drop the RunState, keep the MetaState (banked).
//
// PURITY SPLIT (D8 — the verifier-import contract): the standalone PURE `applyUpgrades` fold is RE-EXPORTED
// from config/tank-upgrades.ts so scripts/verify-gen.mjs imports the fold WITHOUT this save.ts-coupled instance
// (the verifier never touches createMetaState — it would read localStorage). This module imports ONLY util/save.ts
// (Phaser-free, defensive try/catch — Decision 6 of F0) + the PURE config (tank-upgrades.ts / tanks.ts), so it is
// NOT Phaser-coupled — but its createMetaState/* INSTANCE methods touch storage, so the verifier skips them; only
// the re-exported `applyUpgrades` is on the verifier path. The save.ts try/catch already makes a disabled/full/
// private-mode storage degrade to in-memory defaults — MetaState inherits that for free (it NEVER throws, AC5).
//
// THE LOCKED SCHEMA (D8 — no migration): util/save.ts ALREADY shaped the meta for the locked decision —
// `currency` is the SHARED bank, `upgrades: { '1', '2' }` are the PER-PLAYER trees (slot → id → ownedLevel),
// `bestScore`/`bestStage` the bests — and the verifier already round-trips it. F5 adds NO save-schema migration:
// it only adds the WRAPPER + the upgrade ROWS (config/tank-upgrades.ts) the empty `upgrades` maps were always
// meant to hold. A factory (not a singleton) so the Hub + the next run each load() a FRESH view of the SAME
// storage — a buy in the Hub is reflected when the next run create()s (it re-reads).

import { loadMeta, saveMeta } from '../util/save.js'
import type { MetaState } from '../util/save.js'
import { TANK_UPGRADES_BY_ID, applyUpgrades } from '../config/tank-upgrades.js'
import { applyStarTier } from '../config/tanks.js'
import type { TankSpec } from '../config/tanks.js'
import { CURRENCY_RATIO } from '../config/constants.js'

// ── Re-export the PURE fold (D8 — the verifier path) ── scripts/verify-gen.mjs imports `applyUpgrades` from
// config/tank-upgrades.ts directly (the pure module); re-exporting it here documents that MetaState's run-start
// fold IS that same pure function (DRY — one fold, two import sites: the pure config + this wrapper).
export { applyUpgrades } from '../config/tank-upgrades.js'

// The save-schema slot keys are STRINGS ('1' = P1, '2' = P2 — util/save.ts MetaState.upgrades). The gameplay
// code uses a numeric slot (1 | 2); this maps one to the other in ONE place (DRY) so no use site stringifies.
type Slot = 1 | 2

// The persistent high-score TABLE size — the classic top-5. A LOCAL const (not config/constants.ts): it is a
// single private detail of the one writer below (the slice length), NOT a number any pure module / the
// verifier reads, so importing it across the pure boundary for one consumer would be over-engineering (YAGNI).
const HIGH_SCORE_COUNT = 5

// ── MetaStateInstance (D8) ── the gameplay-facing meta API the Hub/GameScene/GameOver read meta through (never
// util/save.ts directly — the decoupling, mirroring the reference's createMetaState shape adapted to Tank 1990's
// shared-bank + per-player-trees schema). Reads never write; the three writers (buy/bankRun) each saveMeta.
export interface MetaStateInstance {
  getCurrency(): number
  getUpgradeLevel(slot: Slot, id: string): number
  getUpgrades(slot: Slot): Record<string, number> // the slot's owned-level map (GameScene caches it for the live re-fold — D4b).
  getBestScore(): number
  getBestStage(): number
  getHighScores(): { score: number; stage: number }[] // the persistent top-5 finished runs, sorted descending by score (the Title + GameOver render it).
  buy(slot: Slot, id: string): boolean // debit the SHARED currency + increment upgrades[slot][id] if affordable + !maxed; SAVE.
  bankRun(arg: { score: number; stage: number }): number // currency += floor(score·RATIO); bump bestScore/bestStage; insert into the top-5; SAVE → return the banked amount.
  startSpec(slot: Slot): TankSpec // applyUpgrades(applyStarTier(0), upgrades[slot]) — the run-START seed spec (D5b/D7).
}

// Map a numeric slot to its save-schema string key (the ONE place that stringifies — DRY).
function slotKey(slot: Slot): '1' | '2' {
  return slot === 2 ? '2' : '1'
}

// ── createMetaState() → the persistence wrapper instance (D8) ──
// A factory: each call load()s a FRESH view of the SAME localStorage (so a Hub buy is reflected when the next
// run loads — it re-reads on create). load() back-fills DEFAULT_META keys (currency/upgrades/bestScore/bestStage)
// over the stored object + clones the per-player containers (util/save.ts — no alias to the frozen default, AC5).
export function createMetaState(): MetaStateInstance {
  const meta: MetaState = loadMeta()

  return {
    // ── Read helpers (the Hub + GameScene + GameOver read meta ONLY through these — decoupled, D8) ──
    getCurrency() {
      return meta.currency
    },
    getUpgradeLevel(slot, id) {
      return meta.upgrades[slotKey(slot)][id] || 0
    },
    getUpgrades(slot) {
      return meta.upgrades[slotKey(slot)]
    },
    getBestScore() {
      return meta.bestScore || 0
    },
    getBestStage() {
      return meta.bestStage || 0
    },
    getHighScores() {
      return meta.highScores
    },

    // ── buy(slot, id) (D8, AC6) ── buy the NEXT level of THAT player's upgrade if owned < maxLevel AND the
    // SHARED currency covers costs[owned]. On success: debit the shared bank, increment that slot's owned level,
    // SAVE. Returns true on a successful purchase, false otherwise (can't afford / maxed / unknown id) — the Hub
    // treats a false as a no-op (the locked "shared bank, per-player trees" — a buy debits the ONE pool, D8/D9).
    buy(slot, id) {
      const row = TANK_UPGRADES_BY_ID[id]
      if (!row) return false
      const key = slotKey(slot)
      const owned = meta.upgrades[key][id] || 0
      if (owned >= row.maxLevel) return false // already maxed.
      const cost = row.costs[owned]
      if (meta.currency < cost) return false // can't afford out of the SHARED bank.
      meta.currency -= cost
      meta.upgrades[key][id] = owned + 1
      saveMeta(meta)
      return true
    },

    // ── bankRun({ score, stage }) (D8, AC5) ── called ONCE per run by GameScene (under the gameOver guard) on
    // the run-over edge: add floor(score · CURRENCY_RATIO) to the SHARED currency bank, bump bestScore/bestStage
    // (max), INSERT the finished run into the top-5 high-score table, SAVE, and RETURN the banked amount (the
    // GameOver summary DISPLAYS it — it does not itself save). `stage` is the human stage number (stageIndex + 1
    // — GameScene passes it). The single writer of ALL persisted run stats (the bests + the table — one save).
    bankRun({ score, stage }) {
      const banked = Math.floor(score * CURRENCY_RATIO)
      meta.currency += banked
      meta.bestScore = Math.max(meta.bestScore || 0, score)
      meta.bestStage = Math.max(meta.bestStage || 0, stage)
      // The top-5 table: push this run, sort DESCENDING by score, keep the top HIGH_SCORE_COUNT. The same
      // single saveMeta below persists the bests + the table together (no second writer / save — D2).
      meta.highScores.push({ score, stage })
      meta.highScores.sort((a, b) => b.score - a.score)
      meta.highScores = meta.highScores.slice(0, HIGH_SCORE_COUNT)
      saveMeta(meta)
      return banked
    },

    // ── startSpec(slot) (D5b/D7, AC6) ── the run-START seed spec for that player: fold the slot's Hub tree OVER
    // the base tier (applyStarTier(0)). GameScene reads its startLivesBonus/startTier to seed createRunState's
    // per-slot {lives,tier} map (the +startLife/+starStart fold reaches run start). The run-TIME tank spec is a
    // DIFFERENT fold — applyUpgrades(applyStarTier(runState.tier[slot]), getUpgrades(slot)) — folded at the live
    // build sites (D4b), so a star power-up COMPOSES with the Hub tree (never strips it). DRY — the SAME
    // applyUpgrades(applyStarTier(...), upgrades) expression the live build site uses, with tier 0 here.
    startSpec(slot) {
      return applyUpgrades(applyStarTier(0), meta.upgrades[slotKey(slot)])
    },
  }
}

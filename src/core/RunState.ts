// ── RunState — the active run (F4 Enemy tanks §5.2, Decisions D5/D6/D8/D10, AC5/AC8) ──
// 100% PURE — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and drives the SAME
// advance() chain the game does, asserting the seed sequence + stage progression are deterministic + monotone
// (AC8). It owns ONLY run-scoped state; META (banked bestScore/currency across runs) is util/save.ts's job in
// a later feature, kept separate. GameScene constructs ONE RunState in create() and is the single writer (NO
// module-level singleton — that invites spooky mutation + breaks determinism reasoning — the reference's stance).
//
// Mirrors the read-only `dead-cell` reference's core/RunState.ts 1:1 (its createRunState factory + the Knuth
// advance), adapted to Tank 1990's endless grid game: `stageIndex` REPLACES the reference's depth/biome graph
// (Battle City has no biome list — the locked endless decision); the per-stage spawn LEDGER + the placeholder
// power-up timers REPLACE the reference's currencies/scrolls/mutations (F4's run economy is a score + per-player
// lives/tier + the enemy ledger).
//
// ── stageIndex IS RUN-GLOBAL + NEVER RESETS (D6) ── advance() always `stageIndex += 1`, so stageConfig is
// sampled at the run-global index → every difficulty axis (terrain, counts, hardShare, the F4 bullet/spawn
// ramps) rises MONOTONICALLY across the WHOLE endless run (the reference's BLOCKER-1 fix applied to an endless
// game — depth never resets). The ENDLESS divergence: there is no "run complete" gate — a run ends ONLY on
// eagle-loss / all-lives-spent (the locked decision), so advance() is ALWAYS callable.

import { stageConfig } from '../config/stages.js'
import { EXTRA_LIFE_SCORE } from '../config/constants.js'

// ── RunState (D5) ── the active-run value: run-scoped state + the pure method surface (advance()/isBossStage()).
// A plain object (a factory, not a class, not a singleton) so it's node-constructible by the verifier + trivially
// snapshot-able for a later GameOver handoff. Every field is a number/scalar/plain map — no GameObject anywhere.
export interface RunState {
  // ── Run identity + position ──
  seed: number // the current stage's seed; advance() chains the next (the deterministic seed owner — D5).
  stageIndex: number // the run-GLOBAL stage (NEVER resets — the difficulty curve climbs across the run, D6).

  // ── Carried player state (carried across advance() so the stage rebuild reads it — D10) ──
  lives: Record<number, number> // per-PRESENT-player lives (the F3 lives ledger moved here — solo {1}, co-op {1,2}).
  tier: Record<number, number> // per-player star tier (0 = the base spec; the F5 star power-up bumps it).
  score: number // the shared run score (banked on an enemy kill — D10; the HUD/Hub features render/spend it).
  // F-extra-life (D2, AC2) — the NEXT score that awards a 1UP. Seeded to EXTRA_LIFE_SCORE in createRunState +
  // CARRIED untouched by advance()/tickTimers (like score/lives/tier), so a milestone fires ONCE per crossing
  // and the threshold SURVIVES a stage advance. GameScene bumps it past each crossing via extraLivesCrossed().
  nextExtraLifeScore: number // the next score threshold that grants +1 life to all present slots (the 1UP milestone).

  // ── Per-stage spawn ledger (the clear predicate reads these — AC5) ── reseeded from stageConfig on advance().
  enemiesRemaining: number // enemies LEFT to clear this stage = enemiesQueued + enemiesAlive (the readout source).
  enemiesQueued: number // not-yet-spawned enemies waiting to stream in (the spawn loop decrements it).
  enemiesAlive: number // enemies currently on-screen (≤ concurrentEnemies; the clear predicate reads it).

  // ── F-stage-bonus per-stage kills-by-type ledger (stage-bonus §5.2, D1, AC1) ── one kill count per enemy spec
  // id (basic/fast/power/armor/boss), feeding the between-stage bonus tally. Run-scoped numeric state with the
  // EXACT lifecycle of the spawn ledger above: seeded all-0 in createRunState + RESET to 0 each advance() (a fresh
  // stage starts at 0 kills) — so the tally counts ONLY the stage just cleared. tallyKill(id) is the sole writer.
  killsByStage: Record<string, number> // per-stage kills keyed by enemy spec id (RESET each stage, like the ledger).

  // ── Power-up timers (F5 §5.2, D4/D5 — DRIVEN now: clock/shovel/helmet write them, tickTimers decays them) ──
  // Seeded 0 = inactive (the neutral identity). F4 left freezeTimer/shovelTimer as placeholders; F5 WRITES them
  // (the clock/shovel power-ups), ticks them down (tickTimers), and reads them (the scene's gdt-freeze / fortify).
  freezeTimer: number // s — the clock power-up's "freeze all enemies" timer (gdt=0 while > 0; 0 = no freeze).
  shovelTimer: number // s — the shovel power-up's "fortify base ring → steel" timer (TileMap swap; 0 = off).
  shieldTimer: Record<number, number> // F5 (D5) — per-PRESENT-player helmet i-frame window (0 = no shield, identity).
  // boat-drill — the two NEW timed power-up timers, lifecycle-identical to the ones above (seeded 0, decayed by
  // tickTimers, RESET on advance()). boatTimer is PER-SLOT (mirrors shieldTimer — each player sails its own boat:
  // the tank×water collider's process callback reads boatTimer[slot]); drillTimer is SCALAR (mirrors freezeTimer —
  // a shared player-fire buff: a player bullet snapshots it at fire time, like canBreakSteel — D4).
  boatTimer: Record<number, number> // s — per-PRESENT-player amphibious window (0 = no boat; the tank glides over WATER while > 0).
  drillTimer: number // s — the drill power-up's "player bullet pierces one brick layer" window (0 = no drill, identity).

  // ── Methods ──
  advance(): RunState // next seed + stageIndex++ + reseed the spawn ledger + RESET the timed power-ups (carries lives/tier/score — D5/D6).
  isBossStage(): boolean // stageConfig(stageIndex).isBoss (the boss feature reads it; F4 spawns the normal roster).
  tickTimers(dt: number): void // F5 (D5/AC3) — decay freezeTimer/shovelTimer/shieldTimer[*]/boatTimer[*]/drillTimer toward 0, clamped ≥ 0.
  tallyKill(id: string): void // F-stage-bonus (D1/AC1) — bump killsByStage[id] (no-ops an id outside the roster).
}

// ── SlotSeed (F5 §5.2, D5b) ── the per-slot run-START seed a present player launches with: its lives + its
// star tier, both already FOLDED by the caller (GameScene) from MetaState.startSpec(slot) — so the Hub's
// per-player +startLife / +starStart upgrades land at run start. A plain `{ lives, tier }` pair (KISS — exactly
// what the run needs, nothing more); createRunState seeds runState.lives[slot]/tier[slot] from it.
export interface SlotSeed {
  lives: number // the slot's run-start lives = START_LIVES + the folded spec's startLivesBonus (D7).
  tier: number // the slot's run-start star tier = the folded spec's startTier (D7; 0 = the base spec).
}

// ── Deterministic seed chain (D5) ── the Knuth multiplicative advance, byte-identical to the read-only
// reference's RunState (so the seed chain has ONE owner — DRY). The same startSeed always replays the same
// seed/stage sequence (AC8). >>> 0 keeps every seed an unsigned 32-bit int.
const nextSeed = (s: number): number => (s * 2654435761 + 0x9e3779b9) >>> 0

// ── extraLivesCrossed(prevThreshold, score, step) → { lives, nextThreshold } (F-extra-life §5.2, D1/D3, AC3) ──
// PURE module-level helper: given the run's CURRENT 1UP threshold (`prevThreshold`), the new `score`, and the
// per-milestone `step` (EXTRA_LIFE_SCORE), count how many milestones the score has now reached and return the
// new (un-crossed) threshold. The `while` loop handles a SINGLE big jump crossing TWO thresholds at once (a
// boss kill / a grenade clearing many tanks — D3); since `step > 0` the threshold strictly increases, so the
// loop self-terminates and `nextThreshold > score` always holds on return. GameScene + the verifier both call
// this ONE implementation (DRY — one owner of "how many 1UPs did this score earn"). No Phaser, no mutation of
// the args — the verifier drives it over a case table headlessly (AC3).
export function extraLivesCrossed(
  prevThreshold: number,
  score: number,
  step: number,
): { lives: number; nextThreshold: number } {
  let lives = 0
  let nextThreshold = prevThreshold
  while (score >= nextThreshold) {
    lives += 1
    nextThreshold += step
  }
  return { lives, nextThreshold }
}

// ── createRunState(startSeed, seeds) → RunState (D5/D5b/D11) ── the factory. Seeds lives/tier for the PRESENT
// players ONLY (the F3 D11 present-players scoping) — but now from a PER-SLOT `{ [slot]: {lives, tier} }` seed
// map (F5 D5b — the reviewer's blocking issue: the F4 scalar `startLives` shared across slots can't express two
// INDEPENDENT Hub trees). The present-slots set IS `Object.keys(seeds)` (the map is the present-players list —
// DRY, the separate presentSlots arg is dropped). Each slot's run-start lives/tier come straight from that
// slot's folded spec (GameScene computes them from MetaState.startSpec(slot) — D7). stageIndex=0, score=0, the
// spawn ledger from stageConfig(0), the power-up timers 0 (the neutral identity). PURE (no Phaser, no clock
// read) so the verifier constructs + drives it headlessly (AC6/AC8).
export function createRunState(startSeed: number, seeds: Record<number, SlotSeed>): RunState {
  const lives: Record<number, number> = {}
  const tier: Record<number, number> = {}
  const shieldTimer: Record<number, number> = {}
  const boatTimer: Record<number, number> = {}
  for (const key of Object.keys(seeds)) {
    const slot = Number(key)
    const s = seeds[slot]
    lives[slot] = s.lives // the slot's folded run-start lives (START_LIVES + the +startLife fold — D7).
    tier[slot] = s.tier // the slot's folded run-start star tier (the +starStart fold — D7; 0 = the base spec).
    shieldTimer[slot] = 0 // no helmet shield at run start (the neutral identity — the helmet power-up arms it).
    boatTimer[slot] = 0 // boat-drill — no amphibious window at run start (the neutral identity — the boat power-up arms it).
  }
  // Seed the per-stage spawn ledger from stage 0: every enemy is QUEUED, none alive yet (the spawn loop streams
  // them); enemiesRemaining = the stage's totalEnemies (the clear predicate counts it down to 0 — AC5).
  const cfg0 = stageConfig(0)

  return {
    seed: startSeed >>> 0,
    stageIndex: 0,
    lives,
    tier,
    score: 0,
    // F-extra-life (D2, AC2) — the first 1UP fires at EXTRA_LIFE_SCORE; CARRIED across advance() (untouched, like
    // score) so the milestone survives a stage advance + fires once per crossing. GameScene bumps it past crossings.
    nextExtraLifeScore: EXTRA_LIFE_SCORE,
    enemiesRemaining: cfg0.totalEnemies,
    enemiesQueued: cfg0.totalEnemies,
    enemiesAlive: 0,
    // F-stage-bonus (D1/AC1) — seed every roster id's kill count to 0 (a fresh run/stage starts at 0 kills). The
    // ids match the enemy spec ids (basic/fast/power/armor + stealth-enemy's `stealth` + the explicitly-spawned
    // boss). advance() resets these, so the tally on a stage clear reflects ONLY that stage's kills.
    killsByStage: { basic: 0, fast: 0, power: 0, armor: 0, stealth: 0, boss: 0 },
    freezeTimer: 0,
    shovelTimer: 0,
    shieldTimer,
    boatTimer, // boat-drill — per-slot amphibious window, all 0 at run start (the neutral identity).
    drillTimer: 0, // boat-drill — no brick-pierce window at run start (the neutral identity).

    // ── advance() (D5/D6, AC3/AC5/AC8) — next seed + stageIndex++ + reseed the spawn ledger + RESET the timed
    // power-ups ── ALWAYS: chain the next seed (deterministic), increment the run-global stageIndex (NEVER
    // resets — D6), RESEED the per-stage ledger from the new stageConfig (all queued, none alive), and RESET the
    // timed power-ups to 0 (a clock/shovel/shield does NOT bleed into the next stage — the classic; the verifier
    // asserts the reset, AC3). lives/tier/score are CARRIED (the stage rebuild reads them — D10): advance()
    // touches ONLY the seed/stage/ledger/timers, never the run economy. The ENDLESS divergence: no
    // isRunComplete gate — advance() is always callable (the locked decision, D6).
    advance(this: RunState): RunState {
      this.seed = nextSeed(this.seed)
      this.stageIndex += 1
      const cfg = stageConfig(this.stageIndex)
      this.enemiesRemaining = cfg.totalEnemies
      this.enemiesQueued = cfg.totalEnemies
      this.enemiesAlive = 0
      // RESET the timed power-ups (F5 D5/AC3 + boat-drill) — a stage advance drops any active freeze/shovel/
      // shield/boat/drill (no power-up bleeds into the next stage — the classic; the verifier asserts the reset).
      this.freezeTimer = 0
      this.shovelTimer = 0
      this.drillTimer = 0
      for (const slot of Object.keys(this.shieldTimer)) this.shieldTimer[Number(slot)] = 0
      for (const slot of Object.keys(this.boatTimer)) this.boatTimer[Number(slot)] = 0
      // F-stage-bonus (D1/AC1) — RESET every per-stage kill count to 0 (the fresh stage starts at 0 kills, so the
      // NEXT clear's tally counts only its own stage). The SAME lifecycle as the spawn-ledger reseed above.
      for (const id of Object.keys(this.killsByStage)) this.killsByStage[id] = 0
      return this
    },

    // ── isBossStage() (D6) ── true on every BOSS_STAGE_EVERY-th stage (stageConfig's isBoss). The boss feature
    // reads it to spawn the heavy boss tank + the "STAGE N CLEARED" banner; F4 spawns the normal roster only,
    // but exposes the predicate now (the seam) so the boss feature plugs in with no RunState change. PURE.
    isBossStage(this: RunState): boolean {
      return stageConfig(this.stageIndex).isBoss
    },

    // ── tickTimers(dt) (F5 §5.2, D5, AC3) ── decay every timed power-up toward 0 on the GAMEPLAY dt (in
    // SECONDS), clamped at 0 so a timer never goes negative (the verifier drives it past a timer's value and
    // asserts it lands at EXACTLY 0). PURE — no Phaser, no clock read: the COUNTDOWN lives here; the freeze
    // EFFECT (gdt=0) + the fortify/revert body-swap live in the scene (Phaser-coupled). The freeze timer counts
    // down in real gameplay time (fed dt BEFORE the freeze is applied for the frame), so the freeze itself ends.
    tickTimers(this: RunState, dt: number): void {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt)
      this.shovelTimer = Math.max(0, this.shovelTimer - dt)
      this.drillTimer = Math.max(0, this.drillTimer - dt) // boat-drill — the scalar drill window (mirrors freezeTimer).
      for (const slot of Object.keys(this.shieldTimer)) {
        const s = Number(slot)
        this.shieldTimer[s] = Math.max(0, this.shieldTimer[s] - dt)
      }
      // boat-drill — decay each present player's amphibious window (mirrors the shieldTimer sweep above).
      for (const slot of Object.keys(this.boatTimer)) {
        const s = Number(slot)
        this.boatTimer[s] = Math.max(0, this.boatTimer[s] - dt)
      }
    },

    // ── tallyKill(id) (F-stage-bonus §5.2, D1, AC1) ── the SOLE writer of the per-stage kills-by-type ledger:
    // increment killsByStage[id] for a killed enemy's spec id. GUARDS an id outside the roster (`id in
    // killsByStage`) so an unknown/typo id no-ops instead of creating a stray key (KISS/defensive). Called from
    // GameScene._onEnemyKilled where the kill score is already banked (the boss routes there too, so its kill
    // tallies for FREE). PURE — no Phaser; the verifier drives it headlessly + asserts the increment + reset.
    tallyKill(this: RunState, id: string): void {
      if (id in this.killsByStage) this.killsByStage[id]++
    },
  }
}

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

  // ── Per-stage spawn ledger (the clear predicate reads these — AC5) ── reseeded from stageConfig on advance().
  enemiesRemaining: number // enemies LEFT to clear this stage = enemiesQueued + enemiesAlive (the readout source).
  enemiesQueued: number // not-yet-spawned enemies waiting to stream in (the spawn loop decrements it).
  enemiesAlive: number // enemies currently on-screen (≤ concurrentEnemies; the clear predicate reads it).

  // ── PLACEHOLDER power-up timers (seeded 0 = inactive, the neutral identity; consumed in F5 — the seam) ──
  freezeTimer: number // s — the clock power-up's "freeze all enemies" timer (F5 reads it; 0 = no freeze).
  shovelTimer: number // s — the shovel power-up's "fortify base walls → steel" timer (F5 reads it; 0 = off).

  // ── Methods ──
  advance(): RunState // next seed + stageIndex++ + reseed the spawn ledger (carries lives/tier/score — D5/D6).
  isBossStage(): boolean // stageConfig(stageIndex).isBoss (the boss feature reads it; F4 spawns the normal roster).
}

// ── Deterministic seed chain (D5) ── the Knuth multiplicative advance, byte-identical to the read-only
// reference's RunState (so the seed chain has ONE owner — DRY). The same startSeed always replays the same
// seed/stage sequence (AC8). >>> 0 keeps every seed an unsigned 32-bit int.
const nextSeed = (s: number): number => (s * 2654435761 + 0x9e3779b9) >>> 0

// ── createRunState(startSeed, presentSlots) → RunState (D5/D11) ── the factory. Seeds lives/tier for the
// PRESENT players ONLY (the F3 D11 present-players scoping — solo → [1], co-op → [1,2]; a phantom P2 is never
// seeded), stageIndex=0, score=0, the spawn ledger from stageConfig(0), and the power-up timers 0 (the neutral
// identity). PURE (no Phaser, no clock read) so the verifier constructs + drives it headlessly (AC8).
export function createRunState(startSeed: number, presentSlots: number[], startLives: number): RunState {
  const lives: Record<number, number> = {}
  const tier: Record<number, number> = {}
  for (const slot of presentSlots) {
    lives[slot] = startLives // each present player starts with startLives (the F3 START_LIVES, passed IN — purity).
    tier[slot] = 0 // tier 0 = the base spec (the F5 star power-up bumps it).
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
    enemiesRemaining: cfg0.totalEnemies,
    enemiesQueued: cfg0.totalEnemies,
    enemiesAlive: 0,
    freezeTimer: 0,
    shovelTimer: 0,

    // ── advance() (D5/D6, AC5/AC8) — next seed + stageIndex++ + reseed the spawn ledger ── ALWAYS: chain the
    // next seed (deterministic), increment the run-global stageIndex (NEVER resets — D6), and RESEED the
    // per-stage ledger from the new stageConfig (all queued, none alive). lives/tier/score are CARRIED (the
    // stage rebuild reads them — D10): advance() touches ONLY the seed/stage/ledger, never the run economy. The
    // ENDLESS divergence: no isRunComplete gate — advance() is always callable (the locked decision, D6).
    advance(this: RunState): RunState {
      this.seed = nextSeed(this.seed)
      this.stageIndex += 1
      const cfg = stageConfig(this.stageIndex)
      this.enemiesRemaining = cfg.totalEnemies
      this.enemiesQueued = cfg.totalEnemies
      this.enemiesAlive = 0
      return this
    },

    // ── isBossStage() (D6) ── true on every BOSS_STAGE_EVERY-th stage (stageConfig's isBoss). The boss feature
    // reads it to spawn the heavy boss tank + the "STAGE N CLEARED" banner; F4 spawns the normal roster only,
    // but exposes the predicate now (the seam) so the boss feature plugs in with no RunState change. PURE.
    isBossStage(this: RunState): boolean {
      return stageConfig(this.stageIndex).isBoss
    },
  }
}

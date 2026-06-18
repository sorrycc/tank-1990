// ── Defensive localStorage wrapper + the meta-progression schema (F0 scaffold §5.2, Decision 6/9a, AC8) ──
// PURE of Phaser — safe to import anywhere, including headless (scripts/verify-gen.mjs imports it under
// plain node, AC9/AC10). EVERY localStorage access is wrapped in try/catch so a disabled / private-mode /
// quota-exceeded / non-DOM (node) storage NEVER throws: callers transparently degrade to defaults. ONE
// module owns serialization + error swallowing (DRY) so use sites stay clean.

// Read a JSON value by key, returning `fallback` if it's missing OR storage/parsing fails.
export function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

// Write a JSON-serializable value by key. Returns true on success, false if storage
// is unavailable/full (never throws) so callers can decide whether to surface it.
export function set(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// ── Typed meta-progression wrapper (Decision 6) ──
// The locked META HUB is a SHARED currency bank with PER-PLAYER upgrade trees (P1 | P2 columns) plus a
// persisted bestScore + bestStage. The schema is owned in ONE place (the save key + the default shape)
// layered over the defensive get/set above; a later core/MetaState wraps these for the Hub + GameOver.
const SAVE_KEY = 'tank-1990:meta'

// The persistent meta shape. `currency` is the SHARED permanent bank (a fraction of run score, survives
// death); `upgrades` maps player-slot ('1' = P1, '2' = P2) → that player's owned upgrade levels
// (upgrade-id → level), so a later applyUpgrades(slot) folds exactly ONE player's tree with no schema
// migration (Decision 6); `bestScore` / `bestStage` are the best ever reached (GameOver displays them).
export interface MetaState {
  currency: number
  upgrades: { '1': Record<string, number>; '2': Record<string, number> }
  bestScore: number
  bestStage: number
}

// DEFAULT_META is the IDENTITY: empty shared bank, empty per-player upgrade maps, best 0/0 — a fresh
// save behaves exactly like a first-ever run. Frozen so a bug can never mutate the shared default
// in place; loadMeta CLONES the mutable containers out of it (see below). loadMeta's spread back-fills
// any key PRESENT here for a save written by an OLDER build, so every field MUST live in DEFAULT_META.
export const DEFAULT_META: Readonly<MetaState> = Object.freeze({
  currency: 0,
  upgrades: { '1': {}, '2': {} },
  bestScore: 0,
  bestStage: 0,
})

export function loadMeta(): MetaState {
  const stored = get<Partial<MetaState> | null>(SAVE_KEY, null)
  const merged = stored && typeof stored === 'object' ? { ...DEFAULT_META, ...stored } : { ...DEFAULT_META }
  // CLONE the mutable containers so a back-filled field never ALIASES the frozen DEFAULT_META reference
  // (Decision 6/9a, AC8): a save missing `upgrades` would otherwise share DEFAULT_META's nested {} maps,
  // and a later buy() push into upgrades['1'] would mutate the shared frozen default — a subtle
  // cross-instance leak (and a TypeError against the frozen object). Each loaded meta owns its OWN
  // per-player containers. Defensive against a corrupt `upgrades` that isn't an object (degrade to {}).
  const u = (merged.upgrades || {}) as Partial<MetaState['upgrades']>
  merged.upgrades = {
    '1': { ...(u['1'] || {}) },
    '2': { ...(u['2'] || {}) },
  }
  return merged
}

export function saveMeta(meta: MetaState): boolean {
  return set(SAVE_KEY, meta)
}

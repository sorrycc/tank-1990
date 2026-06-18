// Deterministic, seedable PRNG (mulberry32). A fresh instance from the same seed always
// yields the same sequence — the determinism foundation for ALL procedural generation
// (F0 scaffold §5.2, Decision 5, AC7/AC9). The ALGORITHM is byte-identical to the read-only
// `dead-cell` reference's src/util/rng.ts so seeds are cross-compatible and
// scripts/verify-gen.mjs can pin exact output sequences; only this comment is adapted to
// reference this doc. (The reference's extra `dailySeed` is OMITTED — Tank 1990 has no
// daily-challenge contract; YAGNI, Decision 5.)
export type RNG = () => number

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Convenience: random float in [min, max) from a generator.
export function range(rng: RNG, min: number, max: number): number {
  return min + (max - min) * rng()
}

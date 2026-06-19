// ── F-seed-challenge run-seed hex round-trip (seed-challenge §5.2, D1/D5, AC2) ──
// PURE of Phaser — safe to import anywhere, including headless (scripts/verify-gen.mjs node-imports it under plain
// node, re-proving purity; a stray Phaser import would throw). The TWO tiny PURE helpers behind the seed challenge:
// the whole-run seed is ALREADY a `>>> 0` unsigned-32-bit int everywhere (_mintSeed / nextSeed / generateStage), so
// the Title shows + accepts it as an 8-hex string (SEED_HEX_DIGITS — the DRY owner). Text parsing is the ONLY new
// logic with edge cases (bad input, casing, padding); keeping it PURE lets the verifier assert the total/round-trip
// contract by node-import (the same proof-by-import stance as stages.ts / util/settings.ts — SOLID, one concern).

import { SEED_HEX_DIGITS } from './constants.js'

// ── formatSeed(seed) → the seed as a zero-padded, UPPER-case 8-hex string (D1, AC2) ── coerce the input `>>> 0` to a
// u32 first (so a negative/over-range number formats lossless-ly), then base-16 + left-pad to SEED_HEX_DIGITS (so a
// small seed still shows the full fixed width — e.g. 0 → '00000000') + upper-case (the canonical display casing the
// round-trip below targets). Total — never throws. `formatSeed(parseSeed(s)!) === s.toUpperCase()` for any valid 8-hex.
export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(16).padStart(SEED_HEX_DIGITS, '0').toUpperCase()
}

// ── parseSeed(text) → the parsed u32, or null on empty/invalid (D1/D5, AC2) ── strip a leading `0x`/`#` + surrounding
// whitespace (so a copy-pasted `0xDEADBEEF` / `#DEADBEEF` / a padded value all parse), then accept up to
// SEED_HEX_DIGITS hex digits and return the parsed value `>>> 0` (the u32 the whole run seeds from). Returns null for
// empty / over-long (> 8 digits, which would overflow a u32) / non-hex input — so the Title can reject a bad entry
// WITHOUT throwing (null = "clear the pin" = mint a fresh seed each launch). Total — never throws.
export function parseSeed(text: string): number | null {
  const cleaned = text.trim().replace(/^0x/i, '').replace(/^#/, '')
  if (cleaned === '' || cleaned.length > SEED_HEX_DIGITS || !/^[0-9a-f]+$/i.test(cleaned)) return null
  return parseInt(cleaned, 16) >>> 0
}

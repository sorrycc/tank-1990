// ── Persisted player PREFERENCE wrapper (F-difficulty-select §5.2, D3, AC6) ──
// PURE of Phaser — safe to import anywhere, including headless (scripts/verify-gen.mjs node-imports it under plain
// node — re-proving purity; a stray Phaser import would throw). Layered over util/save.ts's defensive get/set (the
// SAME try/catch wrapper the meta schema uses — DRY) but under a SEPARATE `tank-1990:settings` key, NOT the meta
// schema (D3): the player's pre-run difficulty/start-stage PREFERENCE is a different concern from the persistent run
// ECONOMY (currency/upgrades/bestScore), so mixing them would force a meta-schema migration + couple two concerns
// (SOLID). loadSettings() back-fills + clamps on read so a corrupt/old value degrades to DEFAULT_SETTINGS — never
// throws (it inherits save.ts's error-swallowing for free — AC6).

import { get, set } from './save.js'
import type { Difficulty } from '../config/stages.js'
import type { Locale } from '../i18n/index.js' // TYPE-only — i18n/index.ts is Phaser-free, so purity is preserved.
import { MAX_START_STAGE } from '../config/constants.js'

// The dedicated preference key — SEPARATE from save.ts's `tank-1990:meta` (D3 — the preference vs. the run economy).
const SETTINGS_KEY = 'tank-1990:settings'

// ── The persisted preference shape (D3) ── the Title's two choices: the difficulty level + the optional starting-stage
// offset. A plain `{ difficulty, startStage }` pair (KISS — exactly what the Title sets + GameScene reads, nothing more).
export interface Settings {
  difficulty: Difficulty // the Easy/Normal/Hard level (folded into the ramps + the run-start lives).
  startStage: number // the optional "skip to stage N" offset, clamped to [0, MAX_START_STAGE] (0 = start at stage 0).
  // ── F-seed-challenge (seed-challenge §5.3, D2/D3, AC3) ── the last-used / pinned run seed (a u32, shown/typed as
  // hex on the Title). `null` = "mint a fresh seed each launch" (the IDENTITY — today's behaviour, no separate flag —
  // D3). When non-null GameScene seeds the run from it (a reproducible board); after every run GameScene writes the
  // actually-used seed back (mint or pin — D4/AC5) so the Title can display + a retry can replay the last board.
  seed: number | null
  // ── F-settings (settings §5.2, D1/D2/D6, AC1/AC2) ── the master sound level 0..1, pushed into Phaser's GLOBAL
  // `sound.volume` (which audio/Sound.ts already multiplies into every synthesized tone — D2, no audio change).
  // 1 = full, 0 = silent. Clamped to [0,1] on read (a corrupt/NaN value → the 1.0 default — never an invalid volume).
  volume: number
  // ── F-settings (settings §5.2, D1/D4, AC1/AC3) ── the persisted active locale ('en' | 'zh-CN'), making the
  // language switchable at runtime + sticky across launches (replacing the boot-only browser auto-detect). A
  // corrupt/old value (no locale field) degrades to the default; main.ts seeds the browser-detected locale on a
  // truly fresh save (D4) so today's auto-detect UX survives for new players, then the choice becomes sticky.
  locale: Locale
}

// DEFAULT_SETTINGS is the IDENTITY: Normal difficulty (the 1.0 pressure / +0 lives identity) + a stage-0 start — so a
// fresh save behaves EXACTLY like a run with no chooser at all (today's behaviour, byte-unchanged — D1/AC1). loadSettings
// back-fills any missing field from here (no migration), so every field MUST live in DEFAULT_SETTINGS.
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  difficulty: 'normal',
  startStage: 0,
  seed: null, // F-seed-challenge (D3) — no pin by default → mint a fresh seed each launch (today's behaviour).
  volume: 1, // F-settings (D2) — full master volume by default → today's audio behaviour, byte-unchanged.
  locale: 'en', // F-settings (D4) — the type-level default; main.ts seeds the browser-detected locale on a fresh save.
})

// The three valid difficulty levels — the on-read clamp uses this set so a corrupt/old `difficulty` (e.g. a renamed
// level from a future build, or garbage) degrades to `normal` rather than feeding an unknown level to the ramps.
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

// The two valid locales — the on-read clamp uses this set (mirroring the DIFFICULTIES guard) so a corrupt/old
// `locale` (an unknown code from a future build, or garbage) degrades to the default rather than persisting an
// invalid locale that i18n's setLocale would silently coerce to 'en' anyway (keeping the PERSISTED value clean).
const LOCALES: readonly Locale[] = ['en', 'zh-CN']

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// ── loadSettings() → Settings (D3, AC6) ── read + back-fill + CLAMP, mirroring util/save.ts's loadMeta. A missing/
// non-object stored value degrades to DEFAULT_SETTINGS; `difficulty` is forced into the three valid levels (else
// `normal`); `startStage` is floored + clamped to [0, MAX_START_STAGE] (a corrupt/NaN/out-of-range value → 0). All
// over save.ts's get (which never throws — a disabled/private-mode storage returns the fallback), so this never throws.
export function loadSettings(): Settings {
  const stored = get<Partial<Settings> | null>(SETTINGS_KEY, null)
  const merged = stored && typeof stored === 'object' ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS }
  // Force `difficulty` into a valid level (a corrupt/old value → the `normal` identity — never feed an unknown
  // level to the pure ramps, which would just fall back to normal anyway, but keeping the PERSISTED value clean).
  const difficulty: Difficulty = DIFFICULTIES.includes(merged.difficulty as Difficulty)
    ? (merged.difficulty as Difficulty)
    : DEFAULT_SETTINGS.difficulty
  // Floor + clamp the start stage to [0, MAX_START_STAGE] (a NaN/negative/over-cap value → 0, the identity).
  const startStage = clamp(Math.floor(Number(merged.startStage) || 0), 0, MAX_START_STAGE)
  // ── F-seed-challenge (D3, AC3) ── coerce a present finite numeric seed to a u32 (`>>> 0`); degrade ANYTHING else
  // (a corrupt value / an old build with no seed field / undefined / NaN) to null = "mint fresh" — never throws, the
  // run-setup path is unaffected by a missing pin (D3 — the absence of a pin IS "random").
  const seed = typeof merged.seed === 'number' && Number.isFinite(merged.seed) ? merged.seed >>> 0 : null
  // ── F-settings (D2/D6, AC1) ── clamp the master volume to [0,1] (a NaN/out-of-range/missing value → the 1.0
  // default via the SAME Number-coerce + clamp guard the startStage field uses), so the persisted value is always
  // a valid Phaser global volume — a malformed save can never feed an invalid level into game.sound.volume.
  const volume = clamp(Number.isFinite(Number(merged.volume)) ? Number(merged.volume) : DEFAULT_SETTINGS.volume, 0, 1)
  // ── F-settings (D4, AC1/AC3) ── force the locale into the two valid codes (a corrupt/old/missing value → the
  // default), the SAME defensive pattern as the difficulty field above. main.ts decides the fresh-save detect.
  const locale: Locale = LOCALES.includes(merged.locale as Locale) ? (merged.locale as Locale) : DEFAULT_SETTINGS.locale
  return { difficulty, startStage, seed, volume, locale }
}

// ── hasStoredSettings() → boolean (settings §5.3, D4) ── true iff a settings blob has ACTUALLY been persisted under
// the key (vs. a truly fresh save). main.ts uses it to honor today's browser auto-detect on a first-ever launch
// (no stored locale yet) without persisting a wrong choice: a fresh save → detectLocale() seeds the default, an
// existing save → the stored locale. Kept PURE (over save.ts's get — never throws) so settings.ts stays node-safe.
export function hasStoredSettings(): boolean {
  return get<unknown>(SETTINGS_KEY, null) != null
}

// ── saveSettings(s) → boolean (D3, AC6) ── write the preference under the dedicated key (over save.ts's set, which
// never throws — returns false if storage is unavailable/full). The Title calls it on every chooser change so the
// choice persists across launches (the SAME pattern as saveMeta — DRY).
export function saveSettings(settings: Settings): boolean {
  return set(SETTINGS_KEY, settings)
}

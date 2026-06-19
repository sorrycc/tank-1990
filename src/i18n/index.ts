// ── i18n core (zh-CN + English) — 100% PURE of Phaser (F5 Power-ups & meta §5.2, Decision D12, AC9) ──────────
// A tiny hand-rolled localisation layer (KISS / YAGNI — two locales, a few dozen short strings, no plural or
// ICU needs, so a full i18n library would be over-engineering and would break the single-runtime-dependency
// profile). It imports NOTHING Phaser-coupled, so it is safe to consume from any scene AND keeps
// scripts/verify-gen.mjs's headless import path clean (the same purity contract config/* keeps — the verifier
// node-imports this + en.ts + zh-CN.ts to re-prove purity + assert the dictionary structure, AC9/AC11).
//
// Copied FAITHFUL in STRUCTURE from the read-only `dead-cell` reference's i18n/index.ts (its t/tName/tDesc +
// the zh→en→key fallback + the Dict shape) but TRIMMED to Tank 1990's actual content (D12, YAGNI): the only
// CONTENT category is `upgrade` (the permanent tank-upgrade name/desc overrides) — the reference's
// weapon/biome/boss/blueprint/tier/… categories are OMITTED (Tank 1990 has none).
//
// TWO LAYERS:
//   t(key, params?)        — UI CHROME (titles, labels, instructions). The English source lives in en.ts;
//                            zh-CN overrides in zh-CN.ts. {var} interpolation. Fallback chain zh → en → key,
//                            so a missing zh key shows English, never a blank (AC9).
//   tName / tDesc(cat,id,en) — CONTENT (config name/desc). English is the config object's OWN string (the
//                            source of truth — config/* is never edited); the zh override is keyed by the
//                            entry's stable `id` in zh-CN.ts. A missing override returns `en` (never blank).
//
// LOCALE: the ACTIVE runtime locale is module state set ONCE at boot (main.ts: setLocale(detectLocale())) and
// is never changed mid-session in F5 (the Hub language-switch row is OUT of F5's locked scope — YAGNI). The
// user reads zh-CN, so a zh browser auto-detects to Chinese chrome.

import { EN } from './en.js'
import { ZH_CN } from './zh-CN.js'

export type Locale = 'en' | 'zh-CN'

// The translatable CONTENT categories — each reuses the config entry's stable `id` as its key. Tank 1990 has
// exactly ONE (D12, YAGNI): `upgrade` (the permanent tank-upgrade rows). The power-ups + HUD + chrome are all
// `ui` keys (no per-entry content table needed). The type stays a union so adding a category later is one edit.
export type Category = 'upgrade'

export interface Entry {
  name?: string
  desc?: string
}

// A locale dictionary: a required `ui` map (chrome) + the optional per-category content tables (keyed by id).
export type Dict = { ui: Record<string, string> } & Partial<Record<Category, Record<string, Entry>>>

const LOCALES: Record<Locale, Dict> = { en: EN, 'zh-CN': ZH_CN }

// The live active locale (boot default 'en' until main.ts sets it from the browser detect — AC9).
let current: Locale = 'en'

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  current = l in LOCALES ? l : 'en'
}

// Browser-language auto-detect for a first-time visitor (no saved preference). Guarded so a headless /
// no-navigator environment degrades to 'en' instead of throwing (mirrors save.ts's defensive discipline, AC9).
export function detectLocale(): Locale {
  try {
    const n = (typeof navigator !== 'undefined' && navigator.language) || 'en'
    return n.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  } catch {
    return 'en'
  }
}

// ── t(key, params?) — UI chrome lookup with {var} interpolation. Fallback: zh → en → key (never blank, AC9). ──
export function t(key: string, params?: Record<string, string | number>): string {
  const s = LOCALES[current]?.ui[key] ?? EN.ui[key] ?? key
  return params ? s.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? `{${k}}`)) : s
}

// ── tName / tDesc(category, id, en) — content lookup. `en` is the config object's own string (the English
// source of truth + the fallback when no zh override exists). The 'en' locale short-circuits to it. (AC9) ──
export function tName(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.name ?? en
}

export function tDesc(cat: Category, id: string, en: string): string {
  if (current === 'en') return en
  return LOCALES[current]?.[cat]?.[id]?.desc ?? en
}

// ── CONTROLS_ROWS (F6 §5.2, D9, AC7) — the ONE shared, ordered controls list the Title renders ──
// Copied FAITHFUL in SHAPE from the read-only `dead-cell` reference's i18n/index.ts CONTROLS_ROWS export (its
// Decision 6): an ordered list of [actionKey, keysKey] pairs. The CHROME strings live in en.ts / zh-CN.ts
// (`controls.*`) — so the bindings sit in ONE place (the i18n table), read by the Title as TWO fixed-x text
// columns per row (action label | keys), the CJK-safe alignment discipline (never padEnd, which only aligns
// under monospace). Trimmed to Tank 1990's two schemes: P1 (WASD move · J fire), P2 (arrows move · Numpad0/Shift fire),
// + the shared keys (SPACE/ENTER start · M mute). The key TOKENS (WASD/J/Numpad0/Shift/SPACE/ENTER/M) stay literal
// (they name PHYSICAL keys — not translatable), the ACTION labels localise. The bindings themselves stay owned by
// core/Input.ts (the single key owner — `addKeys`); this table is a human-readable MIRROR (a rebind updates both).
export const CONTROLS_ROWS: readonly (readonly [string, string])[] = [
  ['controls.p1Move', 'controls.p1Move.keys'],
  ['controls.p1Fire', 'controls.p1Fire.keys'],
  ['controls.p2Move', 'controls.p2Move.keys'],
  ['controls.p2Fire', 'controls.p2Fire.keys'],
  ['controls.start', 'controls.start.keys'],
  ['controls.mute', 'controls.mute.keys'],
]

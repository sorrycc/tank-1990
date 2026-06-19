// ── English UI-chrome dictionary (the SOURCE locale) — F5 §5.2, Decision D12, AC9 ─────────────────────────
// Only the `ui` namespace + the `upgrade` content category live here. The upgrade EN name/desc are NOT
// duplicated — their English source is the config row's own `name`/`desc` (config/tank-upgrades.ts), read via
// tName/tDesc's `en` fallback; this file overrides only what zh-CN needs (so `upgrade` is OMITTED from EN — its
// English IS the config string). EN.ui is ALSO the FALLBACK every locale degrades to (i18n/index.ts: a missing
// zh key → this → the key). The verifier asserts ZH_CN.ui ⊆ EN.ui (no orphan zh chrome key — AC9).

import type { Dict } from './index.js'

export const EN: Dict = {
  ui: {
    // ── Title ──
    'title.heading': 'TANK 1990',
    'title.subtitle': '坦克大战 — Battle City',
    'title.start': 'Press SPACE / ENTER or click to start',
    // F7 (D6/AC6) — the BEST line surfaced on the Title (read from MetaState; 0/0 on a fresh save).
    'title.best': 'BEST SCORE {score} · BEST STAGE {stage}',

    // ── High-score table (the persistent top-5 finished runs — Title + GameOver, D6) — a heading, a row
    // template (rank · score · stage), and an empty-state line for a fresh save. Rendered via t() at both sites.
    'hi.title': 'HIGH SCORES',
    'hi.row': '{rank}. {score} · STAGE {stage}',
    'hi.empty': 'No runs yet — be the first!',

    // ── Controls reference (F6 §5.2, D9, AC7) — the shared CONTROLS_ROWS the Title renders so a first-time
    // player discovers both schemes. The action labels localise; the key TOKENS (WASD/J/Numpad0/SPACE/ENTER/M)
    // stay literal — they name physical keys (the bindings owned by core/Input.ts; this table mirrors them).
    'controls.title': 'CONTROLS',
    'controls.p1Move': 'P1 MOVE',
    'controls.p1Move.keys': 'W A S D',
    'controls.p1Fire': 'P1 FIRE',
    'controls.p1Fire.keys': 'J',
    'controls.p2Move': 'P2 MOVE',
    'controls.p2Move.keys': 'Arrow Keys',
    'controls.p2Fire': 'P2 FIRE',
    'controls.p2Fire.keys': 'Numpad0',
    'controls.start': 'START',
    'controls.start.keys': 'SPACE / ENTER',
    'controls.mute': 'MUTE',
    'controls.mute.keys': 'M',

    // ── Hub (the two-column shared-bank upgrade lobby — D9) ──
    'hub.title': 'HUB',
    'hub.currency': 'CURRENCY {n}',
    'hub.p1': 'PLAYER 1',
    'hub.p2': 'PLAYER 2',
    'hub.lv': 'Lv {owned}/{max}',
    'hub.max': 'MAX',
    'hub.cost': '{cost}',
    'hub.start': 'START RUN',
    'hub.best': 'BEST SCORE {score} · BEST STAGE {stage}', // F7 (D6/AC6) — the BEST line near the currency header.
    'hub.footerCoop': 'P1: WASD move · J buy  |  P2: arrows move · Numpad0 buy  |  SPACE/ENTER: START RUN',
    'hub.footerSolo': 'WASD / arrows: select · J / SPACE: buy  |  SPACE / ENTER: START RUN',

    // ── HUD (the parallel overlay — D8) ──
    'hud.stage': 'STAGE {n}',
    'hud.score': 'SCORE {n}',
    'hud.currency': 'CURRENCY {n}',
    'hud.enemies': 'ENEMIES {n}',
    'hud.p1Lives': 'P1 LIVES {n}',
    'hud.p2Lives': 'P2 LIVES {n}',
    'hud.power': 'POWER {name} {secs}s',
    'hud.powerInstant': 'POWER {name}',
    'hud.stageCleared': 'STAGE {n} CLEARED', // F6 (D5, AC3) — the boss-stage clear banner (a timed overlay).
    'hud.stageIntro': 'STAGE {n}', // (D3/D5, AC2) — the centered STAGE-N intro curtain shown before each stage.
    'hud.muted': 'MUTED', // F6 (D8, AC6) — the mute cue shown while audio is muted (M toggle).
    'hud.oneUp': 'EXTRA LIFE', // (extra-life, D5, AC5/AC6) — the centered 1UP cue shown on a score-milestone crossing.

    // ── GameOver (the run-summary snapshot — AC5) ──
    'over.heading': 'GAME OVER',
    'over.score': 'SCORE {n}',
    'over.stage': 'STAGE REACHED {n}',
    'over.banked': 'CURRENCY BANKED {n}',
    'over.bestScore': 'BEST SCORE {n}',
    'over.bestStage': 'BEST STAGE {n}',
    'over.continue': 'Press SPACE / ENTER or click to continue',

    // ── Pause overlay (F7 §5.3, D3/D9, AC4) — the read-only freeze panel: a title, a RUN-summary section
    // (stage / score / enemies-left / P1·P2 lives), and a resume hint. The CONTROLS rows reuse the shared
    // CONTROLS_ROWS (DRY with the Title). All localised; the RUN values are interpolated by the overlay. ──
    'pause.title': 'PAUSED',
    'pause.run': 'RUN',
    'pause.stage': 'STAGE',
    'pause.score': 'SCORE',
    'pause.enemies': 'ENEMIES LEFT',
    'pause.p1Lives': 'P1 LIVES',
    'pause.p2Lives': 'P2 LIVES',
    'pause.help': 'Press P / ESC to resume',

    // ── Power-up names (the HUD active-power-up + any in-world label key off the kind id — AC2/AC8) ──
    'power.helmet': 'SHIELD',
    'power.clock': 'FREEZE',
    'power.shovel': 'FORTIFY',
    'power.star': 'STAR',
    'power.grenade': 'GRENADE',
    'power.tank': 'EXTRA LIFE',
  },
}

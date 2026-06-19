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
    // ── F-difficulty-select (difficulty-select §5.4, D7, AC7) — the Title difficulty/start-stage chooser row. The
    // three level labels (the selected one highlighted), the start-stage readout, and a one-line key hint. ──
    'title.difficulty': 'DIFFICULTY',
    'title.diff.easy': 'EASY',
    'title.diff.normal': 'NORMAL',
    'title.diff.hard': 'HARD',
    'title.startStage': 'START STAGE {n}',
    'title.diffHint': '← / → difficulty · ↑ / ↓ start stage',
    // F-settings (settings §5.4, AC5) — the Title hint line for the new Settings screen (`O` opens it).
    'title.settings': 'O settings',
    // F-construction-mode (construction-mode §6, D6) — the Title hint line for the level editor (`T` opens it).
    'title.construction': 'T  Construction',

    // ── F-seed-challenge (seed-challenge §5.5, D1/D6, AC6) — the Title run-seed row. `title.seed` shows the pinned/
    // last run seed as 8-hex; `title.seed.random` is the dim placeholder when no seed is pinned (a fresh-random run);
    // `title.seedHint` the one-line key hint; `title.seedEntry` the inline entry prompt shown while typing a seed.
    'title.seed': 'SEED {seed}',
    'title.seed.random': 'RANDOM',
    'title.seedHint': 'S edit seed · R random',
    'title.seedEntry': 'SEED: {buffer}_  (ENTER ok · ESC cancel)',

    // ── High-score table (the persistent top-5 finished runs — Title + GameOver, D6) — a heading, a row
    // template (rank · score · stage), and an empty-state line for a fresh save. Rendered via t() at both sites.
    'hi.title': 'HIGH SCORES',
    'hi.row': '{rank}. {score} · STAGE {stage}',
    'hi.empty': 'No runs yet — be the first!',

    // ── Controls reference (F6 §5.2, D9, AC7) — the shared CONTROLS_ROWS the Title renders so a first-time
    // player discovers both schemes. The action labels localise; the key TOKENS (WASD/J/Numpad0/Shift/SPACE/ENTER/M)
    // stay literal — they name physical keys (the bindings owned by core/Input.ts; this table mirrors them).
    'controls.title': 'CONTROLS',
    'controls.p1Move': 'P1 MOVE',
    'controls.p1Move.keys': 'W A S D',
    'controls.p1Fire': 'P1 FIRE',
    'controls.p1Fire.keys': 'J',
    'controls.p2Move': 'P2 MOVE',
    'controls.p2Move.keys': 'Arrow Keys',
    'controls.p2Fire': 'P2 FIRE',
    'controls.p2Fire.keys': 'Shift / Numpad0',
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
    'hub.footerCoop': 'P1: WASD move · J buy  |  P2: arrows move · Shift / Numpad0 buy  |  SPACE/ENTER: START RUN',
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

    // ── Between-stage bonus tally (stage-bonus §6, D5, AC2) — the classic bonus screen shown on EVERY stage clear.
    // The title heads a centered panel; one `bonus.row` per enemy type killed this stage (name · count × points =
    // subtotal); `bonus.clearBonus` the flat stage-clear bonus; `bonus.total` the grand total. The per-type display
    // names (BASIC/FAST/POWER/ARMOR/BOSS) localise; GameScene formats the whole block + the HUD mirrors it.
    'bonus.title': 'BONUS',
    'bonus.row': '{name}  {count} × {points} = {sub}',
    'bonus.clearBonus': 'STAGE CLEAR  {pts}',
    'bonus.total': 'TOTAL  {pts}',
    'bonus.basic': 'BASIC',
    'bonus.fast': 'FAST',
    'bonus.power': 'POWER',
    'bonus.armor': 'ARMOR',
    'bonus.stealth': 'STEALTH', // stealth-enemy (AC5) — the stealth-tank kill row.
    'bonus.boss': 'BOSS',

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

    // ── Settings screen (F-settings §5.4, D5, AC6) — the dedicated options menu reachable from the Title.
    // A title, the three editable rows (VOLUME · DIFFICULTY · LANGUAGE) + a BACK row, and a one-line key hint.
    // VOLUME shows a percent (`settings.volumeValue`); the DIFFICULTY value reuses the existing `title.diff.*`
    // labels (DRY — no new difficulty strings); LANGUAGE toggles between the two `settings.lang.*` names. ──
    'settings.title': 'SETTINGS',
    'settings.volume': 'VOLUME',
    'settings.volumeValue': '{pct}%',
    'settings.difficulty': 'DIFFICULTY',
    'settings.language': 'LANGUAGE',
    'settings.back': 'BACK',
    'settings.hint': '↑ / ↓ select · ← / → change · ENTER / ESC back',
    'settings.lang.en': 'English',
    'settings.lang.zh': '简体中文',

    // ── Power-up names (the HUD active-power-up + any in-world label key off the kind id — AC2/AC8) ──
    'power.helmet': 'SHIELD',
    'power.clock': 'FREEZE',
    'power.shovel': 'FORTIFY',
    'power.star': 'STAR',
    'power.grenade': 'GRENADE',
    'power.tank': 'EXTRA LIFE',
    'power.boat': 'BOAT', // boat-drill — amphibious (drive over water).
    'power.drill': 'DRILL', // boat-drill — the bullet pierces one brick layer.

    // ── Touch controls (touch-controls §6) — the on-screen FIRE button label, shown ONLY on a touch-capable
    // device (the D-pad arrows are drawn as triangle glyphs, so they need no string — KISS). Read via t('touch.fire').
    'touch.fire': 'FIRE',

    // ── Construction (level editor) scene (construction-mode §6, D4) — the heading, the current-brush label
    // (interpolating the brush's tile name), the seven tile names the brush cycles, the one-line controls hint,
    // and the brief save-confirm blip. All read via t() in ConstructionScene (no literal user-facing string inlined).
    'construction.title': 'CONSTRUCTION',
    'construction.brush': 'Brush: {tile}',
    'construction.tile.empty': 'EMPTY',
    'construction.tile.brick': 'BRICK',
    'construction.tile.steel': 'STEEL',
    'construction.tile.water': 'WATER',
    'construction.tile.trees': 'TREES',
    'construction.tile.ice': 'ICE',
    'construction.tile.base': 'BASE',
    'construction.controls': 'Arrows move · SPACE paint · B brush · C clear · S save · P play · ESC back',
    'construction.saved': 'Saved',
  },
}

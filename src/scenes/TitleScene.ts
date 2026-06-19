import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT, MAX_START_STAGE } from '../config/constants.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'
import { createMetaState } from '../core/MetaState.js'
import { loadSettings, saveSettings } from '../util/settings.js'
import { formatSeed, parseSeed } from '../config/seed.js'
import { SEED_HEX_DIGITS } from '../config/constants.js'
import type { Difficulty } from '../config/stages.js'

// ── TitleScene (F0 scaffold §5.3 → F5 §5.4 → F6 §5.4, Decision 2/4/D12/D9, AC7/AC9) ──
// Shows the game title + a Start prompt and routes to the HUB on a key OR a pointer (the flow is
// Title → Hub → Game). All text is positioned from the FIXED design resolution (Decision 1) — never
// window.innerWidth — so it stays centered under Scale.FIT regardless of viewport size. F5 (D12/AC9):
// the F0 inline literals were SWAPPED to t('...') against the same UI_FONT. F6 (D9/AC7): a both-players
// CONTROLS reference (the reference's CONTROLS_ROWS pattern — two fixed-x columns per row) so a first-time
// player discovers every binding (P1 = WASD + J · P2 = arrows + Numpad0 · SPACE/ENTER start · M mute), and a
// menu Sound for the start blip (a no-op under NoAudio — AC6). The live locale is set ONCE at boot in main.ts.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2

    // F6 (D6/AC6) — the menu-blip façade (shares Phaser's ONE AudioContext; a no-op under NoAudio). The Title's
    // start gesture is the FIRST user gesture, which resumes Phaser's suspended context — so this blip may be
    // silent on the very first press but every later sound (the Hub/game) plays.
    const sfx = new Sound(this)

    // [music] (D6/AC2) — start the looping Title theme on entry, and STOP it when the player leaves Title so it never
    // bleeds into the Hub. The theme is the only LOOPING music (Title-only by design); it self-stops between bars if M
    // mutes, and is a safe no-op under NoAudio. The SHUTDOWN listener fires once when the start gesture swaps scenes.
    sfx.titleMusicStart()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.musicStop())

    // Heading + subtitle near the TOP (repositioned to make room for the controls reference below — every Y is
    // off the FIXED design resolution so it stays centered under Scale.FIT, the existing Title discipline).
    this.add
      .text(cx, 120, t('title.heading'), {
        fontFamily: UI_FONT,
        fontSize: '80px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, 196, t('title.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── F7 (D6/AC6) — the BEST line under the subtitle + the high-score table below the controls ── read
    // MetaState ONCE in create() (the impure save boundary — createMetaState() load()s a fresh view); the same
    // instance feeds the BEST line here AND the top-5 table further down (DRY). A fresh save reads 0/0 + an empty
    // table (the defensive save degrades to defaults — never blank/crash). Localised via t('title.best', {score,
    // stage}); positioned off the FIXED design resolution (cx + a fixed Y) so it centers under Scale.FIT.
    const meta = createMetaState()
    this.add
      .text(cx, 234, t('title.best', { score: meta.getBestScore(), stage: meta.getBestStage() }), {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#feca57', // gold — matches the score/best chrome.
      })
      .setOrigin(0.5)

    // ── F-difficulty-select chooser (difficulty-select §5.4, D7, AC7) ── the Title difficulty/start-stage row,
    // positioned in the gap under the BEST line (off the FIXED design resolution so it centers under Scale.FIT — the
    // Title's discipline). loadSettings() reads the persisted preference ONCE here (the impure save boundary, like
    // createMetaState() above); a mutable local mirrors it. The difficulty label + the three levels render on ONE
    // centered row (the SELECTED level highlighted); a start-stage readout + a key hint sit just below. ←/→ cycle the
    // difficulty, ↑/↓ adjust the start stage (clamped [0, MAX_START_STAGE]); each change saveSettings()s + re-renders
    // the row + plays the existing uiMove blip (a no-op under NoAudio). The start gesture (SPACE/ENTER/pointer) is
    // UNCHANGED — it still routes to 'Hub' (the flow is intact); only the persisted preference is set before the run.
    const settings = loadSettings()
    const LEVELS: Difficulty[] = ['easy', 'normal', 'hard']

    // The difficulty label (left of the level chips) + one chip per level on the SAME centered row. Fixed-x columns
    // (the CJK-safe alignment discipline — never derived from a label's pixel width). The chip Text objects are
    // captured so a key change re-tints them in place (the selected one bright, the rest dim) — no scene rebuild.
    const DIFF_Y = 258
    this.add
      .text(cx - 200, DIFF_Y, t('title.difficulty'), { fontFamily: UI_FONT, fontSize: '20px', color: '#8b949e' })
      .setOrigin(0, 0.5)
    const chips: Phaser.GameObjects.Text[] = []
    const CHIP_X0 = cx - 40 // the first chip's left x; each subsequent chip is offset by CHIP_DX (fixed, CJK-safe).
    const CHIP_DX = 110
    for (let i = 0; i < LEVELS.length; i++) {
      chips.push(
        this.add
          .text(CHIP_X0 + i * CHIP_DX, DIFF_Y, t(`title.diff.${LEVELS[i]}`), {
            fontFamily: UI_FONT,
            fontSize: '20px',
            color: '#8b949e',
          })
          .setOrigin(0, 0.5),
      )
    }
    // The start-stage readout + the one-line key hint, just below the chooser row (same centered discipline).
    const startStageText = this.add
      .text(cx, DIFF_Y + 28, t('title.startStage', { n: settings.startStage }), {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#c9d1d9',
      })
      .setOrigin(0.5)
    this.add
      .text(cx, DIFF_Y + 50, t('title.diffHint'), { fontFamily: UI_FONT, fontSize: '15px', color: '#5c6b7a' })
      .setOrigin(0.5)

    // ── F-seed-challenge seed row (seed-challenge §5.5, D1/D6, AC6) ── a single compact line in the gap under the
    // diffHint (off the FIXED design resolution so it centers under Scale.FIT — the Title's discipline). It shows the
    // pinned/last run seed as 8-hex (t('title.seed', { seed }) — bright) OR a dim t('title.seed.random') placeholder
    // when no seed is pinned (a fresh-random run each launch). While the inline hex entry is OPEN it instead shows
    // t('title.seedEntry', { buffer }) (the typed-so-far digits + a caret). One Text object, re-textured/tinted in
    // place by renderSeed() (no scene rebuild — the renderChooser pattern, DRY).
    const SEED_Y = DIFF_Y + 64
    const seedText = this.add
      .text(cx, SEED_Y, '', { fontFamily: UI_FONT, fontSize: '15px', color: '#c9d1d9' }).setOrigin(0.5)

    // ── The editingSeed latch (D6) ── while OPEN the difficulty/start-stage cursor keys + the SPACE/ENTER start are
    // SUPPRESSED (one boolean, no modal scene — KISS) so typing a hex seed never also cycles difficulty or launches
    // the run; `seedBuffer` accumulates the typed digits (capped at SEED_HEX_DIGITS — D1).
    let editingSeed = false
    let seedBuffer = ''

    // Re-render the seed line from the current state (one render path — DRY): the entry prompt while editing, else the
    // pinned hex (bright) or the dim "random" placeholder. Called once now + after every seed change / entry keystroke.
    const renderSeed = (): void => {
      if (editingSeed) {
        seedText.setText(t('title.seedEntry', { buffer: seedBuffer })).setColor('#feca57') // amber while typing.
      } else if (settings.seed != null) {
        seedText.setText(t('title.seed', { seed: formatSeed(settings.seed) })).setColor('#c9d1d9')
      } else {
        seedText.setText(t('title.seed', { seed: t('title.seed.random') })).setColor('#5c6b7a') // dim "random".
      }
    }
    renderSeed()
    this.add
      .text(cx, SEED_Y + 20, t('title.seedHint'), { fontFamily: UI_FONT, fontSize: '15px', color: '#5c6b7a' })
      .setOrigin(0.5)

    // Re-render the chooser from the current `settings` (the selected level bright green, the rest dim; the
    // start-stage readout re-interpolated). Called once now + after every key change (DRY — one render path).
    const renderChooser = (): void => {
      for (let i = 0; i < LEVELS.length; i++) {
        chips[i].setColor(LEVELS[i] === settings.difficulty ? '#58d68d' : '#8b949e')
      }
      startStageText.setText(t('title.startStage', { n: settings.startStage }))
    }
    renderChooser()

    // ←/→ cycle the difficulty (wrapping over the three levels); ↑/↓ adjust the start stage within [0, MAX_START_STAGE].
    // Each change persists (saveSettings) + re-renders + blips (uiMove — the quiet nav tick; a no-op under NoAudio).
    // F-seed-challenge (D6) — the cursor handlers NO-OP while a seed is being typed (the editingSeed latch), so a
    // stray arrow during hex entry never also cycles difficulty / start stage.
    const cycleDiff = (dir: number): void => {
      if (editingSeed) return
      const idx = LEVELS.indexOf(settings.difficulty)
      settings.difficulty = LEVELS[(idx + dir + LEVELS.length) % LEVELS.length]
      saveSettings(settings)
      renderChooser()
      sfx.uiMove()
    }
    const adjustStage = (delta: number): void => {
      if (editingSeed) return
      const next = Math.max(0, Math.min(MAX_START_STAGE, settings.startStage + delta))
      if (next === settings.startStage) return // already at a bound — no save / blip (the Hub's "no-op on a clamp" feel).
      settings.startStage = next
      saveSettings(settings)
      renderChooser()
      sfx.uiMove()
    }
    this.input.keyboard!.on('keydown-LEFT', () => cycleDiff(-1))
    this.input.keyboard!.on('keydown-RIGHT', () => cycleDiff(1))
    this.input.keyboard!.on('keydown-UP', () => adjustStage(1))
    this.input.keyboard!.on('keydown-DOWN', () => adjustStage(-1))

    // ── F-seed-challenge inline hex entry + clear (seed-challenge §5.5, D1/D5/D6, AC6) ── `S` toggles the entry
    // OPEN (or commits an open buffer): while open, hex keystrokes (0-9 A-F) APPEND to seedBuffer capped at
    // SEED_HEX_DIGITS, BACKSPACE deletes the last digit, ENTER COMMITS via parseSeed (null → clear the pin = random,
    // a valid value → pin it), ESC CANCELS (discard the buffer). `R` clears the pin straight to random (settings.seed
    // = null). Every commit/clear saveSettings()s + re-renders the row + plays the uiMove blip (a no-op under
    // NoAudio). All keystrokes are guarded by editingSeed so they only act while entry is open (KISS — one latch).
    const HEX = /^[0-9A-F]$/ // a single hex digit (key.toUpperCase()) — the only chars the buffer accepts.
    const commitSeed = (): void => {
      const parsed = parseSeed(seedBuffer) // null on empty/invalid → clear the pin (random); else the pinned u32.
      settings.seed = parsed
      saveSettings(settings)
      editingSeed = false
      seedBuffer = ''
      renderSeed()
      sfx.uiMove()
    }
    this.input.keyboard!.on('keydown-S', () => {
      if (editingSeed) {
        commitSeed() // a second S commits the open buffer (a quick toggle-to-confirm).
        return
      }
      editingSeed = true
      seedBuffer = settings.seed != null ? formatSeed(settings.seed) : '' // pre-fill the current pin so an edit tweaks it.
      renderSeed()
      sfx.uiMove()
    })
    this.input.keyboard!.on('keydown-R', () => {
      if (editingSeed) return // R is also a hex digit-adjacent key; while editing the digit handler owns it (no clear).
      settings.seed = null // clear the pin → a fresh-random seed each launch.
      saveSettings(settings)
      renderSeed()
      sfx.uiMove()
    })
    this.input.keyboard!.on('keydown-BACKSPACE', () => {
      if (!editingSeed) return
      seedBuffer = seedBuffer.slice(0, -1)
      renderSeed()
      sfx.uiMove()
    })
    this.input.keyboard!.on('keydown-ESC', () => {
      if (!editingSeed) return
      editingSeed = false // cancel — discard the buffer, leave the existing pin untouched.
      seedBuffer = ''
      renderSeed()
      sfx.uiMove()
    })
    // The catch-all hex digit handler: while editing, a 0-9/A-F key APPENDS (capped at SEED_HEX_DIGITS). Bound on the
    // generic `keydown` so every alphanumeric key routes here (the named S/R/BACKSPACE/ESC handlers above run first
    // for their keys; S/R short-circuit while editing so they don't double as a digit — S commits, R is inert).
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (!editingSeed) return
      const ch = ev.key.toUpperCase()
      if (ch === 'S') return // S commits (handled above) — never an appended digit.
      if (!HEX.test(ch) || seedBuffer.length >= SEED_HEX_DIGITS) return
      seedBuffer += ch
      renderSeed()
      sfx.uiMove()
    })

    // ── Controls reference (F6 §5.4, D9, AC7) — the shared CONTROLS_ROWS so a first-time player discovers BOTH
    // schemes. Two fixed-x columns per row (action label | keys), the CJK-safe alignment discipline (D9 — never
    // padEnd, which only aligns under monospace). Six rows in ONE centered column block; the key TOKENS stay
    // literal (they name physical keys). All positions derive from DESIGN_WIDTH/DESIGN_HEIGHT (never
    // window.innerWidth) so it centers under Scale.FIT — the existing Title layout discipline.
    // (F-difficulty-select §5.4) — the controls block is pushed DOWN below the new chooser row above (it occupies the
    // 258–308 band); ROW_H tightened 34→30 so the controls + the hi-score table below still clear the start prompt.
    // (F-seed-challenge §5.5) — the controls block is pushed DOWN below the new seed row above (it now occupies the
    // 322–362 band); ROW_H tightened 30→28 so the controls + the hi-score table below still clear the start prompt.
    this.add
      .text(cx, 376, t('controls.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)

    const ROW_H = 28
    const rowsTop = 408
    const LABEL_X = cx - 140 // the action-label column (left-anchored, fixed x — CJK-safe).
    const KEYS_X = cx + 30 // the keys column (left-anchored, fixed x — never derived from the label's width).
    for (let i = 0; i < CONTROLS_ROWS.length; i++) {
      const y = rowsTop + i * ROW_H
      const [actionKey, keysKey] = CONTROLS_ROWS[i]
      this.add
        .text(LABEL_X, y, t(actionKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0, 0.5)
      this.add
        .text(KEYS_X, y, t(keysKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#c9d1d9' })
        .setOrigin(0, 0.5)
    }

    // ── High-score table (the persistent top-5 — D5/AC3) ── read off the SAME MetaState instance as the BEST
    // line (one extra getHighScores() read — DRY). A heading + up to 5 rows (rank · score · stage) via t(),
    // or a single empty-state line for a fresh save. All Y off the FIXED design resolution (centers under
    // Scale.FIT), positioned below the controls block — the Title's existing layout discipline.
    const HI_TITLE_Y = rowsTop + CONTROLS_ROWS.length * ROW_H + 18
    this.add
      .text(cx, HI_TITLE_Y, t('hi.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)
    const scores = meta.getHighScores()
    if (scores.length === 0) {
      this.add
        .text(cx, HI_TITLE_Y + 34, t('hi.empty'), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0.5)
    } else {
      const HI_ROW_H = 26
      for (let i = 0; i < scores.length; i++) {
        const { score, stage } = scores[i]
        this.add
          .text(cx, HI_TITLE_Y + 32 + i * HI_ROW_H, t('hi.row', { rank: i + 1, score, stage }), {
            fontFamily: UI_FONT,
            fontSize: '18px',
            color: '#c9d1d9',
          })
          .setOrigin(0.5)
      }
    }

    this.add
      .text(cx, DESIGN_HEIGHT - 72, t('title.start'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Enter the HUB on key OR pointer. `once` so a held key / double-tap can't fire the transition
    // twice (AC6). Pointer is bound on the scene input so a click anywhere counts. Each target ('Hub')
    // is a registered scene (main.ts), so the flow is reachable. F6 (D6/AC6) — a start blip on the gesture.
    // F-seed-challenge (D6) — while the seed buffer is OPEN, SPACE/ENTER do NOT start: ENTER COMMITS the typed seed
    // (the natural "confirm" key), SPACE is swallowed (so a stray space during entry never launches). The latch is
    // checked INSIDE the handler (not `once`-gated) so a suppressed press doesn't consume the one-shot binding — the
    // start gesture still fires on the FIRST press made while NOT editing.
    let started = false // guards the one-shot start across the now-conditional SPACE/ENTER/pointer paths.
    const enterHub = () => {
      if (editingSeed || started) return // suppressed mid-entry / already started — no launch.
      started = true
      sfx.uiSelect() // F6 (AC6) — the Title start blip (the first gesture also resumes the context).
      this.scene.start('Hub')
    }
    this.input.keyboard!.on('keydown-SPACE', enterHub)
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (editingSeed) {
        commitSeed() // ENTER commits the open seed buffer (parseSeed; null → random) instead of starting.
        return
      }
      enterHub()
    })
    this.input.once('pointerdown', enterHub)
  }
}

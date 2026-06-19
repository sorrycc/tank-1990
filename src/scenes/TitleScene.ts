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
// player discovers every binding (P1 = WASD + J · P2 = arrows + Numpad0/Shift · SPACE/ENTER start · M mute), and a
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

    // Heading + subtitle near the TOP (repositioned to make room for the controls reference below — every Y is
    // off the FIXED design resolution so it stays centered under Scale.FIT, the existing Title discipline).
    this.add
      .text(cx, 80, t('title.heading'), {
        fontFamily: UI_FONT,
        fontSize: '80px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, 150, t('title.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── F7 (D6/AC6) — the BEST line under the subtitle + the high-score table beside the controls (lower band) ── read
    // MetaState ONCE in create() (the impure save boundary — createMetaState() load()s a fresh view); the same
    // instance feeds the BEST line here AND the top-5 table further down (DRY). A fresh save reads 0/0 + an empty
    // table (the defensive save degrades to defaults — never blank/crash). Localised via t('title.best', {score,
    // stage}); positioned off the FIXED design resolution (cx + a fixed Y) so it centers under Scale.FIT.
    const meta = createMetaState()
    this.add
      .text(cx, 188, t('title.best', { score: meta.getBestScore(), stage: meta.getBestStage() }), {
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
    const DIFF_Y = 224 // (title-layout reflow) pulled up from 258 so the compressed top stack + two-column band below all fit 720px.
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
    // ── F-settings (settings §5.4, AC5) — the Settings hint line, on the same dim hint band as the seed hint. The
    // `O` key (handler below) routes to the dedicated Settings screen (volume · default difficulty · language). ──
    // F-construction-mode (construction-mode §5.4, D6, AC1) — the Settings (`O`) + Construction (`T`) hints share
    // ONE dim band (two centered-block halves) so the editor route is discoverable WITHOUT pushing the controls +
    // hi-score layout below it down. Settings sits left of center, Construction right (each setOrigin centers its half).
    this.add
      .text(cx - 16, SEED_Y + 36, t('title.settings'), { fontFamily: UI_FONT, fontSize: '15px', color: '#5c6b7a' })
      .setOrigin(1, 0.5)
    this.add
      .text(cx + 16, SEED_Y + 36, t('title.construction'), { fontFamily: UI_FONT, fontSize: '15px', color: '#5c6b7a' })
      .setOrigin(0, 0.5)

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

    // ── Lower band: two side-by-side columns (title-layout reflow) ── the controls reference (LEFT) + the
    // persistent high-score table (RIGHT). The single-column stack had outgrown the 720px canvas (the start prompt
    // overlapped the hi-score rows and the table ran off the bottom), so the two TALLEST blocks (6 control rows ·
    // ≤5 hi-score rows) are paired horizontally to halve the band's height. Both columns share BAND_TITLE_Y +
    // BAND_ROWS_TOP, and every x is a FIXED anchor off cx (never window.innerWidth, never a label's pixel width —
    // the CJK-safe discipline, D9) so the whole layout stays centered under Scale.FIT.
    const LEFT_CX = cx - 230 // controls column center.
    const RIGHT_CX = cx + 230 // high-score column center (symmetric about cx — the two headers balance).
    const BAND_TITLE_Y = 376 // both column headers sit on this row, ~44px below the top stack.
    const BAND_ROW_H = 30
    const BAND_ROWS_TOP = 410 // both columns' first row.

    // ── Controls reference (F6 §5.4, D9, AC7) — the shared CONTROLS_ROWS so a first-time player discovers BOTH
    // schemes. Two fixed-x SUB-columns per row (action label | keys), the CJK-safe alignment discipline (D9 — never
    // padEnd, which only aligns under monospace). The key TOKENS stay literal (they name physical keys).
    this.add
      .text(LEFT_CX, BAND_TITLE_Y, t('controls.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)
    const LABEL_X = LEFT_CX - 120 // the action-label sub-column (left-anchored, fixed x — CJK-safe).
    const KEYS_X = LEFT_CX + 14 // the keys sub-column (left-anchored, fixed x — never derived from the label's width).
    for (let i = 0; i < CONTROLS_ROWS.length; i++) {
      const y = BAND_ROWS_TOP + i * BAND_ROW_H
      const [actionKey, keysKey] = CONTROLS_ROWS[i]
      this.add
        .text(LABEL_X, y, t(actionKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0, 0.5)
      this.add
        .text(KEYS_X, y, t(keysKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#c9d1d9' })
        .setOrigin(0, 0.5)
    }

    // ── High-score table (the persistent top-5 — D5/AC3) ── read off the SAME MetaState instance as the BEST line
    // (one extra getHighScores() read — DRY). A heading + up to 5 rows (rank · score · stage) via t(), or a single
    // empty-state line for a fresh save. Rendered as the RIGHT column of the band, row-aligned with the controls.
    this.add
      .text(RIGHT_CX, BAND_TITLE_Y, t('hi.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)
    const scores = meta.getHighScores()
    if (scores.length === 0) {
      this.add
        .text(RIGHT_CX, BAND_ROWS_TOP, t('hi.empty'), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0.5)
    } else {
      for (let i = 0; i < scores.length; i++) {
        const { score, stage } = scores[i]
        this.add
          .text(RIGHT_CX, BAND_ROWS_TOP + i * BAND_ROW_H, t('hi.row', { rank: i + 1, score, stage }), {
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
      // [stage-start-jingle] — the start gesture plays the small uiSelect confirm blip (matching the O/T nav
      // gestures below). The Battle City "Game Start" jingle no longer lives here: it now plays at the start
      // of EVERY stage (GameScene._buildStage()). This gesture's keydown/pointer still unlocks Phaser's audio
      // context (WebAudioSoundManager binds resume() to body keydown/mousedown/etc., independent of any
      // play()), so the first stage's jingle is reliably audible — even for keyboard-only starts.
      sfx.uiSelect()
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

    // ── F-settings (settings §5.4, D5, AC5) — `O` (Options) opens the dedicated Settings screen. Guarded by the
    // SAME editingSeed / started latches as the start gesture, so it never fires mid-seed-entry or after the run has
    // already started. Settings BACK/ESC routes back to 'Title', which re-reads loadSettings() on re-entry, so a
    // difficulty/locale change made over there shows here (D3/AC3/AC4). A nav blip on the gesture (a no-op under NoAudio).
    this.input.keyboard!.on('keydown-O', () => {
      if (editingSeed || started) return // suppressed mid-seed-entry / after start — no navigation.
      sfx.uiSelect()
      this.scene.start('Settings')
    })

    // ── F-construction-mode (construction-mode §5.4, D6, AC1) — `T` opens the Construction (level editor) scene, a
    // sibling route like Settings. Guarded by the SAME editingSeed / started latches as the `O` / start handlers
    // (DRY), so it never fires mid-seed-entry or after a run has already started. No change to the difficulty/seed/
    // start flow — Construction is reached independently, and the editor's PLAY (not the Title) sets playCustom. ──
    this.input.keyboard!.on('keydown-T', () => {
      if (editingSeed || started) return // suppressed mid-seed-entry / after start — no navigation.
      sfx.uiSelect()
      this.scene.start('Construction')
    })
  }
}

import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT, VOLUME_STEP } from '../config/constants.js'
import { t, setLocale } from '../i18n/index.js'
import type { Locale } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'
import { loadSettings, saveSettings } from '../util/settings.js'
import type { Settings } from '../util/settings.js'
import type { Difficulty } from '../config/stages.js'

// ── SettingsScene (F-settings §5.4, D5, AC2/AC3/AC4/AC5/AC6) ──
// The dedicated options menu reachable from the Title (`O`). A full-screen SIBLING scene (not a modal — D5),
// reusing the Title's centered-layout discipline: every Y derives from the FIXED DESIGN_WIDTH/DESIGN_HEIGHT so it
// stays centered under Scale.FIT. It owns the persisted player PREFERENCES that are NOT the run economy — the
// master volume, the default difficulty (the SAME shared `settings.difficulty` the Title chooser edits — D3), and
// the active locale — all through util/settings.ts (over save.ts's defensive get/set — never throws).
//
// A cursor index selects a row; ↑/↓ move it, ←/→ edit the focused row's value, ENTER on BACK (or ESC anywhere)
// returns to the Title. ONE render path (renderRows) re-tints the cursor + re-texts the values (the Title chooser
// pattern — DRY in spirit). Edits APPLY LIVE: a volume change sets `this.sound.volume` so the very next nav blip
// plays at the new level (instant feedback — AC2); a language change calls setLocale() then RE-RENDERS every label
// so the toggle is visibly runtime (AC3). Each change saveSettings()s the whole blob + plays the uiMove tick (a
// no-op under NoAudio). A `Sound` instance gives the nav/confirm blips (the Title's precedent). NO music.
//
// The three editable rows, in order. BACK is rendered separately (it has no editable value). The cursor walks
// [VOLUME, DIFFICULTY, LANGUAGE, BACK] — ROW_COUNT below covers all four.
type RowId = 'volume' | 'difficulty' | 'language'
const ROWS: readonly RowId[] = ['volume', 'difficulty', 'language']
const ROW_COUNT = ROWS.length + 1 // + the BACK row (the last cursor slot).
const BACK_INDEX = ROWS.length // the cursor index of the BACK row.

// The three difficulty levels — the SAME order/labels the Title chooser cycles (DRY — the values reuse the
// existing `title.diff.*` chrome, no new strings). The two locales the LANGUAGE row toggles between.
const LEVELS: readonly Difficulty[] = ['easy', 'normal', 'hard']
const LANG_LOCALES: readonly Locale[] = ['en', 'zh-CN']

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export class SettingsScene extends Phaser.Scene {
  // The live preference mirror — loaded ONCE in create() (the impure save boundary, like the Title), mutated by the
  // edits, and saveSettings()d on every change. The Title re-reads loadSettings() on re-entry, so the two views
  // never disagree (D3/AC4 — one source of truth, no duplicated state).
  private settings!: Settings
  private cursor = 0 // the focused row index (walks [VOLUME, DIFFICULTY, LANGUAGE, BACK]).
  private sfx!: Sound

  // The captured label + value Text objects, re-textured/tinted by renderRows() (no scene rebuild). The label
  // texts are kept too because a LANGUAGE toggle must re-text EVERY label live (so the whole screen flips locale).
  private titleText!: Phaser.GameObjects.Text
  private hintText!: Phaser.GameObjects.Text
  private labelTexts: Phaser.GameObjects.Text[] = []
  private valueTexts: Phaser.GameObjects.Text[] = []
  private backText!: Phaser.GameObjects.Text

  constructor() {
    super('Settings')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2

    // Reset per-entry state (a scene instance is reused across start()s — clear the captured-text arrays so a
    // re-entry doesn't append to a stale list). The cursor starts on the first row each time.
    this.cursor = 0
    this.labelTexts = []
    this.valueTexts = []

    // The menu-blip façade (the Title precedent; a no-op under NoAudio — AC6). Live-volume edits set
    // `this.sound.volume` so the NEXT blip is audible at the new level (instant feedback — AC2).
    this.sfx = new Sound(this)

    // Read the persisted preference ONCE (the impure boundary). loadSettings() back-fills + clamps, so a fresh/
    // corrupt save degrades to the defaults — never throws (it inherits save.ts's try/catch).
    this.settings = loadSettings()

    // ── Heading near the top (off the FIXED design resolution so it centers under Scale.FIT — the Title's discipline). ──
    this.titleText = this.add
      .text(cx, 140, t('settings.title'), { fontFamily: UI_FONT, fontSize: '64px', color: '#e6edf3', fontStyle: 'bold' })
      .setOrigin(0.5)

    // ── The editable rows: a label column (left-anchored, fixed x — CJK-safe) + a value column (fixed x), one per
    // row. Fixed-x columns (never derived from a label's pixel width — the CJK alignment discipline). Captured so a
    // key change re-texts the value in place + a language toggle re-texts every label. ──
    const ROW_Y0 = 280
    const ROW_H = 52
    const LABEL_X = cx - 200 // the label column's left x.
    const VALUE_X = cx + 40 // the value column's left x (fixed — never derived from the label width).
    for (let i = 0; i < ROWS.length; i++) {
      const y = ROW_Y0 + i * ROW_H
      this.labelTexts.push(
        this.add
          .text(LABEL_X, y, '', { fontFamily: UI_FONT, fontSize: '26px', color: '#8b949e' })
          .setOrigin(0, 0.5),
      )
      this.valueTexts.push(
        this.add
          .text(VALUE_X, y, '', { fontFamily: UI_FONT, fontSize: '26px', color: '#c9d1d9' })
          .setOrigin(0, 0.5),
      )
    }

    // ── The BACK row (its own slot, no editable value) — centered just below the editable rows. ──
    this.backText = this.add
      .text(cx, ROW_Y0 + ROWS.length * ROW_H + 8, '', { fontFamily: UI_FONT, fontSize: '26px', color: '#c9d1d9' })
      .setOrigin(0.5)

    // ── The one-line key hint near the bottom. ──
    this.hintText = this.add
      .text(cx, DESIGN_HEIGHT - 80, '', { fontFamily: UI_FONT, fontSize: '18px', color: '#5c6b7a' })
      .setOrigin(0.5)

    this.renderRows()

    // ↑/↓ move the cursor (wrapping over the four slots); ←/→ edit the focused row; ENTER confirms (BACK → Title,
    // else a no-op edit on the value rows — there is nothing to "enter" on a value row); ESC always returns.
    this.input.keyboard!.on('keydown-UP', () => this.moveCursor(-1))
    this.input.keyboard!.on('keydown-DOWN', () => this.moveCursor(1))
    this.input.keyboard!.on('keydown-LEFT', () => this.editRow(-1))
    this.input.keyboard!.on('keydown-RIGHT', () => this.editRow(1))
    this.input.keyboard!.on('keydown-ENTER', () => this.confirm())
    this.input.keyboard!.on('keydown-ESC', () => this.toTitle())
  }

  // ── moveCursor(dir) ── walk the cursor over the four slots (wrapping); re-render the highlight + blip on a change.
  private moveCursor(dir: number): void {
    this.cursor = (this.cursor + dir + ROW_COUNT) % ROW_COUNT
    this.renderRows()
    this.sfx.uiMove()
  }

  // ── editRow(dir) ── apply a ←/→ edit to the FOCUSED row's value. BACK has no editable value (a no-op). Each edit
  // persists (saveSettings) + applies live (volume/locale) + re-renders + blips. The blip plays at the NEW volume
  // (this.sound.volume was just set) — instant feedback (AC2).
  private editRow(dir: number): void {
    if (this.cursor === BACK_INDEX) return // BACK isn't a value row.
    const row = ROWS[this.cursor]
    if (row === 'volume') {
      // Nudge by VOLUME_STEP, clamped to [0,1] (the valid Phaser-volume bounds — D6). No-op + no save at a bound.
      const next = clamp(this.settings.volume + dir * VOLUME_STEP, 0, 1)
      if (Math.abs(next - this.settings.volume) < 1e-9) return // already at a bound — no save / blip churn.
      this.settings.volume = next
      this.sound.volume = next // LIVE — the next blip plays at the new level (AC2); audio/Sound.ts reads this global (D2).
    } else if (row === 'difficulty') {
      // Cycle the three levels (the SAME shared settings.difficulty the Title edits — D3/AC4). Wrapping.
      const idx = LEVELS.indexOf(this.settings.difficulty)
      this.settings.difficulty = LEVELS[(idx + dir + LEVELS.length) % LEVELS.length]
    } else {
      // Toggle the two locales; APPLY it live via setLocale() (so renderRows below re-texts the whole screen in the
      // new locale — the runtime switch, AC3). Wrapping (two values, so ±1 just flips).
      const idx = LANG_LOCALES.indexOf(this.settings.locale)
      this.settings.locale = LANG_LOCALES[(idx + dir + LANG_LOCALES.length) % LANG_LOCALES.length]
      setLocale(this.settings.locale)
    }
    saveSettings(this.settings) // persist the whole blob (the Title's per-change save pattern — DRY).
    this.renderRows()
    this.sfx.uiMove()
  }

  // ── confirm() ── ENTER. On BACK → the Title; on a value row ENTER does nothing (the value rows edit with ←/→).
  private confirm(): void {
    if (this.cursor === BACK_INDEX) this.toTitle()
  }

  // ── toTitle() ── return to the Title (which re-reads loadSettings() on entry, so it renders in the chosen locale
  // + shows the chosen difficulty — AC3/AC4). A confirm blip (a no-op under NoAudio — AC6).
  private toTitle(): void {
    this.sfx.uiSelect()
    this.scene.start('Title')
  }

  // ── renderRows() — the ONE render path (the Title chooser pattern — DRY) ── re-text EVERY label (so a LANGUAGE
  // toggle flips the whole screen live — AC3), re-text each value from the current settings, and re-tint the
  // cursor (the focused row bright, the rest dim). Called once in create() + after every nav/edit.
  private renderRows(): void {
    // Re-text the locale-dependent chrome (heading + hint) so a language toggle flips them too (AC3).
    this.titleText.setText(t('settings.title'))
    this.hintText.setText(t('settings.hint'))

    for (let i = 0; i < ROWS.length; i++) {
      const focused = this.cursor === i
      const row = ROWS[i]
      // The label (localised key per row).
      this.labelTexts[i].setText(t(`settings.${row}`)).setColor(focused ? '#58d68d' : '#8b949e')
      // The value (per row): volume → a percent; difficulty → the reused title.diff.* label; language → the lang name.
      let value: string
      if (row === 'volume') {
        value = t('settings.volumeValue', { pct: Math.round(this.settings.volume * 100) })
      } else if (row === 'difficulty') {
        value = t(`title.diff.${this.settings.difficulty}`)
      } else {
        value = t(this.settings.locale === 'en' ? 'settings.lang.en' : 'settings.lang.zh')
      }
      this.valueTexts[i].setText(value).setColor(focused ? '#58d68d' : '#c9d1d9')
    }

    // The BACK row (centered; bright when focused).
    const backFocused = this.cursor === BACK_INDEX
    this.backText.setText(t('settings.back')).setColor(backFocused ? '#58d68d' : '#c9d1d9')
  }
}

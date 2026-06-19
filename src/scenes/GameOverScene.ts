import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'

// ── GameOverScene (F0 scaffold §5.3 → F5 §5.4, Decision 2/4/D8/D12, AC5/AC7/AC9) ──
// The run-end screen. Tank 1990 is ENDLESS (Decision 2 — there is NO Victory scene): a run ends ONLY
// when the eagle is destroyed OR all lives are spent, and GameScene hands off here. F5 (D8/AC5): this
// scene is DECOUPLED (SOLID, the reference's HUD/registry split) — it reads a run-summary SNAPSHOT from
// scene-start DATA and NEVER reaches into the live GameScene. It DISPLAYS the summary (score / stage
// reached / CURRENCY BANKED / best score / best stage) with primitives + t('...'), then routes to the HUB
// on a key/click so banked currency is immediately spendable (the loop closes — AC7). It does NOT itself
// save — banking is GameScene's job (the single writer under the gameOver guard, D8); this scene only shows.

// The run-summary snapshot GameScene passes as scene-start DATA (D8/AC5). Safe defaults so the scene is
// navigable even if launched bare (e.g. a dev tool / a direct scene.start) — it never reads a missing field.
interface RunSummary {
  score: number
  stage: number // the human stage number reached (stageIndex + 1).
  currencyBanked: number // floor(score · CURRENCY_RATIO) — the amount added to the shared bank this run.
  bestScore: number // the freshly-bumped best (GameScene read it from MetaState after bankRun).
  bestStage: number
  highScores: { score: number; stage: number }[] // the top-5 table (GameScene read it AFTER bankRun, so it INCLUDES this run — D4).
}
const DEFAULT_SUMMARY: RunSummary = { score: 0, stage: 0, currencyBanked: 0, bestScore: 0, bestStage: 0, highScores: [] }

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver')
  }

  // Phaser passes scene-start DATA to create(); fall back to the safe defaults if absent (D8/AC5).
  create(data: Partial<RunSummary>): void {
    const summary: RunSummary = { ...DEFAULT_SUMMARY, ...(data || {}) }
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // The menu-blip façade (the TitleScene precedent; a no-op under NoAudio — AC6). Only the continue gesture
    // uses it, so a local is fine (D6 — the scene owns audio). The run-end knell already played in GameScene
    // ~700 ms ago under the freeze beat (its dramatic home), so this screen adds ONLY a continue blip (Decision 3).
    const sfx = new Sound(this)

    // ── Header: red "GAME OVER" (the endless game has no win state — Decision 2). ── Anchored at cy-210
    // (the 72px heading's top), so the summary block below (blockTop = cy-110) clears it with a real gap —
    // they previously shared cy-150 and overlapped (the heading sat on top of the first stat line).
    this.add
      .text(cx, cy - 210, t('over.heading'), {
        fontFamily: UI_FONT,
        fontSize: '72px',
        color: '#e5484d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    // ── Summary block (AC5) — score / stage reached / CURRENCY BANKED / best score / best stage. One centered
    // line per stat (primitives + t('...') only — AC11). The {n} interpolation fills the localised template. ──
    const lines = [
      t('over.score', { n: summary.score }),
      t('over.stage', { n: summary.stage }),
      t('over.banked', { n: summary.currencyBanked }),
      t('over.bestScore', { n: summary.bestScore }),
      t('over.bestStage', { n: summary.bestStage }),
    ]
    const rowH = 40
    // Start the stats stack 100px below the heading anchor (cy-210), i.e. ~51px clear below the heading's
    // bottom edge. hiTop derives from this (blockTop + lines·rowH + 28); at the max 5-row high-score table the
    // last row lands ~30px above the continue prompt (DESIGN_HEIGHT-56) — collision-free at worst-case content.
    const blockTop = cy - 110
    lines.forEach((line, i) => {
      // The CURRENCY BANKED line (index 2) is highlighted (cyan) — it's the meta payoff the run earned.
      const color = i === 2 ? '#4dd0e1' : '#e6edf3'
      this.add
        .text(cx, blockTop + i * rowH, line, { fontFamily: UI_FONT, fontSize: '26px', color })
        .setOrigin(0.5)
    })

    // ── High-score table (the persistent top-5 — D4/AC4) ── rendered from the scene-start DATA `highScores`
    // (GameScene read it AFTER bankRun, so it ALREADY includes this run — the scene stays decoupled, it never
    // reads MetaState). The row whose (score, stage) matches THIS run is highlighted gold (the just-finished
    // run); the rest are normal text. The FIRST match is highlighted (a tie highlights one row). Empty DATA →
    // the empty-state line (the safe-defaults discipline — never crashes). All Y off the FIXED design resolution.
    const hiTop = blockTop + lines.length * rowH + 28
    this.add
      .text(cx, hiTop, t('hi.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#8b949e', fontStyle: 'bold' })
      .setOrigin(0.5)
    if (summary.highScores.length === 0) {
      this.add
        .text(cx, hiTop + 34, t('hi.empty'), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0.5)
    } else {
      const hiRowH = 26
      let highlighted = false // highlight only the FIRST row matching this run (a tie highlights one).
      for (let i = 0; i < summary.highScores.length; i++) {
        const { score, stage } = summary.highScores[i]
        const isRun = !highlighted && score === summary.score && stage === summary.stage
        if (isRun) highlighted = true
        this.add
          .text(cx, hiTop + 32 + i * hiRowH, t('hi.row', { rank: i + 1, score, stage }), {
            fontFamily: UI_FONT,
            fontSize: '18px',
            color: isRun ? '#feca57' : '#c9d1d9', // gold = the just-finished run.
          })
          .setOrigin(0.5)
      }
    }

    this.add
      .text(cx, DESIGN_HEIGHT - 56, t('over.continue'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // GameOver → HUB (D8/AC7) so banked currency is immediately spendable — the loop closes. `once` so a held
    // key can't double-fire. 'Hub' is a registered scene (main.ts), so the transition is reachable.
    const toHub = () => {
      sfx.uiSelect() // the continue blip on the key/click to the Hub (a no-op under NoAudio — AC6).
      this.scene.start('Hub')
    }
    this.input.keyboard!.once('keydown-SPACE', toHub)
    this.input.keyboard!.once('keydown-ENTER', toHub)
    this.input.once('pointerdown', toHub)
  }
}

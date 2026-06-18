import Phaser from 'phaser'
import { UI_FONT, HUD_PANEL_X, PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H, TWO_PLAYER } from '../config/constants.js'
import { t } from '../i18n/index.js'

// ── HUDScene (F0 scaffold §5.3 → F5 §5.4, Decision 4/D-decoupled/D12, AC8/AC9) ──
// Runs in PARALLEL over GameScene (launched, not started). It is DECOUPLED from gameplay (SOLID, the
// reference's HUD/registry split): it reads the live state from the scene REGISTRY (which GameScene writes
// each frame via _publishHud) and NEVER touches the world directly. F5 wires the full overlay (AC8): per-player
// lives (P1 + P2; the P2 line hidden in 1P), enemies-remaining, the stage number, the score, the shared
// currency, and the active power-up + its remaining seconds (freeze/shovel/shield). All chrome via t('...')
// (AC9); positioned in the right-side HUD-panel band (HUD_PANEL_X — the F0 layout owner). GameScene owns this
// scene's lifecycle (launch on create, stop on run end). Programmer-art primitives only (AC11).

const LINE_H = 34 // px — vertical spacing between HUD readout lines.

export class HUDScene extends Phaser.Scene {
  // One fixed Text per readout line (created once in create(), updated in place each frame — DRY, no per-frame
  // GameObject churn). The P2-lives line is created but hidden in 1P (TWO_PLAYER false — AC8).
  private stageLabel!: Phaser.GameObjects.Text
  private scoreLabel!: Phaser.GameObjects.Text
  private currencyLabel!: Phaser.GameObjects.Text
  private enemiesLabel!: Phaser.GameObjects.Text
  private p1LivesLabel!: Phaser.GameObjects.Text
  private p2LivesLabel!: Phaser.GameObjects.Text
  private powerLabel!: Phaser.GameObjects.Text // the active power-up + its seconds (empty when nothing active).
  // F6 (D5/D8, AC3/AC6): the STAGE-N-CLEARED banner (a centered, large, timed text overlay over the playfield —
  // read from the registry; blank when no banner active) + the MUTED cue (shown in the panel while audio is muted).
  private bannerLabel!: Phaser.GameObjects.Text
  private mutedLabel!: Phaser.GameObjects.Text

  constructor() {
    super('HUD')
  }

  create(): void {
    // Build the readout column in the right-side HUD-panel band (HUD_PANEL_X — the single layout owner, DRY).
    // Each line is a fixed Text; update() fills it from the registry each frame. The order reads top→bottom:
    // STAGE · SCORE · CURRENCY · ENEMIES · (a gap) · P1 LIVES · P2 LIVES · (a gap) · the active power-up.
    const x = HUD_PANEL_X
    let y = PLAYFIELD_Y
    const make = (color: string, size = '20px') => {
      const txt = this.add.text(x, y, '', { fontFamily: UI_FONT, fontSize: size, color })
      y += LINE_H
      return txt
    }

    this.stageLabel = make('#8b949e')
    this.scoreLabel = make('#e6edf3')
    this.currencyLabel = make('#4dd0e1') // cyan — the shared meta bank (matches the GameOver banked line).
    this.enemiesLabel = make('#f0932b') // orange — enemies left to clear (the pressure readout).
    y += LINE_H / 2 // a small gap before the lives block.
    this.p1LivesLabel = make('#58d68d') // green — P1 lives.
    this.p2LivesLabel = make('#58d68d') // green — P2 lives (hidden in 1P).
    this.p2LivesLabel.setVisible(TWO_PLAYER) // AC8 — the P2 line is hidden in a 1-player session.
    y += LINE_H / 2 // a small gap before the active-power-up line.
    this.powerLabel = make('#feca57', '18px') // gold — the active power-up + its remaining seconds (or empty).

    // F6 (D8, AC6) — the MUTED cue, in the panel band below the power line (shown only while audio is muted).
    this.mutedLabel = make('#ff7675', '18px') // soft red — the "MUTED" indicator (or empty).

    // F6 (D5, AC3) — the STAGE-N-CLEARED banner: a large CENTERED timed text overlay over the playfield (NOT in
    // the side panel — it is the stage-clear celebration). Positioned at the playfield CENTER off the FIXED design
    // resolution (PLAYFIELD_X/Y/W/H — the single layout owners), depth above the readouts. Blank until a clear.
    this.bannerLabel = this.add
      .text(PLAYFIELD_X + PLAYFIELD_W / 2, PLAYFIELD_Y + PLAYFIELD_H / 2, '', {
        fontFamily: UI_FONT,
        fontSize: '40px',
        color: '#feca57',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10)

    // Prime the readouts so the panel reads sanely before GameScene's first registry write (defensive).
    this._render()
  }

  update(): void {
    this._render()
  }

  // ── _render() (D-decoupled/AC8) ── pull every readout from the scene REGISTRY (the SAME registry GameScene
  // writes — this.registry === GameScene's registry) and fill the fixed Text lines. NEVER reaches into the world
  // (no scene.get('Game') — pure registry read, the reference's decoupling). Defaults keep it sane before the
  // first GameScene write. The active power-up: a null kind → the line is blank (hidden); a timed kind →
  // t('hud.power', {name, secs}) with the localised kind name (t('power.<kind>')). KISS — one read per line.
  private _render(): void {
    const r = this.registry
    this.stageLabel.setText(t('hud.stage', { n: r.get('hud.stage') ?? 1 }))
    this.scoreLabel.setText(t('hud.score', { n: r.get('hud.score') ?? 0 }))
    this.currencyLabel.setText(t('hud.currency', { n: r.get('hud.currency') ?? 0 }))
    this.enemiesLabel.setText(t('hud.enemies', { n: r.get('hud.enemies') ?? 0 }))
    this.p1LivesLabel.setText(t('hud.p1Lives', { n: r.get('hud.p1Lives') ?? 0 }))

    // P2 lives: -1 from GameScene means "no P2" (1P) → keep the line hidden; else show it (co-op — AC8).
    const p2Lives = r.get('hud.p2Lives') ?? -1
    if (TWO_PLAYER && p2Lives >= 0) {
      this.p2LivesLabel.setVisible(true).setText(t('hud.p2Lives', { n: p2Lives }))
    } else {
      this.p2LivesLabel.setVisible(false)
    }

    // The active power-up + its remaining seconds (AC8). A null kind → blank the line (nothing active). The kind
    // name is localised through t('power.<kind>'); a timed kind shows its seconds, an instant kind (never set
    // active here — only freeze/shovel/shield are timed) would show just the name (the powerInstant template).
    const kind = r.get('hud.powerKind') as string | null
    if (kind) {
      const name = t(`power.${kind}`)
      const secs = r.get('hud.powerSecs') ?? 0
      this.powerLabel.setText(secs > 0 ? t('hud.power', { name, secs }) : t('hud.powerInstant', { name }))
    } else {
      this.powerLabel.setText('')
    }

    // F6 (D5, AC3) — the STAGE-N-CLEARED banner: GameScene publishes the localised "STAGE N CLEARED" string to
    // `hud.banner` while its timer is live (and '' otherwise), so the HUD just mirrors it (the registry-decoupled
    // pattern — like the active-power-up line; the HUD owns HOW it renders, GameScene owns WHEN). No new scene.
    const banner = (r.get('hud.banner') as string | undefined) ?? ''
    this.bannerLabel.setText(banner)

    // F6 (D8, AC6) — the MUTED cue: shown only while audio is muted (the M toggle flips Phaser's global mute, and
    // GameScene publishes `hud.muted` = sound.mute). KISS — one boolean read, one label.
    this.mutedLabel.setText(r.get('hud.muted') ? t('hud.muted') : '')
  }
}

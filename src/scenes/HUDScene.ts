import Phaser from 'phaser'
import { UI_FONT, HUD_PANEL_X, HUD_PANEL_WIDTH, PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H, TWO_PLAYER } from '../config/constants.js'
import { TOTAL_ENEMIES_MAX } from '../config/stages.js'
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
// F7 (D6/AC7) — the power-up TIMER BAR geometry (a track rect + a draining fill rect under the power-up line).
const BAR_W = HUD_PANEL_WIDTH - 16 // px — the bar track width (fits the side panel band with a small inset).
const BAR_H = 8 // px — the bar height.
const BAR_TRACK_COLOR = 0x30363d // the dark track behind the fill (the panel-outline grey — programmer-art).
const BAR_FILL_COLOR = 0xfeca57 // gold — matches the power-up text line.

// ── The enemy-QUEUE icon grid (D1/D2, AC1) — the classic Battle City side-panel column of little tank icons,
// one per enemy STILL TO CLEAR this stage. A FIXED pool of small Rectangle pips built once + flipped visible
// in place each frame from the registry `hud.enemies` value (the SAME number the text readout shows — DRY, no
// world reach). One uniform icon shape/colour (D2 — per-type icons would couple the HUD to the unspawned
// roster; YAGNI). QUEUE_MAX is the deepest stage's enemy ceiling so the grid never runs short of the live count.
const QUEUE_MAX = TOTAL_ENEMIES_MAX // pool size — sized to the deepest stage's totalEnemies (never runs short).
const QUEUE_COLS = 8 // icons per row (8 × 5 rows = 40 = QUEUE_MAX; fits the side-panel band).
const QUEUE_ICON = 12 // px — one icon pip (a small programmer-art tank square).
const QUEUE_GAP = 4 // px — spacing between icons (so a full grid stays inside HUD_PANEL_WIDTH).
const QUEUE_COLOR = 0xf0932b // orange — matches the enemies-left readout (the pressure cue).

// (stage-bonus §5.4, D5, AC2) — the between-stage bonus-tally PANEL geometry (a framed rect behind the centered
// multi-line tally Text). Sized to sit comfortably inside the playfield with margin for ~7 lines; a coupled-scene
// layout tunable (not a shared pure number), so it lives here, not in constants.ts (the SAME "local detail" rule).
const TALLY_PANEL_W = 360 // px — the bonus-panel width (fits the longest localised row with margin).
const TALLY_PANEL_H = 300 // px — the bonus-panel height (title + up to five type rows + bonus + total, with margin).

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
  // F7 (D6/AC7): the power-up TIMER BAR — a track rect + a draining fill rect under the power-up text line (both
  // hidden when no power-up is active). The fill width = BAR_W · clamp(powerSecs / powerMaxSecs, 0, 1). Plus the
  // panel HEADER + a DIVIDER rule for a cleaner read. ALL registry-decoupled (read the existing hud.* values).
  private powerBarTrack!: Phaser.GameObjects.Rectangle
  private powerBarFill!: Phaser.GameObjects.Rectangle
  // F6 (D5/D8, AC3/AC6): the STAGE-N-CLEARED banner (a centered, large, timed text overlay over the playfield —
  // read from the registry; blank when no banner active) + the MUTED cue (shown in the panel while audio is muted).
  private bannerLabel!: Phaser.GameObjects.Text
  private mutedLabel!: Phaser.GameObjects.Text
  // (D1/D2, AC1): the enemy-QUEUE icon grid — a fixed pool of small Rectangle pips (built once), the visible
  // count set in place each frame from `hud.enemies` (the decoupled registry read — never the world).
  private queueIcons: Phaser.GameObjects.Rectangle[] = []
  // (D3/D5, AC2): the centered STAGE-N intro-curtain label — GameScene publishes the localised "STAGE N" to
  // `hud.stageIntro` while the curtain is up ('' otherwise), so the HUD just mirrors it (the SAME registry-
  // decoupled pattern as the STAGE-N-CLEARED banner above — GameScene owns WHEN, the HUD owns HOW).
  private introLabel!: Phaser.GameObjects.Text
  // (extra-life §5.4, D5, AC5): the centered 1UP "EXTRA LIFE" cue — GameScene publishes the localised string to
  // `hud.oneUp` while its timer is live ('' otherwise), so the HUD just mirrors it (the SAME registry-decoupled
  // pattern as the clear/intro banner — GameScene owns WHEN, the HUD owns HOW). A distinct GOLD celebratory tint
  // + its OWN geometry/depth, placed CLEAR of the clear/intro banner (offset below center) so a same-frame
  // overlap stays legible. Blank otherwise (never a stray render).
  private oneUpLabel!: Phaser.GameObjects.Text
  // (stage-bonus §5.4, D5, AC2): the between-stage bonus tally — GameScene publishes the FULLY-FORMATTED multi-line
  // block to `hud.tally` while the window is up ('' otherwise), so the HUD just mirrors it into one centered Text on
  // a framed programmer-art panel (the SAME registry-decoupled idiom as the clear/intro banner — GameScene owns WHEN
  // + the formatting, the HUD owns layout). Its OWN key + geometry/depth so it never clobbers the other banners.
  private tallyPanel!: Phaser.GameObjects.Rectangle
  private tallyLabel!: Phaser.GameObjects.Text

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

    // F7 (D6/AC7) — a panel HEADER + a divider rule under it for a cleaner read (the reference's panel chrome).
    // The header is a static label (the game name, programmer-art bold); the divider is a thin rectangle. Both
    // are presentation only (no registry read). They sit ABOVE the readout column.
    this.add.text(x, y, t('title.heading'), { fontFamily: UI_FONT, fontSize: '22px', color: '#e6edf3', fontStyle: 'bold' })
    y += LINE_H
    this.add.rectangle(x, y - 6, BAR_W, 2, BAR_TRACK_COLOR).setOrigin(0, 0.5) // the header divider rule.
    y += LINE_H / 2

    this.stageLabel = make('#8b949e')
    this.scoreLabel = make('#e6edf3')
    this.currencyLabel = make('#4dd0e1') // cyan — the shared meta bank (matches the GameOver banked line).
    this.enemiesLabel = make('#f0932b') // orange — enemies left to clear (the pressure readout).
    // F7 (D6/AC7) — a divider rule before the lives block (a cleaner panel split).
    this.add.rectangle(x, y, BAR_W, 2, BAR_TRACK_COLOR).setOrigin(0, 0.5)
    y += LINE_H / 2 // a small gap before the lives block.
    this.p1LivesLabel = make('#58d68d') // green — P1 lives.
    this.p2LivesLabel = make('#58d68d') // green — P2 lives (hidden in 1P).
    this.p2LivesLabel.setVisible(TWO_PLAYER) // AC8 — the P2 line is hidden in a 1-player session.
    y += LINE_H / 2 // a small gap before the active-power-up line.
    this.powerLabel = make('#feca57', '18px') // gold — the active power-up + its remaining seconds (or empty).

    // F7 (D6/AC7) — the power-up TIMER BAR: a dark track + a gold draining fill, created once UNDER the power
    // line (both hidden until a timed power-up is active). Origin top-LEFT so the fill drains from the left edge
    // (its width is resized each frame in _render). Programmer-art rectangles (AC11).
    this.powerBarTrack = this.add.rectangle(x, y, BAR_W, BAR_H, BAR_TRACK_COLOR).setOrigin(0, 0).setVisible(false)
    this.powerBarFill = this.add.rectangle(x, y, BAR_W, BAR_H, BAR_FILL_COLOR).setOrigin(0, 0).setVisible(false)
    y += LINE_H / 2 + BAR_H // advance past the bar so the MUTED cue sits below it.

    // F6 (D8, AC6) — the MUTED cue, in the panel band below the power line (shown only while audio is muted).
    this.mutedLabel = make('#ff7675', '18px') // soft red — the "MUTED" indicator (or empty).

    // (D1/D2, AC1) — the enemy-QUEUE icon grid: a FIXED pool of QUEUE_MAX small Rectangle pips laid out left→
    // right, top→bottom in a grid anchored at HUD_PANEL_X, advancing `y` so it sits inside the panel band below
    // the readout column. All start HIDDEN — _render() flips the first `hud.enemies` of them visible each frame
    // (DRY — the same value the text readout shows). Programmer-art rectangles (AC11); origin top-LEFT for the grid.
    y += LINE_H / 2 // a small gap before the queue grid.
    for (let i = 0; i < QUEUE_MAX; i++) {
      const col = i % QUEUE_COLS
      const row = Math.floor(i / QUEUE_COLS)
      const ix = x + col * (QUEUE_ICON + QUEUE_GAP)
      const iy = y + row * (QUEUE_ICON + QUEUE_GAP)
      this.queueIcons.push(this.add.rectangle(ix, iy, QUEUE_ICON, QUEUE_ICON, QUEUE_COLOR).setOrigin(0, 0).setVisible(false))
    }

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

    // (D3/D5, AC2) — the STAGE-N intro-curtain label: a large CENTERED text overlay over the playfield, shown
    // before each stage begins. SAME geometry/depth as the banner; a neutral panel-grey (distinct from the gold
    // clear banner) so the intro reads as an opening beat, not a celebration. Blank until GameScene arms a curtain.
    this.introLabel = this.add
      .text(PLAYFIELD_X + PLAYFIELD_W / 2, PLAYFIELD_Y + PLAYFIELD_H / 2, '', {
        fontFamily: UI_FONT,
        fontSize: '40px',
        color: '#e6edf3',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10)

    // (extra-life §5.4, D5, AC5) — the centered 1UP "EXTRA LIFE" cue: a CENTERED timed text overlay over the
    // playfield, mirrored from `hud.oneUp`. A distinct GOLD celebratory tint (the 1UP juice); placed BELOW the
    // playfield center (offset by ~1/5 the height) so it sits CLEAR of the clear/intro banner (which centers) and
    // a same-frame overlap stays legible. Its own depth (above the readouts). Blank until GameScene arms a crossing.
    this.oneUpLabel = this.add
      .text(PLAYFIELD_X + PLAYFIELD_W / 2, PLAYFIELD_Y + PLAYFIELD_H * 0.7, '', {
        fontFamily: UI_FONT,
        fontSize: '36px',
        color: '#ffd700', // gold — the celebratory 1UP tint (distinct from the gold clear banner's geometry).
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10)

    // (stage-bonus §5.4, D5, AC2) — the between-stage bonus tally: a framed programmer-art PANEL + a centered
    // multi-line Text mirrored from `hud.tally`. Centered over the playfield off the FIXED design resolution
    // (PLAYFIELD_X/Y/W/H — the single layout owners), a HIGHER depth than the banners so the tally reads on top of
    // the just-armed clear banner. A neutral dark fill + a gold outline (distinct from the gold clear banner's plain
    // text). Both hidden until GameScene publishes a non-empty block (the SAME mirror discipline as bannerLabel).
    this.tallyPanel = this.add
      .rectangle(PLAYFIELD_X + PLAYFIELD_W / 2, PLAYFIELD_Y + PLAYFIELD_H / 2, TALLY_PANEL_W, TALLY_PANEL_H, 0x0d1117, 0.92)
      .setStrokeStyle(2, 0xfeca57)
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false)
    this.tallyLabel = this.add
      .text(PLAYFIELD_X + PLAYFIELD_W / 2, PLAYFIELD_Y + PLAYFIELD_H / 2, '', {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#e6edf3',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false)

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

    // F7 (D6/AC7) — the power-up TIMER BAR. While a TIMED power-up is active (a kind set + a positive full
    // duration), show the track + the draining fill (width ∝ powerSecs / powerMaxSecs, clamped 0..1); hide both
    // otherwise. ALL registry reads (decoupled — no reach into the world). The denominator is the FULL duration
    // GameScene published (hud.powerMaxSecs). Resize via setSize (no per-frame geometry churn beyond the width).
    const maxSecs = (r.get('hud.powerMaxSecs') as number | undefined) ?? 0
    const secs = (r.get('hud.powerSecs') as number | undefined) ?? 0
    if (kind && maxSecs > 0) {
      const frac = Phaser.Math.Clamp(secs / maxSecs, 0, 1)
      this.powerBarTrack.setVisible(true)
      this.powerBarFill.setVisible(true).setSize(Math.max(0, BAR_W * frac), BAR_H)
    } else {
      this.powerBarTrack.setVisible(false)
      this.powerBarFill.setVisible(false)
    }

    // F6 (D5, AC3) — the STAGE-N-CLEARED banner: GameScene publishes the localised "STAGE N CLEARED" string to
    // `hud.banner` while its timer is live (and '' otherwise), so the HUD just mirrors it (the registry-decoupled
    // pattern — like the active-power-up line; the HUD owns HOW it renders, GameScene owns WHEN). No new scene.
    const banner = (r.get('hud.banner') as string | undefined) ?? ''
    this.bannerLabel.setText(banner)

    // (D1/D2, AC1) — the enemy-QUEUE icon grid: flip the first `hud.enemies` pips visible (clamped to the pool),
    // the rest hidden. The SAME registry value the enemiesLabel reads above (DRY) — no world reach, one loop.
    const queued = Phaser.Math.Clamp((r.get('hud.enemies') as number | undefined) ?? 0, 0, QUEUE_MAX)
    for (let i = 0; i < this.queueIcons.length; i++) this.queueIcons[i].setVisible(i < queued)

    // (D3/D5, AC2) — the STAGE-N intro curtain: GameScene publishes the localised "STAGE N" string to
    // `hud.stageIntro` while the curtain is up (and '' otherwise), so the HUD just mirrors it (the SAME
    // registry-decoupled pattern as the clear banner above — GameScene owns WHEN, the HUD owns HOW).
    this.introLabel.setText((r.get('hud.stageIntro') as string | undefined) ?? '')

    // (extra-life §5.4, D5, AC5) — the centered 1UP "EXTRA LIFE" cue: GameScene publishes the localised string to
    // `hud.oneUp` while its timer is live (and '' otherwise), so the HUD just mirrors it (the SAME registry-
    // decoupled pattern as the clear/intro banner — its OWN key so the cues never clobber one another).
    this.oneUpLabel.setText((r.get('hud.oneUp') as string | undefined) ?? '')

    // (stage-bonus §5.4, D5, AC2) — the between-stage bonus tally: GameScene publishes the FULLY-FORMATTED multi-
    // line block to `hud.tally` while its window is up ('' otherwise), so the HUD just mirrors it into the centered
    // Text + shows the framing panel only when non-empty (the SAME mirror discipline as bannerLabel — GameScene owns
    // WHEN + the formatting, the HUD owns layout). Both hidden on a blank string (never a stray render).
    const tally = (r.get('hud.tally') as string | undefined) ?? ''
    const showTally = tally.length > 0
    this.tallyLabel.setText(tally).setVisible(showTally)
    this.tallyPanel.setVisible(showTally)

    // F6 (D8, AC6) — the MUTED cue: shown only while audio is muted (the M toggle flips Phaser's global mute, and
    // GameScene publishes `hud.muted` = sound.mute). KISS — one boolean read, one label.
    this.mutedLabel.setText(r.get('hud.muted') ? t('hud.muted') : '')
  }
}

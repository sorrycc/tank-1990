import Phaser from 'phaser'

// ── Input layer (F1 Tank core §5.2/§5.3, Decisions 2/3/4, AC1/AC2/AC8) ──
// The SINGLE owner of keyboard bindings (DRY): NO scene or entity hard-codes a keycode — they read the
// per-frame snapshot this class produces. Built on Phaser's keyboard plugin (`scene.input.keyboard`) so
// the bindings live and die with the scene that created them — the SAME single-owner role the read-only
// `dead-cell` reference's core/Input.ts plays (one place maps physical keys to an intent snapshot).
//
// TWO-PLAYER (Decision 2, AC8): Tank 1990 is 2-player local co-op, so `sample()` returns ONE snapshot
// carrying BOTH players — `{ p1, p2 }`. Input does NOT read TWO_PLAYER and does NOT decide who exists; it
// just reads keys (pure, cheap — two small literals/frame, no allocation worth optimizing). The SCENE
// owns the 2-player policy: it reads TWO_PLAYER and decides whether to spawn/drive P2 (SOLID — Input has
// no game policy, exactly like the reference's Input). Returning both is YAGNI-safe.
//
// SOLE JustDown OWNER (Decision 3, AC2): each fire edge is detected via Phaser.Input.Keyboard.JustDown,
// which MUTATES the key's internal `_justDown` flag — calling it twice in a frame returns false the
// second time. Therefore THIS class is the SOLE owner of the JustDown call for the two fire keys:
// GameScene calls `sample()` EXACTLY ONCE per frame and stores the snapshot; nothing else may call
// JustDown on J / NUMPAD_ZERO / SHIFT. A held fire key thus fires once per press.

// A single player's per-frame intent (Decision 3, AC1). Four RAW held cardinal booleans (so the Tank's
// grid-snap logic can read direction priority directly) PLUS the derived dirX/dirY ∈ {−1,0,1}, PLUS a
// fire EDGE. Opposing keys on an axis CANCEL to 0 (KISS — no last-key tracking; mirrors the reference's
// `moveX` both-pressed→0). `firePressed` is a JustDown edge, sole-owned here.
export interface PlayerIntent {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  dirX: number // right − left ∈ {−1, 0, 1}
  dirY: number // down  − up   ∈ {−1, 0, 1}
  firePressed: boolean // a JustDown EDGE (sole-owned here — Decision 3/AC2).
}

// The per-frame snapshot Input.sample() returns: BOTH players, ALWAYS (Decision 2/AC8). The scene gates
// whether P2 is spawned/driven; Input itself never branches on the player count.
//
// F7 (Rich playability §5.3, D4, AC4) — the snapshot also carries a `pausePressed` EDGE: a JustDown over the
// P key OR the ESC key. P/ESC are NEITHER player's move/fire keys (D4), so adding the edge is conflict-free —
// Input still returns both players' intents. GameScene reads it to OPEN pause; the overlay binds its OWN
// keydown-P/ESC to CLOSE, and GameScene._closePause() calls consumePause() to swallow the pending edge so the
// close-press cannot re-open pause (or leak a fire) on the resume frame (the reference's consumePause race fix).
export interface InputSnapshot {
  p1: PlayerIntent
  p2: PlayerIntent
  pausePressed: boolean // F7 (D4/AC4) — a JustDown EDGE over P/ESC (sole-owned here, like the fire edges).
}

// ── TouchState (touch-controls §2, D1) — the MINIMAL pure-data seam between Input and the Phaser-coupled
// on-screen pad (entities/TouchControls). Input stays the SOLE snapshot owner: it does NOT add a second
// producer Tank reads; instead it MERGES this tiny held-cardinals + fire-edge source into p1 inside sample()
// (DRY — one intent consumer, one merge site). The shape is deliberately Phaser-free so Input never imports
// the coupled control object — it only reads four held bools + drains one fire edge. `consumeFire()` returns
// the pending tap edge and CLEARS it (the JustDown discipline — a held finger does not machine-gun, D4).
export interface TouchState {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  consumeFire(): boolean // drain the pending FIRE-tap edge (returns true once per tap, then false).
}

export class Input {
  // Named physical keys; the snapshot derives intent from these. P1 = WASD move + J fire; P2 = arrow
  // move + Numpad0 OR Shift fire (Shift is the laptop ALT — MacBooks have no numpad). NO jump/dodge/skill keys (YAGNI — Battle City has none).
  private keys: Record<string, Phaser.Input.Keyboard.Key>

  // ── touch (touch-controls §2, D1/D3) ── the OPTIONAL on-screen-pad source (P1 only — the touch use-case is a
  // single local player; P2 needs a second physical device, KISS). NULL on a non-touch device (GameScene only
  // wires it when `device.input.touch`), so sample()'s merge branch is skipped and the keyboard path stays
  // BYTE-IDENTICAL to today (no desktop interference, AC4). It is pure data to Input (the TouchState seam).
  touch: TouchState | null = null

  constructor(scene: Phaser.Scene) {
    const KC = Phaser.Input.Keyboard.KeyCodes
    // addKeys lets us name each physical key in one place (the single-owner invariant, AC1). Bindings
    // (Decision 4, AC2): fire keys must avoid BOTH movesets AND each other. P1 fire = J (left-hand
    // cluster near WASD; the reference proved J comfortable). P2 fire = NUMPAD_ZERO (right side near the
    // arrows, collides with nothing — WASD / arrows / J), avoiding the sticky-keys '/'+RShift trap. PLUS a
    // laptop-friendly ALT — p2FireAlt = SHIFT (MacBooks have no numpad). Phaser KeyCodes has NO RIGHT_SHIFT
    // (SHIFT is keyCode 16 for BOTH), so EITHER Shift fires P2 — harmless since P1 never uses Shift. The 5×Shift
    // OS sticky-keys prompt is the known trade-off of choosing Shift (the very thing the numpad pick avoided).
    this.keys = scene.input.keyboard!.addKeys({
      // P1 — WASD move + J fire.
      p1Up: KC.W,
      p1Down: KC.S,
      p1Left: KC.A,
      p1Right: KC.D,
      p1Fire: KC.J,
      // P2 — arrow move + Numpad0 fire, with SHIFT as a laptop ALT (dual-bind — MacBooks have no numpad).
      p2Up: KC.UP,
      p2Down: KC.DOWN,
      p2Left: KC.LEFT,
      p2Right: KC.RIGHT,
      p2Fire: KC.NUMPAD_ZERO,
      p2FireAlt: KC.SHIFT, // laptop alt fire — OR'd with p2Fire in readPlayer (fires on EITHER Shift).
      // F7 (D4/AC4) — the PAUSE toggle keys (P + ESC). NEITHER is a player move/fire key, so the edge is
      // conflict-free; GameScene reads the JustDown edge to open pause. The overlay binds its OWN keydown-P/ESC
      // to CLOSE (the Phaser event bus, separate from these JustDown flags), and consumePause() swallows the
      // pending edge on the resume frame (the close→reopen race fix — D4).
      pauseP: KC.P,
      pauseEsc: KC.ESC,
    }) as Record<string, Phaser.Input.Keyboard.Key>
  }

  // Build ONE intent snapshot for this frame. Called EXACTLY once per GameScene.update (AC2). A pure
  // read of key state → no gameplay side effects. Each fire JustDown is read here and ONLY here.
  //
  // F7 (D4/AC4) — also samples the PAUSE edge: a JustDown over P OR ESC (the sole-owner discipline, like the
  // fire edges). BOTH JustDowns are read EVERY frame (not short-circuited) so neither key's internal _justDown
  // flag stays latched — then OR'd. The scene reads `pausePressed` to OPEN pause; consumePause() can clear a
  // pending edge so the overlay's own close-press cannot re-open pause on the resume frame (the race fix, D4).
  sample(): InputSnapshot {
    const pP = Phaser.Input.Keyboard.JustDown(this.keys.pauseP)
    const pE = Phaser.Input.Keyboard.JustDown(this.keys.pauseEsc)
    // P1 is built from the keyboard exactly as before, then — ONLY if a touch source is wired — MERGED with the
    // on-screen pad (touch-controls §2, D1). Keyboard-only (touch null) is byte-identical to today (AC4).
    const p1 = this.readPlayer('p1')
    return { p1: this.touch ? this._mergeTouch(p1, this.touch) : p1, p2: this.readPlayer('p2'), pausePressed: pP || pE }
  }

  // ── _mergeTouch (touch-controls §2, D1/D4) ── compose the on-screen pad into P1's intent WITHOUT a second
  // movement path: OR the touch held cardinals onto the keyboard's, then RE-DERIVE dirX/dirY from the merged
  // booleans using the SAME opposing-cancels formula readPlayer uses (so a left key + a right touch still cancel
  // to 0 — the invariant holds for the merged set, KISS). The FIRE edge is OR'd in via consumeFire(), drained
  // ONCE here (sample() is the sole per-frame caller — the JustDown discipline, so a held finger fires once, D4).
  // Keyboard and touch thus COMPOSE — neither suppresses the other (AC5). Returns a fresh intent (no mutation).
  private _mergeTouch(p1: PlayerIntent, touch: TouchState): PlayerIntent {
    const up = p1.up || touch.up
    const down = p1.down || touch.down
    const left = p1.left || touch.left
    const right = p1.right || touch.right
    return {
      up,
      down,
      left,
      right,
      dirX: (right ? 1 : 0) - (left ? 1 : 0), // re-derived — opposing still cancels (the SAME readPlayer formula).
      dirY: (down ? 1 : 0) - (up ? 1 : 0),
      firePressed: p1.firePressed || touch.consumeFire(), // OR the drained tap edge onto the keyboard fire edge.
    }
  }

  // ── consumePause() (F7 §5.3, D4, AC4 — the close→reopen race fix) ── swallow any PENDING P/ESC JustDown edge
  // so the overlay's own keydown-P/ESC close-press (which Phaser dispatches BEFORE scene.update) cannot be
  // re-sampled by sample() and re-open pause on the SAME resume frame. Reads both JustDowns to clear both
  // latched flags (the reference's consumePause). Called by GameScene._closePause(). Idempotent + side-effect-only.
  consumePause(): void {
    Phaser.Input.Keyboard.JustDown(this.keys.pauseP)
    Phaser.Input.Keyboard.JustDown(this.keys.pauseEsc)
  }

  // Read one player's held cardinals + derived dirX/dirY + the sole-owned fire edge (Decision 3, AC1/AC2).
  // Opposing keys on an axis cancel: `dirX = (right?1:0) − (left?1:0)` ∈ {−1,0,1} (KISS — no jitter, no
  // last-key tracking). The fire JustDown is called exactly once for this player's fire key.
  private readPlayer(prefix: 'p1' | 'p2'): PlayerIntent {
    const k = this.keys
    const up = k[`${prefix}Up`].isDown
    const down = k[`${prefix}Down`].isDown
    const left = k[`${prefix}Left`].isDown
    const right = k[`${prefix}Right`].isDown
    // JustDown read here and ONLY here (the sole-owner invariant, AC2) — a held fire key fires once/press.
    // P2 also has an ALT fire key (p2FireAlt = SHIFT); P1 has none, so `altKey` is undefined and its JustDown is
    // NEVER called → P1 stays byte-identical (AC4). BOTH JustDowns are read EVERY frame — `fireAlt` is computed
    // into its OWN const BEFORE the `||` (do NOT inline to `fireMain || JustDown(altKey)`: `||` short-circuits, so
    // when main is true the alt read is skipped, its `_justDown` flag latches, and next frame it re-fires —
    // breaking once-per-press, AC1). The pause edges (sample() above) read both JustDowns for the same reason.
    const fireMain = Phaser.Input.Keyboard.JustDown(k[`${prefix}Fire`])
    const altKey = k[`${prefix}FireAlt`]
    const fireAlt = altKey ? Phaser.Input.Keyboard.JustDown(altKey) : false
    const firePressed = fireMain || fireAlt
    return {
      up,
      down,
      left,
      right,
      dirX: (right ? 1 : 0) - (left ? 1 : 0),
      dirY: (down ? 1 : 0) - (up ? 1 : 0),
      firePressed,
    }
  }
}

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
// JustDown on J / NUMPAD_ZERO. A held fire key thus fires once per press.

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
export interface InputSnapshot {
  p1: PlayerIntent
  p2: PlayerIntent
}

export class Input {
  // Named physical keys; the snapshot derives intent from these. P1 = WASD move + J fire; P2 = arrow
  // move + Numpad0 fire. NO jump/dodge/skill keys (YAGNI — Battle City has none).
  private keys: Record<string, Phaser.Input.Keyboard.Key>

  constructor(scene: Phaser.Scene) {
    const KC = Phaser.Input.Keyboard.KeyCodes
    // addKeys lets us name each physical key in one place (the single-owner invariant, AC1). Bindings
    // (Decision 4, AC2): fire keys must avoid BOTH movesets AND each other. P1 fire = J (left-hand
    // cluster near WASD; the reference proved J comfortable). P2 fire = NUMPAD_ZERO (right side near the
    // arrows, collides with nothing — WASD / arrows / J), avoiding the sticky-keys '/'+RShift trap.
    this.keys = scene.input.keyboard!.addKeys({
      // P1 — WASD move + J fire.
      p1Up: KC.W,
      p1Down: KC.S,
      p1Left: KC.A,
      p1Right: KC.D,
      p1Fire: KC.J,
      // P2 — arrow move + Numpad0 fire.
      p2Up: KC.UP,
      p2Down: KC.DOWN,
      p2Left: KC.LEFT,
      p2Right: KC.RIGHT,
      p2Fire: KC.NUMPAD_ZERO,
    }) as Record<string, Phaser.Input.Keyboard.Key>
  }

  // Build ONE intent snapshot for this frame. Called EXACTLY once per GameScene.update (AC2). A pure
  // read of key state → no gameplay side effects. Each fire JustDown is read here and ONLY here.
  sample(): InputSnapshot {
    return { p1: this.readPlayer('p1'), p2: this.readPlayer('p2') }
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
    const firePressed = Phaser.Input.Keyboard.JustDown(k[`${prefix}Fire`])
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

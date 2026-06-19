import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  UI_FONT,
  TOUCH_DPAD_BTN,
  TOUCH_DPAD_MARGIN,
  TOUCH_FIRE_RADIUS,
  TOUCH_FIRE_MARGIN,
  TOUCH_ALPHA,
} from '../config/constants.js'
import { t } from '../i18n/index.js'
import type { TouchState } from '../core/Input.js'

// ── TouchControls — the on-screen D-pad + FIRE button (touch-controls §2/§3, D2/D4/D5) ──
// A self-contained, camera-FIXED Phaser UI object modelled on PauseOverlay (KISS): programmer-art primitives
// only (rects + arcs via the scene's add factory, setScrollFactor(0)), a depth band BELOW the pause modal's
// 200 (so the modal stays readable on top) but ABOVE the playfield. It implements the pure `TouchState` seam
// (core/Input): four held cardinal bools + a drained fire EDGE — Input MERGES it into P1 inside sample(), so
// there is NO new movement path and no second intent consumer (DRY — Tank.update stays the sole drive).
//
// GATING (D3): GameScene constructs this ONLY when `device.input.touch`, so on desktop it never exists and
// Input.sample() is byte-identical to the keyboard-only path (no interference — AC4). P1 ONLY (the touch
// use-case is a single local player; P2 needs a second physical device — KISS/YAGNI).
//
// FIRE EDGE (D4): the FIRE button's pointerdown sets a `_firePending` latch (a JustDown analogue). consumeFire()
// returns it and CLEARS it, so a single tap fires exactly once and a HELD finger does NOT machine-gun (matches
// the keyboard "fire once per press"). sample() is the sole per-frame caller (the sole-owner site — D4).
//
// D-PAD (D5): each of the 4 arrows is an interactive rect; pointerdown / pointerover (with pointer.isDown) sets
// its held bool, pointerup / pointerout / pointerupoutside clears it. Multi-arrow presses are OR'd by Input
// (opposing cancels via its dirX/dirY re-derive). Handlers are stored so destroy() removes them (no leaked
// listener across a scene shutdown — D7). reset()/show()/hide() make it pause-aware (no held bool survives a
// pause, no input leaks on resume — D6), symmetric with Input.consumePause().

// One held-direction descriptor: the field it toggles + the geometry of its arrow rect (computed in the ctor).
type Dir = 'up' | 'down' | 'left' | 'right'

// The colours of the programmer-art chrome (translucent so the playfield shows through — D2).
const PAD_FILL = 0x2b333f // the neutral arrow/button fill (a muted slate).
const PAD_PRESSED = 0x4b8bf4 // the highlight an arrow/button flashes while held (a bright blue).
const GLYPH_COLOR = 0xc9d1d9 // the arrow-triangle glyph colour (a light grey, like the HUD text).
const FIRE_FILL = 0xc0392b // the FIRE button fill (a warning red — distinct from the D-pad slate).
const DEPTH = 100 // above the playfield (default depth ~0), BELOW the pause modal's 200 (so the modal stays on top).

export class TouchControls implements TouchState {
  // The held cardinal bools Input reads (the TouchState shape — D1). Public so sample() can OR them into p1.
  up = false
  down = false
  left = false
  right = false

  private scene: Phaser.Scene
  private _destroyed = false
  // The pending FIRE-tap EDGE (D4) — set on the FIRE pointerdown, drained + cleared by consumeFire().
  private _firePending = false
  // Every GameObject this owns (rects, arcs, glyphs, labels) so destroy() tears them all (idempotent).
  private _objs: Phaser.GameObjects.GameObject[] = []
  // The per-arrow interactive rect + its Dir, so a pointer handler can flip the right held bool + flash it.
  private _arrows: { dir: Dir; rect: Phaser.GameObjects.Rectangle }[] = []
  // The FIRE button arc (held to recolour it on press for feedback).
  private _fireBtn!: Phaser.GameObjects.Arc
  // The stored handlers we bind to the SCENE input plugin, removed in destroy() (no leaked listener — D7).
  private _handlers!: {
    down: (p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => void
    up: () => void
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene

    // ── The D-pad cluster (bottom-left) — a plus shape: UP/DOWN stacked vertically, LEFT/RIGHT a row, meeting at
    // a shared center cell. Anchored TOUCH_DPAD_MARGIN from the bottom-left corner (camera-fixed). The cluster's
    // bottom-left origin is the margin corner; the center cell sits one button up + one button right of it. ──
    const B = TOUCH_DPAD_BTN
    const clusterLeft = TOUCH_DPAD_MARGIN
    const clusterBottom = DESIGN_HEIGHT - TOUCH_DPAD_MARGIN
    const cx = clusterLeft + B * 1.5 // center of the 3-button-wide cluster.
    const cy = clusterBottom - B * 1.5 // center of the 3-button-tall cluster.
    // Each arrow's CENTER is one button-width out from the cluster center along its axis (the plus arms).
    this._addArrow('up', cx, cy - B)
    this._addArrow('down', cx, cy + B)
    this._addArrow('left', cx - B, cy)
    this._addArrow('right', cx + B, cy)

    // ── The FIRE button (bottom-right) — a translucent red arc + a localised label, anchored TOUCH_FIRE_MARGIN
    // from the bottom-right corner. It is interactive only via the scene-level pointerdown (handled below), but a
    // dedicated hit area keeps a tap on the playfield from arming fire. ──
    const fx = DESIGN_WIDTH - TOUCH_FIRE_MARGIN - TOUCH_FIRE_RADIUS
    const fy = DESIGN_HEIGHT - TOUCH_FIRE_MARGIN - TOUCH_FIRE_RADIUS
    this._fireBtn = scene.add
      .circle(fx, fy, TOUCH_FIRE_RADIUS, FIRE_FILL, TOUCH_ALPHA)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setInteractive(new Phaser.Geom.Circle(TOUCH_FIRE_RADIUS, TOUCH_FIRE_RADIUS, TOUCH_FIRE_RADIUS), Phaser.Geom.Circle.Contains)
    this._objs.push(this._fireBtn)
    const fireLabel = scene.add
      .text(fx, fy, t('touch.fire'), { fontFamily: UI_FONT, fontSize: '22px', color: '#f5f5f5', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    this._objs.push(fireLabel)

    // ── The pointer handlers (D4/D5) — bound to the SCENE input plugin so they catch a press anywhere, dispatched
    // with the list of interactive objects UNDER the pointer. A press on the FIRE arc latches the edge + flashes
    // it; a press/drag over an arrow rect holds that direction. pointerup (anywhere) clears the fire flash + ALL
    // held bools (a finger lifted off-button still releases). Stored so destroy() removes them (no leak — D7). ──
    this._handlers = {
      down: (p, objs) => {
        if (objs.includes(this._fireBtn)) {
          this._firePending = true // arm the fire EDGE (drained once by consumeFire — D4).
          this._fireBtn.setFillStyle(PAD_PRESSED, TOUCH_ALPHA)
        }
        for (const a of this._arrows) {
          if (objs.includes(a.rect)) this._press(a.dir)
        }
        // A drag onto another arrow while held is covered by pointerover below; pointer is checked there too.
      },
      up: () => {
        // A lift anywhere releases the whole pad — there is no per-pointer tracking (KISS): a held arrow with the
        // finger lifted must NOT stick (the "no leaked input" guarantee), and the FIRE flash resets.
        this._releaseAll()
        this._fireBtn.setFillStyle(FIRE_FILL, TOUCH_ALPHA)
      },
    }
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this._handlers.down)
    scene.input.on(Phaser.Input.Events.POINTER_UP, this._handlers.up)
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this._handlers.up)
  }

  // ── _addArrow (D5) ── build one interactive arrow rect + its triangle glyph at (x,y), wire its OWN
  // pointerover/out/up handlers (the held-bool toggles), and record it for the scene-level down handler + teardown.
  // pointerover with pointer.isDown lets a finger DRAG from one arrow to an adjacent one (the classic D-pad slide).
  private _addArrow(dir: Dir, x: number, y: number) {
    const B = TOUCH_DPAD_BTN
    const rect = this.scene.add
      .rectangle(x, y, B - 6, B - 6, PAD_FILL, TOUCH_ALPHA)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setInteractive() // a default rectangular hit area.
    rect.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, (p: Phaser.Input.Pointer) => {
      if (p.isDown) this._press(dir) // a drag onto this arrow holds it.
    })
    rect.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this._release(dir))
    rect.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this._release(dir))
    this._objs.push(rect)
    this._arrows.push({ dir, rect })
    // The direction glyph — a filled triangle drawn via Graphics (programmer-art, no asset), pointing the way.
    this._addGlyph(dir, x, y)
  }

  // ── _addGlyph ── a small filled triangle pointing in `dir`, centered on the arrow at (x,y). Drawn once into a
  // Graphics object (camera-fixed, above the rect) — pure programmer-art (no font glyph, no asset).
  private _addGlyph(dir: Dir, x: number, y: number) {
    const r = TOUCH_DPAD_BTN * 0.22 // the triangle's reach from the arrow center.
    const g = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 1)
    g.fillStyle(GLYPH_COLOR, 0.9)
    // Each triangle: an apex pointing OUTWARD + two base corners on the opposite side (a clean directional caret).
    if (dir === 'up') g.fillTriangle(x, y - r, x - r, y + r, x + r, y + r)
    else if (dir === 'down') g.fillTriangle(x, y + r, x - r, y - r, x + r, y - r)
    else if (dir === 'left') g.fillTriangle(x - r, y, x + r, y - r, x + r, y + r)
    else g.fillTriangle(x + r, y, x - r, y - r, x - r, y + r)
    this._objs.push(g)
  }

  // Hold a direction + flash its arrow (idempotent — a repeated press while held is harmless).
  private _press(dir: Dir) {
    this[dir] = true
    const a = this._arrows.find((e) => e.dir === dir)
    a?.rect.setFillStyle(PAD_PRESSED, TOUCH_ALPHA)
  }

  // Release ONE direction + un-flash its arrow.
  private _release(dir: Dir) {
    this[dir] = false
    const a = this._arrows.find((e) => e.dir === dir)
    a?.rect.setFillStyle(PAD_FILL, TOUCH_ALPHA)
  }

  // Release EVERY held direction (a pointer lift / a pause reset — no held bool may survive, D6).
  private _releaseAll() {
    this.up = this.down = this.left = this.right = false
    for (const a of this._arrows) a.rect.setFillStyle(PAD_FILL, TOUCH_ALPHA)
  }

  // ── consumeFire (TouchState, D4) ── drain the pending FIRE-tap EDGE: return it ONCE, then clear it (the
  // JustDown discipline — a held finger does not machine-gun). sample() is the sole per-frame caller (D4).
  consumeFire(): boolean {
    const f = this._firePending
    this._firePending = false
    return f
  }

  // ── reset() (touch-controls §2, D6 — pause-aware) ── clear ALL held bools + the pending fire edge AND dim/hide
  // the pad, so a finger lifted while the pad was hidden (during pause) leaves NO stale input on resume. Called by
  // GameScene._openPause() (symmetric with input2.consumePause()) — the "do not leak input on resume" guarantee.
  reset(): void {
    this._releaseAll()
    this._firePending = false
    this._fireBtn.setFillStyle(FIRE_FILL, TOUCH_ALPHA)
    this.hide()
  }

  // Hide / show the whole pad (camera-fixed chrome). The pause modal (depth 200) draws above it regardless, but
  // hiding while paused keeps the frozen scene clean + makes the reset visually obvious (D6).
  hide(): void {
    this._setVisible(false)
  }

  // ── show() (D6) ── re-show the pad on resume. Held bools were cleared by reset() on pause-open, so the first
  // resume frame starts from rest (no leaked input — AC6). Called by GameScene._closePause().
  show(): void {
    this._setVisible(true)
  }

  // Toggle the visibility of every owned chrome object. Every object pushed to _objs is a Rectangle / Arc / Text /
  // Graphics — all of which mix in the Visible component — so the cast is sound (the array's type is the broad
  // GameObject, hence the explicit narrowing here in ONE place rather than at each call site).
  private _setVisible(v: boolean) {
    for (const o of this._objs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(v)
  }

  // ── destroy() (touch-controls §2, D7 — no leaked listeners/orphan rects) ── remove the scene-level pointer
  // handlers + destroy every owned GameObject (idempotent via the _destroyed guard, copied from PauseOverlay).
  // GameScene registers this on the scene SHUTDOWN event; a stage rebuild does NOT touch it (RUN-scoped chrome).
  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    const input = this.scene.input
    input.off(Phaser.Input.Events.POINTER_DOWN, this._handlers.down)
    input.off(Phaser.Input.Events.POINTER_UP, this._handlers.up)
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this._handlers.up)
    for (const o of this._objs) {
      if (o && o.active) o.destroy()
    }
    this._objs = []
    this._arrows = []
  }
}

import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  UI_FONT,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
  TWO_PLAYER,
  MAX_DT,
  START_LIVES,
  BULLET_DAMAGE,
  FRIENDLY_FIRE,
} from '../config/constants.js'
import { TILE } from '../config/tiles.js'
import { Input } from '../core/Input.js'
import { Tank } from '../entities/Tank.js'
import { Base } from '../entities/Base.js'
import { BulletPool } from '../combat/BulletPool.js'
import type { BulletRect } from '../combat/BulletPool.js'
import { Effects } from '../effects/Effects.js'
import { stageConfig } from '../config/stages.js'
import { generateStage } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'

// ── GameScene (F0 §5.3 + F1 §5.4 + F2 §5.4 + F3 Combat & terrain §5.4, Decisions D1/D3/D6/D7/D8/D9/D10/D11,
// AC1–AC11) ──
// The run scene — the only scene with an Arcade physics world (gravity 0; top-down). F2 built a PROCEDURAL,
// SEEDED, headlessly-VERIFIED 13×13 stage (terrain + an enclosed reachable eagle + spawns) but left the
// bullets INERT (they travelled + despawned at the bounds; nothing collided them against anything). F3 makes
// the bullets MATTER: it registers + resolves every bullet collision pair, gives the eagle a real entity whose
// destruction ends the run, pools explosion FX, costs a player a life on death (respawn with i-frames), and
// keeps co-op friendly-fire OFF — all mirroring the read-only `dead-cell` reference's combat conventions.
//
// THE FOOTGUN DISCIPLINE F3 mirrors EXACTLY (the reference's documented rules — D1/D6/AC10):
//   • Never destroy a body INSIDE an Arcade overlap callback (it corrupts world.step's collider iteration).
//     `bullets.release` only DISABLES a body (safe inside the step); the ONE body-DESTROYING resolution F3
//     has — the brick sub-cell chip — is DEFERRED to time.delayedCall(0) (runs next tick, after the step).
//   • Every run-end edge funnels through ONE guarded `_triggerGameOver` (the `gameOver` one-shot flag), so a
//     multi-frame overlap / a same-frame second trigger transitions EXACTLY once (AC6/AC10).
//
// THE dt/gdt SEAM (D10, AC of F1 reused): update() computes a REAL dt = min(delta/1000, MAX_DT) and a GAMEPLAY
// dt `gdt` = dt (the IDENTITY in F3 — feel is byte-identical to F2). Tanks/bullets tick on `gdt`; effects on
// the REAL dt. The later clock power-up drives `gdt = 0` (freeze the world; FX keep popping) by flipping ONE
// assignment — the boundary exists NOW so the power-up needs no refactor (YAGNI: F3 adds NO freeze logic).
//
// SEAMS WIRED FOR LATER FEATURES (D12): the bullet×tank callback + the tank-death path are GENERIC over
// `side`, so the enemy feature constructs `side:'enemy'` tanks that plug into the SAME overlap + onDeath with
// NO refactor. F3 spawns NO enemies / power-ups / score readouts (each lands in its own feature — YAGNI).

// A fixed dev seed for the generated stage (D11/D12 — the run/seed wiring is a LATER feature; F3 keeps the
// stable F2 stage so the sandbox is reproducible). The stageIndex defaults to 0 (the first stage).
const DEV_SEED = 0x7a4b1990
const DEV_STAGE_INDEX = 0

// A tank-collider GameObject carries a back-ref to its owning Tank so the bullet×tank overlap callback reads
// the victim off the struck body (DRY — the reference's `enemyRect.enemyRef`, F3 §5.3).
type TankCollider = Phaser.GameObjects.Rectangle & { tankRef?: Tank }
// A solidBodies child carries F2's grid tags (tileKind/tileCol/…) + the F3 back-ref to the Base (the eagle's
// TILE.BASE body, found + tagged in create()). The terrain callback reads these off the struck body (D2/D3).
type SolidRect = Phaser.GameObjects.Rectangle & {
  tileKind?: number
  tileCol?: number
  tileRow?: number
  subCol?: number
  subRow?: number
  baseRef?: Base
}

export class GameScene extends Phaser.Scene {
  // F1/F2 gameplay state (Phaser-coupled — the scene owns the world resources, SOLID). Null until create().
  private input2!: Input
  private bullets!: BulletPool
  private p1!: Tank
  private p2: Tank | null = null
  private tileMap!: TileMap

  // F3 combat state (§5.4) — the FX façade, the eagle entity, the present-players lives ledger, the spawn
  // window-centers for respawn, and the one-shot run-end / rebuild guards.
  private effects!: Effects
  private base!: Base
  // The lives ledger is seeded for the PRESENT players ONLY (P1 always; P2 only when TWO_PLAYER — D11). A
  // phantom P2 slot is NEVER seeded when solo, so _checkRunOver (which iterates THESE keys) can't be blocked.
  private lives!: Map<number, number>
  // The generated spawn window-center per present player slot — respawnAt re-places the tank here (DRY, D11).
  private spawnPos!: Map<number, { x: number; y: number }>
  // The present player tanks keyed by slot (1/2) — the bullet×tank overlap + the run drive these (D11).
  private playerTanks!: Map<number, Tank>
  private gameOver = false // one-shot run-end guard (D6/AC6/AC10) — _triggerGameOver fires once.
  private transitioning = false // one-shot rebuild guard (reserved — F3 has no stage rebuild yet, D12).

  constructor() {
    super('Game')
  }

  create(): void {
    // Reset the one-shot guards on (re)entry — a scene restart must start a fresh run (D6/AC10).
    this.gameOver = false
    this.transitioning = false

    // Launch the HUD as a PARALLEL overlay (launch, NOT start, so GameScene keeps running underneath). (F0 AC6.)
    this.scene.launch('HUD')

    // The centered 13×13 square playfield outline (kept from F0/F2), drawn with a Graphics primitive (AC11).
    const g = this.add.graphics()
    g.lineStyle(2, 0x30363d, 1)
    g.strokeRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)

    this.add
      .text(DESIGN_WIDTH / 2, PLAYFIELD_Y - 28, `STAGE ${DEV_STAGE_INDEX + 1}`, {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── Build the generated stage (F2 §5.4, D11/D13) ── kept UNCHANGED: pick the difficulty params, generate
    // the SEEDED 13×13 description (terrain + enclosed reachable eagle fort + spawns), render + body via TileMap.
    const cfg = stageConfig(DEV_STAGE_INDEX)
    const desc = generateStage(DEV_SEED, cfg)
    this.tileMap = new TileMap(this, desc)

    // ── The SINGLE Input owner + the shared BulletPool + the FX façade (Decision D9/D12, AC2/AC7) ──
    this.input2 = new Input(this)
    this.bullets = new BulletPool(this)
    this.effects = new Effects(this)

    // ── The eagle entity (F3 §5.4, D3/D6, AC6) ── draw the eagle VISUAL at the BASE tile's window-center
    // (the same coord F2's TileMap drew its TILE.BASE body at — DRY). The tank-blocking STATIC BODY ALREADY
    // exists in `solidBodies` (F2 emitted it). Wire the run-over edge to the guarded _triggerGameOver (D6).
    this.base = new Base(this, desc.base.x, desc.base.y)
    this.base.onDestroyed = () => this._triggerGameOver()
    // Back-reference the F2-emitted TILE.BASE body to the Base so the ONE bullet×solidBodies callback's
    // tileKind===TILE.BASE branch resolves the eagle hit via solidRect.baseRef.onHit() (D3 — no second body,
    // no separate overlap). There is exactly one such child (the generated grid has one BASE cell).
    for (const child of this.tileMap.solidBodies.getChildren()) {
      const sr = child as SolidRect
      if (sr.tileKind === TILE.BASE) {
        sr.baseRef = this.base
        break
      }
    }

    // ── Spawn the player tank(s) (F2 §5.4, D11/D13) ── P1 always; P2 only when TWO_PLAYER. Seed the lives
    // ledger + the spawn-position map + the playerTanks map for the PRESENT players ONLY (D11 — a phantom P2
    // is never seeded when solo, so _checkRunOver can never be blocked by a slot that's never driven/killed).
    this.lives = new Map<number, number>()
    this.spawnPos = new Map<number, { x: number; y: number }>()
    this.playerTanks = new Map<number, Tank>()

    const sp1 = desc.playerSpawns[0]
    this.p1 = this._spawnPlayer(1, sp1.x, sp1.y)

    if (TWO_PLAYER) {
      const sp2 = desc.playerSpawns[1]
      this.p2 = this._spawnPlayer(2, sp2.x, sp2.y)
      this.physics.add.collider(this.p1.collider, this.p2.collider) // the two tanks can't overlap.
    }

    // ── Register the F3 overlaps (F3 §5.4, D1/D3, AC1–AC6/AC9) ──
    // bullet × terrain solids: ONE callback resolves brick (chip + despawn) / steel (despawn) / the eagle
    // (run over + despawn) by switching on the struck body's tileKind tag (D2/D3). The processCallback
    // early-returns while gameOver (the reference's filter style) + on a stale bullet handle.
    this.physics.add.overlap(
      this.bullets.group,
      this.tileMap.solidBodies,
      (bulletRect, solidRect) => this._onBulletHitSolid(bulletRect as BulletRect, solidRect as SolidRect),
      (bulletRect) => !this.gameOver && (bulletRect as BulletRect).bx.active,
      this,
    )
    // bullet × each present tank: friendly-fire-filtered (D8) damage funnel. The collider GameObject carries
    // a `tankRef` back-ref (set in _spawnPlayer). NO bullet×water overlap is registered (AC3 — bullets fly
    // over water). NO separate bullet×base overlap (the eagle rides inside solidBodies — D3/AC6).
    for (const tank of this.playerTanks.values()) {
      this.physics.add.overlap(
        this.bullets.group,
        tank.collider,
        (bulletRect, tankRect) => this._onBulletHitTank(bulletRect as BulletRect, tankRect as TankCollider),
        (bulletRect, tankRect) => this._bulletCanHitTank(bulletRect as BulletRect, tankRect as TankCollider),
        this,
      )
    }
  }

  // ── Spawn a player tank for slot `slot` at the generated window-center (F3 §5.4, D11) ── construct the tank
  // (F1, unchanged), collide it against the terrain (F2, kept), tag its collider with the back-ref, seed its
  // life/spawn-position/tank entries, and wire its onDeath to the scene's life/respawn path (D11). ──
  private _spawnPlayer(slot: number, x: number, y: number): Tank {
    const tank = new Tank(this, x, y, 'player')
    ;(tank.collider as TankCollider).tankRef = tank // the bullet×tank overlap reads the victim off this (DRY).
    this._collideTankWithTerrain(tank) // AC10 (F2) — the tank stops at brick/steel/water/the eagle.
    this.lives.set(slot, START_LIVES)
    this.spawnPos.set(slot, { x, y })
    this.playerTanks.set(slot, tank)
    // The Tank reports its death; the SCENE owns the run economy (spend-a-life-and-respawn vs. stay-down, D11).
    tank.onDeath = () => this._onPlayerDeath(slot, tank)
    return tank
  }

  // Collide a tank against BOTH tank-blocking body groups (F2 §5.4, D7/D11): `solidBodies` (STEEL + BASE +
  // every BRICK sub-cell — so a tank can't drive onto the eagle, AC6) AND `waterBodies` (WATER blocks tanks).
  private _collideTankWithTerrain(tank: Tank): void {
    this.physics.add.collider(tank.collider, this.tileMap.solidBodies)
    this.physics.add.collider(tank.collider, this.tileMap.waterBodies)
  }

  // ── bullet × terrain solids resolution (F3 §5.3, D1/D2/D3/D4, AC1/AC2/AC6/AC10) ── ONE callback over the
  // solidBodies group (BRICK sub-cells + STEEL + the eagle's TILE.BASE body). Switch on the struck body's
  // tileKind tag (read off the body — D2, never re-derived from the bullet's pixel position). Every branch
  // despawns the bullet (a solid stops it). DESTRUCTIVE mutation (the brick chip) is DEFERRED out of the
  // callback (D1/AC10); the eagle/steel branches destroy NO body. ──
  private _onBulletHitSolid(bulletRect: BulletRect, solidRect: SolidRect): void {
    const bx = bulletRect.bx
    if (!bx.active) return // stale handle — a multi-frame overlap after the shot was already released.
    const kind = solidRect.tileKind

    // ── The eagle (D3/D6, AC6) ── the F2-emitted TILE.BASE body, back-reffed to the Base. Resolve the run-over
    // via base.onHit() (the one-shot guard) — it destroys NO body (the rubble stays tank-blocking). A second
    // bullet reaching the rubble (base no longer hittable) just despawns.
    if (kind === TILE.BASE) {
      const base = solidRect.baseRef
      if (!base || !base.isHittable()) {
        this.bullets.release(bulletRect)
        return
      }
      this.effects.explosion(bulletRect.x, bulletRect.y, { big: true }) // a big kill burst at the eagle.
      this.bullets.release(bulletRect)
      base.onHit() // flips destroyed ONCE → onDestroyed → _triggerGameOver (the gameOver guard, AC6/AC10).
      return
    }

    // ── BRICK / STEEL (D3/D4, AC1/AC2) ── a small impact spark + despawn the shot in BOTH cases.
    this.effects.explosion(bulletRect.x, bulletRect.y)
    this.bullets.release(bulletRect)

    if (kind === TILE.BRICK) {
      // DEFER the body removal out of world.step (the footgun — D1/AC10). delayedCall(0) runs next tick, after
      // the step. destroyBrickSubCell is idempotent (a missing key is a no-op), so a same-tile double-overlap
      // is safe. Capture the tags NOW (the body may be gone by the time the closure runs).
      const col = solidRect.tileCol
      const row = solidRect.tileRow
      const sc = solidRect.subCol
      const sr = solidRect.subRow
      if (col !== undefined && row !== undefined && sc !== undefined && sr !== undefined) {
        this.time.delayedCall(0, () => this.tileMap.destroyBrickSubCell(col, row, sc, sr))
      }
    }
    // STEEL: NO terrain change (indestructible this phase — no bullet.power break-steel flag exists, D4).
  }

  // ── bullet × tank process filter (F3 §5.3, D7/D8, AC5/AC9) ── runs BEFORE the resolution: is this a valid,
  // hittable, OPPOSING-side victim? A stale/dead/i-frame'd tank or a same-side shot (FF off) is skipped, so a
  // player bullet PASSES THROUGH an allied tank (no damage, no despawn) — AC9. The single FRIENDLY_FIRE toggle
  // governs it (D8); flipping it to true re-enables FF with no code change. ──
  private _bulletCanHitTank(bulletRect: BulletRect, tankRect: TankCollider): boolean {
    if (this.gameOver) return false
    const bx = bulletRect.bx
    const tank = tankRect.tankRef
    if (!bx.active || !tank || !tank.isHittable()) return false
    if (bx.ownerSide === tank.side && !FRIENDLY_FIRE) return false // FF off — the bullet passes the ally (AC9).
    return true
  }

  // ── bullet × tank resolution (F3 §5.3, D7, AC5) ── the filter already proved a valid opposing hittable
  // victim; pop a spark, despawn the shot (one shot, one hit), and route the damage through the hit FUNNEL
  // (tank.onHit — armor multi-hit "for free" via HP subtraction). A death fires the tank's onDeath (the
  // scene's life/respawn path, D11). release() only disables the body — safe inside the overlap (AC10). ──
  private _onBulletHitTank(bulletRect: BulletRect, tankRect: TankCollider): void {
    const bx = bulletRect.bx
    const tank = tankRect.tankRef
    if (!bx.active || !tank || !tank.isHittable()) return // re-guard (the filter can race a same-frame release).
    if (bx.ownerSide === tank.side && !FRIENDLY_FIRE) return
    this.effects.explosion(bulletRect.x, bulletRect.y)
    this.bullets.release(bulletRect)
    tank.onHit(BULLET_DAMAGE) // the hit funnel (D7) — the death path runs once at ≤ 0 HP → onDeath.
  }

  // ── A player tank reached 0 HP (F3 §5.3, D11, AC8) ── the Tank fired its onDeath; the SCENE owns the run
  // economy. Pop the kill burst, spend that player's life, and — if any remain — respawn at the generated
  // spawn with SPAWN_IFRAME i-frames, else leave the player down. Then run the run-over check (the eagle's
  // death OR EVERY PRESENT player out of lives ends the run — D11). ──
  private _onPlayerDeath(slot: number, tank: Tank): void {
    this.effects.explosion(tank.collider.x, tank.collider.y, { big: true }) // the kill burst at the tank center.
    const remaining = (this.lives.get(slot) ?? 0) - 1
    this.lives.set(slot, Math.max(0, remaining))
    if (remaining > 0) {
      const sp = this.spawnPos.get(slot)
      if (sp) tank.respawnAt(sp.x, sp.y) // re-place + refill HP + arm the i-frames (D11).
    }
    // else: that player stays down (its rect/body stay hidden+disabled from Tank.onHit) — the run ends only
    // when the eagle dies OR every PRESENT player is out of lives (checked next).
    this._checkRunOver()
  }

  // ── _checkRunOver (F3 §5.3, D11, AC8 — the all-lives-spent edge) ── tally ONLY the PRESENT players (the
  // seeded `lives` keys — solo → just [1]; co-op → [1,2]), NEVER a hard-coded {1,2}. If ANY present player
  // still has a life, the run continues; otherwise every present player is spent → the guarded run-over. This
  // scoping is the single-player fix (D11): a solo P1 is the ONLY key, so spending its last life ends the run.
  private _checkRunOver(): void {
    for (const livesLeft of this.lives.values()) {
      if (livesLeft > 0) return // someone still has a life → the run continues.
    }
    this._triggerGameOver() // every present player spent → run over (guarded, fires once).
  }

  // ── _triggerGameOver (F3 §5.3, D6, AC6/AC10 — the ONE guarded run-end edge) ── BOTH run-end edges funnel
  // here: the eagle's destruction (base.onDestroyed) AND every-present-player-out-of-lives (_checkRunOver).
  // The one-shot `gameOver` flag (set FIRST, the reference's ordering) means a same-frame double-trigger
  // transitions EXACTLY once. Flash the camera, then hand off to GameOverScene (F0 stub — F3 passes nothing
  // it doesn't own yet; the run-summary/banking readout is a LATER feature, D12). ──
  private _triggerGameOver(): void {
    if (this.gameOver) return // one-shot guard — the SECOND edge of a same-frame double-trigger early-returns.
    this.gameOver = true
    this.cameras.main.flash(280, 200, 40, 40) // a brief red flash marks the run end.
    // Defer the transition a beat so the kill burst + flash read before the screen swaps (the reference's
    // delayedCall handoff). effects keep ticking until then (update's gameOver branch ticks the FX, AC7).
    this.time.delayedCall(700, () => this.scene.start('GameOver'))
  }

  // ── Per-frame tick (F3 §5.3, D10, AC of F1 reused) ── the dt/gdt split, the per-player fire+drive, the
  // bullet pool travel, the bullet×bullet scan, the FX tick. Once the run ends, the world freezes but the FX
  // keep settling. Arcade resolves the registered overlaps (bullet×solids, bullet×tank) during its step.
  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, MAX_DT) // REAL dt in SECONDS, clamped (AC7 — no raw delta reaches a formula).
    const gdt = dt // GAMEPLAY dt — the IDENTITY in F3 (D10); the later clock power-up drives this to 0.

    // Sample the SINGLE Input owner ONCE this frame (AC2 — the sole JustDown owner for the fire edges).
    const s = this.input2.sample()

    // Once the run ended, FREEZE the world (no driving / firing / travel / collision resolution) but keep
    // ticking the FX on REAL dt so the final kill burst + the flash settle before the scene swaps (D6/AC7).
    if (this.gameOver) {
      this.effects.tick(dt)
      return
    }

    // P1 — fire off the edge (the scene owns the pool, D12), then tick movement/facing/cooldown on `gdt`. A
    // dead-but-not-yet-respawned P1 isn't driven (Tank.update early-returns while !alive — defensive).
    if (this.p1.alive) {
      if (s.p1.firePressed) this.p1.tryFire(this.bullets)
      this.p1.update(gdt, s.p1)
    }

    // P2 — gated on TWO_PLAYER (AC8). Input still returned p2 (cheap); the SCENE decides whether to drive it.
    if (TWO_PLAYER && this.p2 && this.p2.alive) {
      if (s.p2.firePressed) this.p2.tryFire(this.bullets)
      this.p2.update(gdt, s.p2)
    }

    // Advance every live bullet (hand-integrated travel on `gdt`; despawn off the playfield bounds — AC5/AC9).
    this.bullets.tick(gdt)

    // bullet × bullet scan (D5/AC4) — AFTER the travel tick so this frame's positions are fresh.
    this._scanBulletVsBullet()

    // FX tick on REAL dt (D9/D10/AC7) — the pop is independent of the gameplay dt (so a future freeze never
    // pauses the impact). No GameObject is created/destroyed per impact.
    this.effects.tick(dt)
  }

  // ── bullet × bullet scan (F3 §5.3, D5, AC4) ── a per-frame O(n²) AABB scan over the handful of live shots
  // (the cheapest CORRECT thing — n is single-digit; D5). Two OPPOSING-side bullets whose bodies overlap BOTH
  // despawn (neither passes through). Same-side shots are skipped (FF off — D8/AC9). release() only disables
  // a body, so this never mutates inside physics iteration (deferred-safe — AC10). ──
  private _scanBulletVsBullet(): void {
    const live: BulletRect[] = []
    this.bullets.forEachActive((r) => live.push(r))
    for (let i = 0; i < live.length; i++) {
      const a = live[i]
      if (!a.bx.active) continue
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]
        if (!a.bx.active) break // `a` was released by an earlier pair this frame.
        if (!b.bx.active) continue
        if (a.bx.ownerSide === b.bx.ownerSide && !FRIENDLY_FIRE) continue // same side don't cancel (D8/AC9).
        if (this._aabbOverlap(a, b)) {
          // A small spark where they meet (the midpoint), then mutual despawn.
          this.effects.explosion((a.x + b.x) / 2, (a.y + b.y) / 2)
          this.bullets.release(a)
          this.bullets.release(b)
        }
      }
    }
  }

  // A plain AABB overlap test on the two bullet bodies' physics rects (KISS — n is single-digit, D5).
  private _aabbOverlap(a: BulletRect, b: BulletRect): boolean {
    const ba = a.body as Phaser.Physics.Arcade.Body
    const bb = b.body as Phaser.Physics.Arcade.Body
    return ba.right > bb.left && ba.left < bb.right && ba.bottom > bb.top && ba.top < bb.bottom
  }
}

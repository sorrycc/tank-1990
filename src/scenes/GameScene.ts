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
  SPAWN_BLINK_TIME,
  SPAWN_STAGGER_BASE,
  CARRIER_RATE,
} from '../config/constants.js'
import { TILE } from '../config/tiles.js'
import { Input } from '../core/Input.js'
import { Tank } from '../entities/Tank.js'
import { Base } from '../entities/Base.js'
import { BulletPool } from '../combat/BulletPool.js'
import type { BulletRect } from '../combat/BulletPool.js'
import { Effects } from '../effects/Effects.js'
import { stageConfig, spawnIntervalScale, bulletSpeedScale } from '../config/stages.js'
import { generateStage } from '../world/LevelGenerator.js'
import type { StageDescription, SpawnPoint } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'
import { createRunState } from '../core/RunState.js'
import type { RunState } from '../core/RunState.js'
import { ENEMY_SPECS, rosterPick, applyStarTier } from '../config/tanks.js'
import { mulberry32 } from '../util/rng.js'
import type { RNG } from '../util/rng.js'

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

// A tank-collider GameObject carries a back-ref to its owning Tank so the bullet×tank overlap callback reads
// the victim off the struck body (DRY — the reference's `enemyRect.enemyRef`, F3 §5.3).
type TankCollider = Phaser.GameObjects.Rectangle & { tankRef?: Tank }

// The IDLE intent a spawn-BLINKING enemy is ticked with (F4 §5.3, AC2) — all zero, so update() holds the body
// still (no move, no facing change, no fire). A frozen literal shared by every blinking enemy (no allocation).
const IDLE_INTENT = { up: false, down: false, left: false, right: false, dirX: 0, dirY: 0, firePressed: false }
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

  // F3 combat state (§5.4) — the FX façade, the eagle entity, the spawn window-centers for respawn, and the
  // one-shot run-end / rebuild guards. F4 (§5.4, D10): the F3 `lives` ledger MOVED onto RunState (the source
  // of truth carried across the stage rebuild) — the scene reads runState.lives now.
  private effects!: Effects
  private base!: Base
  // The generated spawn window-center per present player slot — respawnAt re-places the tank here (DRY, D11).
  private spawnPos!: Map<number, { x: number; y: number }>
  // The present player tanks keyed by slot (1/2) — the bullet×tank overlap + the run drive these (D11).
  private playerTanks!: Map<number, Tank>
  private gameOver = false // one-shot run-end guard (D6/AC6/AC10) — _triggerGameOver fires once.
  private transitioning = false // one-shot stage-rebuild guard (F4 §5.4, D7/AC5/AC10) — _advanceStage fires once.

  // ── F4 run + enemy state (F4 §5.4, Decisions D5/D8, AC1/AC5/AC8) ──
  // runState: the SINGLE run owner (seed/stageIndex/lives/tier/score/the spawn ledger) — the scene is its
  // only writer (D5). desc: the current stage's generated description (kept so _buildStage repositions players
  // + the spawn loop reads the top enemy spawns). enemies: the live enemy tanks (ticked + torn down per stage).
  // stageRng: the seeded per-stage RNG for the roster picks (re-seeded from runState.seed each _buildStage — the
  // weighted pick is deterministic for a fixed stage seed; the AI's per-frame randomness is OFF this pin, D4).
  // spawnTimer/spawnCursor: the staggered-spawn cadence + the round-robin L→C→R cursor over the three top spawns.
  private runState!: RunState
  private desc!: StageDescription
  private enemies: Tank[] = []
  private stageRng!: RNG
  private spawnTimer = 0
  private spawnCursor = 0
  private stageLabel!: Phaser.GameObjects.Text // the "STAGE N" readout (updated in place on a stage advance).

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

    // The "STAGE N" readout — created ONCE, updated in place on a stage advance (DRY — one text object, AC5).
    this.stageLabel = this.add
      .text(DESIGN_WIDTH / 2, PLAYFIELD_Y - 28, '', {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── The SINGLE Input owner + the shared BulletPool + the FX façade (Decision D9/D12, AC2/AC7) ── these are
    // RUN-scoped (they outlive a per-stage rebuild — the pool's releaseAll() clears in-flight shots, F4 §5.4).
    this.input2 = new Input(this)
    this.bullets = new BulletPool(this)
    this.effects = new Effects(this)

    // ── Construct the SINGLE RunState (F4 §5.4, D5/D11) ── the run owner: a minted seed (replaces F3's fixed
    // DEV_SEED), the present player slots ([1] solo / [1,2] co-op — the D11 scoping), and START_LIVES per slot.
    // The scene is its ONLY writer (no module singleton — D5). The per-stage spawn ledger is seeded from stage 0.
    const presentSlots = TWO_PLAYER ? [1, 2] : [1]
    this.runState = createRunState(this._mintSeed(), presentSlots, START_LIVES)

    // ── Build the first stage via the SHARED builder (F4 §5.4, D7 — extracted so create() + every rebuild run
    // ONE path, DRY). It generates the seeded stage, the eagle, the present players, the spawn ledger, + the
    // F3 overlaps; it reads everything it needs off the RunState (seed/stageIndex/tier/the ledger).
    this._buildStage()
  }

  // ── _mintSeed() (F4 §5.4, D5) ── the WHOLE-run seed source. Mixes the wall clock so consecutive runs differ
  // (a fresh procedural run each launch); >>> 0 keeps it an unsigned 32-bit int. RunState.advance() chains it
  // deterministically from here, so the run is reproducible GIVEN this seed (the verifier drives advance() from
  // a fixed seed — determinism is proved there; this only picks the run's starting point).
  private _mintSeed(): number {
    return (Date.now() ^ (this.time.now * 2654435761)) >>> 0
  }

  // ── _buildStage() (F4 §5.4, D7, AC5) — the SHARED stage builder (create() + every rebuild call it, DRY) ──
  // Generates the SEEDED 13×13 stage from the CURRENT RunState (seed + stageIndex), builds the eagle + the
  // present players (carrying lives/tier/score on the RunState across a rebuild), seeds the per-stage RNG +
  // spawn ledger + cursor, and registers the F3 bullet×solids + bullet×tank overlaps. Repositions only the
  // PRESENT players (D11). Leaves `enemies` empty (the staggered spawn loop streams them in update — AC1).
  private _buildStage(): void {
    const cfg = stageConfig(this.runState.stageIndex)
    this.desc = generateStage(this.runState.seed, cfg)
    this.tileMap = new TileMap(this, this.desc)
    this.stageLabel.setText(`STAGE ${this.runState.stageIndex + 1}`)

    // The per-stage roster RNG — seeded from the run seed so the weighted picks are deterministic for a fixed
    // stage (the AI's per-frame randomness is separate, OFF this pin — D4). Reset the spawn cadence + cursor.
    this.stageRng = mulberry32(this.runState.seed)
    this.spawnTimer = 0
    this.spawnCursor = 0
    this.enemies = []

    // ── The eagle entity (F3 §5.4, D3/D6, AC6) ── draw the eagle VISUAL at the BASE tile's window-center
    // (the same coord F2's TileMap drew its TILE.BASE body at — DRY). The tank-blocking STATIC BODY ALREADY
    // exists in `solidBodies` (F2 emitted it). Wire the run-over edge to the guarded _triggerGameOver (D6).
    this.base = new Base(this, this.desc.base.x, this.desc.base.y)
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

    // ── Spawn the player tank(s) (F4 §5.4, D10/D11/D13) ── P1 always; P2 only when TWO_PLAYER. Each is built
    // FRESH per stage (the teardown destroyed the previous one) so its terrain collider + bullet overlap bind
    // to THIS stage's tilemap (no stale-collider / duplicate-overlap leak across a rebuild — AC10). The run
    // state (lives/tier/score) lives on the RunState (D10), so building fresh loses nothing. A player with NO
    // lives left this stage is NOT spawned (it stayed down — the run continues until every present player is
    // spent or the eagle dies). The spawn-position + playerTanks maps are seeded for the PRESENT players ONLY
    // (D11 — a phantom P2 is never seeded when solo, so _checkRunOver can't be blocked).
    this.spawnPos = new Map<number, { x: number; y: number }>()
    this.playerTanks = new Map<number, Tank>()

    const sp1 = this.desc.playerSpawns[0]
    this.p1 = this._buildPlayer(1, sp1.x, sp1.y)
    if (TWO_PLAYER) {
      const sp2 = this.desc.playerSpawns[1]
      this.p2 = this._buildPlayer(2, sp2.x, sp2.y)
      this.physics.add.collider(this.p1.collider, this.p2.collider) // the two tanks can't overlap.
    }

    // ── Register the F3 overlaps (F3 §5.4, D1/D3, AC1–AC6/AC9) ──
    // bullet × terrain solids: ONE callback resolves brick (chip + despawn) / steel (despawn) / the eagle
    // (run over + despawn) by switching on the struck body's tileKind tag (D2/D3). The processCallback
    // early-returns while gameOver/transitioning (the reference's filter style) + on a stale bullet handle.
    this.physics.add.overlap(
      this.bullets.group,
      this.tileMap.solidBodies,
      (bulletRect, solidRect) => this._onBulletHitSolid(bulletRect as BulletRect, solidRect as SolidRect),
      (bulletRect) => !this.gameOver && !this.transitioning && (bulletRect as BulletRect).bx.active,
      this,
    )
    // (The bullet × player tank overlaps are registered per-player inside _buildPlayer; enemy tanks register
    // their OWN in _spawnStep — all into the SAME side-generic shape via _registerTankOverlap, D9/AC9.)
  }

  // ── _buildPlayer(slot,x,y) (F4 §5.4, D10/D11) ── build a present player FRESH for this stage. Construct it
  // with the spec ctor folded over the player's tier (applyStarTier(runState.tier[slot]) — PLAYER_BASE at tier
  // 0, the F1 feel preserved since PLAYER_BASE == the F1 constants), collide it against THIS stage's terrain,
  // tag its collider with the back-ref, register its bullet×tank overlap (the F3 seam — D9), and wire its
  // onDeath to the life/respawn path (D11). Lives/tier live on RunState (carried across the rebuild — D10), so
  // a fresh tank loses nothing. A player out of lives stays DOWN (a parked corpse — no respawn, but still in
  // the playerTanks map so _checkRunOver counts it). Seed the spawn-position + playerTanks maps for the slot.
  private _buildPlayer(slot: number, x: number, y: number): Tank {
    const tank = new Tank(this, x, y, 'player', applyStarTier(this.runState.tier[slot] ?? 0))
    ;(tank.collider as TankCollider).tankRef = tank // the bullet×tank overlap reads the victim off this (DRY).
    this._collideTankWithTerrain(tank) // AC10 (F2) — the tank stops at brick/steel/water/the eagle.
    this._registerTankOverlap(tank) // the bullet×tank damage funnel (F3 seam, side-generic — D9/AC9).
    tank.onDeath = () => this._onPlayerDeath(slot, tank)
    // A player with no lives left this stage stays DOWN (its body parked/hidden) — it is still counted by
    // _checkRunOver (the run ends only when EVERY present player is spent). respawnAt arms i-frames on a kill.
    if ((this.runState.lives[slot] ?? 0) <= 0) {
      tank.alive = false
      tank.rect.setVisible(false)
      tank.barrel.setVisible(false)
      tank.body.enable = false
    }
    this.spawnPos.set(slot, { x, y })
    this.playerTanks.set(slot, tank)
    return tank
  }

  // Collide a tank against BOTH tank-blocking body groups (F2 §5.4, D7/D11): `solidBodies` (STEEL + BASE +
  // every BRICK sub-cell — so a tank can't drive onto the eagle, AC6) AND `waterBodies` (WATER blocks tanks).
  private _collideTankWithTerrain(tank: Tank): void {
    this.physics.add.collider(tank.collider, this.tileMap.solidBodies)
    this.physics.add.collider(tank.collider, this.tileMap.waterBodies)
  }

  // ── _registerTankOverlap(tank) (F4 §5.4, D9, AC9) ── register a tank's collider into the bullet×tank overlap
  // — the SAME shape F3 used for players, GENERIC over `side` (the F3 seam — so an enemy plugs in with NO new
  // overlap architecture, D9). The filter/resolution (_bulletCanHitTank/_onBulletHitTank) are side-generic +
  // friendly-fire-filtered, so a player bullet kills an enemy + an enemy bullet kills a player/the eagle, but
  // same-side shots pass (FF off — for FREE). NO bullet×water overlap (bullets fly over water — AC3).
  private _registerTankOverlap(tank: Tank): void {
    this.physics.add.overlap(
      this.bullets.group,
      tank.collider,
      (bulletRect, tankRect) => this._onBulletHitTank(bulletRect as BulletRect, tankRect as TankCollider),
      (bulletRect, tankRect) => this._bulletCanHitTank(bulletRect as BulletRect, tankRect as TankCollider),
      this,
    )
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
    // F4 (D10): lives live on RunState now (carried across a stage rebuild). Spend one + floor at 0.
    const remaining = (this.runState.lives[slot] ?? 0) - 1
    this.runState.lives[slot] = Math.max(0, remaining)
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
    for (const slot of this.playerTanks.keys()) {
      if ((this.runState.lives[slot] ?? 0) > 0) return // someone still has a life → the run continues.
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

  // ── _spawnStep(gdt) (F4 §5.3/§5.4, Decisions D8, AC1/AC2/AC7) — the staggered/capped spawn loop ──
  // Decays a spawn timer (on the GAMEPLAY dt so a future freeze pauses spawning too). When it elapses AND a
  // slot is free (enemiesAlive < the stage's concurrentEnemies cap) AND there is a queued enemy, spawn ONE at
  // the next top spawn point (round-robin L→C→R over the three F2 window-centers), pick its archetype via the
  // PURE rosterPick (deterministic for the stage seed), flag it a carrier on a CARRIER_RATE roll, blink it
  // (SPAWN_BLINK_TIME — inert during the blink, AC2), register the F3 overlap (D9), wire its onDeath +
  // onDropFlag, and update the ledger. The stagger scales by the stage's spawnIntervalScale (deeper → faster).
  private _spawnStep(gdt: number): void {
    this.spawnTimer = Math.max(0, this.spawnTimer - gdt)
    if (this.spawnTimer > 0) return

    const cfg = stageConfig(this.runState.stageIndex)
    if (this.runState.enemiesQueued <= 0) return // nothing left to stream in this stage.
    if (this.runState.enemiesAlive >= cfg.concurrentEnemies) return // the on-screen cap is full — wait (AC1).

    // Round-robin the three top enemy spawns (L→C→R) — the F2 generated window-centers (tankFits anchors, D13).
    const topSpawns: SpawnPoint[] = this.desc.enemySpawns
    const point = topSpawns[this.spawnCursor % topSpawns.length]
    this.spawnCursor++

    // Pick the archetype via the PURE weighted roster pick (deterministic for the stage seed — D1/D8), then
    // scale the spec's bullet speed by the stage's monotone bulletSpeedScale (the enemy fire pressure, AC6).
    const id = rosterPick(this.stageRng, cfg.enemyWeights)
    const base = ENEMY_SPECS[id]
    const spec = { ...base, bulletSpeed: Math.round(base.bulletSpeed * bulletSpeedScale(this.runState.stageIndex)) }

    const enemy = new Tank(this, point.x, point.y, 'enemy', spec) // the WHOLE spec → all per-type stats (AC4).
    ;(enemy.collider as TankCollider).tankRef = enemy
    this._collideTankWithTerrain(enemy) // enemies stop at terrain too (F2 colliders — DRY).
    enemy.carrier = this.stageRng() < CARRIER_RATE // red-flash power-up carrier (AC7).
    enemy.spawnIframe = SPAWN_BLINK_TIME // blink before active/lethal (AC2 — inert during the blink).
    enemy.onDeath = () => this._onEnemyKilled(enemy)
    // The drop-flag hook fires ONCE at death for a carrier (the F5 pickup seam — F4 marks the drop point only).
    enemy.onDropFlag = enemy.carrier ? (x, y) => this._markDrop(x, y) : null
    this._registerTankOverlap(enemy) // the SAME bullet×tank overlap as players (F3 seam, D9/AC9).
    this.enemies.push(enemy)

    // Update the per-stage ledger (D8): one fewer queued, one more alive. enemiesRemaining = queued + alive
    // (kept in sync so the HUD/readout + the clear predicate read one truth).
    this.runState.enemiesQueued--
    this.runState.enemiesAlive++

    // Re-arm the spawn timer at the stage-scaled cadence (deeper stages stream faster, never instant — D8/AC6).
    this.spawnTimer = SPAWN_STAGGER_BASE * spawnIntervalScale(this.runState.stageIndex)
  }

  // ── _tickEnemies(gdt) (F4 §5.3, Decisions D2/D3, AC2/AC3) ── drive every LIVE enemy. A spawn-BLINKING enemy
  // (spawnIframe > 0) is INERT: it ticks update (decaying the blink) with an IDLE intent — no move, no AI, no
  // fire (AC2). An active enemy runs updateAI (building its wander/seek intent), then update() drives it through
  // the SAME movement spine the player uses (DRY — D3), and tryFire fires on the AI's beat. The AI ctx is the
  // eagle center + the present ALIVE players' centers (the seek targets — AC3).
  private _tickEnemies(gdt: number): void {
    const eagle = { x: this.desc.base.x, y: this.desc.base.y }
    const players: { x: number; y: number }[] = []
    for (const t of this.playerTanks.values()) {
      if (t.alive && t.isHittable()) players.push({ x: t.body.center.x, y: t.body.center.y })
    }
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      if (enemy.spawnIframe > 0) {
        enemy.update(gdt, IDLE_INTENT) // blinking — decay the i-frame; no move/fire (AC2).
        continue
      }
      enemy.updateAI(gdt, { eagle, players }) // build the wander/seek intent (AC3).
      enemy.update(gdt, enemy.aiIntent) // drive it through the SAME spine (DRY — D3).
      if (enemy.aiIntent.firePressed) enemy.tryFire(this.bullets) // fire on the beat (the F1 fire path, D3).
    }
  }

  // ── _onEnemyKilled(enemy) (F4 §5.3, Decisions D7/D10, AC5/AC7) ── the enemy's onDeath fired (HP funnel hit 0,
  // F3). Bank its score (D10), decrement the alive ledger, fire the carrier drop-flag ONCE (AC7), and — if this
  // was the LAST enemy of the stage (none queued, none alive) — DEFER the stage advance out of this death/overlap
  // callback under the one-shot `transitioning` guard (the footgun discipline — AC10). The F3 onHit already
  // hid + disabled the corpse; we remove it from the live list (its body is torn down on the stage teardown).
  private _onEnemyKilled(enemy: Tank): void {
    this.effects.explosion(enemy.collider.x, enemy.collider.y, { big: true }) // the kill burst at the tank center.
    this.runState.score += enemy.spec.scoreValue // bank the score (D10 — the HUD/Hub features render/spend it).
    this.runState.enemiesAlive = Math.max(0, this.runState.enemiesAlive - 1)
    this.runState.enemiesRemaining = this.runState.enemiesQueued + this.runState.enemiesAlive
    // A carrier drops a power-up: fire the hook ONCE with the death center (the F5 pickup seam — AC7). F4 marks
    // the drop point; no power-up entity is constructed here (YAGNI).
    if (enemy.carrier && enemy.onDropFlag) {
      enemy.onDropFlag(enemy.collider.x, enemy.collider.y)
      enemy.onDropFlag = null // one-shot (a same-frame double-hit can't re-fire — mirrors onDeath's discipline).
    }

    // The stage-clear predicate (AC5): no more queued AND none alive → every enemy is dead. Defer the rebuild
    // out of this callback under the one-shot guard (a multi-frame final-kill advances exactly once — AC10).
    if (this.runState.enemiesQueued <= 0 && this.runState.enemiesAlive <= 0 && !this.transitioning && !this.gameOver) {
      this.transitioning = true
      this.time.delayedCall(0, () => this._advanceStage())
    }
  }

  // ── _markDrop(x,y) (F4 §5.3, AC7) ── the F5 power-up-pickup SEAM: a carrier died here. F4 pops a brief FX
  // marker at the drop center (NO power-up entity is spawned — YAGNI); F5 swaps in the pickup spawn.
  private _markDrop(x: number, y: number): void {
    this.effects.explosion(x, y, { big: true }) // a brief marker burst where the power-up will drop (F5).
  }

  // ── _advanceStage() (F4 §5.3/§5.4, Decisions D5/D6/D7, AC5/AC10) ── the deferred stage→stage advance (run
  // through delayedCall(0) out of the death callback — AC10). Advance the RunState (next seed + stageIndex++ +
  // reseed the spawn ledger — D5/D6), tear down the per-stage world (leaks nothing — AC10), rebuild the next
  // (harder) stage IN PLACE via the SHARED _buildStage (carrying lives/tier/score on the RunState — D10), and
  // clear the one-shot guard. A guard re-check defends against a run-over racing the defer.
  private _advanceStage(): void {
    if (this.gameOver) {
      this.transitioning = false
      return
    }
    this.runState.advance() // next seed + stageIndex++ + reseed the ledger (D5/D6).
    this._teardownStage() // destroy the tilemap / enemies / in-flight bullets / the eagle visual (AC10).
    this._buildStage() // rebuild the next stage IN PLACE (carries lives/tier/score on the RunState — D10).
    this.transitioning = false // re-arm for the next stage.
  }

  // ── _teardownStage() (F4 §5.4, D7/D10, AC10) ── tear down EVERY per-stage GameObject so a rebuild leaks none:
  // release every in-flight bullet (BulletPool.releaseAll, F1 — a teardown is not a despawn, so no live-count
  // touch), destroy every enemy AND player tank (its collider/rect/barrel — their colliders/overlaps bind to
  // THIS stage's tilemap, so they must go + be rebuilt fresh against the next one — no stale collider, no
  // duplicate overlap), destroy the tilemap (its solid/water bodies + decorations — TileMap.destroy, F2), and
  // destroy the eagle VISUAL (its blocking body rode inside the tilemap — already gone). The RUN-scoped
  // resources (Input, the bullet POOL itself, Effects, the RunState) survive; _buildStage rebuilds the rest.
  // Runs OUTSIDE any overlap/death callback (called from _advanceStage's delayedCall(0) — AC10), so destroying
  // bodies here is safe (no body destroyed mid-step). The run economy (lives/tier/score) is on RunState (D10).
  private _teardownStage(): void {
    this.bullets.releaseAll() // clear in-flight shots (F1 — no live-count decrement; a teardown is not a despawn).
    for (const tank of this.enemies) this._destroyTank(tank)
    this.enemies = []
    for (const tank of this.playerTanks.values()) this._destroyTank(tank)
    this.playerTanks.clear()
    this.tileMap.destroy() // F2 — destroys the solid/water bodies + decorations (the eagle's body rode here).
    this.base.rect.destroy() // the eagle VISUAL (its blocking body was a tilemap solid — already destroyed).
  }

  // Destroy a tank's three GameObjects (the collider owning the body + the visible rect + the barrel). Phaser
  // destroying a GameObject also destroys its body + removes it from every group/collider it was registered in
  // (so the bullet×tank overlap + the terrain colliders go with it — no stale handle, AC10). KISS, DRY.
  private _destroyTank(tank: Tank): void {
    tank.collider.destroy()
    tank.rect.destroy()
    tank.barrel.destroy()
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

    // F4 (§5.3, AC1/AC2/AC3) — stream new enemies in (staggered + capped), then tick every live enemy's AI +
    // movement + fire. Both run on the GAMEPLAY dt (a future freeze pauses spawning + the enemy AI too). While
    // transitioning (the deferred stage rebuild is queued) we skip both — the world is mid-teardown.
    if (!this.transitioning) {
      this._spawnStep(gdt)
      this._tickEnemies(gdt)
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

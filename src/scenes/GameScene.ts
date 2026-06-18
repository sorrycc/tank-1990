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
  STAGE_CLEARED_BANNER_SEC,
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
import type { RunState, SlotSeed } from '../core/RunState.js'
import { ENEMY_SPECS, rosterPick, applyStarTier, bossSpecForStage } from '../config/tanks.js'
import { applyUpgrades } from '../config/tank-upgrades.js'
import { mulberry32 } from '../util/rng.js'
import type { RNG } from '../util/rng.js'
// ── F5 Power-ups & meta (F5 §5.4) ── the pooled power-up entity + the persistence-facing meta wrapper. The
// PowerUpPool is run-scoped (beside BulletPool); MetaState is read ONCE in create() (the impure save boundary)
// + cached so the per-frame fold/HUD publish never touches localStorage.
import { PowerUpPool } from '../entities/PowerUp.js'
import type { PowerUpRect } from '../entities/PowerUp.js'
import { createMetaState } from '../core/MetaState.js'
import type { MetaStateInstance } from '../core/MetaState.js'
import {
  pickPowerUpKind,
  HELMET_SHIELD_SEC,
  CLOCK_FREEZE_SEC,
  SHOVEL_FORTIFY_SEC,
} from '../config/powerups.js'
import type { PowerUpKind } from '../config/powerups.js'
// ── F6 Boss & co-op polish (F6 §5.4/§5.5) ── the WebAudio SFX façade (the one audio owner — D6) + the i18n
// banner template. Sound is Phaser/WebAudio-coupled (never verifier-imported); the banner string is localised
// via t('hud.stageCleared') and published to the registry for the parallel HUD to render (the decoupling — D5).
import { Sound } from '../audio/Sound.js'
import { t } from '../i18n/index.js'
// ── F7 Rich playability (F7 §5.3) ── the read-only pause overlay (a GameScene-owned modal, NOT a new scene — D3).
// Phaser-coupled; NEVER imported by the verifier. GameScene news it up on the P/ESC edge + tears it on resume.
import { PauseOverlay } from '../entities/PauseOverlay.js'
import type { RunInfo } from '../entities/PauseOverlay.js'

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

// (D3, AC2) — the STAGE-N intro-curtain duration (SECONDS). A brief beat before each stage's enemies stream in
// (the classic "STAGE N" curtain). A coupled-scene tunable (not a shared pure number), so it lives here, not in
// constants.ts. ~1.4 s sits in the spec's ~1.2–1.6 s window — long enough to read the stage, short enough to feel snappy.
const STAGE_INTRO_SEC = 1.4 // s — how long the STAGE-N intro curtain holds before enemy spawning/AI resumes.
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
  // The bullet×terrain overlap (bullets.group × tileMap.solidBodies). RUN-scoped × STAGE-scoped: bullets.group
  // survives a teardown, but tileMap.destroy() nulls solidBodies.children. Phaser only drops a collider via
  // Collider.destroy() (never when a referenced group dies), so _teardownStage() must destroy THIS handle before
  // the next world.step — else collideGroupVsGroup reads the dead group's .children.size and throws (AC1/AC2).
  private _bulletTerrainOverlap?: Phaser.Physics.Arcade.Collider

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

  // ── F5 power-up + meta state (F5 §5.4, Decisions D1/D4/D4b/D8, AC1/AC2/AC5/AC6) ──
  // powerups: the run-scoped pooled power-up entity (the carrier-death drop + the player×pickup overlap). meta:
  // the persistence wrapper, loaded ONCE in create() (the impure save boundary) — the per-frame HUD publish + the
  // live spec re-fold read the CACHED `upgrades[slot]` (D4b), never localStorage per frame. ringCells: the eagle
  // fort-ring tile coords, derived ONCE from desc.base (the shovel fortify/revert target — D4a/§5.3 step 2).
  // shovelWasActive: the shovel-timer FALLING-edge latch so the revert fires exactly once when the timer hits 0.
  private powerups!: PowerUpPool
  private meta!: MetaStateInstance
  private upgrades: Record<number, Record<string, number>> = {} // cached per-slot Hub tree (read once — D4b).
  private ringCells: Array<{ col: number; row: number }> = [] // the fort-ring tile coords (D4a).
  private shovelWasActive = false // the shovel-timer falling-edge latch (revert fires once — D4a/D10).

  // ── F6 boss + banner + audio state (F6 §5.4, Decisions D4/D5/D6/D8, AC1/AC3/AC4/AC6) ──
  // sfx: the ONE audio owner (the reference's per-scene `new Sound(this)` — D6; named `sfx`, NOT `sound`, so it
  // does not shadow Phaser.Scene's own public `sound` manager). Constructed in create(); every resolution site
  // calls an `sfx.*` method; the M key flips its mute proxy (D8). boss/bossSpawned: the capstone boss + the
  // "spawned this stage?" latch (D4 — the boss spawns ONCE, after the normal roster clears). bannerTimer/bannerStage:
  // the STAGE-N-CLEARED banner countdown (decayed on the REAL dt so it shows through the run-end freeze beat) + the
  // human stage number it shows (D5). All reset in _buildStage (a fresh stage hasn't spawned its boss).
  private sfx!: Sound
  private boss: Tank | null = null
  private bossSpawned = false
  private bannerTimer = 0
  private bannerStage = 0

  // ── STAGE-N intro curtain (D3/D4/D5, AC2/AC3) ── `curtainTimer` is the SECONDS remaining on the brief "STAGE N"
  // intro shown before each stage's enemies stream in. Armed in _buildStage (so EVERY stage — the first + each
  // advance — opens on it), decayed on the REAL dt in update(); while > 0 the spawn loop + enemy tick are gated
  // (the player + bullets stay live — only the enemy pair is paused) and _publishHud mirrors a centered label to
  // the HUD via the registry (the SAME pattern as the STAGE-N-CLEARED banner — GameScene owns WHEN, the HUD HOW).
  private curtainTimer = 0

  // ── F7 pause state (F7 §5.3, Decisions D3/D4, AC4) ── `paused` gates update()'s gameplay block (the SAME
  // freeze idiom the gameOver branch uses — while paused the world is FULLY frozen but the FX pool still settles
  // on REAL dt, NOT a hard return). pauseOverlay is the live read-only modal (null when not paused). Pause is
  // unavailable once the run ended (gameOver) or mid stage-transition (D3). The close-press P/ESC edge is
  // consumed via input2.consumePause() so it can't re-open pause / leak a fire on the resume frame (D4).
  private paused = false
  private pauseOverlay: PauseOverlay | null = null

  constructor() {
    super('Game')
  }

  create(): void {
    // Reset the one-shot guards on (re)entry — a scene restart must start a fresh run (D6/AC10).
    this.gameOver = false
    this.transitioning = false
    // F7 (D3) — a fresh scene is never paused (a leftover overlay from a prior instance is force-torn defensively).
    this.paused = false
    if (this.pauseOverlay) {
      this.pauseOverlay.close()
      this.pauseOverlay = null
    }

    // Launch the HUD as a PARALLEL overlay (launch, NOT start, so GameScene keeps running underneath). (F0 AC6.)
    this.scene.launch('HUD')

    // The centered 13×13 square playfield outline (kept from F0/F2), drawn with a Graphics primitive (AC11).
    const g = this.add.graphics()
    g.lineStyle(2, 0x30363d, 1)
    g.strokeRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)

    // Fence the Arcade world to the playfield rectangle so a tank (whose body opts into collideWorldBounds —
    // Tank ctor) stops at the playfield edges and can NOT drive out of the scene. The procedural LevelGenerator
    // builds no border walls (the grid edge is only a conceptual wall for the headless reachability BFS), so the
    // world bounds are the outer fence. Set ONCE here: the Arcade world persists across the in-place stage
    // rebuild (_buildStage rebuilds bodies, not the world). Bullets are UNAFFECTED — they never opt into
    // collideWorldBounds and keep their own PLAYFIELD_* despawn check (BulletPool.tick), so they still fly off
    // the edge and despawn. Only tank bodies set collideWorldBounds, so nothing else is constrained.
    this.physics.world.setBounds(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)

    // The "STAGE N" readout — created ONCE, updated in place on a stage advance (DRY — one text object, AC5).
    this.stageLabel = this.add
      .text(DESIGN_WIDTH / 2, PLAYFIELD_Y - 28, '', {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── The SINGLE Input owner + the shared BulletPool + the FX façade + the power-up pool (Decision D9/D12/D1,
    // AC2/AC7/AC1) ── all RUN-scoped (they outlive a per-stage rebuild — the pools' releaseAll() clears in-flight
    // shots/pickups, F4/F5 §5.4). The PowerUpPool sits beside BulletPool: the carrier-death drop acquires from it
    // + each player's overlap collects from it (D1).
    this.input2 = new Input(this)
    this.bullets = new BulletPool(this)
    this.effects = new Effects(this)
    this.powerups = new PowerUpPool(this)

    // ── F6 (D6/D8, AC6) — the ONE audio owner + the M mute toggle ── construct the WebAudio façade once (the
    // reference's per-scene `new Sound(this)`); every resolution site below calls a `sound.*` method (the scene
    // orchestrates world events, the entities stay audio-free — D6). A NoAudio manager makes every call a safe
    // no-op (AC6). The M key flips Phaser's GLOBAL mute via the façade's proxy (D8 — runtime only, not persisted);
    // `keyup-M` (once per release) avoids a held key machine-gunning the toggle. The HUD reads `hud.muted` for a cue.
    this.sfx = new Sound(this)
    this.input.keyboard!.on('keydown-M', () => {
      this.sfx.mute = !this.sfx.mute
    })

    // ── Load the persistent meta ONCE (F5 §5.4, D8/D4b — the impure save boundary) ── createMetaState() load()s a
    // FRESH view of localStorage (reflecting any Hub buys + the prior run's bank). Cache each present slot's Hub
    // tree (upgrades[slot]) so the per-frame live spec re-fold + the HUD currency read NEVER touch storage (D4b).
    // The save.ts try/catch makes a disabled storage degrade to in-memory defaults (never throws — AC5).
    this.meta = createMetaState()
    const presentSlots = TWO_PLAYER ? [1, 2] : [1]
    for (const slot of presentSlots) this.upgrades[slot] = this.meta.getUpgrades(slot as 1 | 2)

    // ── Construct the SINGLE RunState (F4 §5.4 + F5 §5.4, D5/D5b/D11) ── the run owner: a minted seed, and a
    // PER-SLOT { [slot]: {lives, tier} } seed map (F5 D5b — replaces F4's scalar startLives). Each present slot's
    // run-start lives/tier come from THAT slot's folded Hub spec (MetaState.startSpec): lives = START_LIVES +
    // spec.startLivesBonus, tier = spec.startTier (the +startLife/+starStart upgrades land at run start — D7). A
    // fresh meta yields {lives: START_LIVES, tier: 0} (the F4 behaviour, per-slot). The scene is its ONLY writer (D5).
    const seeds: Record<number, SlotSeed> = {}
    for (const slot of presentSlots) {
      const spec = this.meta.startSpec(slot as 1 | 2)
      seeds[slot] = { lives: START_LIVES + (spec.startLivesBonus ?? 0), tier: spec.startTier ?? 0 }
    }
    this.runState = createRunState(this._mintSeed(), seeds)
    this.shovelWasActive = false // F5 (D4a) — the shovel falling-edge latch starts clear.

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

    // F6 (D4) — a fresh stage hasn't spawned its boss yet (the capstone latch resets each stage). The banner timer
    // is NOT reset here (it decays on its own + must survive a stage advance so the just-cleared banner finishes
    // showing into the new stage's first frames — _advanceStage rebuilds the world but the banner is a HUD overlay).
    this.boss = null
    this.bossSpawned = false

    // ── The fort-ring tile coords (F5 §5.4, D4a) ── derive ONCE per stage from desc.base: the in-grid orthogonal
    // BRICK neighbours of the base (the SAME fort ring LevelGenerator §5.3 step 2 stamps — DRY, no generator call).
    // The shovel power-up's fortifyBaseRing/revertBaseRing swap exactly these tiles' brick ⇄ steel (D4a/§5.5).
    this.ringCells = this._deriveRingCells()

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
    // Hold the handle (D1): bullets.group is RUN-scoped and outlives this stage's solidBodies, so _teardownStage()
    // destroys THIS collider before tileMap.destroy() nulls solidBodies.children — otherwise the stale overlap
    // crashes collideGroupVsGroup on the next world.step (AC2). Reassigning each _buildStage() keeps one source.
    this._bulletTerrainOverlap = this.physics.add.overlap(
      this.bullets.group,
      this.tileMap.solidBodies,
      (bulletRect, solidRect) => this._onBulletHitSolid(bulletRect as BulletRect, solidRect as SolidRect),
      (bulletRect) => !this.gameOver && !this.transitioning && (bulletRect as BulletRect).bx.active,
      this,
    )
    // (The bullet × player tank overlaps are registered per-player inside _buildPlayer; enemy tanks register
    // their OWN in _spawnStep — all into the SAME side-generic shape via _registerTankOverlap, D9/AC9.)

    // (D3, AC2) — arm the STAGE-N intro curtain. EVERY stage opens on it (the first build + each advance call this
    // SHARED builder, DRY): update() gates the spawn loop + enemy tick while curtainTimer > 0, and _publishHud
    // mirrors the centered "STAGE N" label to the HUD. The world is built + visible underneath (the player can move).
    this.curtainTimer = STAGE_INTRO_SEC
  }

  // ── _buildPlayer(slot,x,y) (F4 §5.4, D10/D11) ── build a present player FRESH for this stage. Construct it
  // with the spec ctor folded over the player's tier (applyStarTier(runState.tier[slot]) — PLAYER_BASE at tier
  // 0, the F1 feel preserved since PLAYER_BASE == the F1 constants), collide it against THIS stage's terrain,
  // tag its collider with the back-ref, register its bullet×tank overlap (the F3 seam — D9), and wire its
  // onDeath to the life/respawn path (D11). Lives/tier live on RunState (carried across the rebuild — D10), so
  // a fresh tank loses nothing. A player out of lives stays DOWN (a parked corpse — no respawn, but still in
  // the playerTanks map so _checkRunOver counts it). Seed the spawn-position + playerTanks maps for the slot.
  private _buildPlayer(slot: number, x: number, y: number): Tank {
    // F5 (D4b): the running tank spec folds the per-player Hub tree OVER the carried star tier —
    // applyUpgrades(applyStarTier(tier[slot]), this.upgrades[slot]) — so +maxBullets/+bulletSpeed/+tankSpeed/
    // +baseArmor reach the live tank AND a mid-run star COMPOSES with (never strips) the Hub upgrades (AC2/AC6).
    // The cached this.upgrades[slot] was read once in create() (no per-frame save touch). The SAME expression
    // the star re-fold uses (DRY — _refoldPlayerSpec).
    const tank = new Tank(this, x, y, 'player', this._playerSpec(slot))
    ;(tank.collider as TankCollider).tankRef = tank // the bullet×tank overlap reads the victim off this (DRY).
    this._collideTankWithTerrain(tank) // AC10 (F2) — the tank stops at brick/steel/water/the eagle.
    this._registerTankOverlap(tank) // the bullet×tank damage funnel (F3 seam, side-generic — D9/AC9).
    this._registerPowerUpOverlap(slot, tank) // F5 (D1) — the player×pickup collect funnel (the new seam).
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
      // Phaser invokes a sprite-vs-group overlap callback as (sprite, groupMember): World.collideHandler swaps a
      // group/sprite pair into collideSpriteVsGroup(sprite, group), which fires BOTH the collide and process
      // callbacks as (bodyA=sprite, bodyB=member). tank.collider is the SPRITE, the bullet is the GROUP member —
      // so the tank collider is arg1 and the bullet is arg2 (the INVERSE of the group-vs-group terrain overlap
      // above, where bullets.group is object1 → the bullet is arg1, and matching the sprite-vs-group power-up
      // overlap in _registerPowerUpOverlap). Bind accordingly; the two handlers keep their (bullet, tank) shape.
      (tankRect, bulletRect) => this._onBulletHitTank(bulletRect as BulletRect, tankRect as TankCollider),
      (tankRect, bulletRect) => this._bulletCanHitTank(bulletRect as BulletRect, tankRect as TankCollider),
      this,
    )
  }

  // ── _playerSpec(slot) (F5 §5.4, D4b, AC2/AC6) ── the live player tank spec: the per-player Hub tree folded
  // OVER the carried star tier. applyUpgrades(applyStarTier(tier[slot]), upgrades[slot]) — so the Hub upgrades
  // (+maxBullets/+bulletSpeed/+tankSpeed/+baseArmor) reach the running tank AND a star power-up COMPOSES with the
  // Hub tree (never strips it). The cached this.upgrades[slot] needs no per-frame save touch. ONE expression,
  // ONE source of truth (the build site + the star re-fold both call this — DRY).
  private _playerSpec(slot: number) {
    return applyUpgrades(applyStarTier(this.runState.tier[slot] ?? 0), this.upgrades[slot] ?? {})
  }

  // ── _refoldPlayerSpec(slot) (F5 §5.4, D4b, AC2/AC6 — the star re-fold) ── after a star bumps tier[slot], rebuild
  // the live tank's per-tank feel fields from the re-folded spec so the faster bullet / more shots apply WITHOUT a
  // full respawn (re-placing the body would feel like a death). Copy ONLY the magnitude fields Tank reads in
  // update()/tryFire() (the same fields the ctor copies — DRY). The Hub tree is folded OVER the new tier, so the
  // star composes with the bought stats (never strips them). A no-op if the slot's tank is gone (defensive).
  private _refoldPlayerSpec(slot: number): void {
    const tank = this.playerTanks.get(slot)
    if (!tank) return
    const spec = this._playerSpec(slot)
    tank.spec = spec
    tank.maxBullets = spec.maxBullets
    tank.moveSpeed = spec.moveSpeed
    tank.bulletSpeed = spec.bulletSpeed
    tank.fireCooldown = spec.fireCooldown
    // maxHp/hp are NOT bumped mid-run by a star (a star is an offence up-tier, not a heal — the classic); the
    // baseArmor Hub upgrade already seeded the run-start maxHp via the spec at _buildPlayer (D7).
  }

  // ── _registerPowerUpOverlap(slot, tank) (F5 §5.4, D1, AC2) ── register a player tank's collider into the
  // player×pickup overlap (the SAME shape as the bullet×tank overlap — the pool group × the tank collider). On a
  // live player tank touching a live pickup the callback reads `rect.pu.kind`, releases the pickup (release() only
  // DISABLES the body — safe inside the step, D10), and applies the effect via the ONE _applyPowerUp switch. The
  // overlap goes with the rebuilt tank on a stage teardown (Phaser destroys the collider → removes the overlap —
  // no stale handle, AC10). The filter early-returns while gameOver/transitioning + on a dead tank.
  private _registerPowerUpOverlap(slot: number, tank: Tank): void {
    this.physics.add.overlap(
      tank.collider,
      this.powerups.group,
      (_tankRect, puRect) => this._onPlayerGetPowerUp(slot, puRect as PowerUpRect),
      () => !this.gameOver && !this.transitioning && tank.alive,
      this,
    )
  }

  // ── _onPlayerGetPowerUp(slot, puRect) (F5 §5.4, D1/D4/D10, AC2) ── the player×pickup overlap resolution. Read
  // the kind off the struck pickup, release it (DISABLE only — safe in the step), and apply the effect. The
  // re-guard defends a same-frame double-overlap (a released pickup's pu.active is false). DESTRUCTIVE effects
  // (grenade/shovel) DEFER their body work out of this callback (D10 — see _applyPowerUp).
  private _onPlayerGetPowerUp(slot: number, puRect: PowerUpRect): void {
    if (!puRect.pu.active) return // already collected this frame (a multi-overlap race) — ignore.
    const kind = puRect.pu.kind
    this.powerups.release(puRect) // release() only DISABLES the body — safe inside the overlap step (D10/AC10).
    if (kind) this._applyPowerUp(slot, kind)
  }

  // ── _applyPowerUp(slot, kind) (F5 §5.4, D4/D10, AC2) ── the SIX effects in ONE switch. Each writes an EXISTING
  // F4 run-economy seam (freezeTimer/shovelTimer/tier/lives/spawnIframe) + the ONE new shieldTimer field, not a
  // new subsystem (KISS/DRY/YAGNI). DESTRUCTIVE effects (grenade kills enemies; shovel swaps the ring's bodies)
  // DEFER their body work out of this overlap callback via time.delayedCall(0) (the F3/F4 footgun discipline —
  // D10/AC10). The scene owns the run economy (SOLID — the pool reports a kind, the scene applies it).
  private _applyPowerUp(slot: number, kind: PowerUpKind): void {
    // F6 (D6/AC6) — the pickup blip for EVERY kind, plus the 1-up chime layered on for the `tank` (+1 life) kind
    // (a distinct throttle key so it isn't swallowed by the same-frame powerUp()). The scene owns the audio (D6).
    this.sfx.powerUp()
    if (kind === 'tank') this.sfx.oneUp()
    switch (kind) {
      case 'helmet': {
        // A timed shield: arm the per-player i-frame window (RunState.shieldTimer — the new field) AND the tank's
        // spawnIframe (reuse the F3 i-frame blink + the isHittable() gate — no new shield code, D4). The tank
        // reads spawnIframe for isHittable(); the HUD reads shieldTimer for the readout (both ticked on gdt).
        this.runState.shieldTimer[slot] = HELMET_SHIELD_SEC
        const tank = this.playerTanks.get(slot)
        if (tank) tank.spawnIframe = HELMET_SHIELD_SEC
        break
      }
      case 'clock':
        // Freeze every enemy: set freezeTimer (the F4 placeholder, now driven). update() sets gdt=0 while > 0, so
        // enemies don't move + AI/fire are skipped; the timer counts down on the gameplay dt (tickTimers — D4/D5).
        this.runState.freezeTimer = CLOCK_FREEZE_SEC
        break
      case 'shovel':
        // Fortify the eagle's brick ring → steel for SHOVEL_FORTIFY_SEC. Set the timer (read by the freeze-edge
        // revert), then DEFER the real body swap (TileMap.fortifyBaseRing — destroys brick sub-cells + adds steel
        // bodies) out of this overlap callback (D4a/D10/AC10). The falling-edge revert is in update() (D4a).
        this.runState.shovelTimer = SHOVEL_FORTIFY_SEC
        this.shovelWasActive = true // arm the falling-edge latch so revert fires when the timer hits 0 (D4a).
        this.time.delayedCall(0, () => this.tileMap.fortifyBaseRing(this.ringCells))
        break
      case 'star':
        // Upgrade this player's tank one star tier (clamped to the table) + re-fold the live spec OVER the Hub
        // tree (D4b — the star composes with, never strips, the bought stats). The carried tier[slot] keeps the
        // up-tier across stages (the F4 carry). applyStarTier clamps internally, so capping here keeps tier sane.
        this.runState.tier[slot] = Math.min((this.runState.tier[slot] ?? 0) + 1, 3)
        this._refoldPlayerSpec(slot)
        break
      case 'grenade':
        // Destroy every on-screen enemy via the SAME kill funnel (onHit → onDeath → score/ledger/possible drop).
        // DEFER it out of this overlap callback (onHit hides + disables a body + may advance the stage — the
        // footgun; D10/AC10). Snapshot the live enemies NOW (the closure runs next tick). A big lethal hit kills
        // even an armor tank in one (its multi-hit HP is bypassed by a >= maxHp damage).
        this.time.delayedCall(0, () => {
          for (const enemy of this.enemies) {
            if (enemy.alive && enemy.isHittable()) enemy.onHit(enemy.maxHp) // lethal — one funnel, banks score (AC4).
          }
        })
        break
      case 'tank':
        // +1 extra life for this slot (the shared per-slot life ledger — F4 D10). The HUD reads it live; a downed
        // player is NOT auto-respawned by a life gain (it respawns on its next death if a life remains — AC4).
        this.runState.lives[slot] = (this.runState.lives[slot] ?? 0) + 1
        break
    }
  }

  // ── _deriveRingCells() (F5 §5.4, D4a) ── the eagle fort-ring tile coords = the in-grid orthogonal BRICK
  // neighbours of desc.base (the SAME ring LevelGenerator §5.3 step 2 stamps — DRY, re-derived from the EMITTED
  // grid, no generator call). The shovel fortifyBaseRing/revertBaseRing swap exactly these tiles. A cell that the
  // bullet erosion has already chipped to non-BRICK is skipped (fortify only fortifies what brick remains — D4a).
  private _deriveRingCells(): Array<{ col: number; row: number }> {
    const cells: Array<{ col: number; row: number }> = []
    const { col, row } = this.desc.base
    const ortho: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const [dc, dr] of ortho) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= this.desc.cols || nr >= this.desc.rows) continue // grid edge — the wall.
      if (this.desc.tiles[nr][nc] === TILE.BRICK) cells.push({ col: nc, row: nr })
    }
    return cells
  }

  // ── _publishHud() (F5 §5.4, D-decoupled/AC8) ── write the FULL HUD state to the scene REGISTRY each frame
  // (the parallel HUDScene reads it — it NEVER reaches into the world, the reference's decoupling). The
  // registry is a flat key→value bag both scenes share (this.registry === the HUD's registry). Lives are read
  // per PRESENT slot (the seeded keys — solo {1}, co-op {1,2}); the active power-up + its remaining seconds are
  // the highest-priority live timer (freeze > shovel > shield) the HUD renders. KISS — one publish, no allocation
  // beyond the small value writes (Phaser dedupes unchanged registry sets, but a flat write each frame is cheap).
  private _publishHud(): void {
    const r = this.registry
    r.set('hud.stage', this.runState.stageIndex + 1) // the human stage number (1-based — the HUD readout).
    r.set('hud.score', this.runState.score) // the shared run score (banked per kill — AC4).
    r.set('hud.enemies', this.runState.enemiesRemaining) // enemies LEFT to clear this stage (queued + alive).
    r.set('hud.currency', this.meta.getCurrency()) // the SHARED persistent bank (cached MetaState — no save touch).
    r.set('hud.p1Lives', this.runState.lives[1] ?? 0) // P1 lives (always present).
    r.set('hud.p2Lives', TWO_PLAYER ? this.runState.lives[2] ?? 0 : -1) // P2 lives; -1 = hidden in 1P (AC8).

    // The ACTIVE power-up + its remaining seconds (AC8): the highest-priority live timer (freeze > shovel >
    // shield). shieldTimer is per-player — surface the largest live shield across present slots (the HUD shows
    // "a shield is up" + its seconds). null kind = nothing active (the HUD hides the line). DRY — the HUD reads
    // the kind id through t('power.<kind>'); GameScene only reports the kind + the seconds.
    let activeKind: PowerUpKind | null = null
    let activeSecs = 0
    // F7 (D6/AC7) — also publish the active power-up's FULL duration so the HUD can draw the timer-bar fraction
    // (powerSecs / powerMaxSecs). Each kind's full window is its config/powerups.ts constant (DRY — the SAME
    // constant the _applyPowerUp arm set the timer to). One extra registry write; the bar fraction is decoupled.
    let activeMaxSecs = 0
    if (this.runState.freezeTimer > 0) {
      activeKind = 'clock'
      activeSecs = this.runState.freezeTimer
      activeMaxSecs = CLOCK_FREEZE_SEC
    } else if (this.runState.shovelTimer > 0) {
      activeKind = 'shovel'
      activeSecs = this.runState.shovelTimer
      activeMaxSecs = SHOVEL_FORTIFY_SEC
    } else {
      let maxShield = 0
      for (const slot of this.playerTanks.keys()) maxShield = Math.max(maxShield, this.runState.shieldTimer[slot] ?? 0)
      if (maxShield > 0) {
        activeKind = 'helmet'
        activeSecs = maxShield
        activeMaxSecs = HELMET_SHIELD_SEC
      }
    }
    r.set('hud.powerKind', activeKind) // the active power-up kind id (or null — the HUD keys t('power.<kind>') off it).
    r.set('hud.powerSecs', Math.ceil(activeSecs)) // whole seconds remaining (the HUD readout — POWERUP_BY_ID is timed).
    r.set('hud.powerMaxSecs', activeMaxSecs) // F7 (D6/AC7) — the active power-up's FULL duration (the bar denominator).

    // F6 (D5/D8, AC3/AC6) — the STAGE-N-CLEARED banner string (localised while the timer is live, else '') + the
    // MUTED cue. The banner is presentation state → the registry is its home (the HUD renders it timed — D5). The
    // banner timer is decayed on the REAL dt in update() (so it shows through the run-end freeze beat).
    r.set('hud.banner', this.bannerTimer > 0 ? t('hud.stageCleared', { n: this.bannerStage }) : '')
    r.set('hud.muted', this.sfx.mute) // the mute cue (the HUD shows "MUTED" while true — D8).

    // (D3/D5, AC2) — the STAGE-N intro-curtain label (the localised "STAGE N" while the curtain is up, else '').
    // SAME registry-mirror pattern as the clear banner: the HUD renders it centered (the intro beat). The human
    // stage number is stageIndex + 1. Its own key (NOT hud.banner) so the intro + clear render paths stay separate.
    r.set('hud.stageIntro', this.curtainTimer > 0 ? t('hud.stageIntro', { n: this.runState.stageIndex + 1 }) : '')
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
      this.sfx.explosion({ big: true }) // F6 (D6/AC6) — the eagle-hit burst (the run-end follows via the guard).
      this.bullets.release(bulletRect)
      base.onHit() // flips destroyed ONCE → onDestroyed → _triggerGameOver (the gameOver guard, AC6/AC10).
      return
    }

    // ── BRICK / STEEL (D3/D4, AC1/AC2) ── a small impact spark + despawn the shot in BOTH cases. F6 (D6/AC6) — a
    // dry crunch on a brick chip, a bright metallic clink off (indestructible) steel; the throttle collapses a
    // multi-brick frame into one transient.
    this.effects.explosion(bulletRect.x, bulletRect.y)
    this.bullets.release(bulletRect)
    if (kind === TILE.STEEL) this.sfx.steelClink()
    else this.sfx.brickHit()

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
    this.sfx.explosion() // F6 (D6/AC6) — the bullet-on-tank impact spark (a small burst; the kill burst is big).
    this.bullets.release(bulletRect)
    tank.onHit(BULLET_DAMAGE) // the hit funnel (D7) — the death path runs once at ≤ 0 HP → onDeath.
  }

  // ── A player tank reached 0 HP (F3 §5.3, D11, AC8) ── the Tank fired its onDeath; the SCENE owns the run
  // economy. Pop the kill burst, spend that player's life, and — if any remain — respawn at the generated
  // spawn with SPAWN_IFRAME i-frames, else leave the player down. Then run the run-over check (the eagle's
  // death OR EVERY PRESENT player out of lives ends the run — D11). ──
  private _onPlayerDeath(slot: number, tank: Tank): void {
    this.effects.explosion(tank.collider.x, tank.collider.y, { big: true }) // the kill burst at the tank center.
    this.sfx.explosion({ big: true }) // F6 (D6/AC6) — a big burst on a player death.
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

  // ── _triggerGameOver (F3 §5.3 → F5 §5.3, D6/D8, AC5/AC6/AC10 — the ONE guarded run-end edge) ── BOTH run-end
  // edges funnel here: the eagle's destruction (base.onDestroyed) AND every-present-player-out-of-lives
  // (_checkRunOver). The one-shot `gameOver` flag (set FIRST, the reference's ordering) means a same-frame
  // double-trigger transitions EXACTLY once. F5 (D8/AC5): under the guard, bank the run ONCE — bankRun adds
  // floor(score · CURRENCY_RATIO) to the SHARED currency + bumps bestScore/bestStage (the single writer; SAVE),
  // returning the banked amount. Pass a run-summary SNAPSHOT to GameOverScene (it DISPLAYS it — it does not save).
  // The HUD is stopped so it doesn't outlive the run. Flash, then hand off after a beat so the kill burst reads.
  private _triggerGameOver(): void {
    if (this.gameOver) return // one-shot guard — the SECOND edge of a same-frame double-trigger early-returns.
    this.gameOver = true

    // F7 (D3) — defensively force-close the pause overlay if the run somehow ends while paused (it cannot via the
    // gated input edge, but a deferred death callback could race a pause). Tear WITHOUT firing onClose's consume
    // (the scene is going to GameOver — no resume frame to protect). Idempotent.
    if (this.pauseOverlay) {
      this.pauseOverlay.close()
      this.pauseOverlay = null
    }
    this.paused = false

    this.sfx.gameOver() // F6 (D6/AC6) — the run-end knell (the single owner, under the one-shot guard).

    // Bank the run ONCE (F5 §5.3, D8/AC5) — the single writer under the gameOver guard. `stage` is the human
    // stage number reached (stageIndex + 1). bankRun returns the banked amount (the GameOver summary displays it).
    const score = this.runState.score
    const stage = this.runState.stageIndex + 1
    const currencyBanked = this.meta.bankRun({ score, stage })

    this.cameras.main.flash(280, 200, 40, 40) // a brief red flash marks the run end.
    this.scene.stop('HUD') // stop the parallel overlay so it doesn't outlive the run (the HUD is GameScene-owned).
    // Defer the transition a beat so the kill burst + flash read before the screen swaps (the reference's
    // delayedCall handoff). effects keep ticking until then (update's gameOver branch ticks the FX, AC7). Pass the
    // run-summary snapshot (score/stage/banked + the freshly-bumped bests) as scene-start DATA (decoupled — D8/AC5).
    this.time.delayedCall(700, () =>
      this.scene.start('GameOver', {
        score,
        stage,
        currencyBanked,
        bestScore: this.meta.getBestScore(),
        bestStage: this.meta.getBestStage(),
      }),
    )
  }

  // ── _openPause() (F7 §5.3, D3/D4, AC4) ── open the read-only pause modal + FREEZE the world. Set `paused`
  // (update()'s gameplay block early-returns while it's set — the SAME freeze idiom as the gameOver branch),
  // then news the overlay with a getInfo() that returns a run snapshot read ONCE (the world is frozen, so it
  // can't change while paused — KISS) + an onClose = _closePause. Guarded so a second open while paused is a
  // no-op (update() already gates the open on !this.paused, but the guard is belt-and-braces). NO new scene (D3).
  private _openPause(): void {
    if (this.paused || this.gameOver || this.transitioning) return
    this.paused = true
    this.sfx.uiSelect() // a small pause blip (the one audio owner — DRY; a no-op under NoAudio).
    this.pauseOverlay = new PauseOverlay(this, {
      getInfo: () => this._getRunInfo(),
      onClose: () => this._closePause(),
    })
  }

  // ── _closePause() (F7 §5.3, D4, AC4 — the resume + the close→reopen race fix) ── tear the overlay, clear
  // `paused` (update() resumes its gameplay block next frame), and CONSUME the pending P/ESC edge so the
  // overlay's own close-press cannot be re-sampled by update()'s input2.sample() and re-open pause (or leak a
  // fire) on the SAME resume frame (the reference's consumePause discipline — D4). Idempotent (the overlay's
  // own close() + the cleared ref guard re-entry). Called by the overlay's onClose AND the run-end/teardown paths.
  private _closePause(): void {
    if (this.pauseOverlay) {
      this.pauseOverlay.close() // force-tear (idempotent — the overlay's _destroyed guard absorbs a double).
      this.pauseOverlay = null
    }
    this.paused = false
    this.input2.consumePause() // swallow the pending P/ESC JustDown edge (the close→reopen race fix — D4).
  }

  // ── _getRunInfo() (F7 §5.3, D3) ── assemble the read-only run snapshot the pause overlay renders (the
  // reference's getBuild idiom — GameScene owns the run data, the overlay only formats). Read ONCE on open (the
  // world is frozen). enemiesLeft is the live ledger; p2Lives is -1 in solo (the overlay hides that line).
  private _getRunInfo(): RunInfo {
    return {
      stage: this.runState.stageIndex + 1,
      score: this.runState.score,
      enemiesLeft: this.runState.enemiesRemaining,
      p1Lives: this.runState.lives[1] ?? 0,
      p2Lives: TWO_PLAYER ? this.runState.lives[2] ?? 0 : -1,
    }
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
      // F6 (D6/AC6) — enemy fire audio routes through the scene like the players' (every tank's shot plays fire();
      // the boss's telegraphed volley fires here too — tryFire's boolean gates the blip). The throttle collapses a
      // same-frame multi-shot pile-up into one transient so a busy frame doesn't machine-gun the blip.
      if (enemy.aiIntent.firePressed && enemy.tryFire(this.bullets)) this.sfx.fire()
    }
  }

  // ── _onEnemyKilled(enemy) (F4 §5.3, Decisions D7/D10, AC5/AC7) ── the enemy's onDeath fired (HP funnel hit 0,
  // F3). Bank its score (D10), decrement the alive ledger, fire the carrier drop-flag ONCE (AC7), and — if this
  // was the LAST enemy of the stage (none queued, none alive) — DEFER the stage advance out of this death/overlap
  // callback under the one-shot `transitioning` guard (the footgun discipline — AC10). The F3 onHit already
  // hid + disabled the corpse; we remove it from the live list (its body is torn down on the stage teardown).
  private _onEnemyKilled(enemy: Tank): void {
    this.effects.explosion(enemy.collider.x, enemy.collider.y, { big: true }) // the kill burst at the tank center.
    // F7 (D5/AC5) — the floating "+N" SCORE popup at the kill center (N = the killed tank's scoreValue), in
    // ADDITION to the kill burst. The boss routes through THIS funnel, so its big scoreValue pops for FREE (DRY).
    // Only KILLS call this — brick chips / bullet cancels never spawn a popup (the AC5 "kills only" discipline).
    this.effects.scorePopup(enemy.collider.x, enemy.collider.y, enemy.spec.scoreValue)
    this.sfx.explosion({ big: true }) // F6 (D6/AC6) — a big burst on an enemy/boss kill (the boss routes here too).
    this.runState.score += enemy.spec.scoreValue // bank the score (D10 — the HUD/Hub features render/spend it).
    this.runState.enemiesAlive = Math.max(0, this.runState.enemiesAlive - 1)
    this.runState.enemiesRemaining = this.runState.enemiesQueued + this.runState.enemiesAlive
    // A carrier drops a power-up: fire the hook ONCE with the death center (the F5 pickup seam — AC7). F4 marks
    // the drop point; no power-up entity is constructed here (YAGNI). The boss is a NON-carrier (D11), so this is
    // never taken for the boss — no power-up spawns on its death-center mid-transition (a clean boss fight).
    if (enemy.carrier && enemy.onDropFlag) {
      enemy.onDropFlag(enemy.collider.x, enemy.collider.y)
      enemy.onDropFlag = null // one-shot (a same-frame double-hit can't re-fire — mirrors onDeath's discipline).
    }

    // The stage-clear predicate (AC5): no more queued AND none alive → every enemy is dead. F6 (D4/AC1/AC3/AC4):
    // on a BOSS stage the boss is the stage CAPSTONE — when the last NORMAL enemy clears (this predicate, with the
    // boss not yet spawned) we SPAWN the boss INSTEAD of advancing (and `return` BEFORE the transitioning guard, so
    // the stage does NOT advance — the boss is now the one alive enemy). The boss's OWN onDeath re-reaches this
    // predicate (now bossSpawned), falls through to the banner + advance. Because the spawn branch sits INSIDE the
    // predicate + BEFORE the guard, the boss never advances on its spawn frame, and the advance fires exactly once
    // on its death. The decrement (above) + recompute have ALREADY run, so the predicate reflects the boss's kill.
    if (this.runState.enemiesQueued <= 0 && this.runState.enemiesAlive <= 0 && !this.transitioning && !this.gameOver) {
      if (this.runState.isBossStage() && !this.bossSpawned) {
        this._spawnBoss() // the capstone — spawn the boss INSTEAD of advancing (D4); sets enemiesAlive/Remaining=1.
        return // return WITHOUT touching `transitioning` — the stage does NOT advance (the boss is now alive).
      }
      if (this.runState.isBossStage()) {
        // The boss's own kill re-reached the predicate (bossSpawned already true): show the STAGE-N-CLEARED banner
        // (a registry value the HUD renders timed — D5) + the win flourish, then fall through to the advance (AC3).
        this.bannerStage = this.runState.stageIndex + 1 // the human stage number just cleared.
        this.bannerTimer = STAGE_CLEARED_BANNER_SEC
        this.sfx.stageCleared()
      }
      this.transitioning = true
      this.time.delayedCall(0, () => this._advanceStage())
    }
  }

  // ── _spawnBoss() (F6 §5.4, D4/D11, AC1/AC4) ── the capstone boss spawn, factored DRY with _spawnStep's
  // construction. Build the boss `Tank` from bossSpecForStage(stageIndex) at a TOP enemy spawn, collide it against
  // terrain + register the SAME bullet×tank overlap + wire its onDeath to the SAME _onEnemyKilled funnel (so a
  // normal bullet OR a co-op grenade kills it identically — AC4), pin it a NON-carrier (D11 — no power-up drop on
  // its death), and arm a spawn-blink (the classic telegraph; the AI/telegraph can't arm during the blink, so the
  // boss always gets its blink before it can be hit — §5.4 issue (b)). NOTE (issue #2 consistency): UNLIKE _spawnStep,
  // _spawnBoss does NOT apply bulletSpeedScale — the boss's bulletSpeed is the RAW, verifier-asserted spec value
  // (the fold leaves it unscaled), so the heavier-fire profile stays the fixed BOSS.bulletSpeed ≥ POWER quantity at
  // every depth. THE LEDGER WRITE (issue #1): set enemiesAlive=1 + enemiesRemaining=1 (NOT enemiesQueued, which
  // stays 0 — the boss is EXTRA, never a queued-roster member), so the HUD reads ENEMIES 1 while the boss is alive
  // and ENEMIES 0 only after it dies. Reached ONLY from the capstone edge (enemiesAlive already 0), so `=1` is safe.
  private _spawnBoss(): void {
    const topSpawns: SpawnPoint[] = this.desc.enemySpawns
    const point = topSpawns[1 % topSpawns.length] // the CENTER top spawn (the classic boss entrance, deterministic).
    const enemy = new Tank(this, point.x, point.y, 'enemy', bossSpecForStage(this.runState.stageIndex))
    ;(enemy.collider as TankCollider).tankRef = enemy
    this._collideTankWithTerrain(enemy) // the boss stops at terrain too (DRY).
    enemy.carrier = false // D11 — a NON-carrier: no power-up drop, a clean boss fight.
    enemy.onDropFlag = null
    enemy.spawnIframe = SPAWN_BLINK_TIME // the spawn-blink telegraph (inert + un-hittable during it — AC1).
    enemy.onDeath = () => this._onEnemyKilled(enemy) // the SAME kill/score/advance funnel (DRY — it's a Tank).
    this._registerTankOverlap(enemy) // the SAME bullet×tank overlap as every tank (the F3 seam, D9).
    this.enemies.push(enemy)
    this.boss = enemy
    this.bossSpawned = true
    // The ledger: the boss is the ONE alive enemy now (extra over the cleared roster). enemiesRemaining=1 here (at
    // spawn) is what makes the HUD read ENEMIES 1 while the boss lives (issue #1) — enemiesQueued stays 0.
    this.runState.enemiesAlive = 1
    this.runState.enemiesRemaining = 1
    this.sfx.bossSpawn() // F6 (D6/AC6) — the ominous capstone swell announces the boss.
  }

  // ── _markDrop(x,y) (F4 §5.3 → F5 §5.3, D1/D3, AC1) ── a carrier died here: ACQUIRE a power-up from the pool at
  // the drop center with a kind picked DETERMINISTICALLY off the stage RNG (pickPowerUpKind — the SAME seeded
  // source the roster picks use, so a fixed stage seed yields a deterministic power-up stream — D3). The drop is a
  // static colour-pulsing rect that persists until collected / the stage rebuilds (D2). Keep the F4 kill burst
  // (cosmetic). Exactly one power-up per carrier death (the F4 onDropFlag one-shot discipline is preserved — AC1).
  private _markDrop(x: number, y: number): void {
    const kind = pickPowerUpKind(this.stageRng) // PURE uniform pick, deterministic per stage (D3/AC1).
    this.powerups.acquire(x, y, kind) // place the static pulsing pickup at the drop window-center (D1/D2).
    this.effects.explosion(x, y, { big: true }) // keep the kill burst where the power-up dropped (cosmetic).
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
    this.powerups.releaseAll() // F5 (AC10) — release any uncollected power-ups (they don't carry across stages).
    for (const tank of this.enemies) this._destroyTank(tank)
    this.enemies = []
    for (const tank of this.playerTanks.values()) this._destroyTank(tank)
    this.playerTanks.clear()
    // Drop the run-scoped × stage-scoped bullet×terrain overlap BEFORE tileMap.destroy() nulls solidBodies.children
    // (D2/AC2). A destroyed tank's sprite-vs-group colliders fall through collideHandler harmlessly, but THIS
    // group-vs-group overlap's surviving bullets.group keeps it live against the dead group — so destroy it by hand.
    this._bulletTerrainOverlap?.destroy() // ?. — first build had none; cleared so a re-teardown is a no-op too.
    this._bulletTerrainOverlap = undefined
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

    // F6 (D5, AC3) — decay the STAGE-N-CLEARED banner on the REAL dt (NOT gdt), so it shows through both a clock
    // freeze AND the run-end freeze beat (the same "FX run on real dt" contract). Clamped at 0. _publishHud reads
    // bannerTimer > 0 to publish the string. Done BEFORE the gameOver early-return so the banner finishes showing.
    this.bannerTimer = Math.max(0, this.bannerTimer - dt)

    // (D3, AC2) — decay the STAGE-N intro curtain on the REAL dt (so it ends in real time regardless of the
    // gameplay-dt freeze). Clamped at 0. While curtainTimer > 0 the spawn loop + enemy tick are gated below, and
    // _publishHud mirrors the "STAGE N" label to the HUD. Decayed BEFORE the gameplay block so it counts down each frame.
    this.curtainTimer = Math.max(0, this.curtainTimer - dt)

    // ── F5 power-up timers + the freeze boundary (F5 §5.3, D4/D5/AC3) ── decay freeze/shovel/shield on the
    // GAMEPLAY dt BEFORE the freeze is applied for the frame (so the freeze timer itself counts down in real
    // gameplay time and ends — the reference's clock-freeze does the same). THEN compute the gameplay dt:
    // gdt = 0 while frozen (the WIRED F4 boundary, now DRIVEN — enemies don't move + AI/fire are skipped), else
    // the real dt. FX + the HUD countdown read the REAL dt (a freeze never pauses the pop — the F3 contract).
    this.runState.tickTimers(dt)
    const gdt = this.runState.freezeTimer > 0 ? 0 : dt // GAMEPLAY dt — the clock power-up drives it to 0 (D4).

    // ── The shovel falling edge (F5 §5.3, D4a/D10/AC3) ── when the shovel timer reaches 0 (it WAS active),
    // revert the eagle ring's STEEL back to its EXACT pre-fortify brick state. DEFER the body swap out of this
    // step via delayedCall(0) (the footgun discipline — never destroy/rebuild a body inside update's collision
    // resolution). The latch fires the revert exactly once. revertBaseRing is idempotent (a no-op if not fortified).
    if (this.shovelWasActive && this.runState.shovelTimer <= 0) {
      this.shovelWasActive = false
      this.time.delayedCall(0, () => this.tileMap.revertBaseRing())
    }

    // Publish the FULL HUD state to the scene REGISTRY each frame (F5 §5.4, D-decoupled/AC8) — the parallel HUD
    // reads it (it never reaches into the world). Done on EVERY frame, incl. while frozen / mid-transition, so
    // the readouts (lives/enemies/stage/score/currency/active power-up + its seconds) stay live.
    this._publishHud()

    // Sample the SINGLE Input owner ONCE this frame (AC2 — the sole JustDown owner for the fire edges + the F7
    // pause edge). Reading once keeps the JustDown flags consistent (the sole-owner invariant).
    const s = this.input2.sample()

    // ── F7 pause (F7 §5.3, D3/D4, AC4) ── on the P/ESC edge, when NOT gameOver/transitioning/already-paused,
    // OPEN the pause modal + freeze the world. Done BEFORE the gameOver early-return so pause is inert once the
    // run has ended (D3). _openPause re-guards the same conditions.
    if (!this.gameOver && !this.transitioning && !this.paused && s.pausePressed) {
      this._openPause()
    }

    // Once the run ended, FREEZE the world (no driving / firing / travel / collision resolution) but keep
    // ticking the FX on REAL dt so the final kill burst + the flash settle before the scene swaps (D6/AC7).
    if (this.gameOver) {
      this.effects.tick(dt)
      return
    }

    // ── F7 (D3/AC4) — while PAUSED, the world is FULLY frozen: no tank drives/fires, no enemy spawns/ticks, no
    // bullet travels, no collision resolves — but the FX pool still settles on REAL dt (the same frozen-FX
    // discipline as the gameOver branch, NOT a hard return), so the kill burst that was on-screen at the pause
    // finishes cleanly. The overlay renders on top (camera-fixed). update() early-returns its gameplay block.
    if (this.paused) {
      this.effects.tick(dt)
      return
    }

    // F5 (D2) — pulse every live power-up's kind colour (the classic blink). Cosmetic; off the scene clock.
    this.powerups.tick()

    // P1 — fire off the edge (the scene owns the pool, D12), then tick movement/facing/cooldown on `gdt`. A
    // dead-but-not-yet-respawned P1 isn't driven (Tank.update early-returns while !alive — defensive).
    if (this.p1.alive) {
      // F6 (D6/AC6) — tryFire now returns whether a shot fired; play sound.fire() on success (the one audio owner).
      if (s.p1.firePressed && this.p1.tryFire(this.bullets)) this.sfx.fire()
      this.p1.update(gdt, s.p1)
    }

    // P2 — gated on TWO_PLAYER (AC8). Input still returned p2 (cheap); the SCENE decides whether to drive it.
    if (TWO_PLAYER && this.p2 && this.p2.alive) {
      if (s.p2.firePressed && this.p2.tryFire(this.bullets)) this.sfx.fire() // F6 (D6/AC6) — co-op fire blip.
      this.p2.update(gdt, s.p2)
    }

    // F4 (§5.3, AC1/AC2/AC3) + F5 (D4/AC2, the clock freeze) — stream new enemies in (staggered + capped), then
    // tick every live enemy's AI + movement + fire. Both run on the GAMEPLAY dt (so the spawn cadence pauses
    // while frozen). While the clock power-up is active (freezeTimer > 0) the enemies are FULLY frozen: skip BOTH
    // the spawn step AND the enemy tick entirely, so no enemy moves, runs AI, or fires (AC2 — "enemies don't move,
    // AI/fire skipped"; gdt=0 alone stops movement but not the AI/fire branches). While transitioning (the
    // deferred stage rebuild is queued) we skip both too — the world is mid-teardown. (D4, AC2): while the STAGE-N
    // intro curtain is up (curtainTimer > 0) we skip both as well — no enemy spawns/acts during the intro beat (the
    // player + bullets stay live; only the enemy pair is gated, per the spec's "pause enemy spawning/AI").
    const frozen = this.runState.freezeTimer > 0
    const curtain = this.curtainTimer > 0
    if (!this.transitioning && !frozen && !curtain) {
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
          // A small spark where they meet (the midpoint), then mutual despawn. F6 (D6/AC6) — a small impact blip.
          this.effects.explosion((a.x + b.x) / 2, (a.y + b.y) / 2)
          this.sfx.explosion()
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

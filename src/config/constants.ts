// ── Global game constants (F0 scaffold §5.2, Decision 3/7/8) ──
// PURE module — NO Phaser import — so it is safe to consume from headless scripts
// (scripts/verify-gen.mjs imports it under plain node, AC9/AC10) AND from any scene. This is
// the SINGLE owner of the design resolution + the grid/tank/bullet numbers (AC10): values that
// more than one site needs (main.ts sizing the canvas, GameScene + the F2 stage generator + the
// HUD reading the grid math) live here exactly ONCE (DRY) instead of being inlined and drifting.

// ── Fixed design resolution (Decision 1) ──
// A grid tank game needs a FIXED world coordinate system: the seeded stage generator, the
// centered square playfield, and all tile math assume stable dimensions. We render at a constant
// 1280×720 and let Phaser.Scale.FIT letterbox it to the viewport (see main.ts). This deliberately
// REPLACES Scale.RESIZE — RESIZE re-sizes the world on every window resize and gives entities
// positioned from viewport dimensions a moving target, which the tile/HUD layout would fight.
export const DESIGN_WIDTH = 1280
export const DESIGN_HEIGHT = 720

// NOTE (Decision 3): there is intentionally NO `GRAVITY` constant. Battle City is TOP-DOWN — tanks
// move on a grid, bullets travel straight, nothing falls. Arcade physics is enabled in main.ts with
// NO gravity key. (This is the one deliberate divergence from the platformer reference, which needs
// GRAVITY; a top-down grid game does not — exporting it would be dead, misleading code, YAGNI.)

// ── UI font stack (i18n — CJK support, Decision 8) ──
// EVERY text site uses this single constant instead of a bare 'monospace' so Chinese (zh-CN) renders.
// A bare 'monospace' falls back to a Latin-only font (Courier/Menlo) that has NO CJK glyphs → tofu
// boxes. The fallback chain keeps the programmer-art monospace look for Latin, then hands CJK glyphs
// to a system-installed CJK font (no external/bundled asset — honours the "programmer-art only"
// constraint, AC11). The full i18n layer arrives in F1; establishing this constant in F0 costs one
// line and prevents a later sweep of bare-'monospace' sites.
export const UI_FONT = 'monospace, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

// ── Grid (Decision 7, §5.2) — the classic Battle City 17×17 tile playfield ──
// 17×17 tiles at 40 px = a 680 px square playfield (the larger battlefield comes from MORE tiles, not
// bigger tiles — fits the 720 height with margin). Each BRICK tile is split into SUB_CELLS×SUB_CELLS
// (2×2 = 4) independently-destructible sub-cells — the classic brick behaviour. Later features (F2
// generator, GameScene, HUD) import these NAMES; F0 owns them once so they never drift.
export const GRID_COLS = 17
export const GRID_ROWS = 17
export const TILE_SIZE = 40 // px — one grid tile (17 × 40 = 680 px square playfield).
export const SUB_CELLS = 2 // each BRICK tile = SUB_CELLS² (2×2 = 4) destructible sub-cells (classic).
export const SUB_CELL_SIZE = TILE_SIZE / SUB_CELLS // px — one destructible brick sub-cell (20 px).

// ── Layout (Decision 7, §5.2) — centered square playfield + a right-side HUD panel (like the original) ──
// Derived from DESIGN_*, GRID_*, TILE_SIZE so the single owner stays internally consistent. The
// HUD panel sits to the RIGHT of the playfield (lives / score / next-enemy icons in later features).
export const HUD_PANEL_WIDTH = 256 // px — right-side info panel (lives, score, enemy queue) like the classic.
export const PLAYFIELD_W = GRID_COLS * TILE_SIZE // px — playfield width (680).
export const PLAYFIELD_H = GRID_ROWS * TILE_SIZE // px — playfield height (680).
// Center the (playfield + a gap + HUD panel) block horizontally; center the playfield vertically.
export const PLAYFIELD_GAP = 32 // px — gap between the playfield and the HUD panel.
export const PLAYFIELD_X = Math.round((DESIGN_WIDTH - (PLAYFIELD_W + PLAYFIELD_GAP + HUD_PANEL_WIDTH)) / 2)
export const PLAYFIELD_Y = Math.round((DESIGN_HEIGHT - PLAYFIELD_H) / 2)
export const HUD_PANEL_X = PLAYFIELD_X + PLAYFIELD_W + PLAYFIELD_GAP // px — top-left x of the side HUD panel.

// ── Tank / bullet feel (Decision 7, §5.2 → F6 §5.2/AC8 balance) — the feel anchors, tuned in F6 ──
// All speeds are in px/SECOND (dt is handled in seconds at the boundary — the project's dt convention);
// cooldowns are in SECONDS. The NAMES are the DRY anchors entities + the HUD read later (and the four enemy
// archetype specs scale around TANK_SPEED/BULLET_SPEED, so a bump here lifts the whole roster proportionally —
// the four-types-distinct check in the verifier still holds since the multipliers are unchanged). F6 (D10/AC8):
// the winnable-but-tense balance pass — TANK_SPEED 96→104 (a touch more agile so dodging the heavier enemy/boss
// fire feels fair), FIRE_COOLDOWN 0.35→0.30 (a slightly snappier player beat so the player can answer the boss's
// telegraphed volley). BULLET_SPEED held (360 reads well + anchors POWER's 1.6× faster bolt the verifier checks).
export const TANK_SPEED = 104 // px/s — grid-aligned 4-directional tank movement (F6: 96→104, AC8).
export const BULLET_SPEED = 360 // px/s — a bullet travels straight until it hits terrain/a tank/the wall.
export const FIRE_COOLDOWN = 0.3 // s — minimum delay between a player's shots (F6: 0.35→0.30, AC8).
export const MAX_PLAYER_BULLETS = 1 // bullets a single player may have on-screen at once (classic starts at 1).
export const START_LIVES = 3 // lives a player begins a run with.

// ── F1 Tank core (F1 §5.2, Decisions 5/6/9/10, AC3/AC7/AC8/AC10) — DERIVED from / sit beside the values above ──
// All PURE data (no Phaser): GameScene + entities + the bullet pool import these NAMES; owning them
// here ONCE keeps the pure/coupled split intact (the verifier still node-imports this module) and the
// numbers from drifting (DRY). Each is intent-revealing per the cited design AC/Decision.

// TANK_SIZE (F1 §5.2, D5/D6) — the square tank BODY ≈ 1 tile, a hair inset (−4) so two tanks driving
// in adjacent lanes don't perpetually graze their colliders. Derived from TILE_SIZE (DRY), so the tank
// is ~one tile and the generator's FOOTPRINT = ceil(TANK_SIZE/TILE_SIZE) = 1 (the classic proportion).
export const TANK_SIZE = TILE_SIZE - 4 // px — the ~1-tile square tank body (36).

// STEEL_WALL_THICKNESS (F1 §5.2, D10) — the test-arena border-wall rectangle thickness (px). The four
// STEEL border walls (static Arcade bodies) hug the playfield inner edges so a tank stops at them (AC6).
export const STEEL_WALL_THICKNESS = 8 // px.

// TWO_PLAYER (F1 §5.2, D2, AC8) — the 2-player local co-op flag (default true). The SCENE reads it to
// decide whether to spawn/drive P2; Input IGNORES it (Input always returns BOTH p1+p2, SOLID — D2).
// Flip to false for a single-player session: only P1 spawns + is driven, P2 simply absent (no errors).
export const TWO_PLAYER = true

// MAX_DT (F1 §5.2, D9, AC7) — the per-step dt CLAMP in SECONDS, owned ONCE here (DRY). GameScene.update
// computes `dt = Math.min(delta/1000, MAX_DT)` and feeds SECONDS to every tank.update/pool.tick, so a
// tab-refocus delta spike can't teleport a fast body through a wall (it bounds one integration step).
export const MAX_DT = 1 / 30 // s — cap a single step at ~33 ms.

// LANE_INSET (feel-balance §3, D1) — the centered-in-tile inset (px) for a ~1-tile tank: a TANK_SIZE body
// centered in a TILE_SIZE corridor tile sits its CORNER `(TILE_SIZE − TANK_SIZE)/2` from the tile edge (2px
// at 36px body / 40px tile). The turn-time lane-snap (Tank._recenterCross) snaps the cross CORNER to the
// TILE lattice OFFSET by this inset (= the windowCenter-derived clean corner) — so a 1-tile tank ends EXACTLY
// centered in a 1-tile corridor lane. DERIVED from the TILE_SIZE/TANK_SIZE owners (DRY); the single PURE owner.
export const LANE_INSET = (TILE_SIZE - TANK_SIZE) / 2 // px — the ~1-tile tank's centered-in-tile corner inset (2).

// LANE_SNAP_EPSILON (F1 §5.2, D5/D6, AC3 → feel-balance §3, D2) — the dead-band (px) for the turn-time
// cross-axis re-center (§5.3 step 4): if the body's cross-corner is already within this of its nearest
// LANE_INSET-offset TILE lane the snap is a NO-OP, so the re-center can never oscillate around the lane
// center or fight Arcade frame-to-frame. Sub-pixel (0.5) so the corner stays visually lane-aligned + a real
// post-turn misalignment is always corrected. The single PURE owner so any later tuning is DRY.
export const LANE_SNAP_EPSILON = 0.5 // px.

// ── F-ice-slide (ice-slide §2/§3, D4/D5/D6) — the low-friction "ice glide" feel scalars, beside the tank-feel
// anchors above (the LANE_* / TANK_SIZE owners). PURE DATA (no Phaser) read ONLY by the coupled Tank movement
// spine (entities/Tank.ts): when a tank's CENTER sits on a TILE.ICE cell, releasing the direction key keeps it
// gliding ~1 tile with momentum decay instead of stopping dead (the classic slippery ice). Owned ONCE here (DRY)
// so any later tuning is a single edit; the verifier ignores them (plain feel scalars, no invariant references
// them — like the LANE_* numbers). Single-axis glide only (KISS/YAGNI) — only the last-driven axis ever carries
// momentum, so the no-diagonal invariant stays STRUCTURAL (the cross axis is never written non-zero).

// ICE_FRICTION (D4) — the per-SECOND multiplicative RETENTION of glide speed while coasting on ice (0 < f < 1).
// Applied as `glideVel *= ICE_FRICTION ** dt` each frame the player holds NO key but still glides on ice, so the
// decay is framerate-independent (the px/s convention — dt in seconds). Tuned LOW (0.09 retained per second → a fast
// exponential die-off) so the tank coasts ~1 tile before |glideVel| drops under ICE_GLIDE_CUTOFF + settles. The
// coast distance is ∫v dt = (moveSpeed − ICE_GLIDE_CUTOFF)/(−ln f); at f=0.09, moveSpeed≈104, cutoff=8 → ~40px ≈
// one TILE_SIZE (the design's "~1 tile" target). Lower f = a snappier stop, higher f = a longer slide (DRY tuning).
export const ICE_FRICTION = 0.09 // per-second glide retention on ice (0<f<1 — coasts ~1 tile then settles).

// ICE_GLIDE_CUTOFF (D5) — the tiny px/s FLOOR below which the coasting glide settles to rest (velocity → 0, the
// lane re-settle fires). Without it the exponential decay would creep forever sub-pixel; this snaps the tank to a
// clean stop once it has effectively stopped, so it never drifts imperceptibly off its lane. The single PURE owner.
export const ICE_GLIDE_CUTOFF = 8 // px/s — below this the ice coast settles to a dead stop (and re-settles the lane).

// ── F3 Combat & terrain (F3 §5.2, Decisions D4/D7/D8, AC5/AC6/AC8/AC9) — PURE combat DATA (no Phaser) ──
// All Phaser-free numbers/flags the F3 combat resolution reads. Owned ONCE here (DRY) so the scene's
// overlap callbacks, Tank's hit funnel, and Base's loss guard read the SAME truth — and the verifier still
// node-imports this module unchanged (a stray Phaser import would throw under node, re-proving purity, AC11).

// BULLET_DAMAGE (F3 §5.2, D7, AC5) — HP a single bullet removes from a tank/base. The classic shot does 1.
export const BULLET_DAMAGE = 1 // HP per bullet hit.

// TANK_MAX_HP (F3 §5.2, D7, AC5) — default tank HP. A basic/fast/power tank (and every PLAYER tank) dies in
// ONE hit. The enemy armor type overrides this with ARMOR_TANK_HP for multi-hit (the enemy feature, reserved).
export const TANK_MAX_HP = 1 // HP — a one-hit tank (the classic default).

// ARMOR_TANK_HP (F3 §5.2 / F4 §5.2, D7, AC4) — the enemy armor type's HP (multi-hit). F3 RESERVED this at 3;
// F4 CHANGES it to 4 (issue #3): the classic armor tank flashes FOUR times (white→grey→…) and dies on the
// FOURTH hit, so AC4's "survives ARMOR_TANK_HP hits" is literally true at 4 — the ARMOR spec's `maxHp` reads
// this constant (ONE owner — DRY), so armor's multi-hit comes "for free" via the same F3 HP subtraction.
export const ARMOR_TANK_HP = 4 // HP — the armor enemy survives four hits (the four-flash multi-hit tank, AC4).

// BASE_HP (F3 §5.2, D6, AC6) — the eagle dies to a SINGLE bullet (the classic instant loss). One hit → run over.
export const BASE_HP = 1 // HP — a single bullet ends the run.

// SPAWN_IFRAME (F3 §5.2, D7/D11, AC5/AC8) — SECONDS of post-respawn invulnerability (the blink window). While
// it ticks down a tank's isHittable() is false, so a fresh respawn can't be instantly re-killed.
export const SPAWN_IFRAME = 1.5 // s — post-respawn invulnerability window.

// FRIENDLY_FIRE (F3 §5.2, D8, AC9) — the co-op friendly-fire toggle (default OFF). The scene's bullet×tank +
// bullet×bullet filters read it ONCE: a player bullet passes an allied player tank, same-side shots don't
// cancel. Flip to true to re-enable FF with NO code change (the seam — the policy is data, KISS/SOLID).
export const FRIENDLY_FIRE = false // co-op friendly-fire disabled by default.

// ── Stage / spawn (Decision 7, §5.2) — the classic stage shape ──
export const ENEMIES_PER_STAGE = 20 // enemy tanks to clear in a normal stage.
export const MAX_CONCURRENT_ENEMIES = 6 // on-screen enemy cap (the larger 17×17 board affords more pressure); the rest queue and stagger in.
export const BOSS_STAGE_EVERY = 5 // every 5th stage spawns a heavy "boss tank" (a behavior tag on the same entity).

// ── F4 Enemy tanks (F4 §5.2, Decisions D4/D8, AC1/AC2/AC3/AC7) — PURE spawn-loop + AI tunables (no Phaser) ──
// All Phaser-free numbers the F4 spawn loop (GameScene) + the enemy AI tick (Tank.updateAI) read. Owned ONCE
// here (DRY) so the scene + the entity share the SAME truth; the verifier still node-imports this module (a
// stray Phaser import would throw under node — re-proving purity, AC11). Times are in SECONDS (the dt unit).

// SPAWN_BLINK_TIME (F4 §5.2, AC2) — SECONDS a freshly-spawned enemy BLINKS before becoming a live combatant.
// Reuses the F3 `spawnIframe` cue: during it isHittable() is false AND the scene skips updateAI/fire, so a
// new enemy can't materialise on top of a player bullet/tank (the classic spawn telegraph).
export const SPAWN_BLINK_TIME = 1.0 // s — the spawn-blink telegraph window.

// SPAWN_STAGGER_BASE (F4 §5.2, D8, AC1 → F6 §5.2/AC8 balance) — base SECONDS between staggered spawns at stage
// 0; scaled DOWN by stages.ts `spawnIntervalScale(stageIndex)` so deeper stages stream enemies faster (never
// instant — clamped). F6 (D10/AC8): 2.0→1.8 (a touch faster baseline stream so an early stage isn't a slow
// trickle — still well above the SPAWN_INTERVAL_MIN_SCALE floor, so the cadence stays bounded/non-instant).
export const SPAWN_STAGGER_BASE = 1.8 // s — base delay between consecutive enemy spawns (F6: 2.0→1.8, AC8).

// AI_REDECIDE_MIN / AI_REDECIDE_MAX (F4 §5.2, D4, AC3) — the wander re-decide window (SECONDS). Every random
// interval in [MIN,MAX] the AI picks a new cardinal (a runtime random OFF the seeded level pin — D4). Bounds
// the "how often the enemy changes its mind" feel: too fast = jittery, too slow = predictable.
export const AI_REDECIDE_MIN = 0.6 // s — shortest wander commitment.
export const AI_REDECIDE_MAX = 1.6 // s — longest wander commitment.

// AI_SEEK_BIAS (F4 §5.2, D4, AC3) — probability [0,1] a re-decide steps TOWARD the target (the eagle base or
// the nearest player, Manhattan-greedy) vs. a random wander cardinal. Higher = the enemies push the base
// harder. 0.6 keeps them mostly purposeful but still wandering (the classic Battle City feel).
export const AI_SEEK_BIAS = 0.6 // 0..1 — chance a re-decide seeks the target instead of wandering.

// ── F-smart-ai (smart-ai §2/§5, D1/D2/D5) — deeper enemy AI feel scalars, beside the AI_SEEK_BIAS/AI_REDECIDE_*
// anchors above. PURE DATA (no Phaser) read ONLY by the coupled enemy AI (entities/Tank.updateAI + the per-tank
// AI-profile derived in its ctor) + the spawn-time cohort flip (scenes/GameScene._spawnStep). Owned ONCE here
// (DRY) so any later tuning is a single edit; the verifier ignores them (plain feel scalars, like the AI_*/LANE_*
// numbers — no invariant references them). They keep AI randomness OFF the seeded determinism pin: the in-tick
// wander/seek/aim rolls stay runtime Math.random(); the ONLY seeded draw is the cohort coin flip, which rides the
// EXISTING stageRng stream the spawn loop already advances (so the procedural-stage gate is byte-unaffected — §5).

// AI_EAGLE_RUSH_RATE (D2) — fraction [0,1] of spawned enemies flagged into the EAGLE-RUSH cohort: a rusher
// HARD-COMMITS to the eagle base (it targets the eagle regardless of a closer player + seeks it at the raised
// AI_SEEK_BIAS_RUSH below), so there is real, visible base pressure instead of every enemy treating the eagle and
// the players symmetrically. The scene flips it per spawn with `enemy.aiRushEagle = stageRng() < AI_EAGLE_RUSH_RATE`
// — exactly the `enemy.carrier = stageRng() < CARRIER_RATE` pattern two lines away (DRY). The boss never sets it.
export const AI_EAGLE_RUSH_RATE = 0.35 // 0..1 — share of enemies that hard-commit to rushing the eagle base.

// AI_SEEK_BIAS_RUSH (D1/D3) — the RAISED seek probability [0,1] a rusher uses in place of its per-type aiSeekBias:
// it both COMMITS to the eagle (Decision 3) and wanders far less (this high bias), so it pushes the fort hard
// without any pathfinding (the carved corridor to the fort already guarantees reachability). Set well above
// AI_SEEK_BIAS so a rusher reads as purposeful pressure, but < 1 so it still re-decides at obstacles (no grinding).
export const AI_SEEK_BIAS_RUSH = 0.9 // 0..1 — the eagle-rush cohort's high seek bias (purposeful base pressure).

// AI_AIM_TOLERANCE (D4) — the px half-width of the "aligned enough to fire" band. An enemy only sets firePressed
// when SOME target (the eagle or a live player) lies within this many px of its facing axis AND in front of its
// barrel — so shots read as INTENTIONAL (aimed down a lane at a real target) rather than sprayed on the bare
// cooldown beat. ~half a tile keeps the gate forgiving enough that a roughly-lined-up enemy still fires, while a
// tank pointed at a wall/empty lane holds fire. The per-type aiAimTolerance derives off this anchor in the ctor.
export const AI_AIM_TOLERANCE = TILE_SIZE * 0.6 // px — the cross-axis alignment band a target must sit within to fire.

// CARRIER_RATE (F4 §5.2, AC7) — fraction [0,1] of spawned enemies flagged red-flash power-up CARRIERS. On a
// carrier's death its onDropFlag(x,y) fires once (the F5 pickup seam); F4 only flags + marks the drop point.
export const CARRIER_RATE = 0.25 // 0..1 — share of enemies that flash red + drop a power-up on death (F5 spawns it).

// SPAWN_INTERVAL_MIN_SCALE (F4 §5.2, D8, AC6) — the FLOOR the monotone `spawnIntervalScale` clamps to, so a
// deep stage streams enemies FASTER but never instantly (a base of SPAWN_STAGGER_BASE × this is the fastest
// cadence). Owned here so stages.ts + the verifier read the SAME floor (DRY). 0 < it ≤ 1.
export const SPAWN_INTERVAL_MIN_SCALE = 0.35 // the smallest spawn-interval multiplier (the fastest stream).

// ── F5 Power-ups & meta (F5 §5.2, Decisions D8, AC5) — PURE meta-economy DATA (no Phaser) ──
// CURRENCY_RATIO (F5 §5.2, D8, AC5 → F6 §5.2/AC8 balance) — the fraction (0,1) of a run's final score banked
// into the SHARED persistent currency on run end: `currency += floor(score · CURRENCY_RATIO)`. The SINGLE
// owner (DRY) — MetaState.bankRun reads it. The power-up effect durations live in config/powerups.ts + the
// upgrade costs/effects in config/tank-upgrades.ts (each beside its own concern — DRY); only this scalar is
// shared broadly enough to sit in the constants owner. Keep it in (0,1) (the bank is a FRACTION of the run,
// not all of it). F6 (D10/AC8): retuned 0.1 → 0.12 (a slightly kinder meta drip so the Hub upgrades feel
// reachable over a few runs — still well inside (0,1), the verifier's NEW `0 < CURRENCY_RATIO < 1` guard).
export const CURRENCY_RATIO = 0.12 // 12% of run score banks into the shared currency on run end (AC5/AC8).

// ── F6 Boss milestone & banner (F6 §5.2, Decisions D1/D2/D3/D5, AC1/AC2/AC3) — PURE boss/banner DATA (no Phaser) ──
// All Phaser-free numbers the boss spec (config/tanks.ts `BOSS`/`bossSpecForStage`), the telegraph render cue
// (entities/Tank.ts), and the STAGE-N-CLEARED banner (GameScene/HUDScene) read. Owned ONCE here (DRY) so the
// pure spec, the coupled entity, and the coupled scenes share the SAME truth; the verifier node-imports the two
// invariant-bearing ones (BOSS_TANK_HP feeds the spec it asserts; the rest feed coupled code). Times in SECONDS.

// BOSS_TANK_HP (F6 §5.2, D1, AC2) — the base boss HP. Set ABOVE ARMOR_TANK_HP (4) so the boss is heavier than
// the armor tank "for free" via the SAME F3 HP funnel (multi-hit — it survives this many bullet hits). The
// verifier asserts BOSS.maxHp ≥ ARMOR.maxHp, so this MUST stay ≥ ARMOR_TANK_HP.
export const BOSS_TANK_HP = 12 // HP — the boss survives twelve hits (3× the armor tank — the capstone wall, AC2).

// BOSS_TELEGRAPH_SEC (F6 §5.2, D2, AC2) — the pre-fire wind-up window (SECONDS). The boss ARMS this on each
// shot and only fires when it elapses (a visible warning blink during it), so its heavier/faster volley stays
// readable + dodgeable (the reference's "every attack is telegraphed" idea on the ONE FSM). UNSCALED by depth
// (bossSpecForStage leaves it fixed) so a deeper boss stays equally readable.
export const BOSS_TELEGRAPH_SEC = 0.5 // s — the boss's visible fire wind-up (the dodge window, AC2).

// BOSS_HP_PER_BOSS_STAGE (F6 §5.2, D3, AC2/AC9) — the per-boss-stage HP ramp. bossSpecForStage scales the boss's
// maxHp up by this × the boss number (1 on the first boss stage, 2 on the second, …) so a deeper boss is tankier
// (the reference's scaleBossSpec philosophy, trimmed to the single maxHp scalar). The verifier asserts the fold
// is monotone non-decreasing in maxHp + never weaker than the base.
export const BOSS_HP_PER_BOSS_STAGE = 4 // +HP per boss stage (the deeper-boss tankiness ramp, AC2/AC9).

// BOSS_HP_MAX (F6 §5.2, D3, AC2) — the clamp on the scaled boss HP so a very deep boss stays beatable in a stage's
// time budget (the difficulty envelope stays bounded — the reference/D3 "monotone but bounded" stance). The fold
// clamps maxHp to this ceiling; the verifier's monotone check tolerates a flat (clamped) top.
export const BOSS_HP_MAX = 40 // HP — the deepest boss's HP ceiling (bounded so the fight stays winnable, AC2).

// TELEGRAPH_FILL (F6 §5.3 issue #4, AC2) — the warning fill colour the boss's body + barrel blink to during the
// telegraph wind-up. DISTINCT from every tank's `color`/`colorFlash` (a bright warning amber) so the wind-up is
// unmistakable. Consumed ONLY by the coupled Tank visual (a render colour — the verifier ignores it, like tiles).
export const TELEGRAPH_FILL = 0xffeaa7 // bright warning amber — the telegraph blink fill (programmer-art, AC2).

// STAGE_CLEARED_BANNER_SEC (F6 §5.2, D5, AC3) — how long the "STAGE N CLEARED" banner shows after a boss stage
// is cleared. Decayed on the REAL dt (so it shows through the run-end freeze beat); the HUD renders it while > 0.
export const STAGE_CLEARED_BANNER_SEC = 2.5 // s — the STAGE-N-CLEARED banner duration (AC3).

// ── F-extra-life 1UP milestones (extra-life §5.2, D1, AC1) — PURE shared milestone DATA (no Phaser) ──
// EXTRA_LIFE_SCORE (D1, AC1) — the points-per-1UP step (the classic Battle City "extra tank every 20000"). The
// SINGLE shared owner (DRY): RunState seeds its carried `nextExtraLifeScore` threshold from it, GameScene passes
// it as the `step` to the pure extraLivesCrossed() helper, and the verifier reads it — one number, no inlined
// duplicate. A run that earns this many points awards +1 life to every present player slot (the shared-score
// model — D4). The verifier node-imports this module (a stray Phaser import would throw — re-proving purity).
export const EXTRA_LIFE_SCORE = 20000 // points per 1UP milestone (every 20000 earned → +1 life to all slots, AC1).

// ── F-stage-bonus between-stage tally (stage-bonus §5.2, D2/D4, AC2/AC3) — PURE shared tally DATA (no Phaser) ──
// The classic Battle City between-stage bonus screen: on EVERY stage clear a brief overlay lists the kills-by-type
// (count × points) plus a flat stage-clear bonus, then the next stage's intro curtain plays. Both numerics are
// shared (GameScene arms/banks them; the verifier could read them) so they live in the constants owner ONCE (DRY).

// STAGE_BONUS_SEC (D2, AC3) — how long the bonus tally overlay holds before the deferred stage advance fires. A
// COUPLE of seconds so it feels snappy (and it is skippable on the P1 fire/start edge — D6). GameScene arms its
// `tallyTimer` to this; the timer is decayed on the REAL dt (so it ends in real time through the world freeze).
export const STAGE_BONUS_SEC = 2.2 // s — the between-stage bonus-tally window (snappy + skippable, AC2/AC3).

// STAGE_CLEAR_BONUS (D4, AC2) — the flat points banked to runState.score ONCE per stage clear (the classic
// "you cleared the stage" reward on top of the per-type kill subtotals). Added at the one-shot clear site so it
// is banked exactly once; the tally string shows it on its own line + folds it into the displayed TOTAL.
export const STAGE_CLEAR_BONUS = 1000 // points — the flat per-stage-clear bonus (banked once per clear, AC2).

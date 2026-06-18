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

// ── Grid (Decision 7, §5.2) — the classic Battle City 13×13 tile playfield ──
// 13×13 tiles at 48 px = a 624 px square playfield (fits the 720 height with margin). Each BRICK
// tile is split into SUB_CELLS×SUB_CELLS (2×2 = 4) independently-destructible sub-cells — the
// classic brick behaviour. Later features (F2 generator, GameScene, HUD) import these NAMES; F0
// owns them once so they never drift.
export const GRID_COLS = 13
export const GRID_ROWS = 13
export const TILE_SIZE = 48 // px — one grid tile (13 × 48 = 624 px square playfield).
export const SUB_CELLS = 2 // each BRICK tile = SUB_CELLS² (2×2 = 4) destructible sub-cells (classic).
export const SUB_CELL_SIZE = TILE_SIZE / SUB_CELLS // px — one destructible brick sub-cell (24 px).

// ── Layout (Decision 7, §5.2) — centered square playfield + a right-side HUD panel (like the original) ──
// Derived from DESIGN_*, GRID_*, TILE_SIZE so the single owner stays internally consistent. The
// HUD panel sits to the RIGHT of the playfield (lives / score / next-enemy icons in later features).
export const HUD_PANEL_WIDTH = 256 // px — right-side info panel (lives, score, enemy queue) like the classic.
export const PLAYFIELD_W = GRID_COLS * TILE_SIZE // px — playfield width (624).
export const PLAYFIELD_H = GRID_ROWS * TILE_SIZE // px — playfield height (624).
// Center the (playfield + a gap + HUD panel) block horizontally; center the playfield vertically.
export const PLAYFIELD_GAP = 32 // px — gap between the playfield and the HUD panel.
export const PLAYFIELD_X = Math.round((DESIGN_WIDTH - (PLAYFIELD_W + PLAYFIELD_GAP + HUD_PANEL_WIDTH)) / 2)
export const PLAYFIELD_Y = Math.round((DESIGN_HEIGHT - PLAYFIELD_H) / 2)
export const HUD_PANEL_X = PLAYFIELD_X + PLAYFIELD_W + PLAYFIELD_GAP // px — top-left x of the side HUD panel.

// ── Tank / bullet feel (Decision 7, §5.2) — placeholder values; later features tune the feel ──
// All speeds are in px/SECOND (dt is handled in seconds at the boundary — the project's dt convention);
// cooldowns are in SECONDS. The NAMES are the DRY anchors entities + the HUD read later.
export const TANK_SPEED = 96 // px/s — grid-aligned 4-directional tank movement (2 tiles/s).
export const BULLET_SPEED = 360 // px/s — a bullet travels straight until it hits terrain/a tank/the wall.
export const FIRE_COOLDOWN = 0.35 // s — minimum delay between a player's shots.
export const MAX_PLAYER_BULLETS = 1 // bullets a single player may have on-screen at once (classic starts at 1).
export const START_LIVES = 3 // lives a player begins a run with.

// ── F1 Tank core (F1 §5.2, Decisions 5/6/9/10, AC3/AC7/AC8/AC10) — DERIVED from / sit beside the values above ──
// All PURE data (no Phaser): GameScene + entities + the bullet pool import these NAMES; owning them
// here ONCE keeps the pure/coupled split intact (the verifier still node-imports this module) and the
// numbers from drifting (DRY). Each is intent-revealing per the cited design AC/Decision.

// TANK_SIZE (F1 §5.2, D5/D6) — the square tank BODY ≈ 2 tiles, a hair inset (−4) so two tanks driving
// in adjacent lanes don't perpetually graze their colliders. Derived from TILE_SIZE (DRY). NOTE it is
// deliberately NOT a multiple of SUB_CELL_SIZE (24) — the turn-time re-center snaps the body CORNER to
// the 24 px lane lattice (not the center), keeping that lane math integer-clean (D6, §5.3 step 4).
export const TANK_SIZE = TILE_SIZE * 2 - 4 // px — the ~2-tile square tank body (92).

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

// LANE_SNAP_EPSILON (F1 §5.2, D5/D6, AC3) — the dead-band (px) for the turn-time cross-axis re-center
// (§5.3 step 4): if the body's cross-corner is already within this of its nearest SUB_CELL_SIZE lane the
// snap is a NO-OP, so the re-center can never oscillate around a lane center or fight Arcade frame-to-frame.
// Sub-pixel (0.5) so the corner stays visually lane-aligned. The single PURE owner so any later tuning is DRY.
export const LANE_SNAP_EPSILON = 0.5 // px.

// ── F3 Combat & terrain (F3 §5.2, Decisions D4/D7/D8, AC5/AC6/AC8/AC9) — PURE combat DATA (no Phaser) ──
// All Phaser-free numbers/flags the F3 combat resolution reads. Owned ONCE here (DRY) so the scene's
// overlap callbacks, Tank's hit funnel, and Base's loss guard read the SAME truth — and the verifier still
// node-imports this module unchanged (a stray Phaser import would throw under node, re-proving purity, AC11).

// BULLET_DAMAGE (F3 §5.2, D7, AC5) — HP a single bullet removes from a tank/base. The classic shot does 1.
export const BULLET_DAMAGE = 1 // HP per bullet hit.

// TANK_MAX_HP (F3 §5.2, D7, AC5) — default tank HP. A basic/fast/power tank (and every PLAYER tank) dies in
// ONE hit. The enemy armor type overrides this with ARMOR_TANK_HP for multi-hit (the enemy feature, reserved).
export const TANK_MAX_HP = 1 // HP — a one-hit tank (the classic default).

// ARMOR_TANK_HP (F3 §5.2, D7) — RESERVED for the enemy armor type (multi-hit). F3 spawns NO enemy, but pins
// the number here so the enemy feature reads ONE owner (DRY) — armor "for free" via the same HP subtraction.
export const ARMOR_TANK_HP = 3 // HP — the armor enemy survives three hits (reserved for the enemy feature).

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
export const MAX_CONCURRENT_ENEMIES = 4 // on-screen enemy cap (classic 4); the rest queue and stagger in.
export const BOSS_STAGE_EVERY = 5 // every 5th stage spawns a heavy "boss tank" (a behavior tag on the same entity).

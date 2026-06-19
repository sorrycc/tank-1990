# Construction mode — paint a 17×17 stage, save it, and PLAY it via the generator's StageDescription seam

## 1. Background / Intent

Battle City's CONSTRUCTION mode lets the player hand-author a map and then play it. Today every stage comes
from `generateStage(seed, cfg) → StageDescription` (PURE, headless-verified) and `_buildStage()` (GameScene.ts)
is the SOLE consumer: it news up `new TileMap(this, this.desc)`, places the eagle + players at `desc.base` /
`desc.playerSpawns`, and streams enemies from `desc.enemySpawns`. There is NO way to author a map.

GOAL: a Construction (level editor) scene reachable from the Title. The player paints the 17×17 grid (cycle
EMPTY/BRICK/STEEL/WATER/TREES/ICE/BASE) with the cursor/keys (and touch if cheap), saves the layout to
localStorage, and PLAYs it — feeding a HAND-AUTHORED `StageDescription` into GameScene INSTEAD of the procedural
generator, reusing TileMap + the entire combat/spawn spine UNCHANGED. The PURE generator stays byte-untouched and
`npm run verify` stays green. KISS: ONE grid, ONE clean seam, no per-stage editor campaign.

## 2. Key Decisions

1. **The seam is a PURE `buildCustomStage(grid) → StageDescription` in `config/customStage.ts` (new, PURE).**
   `_buildStage()` already branches NOTHING — it always calls `generateStage`. We add ONE pure function that
   takes a `number[][]` tile grid and returns the SAME `StageDescription` shape (reusing `windowCenter`,
   `FOOTPRINT`, `GRID_COLS/ROWS`, `TILE_SIZE` — all already PURE). It derives `base` from the single BASE cell the
   player painted (fallback to bottom-center if none), and places `enemySpawns` (3 top-band tankFits windows) +
   `playerSpawns` (2 bottom-band windows) exactly like the generator's steps 2–3. `seed` is a fixed sentinel,
   `isBoss` false, `motif: 'custom'`, `scatterCells: 0`. *Rationale:* DRY/SOLID — GameScene gets a
   `StageDescription` whether procedural or authored; the WHOLE downstream (TileMap, eagle, spawns, combat) is
   reused with NO branch. The verifier node-imports it and asserts its enclosure/round-trip (it is PURE).

2. **GameScene reads the custom map ONCE at run setup via a `RUN MODE` flag on `util/settings.ts` (DRY — reuse the
   existing settings key, no new save key for the SEAM).** `Settings` gains `playCustom: boolean` (default false).
   In `create()`, after `loadSettings()`, GameScene picks the stage source: `playCustom && a saved grid exists`
   → custom path. The SAVED GRID itself rides a NEW localStorage entry via `util/save.ts`'s defensive get/set
   (the grid is bulk data, NOT a preference — it belongs in its own key, mirroring `tank-1990:meta`).

3. **The saved grid lives in `util/customMap.ts` (new, PURE) — a thin typed wrapper over `save.ts` get/set under
   `tank-1990:custom`.** `loadCustomMap(): number[][] | null` (validates dims = GRID_ROWS×GRID_COLS + every cell a
   known TILE int, else null — never throws, inherits save.ts try/catch); `saveCustomMap(grid)`; `hasCustomMap()`.
   *Rationale:* SOLID — ONE owner of the grid schema + sanitize, like `settings.ts` owns the preference schema.
   PURE → the verifier node-imports + asserts the validate/round-trip (a corrupt blob degrades to null).

4. **`ConstructionScene` is its OWN Phaser scene (the brief's "its own scene", SOLID), modelled on
   `SettingsScene`/`HubScene`.** It draws the 17×17 grid as programmer-art rects at the SAME grid→screen map
   TileMap uses (`PLAYFIELD_X/Y + col/row·TILE_SIZE`, reusing `TILE_PROPS[t].color` for fill — DRY, the editor and
   the live stage read the SAME palette), a cursor rect, and a HUD strip (current brush, controls). It keeps a
   local `grid: number[][]` (seeded from `loadCustomMap()` or all-EMPTY). Keys: arrows move the cursor; SPACE/ENTER
   paints the current brush; B cycles the brush through the 7 tiles; ENTER-on-a-cell paints (same as SPACE); C
   clears to EMPTY; S saves (`saveCustomMap`); P saves + sets `playCustom=true` + `scene.start('Game')`; ESC saves
   + returns to Title (`playCustom=false`). Touch (if cheap): a pointerdown on a grid cell moves the cursor +
   paints (one handler, reusing the same paint path — no second code path). *Rationale:* KISS — one scene, one
   local grid, one paint path; no undo stack, no multi-map slots (YAGNI).

5. **The BASE brush is SINGLE-INSTANCE (KISS).** Painting BASE first clears any existing BASE cell so the grid has
   AT MOST one eagle (the combat assumes one `desc.base`). `buildCustomStage` finds that cell; if none was
   painted it defaults `base` to bottom-center (the generator's `(floor(cols/2), rows-1)`), so a map without a
   hand-placed eagle is still PLAYABLE (defensive, never crashes the eagle wiring).

6. **Title reaches Construction via a new `T` key (and a hint line), guarded by the SAME `editingSeed`/`started`
   latches as the existing `O`/start handlers (DRY).** `scene.start('Construction')`. No change to the
   difficulty/seed/start flow — Construction is a sibling route, like Settings.

7. **The custom run is a single endless stage from the authored grid, then advance() REVERTS to procedural (KISS,
   YAGNI).** The custom grid seeds ONLY stage 0 of the run; on clear, `advance()` chains the procedural generator
   as today (the brief asks to PLAY the custom map, not to author an infinite campaign). GameScene keeps a
   one-shot `_customGrid: number[][] | null` consumed in the FIRST `_buildStage()` only; every later rebuild falls
   through to `generateStage`. *Rationale:* the smallest correct change that "plays the custom map" without a new
   run-progression subsystem. Difficulty/enemy counts for stage 0 still come from `stageConfig(0)` (the roster is
   unchanged — only the TERRAIN/base/spawns come from the grid).

## 3. Files to touch

- **`src/config/customStage.ts`** (NEW, PURE) — `buildCustomStage(grid: number[][]): StageDescription`. Imports
  ONLY `GRID_COLS/ROWS`, `TILE_SIZE` (constants), `TILE` (tiles), and `windowCenter`/`FOOTPRINT`/`tankFits` (from
  LevelGenerator — already PURE, no Phaser). NO Phaser import (verifier node-imports it).
- **`src/util/customMap.ts`** (NEW, PURE) — `loadCustomMap()/saveCustomMap(grid)/hasCustomMap()` over
  `tank-1990:custom` via `save.ts` get/set, with dims + per-cell validation → null on corrupt (Decision 3).
- **`src/util/settings.ts`** (CHANGED, PURE) — add `playCustom: boolean` to `Settings` + `DEFAULT_SETTINGS`;
  `loadSettings()` coerces a non-boolean to `false` (defensive). Reuses the existing `tank-1990:settings` key (DRY).
- **`src/scenes/ConstructionScene.ts`** (NEW, Phaser-coupled) — the editor scene (Decision 4): grid render
  (reusing `TILE_PROPS[t].color`), cursor, brush cycle, paint, clear, save, PLAY, ESC; touch paint; all labels via
  `t()`. Modelled on `SettingsScene.ts`. NEVER verifier-imported.
- **`src/scenes/GameScene.ts`** (CHANGED) — in `create()`, after `loadSettings()`: if `settings.playCustom` and a
  valid `loadCustomMap()` exists, stash it in `this._customGrid`. In `_buildStage()`, if `this._customGrid` is set
  AND it's the first build (stageIndex === run start), `this.desc = buildCustomStage(this._customGrid)` then NULL
  the field; else `this.desc = generateStage(...)` (today's path). One small branch; everything downstream
  unchanged (Decisions 1/7). On entering Game, leave `playCustom` as the player set it — but a procedural run from
  the Title sets `playCustom=false` (Title route already implies procedural; see Decision 6).
- **`src/scenes/TitleScene.ts`** (CHANGED) — a `T` handler → `scene.start('Construction')` (latch-guarded) + a
  `t('title.construction')` hint line on the dim hint band (beside `title.settings`). The normal start gesture
  sets `playCustom=false` so a Title-launched run is procedural (so the custom flag is only true via the editor's
  PLAY).
- **`src/main.ts`** (CHANGED) — register `ConstructionScene` in the `scene: [...]` array (after Settings).
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts`** (CHANGED, PURE) — the editor + Title keys (§6), both locales.
- **`scripts/verify-gen.mjs`** (CHANGED) — a small block node-importing `buildCustomStage` + `customMap.ts`:
  assert a painted grid round-trips through `buildCustomStage` to a valid `StageDescription` (one BASE, 3 enemy +
  2 player spawns, dims = 17×17), and `loadCustomMap` rejects a corrupt blob → null (the PURE round-trip proof).

## 4. Acceptance criteria

1. From the Title, `T` opens a Construction scene showing a 17×17 grid (programmer-art rects, the SAME palette as
   the live stage), a cursor, and the current brush.
2. Arrows move the cursor; B cycles the brush EMPTY→BRICK→STEEL→WATER→TREES→ICE→BASE; SPACE/ENTER paints; C
   clears; painting BASE leaves AT MOST one eagle on the grid.
3. S saves the grid to `tank-1990:custom`; re-opening Construction restores the saved grid; a corrupt/missing blob
   loads as all-EMPTY (never crashes).
4. P (PLAY) saves + launches GameScene on the AUTHORED map: TileMap renders the painted terrain, the eagle sits at
   the painted BASE (or bottom-center fallback), players + enemies spawn, and the FULL existing combat runs —
   reusing TileMap + the combat spine with NO new gameplay path.
5. After clearing the custom stage, `advance()` continues with the procedural generator (the custom grid seeds
   only stage 0); a Title-launched run is always procedural (`playCustom=false`).
6. `buildCustomStage` is PURE + total: any 17×17 grid yields a valid `StageDescription` (one base, 3 enemy + 2
   player spawns, GRID-SPACE tiles, window-center coords); the verifier drives it.
7. Every new string is in `en.ts` AND `zh-CN.ts` (ZH ⊆ EN). `npm run typecheck`, `npm run verify`, `npm run build`
   all stay green.

## 5. How `npm run verify` stays green

- The verifier node-imports ONLY PURE modules. The two NEW pure modules (`config/customStage.ts`,
  `util/customMap.ts`) import NOTHING Phaser-coupled (they reuse `windowCenter`/`tankFits`/`FOOTPRINT` from the
  already-PURE LevelGenerator + `constants`/`tiles`); a stray `import 'phaser'` would throw under node, so the
  successful import RE-PROVES purity. The verifier adds one block driving `buildCustomStage` + `loadCustomMap`.
- **The procedural path is byte-untouched.** `generateStage`, `stageConfig`, `selectMotif`, the seed chain, and the
  §6 byte-pinned generator output are NOT modified — `buildCustomStage` is a SEPARATE function. The §5 monotonicity
  sweep, §6 determinism pin, and §7f seed-chain assertions run on the UNCHANGED generator, so the
  determinism + procedural-stage gates stay green by construction.
- `settings.ts` gains one boolean field with a defensive coerce (the verifier's settings round-trip, if present,
  still passes — additive); `en.ts`/`zh-CN.ts` gain additive keys (the ZH ⊆ EN dictionary-shape check passes).
- No new shared numeric constant is required — the editor reuses `GRID_COLS/ROWS`, `TILE_SIZE`, `PLAYFIELD_X/Y`,
  `TILE_PROPS` (all already in constants/tiles). The cursor/HUD pixel offsets are LOCAL coupled-scene tunables
  (like SettingsScene's), NOT in constants.ts (DRY — they are single-site render details).

## 6. i18n keys to add (both locales)

- `title.construction` — Title hint, EN `'T  Construction'`, zh `'T  地图编辑'`.
- `construction.title` — scene heading, EN `'CONSTRUCTION'`, zh `'地图编辑'`.
- `construction.brush` — brush label, EN `'Brush: {tile}'`, zh `'笔刷：{tile}'`.
- `construction.tile.empty/brick/steel/water/trees/ice/base` — the 7 tile names (EN `EMPTY`…`BASE`; zh
  `空地/砖墙/钢墙/水域/树林/冰面/基地`).
- `construction.controls` — the controls line, EN
  `'Arrows move · SPACE paint · B brush · C clear · S save · P play · ESC back'`, zh equivalent.
- `construction.saved` — the save-confirm blip line, EN `'Saved'`, zh `'已保存'`.

All read via `t()` in `ConstructionScene` / `TitleScene`; no literal user-facing string inlined.

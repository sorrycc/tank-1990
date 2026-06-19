# Tank 1990

A faithful **Battle City** (坦克大战) clone — a 2D **top-down grid** tank shooter. Defend the
**eagle** base (bottom-center, walled in brick) and clear each stage of enemy tanks across a
**17×17** tile grid. Difficulty escalates **endlessly**; a run ends only when the eagle is
destroyed or all lives are spent. Score and best results persist between runs. Difficulty, language,
and your last run's seed persist too, so you can dial in a run or replay an exact one.

Built with **Phaser 3 + Vite + TypeScript**, **programmer-art primitives** (colored rectangles /
Phaser `Graphics` + generated textures, synthesized WebAudio SFX) — the only bundled asset is the
Title screen's real Battle City **"Game Start" jingle** (`public/audio/start.mp3`). Runs fully
offline and from `file://`.

## The game

- **Defend the eagle, clear the stage.** Each stage streams in the classic enemy types —
  **basic / fast / power** (fast bullet) **/ armor** (multi-hit) — plus the **stealth** tank that
  hides in trees, staggered, capped at 4 on-screen, ~20 per normal stage. Destroy them all to advance
  to the next, harder stage.
- **Seeded, varied stages.** A pure seeded generator builds every stage: an enclosed, always-reachable
  fort + the terrain (destructible **brick**, indestructible **steel**, tank-blocking **water**,
  cover **trees**, low-friction **ice**). Each stage picks a seeded layout **motif** — *open*,
  *fortress*, *maze*, or *corridors* — so stages read distinctly, not just denser.
- **Eight power-ups,** dropped by a red-flashing carrier enemy: **helmet** (timed shield), **clock**
  (freeze all enemies), **shovel** (fortify the base walls to steel, timed), **star** (upgrade your
  tank tier — at max star your bullets even **break steel**), **grenade** (destroy all on-screen
  enemies), **tank** (extra life), plus the amphibious **boat** (drive over water, timed) and the
  **drill** round (your bullets pierce one brick layer, timed). A timer bar in the HUD shows how long
  a timed power-up has left.
- **Smarter enemies.** A configurable cohort hard-commits to **rushing the eagle**, tanks fire only
  when roughly **aimed** at a target (shots read as intentional, not sprayed), and each archetype has
  its own flavor. A fifth **stealth** tank hides in the trees — it melts into the canopy when it sits
  still and reappears the instant it moves or shoots.
- **Terrain that bites.** Destructible **brick**, indestructible **steel**, tank-blocking **water**,
  concealing **trees**, and low-friction **ice** — on ice a tank keeps **gliding** for about a tile
  after you release the key, and turns are slippery.
- **1UP extra lives** at score milestones (every threshold grants +1 life to all players), and a
  **between-stage bonus tally** that breaks down kills-by-type (count × points) plus a stage-clear
  bonus before the next stage's intro curtain.
- **Boss milestone.** Every 5th stage spawns a heavy **boss tank** (telegraphed, multi-hit). Clearing
  it shows a **STAGE N CLEARED** banner.
- **Pick your run.** A Title-screen chooser for **difficulty** (Easy / Normal / Hard) and an optional
  **start stage**, plus a **seed challenge** — every run is deterministic from a 32-bit seed shown as
  8 hex on the Title; copy it or type one in to replay an identical run.
- **Settings + accessibility.** A dedicated **Settings** screen (master **volume**, default
  **difficulty**, **language** EN / 简体中文 — persisted), audio (synthesized WebAudio SFX, a
  stage-start jingle + a game-over sting, and the real Battle City **"Game Start" jingle** on the
  Title's start gesture), and on-screen **touch controls** (a D-pad + fire button) that appear only
  on touch devices.
- **Construction mode.** A built-in **level editor** (open with `T` from the Title): paint the 17×17
  grid with all six terrain types + the base, save it to local storage, and **play** your hand-authored
  stage through the same combat spine.
- **2-player local co-op.** P1 and P2 share the eagle and the score; friendly fire is off. Single
  player works too (P2 simply absent).
- **Meta hub.** A fraction of each run's score banks into a **shared currency** spent in the **Hub**
  on **permanent per-player tank upgrades** (two columns, one shared bank). Banked currency is
  spendable immediately on the next visit.

## Controls

| action     | P1            | P2          |
| ---------- | ------------- | ----------- |
| move       | **W A S D**   | **Arrows**  |
| fire       | **J**         | **Numpad 0**|

| shared              | key             |
| ------------------- | --------------- |
| start / confirm     | **SPACE / ENTER** |
| pause / resume      | **P / ESC**     |
| mute audio          | **M**           |

On the **Title** screen: **← / →** difficulty, **↑ / ↓** start stage, **S** edit the run seed (type
8 hex, **ENTER** to confirm / **ESC** to cancel), **R** random seed, **O** open Settings, **T** open
Construction mode. In the **level editor**: **arrows** move the cursor, **SPACE** paint, **B** cycle
brush, **C** clear, **S** save, **P** play, **ESC** back.

On **touch devices** an on-screen D-pad (left) and fire button (right) appear automatically and drive
P1 — no keyboard needed.

The flow is **Title → Hub → Game → Game Over**, then back to the Hub. Pause (**P** / **ESC**) freezes
the run and shows a read-only panel with the controls and the current run summary.

## Run

```sh
npm install
npm run dev        # dev server (opens the browser)
```

## Scripts

| script              | what it does                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server.                                                       |
| `npm run build`     | Production build into `dist/` (relative `base`, runs from `file://`).  |
| `npm run preview`   | Serve the built `dist/`.                                               |
| `npm run typecheck` | `tsc --noEmit` (strict).                                                |
| `npm run verify`    | Headless determinism + procedural-stage quality gate (`tsx scripts/verify-gen.mjs`). |

## Architecture

Layered modules under `src/`: `scenes/ core/ world/ entities/ combat/ config/ effects/ audio/ i18n/
util/`. A strict **pure/coupled split**: `config/*` and `world/LevelGenerator` import **nothing** from
Phaser, so the verifier imports them headlessly under plain node and re-derives the stage invariants
(enclosure, footprint-aware reachability, the terrain-count ceiling, motif determinism + the
regression pin) from the emitted data — a real quality gate, not self-certification. Phaser-coupled
code (the scenes, entities, `world/TileMap`, `effects/*`, `audio/*`) is never imported by the
verifier. Seeded determinism via `util/rng.ts` (`mulberry32`); defensive `localStorage` in
`util/save.ts` (every access try/catch, never throws). Shared numbers live once in
`src/config/constants.ts`. Both **English** and **简体中文** UI layers live under `src/i18n`.

See `docs/designs/` for the per-feature design docs and `CREDITS.md` for the programmer-art /
offline constraint.

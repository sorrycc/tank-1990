# Tank 1990

A faithful **Battle City** (坦克大战) clone — a 2D **top-down grid** tank shooter. Defend the
**eagle** base (bottom-center, walled in brick) and clear each stage of enemy tanks across a
classic **13×13** tile grid. Difficulty escalates **endlessly**; a run ends only when the eagle is
destroyed or all lives are spent. Score and best results persist between runs.

Built with **Phaser 3 + Vite + TypeScript**, **programmer-art primitives only** (colored
rectangles / Phaser `Graphics` + generated textures + synthesized WebAudio — no external sprite /
font / audio assets). Runs fully offline and from `file://`.

## The game

- **Defend the eagle, clear the stage.** Each stage streams in the four classic enemy types —
  **basic / fast / power** (fast bullet) **/ armor** (multi-hit) — staggered, capped at 4 on-screen,
  ~20 per normal stage. Destroy them all to advance to the next, harder stage.
- **Seeded, varied stages.** A pure seeded generator builds every stage: an enclosed, always-reachable
  fort + the terrain (destructible **brick**, indestructible **steel**, tank-blocking **water**,
  cover **trees**, low-friction **ice**). Each stage picks a seeded layout **motif** — *open*,
  *fortress*, *maze*, or *corridors* — so stages read distinctly, not just denser.
- **Six classic power-ups,** dropped by a red-flashing carrier enemy: **helmet** (timed shield),
  **clock** (freeze all enemies), **shovel** (fortify the base walls to steel, timed), **star**
  (upgrade your tank tier), **grenade** (destroy all on-screen enemies), **tank** (extra life). A
  timer bar in the HUD shows how long a timed power-up has left.
- **Boss milestone.** Every 5th stage spawns a heavy **boss tank** (telegraphed, multi-hit). Clearing
  it shows a **STAGE N CLEARED** banner.
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

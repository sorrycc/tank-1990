# Tank 1990

A faithful **Battle City** (坦克大战) clone — a 2D **top-down grid** tank shooter. Defend the
**eagle** base (bottom-center, walled in brick) and clear each stage of enemy tanks across a
classic **13×13** tile grid. **Endless** escalating difficulty; a run ends only when the eagle is
destroyed or all lives are spent.

Built with **Phaser 3 + Vite + TypeScript**, **programmer-art primitives only** (colored
rectangles / Phaser `Graphics` + generated textures — no external sprite / font / audio assets).
Runs fully offline and from `file://`.

## Status

**F0 — scaffold.** This is the project skeleton: it installs clean, boots six scenes
(Boot → Title → Hub → Game + a parallel HUD overlay → GameOver), and is green on
`typecheck` / `build` / `verify`. There is **no gameplay yet** — entities, the seeded stage
generator, input, power-ups, enemy AI, the boss, and the Hub upgrade trees each land in their own
later feature.

## Run

```sh
npm install
npm run dev        # dev server (opens the browser)
```

Click-through: **Title → Hub → Game** (a placeholder playfield rectangle renders with the parallel
HUD overlay).

## Scripts

| script              | what it does                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server.                                                       |
| `npm run build`     | Production build into `dist/` (relative `base`, runs from `file://`).  |
| `npm run preview`   | Serve the built `dist/`.                                               |
| `npm run typecheck` | `tsc --noEmit` (strict).                                                |
| `npm run verify`    | Headless determinism + purity gate (`tsx scripts/verify-gen.mjs`).     |

## Architecture

Layered modules under `src/`: `scenes/ config/ util/` (more layers — `world/ entities/ combat/
effects/ audio/ i18n/` — arrive with their own features). A strict **pure/coupled split**:
`config/*` and the later `world/LevelGenerator` import **nothing** from Phaser, so the verifier can
import them headlessly under plain node; Phaser-coupled code (scenes, entities) is never imported by
the verifier. Seeded determinism via `util/rng.ts` (`mulberry32`); defensive `localStorage` in
`util/save.ts` (every access try/catch, never throws). Shared numbers live once in
`src/config/constants.ts`.

See `docs/designs/` for the per-feature design docs and `CREDITS.md` for the programmer-art /
offline constraint.

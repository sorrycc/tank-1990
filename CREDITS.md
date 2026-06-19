# Credits

## Art & audio

**Programmer-art only.** Every visual in Tank 1990 is generated in code from colored rectangles
and simple shapes (Phaser `Graphics` + generated textures). There are **no external sprite,
image, font, or audio assets** — nothing is downloaded or bundled from third parties. The game
runs fully offline (and from `file://`).

Likewise **all sound is synthesized in code** via WebAudio — the sound effects and the music (a
looping Title theme, a stage-start jingle, a game-over sting) are built from oscillators and noise
through gain envelopes in `src/audio/Sound.ts`. No audio files are loaded or bundled.

This is a deliberate constraint: zero asset licensing, zero network fetches, instant boot.

## Code & libraries

- **[Phaser 3](https://phaser.io/)** — 2D game framework (MIT License).
- **[Vite](https://vitejs.dev/)** — build tool / dev server (MIT License).

The seeded PRNG (`mulberry32`, in `src/util/rng.ts`) is a public-domain algorithm, used
verbatim from the sibling `dead-cell` project for cross-compatible deterministic seeds.

## Inspiration

Tank 1990 is a faithful clone of **Battle City** (坦克大战), the 1985 Namco game. This is an
original code re-implementation; no original assets are used.

## License

Original game code in this repository is the author's own. Third-party libraries retain their
respective licenses as noted above.

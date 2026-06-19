# Credits

## Art & audio

**Programmer-art only (visuals).** Every visual in Tank 1990 is generated in code from colored
rectangles and simple shapes (Phaser `Graphics` + generated textures). There are **no external
sprite, image, or font assets**.

**Sound is synthesized in code** via WebAudio — the sound effects and the music (a game-over sting)
are built from oscillators and noise through gain envelopes in `src/audio/Sound.ts` — with **one
exception**: the real Battle City "Game Start" jingle, played at the start of every stage, is a
bundled audio file (`public/audio/start.mp3`, attributed under **Inspiration** below).

Everything (that one clip included) is bundled at build time, so the game still runs fully offline
and from `file://` — no runtime network fetches.

## Code & libraries

- **[Phaser 3](https://phaser.io/)** — 2D game framework (MIT License).
- **[Vite](https://vitejs.dev/)** — build tool / dev server (MIT License).

The seeded PRNG (`mulberry32`, in `src/util/rng.ts`) is a public-domain algorithm, used
verbatim from the sibling `dead-cell` project for cross-compatible deterministic seeds.

## Inspiration

Tank 1990 is a faithful clone of **Battle City** (坦克大战), the 1985 Namco game. This is an
original code re-implementation. The one bundled audio clip — the **"Game Start" jingle**
(`public/audio/start.mp3`) — is the original Battle City (NES) cue, sourced from a YouTube upload
(channel: GBelair); the underlying audio is © Namco. No other original assets are used.

## License

Original game code in this repository is the author's own. Third-party libraries retain their
respective licenses as noted above.

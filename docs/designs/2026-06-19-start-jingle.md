# Start Jingle — real Battle City "Game Start" audio on the Start gesture

## 1. Background

The Title screen currently plays a synthesized, looping chiptune theme (`TITLE_THEME` in
`src/audio/Sound.ts`, started by `TitleScene` via `sfx.titleMusicStart()`). The user wants the
real Battle City (NES) "Game Start" jingle instead — the short fanfare the original game plays
once when a run begins. The clip has been downloaded to `/tmp/tank-music/title.mp3` (5.2 s, MP3,
48 kHz stereo, ~108 KB).

This is the project's **first bundled audio asset**. Until now the game has been strictly
programmer-art / zero-asset (synthesized SFX + synthesized music, no `load.*` calls anywhere).
That constraint is deliberately relaxed for this one clip, with the decision and trade-offs
recorded by the user.

## 2. Requirements Summary

- **Goal:** Replace the synthesized looping Title theme with the real Battle City "Game Start"
  jingle, played **once** on the Start gesture (Title -> Hub), not looped on the Title screen.
- **Scope:** vendor the MP3 under `public/audio/`, add the first `load.audio` in `BootScene`,
  play it on the start gesture, remove the now-dead synth-title code in `Sound.ts`, and correct
  the docs that assert "zero audio assets".
- **Out of scope:** the stage jingle, game-over sting, and all SFX (remain synthesized); the
  Hub -> Game `stageStart` fanfare (unchanged).

## 3. Acceptance Criteria

1. Pressing Start on the Title (SPACE / ENTER / pointer) plays the Battle City jingle exactly
   once; it continues audibly into the Hub for its full ~5 s and does not loop.
2. The Title screen itself plays no background music (the synth `TITLE_THEME` loop is removed);
   all SFX and the stage / game-over melodies are unchanged.
3. The MP3 is bundled under `public/audio/`, loaded via `BootScene.preload()`, and works in dev,
   the `dist/` build, and from `file://` (relative `base`).
4. Mute (`M`) and the Settings volume slider continue to govern the jingle (it routes through
   Phaser's global sound manager, `this.sound`).
5. `npm run typecheck` passes; no dead code is left in `Sound.ts`; `CREDITS.md` / `README.md` no
   longer claim zero audio assets, and the clip is attributed.

## 4. Problem Analysis

- **Approach A — loop the clip on the Title screen** (the original plan) -> rejected: the asset
  turned out to be the 5 s NES "game start" fanfare, not a loopable theme; looping it would
  grate, and browser autoplay policy keeps it silent until the first gesture anyway.
- **Approach B — play once on the Title screen entry** -> rejected: same autoplay problem, and
  the only Title gesture is the one that immediately leaves to the Hub, so it would be cut off.
- **Chosen approach — play once on the Start gesture (Title -> Hub)** -> the Start press is the
  user gesture that unlocks the WebAudio context, so the jingle is reliably audible; Phaser's
  global sound manager keeps the one-shot playing across the scene swap for its full length. This
  also matches the original game's semantics (the jingle is the *game start* sound).

## 5. Decision Log

**1. Where is playback triggered?**

- Options: A) in `enterHub()` only · B) also on the `O` / `T` nav gestures
- Decision: **A)** — the jingle is the game-start sound; only the Start -> Hub gesture qualifies.
  `O` (Settings) and `T` (Construction) keep their existing `uiSelect` blip.

**2. Keep the `uiSelect` blip on Start as well?**

- Options: A) replace it with the jingle · B) play both
- Decision: **A)** — the jingle *is* the start sound; stacking the synth confirm blip under it is
  redundant (KISS). `uiSelect` stays in `Sound.ts` and is still used by 6 other scenes.

**3. Asset key and filename**

- Options: A) `titleMusic` / `title.mp3` · B) `startJingle` / `start.mp3`
- Decision: **B)** — named for its role (a one-shot start jingle), not "title music", since it no
  longer backs the Title screen.

**4. Loader path string**

- Options: A) `/audio/start.mp3` (root-absolute) · B) `audio/start.mp3` (relative)
- Decision: **B)** — relative, no leading slash, so it resolves correctly under Vite's relative
  `base` (`./`) in dev, the `dist/` build, and from `file://` (the project's offline constraint).

**5. Play mechanism**

- Options: A) `this.sound.add('startJingle', { loop:true }).play()` then stop on SHUTDOWN ·
  B) `this.sound.play('startJingle')` fire-and-forget
- Decision: **B)** — a global one-shot; Phaser auto-destroys it on `complete`, and it survives the
  Title `SHUTDOWN` so it plays through into the Hub. No loop, no manual stop, no `_loopTimer`.
  Survival is **established from the installed Phaser 3.90 source**, not assumed (see §6 Play):
  the sound manager is a Game-level Global Manager exposed on each scene *by reference*, and scene
  shutdown does not stop or remove sounds. Still treated as a runtime-verified gate in §8 (AC1).

**6. Fate of the synth title-theme code**

- Options: A) keep it as dead code · B) remove it
- Decision: **B)** — remove `TITLE_THEME`, `titleMusicStart()`, `musicStop()`, and the
  `_loopTimer` field (KISS / no dead code). `_playSequence`, `STAGE_JINGLE` / `stageJingle()`,
  `GAME_OVER_STING` / `gameOverSting()` stay — they are still used and still synthesized.

## 6. Design

**Asset.** Copy `/tmp/tank-music/title.mp3` to `public/audio/start.mp3` (new `public/` dir). Vite
serves `public/` at the site root in dev and copies it verbatim into `dist/` on build; with the
existing relative `base: './'` the file resolves from `file://` too.

**Load (`BootScene`).** Add the project's first `preload()`:

```ts
preload(): void {
  this.load.audio('startJingle', 'audio/start.mp3')
}
```

`BootScene` is the first, auto-started scene and already exists solely to do one-time setup before
handing off to `Title`, so it is the natural home for the one load call. Under a NoAudio sound
manager the loader still fetches the file harmlessly; nothing plays it there.

**Play (`TitleScene`).**

- Remove the two synth-title lines in `create()`:
  `sfx.titleMusicStart()` and `this.events.once(SHUTDOWN, () => sfx.musicStop())`.
- In `enterHub()`, replace `sfx.uiSelect()` with `this.sound.play('startJingle')`.

`this.sound` is Phaser's single global sound manager (the same instance the Settings scene drives
via `this.sound.volume`). Survival across the Title -> Hub swap is **grounded in the installed
Phaser 3.90 source**, not assumed:

- `'sound'` is listed under `DefaultPlugins.Global` (`node_modules/phaser/src/plugins/DefaultPlugins.js:25-33`)
  — "Global Managers created by the Phaser.Game instance". `Game.js:260` creates exactly one:
  `this.sound = SoundManagerCreator.create(this)`.
- `PluginManager.js:217` installs Global plugins onto each scene **as references**, so
  `scene.sound` is that one game-level manager, not a per-scene instance/facade.
- `Systems.shutdown()` (`node_modules/phaser/src/scene/Systems.js`) only sets status and emits
  `Events.SHUTDOWN` — it has **no** `sound.stopAll`/`remove`/destroy. Shutting down Title does not
  touch sounds the scene started.
- `BaseSoundManager.play()` registers `sound.once(COMPLETE, sound.destroy)`
  (`BaseSoundManager.js:328`) — a non-looping one-shot plays to its end, then self-destroys.

Together these establish that `this.sound.play('startJingle')` keeps playing for its full ~5 s
after `this.scene.start('Hub')` fires `SHUTDOWN`, then cleans itself up. The Start press is a user
gesture, so the audio context is unlocked at exactly that moment -> reliably audible. Global mute
(`M`) and `this.sound.volume` apply automatically. **AC1 is still a runtime-verified gate** (§8):
the by-ear audible-continuity-into-Hub check must pass; if it ever cut off, the fallback is to add
the sound to a longer-lived owner (the global manager directly) or detach it from scene ownership
— but the source above says no such fallback is needed.

**Cleanup (`Sound.ts`).** Remove `TITLE_THEME`, the `_loopTimer` field, `titleMusicStart()`, and
`musicStop()`; trim the `// -- Music` section comments that describe the looping title theme. Keep
`_playSequence` (used by `stageJingle` / `gameOverSting`), `STAGE_JINGLE` / `stageJingle()`, and
`GAME_OVER_STING` / `gameOverSting()`.

**Docs.** Two kinds of now-false claims must be corrected (the offline claim itself stays true — a
bundled clip needs no network at runtime):

- *Zero-audio-asset claims:* `CREDITS.md:7` ("image, font, or audio assets — nothing downloaded or
  bundled from third parties"), `CREDITS.md:10-12` ("all sound is synthesized in code … No audio
  files are loaded or bundled"), and `README.md:11` ("font / audio assets). Runs fully offline").
  Update to note the single bundled clip and attribute it: Battle City (NES) "Game Start" jingle,
  sourced from YouTube (GBelair upload); original audio (c) Namco.
- *"Looping Title theme" claims (now false — the loop is removed):* `CREDITS.md:11` and
  `README.md:45-46` both describe "a looping Title theme" among the synthesized music. Drop the
  looping-Title-theme wording; the stage-start jingle + game-over sting remain synthesized.

**`BootScene` header comment (BootScene.ts:4-5)** currently states "F0 has no assets to load …
no network load.* calls" — adding `preload()` + `load.audio` makes that false. Update the comment
to reflect the one bundled audio load (project convention is accurate block comments).

**`Sound.ts:11` / `:30`** ("no `load.*` calls (AC6)") stays — it is scoped to `Sound.ts`, which
still synthesizes everything and loads nothing (the MP3 loads in `BootScene`, not here).
Intentionally left untouched; called out so the implementer neither misses nor over-edits it.

**`index.html`** "no external assets" comment is a minor accuracy follow-up. Note: a binary asset
fetched over `file://` is genuinely new surface for this project (until now nothing was loaded);
Verification step 3 exercises it in dev, `dist/`, and `file://`.

## 7. Files Changed

- `public/audio/start.mp3` — new: the bundled Battle City "Game Start" jingle (5 s MP3).
- `src/scenes/BootScene.ts` — add `preload()` with the first `load.audio('startJingle', ...)`;
  **update the header comment (lines 4-5)** that claims "no assets to load / no load.* calls".
- `src/scenes/TitleScene.ts` — drop the synth title-theme start/stop (lines 35-36); play
  `startJingle` once on the Start gesture in `enterHub()` (replacing the `sfx.uiSelect()` there).
- `src/audio/Sound.ts` — remove the dead synth title-theme machinery (`TITLE_THEME`,
  `titleMusicStart`, `musicStop`, `_loopTimer`); trim the `// -- Music` comments that describe the
  looping title theme. (The `:11` / `:30` "no load.* calls" comments are intentionally **kept** —
  still true for this file.)
- `CREDITS.md` — correct the zero-audio-asset claims (`:7`, `:10-12`) and the "looping Title theme"
  wording (`:11`); attribute the clip.
- `README.md` — correct the "no audio assets" line (`:11`) and drop "looping Title theme" (`:45-46`).
- `index.html` — minor: correct the "no external assets" comment.

## 8. Verification

1. [AC1] **(verified gate)** `npm run dev`; on the Title press SPACE -> the Battle City jingle
   plays once and **continues audibly into the Hub for its full ~5 s**; it does not restart/loop or
   cut off at the scene swap. This by-ear check is the gate for the play-on-gesture approach — the
   §6 source evidence establishes it, but the runtime check must confirm it. (Audio cannot be
   confirmed by ear in a headless agent environment; the implementer verifies mechanism via the
   source citations + typecheck/build, and this manual by-ear step is left to the user.)
2. [AC2] On the Title before pressing Start, no background music plays; trigger a stage curtain
   and game-over elsewhere -> their synth melodies still play.
3. [AC3] `npm run build && npm run preview` and also open `dist/index.html` via `file://` ->
   `audio/start.mp3` loads and plays on Start in both.
4. [AC4] Press `M` (mute) -> no jingle on Start; in Settings lower the volume -> jingle quieter.
5. [AC5] `npm run typecheck` passes; `grep -n "TITLE_THEME\|titleMusicStart\|musicStop" src` returns
   nothing; `CREDITS.md` / `README.md` mention and attribute the clip.

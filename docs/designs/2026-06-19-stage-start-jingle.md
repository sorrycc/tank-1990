# Stage-Start Jingle — play the real Battle City "Game Start" MP3 on every stage start

## 1. Background

Commit `7ac953a` ("feat(audio): real Battle City 'Game Start' jingle on Title start gesture") added
the project's first and only bundled audio asset: `public/audio/start.mp3` — the real NES Battle
City "Game Start" fanfare (~5 s), loaded once in `BootScene` as
`this.load.audio('startJingle', 'audio/start.mp3')`. It currently plays **exactly once**, on the
Title screen's Start gesture (Title → Hub) via `this.sound.play('startJingle')` in `TitleScene`.

The user wants this jingle to play on **every 关卡 (stage/level) start** instead. In `GameScene`,
every stage — the first build and every advance — opens through one shared `_buildStage()` method
(`src/scenes/GameScene.ts:409`), which arms a 1.4 s "STAGE N" intro curtain and plays two
SYNTHESIZED cues: `sfx.stageStart()` (a 2-note SFX) and `sfx.stageJingle()` (a 4-note flourish).
That shared site is the natural, DRY hook for "every stage start".

## 2. Requirements Summary

- **Goal:** play the bundled `startJingle` MP3 at the start of every stage, triggered at the shared
  `_buildStage()` site so it fires for stage 1 and every advance alike.
- **Decision (user, via AskUserQuestion):** the MP3 **replaces** the two synth stage cues — it
  becomes the sole stage-start sound, not layered over them.
- **Decision (user, via AskUserQuestion):** the jingle plays **on stage starts only** — the
  Title → Hub gesture no longer plays it (the small `uiSelect` blip is restored there).
- **Scope:** the trigger move (Title → stage builder), removal of the now-dead synth stage code, and
  correcting the user-facing docs that say the jingle plays "on the Title's start gesture".
- **Out of scope:** the asset itself (already bundled + loaded), all other SFX, the game-over sting,
  the 1.4 s curtain timing / "STAGE N" HUD label (unchanged), Settings/mute plumbing (works for
  free through Phaser's global sound manager).

## 3. Acceptance Criteria

1. The `startJingle` MP3 plays once at the start of **every** stage — the first stage
   (`create()` → `_buildStage()`) and every advance (`_advanceStage()` → `_buildStage()`) — fired
   from the single shared `_buildStage()` site.
2. The synth `sfx.stageStart()` and `sfx.stageJingle()` calls are gone from `_buildStage()`; the MP3
   is the sole stage-start sound.
3. The now-orphaned synth code (`stageStart()`, `stageJingle()`, and the `STAGE_JINGLE` melody table)
   is removed from `src/audio/Sound.ts`. Shared helpers still used by `gameOverSting()`
   (`_playSequence`, `MUSIC_GAIN`, `MUSIC_BPM`, `MUSIC_BEAT`, `GAME_OVER_STING`) remain.
4. The Title → Hub start gesture no longer plays `startJingle`; it plays `sfx.uiSelect()` (the blip
   that was there before `7ac953a`). The Title key/pointer gesture still unlocks the WebAudio context.
5. Mute (`M`) and the Settings volume slider continue to govern the stage jingle (it routes through
   Phaser's global sound manager, `this.sound`).
6. User-facing docs (`CREDITS.md`, `README.md`) no longer claim the jingle plays "on the Title's
   start gesture" / "once when a run begins"; they describe per-stage playback. No stale source comment
   is left referencing the removed synth stage cues OR misdescribing where the MP3 plays (the
   `BootScene.ts` header and the `Sound.ts` "played by TitleScene" notes are corrected).
7. `npm run typecheck` and `npm run verify` pass; no dead code remains.

## 4. Problem Analysis

- **Trigger in `create()` and `_advanceStage()` separately** -> rejected: two sites for one concept;
  `create()` already delegates to `_buildStage()` for the first stage and `_advanceStage()` delegates
  for advances, so two calls would duplicate logic and risk drift (violates the file's own DRY note
  at `_buildStage()`).
- **Play the MP3 through the `Sound` façade** -> rejected: `Sound` is the synth-only WebAudio façade
  (no `load.*`, no asset playback by design — see its header). The MP3 is a *loaded asset*; Phaser's
  global sound manager (`this.sound`) plays it, exactly as `TitleScene` already does.
- **Chosen approach — `this.sound.play('startJingle')` at the shared `_buildStage()` site**, with the
  two synth calls removed and the orphaned synth code deleted. One site, one mechanism, mirrors the
  established Title playback pattern, honors global mute/volume for free.

## 5. Decision Log

**1. Where is playback triggered?**
- Options: A) in `create()` + `_advanceStage()` separately · B) the shared `_buildStage()` site
- Decision: **B)** — `_buildStage()` is the one builder both paths call; firing here covers the first
  stage and every advance with a single line (DRY, the file's own convention).

**2. Play mechanism**
- Options: A) a new method on the `Sound` façade · B) `this.sound.play('startJingle')` direct
- Decision: **B)** — the `Sound` façade is for synthesized SFX (it owns a WebAudio graph and loads no
  assets, by design). The MP3 is a loaded asset; Phaser's global manager plays it, identical to the
  existing `TitleScene` call. Honors global mute/volume automatically (AC5).

**3. Stop a still-playing instance before re-playing?**
- Options: A) `this.sound.stopByKey('startJingle')` first · B) plain `play()`
- Decision: **B)** — in normal play a stage cannot advance within the clip's ~5 s: a full stage
  playthrough (clear every enemy) plus the bonus-tally beat always sit between two `_buildStage()`
  calls, so instances do not overlap. A double-play is possible only in a degenerate instant-clear case
  (e.g. a hand-authored Construction level with no enemies, cleared in under 5 s), and it is **harmless**
  — Phaser auto-destroys each fire-and-forget one-shot on `complete`, so at worst two copies of the same
  clip briefly overlap. Plain `play()` matches the established Title pattern (YAGNI); we do **not** claim
  overlap is impossible, only that it is rare and benign.

**4. Fate of the synth stage cues**
- Options: A) keep `stageStart()` / `stageJingle()` defined but unused · B) remove them + `STAGE_JINGLE`
- Decision: **B)**, firm — the project militantly removes dead code, and the cited commit `7ac953a` set
  the exact precedent (it deleted the dead synth *title-theme* machinery — `TITLE_THEME`,
  `titleMusicStart`, `musicStop`, `_loopTimer`). The same now applies to the orphaned stage cues, so
  implementation **proceeds with deletion** as the default. (The AskUserQuestion option text for
  "Replace them" said "synth methods stay defined" — that was reassurance that *other* features don't
  break, not a commitment to retain dead code; deletion is the project-consistent reading. Reversible in
  one edit if the user objects.)

**5. Title-gesture replacement sound**
- Options: A) `sfx.uiSelect()` (the pre-`7ac953a` blip) · B) silence
- Decision: **A)** — restores the original confirm blip; matches the Title's `O` (Settings) and `T`
  (Construction) handlers, which already blip `uiSelect` on their nav gestures.

## 6. Design

**Trigger (GameScene).** In `_buildStage()`, replace the two synth calls with one asset play:

```ts
// before
this.curtainTimer = STAGE_INTRO_SEC
this.sfx.stageStart()
this.sfx.stageJingle()

// after
this.curtainTimer = STAGE_INTRO_SEC
// Play the real Battle City "Game Start" jingle once at every stage start (first build + each
// advance). Fire-and-forget on Phaser's GAME-level sound manager (a loaded asset, not the synth
// façade); Phaser auto-destroys it on complete and honors global mute (M) + the Settings volume.
this.sound.play('startJingle')
```

The asset is in Phaser's global cache (loaded once in `BootScene`), so any scene — including a
freshly-created `GameScene` each run — can play it. Under a `NoAudioSoundManager` (headless / the
`verify` path), `this.sound.play()` is a safe no-op, exactly like the existing Title call.

**Audio-context unlock (verified against installed Phaser source).** Removing the Title play does not
break audibility. `WebAudioSoundManager.unlock()` (`node_modules/phaser/dist/phaser.js:208483-208524`)
binds a single `unlockHandler` — which calls `this.context.resume()` — to body `keydown`, `mousedown`,
`mouseup`, `touchstart`, and `touchend`, **independent of any `play()` call**. So the first user gesture
on the Title (a SPACE/ENTER keydown *or* a pointer) resumes the suspended context; `keydown` is
explicitly covered, so keyboard-only starts unlock too. The Hub's navigation gestures reinforce this.
By the time `GameScene` builds stage 1, the context is already running and the stage-1 jingle is audible.

**Sound.ts cleanup.** Delete `stageStart()`, `stageJingle()`, and the `STAGE_JINGLE` melody table.
Keep `_playSequence`, `MUSIC_GAIN`, `MUSIC_BPM`, `MUSIC_BEAT`, and `GAME_OVER_STING` — still used by
`gameOverSting()`. Update every stale comment that references the removed cues or misdescribes where the
MP3 plays: the `respawn()` comment that says "covered by stageStart"; the music-section header
(`Sound.ts:38`) that lists "a stage-start jingle"; and the two duplicated notes (`Sound.ts:60` and
`Sound.ts:322`) that say the MP3 is "played by TitleScene" — after this change the MP3 is played by
`GameScene._buildStage()` at each stage start, not by `TitleScene`.

**TitleScene.** In `enterHub()`, swap `this.sound.play('startJingle')` for `sfx.uiSelect()` and
update the comment to reflect that the jingle now lives at stage starts.

**Docs & stale source comments.** Correct `CREDITS.md` ("the Title screen's 'Game Start' jingle, played
once when a run begins") and `README.md` ("on the Title's start gesture", plus the synth-audio list that
names a "stage-start jingle") to describe per-stage playback. Reword `BootScene.ts`'s header comment
(`BootScene.ts:6`), which says the asset is "played once on the Title's Start gesture", to "played at the
start of every stage". `HubScene.ts`'s comment referencing "the Game's stageStart fanfare" is reworded to
"stage-start jingle". `index.html` only says "one short audio jingle" (no location claim) — left unchanged.

## 7. Files Changed

- `src/scenes/GameScene.ts` — `_buildStage()`: replace `sfx.stageStart()` + `sfx.stageJingle()` with
  `this.sound.play('startJingle')`; update the comment.
- `src/audio/Sound.ts` — remove `stageStart()`, `stageJingle()`, and the `STAGE_JINGLE` table; fix the
  stale `respawn()` / music-header (`:38`) / "played by TitleScene" (`:60`, `:322`) comments.
- `src/scenes/TitleScene.ts` — `enterHub()`: replace `this.sound.play('startJingle')` with
  `sfx.uiSelect()`; update the comment.
- `src/scenes/BootScene.ts` — reword the header comment that says the asset plays "on the Title's Start
  gesture" to "at the start of every stage".
- `src/scenes/HubScene.ts` — reword the stale "the Game's stageStart fanfare" comment.
- `CREDITS.md` — correct the "played once on the Title start gesture" claim to per-stage playback.
- `README.md` — same correction in the intro line and the Settings/accessibility bullet (drop the
  removed synth "stage-start jingle" from the list).

## 8. Verification

1. [AC1/AC2] `npm run dev`, start a run: the MP3 fanfare plays as stage 1's curtain rises; clear the
   stage and confirm it plays again as the next stage builds. No 2-note/4-note synth cue is heard at
   stage start.
2. [AC3/AC7] `npm run typecheck` and `npm run verify` pass; `grep -rn "stageStart\|stageJingle\|STAGE_JINGLE" src`
   shows no definitions or callers remain.
3. [AC4] Pressing Start on the Title plays the small `uiSelect` blip (not the MP3). Start specifically
   via the **keyboard** (SPACE) — not a pointer — and confirm the MP3 is audible at stage 1's build,
   proving the `keydown` gesture unlocked the WebAudio context (the verified Phaser unlock path).
4. [AC5] Toggle mute (`M`) and lower the Settings volume — the stage jingle respects both.
5. [AC6] `CREDITS.md` / `README.md` no longer say the jingle plays on the Title gesture; no source
   comment references the removed synth stage cues.

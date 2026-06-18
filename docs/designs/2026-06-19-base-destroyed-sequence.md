# Tank 1990 — Distinct eagle-destroyed loss sequence (big blast + camera beat)

> A small, focused JUICE pass on the run's single most dramatic moment — losing the eagle — entirely
> inside the existing entity/effects/camera plumbing. NO new scene, NO rule change, NO new asset, NO
> change to the pure/coupled split or the verifier. FX-only. Format mirrors the staged-explosion juice
> doc.

---

## 1. Background

The eagle is the lose condition, but losing it is anticlimactic: `Base.onHit()` just swaps the eagle
rect's fill from yellow to a flat brown (`RUBBLE_COLOR`), and `GameScene._onBulletHitSolid`'s TILE.BASE
branch fires the SAME `effects.explosion(..., { big: true })` any tank kill produces. The run then ends
through the existing guarded `_triggerGameOver` (which already does a red camera flash + a 700 ms defer
before the GameOver scene swap). So the most important beat in the run looks identical to chipping a
fourth enemy off the count.

The fix is purely cosmetic and stays inside the moving parts that already own these visuals: `Base`
owns the eagle rect, so it gets the white-to-rubble FLASH; the TILE.BASE branch is the SINGLE eagle-hit
site, so it gets a STAGGERED multi-burst blast + a stronger camera flash/shake; then it falls through to
the UNCHANGED `_triggerGameOver`. No run logic moves — the one-shot guard, the rubble swap, the
gameOver guard, and the 700 ms handoff are all untouched.

**Conventions mirrored from the existing code:** the entity owns its own visual + a tracked tween it
kills on teardown (so a mid-flight tween never touches a destroyed rect — the project's defer/teardown
discipline); the camera FX go through the existing `cameras.main` calls (`shake`/`flash`); the staggered
bursts use `time.delayedCall` (the same deferral primitive the brick chip + the stage advance use); the
eagle-hit site stays the SINGLE owner of the run-over edge (it calls `base.onHit()`, the guard funnels to
`_triggerGameOver`). Programmer-art primitives + the pooled effects façade ONLY — no `load.image`.
Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Make the eagle-destroyed loss read as a distinct, heavier beat — a multi-burst blast at the
eagle, a stronger camera flash/shake, and the eagle visual flashing white before settling to rubble —
WITHOUT touching any run logic or the verifier.

**In scope:**

- **`src/entities/Base.ts` (CHANGED, Phaser-coupled):** `onHit()` keeps the one-shot guard, but instead
  of a flat fill swap it flashes the eagle WHITE then tweens the fill toward `RUBBLE_COLOR` via a TRACKED
  scene tween, then fires `onDestroyed` (unchanged). A new `destroy()` kills the tracked tween before
  destroying the rect (so a teardown mid-flash can't tick a dead rect).
- **`src/scenes/GameScene.ts` (CHANGED):** in `_onBulletHitSolid`'s TILE.BASE branch (the single
  eagle-hit site), replace the lone `effects.explosion(..., { big: true })` with 2–3 STAGGERED big blooms
  via `time.delayedCall` AT THE EAGLE CENTER plus a stronger camera flash + shake, then fall through to
  the existing `base.onHit()` → `_triggerGameOver` (unchanged). `_teardownStage` calls the new
  `base.destroy()` (was `base.rect.destroy()`) so the tracked flash tween is killed on stage teardown.

**Out of scope (explicitly NOT built):** any change to `_triggerGameOver` (the red flash, the bank, the
700 ms defer, the scene swap stay byte-identical — the new beat is purely the lead-in); a new scene /
overlay; any rule/economy/timing change (the run still ends the same way); a new asset (programmer-art +
the pooled effects façade only); a new i18n string (the FX are wordless); any change to
`world/LevelGenerator.ts` / `config/*` / `scripts/verify-gen.mjs` (Base + GameScene are Phaser-coupled,
NEVER verifier-imported — the headless gate is byte-identical); a distinct eagle-blast SFX (the existing
`sfx.explosion({ big: true })` already plays — adding a second sound is YAGNI for an FX-only pass).

---

## 3. Acceptance Criteria

1. **AC1 — the eagle flashes white-to-rubble.** `Base.onHit()` flips `destroyed` ONCE (the guard
   unchanged), sets the rect WHITE immediately, and tweens its fill toward `RUBBLE_COLOR` over a short
   beat via a tracked scene tween, then fires `onDestroyed` (unchanged). The rect settles on
   `RUBBLE_COLOR`.
2. **AC2 — a staggered multi-burst blast + a stronger camera beat at the eagle.** The TILE.BASE branch
   fires 2–3 big blooms STAGGERED via `time.delayedCall` at the EAGLE CENTER (`base.rect.x/y`) plus a
   camera flash + a shake stronger than a normal kill, then calls `base.onHit()` (the run-over edge,
   unchanged). A normal tank kill is UNCHANGED (still one `explosion({ big: true })`).
3. **AC3 — the loss still ends the run exactly as before.** `base.onHit()` → `onDestroyed` →
   `_triggerGameOver` (the one-shot gameOver guard, the bank, the red flash, the 700 ms defer, the
   GameOver swap) are BYTE-UNCHANGED. The new FX are the lead-in only.
4. **AC4 — no stale tween on teardown.** `_teardownStage` calls `base.destroy()`, which kills the tracked
   flash tween before destroying the rect, so a stage teardown DURING the flash can't tick a destroyed
   GameObject.
5. **AC5 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run build`
   exit 0; `npm run verify` prints OK + exits 0 UNCHANGED (this feature touches ONLY `entities/Base.ts` +
   `scenes/GameScene.ts` — both Phaser-coupled, NEVER verifier-imported). Programmer-art primitives only;
   runs offline.

---

## 4. Decision Log

1. **D1 — The eagle flash lives in `Base` (the rect's owner); the blast + camera beat live in the
   TILE.BASE branch (the single eagle-hit site) — no new owner.** `Base` already owns the eagle rect + the
   one-shot guard + the rubble swap; the branch already owns the explosion + SFX + the `base.onHit()`
   call. So the flash is a `Base` concern and the multi-burst/camera is a branch concern — each change
   lands where the existing responsibility already is (SOLID). *Rationale:* no new façade, no new helper,
   no new scene — the smallest possible surface (KISS). The run-over edge stays the SINGLE `base.onHit()`
   → `_triggerGameOver` funnel (unchanged).
2. **D2 — The eagle flash is a TRACKED scene tween on the rect's fill, killed by a new `Base.destroy()`.**
   `onHit()` sets the rect white, then `scene.tweens.addCounter` drives a 0→1 counter whose `onUpdate`
   lerps the fill white→`RUBBLE_COLOR`; the tween handle is stored on the Base. A new `destroy()` kills
   that tween (idempotent) before `rect.destroy()`. *Rationale:* a Phaser `GameObject.destroy()` does NOT
   auto-stop tweens, so a stage teardown mid-flash (the deferred `_advanceStage` path) could tick a tween
   onUpdate against a destroyed rect — the project's teardown discipline says the owner kills its own
   timers/tweens (AC4). KISS/DRY — one tracked handle, one kill site.
3. **D3 — The blast is 2–3 STAGGERED big blooms via `time.delayedCall` at the eagle center, reusing the
   existing `effects.explosion({ big: true })`.** Instead of one burst, the branch fires the first burst
   immediately and schedules 1–2 more after small delays at the eagle center — reusing the SAME pooled
   `explosion` the kill site already uses (DRY — no new pool kind). *Rationale:* a rolling multi-burst
   reads as a heavier, drawn-out blast than a single pop, at zero new primitive cost. `time.delayedCall`
   is the same defer primitive the brick chip + stage advance already use (DRY). The bursts fire at the
   EAGLE CENTER (not the bullet point) so the blast is centred on what was lost.
4. **D4 — A stronger camera flash + shake, distinct from `_triggerGameOver`'s red flash.** The branch adds
   a brief white camera flash + a shake noticeably stronger than a normal kill's shake (the kill's
   `KILL_SHAKE_MULT` is the baseline). `_triggerGameOver`'s 280 ms RED flash (the run-end marker) is
   UNCHANGED and follows after — so the beat reads as "white blast at the eagle" → "red run-end flash".
   *Rationale:* the eagle blast wants its OWN camera punch separate from the generic run-end marker; using
   `cameras.main.flash`/`shake` directly here keeps it a one-site cosmetic with no new owner (KISS/YAGNI —
   no Effects API change for a single bespoke site).
5. **D5 — No rule/timing/scene change; the verifier is untouched.** Everything new is cosmetic FX in two
   Phaser-coupled files. The 700 ms `_triggerGameOver` defer already gives the bursts + flashes time to
   read before the scene swaps. *Rationale:* FX-only is the brief; touching run logic would risk the
   one-shot/gameOver guards the run-over depends on (YAGNI). The pure generator + config + verifier are
   never imported here, so the headless gate is byte-identical (AC5).

---

## 5. Design

### 5.1 Module layout (this phase)

CHANGES `entities/Base.ts` (the white-to-rubble tracked flash + a `destroy()`) and `scenes/GameScene.ts`
(the staggered multi-burst + stronger camera beat in the TILE.BASE branch + `base.destroy()` on
teardown). NO new file; the pure modules + the verifier are untouched.

```
src/
  entities/
    Base.ts        # CHANGED (Phaser-coupled): onHit() flashes white→rubble via a TRACKED tween; + destroy()
                   #   kills the tween before destroying the rect. One-shot guard + onDestroyed unchanged.
  scenes/
    GameScene.ts   # CHANGED: TILE.BASE branch fires 2–3 staggered big blooms at the eagle center + a
                   #   stronger camera flash/shake, then base.onHit() (unchanged). _teardownStage → base.destroy().
```

### 5.2 The eagle flash (`Base`)

- **`onHit()` (CHANGED):** the one-shot guard + `this.destroyed = true` + `this.onDestroyed?.()` are
  unchanged. Between the guard and the callback: set the rect fill to WHITE (the flash peak), then start a
  TRACKED `scene.tweens.addCounter` (0→1 over ~`FLASH_MS`) whose `onUpdate` lerps the fill from white to
  `RUBBLE_COLOR` so it settles on the rubble colour. The handle is stored on `this._flashTween`.
- **`destroy()` (NEW):** kill `this._flashTween` (if any) then `this.rect.destroy()`. Idempotent — a
  second call (or no tween) is a no-op. GameScene's `_teardownStage` calls THIS instead of
  `base.rect.destroy()` (AC4).
- A small RGB-lerp helper (white→rubble) is inlined/local — no new util (KISS).

### 5.3 The blast + camera beat (`GameScene` TILE.BASE branch)

- Replace the lone `this.effects.explosion(bulletRect.x, bulletRect.y, { big: true })` with: the eagle
  center `ex/ey = base.rect.x/y`; an immediate `effects.explosion(ex, ey, { big: true })`; 1–2 more
  `effects.explosion` scheduled via `time.delayedCall` at small offsets around the eagle center after
  short staggers; and a `cameras.main.flash(...)` (white) + `cameras.main.shake(...)` (stronger than a
  kill). The existing `sfx.explosion({ big: true })`, `bullets.release`, and `base.onHit()` calls are
  kept (the run-over edge is unchanged). The bursts are scheduled on the scene's timer, so they fire even
  as `_triggerGameOver` defers the swap (the FX still tick on real dt — the F3 contract).
- **`_teardownStage` (CHANGED):** `this.base.destroy()` (was `this.base.rect.destroy()`) so the flash
  tween is killed if a teardown lands during the flash (AC4).

### 5.4 Integration points with existing code (what does NOT change)

- `_triggerGameOver` is byte-unchanged — the bank, the red flash, the HUD stop, the 700 ms defer, the
  GameOver swap. The new beat is the lead-in BEFORE the guard fires.
- The one-shot `destroyed` guard + `onDestroyed` + the gameOver guard are unchanged — the run still ends
  exactly once, the same way.
- The pure generator, `config/*`, the i18n layer, and `scripts/verify-gen.mjs` are UNTOUCHED — this is
  Phaser-coupled FX only (never verifier-imported). No new asset, no new string.

---

## 6. Files

**Changed:**

- `src/entities/Base.ts` — `onHit()` white-to-rubble tracked flash; `destroy()` kills the tween before
  destroying the rect.
- `src/scenes/GameScene.ts` — TILE.BASE branch: staggered multi-burst big blast at the eagle center +
  stronger camera flash/shake; `_teardownStage` → `base.destroy()`.
- `docs/designs/2026-06-19-base-destroyed-sequence.md` — this design doc.

---

## 7. Verification

- **AC1 / AC2 (eagle flash + staggered blast + camera beat) — `npm run typecheck` + `npm run build` +
  grep + manual drive.** Grep the tracked tween + `destroy()` in `Base.ts`; grep the staggered
  `delayedCall`s + `cameras.main.flash`/`shake` in the TILE.BASE branch of `GameScene.ts`. Manual `npm run
  dev`: let an enemy shoot the eagle → the eagle flashes white then darkens to rubble while 2–3 blasts roll
  across it + the camera punches harder than a tank kill, then the red run-end flash + the GameOver swap.
- **AC3 (run still ends the same) — read + manual drive.** `_triggerGameOver` is byte-unchanged; the run
  banks + transitions to GameOver after the beat, exactly as before.
- **AC4 (no stale tween on teardown) — read.** `_teardownStage` calls `base.destroy()`, which kills the
  tracked tween before `rect.destroy()`.
- **AC5 (green gate + pure/coupled + offline) — `npm run typecheck` + `npm run build` + `npm run
  verify`.** All exit 0 / print OK. The verifier is byte-unchanged (it never imports `entities/Base.ts` or
  the scenes — only the PURE generator + config). Programmer-art primitives only; runs offline.

# Tank 1990 — Seed challenge (play a reproducible run from a typed/copied seed)

> A small PLAYABILITY pass: the run is ALREADY fully deterministic from `createRunState(startSeed, …).advance()`
> given a seed — `_mintSeed()` just mixes the wall clock so consecutive launches differ. This feature lets the
> player SEE the current minted seed on the Title screen, COPY it, and TYPE a seed in to replay an identical run.
> KISS: the seed is a 32-bit unsigned int shown/entered as HEX (8 chars). It persists via the EXISTING
> `util/settings.ts` wrapper (one new optional field — NO new save key, NO meta-schema change) and is read ONCE
> in GameScene run setup, where it OVERRIDES `_mintSeed()` when present. No pure/coupled or verifier-contract
> change: the determinism the gate already proves (§7f drives `advance()` from a fixed seed) IS this feature's
> guarantee. Format mirrors the difficulty-select + high-score-table docs.

---

## 1. Background

The flow is **Title → Hub → Game** (`scene.start('Hub')` → `scene.start('Game')`, no data payload). GameScene's
`create()` is the single run-setup site: it `createMetaState()`s, `loadSettings()`s (the difficulty-select
preference wrapper, `tank-1990:settings`), builds the per-slot `{lives, tier}` seed map, then
`createRunState(this._mintSeed(), seeds, settings.startStage)`. `_mintSeed()` (`GameScene.ts:347`) is
`(Date.now() ^ (this.time.now * 2654435761)) >>> 0` — a fresh unsigned-32-bit seed per launch. From THAT seed
the whole run is reproducible: `RunState.advance()` chains seeds via the Knuth multiplicative step
(`nextSeed`), and every stage is `generateStage(runState.seed, cfg)` — so a FIXED start seed replays the EXACT
same procedural run. The verifier's §7f already drives `advance()` from a pinned seed and asserts the seed
chain is deterministic; that proof IS the seed-challenge contract — no new gate is needed.

`util/settings.ts` is the persisted PREFERENCE wrapper (PURE of Phaser, node-imported by the verifier): a
`{ difficulty, startStage }` shape over `util/save.ts`'s defensive `get/set` under `tank-1990:settings`, with
on-read back-fill + clamp (`loadSettings` never throws). The Title chooser (`TitleScene.ts`) already reads it
in `create()`, renders a difficulty/start-stage row, and `saveSettings()`s on each cursor-key change.

What is MISSING is any way to SEE or PIN the run seed — every launch is an opaque, unrepeatable run. A "seed
challenge" lets two players race the SAME board, or a player retry a brutal run.

**Conventions mirrored:** the seed cap/format live ONCE in `config/constants.ts`; the seed parse/format helpers
are PURE in `config/seed.ts` (so the verifier node-imports + asserts the round-trip + clamp); the choice
persists through the EXISTING `settings.ts` wrapper (no new key — DRY); all UI text goes through `t()` with keys
in BOTH locales (ZH ⊆ EN). Governing principles: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** show the current/last run seed on the Title screen as hex, let the player copy it and type a seed in,
persist the last-used seed, and start a run from a specified seed instead of the minted one; keep verify green.

**In scope:**

- **`src/config/constants.ts` (CHANGED, PURE):** add `SEED_HEX_DIGITS = 8` (a u32 = 8 hex chars — the
  display/input width, DRY owner). No other numeric constant (the u32 mask `>>> 0` is already the seed
  contract everywhere).
- **`src/config/seed.ts` (NEW, PURE):** the two tiny PURE helpers (node-importable; a stray Phaser import would
  throw under the verifier). `formatSeed(seed: number): string` → the unsigned-32-bit seed as a zero-padded,
  UPPER-case 8-hex string (`(seed >>> 0).toString(16).padStart(SEED_HEX_DIGITS, '0').toUpperCase()`).
  `parseSeed(text: string): number | null` → strip a leading `0x`/`#` + whitespace, accept up to 8 hex digits,
  return the parsed `>>> 0` value, or `null` for empty/invalid input (so the Title can reject a bad entry
  without throwing). `formatSeed(parseSeed(s)!)` round-trips any valid 8-hex string (the verifier asserts it).
- **`src/util/settings.ts` (CHANGED, PURE):** extend `Settings` with `seed: number | null` (the last-used / pinned
  seed; `null` = "mint a fresh seed each launch", the IDENTITY = today). `DEFAULT_SETTINGS.seed = null`.
  `loadSettings()` back-fills + sanitizes: a present numeric seed is coerced `>>> 0`; anything else → `null` (so a
  corrupt value degrades to fresh-mint, never throws). `saveSettings()` is unchanged (writes the whole shape).
  This REUSES the existing `tank-1990:settings` key — NO new storage code, NO meta migration (DRY/SOLID).
- **`src/scenes/GameScene.ts` (CHANGED):** in `create()`, after the existing `const settings = loadSettings()`,
  derive the run seed ONCE: `const runSeed = settings.seed != null ? (settings.seed >>> 0) : this._mintSeed()`,
  and pass it to `createRunState(runSeed, seeds, settings.startStage)` (replacing the inline `this._mintSeed()`).
  Then PERSIST the actually-used seed so the Title can display it after the run starts and a retry replays it:
  `saveSettings({ ...settings, seed: runSeed })`. `_mintSeed()` is UNCHANGED (it still mints when no seed is
  pinned). No other scene change — difficulty/startStage threading stays exactly as-is.
- **`src/scenes/TitleScene.ts` (CHANGED):** add a small SEED row under the difficulty chooser (off the FIXED
  design resolution — the Title's Scale.FIT discipline). It shows `t('title.seed', { seed })` where `seed` is
  `formatSeed(settings.seed)` if pinned, else a dim `t('title.seed.random')` placeholder; below it a one-line
  hint `t('title.seedHint')`. A key (e.g. `S`) toggles a tiny inline HEX entry: keystrokes append hex digits
  (0-9 A-F, capped at `SEED_HEX_DIGITS`), BACKSPACE deletes, ENTER commits via `parseSeed` (`null` → clear the
  pin = random), ESC cancels. A second key (e.g. `R`) clears the pin (`settings.seed = null`, back to random).
  Each commit/clear `saveSettings(settings)`s + re-renders the row + plays the existing `sfx.uiMove()`. The
  difficulty cursor handlers + the SPACE/ENTER/pointer start are UNCHANGED — but while the seed-entry buffer is
  OPEN, the difficulty/start-stage cursor keys and SPACE/ENTER start are SUPPRESSED (a guard flag) so typing a
  seed never also cycles difficulty or launches the run (KISS — one boolean `editingSeed` latch).
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** add the Title keys (`title.seed`,
  `title.seed.random`, `title.seedHint`, `title.seedEntry`) in BOTH locales (ZH ⊆ EN — the verifier asserts it).
- **`scripts/verify-gen.mjs` (CHANGED):** add a tiny §7-adjacent block driving the PURE seed helpers:
  `parseSeed('1A2B3C4D') >>> 0 === 0x1a2b3c4d`; `formatSeed(0) === '00000000'`; `formatSeed(0xdeadbeef) ===
  'DEADBEEF'`; `formatSeed(parseSeed(s)) === s.toUpperCase()` round-trip for a few cases; `parseSeed('') ===
  null`, `parseSeed('zzz') === null`, `parseSeed('0xFF') >>> 0 === 255`. (Optional: assert
  `createRunState(parseSeed('CAFEBABE'), seeds).seed === parseSeed('CAFEBABE') >>> 0` to nail the seam — but
  §7f already proves the seed chain from a fixed seed, so this is belt-and-suspenders.)

**Out of scope (NOT built):** a NEW save key for the seed (it rides the EXISTING `settings` shape — DRY/YAGNI);
a clipboard-copy BUTTON via the async Clipboard API (it isn't available from `file://` reliably + adds a
permission surface — the seed is shown as selectable text; YAGNI/offline constraint); a decimal-seed mode or a
human-word seed encoding (hex u32 is the on-the-wire seed format everywhere — KISS); seeding the per-frame AI
RNG (that is intentionally OFF the pin — the stage layout/roster is reproducible, live combat is not, the
existing D4 stance); changing `_mintSeed()`, `advance()`, `nextSeed`, or the verifier's §7f seed-chain / §5
ramp sweeps (only the additive seed-helper block is added).

---

## 3. Acceptance Criteria

1. **AC1 — the seed width lives ONCE.** `SEED_HEX_DIGITS = 8` in `config/constants.ts`; `seed.ts` + the Title
   read it (no inlined `8` — DRY).
2. **AC2 — `formatSeed`/`parseSeed` are PURE, total, and round-trip.** `formatSeed(seed)` is an 8-char
   zero-padded UPPER hex of `seed >>> 0`; `parseSeed` accepts `0x`/`#`/whitespace-trimmed hex (≤ 8 digits) →
   `>>> 0`, returns `null` for empty/invalid (never throws); `formatSeed(parseSeed(s)) === s.toUpperCase()` for
   any valid 8-hex `s`. The verifier drives a case table.
3. **AC3 — the seed persists through the EXISTING settings key.** `Settings.seed: number \| null` rides
   `tank-1990:settings`; `loadSettings()` coerces a numeric seed `>>> 0` and degrades anything else (corrupt /
   old build / `undefined`) to `null` (fresh-mint) — never throws (inherits save.ts's try/catch). NO new save
   key, NO meta-schema migration.
4. **AC4 — a pinned seed produces a reproducible run; `null` mints fresh.** GameScene reads `settings.seed`
   ONCE: when non-null it seeds `createRunState` with `settings.seed >>> 0` (identical run every launch), when
   null it uses `_mintSeed()` (today's behaviour — the IDENTITY). The verifier's §7f already proves a fixed
   start seed yields a deterministic `advance()` chain — that IS this guarantee.
5. **AC5 — the actually-used seed is written back.** After constructing the run, GameScene `saveSettings({
   ...settings, seed: runSeed })`, so the Title shows the LAST run's seed (whether minted or pinned) and a retry
   replays it.
6. **AC6 — the Title seed UI works + is localised.** The Title shows the current seed as hex (or a dim "random"
   placeholder); a key opens inline hex entry (digits append capped at 8, BACKSPACE/ENTER/ESC), a key clears the
   pin; each commit/clear saves + re-renders + blips; while editing, the difficulty keys + SPACE/ENTER start are
   suppressed. Every new string is in `en.ts` AND `zh-CN.ts` (the ZH ⊆ EN check stays green).
7. **AC7 — green gate + pure/coupled split.** `npm run typecheck` + `npm run build` exit 0; `npm run verify`
   prints OK + exits 0 with the new seed-helper block. `constants.ts` / `seed.ts` / `util/settings.ts` import NO
   Phaser (node-imported by the verifier); the scenes import Phaser and are never node-imported.

---

## 4. Decision Log

1. **D1 — The seed is a u32 shown/typed as 8-digit HEX.** The seed is ALREADY a `>>> 0` unsigned-32-bit int
   everywhere (`_mintSeed`, `nextSeed`, `generateStage`). Hex is the most compact lossless text form (8 chars,
   copy-paste friendly) and needs zero new numeric domain. *Rationale:* KISS/DRY — the display format matches
   the existing seed contract; no decimal/word codec to maintain (YAGNI).
2. **D2 — The seed rides the EXISTING `settings` shape, NOT a new key.** It is a pre-run PREFERENCE exactly like
   difficulty/startStage, persisted the same lifecycle (set on the Title / written back by GameScene). Adding
   one optional field to `Settings` reuses all of `settings.ts`'s back-fill/clamp + `save.ts`'s try/catch for
   free. *Rationale:* DRY (one wrapper) + SOLID (one preference concern) + YAGNI (no migration).
3. **D3 — `seed: number | null`; `null` = mint fresh (the IDENTITY).** A null seed reproduces today's behaviour
   byte-for-byte (`_mintSeed()` runs), so a fresh save / "Random" choice is the no-op default — the verifier's
   existing run-setup path is unaffected. *Rationale:* KISS — the absence of a pin IS "random", no separate
   boolean flag.
4. **D4 — GameScene WRITES BACK the used seed (mint or pin).** So the Title can DISPLAY a seed after the very
   first run and "retry the same board" works without a manual copy. A minted run thereby becomes pinnable in
   hindsight. *Rationale:* the brief's "copy / display the current run seed" — the write-back is what makes the
   minted seed visible.
5. **D5 — Parse/format are PURE in `config/seed.ts`, driven by the verifier.** Text parsing is the only new
   logic with edge cases (bad input, casing, padding); putting it in a PURE module lets the headless verifier
   assert the total/round-trip contract — the same proof-by-node-import stance as `stages.ts`/`settings.ts`.
   *Rationale:* SOLID (one concern) + the gate covers the risky bit.
6. **D6 — An `editingSeed` latch suppresses the other Title keys while typing.** Hex digits overlap the
   difficulty/start keys (e.g. `A`/`D`, digits) and SPACE/ENTER start; one boolean guard keeps seed entry from
   leaking into a difficulty cycle or a premature launch. *Rationale:* KISS — one flag, no modal scene.
7. **D7 — No clipboard API / copy button.** The async Clipboard API is unreliable from `file://` + adds a
   permission prompt; the seed is rendered as plain selectable hex the player can read/copy manually.
   *Rationale:* the offline / `file://` hard constraint + YAGNI.

---

## 5. Design

### 5.1 Module layout (this phase)

```
src/
  config/
    constants.ts     # CHANGED (PURE): + SEED_HEX_DIGITS = 8 (the seed display/input width — DRY owner).
    seed.ts          # NEW (PURE): formatSeed(seed) / parseSeed(text) — the hex u32 round-trip.
  util/
    settings.ts      # CHANGED (PURE): Settings.seed: number|null + back-fill/sanitize (rides the existing key).
  scenes/
    TitleScene.ts    # CHANGED: the seed row + inline hex entry + clear key + the editingSeed latch.
    GameScene.ts     # CHANGED: pick runSeed (pinned ?? _mintSeed) → createRunState + write-back the used seed.
  i18n/
    en.ts            # CHANGED (PURE): + title.seed / title.seed.random / title.seedHint / title.seedEntry.
    zh-CN.ts         # CHANGED (PURE): the same keys (ZH ⊆ EN).
scripts/
  verify-gen.mjs     # CHANGED: drive formatSeed/parseSeed (round-trip + clamp + null on bad/empty input).
```

### 5.2 `config/seed.ts` (the pure hex round-trip)

```
import { SEED_HEX_DIGITS } from './constants.js'
export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(16).padStart(SEED_HEX_DIGITS, '0').toUpperCase()
}
export function parseSeed(text: string): number | null {
  const cleaned = text.trim().replace(/^0x/i, '').replace(/^#/, '')
  if (cleaned === '' || cleaned.length > SEED_HEX_DIGITS || !/^[0-9a-f]+$/i.test(cleaned)) return null
  return parseInt(cleaned, 16) >>> 0
}
```

### 5.3 `util/settings.ts` extension

`Settings` gains `seed: number | null`; `DEFAULT_SETTINGS.seed = null`. In `loadSettings()`, after the
difficulty/startStage sanitization: `const seed = typeof merged.seed === 'number' && Number.isFinite(merged.seed)
? (merged.seed >>> 0) : null`. Return it in the result object. `saveSettings` is unchanged (it serializes the
whole shape).

### 5.4 GameScene wiring (run setup)

```
const settings = loadSettings()
this.difficulty = settings.difficulty
// … existing seed map fold …
const runSeed = settings.seed != null ? (settings.seed >>> 0) : this._mintSeed()
this.runState = createRunState(runSeed, seeds, settings.startStage)
saveSettings({ ...settings, seed: runSeed })   // write back the used seed (mint or pin — D4/AC5)
```

### 5.5 What does NOT change

`_mintSeed()`, `RunState.advance()` / `nextSeed`, `createRunState`'s signature, `generateStage`, the meta save
schema, and the difficulty/startStage threading are UNTOUCHED. The verifier's §5 ramp sweep + §7f seed-chain
+ the byte-pinned §6 generator output stay identical (a `null` seed = today's mint path — the identity).

### 5.6 Verifier extension

A small block (PURE — node-imports `config/seed.js`): `parseSeed('1A2B3C4D') >>> 0 === 0x1a2b3c4d`;
`formatSeed(0) === '00000000'`; `formatSeed(0xdeadbeef) === 'DEADBEEF'`; round-trip
`formatSeed(parseSeed(s)) === s.toUpperCase()` for `['00000000','DEADBEEF','0000000F']`; `parseSeed('') === null`,
`parseSeed('xyz') === null`, `parseSeed('0xFF') >>> 0 === 255`, `parseSeed('123456789') === null` (> 8 digits).

---

## 6. Files

**New:** `src/config/seed.ts`.
**Changed:** `src/config/constants.ts`, `src/util/settings.ts`, `src/scenes/TitleScene.ts`,
`src/scenes/GameScene.ts`, `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `scripts/verify-gen.mjs`, this design doc.

**i18n keys to add (both locales):** `title.seed`, `title.seed.random`, `title.seedHint`, `title.seedEntry`.

---

## 7. Verification

- **AC1/AC2/AC3 — `npm run verify`:** the new block drives `formatSeed`/`parseSeed` (round-trip + clamp + null
  on bad/empty/over-long input); `config/seed.js` + `util/settings.js` node-import cleanly (re-proving purity).
- **AC4 — `npm run verify` + manual:** §7f already proves a fixed start seed yields a deterministic `advance()`
  chain. Manual `npm run dev`: pin a seed → run the board, restart → the IDENTICAL board; clear the pin → a
  fresh random board each launch.
- **AC5 — grep + manual:** grep `saveSettings({ ...settings, seed:` + `settings.seed != null` in GameScene;
  manual: play a random run → the Title now shows that run's hex seed.
- **AC6 — `npm run verify` (ZH ⊆ EN) + manual:** the seed row renders; `S` opens entry (digits cap at 8,
  BACKSPACE/ENTER/ESC), `R` clears; while editing, difficulty keys + start are suppressed; restart → the seed
  persists.
- **AC7 — `npm run typecheck` + `npm run build` + `npm run verify`:** all exit 0. `constants.ts` / `seed.ts` /
  `util/settings.ts` are node-imported by the verifier; the scenes import Phaser and are never imported.

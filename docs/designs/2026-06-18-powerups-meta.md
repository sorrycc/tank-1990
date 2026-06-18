# Tank 1990 — F5 Power-ups & the meta loop (the 6 classics, the Hub trees, banking, the full HUD + i18n)

> Design doc for **F5 Power-ups & meta**, the run-economy + between-runs progression feature of Tank
> 1990 (a faithful Battle City / 坦克大战 clone). Format mirrors the read-only reference `dead-cell`
> design docs EXACTLY: Background → Requirements Summary → Acceptance Criteria → Decision Log → Design
> → Files → Verification. F0 stood up the booting skeleton (six scenes, pure RNG, defensive
> `util/save.ts` ALREADY carrying the Tank-1990 meta schema — `currency` + per-player `upgrades` +
> `bestScore`/`bestStage`, swept by the verifier — and STUB Title/Hub/HUD/GameOver scenes). F1 made a
> drivable tank that fires pooled bullets. F2 built the PURE, SEEDED, headlessly-VERIFIED 13×13 stage.
> F3 made the bullets MATTER (every collision resolved, the eagle-loss run-over, pooled FX, respawn,
> co-op FF off). F4 filled in the game loop: the four classic enemy types on the ONE Tank FSM, the
> staggered/capped spawn loop, the stage-clear advance, and the run economy on `core/RunState.ts`
> (per-player `lives`/`tier`, shared `score`, the spawn ledger) — DELIBERATELY leaving the seams F5
> plugs into: the red-carrier death hook (`GameScene._markDrop(x,y)`), the PLACEHOLDER
> `freezeTimer`/`shovelTimer` on `RunState`, the per-player `tier`/`lives` maps, the `applyStarTier`
> fold, and the `gdt` freeze boundary in `GameScene.update` (`gdt = 0` freezes the world, FX keep
> popping). **F5 is the last feature: it closes the loop.** It spawns the six classic power-ups when a
> red carrier dies and applies their effects; ticks + expires the power-up timers; adds
> `core/MetaState.ts` (the persistence-facing wrapper around the existing `util/save.ts`) +
> `config/tank-upgrades.ts` (the PURE permanent per-player upgrade rows + `applyUpgrades`); banks
> `floor(score · RATIO)` of run score into the SHARED currency bank + updates `bestScore`/`bestStage`
> on GameOver; builds the REAL two-column Hub (P1 tree | P2 tree, one shared bank, two cursors); and
> wires the full HUD (lives, enemies-remaining, stage, score, currency, active power-up/timers). It
> also introduces the **i18n layer** (en + zh-CN) the project has deferred since F0, so every chrome
> string the new scenes render is localised (the user reads zh-CN).

---

## 1. Background

In Battle City the run is a score-and-lives chase punctuated by power-ups: some enemies flash red, and
killing one drops one of six classic power-ups onto the grid — **helmet** (a temporary shield / i-frames),
**clock** (freezes every enemy for a few seconds), **shovel** (turns the eagle's brick ring to steel for a
while), **star** (upgrades your tank one tier), **grenade** (destroys every enemy on screen), **tank**
(a +1 extra life). Walking your tank over the drop applies it. Score accrues per kill; when the eagle
falls or every player is out of lives the run ends, your score is tallied, and (in this clone's locked
meta design) a fraction banks into a PERSISTENT shared currency you spend in a Hub on PERMANENT
per-player tank upgrades before the next run.

F4 left the run loop combat-complete but with the economy and progression STUBBED:

- A red carrier's death fires `GameScene._markDrop(x, y)` — which today only pops a marker FX burst. **No
  power-up entity exists.**
- `RunState.freezeTimer` / `RunState.shovelTimer` are seeded `0` (the neutral identity) and **nobody ticks
  or reads them.** `RunState.tier[slot]` / `RunState.lives[slot]` exist + are carried across a stage
  rebuild, but **nothing bumps them mid-run** (the star/tank power-ups are the writers).
- `GameScene.update` computes `gdt = dt` (the identity) — the freeze boundary the clock power-up needs is
  WIRED but never driven to `0`.
- `util/save.ts` ALREADY owns the Tank-1990 meta schema (`currency`, `upgrades: { '1', '2' }`,
  `bestScore`, `bestStage`) and the verifier ALREADY round-trips it — but **no `core/MetaState.ts` wraps
  it**, **no upgrade ROWS exist** (`upgrades` maps are empty by construction), and **nothing banks score or
  reads the bank**: the Hub/GameOver/HUD scenes are still F0 stubs (a heading + a "press to continue").
- There is **no i18n layer** (F0 deferred it; the constants doc notes `UI_FONT` is in place for it). Every
  new scene that renders chrome needs localised strings.

F5 resolves all of that, mirroring the reference's pickup/meta/HUD/Hub/i18n conventions EXACTLY, adapted
from a roguelite platformer to Tank 1990's faithful-classic shape:

- **Pooled pickups, the scene resolves collection (the reference's `entities/Pickup.ts`
  `PickupPool`).** The reference keeps a FIXED pre-created pool of rect+sensor members
  (acquire/release/releaseAll, zero per-pickup allocation) that knows NOTHING about the economy: the SCENE
  wires ONE overlap (player × pool) and the callback reads `rect.pk.kind` to resolve the effect, then
  `release()`s. F5's `PowerUp.ts` is the same pool — but TOP-DOWN (no gravity arc: a power-up sits
  grid-aligned at the drop tile until walked over, the classic) and the six KINDS are the classics, not
  cells/gold/scrolls.
- **PURE upgrade rows + a pure `applyUpgrades` fold + a thin persistence wrapper (the reference's
  `config/upgrades.ts` + `core/MetaState.ts`).** The reference's `config/upgrades.ts` is a 100%-PURE
  self-contained-row table (`id`/`name`/`desc`/`maxLevel`/`costs[]`/`apply(stats,level)`) the verifier
  node-imports to assert cost monotonicity + "apply never weakens you"; `core/MetaState.ts` wraps
  `util/save.js` with `getCells`/`buy`/`bankRun`/`startStats` + the standalone pure
  `applyUpgrades(base, upgrades)`. F5 mirrors both: `config/tank-upgrades.ts` is the PURE row table folded
  over the `TankSpec` (NOT a bespoke stats object — reuse the F4 `PLAYER_BASE`), and `core/MetaState.ts`
  wraps the EXISTING `util/save.ts` with `getCurrency`/`buy(slot,id)`/`bankRun`/`startSpec(slot)` +
  `applyUpgrades(slot, base, upgrades)`.
- **The two-column Hub, the GameOver banking, the parallel HUD — all DECOUPLED (the reference's
  registry/scene-data split).** The reference's Hub reads/writes meta ONLY through `MetaState`; GameOver
  reads a run-summary SNAPSHOT from scene-start data and never reaches into the live scene; the HUD reads
  the scene REGISTRY (which `GameScene` writes each frame). F5 mirrors all three, with Tank 1990's
  two-column-shared-bank Hub (the locked meta-hub decision) replacing the reference's single list.
- **The i18n layer (the reference's `i18n/index.ts` + `en.ts` + `zh-CN.ts`).** A tiny hand-rolled
  localisation layer (KISS — two locales, no ICU), PURE of Phaser, copied BYTE-FAITHFUL in structure from
  the reference: `t(key, params?)` for chrome (zh → en → key fallback) + `tName`/`tDesc(cat, id, en)` for
  config content + `getLocale`/`setLocale`/`detectLocale`. F5 ships ONLY the strings the game actually
  renders (Title/Hub/HUD/GameOver/power-ups + the upgrade name/desc overrides) — YAGNI on the reference's
  weapon/biome/boss content categories Tank 1990 doesn't have.

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split
(`config/tank-upgrades.ts` + `core/MetaState.ts`'s pure `applyUpgrades` + `i18n/*` import NO Phaser and
are node-imported by the verifier; `entities/PowerUp.ts`, the scenes, and `MetaState`'s persistence
methods are Phaser/`save.ts`-coupled and NEVER imported by the verifier); object POOLING (the `PowerUp`
pool is the reference's `PickupPool` shape — fixed members, acquire/release/releaseAll, zero per-pickup
allocation); defensive `localStorage` (every access already try/caught in `util/save.ts` — `MetaState`
inherits "never throws" for free); the registry-decoupled HUD + scene-data-decoupled GameOver; the
SINGLE pure-fold-over-base-stats pattern; the deferred-destructive-teardown footgun discipline (a
grenade/pickup that destroys bodies defers out of any overlap callback); `dt` in SECONDS at the boundary
(the power-up timers tick on the GAMEPLAY `dt`); heavy intent-revealing comments citing the section + AC
+ Decision numbers. Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Spawn the six classic power-ups when a red carrier dies; apply each on player pickup (helmet
shield / clock freeze / shovel fortify / star tier-up / grenade clear / tank +1 life); tick + expire the
timed power-ups on the gameplay `dt`; bank `floor(score · RATIO)` of run score into the SHARED persistent
currency + update `bestScore`/`bestStage` on GameOver; build the REAL two-column Hub (P1 tree | P2 tree,
one shared bank, two cursors, per-player buys debiting the shared pool, START RUN folding each player's
tree into the run); wire the full parallel HUD (per-player lives, enemies-remaining, stage, score,
currency, active power-up + timers); add the i18n layer (en + zh-CN) for every new chrome string; close
the flow Title → Hub → Game → GameOver → Hub; all green on `typecheck`/`build`/`verify`.

**In scope (F5):**

- **`src/config/powerups.ts` (PURE, NEW):** the six classic power-up definitions as DATA (NO Phaser —
  node-importable). A `PowerUpKind` union (`'helmet'|'clock'|'shovel'|'star'|'grenade'|'tank'`) + a
  `PowerUpDef` row (`id`/`kind`/`color`/`durationSec`) + `POWERUPS` (ordered) + `POWERUP_BY_ID` +
  `POWERUP_KINDS` (the kind list the carrier-death drop picks from) + the run-effect tunables
  (`HELMET_SHIELD_SEC`, `CLOCK_FREEZE_SEC`, `SHOVEL_FORTIFY_SEC`). KISS — flat data + a couple of pure
  helpers (`pickPowerUpKind(rng)`); the verifier asserts well-formedness (every kind present, durations
  ≥ 0, colours numeric).
- **`src/config/tank-upgrades.ts` (PURE, NEW):** the PERMANENT per-player upgrade rows folded over a
  `TankSpec`, mirroring the reference's `config/upgrades.ts` row shape EXACTLY (self-contained
  `id`/`name`/`desc`/`maxLevel`/`costs[]`/`apply(spec, level)`). The rows (each only ever HELPS — the
  verifier asserts): `+max bullets` (`+1` live-bullet cap/level), `+bullet speed`, `+tank speed`, `+1
  starting life`, `base-armor start` (start with `>1` HP), `+star-start` (start a run at tier `N`). Plus
  `applyUpgrades(base, upgrades)` → a NEW `TankSpec` (PURE; identity = a clone of base when the map is
  empty; unknown ids skipped; level clamped to `maxLevel`) and a `STARTING_LIVES_BONUS` extractor (the
  "+1 starting life" / "+star-start" rows fold into spec fields the run-start reads — see §5.2). DRY:
  `applyStarTier` (F4) already folds tiers over `PLAYER_BASE`; `applyUpgrades` folds the Hub tree over the
  result.
- **`src/core/MetaState.ts` (NEW; persistence-coupled wrapper + a PURE re-export):** the gameplay-facing
  meta API, a FACTORY (`createMetaState()`, mirroring the reference) wrapping the EXISTING `util/save.ts`
  (`loadMeta`/`saveMeta`). Reads: `getCurrency`/`getUpgradeLevel(slot, id)`/`getBestScore`/`getBestStage`.
  Writes (each `saveMeta`s): `buy(slot, id)` (debit the SHARED currency, increment that player's level —
  the locked "shared bank, per-player trees"); `bankRun({ score, stage })` (add `floor(score · RATIO)` to
  currency, bump `bestScore`/`bestStage`). Folds: `startSpec(slot)` = `applyUpgrades(applyStarTier(0),
  upgrades[slot])` — the run-start spec the player launches with. The standalone PURE `applyUpgrades` is
  RE-EXPORTED from `config/tank-upgrades.ts` so the verifier imports the fold without the `save.ts`-coupled
  instance (the reference's split — `MetaState.ts` exports the pure fold + the impure wrapper). Inherits
  `save.ts`'s try/catch (never throws — a disabled storage degrades to in-memory defaults).
- **`src/entities/PowerUp.ts` (NEW; Phaser-coupled — the pool):** a `PowerUpPool` mirroring the reference's
  `PickupPool` (fixed pre-created rect members, acquire/release/releaseAll, per-pickup `pu` state mutated
  on acquire — zero per-pickup allocation). TOP-DOWN divergence (D2): NO gravity arc — a power-up is placed
  grid-aligned at the drop window-center, sits static (a sensor body, overlap-only), pulses its kind colour
  (the classic blink), and is collected when a player tank overlaps it. The pool knows NOTHING about the
  economy: `GameScene` wires ONE overlap (each player collider × the pool group) and the callback reads
  `rect.pu.kind` to resolve the effect, then `release()`s. Persists within a stage; `releaseAll()` on a
  stage rebuild/teardown.
- **`src/core/RunState.ts` (CHANGED, PURE):** ADD the power-up timer DECAY to a new pure `tickTimers(dt)`
  method (decays `freezeTimer`/`shovelTimer`/and a per-player `shieldTimer` map to 0, clamped) + a
  `shieldTimer: Record<number, number>` field (the helmet's per-player i-frame window — the neutral
  identity 0). `advance()` is EXTENDED to RESET the timed power-ups to 0 on a stage change (a clock/shovel
  doesn't carry into the next stage — the classic; the verifier asserts the reset). Lives/tier/score carry
  unchanged (F4 D10). All PURE — the verifier node-imports it (already does) and drives `tickTimers` to
  assert expiry.
- **`src/world/TileMap.ts` (CHANGED — the shovel fortify/revert API, D4a):** ADD `fortifyBaseRing(cells)` +
  `revertBaseRing()` so the shovel power-up can swap the eagle's brick ring to steel and back through a REAL
  seam (the reviewer's blocking issue: TileMap previously exposed only `destroyBrickSubCell`/`destroy`, with
  no brick→steel conversion, and the ring is built as 4 sub-cell bodies per tile by `_addBrick` while steel
  is one `TILE_SIZE` body via `_addSolidTile`). `fortifyBaseRing(cells)` takes the ring tile coords, and per
  cell: (a) DESTROYS the 0–4 surviving brick sub-cell bodies/rects of that tile via the EXISTING
  `destroyBrickSubCell` path (so a partially-eroded ring fortifies whatever brick remains), recording the
  surviving `(subCol,subRow)` set so revert restores EXACTLY that chip state; (b) adds ONE `TILE_SIZE` STEEL
  static body+rect (the same `_addSolidTile` shape) into a NEW `_fortifyBodies` group, tagged by `(col,row)`.
  `revertBaseRing()` destroys every `_fortifyBodies` member and REBUILDS each recorded cell's surviving brick
  sub-cells via `_addBrick`-style construction, so the pre-fortify brick state (including any quarter-brick
  erosion) is restored byte-for-byte. Both are idempotent (a double-fortify or a revert-with-nothing-fortified
  is a no-op) and `destroy()` also clears `_fortifyBodies`. PURE-of-economy (the scene owns the timer; TileMap
  owns the body swap) — and STILL never imported by the verifier (it imports Phaser). See §5.5.
- **`src/scenes/GameScene.ts` (CHANGED):** SWAP `_markDrop(x,y)` to acquire a `PowerUp` from the pool at
  the drop window-center with a kind picked off the stage RNG (deterministic per stage, like the roster
  picks); construct the `PowerUpPool` (run-scoped, beside `BulletPool`) + register the per-player overlap;
  the overlap callback applies the effect via ONE `_applyPowerUp(slot, kind)` switch (helmet → arm
  `runState.shieldTimer[slot]` + the tank's `spawnIframe`; clock → set `runState.freezeTimer`; shovel →
  set `runState.shovelTimer` + `tileMap.fortifyBaseRing(ringCells)` via the new TileMap seam (deferred —
  D10); star → `runState.tier[slot]++` + re-fold the player's spec; grenade → kill every on-screen enemy via
  the SAME `onHit`/`onDeath` funnel DEFERRED out of the overlap callback; tank → `runState.lives[slot]++`);
  drive `runState.tickTimers(gdt)` each frame; set `gdt = 0` while `freezeTimer > 0` so the world freezes
  (the wired boundary, now driven); skip enemy AI/fire while frozen; call `tileMap.revertBaseRing()` on the
  `shovelTimer` falling edge (deferred — D10); publish the FULL HUD state to the scene REGISTRY each frame;
  bank the run + update bests on the run-over edge (`bankRun`) and pass a run-summary SNAPSHOT to
  `GameOverScene`. Construct the running player spec from `MetaState.startSpec(slot)` at `create()` AND at
  every per-stage rebuild via `_buildPlayer` (the Hub-folded run-start stats — replacing the bare
  `applyStarTier`; see §5.4 _buildPlayer + the star re-fold).
- **`src/scenes/HubScene.ts` (REWRITE from the F0 stub):** the REAL two-column meta hub. A SHARED currency
  header; a P1 column + a P2 column (each rendered GENERICALLY off `TANK_UPGRADES` — no per-upgrade UI
  code), the P2 column HIDDEN in 1-player; two cursors (P1 navigates the left column with WASD, P2 the
  right with arrows; in 1P a single cursor on the lone column); a buy (P1 fire / P2 fire, or Space/Enter
  in 1P) debits the SHARED pool + increments that player's level; a START RUN affordance (Space/Enter)
  launches Game (which re-loads `MetaState` + folds each player's tree). All chrome via `t(...)`; the
  per-upgrade name/desc via `tName`/`tDesc('upgrade', id, en)`. Reachable from BOTH Title and GameOver.
- **`src/scenes/GameOverScene.ts` (REWRITE from the F0 stub):** read a run-summary SNAPSHOT from
  scene-start data (`score`, `stage`, `currencyBanked`, plus the new `bestScore`/`bestStage`), render the
  summary block (score / stage reached / CURRENCY BANKED / best) with primitives + `t(...)`, and route to
  the HUB on a key/click (the loop closes). It does NOT save — banking is `GameScene`'s job (the single
  writer under the `gameOver` guard); this scene only DISPLAYS.
- **`src/scenes/HUDScene.ts` (REWRITE from the F0 stub):** the parallel overlay. Reads the scene REGISTRY
  (decoupled — `GameScene` writes it each frame): per-player lives (P1 + P2; P2 line hidden in 1P),
  enemies-remaining, stage #, score, shared currency, and the active power-up + its remaining seconds
  (freeze/shovel/shield). Primitives + `t(...)` only; positioned in the right-side HUD panel band
  (`HUD_PANEL_X`, the F0 layout owner).
- **`src/scenes/TitleScene.ts` (CHANGED):** swap the inline literals for `t(...)` (the i18n adoption — the
  F0 doc promised every text site swaps to `t('...')` when the layer lands). Flow unchanged (→ Hub).
- **`src/main.ts` (CHANGED, one block):** set the live locale ONCE at boot
  (`setLocale(meta.language ?? detectLocale())`) before the scenes render — the reference's boot seam.
- **`src/config/constants.ts` (CHANGED, PURE):** ADD `CURRENCY_RATIO` (the fraction of score banked) +
  re-export nothing else new (the power-up durations live in `config/powerups.ts`; the upgrade
  costs/effects in `config/tank-upgrades.ts` — each beside its own concern, DRY). All PURE.
- **`scripts/verify-gen.mjs` (CHANGED):** ADD a section that node-imports `config/powerups.ts` +
  `config/tank-upgrades.ts` + the extended `core/RunState.ts` + the `i18n/*` layer and asserts: every
  power-up kind is present + well-formed (numeric colour, duration ≥ 0); `pickPowerUpKind` only returns a
  known kind + is deterministic for a fixed rng; the upgrade rows are well-formed (costs monotone
  non-decreasing, `apply` returns a NEW spec that never WEAKENS the player on any field it touches — the
  reference's exact check); `applyUpgrades(base, {})` === a clone of base (the identity fold) + a
  clamped/unknown-id save degrades gracefully; `RunState.tickTimers(dt)` decays every timer to 0 and never
  goes negative, and `advance()` RESETS the timed power-ups; the i18n dictionaries are structurally sound
  (`ZH_CN.ui` ⊆ `EN.ui`, well-formed `upgrade` entries keyed to real ids, the zh→en→key fallback chain never
  blanks — the headlessly PROVABLE i18n properties, NOT "every key the scenes use exists" which is
  unprovable; AC9). EXTEND (do NOT rewrite) the verifier — its F0–F4 sections stay green EXCEPT §7f, whose
  `createRunState` calls are RE-PINNED to the new per-slot seed-map signature (D5b/D5c — the one F4 verifier
  edit). The EXISTING save round-trip check (F0) already covers the meta schema F5 reads.

**Out of scope (F5 — explicitly NOT built):** the BOSS milestone tank + the "STAGE N CLEARED" banner (a
separate later feature — F5 keeps `RunState.isBossStage()` untouched; the boss does not interact with the
power-up/meta loop); ICE low-friction feel; STEEL becoming bullet-destructible by a max-star tank (the
`canBreakSteel` flag exists on the max-star tier as DATA from F4 — no bullet reads it; F5 does NOT change
that); an audio layer (the reference's `Sound` blips — Tank 1990 has none; the Hub is silent — YAGNI);
seeded/daily-run pinning + a language-switch Hub row (the reference's Hub has them; Tank 1990's locked Hub
scope is the two upgrade trees + START RUN — the locale is auto-detected at boot, persisted only if a
later feature adds the row; F5 does NOT add a `language` field to the meta schema — YAGNI); any new content
i18n categories beyond `upgrade` (Tank 1990 has no weapons/biomes/bosses to localise). F5 ships ONLY the
six power-ups + the meta bank/trees + the full HUD + the i18n chrome.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a manual
> `npm run dev` drive-test. The pickup spawn/collection, the Hub UI, the HUD, and the banking are
> Phaser-coupled (the scenes + the pool); the power-up data, the upgrade rows + `applyUpgrades`, the
> `RunState` timer decay, and the i18n core are PURE and gain REAL headless assertions in the verifier.

1. **AC1 — a red carrier's death spawns ONE power-up on the grid.** When a `carrier` enemy dies,
   `GameScene` acquires a `PowerUp` from the pool at the death drop window-center (replacing F4's marker
   FX) with a kind picked deterministically off the stage RNG. The drop is a single grid-aligned,
   colour-pulsing rectangle (programmer-art) that PERSISTS until collected, the stage rebuilds, or it is
   superseded (pool exhaustion recycles the oldest — cosmetic only). Exactly one power-up per carrier death
   (the F4 `onDropFlag` one-shot discipline is preserved).
2. **AC2 — all six power-ups work on pickup.** Walking a PLAYER tank over a drop applies its effect and
   releases the drop: **helmet** → that player gets a timed shield (its `isHittable()` is false for
   `HELMET_SHIELD_SEC` via `RunState.shieldTimer[slot]` + the tank's `spawnIframe` blink); **clock** →
   every enemy freezes for `CLOCK_FREEZE_SEC` (the world's gameplay `dt` is `0` — enemies don't move,
   AI/fire skipped); **shovel** → the eagle's brick ring becomes STEEL for `SHOVEL_FORTIFY_SEC` via
   `TileMap.fortifyBaseRing(...)` (the real body-swap seam — §5.5), then `TileMap.revertBaseRing()` restores
   the EXACT pre-fortify brick state (including any quarter-brick erosion); **star** → that player's `tier`
   increments (capped) and its spec re-folds (a faster bullet /
   more shots — the F4 `applyStarTier` curve); **grenade** → every on-screen enemy is destroyed
   immediately (banking score + the ledger via the SAME kill funnel); **tank** → the SHARED life count for
   that slot increases by 1.
3. **AC3 — the timed power-ups expire CLEANLY on the gameplay dt.** `RunState.freezeTimer` /
   `shovelTimer` / `shieldTimer[slot]` decay on the GAMEPLAY `dt` each frame (`tickTimers`) and reach
   exactly 0 without going negative; on expiry the freeze releases (enemies resume), the shovel ring
   reverts brick, and the shield ends — no residual effect. A stage advance RESETS the timed power-ups (a
   clock/shovel does not bleed into the next stage). The verifier asserts the decay + the advance-reset.
4. **AC4 — score + lives are tracked across the run.** The shared `score` (F4) accrues per kill (incl.
   grenade kills); per-player `lives` (F4) decrement on death and the **tank** power-up increments the
   shared slot life. The HUD reads both live from the registry; the GameOver summary shows the final score
   + stage.
5. **AC5 — GameOver banks the SHARED currency + updates the bests, and it SURVIVES a reload.** On the
   run-over edge (eagle lost OR all lives spent) `GameScene` calls `MetaState.bankRun({ score, stage })`
   ONCE under the `gameOver` guard: `currency += floor(score · CURRENCY_RATIO)`,
   `bestScore = max(bestScore, score)`, `bestStage = max(bestStage, stage)`, then `saveMeta`. The
   `GameOverScene` DISPLAYS `currencyBanked` + the bests from the summary snapshot (it does not itself
   save). Re-launching (a fresh `MetaState`/`loadMeta`) reflects the banked currency + bests (persisted via
   `util/save.ts`; a disabled storage degrades to in-memory and never throws).
6. **AC6 — the Hub shows TWO trees on ONE shared bank; a buy applies to that player's next run.** The Hub
   renders a P1 upgrade column + a P2 upgrade column (each generic off `TANK_UPGRADES`), ONE shared
   currency readout, and two cursors (P1 navigates left / P2 right; in 1-player the P2 column is HIDDEN and
   one cursor drives the lone column). A buy debits the SHARED currency and increments THAT player's level;
   it is a no-op if unaffordable or maxed. START RUN launches Game; the run's player spec is
   `applyUpgrades(applyStarTier(0), upgrades[slot])` (`MetaState.startSpec(slot)`), so the bought upgrade
   visibly changes that player's tank next run (e.g. `+1 starting life` → an extra life; `+max bullets` →
   two shots out from stage 1).
7. **AC7 — the full Title → Hub → Run → GameOver → Hub loop is closed.** Title routes to Hub; Hub START
   RUN to Game; Game's run-over to GameOver (with the summary); GameOver to Hub (banked currency
   immediately spendable). No dead end; every transition is a registered scene.
8. **AC8 — the HUD is complete + DECOUPLED.** The parallel HUD overlay shows P1 lives + (in co-op) P2
   lives, enemies-remaining, the stage number, the score, the shared currency, and the active power-up +
   its remaining seconds (freeze/shovel/shield) — all read from the scene REGISTRY that `GameScene` writes
   each frame (the HUD never reaches into the world — the reference's decoupling). In 1-player the P2 line
   is hidden.
9. **AC9 — i18n: every new chrome string is en + zh-CN.** The i18n core (`t`/`tName`/`tDesc`/`getLocale`/
   `setLocale`/`detectLocale`) is PURE of Phaser; `en.ts` + `zh-CN.ts` carry every Title/Hub/HUD/GameOver/
   power-up chrome string + the upgrade name/desc overrides. The live locale is set once at boot
   (`detectLocale()` or a saved pref) and a missing zh key falls back to en, never blank. The user (zh-CN)
   sees Chinese chrome. **What the verifier PROVES headlessly (re-scoped — the new scenes are Phaser-coupled
   and NEVER imported by the verifier, and there is no shared key registry it could enumerate scene-used keys
   from, so "every key the scenes use exists" is NOT headlessly provable):** the i18n modules
   (`i18n/index.ts` + `en.ts` + `zh-CN.ts`) node-import cleanly (re-proving purity); `EN.ui` is non-empty and
   `ZH_CN.ui`'s keys are a SUBSET of `EN.ui`'s keys (zh never introduces an orphan chrome key en lacks —
   so every zh string has an en fallback source); every `upgrade` content `Entry` is well-formed (a
   `name`/`desc` string when present) in BOTH locales, and each `TANK_UPGRADES` row id that `zh-CN` overrides
   exists in `TANK_UPGRADES_BY_ID` (no orphan content override); the fallback chain `t(missingZhKey)` returns
   the EN string (never blank) and `t(absentKey)` returns the key itself (never blank/undefined). The
   scene-used-key coverage is instead checked by the §7 code-presence grep (every `t('...')` literal at the
   Title/Hub/HUD/GameOver sites) + the manual drive-test (zh chrome renders), NOT a headless enumeration.
10. **AC10 — deferred teardown + one-shot guards (the power-up loop leaks nothing).** A power-up effect
    that destroys/rebuilds bodies (grenade → kills enemies; shovel → `TileMap.fortifyBaseRing` destroys the
    ring brick sub-cells + adds steel bodies, `revertBaseRing` destroys the steel + rebuilds the brick —
    §5.5) DEFERS its destructive work out of the player×pickup overlap callback (fortify) / the timer step
    (revert) via `time.delayedCall(0)` (the F3/F4 footgun discipline). The pickup pool's `release()` only
    DISABLES a body (safe inside the step). The stage rebuild `releaseAll()`s live pickups, `TileMap.destroy()`
    clears the `_fortifyBodies` group, and the per-player overlaps go with the rebuilt tanks (no stale
    handle). `bankRun` fires ONCE under the `gameOver` guard.
11. **AC11 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run build`
    exit 0; `npm run verify` prints OK + exits 0 with the NEW F5 assertions (power-up + upgrade
    well-formedness, `applyUpgrades` identity/monotone-helpful, `pickPowerUpKind` determinism, the
    `RunState` timer decay + advance-reset, the i18n dictionary structure) PLUS the F0–F4 sweep (unchanged
    except §7f's `createRunState` calls, re-pinned to the new per-slot seed-map signature — D5b/D5c).
    `config/powerups.ts`, `config/tank-upgrades.ts`, the pure `applyUpgrades`, the extended
    `core/RunState.ts`, and `i18n/*` import NO Phaser (node-imported by the verifier — re-proving purity);
    `entities/PowerUp.ts`, `world/TileMap.ts`, the scenes, and `MetaState`'s `save.ts`-coupled persistence
    methods import Phaser/storage and are NEVER imported by the verifier. Programmer-art primitives only;
    runs offline / `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — Power-ups are a POOLED entity (the reference's `PickupPool`), the scene resolves the effect; the
   pool knows nothing about the economy.** The reference's `entities/Pickup.ts` is a FIXED pre-created pool
   of rect+sensor members (acquire/release/releaseAll, per-pickup `pk` state mutated on acquire — zero
   allocation after warm-up) that is DECOUPLED from the economy: `GameScene` wires ONE overlap and the
   callback reads `rect.pk.kind` to resolve collection, then releases. F5's `PowerUpPool` is the same: the
   pool only places/pulses/recycles rectangles tagged with a `kind`; the SCENE owns `_applyPowerUp(slot,
   kind)`. *Rationale:* the pooling convention is mandated (the project brief) and matches every other Tank
   1990 pool (`BulletPool`, `ParticlePool`); decoupling the pool from the effect keeps the six effects in
   ONE switch (SOLID — the pool is a placement device, the scene is the economy) and the pool reusable
   (KISS/DRY). A handful of members (drops are sparse + collected fast) → no leak.
2. **D2 — TOP-DOWN divergence: NO gravity arc; a power-up sits grid-aligned + static until walked over.**
   The reference's pickup pops upward under Arcade gravity and settles (a side-scroller). Tank 1990 is
   TOP-DOWN (constants D3 — no gravity world): a power-up is placed at the drop window-center (the F2/F4
   grid-aligned coordinate), sits as a STATIC sensor body, pulses its kind colour (the classic blink), and
   is collected on a player-tank overlap. *Rationale:* an arc has no meaning in a top-down grid; the
   classic Battle City power-up sits on the field until driven over (KISS — no physics, just a sensor
   overlap). This is the one deliberate pickup divergence from the reference, exactly as the constants doc
   keeps "no GRAVITY constant" the one deliberate divergence from the platformer (YAGNI — don't import a
   gravity arc a top-down game can't use).
3. **D3 — The drop KIND is picked off the STAGE RNG (deterministic per stage), like the roster picks; the
   pure `pickPowerUpKind(rng)` lives in `config/powerups.ts`.** F4's spawn loop already drives the
   per-stage `stageRng` for `rosterPick` + the carrier roll; F5 reuses it for the kind pick — so a fixed
   stage seed yields a deterministic power-up stream (the reference keeps drops off the seeded LEVEL pin,
   but Tank 1990 has no separate level pin distinct from the stage RNG, and using the stage RNG keeps the
   drop reproducible for a replay). *Rationale:* one RNG source per stage (DRY); a PURE `pickPowerUpKind`
   the verifier proves total + deterministic (KISS — a uniform pick over `POWERUP_KINDS`). It does NOT
   touch the seeded LEVEL generator (which the verifier pins — D11 below), so the regression pin is
   untouched.
4. **D4 — The six effects are ONE `_applyPowerUp(slot, kind)` switch in `GameScene`; each writes the
   EXISTING F4 run-economy seam, not a new system.** helmet → `runState.shieldTimer[slot] =
   HELMET_SHIELD_SEC` + `tank.spawnIframe = HELMET_SHIELD_SEC` (reuse the F3 i-frame blink/`isHittable`
   gate — no new shield code); clock → `runState.freezeTimer = CLOCK_FREEZE_SEC` (the placeholder F4 seam,
   now driven); shovel → `runState.shovelTimer = SHOVEL_FORTIFY_SEC` + `tileMap.fortifyBaseRing(ringCells)`
   (the REAL new TileMap body-swap seam — D4a/§5.5, deferred out of the overlap — D10); star →
   `runState.tier[slot]++` (clamped) + re-fold the player's spec via
   `applyUpgrades(applyStarTier(tier), upgrades[slot])` (the F4 star fold OVER the Hub tree — D4b/§5.4, so a
   star never strips the Hub upgrades); grenade → kill every live enemy via
   the SAME `tank.onHit(BIG)`/`onDeath` funnel (DEFERRED out of the overlap — D10); tank →
   `runState.lives[slot]++`. *Rationale:* every effect maps onto an EXISTING F4 field/seam
   (`freezeTimer`/`shovelTimer`/`tier`/`lives`/`spawnIframe`) — F5 adds ONE new field (`shieldTimer`), ONE
   switch, and the ONE new TileMap fortify/revert seam (D4a), not six subsystems (KISS/DRY/YAGNI). The scene
   owns the run economy (SOLID — the pool reports a kind, the scene applies it), exactly as F4 made the scene
   own the kill economy.
   1. **D4a — The shovel fortify/revert is a REAL `TileMap.fortifyBaseRing(cells)` / `revertBaseRing()` API
      (the reviewer's blocking issue: there was NO brick→steel seam).** F4's `TileMap` exposes only
      `destroyBrickSubCell()` (chip one of a brick tile's 4 sub-cell bodies) and `destroy()` — neither
      converts brick→steel nor restores it, and the ring is built as 4 sub-cell bodies per tile (`_addBrick`)
      whereas steel is one `TILE_SIZE` body (`_addSolidTile`), so a fortify CANNOT just recolour. F5 ADDS the
      explicit seam: `fortifyBaseRing(cells)` — for each ring tile, destroy whatever brick sub-cells survive
      (recording their `(subCol,subRow)` set), then add ONE `TILE_SIZE` STEEL static body into a new
      `_fortifyBodies` group; `revertBaseRing()` — destroy the steel bodies and REBUILD each cell's recorded
      surviving brick sub-cells (so a partially-chipped ring reverts to EXACTLY its pre-fortify erosion). The
      ring cells are the EXISTING fort-ring cells (the in-grid orthogonal BRICK neighbours of `desc.base` —
      LevelGenerator §5.3 step 2), derived once in `GameScene` from `desc.base` (DRY — no new generator
      call). *Rationale:* a power-up may not invent terrain semantics the engine can't honour — it must use a
      real seam. Putting the body swap on `TileMap` (which already owns the brick sub-cell map + the
      `_addSolidTile`/`_addBrick` builders) keeps the body ownership in ONE place (SOLID — the scene owns the
      TIMER, TileMap owns the BODIES); recording the survivor set makes the revert lossless w.r.t. erosion
      (the classic shovel restores your ring as you left it). `TileMap` moves to the Changed list; it STILL
      imports Phaser, so the verifier never imports it (the pure/coupled split holds). KISS — two methods
      reusing the existing builders.
   2. **D4b — The running player tank is built from `applyUpgrades(applyStarTier(tier[slot]),
      upgrades[slot])` at BOTH the build site and the star re-fold (the reviewer's blocking issue: the Hub
      upgrades were dropped).** F4's `_buildPlayer` constructs `new Tank(..., applyStarTier(tier[slot]))` and
      the per-stage rebuild re-folds `applyStarTier(tier)` ONLY — so the Hub's `+maxBullets`/`+bulletSpeed`/
      `+tankSpeed`/`+baseArmor` rows would never reach the tank, and a mid-run STAR power-up (which re-folds
      via `applyStarTier`) would strip the Hub upgrades. F5 makes the running spec
      `applyUpgrades(applyStarTier(tier[slot]), upgrades[slot])` at EVERY site that builds/rebuilds the player
      tank (`_buildPlayer` + the star re-fold) — folding the per-player Hub tree OVER the star tier. The
      per-player `upgrades[slot]` map is read once in `create()` from `MetaState` and cached on the scene
      (`this.upgrades[slot]`), so the fold needs no `save.ts` touch per frame. *Rationale:* AC6 requires e.g.
      `+max bullets → two shots out from stage 1`, which is only true if the live tank reads the folded spec;
      folding the Hub tree OVER the star tier (not instead of it) means a star and a Hub upgrade COMPOSE (both
      apply), and the per-stage carry of the star tier (via `runState.tier[slot]`) keeps both across stages.
      DRY — the SAME `applyUpgrades(applyStarTier(...), upgrades)` expression `MetaState.startSpec` uses,
      reused at the live build sites. SOLID — one fold expression, one source of truth (the cached
      `upgrades[slot]`).
5. **D5 — `RunState` gains a PURE `tickTimers(dt)` + a `shieldTimer` map; `advance()` resets the timed
   power-ups; the verifier proves expiry.** The placeholder `freezeTimer`/`shovelTimer` (F4) + the new
   per-player `shieldTimer` decay in ONE pure method clamped at 0; `advance()` zeroes them on a stage
   change (a clock/shovel doesn't carry — the classic). *Rationale:* the timers are run-scoped scalars →
   they belong on `RunState` (the F4 stance); keeping the decay PURE (no Phaser) means the verifier
   node-imports `RunState` (it already does) and drives `tickTimers` to assert clean expiry + the
   advance-reset (a REAL headless proof, not eyeballing — the reference's "verify what's provable"). KISS —
   one method, a few `Math.max(0, t - dt)`. The freeze EFFECT (gameplay `dt = 0`) lives in the scene
   (Phaser-coupled); `RunState` only owns the COUNTDOWN.
   1. **D5b — `createRunState` takes a PER-SLOT `{ [slot]: {lives, tier} }` seed map (NOT the F4 scalar
      `startLives`), so each player's INDEPENDENT Hub tree lands at run start (the reviewer's blocking
      issue).** The F4 signature `createRunState(startSeed, presentSlots, startLives)` passes ONE scalar
      `startLives` shared across slots and always seeds `tier[slot]=0` — but P1 and P2 have DIFFERENT
      `+startLife`/`+starStart` upgrades, so a shared scalar can't express it. F5 changes the signature to
      `createRunState(startSeed, seeds: Record<slot, {lives, tier}>)`: the present-slots list is `Object.keys
      (seeds)` (the map IS the present-players set — DRY, the `presentSlots` arg is dropped), and each slot's
      run-start `lives`/`tier` come straight from that slot's folded spec. GameScene computes the map from
      `MetaState.startSpec(slot)`: `lives = START_LIVES + spec.startLivesBonus`, `tier = spec.startTier`. The
      OPTIONAL `startLivesBonus?`/`startTier?` default to 0 (D7), so a fresh meta yields `{lives:START_LIVES,
      tier:0}` — the F4 behaviour, just expressed per-slot. *Rationale:* the per-slot map is the minimal shape
      that carries two independent trees (KISS — `{lives,tier}` is exactly what the run needs, nothing more);
      keeping `RunState` pure means the verifier drives the new signature headlessly (§7f re-pinned — D5c).
      The fold lives in GameScene (it reads `MetaState`, the impure boundary), `createRunState` stays a pure
      seed-the-fields factory (SOLID — the factory takes data, the scene supplies it).
   2. **D5c — The F4 verifier §7f is RE-PINNED to the new `createRunState` signature (the doc no longer
      claims that block is byte-unchanged).** Because D5b changes the signature, §7f's
      `createRunState(RS_SEED, [1,2], 3)` no longer compiles; the doc explicitly RE-PINS §7f to
      `createRunState(RS_SEED, {1:{lives:3,tier:0}, 2:{lives:3,tier:0}})` (asserting the same fresh-state
      invariants) PLUS a new seeded case `createRunState(SEED, {1:{lives:5,tier:2}})` proving the per-slot
      lives/tier fold (AC6). Every OTHER F4 verifier block (rng pin, constants, save round-trip, tiles, stage
      monotonicity + sweep + regression pin, roster, the `advance()` seed chain) is byte-unchanged.
      *Rationale:* the reviewer correctly flagged that "the F0–F4 sweep stays green/unchanged" is false once
      the signature changes — F5 OWNS the one §7f edit and pins the new assertions, rather than silently
      breaking the verifier. KISS — one re-pinned block, the rest untouched.
6. **D6 — `config/tank-upgrades.ts` mirrors the reference's `config/upgrades.ts` row shape EXACTLY, but
   folds over the F4 `TankSpec` (not a bespoke stats object).** Each row is self-contained
   (`id`/`name`/`desc`/`maxLevel`/`costs[]` MONOTONE non-decreasing/`apply(spec, level)` returning a NEW
   spec that never weakens). The fold target is the F4 `TankSpec` (the player's run-start stats), so a
   `+max bullets` row literally raises `spec.maxBullets`, `+bullet speed` raises `spec.bulletSpeed`, etc. —
   the running tank reads the SAME spec fields F4 already threads (no new stat plumbing). *Rationale:* DRY
   — the player already reads a `TankSpec`; the Hub fold targets it directly (no parallel `PlayerStats`
   shape). The PURE row table means the Hub renders the trees GENERICALLY (no per-upgrade UI), the verifier
   asserts the cost-monotone + never-weaker contract, and the effects live in ONE data file — the
   reference's exact stance (its Decision 57). KISS — flat data + one pure fold.
7. **D7 — The "+1 starting life" / "+star-start" / "base-armor" rows fold into NEW `TankSpec`-adjacent
   fields the run-start reads (not a magic side channel).** Most rows fold a plain `TankSpec` numeric
   (`maxBullets`/`bulletSpeed`/`moveSpeed`/`maxHp`). Two rows are run-SETUP, not per-tank feel:
   `+1 starting life` and `+star-start`. To keep `applyUpgrades` a PURE `spec → spec` fold (DRY with
   `applyStarTier`), the `TankSpec` is EXTENDED with two OPTIONAL run-start fields — `startLivesBonus?`
   (default 0) + `startTier?` (default 0) — that ONLY the run-start setup reads: GameScene reads the folded
   `MetaState.startSpec(slot)` and computes that slot's seed `{ lives: START_LIVES + spec.startLivesBonus,
   tier: spec.startTier }`, then passes the per-slot map to `createRunState` (D5b — the per-slot seed map);
   the per-tank movement/fire code IGNORES these two fields (they're not feel stats). *Rationale:* keeping
   the fold a single `spec → spec` shape (no second
   return value) is the cleanest reuse of the reference's `apply` contract (SOLID — one fold signature);
   the optional fields default to the IDENTITY so a fresh meta is byte-unchanged (the verifier's identity
   pin holds). `base-armor start` folds `spec.maxHp` directly (the player starts a run at `>1` HP — the
   F3/F4 HP funnel gives multi-hit "for free"). KISS — two optional fields, no new system.
8. **D8 — `core/MetaState.ts` is a FACTORY wrapping the EXISTING `util/save.ts`; the SHARED bank + the
   per-player trees are the locked schema (already in `save.ts`).** The reference's `createMetaState()`
   wraps `loadMeta`/`saveMeta` with `getCells`/`buy`/`bankRun`/`startStats`. F5's mirrors it against Tank
   1990's EXISTING `save.ts` schema (which F0 ALREADY shaped for the locked decision: `currency` is the
   SHARED bank, `upgrades: { '1', '2' }` are the PER-PLAYER trees, `bestScore`/`bestStage` the bests — and
   the verifier already round-trips it). So F5 adds NO save-schema migration (D-saving-grace): it only adds
   the WRAPPER + the upgrade ROWS the empty `upgrades` maps were always meant to hold. `buy(slot, id)`
   debits the SHARED `currency` + increments `upgrades[slot][id]`; `bankRun` adds the banked currency +
   bumps the bests; `startSpec(slot)` folds the tree over `applyStarTier(0)`. *Rationale:* the persistence
   seam is owned ONCE (`save.ts`) and the gameplay code touches meta ONLY through `MetaState` (the
   reference's decoupling — scenes never call `save.ts` directly). A factory (not a singleton) so the Hub
   and the next run each `load()` a fresh view of the SAME storage (a buy is reflected next run). The pure
   `applyUpgrades` is exported separately so the verifier imports the fold without the storage-coupled
   instance (the reference's split). Inherits `save.ts`'s try/catch (never throws — AC5/AC11).
9. **D9 — The Hub is a two-column shared-bank layout with two cursors (the LOCKED meta-hub decision); both
   columns render GENERICALLY off `TANK_UPGRADES`.** A SHARED currency header; a P1 column (left) + a P2
   column (right), each a vertical list of the upgrade rows (name · Lv owned/max · cost · desc — the
   reference's per-column fixed-x cells so the columns align under the proportional CJK fallback font); two
   cursors (P1 = WASD + P1 fire to buy; P2 = arrows + P2 fire to buy — reusing the SAME physical keys the
   run uses, so no new key wiring); Space/Enter = START RUN. In 1-PLAYER (`TWO_PLAYER` false) the P2 column
   is HIDDEN and the lone P1 cursor drives the single column (the brief's "1-player session hides the P2
   column"). *Rationale:* the two-column shared-bank-per-player-tree shape is the LOCKED decision — F5
   implements it literally. Rendering both columns off the SAME `TANK_UPGRADES` list (no per-upgrade UI
   code) is the reference's generic-row stance (DRY); reusing the run's movement+fire keys for the two
   cursors avoids inventing Hub-only bindings (KISS, SOLID — the Hub reads the same `Input` snapshot
   shape). A buy debits the shared pool so the two trees genuinely COMPETE for one bank (the locked
   tension).
10. **D10 — A power-up effect that destroys/rebuilds bodies DEFERS out of the overlap callback (the F3/F4
    footgun discipline).** The grenade (kills enemies) + the shovel (swaps the base ring's brick bodies to
    steel and back) MUST NOT destroy a body inside the player×pickup Arcade overlap callback (it corrupts
    `world.step`'s collider iteration — the documented footgun). F5 routes them through
    `time.delayedCall(0)` (runs next tick, after the step) exactly as F3 defers the brick-chip + F4 defers
    the stage advance. The pickup `release()` only DISABLES a body (safe inside the step). *Rationale:*
    the footgun rule is load-bearing (the reference + F3/F4 enforce it); F5's new destructive effects obey
    it identically (AC10). KISS — the SAME `delayedCall(0)` idiom already in the scene.
11. **D11 — The drop KIND pick uses the stage RNG but NOT the seeded LEVEL generator; the regression pin is
    untouched, and the verifier's NEW claims are DATA properties (not balance).** F5 adds NO call into
    `world/LevelGenerator.ts` (the module the verifier pins byte-for-byte), so the F2/F4 regression pin
    holds unchanged. The verifier's new F5 assertions are DATA properties only: power-up/upgrade
    well-formedness, `applyUpgrades` identity + monotone-helpful, `pickPowerUpKind` determinism, the
    `RunState` timer decay/reset. It does NOT assert "the power-ups are balanced" (emergent — manual-test
    the feel). *Rationale:* keeping the verifier's claims to provable contracts keeps the gate trustworthy
    (the reference's "HONEST VERIFICATION SCOPE"); leaving the level generator + its pin untouched means
    F5 cannot regress the F2/F4 determinism gate (the safest possible change). KISS — assert what's
    provable, manual-test the feel.
12. **D12 — i18n is the reference's hand-rolled layer, TRIMMED to Tank 1990's actual strings (YAGNI).** The
    `i18n/index.ts` core (`t`/`tName`/`tDesc`/`getLocale`/`setLocale`/`detectLocale`, the zh→en→key
    fallback, the `Dict` shape) is copied FAITHFUL in structure from the reference (PURE of Phaser); but
    `en.ts`/`zh-CN.ts` carry ONLY the categories Tank 1990 renders — the `ui` chrome (Title/Hub/HUD/
    GameOver/power-ups) + the ONE content category `upgrade` (name/desc overrides). The reference's
    `weapon`/`biome`/`boss`/`blueprint`/`tier`/… categories are OMITTED (Tank 1990 has none — YAGNI).
    *Rationale:* the user reads zh-CN, so the chrome MUST localise; a full ICU library would break the
    single-runtime-dependency profile (KISS); copying the reference's tiny proven layer (DRY — one
    fallback chain, one interpolation) but only the strings that exist keeps it minimal. `UI_FONT` (F0,
    already CJK-capable) is the render font at every site. *Verifier scope (the reviewer's blocking issue —
    re-scoped):* the new scenes are Phaser-coupled and NEVER imported by the verifier, and there is no shared
    key registry it could enumerate scene-used keys from, so the doc does NOT claim it asserts "every `t` key
    the scenes use exists in en" (unprovable headlessly). The verifier instead proves the i18n modules'
    STRUCTURE from the pure dictionaries — purity (clean node-import), `ZH_CN.ui` ⊆ `EN.ui` (no orphan zh
    key), well-formed `upgrade` entries keyed to real `TANK_UPGRADES_BY_ID` ids, and a correct fallback chain
    (a missing zh key returns en, never blank; an absent key returns itself) — and scene-key coverage is the
    §7 grep + the manual drive (AC9/§7).

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F5 ADDS `config/powerups.ts`, `config/tank-upgrades.ts`,
`core/MetaState.ts`, `entities/PowerUp.ts`, and the `i18n/` layer; REWRITES the F0 stub
Hub/HUD/GameOver/Title scenes; and EXTENDS `RunState`/`GameScene`/`constants`/the verifier:

```
src/
  config/
    constants.ts        # CHANGED (PURE): + CURRENCY_RATIO. No Phaser.
    powerups.ts         # NEW (PURE): PowerUpKind + PowerUpDef + POWERUPS/POWERUP_BY_ID/POWERUP_KINDS
                        #   + the run-effect durations + pickPowerUpKind(rng). No Phaser.
    tank-upgrades.ts    # NEW (PURE): TANK_UPGRADES rows (folded over TankSpec) + applyUpgrades(base,upg).
                        #   No Phaser. The verifier node-imports it.
    tanks.ts            # CHANGED (PURE): TankSpec gains OPTIONAL startLivesBonus?/startTier? (D7). No Phaser.
  core/
    Input.ts            # (F1, unchanged — the Hub reads the same snapshot shape)
    RunState.ts         # CHANGED (PURE): + shieldTimer map + tickTimers(dt) + advance() resets the timed
                        #   power-ups; createRunState takes a PER-SLOT {[slot]:{lives,tier}} seed map (D5b,
                        #   was scalar startLives) so each player's +startLife/+starStart lands. No Phaser.
    MetaState.ts        # NEW: createMetaState() factory wrapping util/save.ts (getCurrency/getUpgradeLevel/
                        #   buy/bankRun/startSpec) + re-export the PURE applyUpgrades. Persistence-coupled
                        #   (NEVER imported by the verifier); the pure fold IS verifier-imported via
                        #   config/tank-upgrades.ts.
  entities/
    PowerUp.ts          # NEW (Phaser-coupled): PowerUpPool — fixed pooled rects, acquire/release/releaseAll,
                        #   static sensor (no gravity, D2), kind-colour pulse. NEVER verifier-imported.
  world/
    LevelGenerator.ts   # (F2, unchanged — no new generator call; the ring cells derive from desc.base)
    TileMap.ts          # CHANGED (Phaser-coupled): + fortifyBaseRing(cells)/revertBaseRing() (the shovel
                        #   brick⇄steel body swap, erosion-lossless — D4a/§5.5). Phaser → NEVER verifier-imported.
  effects/              # (F3, unchanged — Effects/ParticlePool reused for the pickup/kill bursts)
  scenes/
    BootScene.ts        # (unchanged)
    TitleScene.ts       # CHANGED: inline literals → t(...) (i18n adoption). Flow unchanged (→ Hub).
    HubScene.ts         # REWRITE: the two-column P1|P2 shared-bank Hub (D9). reads/writes MetaState only.
    GameScene.ts        # CHANGED: PowerUpPool + the player×pickup overlap + _applyPowerUp switch; tickTimers;
                        #   gdt=0 freeze; shovel fortify/revert via TileMap (D4a); grenade (deferred); the
                        #   per-slot createRunState seed from MetaState.startSpec + the live tank spec
                        #   applyUpgrades(applyStarTier(tier),upgrades[slot]) at _buildPlayer/star (D4b);
                        #   publish the FULL HUD registry; bankRun + the GameOver summary on the run-over edge.
    HUDScene.ts         # REWRITE: lives/enemies/stage/score/currency/active power-up — registry-only, t(...).
    GameOverScene.ts    # REWRITE: read the summary snapshot → render score/stage/banked/bests → route to Hub.
  i18n/
    index.ts            # NEW (PURE): t/tName/tDesc + getLocale/setLocale/detectLocale + Dict/Category. No Phaser.
    en.ts               # NEW (PURE): the EN ui chrome + the `upgrade` content category (source of truth).
    zh-CN.ts            # NEW (PURE): the zh-CN ui overrides + the `upgrade` name/desc overrides.
  main.ts               # CHANGED (one block): setLocale(meta.language ?? detectLocale()) at boot.
scripts/
  verify-gen.mjs        # CHANGED: + powerups/tank-upgrades/RunState-timer/i18n assertions; re-pin §7f to the
                        #   new per-slot createRunState signature (D5c — the one F4 verifier edit). Else F0–F4.
```

### 5.2 Key types & data

**`src/config/constants.ts`** (PURE — ADD one):

- `CURRENCY_RATIO` (0..1) — the fraction of run score banked into the shared currency on run end
  (`currency += floor(score · CURRENCY_RATIO)`; AC5). The single owner (DRY) — `MetaState.bankRun` reads it.

**`src/config/powerups.ts`** (PURE — the six classics + the run-effect durations):

```ts
export type PowerUpKind = 'helmet' | 'clock' | 'shovel' | 'star' | 'grenade' | 'tank'
export interface PowerUpDef {
  id: string             // === kind (a stable key; the i18n/HUD read it)
  kind: PowerUpKind
  color: number          // programmer-art pulse fill (coupled PowerUp ONLY; the verifier ignores it)
  durationSec: number    // s — the timed effect's window (0 for the INSTANT kinds: star/grenade/tank)
}
export const POWERUPS: PowerUpDef[]                 // ordered (the verifier sweep source)
export const POWERUP_BY_ID: Record<string, PowerUpDef>
export const POWERUP_KINDS: PowerUpKind[]           // the six kinds (pickPowerUpKind draws from this)
// the run-effect tunables the scene reads (one owner — DRY):
export const HELMET_SHIELD_SEC: number              // helmet → shieldTimer[slot]
export const CLOCK_FREEZE_SEC: number               // clock  → freezeTimer
export const SHOVEL_FORTIFY_SEC: number             // shovel → shovelTimer
export function pickPowerUpKind(rng: RNG): PowerUpKind   // PURE uniform pick over POWERUP_KINDS (deterministic)
```

**`src/config/tank-upgrades.ts`** (PURE — the permanent per-player upgrade rows folded over a `TankSpec`):

```ts
import type { TankSpec } from './tanks.js'
export interface TankUpgrade {
  id: string
  name: string                 // EN source (the i18n `upgrade` content key)
  desc: string                 // EN one-line effect summary
  maxLevel: number
  costs: number[]              // currency cost for the NEXT level: costs[ownedLevel]; MONOTONE non-decreasing
  apply: (spec: TankSpec, level: number) => TankSpec   // NEW spec; never weakens (the verifier asserts)
}
export const TANK_UPGRADES: TankUpgrade[]            // the rows (generic Hub render + the verifier sweep)
export const TANK_UPGRADES_BY_ID: Record<string, TankUpgrade>
// PURE fold: base + each OWNED level → a NEW TankSpec. Identity = a clone of base for an empty map.
// Unknown ids skipped; a stored level clamped to maxLevel (a corrupt save degrades gracefully).
export function applyUpgrades(base: TankSpec, upgrades?: Record<string, number>): TankSpec
```

The rows (each only HELPS — the verifier's never-weaker check):

| id            | effect (per level)                              | folds                              |
|---------------|--------------------------------------------------|------------------------------------|
| `maxBullets`  | +1 live-bullet cap                               | `spec.maxBullets + level`          |
| `bulletSpeed` | +N px/s fired bullet speed                       | `spec.bulletSpeed + N·level`       |
| `tankSpeed`   | +N px/s grid drive speed                         | `spec.moveSpeed + N·level`         |
| `startLife`   | +1 starting life                                 | `spec.startLivesBonus + level` (D7)|
| `baseArmor`   | start a run with +1 HP (multi-hit start)         | `spec.maxHp + level`               |
| `starStart`   | start a run at tier N                            | `spec.startTier = level` (D7)      |

(`TankSpec` gains OPTIONAL `startLivesBonus?: number` (default 0) + `startTier?: number` (default 0) — the
run-start reads them; the per-tank feel code ignores them — D7. The fresh-meta identity is unchanged.)

**`src/core/MetaState.ts`** (the persistence wrapper + the pure re-export):

```ts
export { applyUpgrades } from '../config/tank-upgrades.js'   // re-export the PURE fold (verifier path)
export interface MetaStateInstance {
  getCurrency(): number
  getUpgradeLevel(slot: 1 | 2, id: string): number
  getBestScore(): number
  getBestStage(): number
  buy(slot: 1 | 2, id: string): boolean        // debit SHARED currency + increment upgrades[slot][id]; SAVE
  bankRun(arg: { score: number; stage: number }): number   // currency += floor(score·RATIO); bump bests; SAVE
  getUpgrades(slot: 1 | 2): Record<string, number>   // the player's owned-level map (GameScene caches it for the live re-fold — D4b)
  startSpec(slot: 1 | 2): TankSpec             // applyUpgrades(applyStarTier(0), upgrades[slot]) — the run-START seed spec (D5b/D7)
}
export function createMetaState(): MetaStateInstance         // wraps loadMeta() — a fresh view each call
// NOTE the two folds (D4b/D5b): startSpec(slot) is the run-START spec — GameScene reads its
// startLivesBonus/startTier to seed createRunState's per-slot {lives,tier} map. The run-TIME tank spec is
// applyUpgrades(applyStarTier(runState.tier[slot]), getUpgrades(slot)), folded at _buildPlayer + the star
// re-fold (so a star COMPOSES with the Hub tree, never strips it — AC2/AC6).
```

**`src/core/RunState.ts`** (CHANGED — ADD the shield map + the timer decay + the advance-reset; CHANGE the
`createRunState` signature so the Hub's per-player `+startLife` / `+starStart` upgrades land at run start —
D5b, the reviewer's blocking issue: the F4 signature `createRunState(startSeed, presentSlots, startLives)`
takes ONE scalar `startLives` shared across slots, but P1/P2 have INDEPENDENT trees — different
`startLivesBonus`/`startTier`):

```ts
export interface RunState {
  // … all F4 fields …
  shieldTimer: Record<number, number>   // NEW — per-player helmet i-frame window (0 = no shield, the identity)
  tickTimers(dt: number): void          // NEW — decay freezeTimer/shovelTimer/shieldTimer[*] to 0, clamped
  // advance() ALSO resets freezeTimer/shovelTimer/shieldTimer to 0 (a stage change drops timed power-ups)
}

// ── NEW createRunState signature (D5b) ── a PER-SLOT seed map replaces the F4 scalar startLives, so each
// present player's run-start lives/tier come from THAT player's folded Hub spec. The map is
// { [slot]: { lives, tier } } — already the per-slot {lives,tier} the run needs, computed by the caller
// (GameScene) from MetaState.startSpec(slot): lives = START_LIVES + spec.startLivesBonus, tier = spec.startTier.
export interface SlotSeed { lives: number; tier: number }
export function createRunState(
  startSeed: number,
  seeds: Record<number, SlotSeed>,   // present slots ONLY (solo {1:…}, co-op {1:…,2:…}) — D11 present-scoping
): RunState
// For each slot in `seeds`: lives[slot] = seeds[slot].lives, tier[slot] = seeds[slot].tier, shieldTimer[slot]=0.
// presentSlots is DERIVED as Object.keys(seeds) (no separate arg — the map IS the present-players list, DRY).
// freezeTimer/shovelTimer seed 0 (the neutral identity); the spawn ledger seeds from stageConfig(0) (F4).
```

> **Reconciling the F4 verifier §7f (the BLOCKING back-compat issue).** §7f calls
> `createRunState(RS_SEED, [1,2], 3)` and asserts fresh `tier[slot] === 0` / `freezeTimer === 0`. The new
> signature DROPS the `presentSlots` array + scalar `startLives` for a `{ [slot]: {lives, tier} }` map, so
> §7f MUST be re-pinned (the doc no longer claims "F0–F4 verifier blocks are byte-unchanged" — see §7's
> revised wording). The re-pinned §7f constructs `createRunState(RS_SEED, { 1:{lives:3,tier:0},
> 2:{lives:3,tier:0} })` and asserts the SAME invariants (fresh `tier[slot]===0` when the seed map passes
> tier 0, `lives[slot]===3`, `freezeTimer===0`/`shovelTimer===0`, score 0, the ledger from stageConfig(0),
> and the carried-economy-survives-advance check). It ALSO adds a seeded case `createRunState(SEED,
> {1:{lives:5,tier:2}})` asserting `lives[1]===5` / `tier[1]===2` (proving the Hub's `+startLife`/`+starStart`
> fold reaches run start — AC6). The boss-stage probe re-pins to `createRunState(1, {1:{lives:3,tier:0}})`.
> This is the ONLY F4 verifier block F5 edits (the rng/constants/save/tiles/stage/roster/`advance`-chain
> blocks are byte-unchanged); §7 + §10 below scope the change explicitly.

### 5.3 Algorithms

**Carrier death → power-up drop (the scene's `_markDrop` swap, D1/D3/AC1):**
```
# replaces F4's marker-FX-only _markDrop(x, y):
kind = pickPowerUpKind(stageRng)                  # PURE uniform pick, deterministic per stage (D3)
powerups.acquire(dropX, dropY, kind)              # place a static pulsing rect at the drop window-center (D2)
effects.explosion(x, y, { big: true })            # keep the kill burst (cosmetic)
```

**Player × power-up overlap → apply (the scene's overlap callback + `_applyPowerUp`, D4/D10/AC2):**
```
# overlap(player.collider, powerups.group): on a live player tank touching a live pickup:
kind = rect.pu.kind
powerups.release(rect)                             # release() only DISABLES the body (safe in the step, D10)
_applyPowerUp(slot, kind):
  switch kind:
    helmet:  runState.shieldTimer[slot] = HELMET_SHIELD_SEC; tank.spawnIframe = HELMET_SHIELD_SEC   # reuse F3 i-frames
    clock:   runState.freezeTimer       = CLOCK_FREEZE_SEC                                            # gdt=0 next frames
    shovel:  runState.shovelTimer       = SHOVEL_FORTIFY_SEC
             delayedCall(0, () => tileMap.fortifyBaseRing(this.ringCells))   # D4a/D10 — real brick→steel seam
    star:    runState.tier[slot] = min(tier+1, MAX)
             refoldPlayerSpec(slot)  # = applyUpgrades(applyStarTier(tier[slot]), this.upgrades[slot]) — D4b
    grenade: delayedCall(0, () => for each live enemy: enemy.onHit(LETHAL))                            # D10 deferred
    tank:    runState.lives[slot] += 1
```
(`this.ringCells` = the eagle's fort-ring tile coords, derived ONCE in `create()` from `desc.base` (the
in-grid orthogonal BRICK neighbours — LevelGenerator §5.3 step 2; DRY, no generator call — D4a).
`refoldPlayerSpec(slot)` rebuilds the live tank from `applyUpgrades(applyStarTier(runState.tier[slot]),
this.upgrades[slot])` so a star COMPOSES with the Hub tree instead of stripping it — D4b.)

**Timed power-up decay + the freeze (the scene's per-frame tick, D5/AC3):**
```
runState.tickTimers(gdt0)                          # decay freeze/shovel/shield on the GAMEPLAY dt, clamped ≥0
gdt = (runState.freezeTimer > 0) ? 0 : dt          # the WIRED boundary, now DRIVEN — freeze the world (D4)
if (runState.shovelTimer just reached 0): delayedCall(0, () => tileMap.revertBaseRing())   # un-fortify on the falling edge (D4a/D10)
# enemies tick on gdt (frozen → no move/AI/fire); FX + the timer countdown read the REAL dt so the HUD ticks
```
(`tickTimers` is fed the GAMEPLAY `dt` BEFORE the freeze is applied for the frame — so the freeze timer
itself counts down in real gameplay time and the freeze ends; the reference's clock-freeze does the same.)

**GameOver banking (the scene's run-over edge, D8/AC5):**
```
# under the one-shot gameOver guard, ONCE:
banked = meta.bankRun({ score: runState.score, stage: runState.stageIndex + 1 })   # currency += floor(score·RATIO)
scene.start('GameOver', { score, stage, currencyBanked: banked,
                          bestScore: meta.getBestScore(), bestStage: meta.getBestStage() })   # the summary snapshot
```

**Hub buy (the two-column shared-bank, D9/AC6):**
```
# P1 cursor on the left column / P2 on the right; a buy edge (the player's fire key, or Space/Enter in 1P):
row = TANK_UPGRADES[cursor[slot]]
meta.buy(slot, row.id)                              # debit SHARED currency + ++upgrades[slot][id] if affordable+!maxed; SAVE
render()                                            # re-read the shared currency + the per-player owned levels
# START RUN: scene.start('Game')  — GameScene re-loads MetaState + startSpec(slot) folds each tree (AC6)
```

### 5.4 Integration points (the EXISTING seams F5 plugs into — no refactor)

- **`GameScene._markDrop(x, y)` (F4 seam):** SWAP the marker-FX body for `powerups.acquire(...)` (D1/AC1).
- **`RunState.freezeTimer` / `shovelTimer` (F4 placeholders):** now WRITTEN by clock/shovel + DECAYED by
  `tickTimers` + READ by the scene's `gdt`/fortify logic (D4/D5/AC3).
- **`GameScene.update`'s `gdt = dt` (F4 identity / freeze boundary):** now `gdt = freezeTimer > 0 ? 0 : dt`
  — the wired boundary driven (D4/AC2). FX + the HUD countdown stay on the REAL `dt` (the freeze never
  pauses the pop — the F3 Effects contract).
- **`RunState.tier[slot]` / `lives[slot]` (F4 carried maps):** star bumps `tier` + re-folds the spec; tank
  bumps `lives` (D4/AC2/AC4). The carried `tier[slot]` keeps the star up-tier across stages for free.
- **`GameScene._buildPlayer(slot,x,y)` (F4 site — CHANGED, D4b):** F4 built `new Tank(...,
  applyStarTier(tier[slot]))`. F5 changes BOTH the build site AND the mid-run star re-fold to
  `applyUpgrades(applyStarTier(runState.tier[slot]), this.upgrades[slot])`, folding the per-player Hub tree
  OVER the carried star tier — so `+maxBullets`/`+bulletSpeed`/`+tankSpeed`/`+baseArmor` reach the live tank
  AND a star power-up composes with (never strips) the Hub upgrades (the reviewer's blocking issue —
  AC6/AC2). `this.upgrades[slot]` is read ONCE in `create()` from `MetaState` (no per-frame `save.ts` touch).
- **`config/tanks.ts` `applyStarTier` (F4 fold) + `applyUpgrades` (F5 fold):** the run-START seed spec is
  `MetaState.startSpec(slot) = applyUpgrades(applyStarTier(0), upgrades[slot])` (GameScene reads its
  `startLivesBonus`/`startTier` to seed `createRunState` per slot — D5b/D7); the run-TIME tank spec is
  `applyUpgrades(applyStarTier(tier[slot]), upgrades[slot])` (the live `_buildPlayer` + star re-fold — D4b).
  F5 adds the OPTIONAL `startLivesBonus?` / `startTier?` spec fields the run-start reads (D7).
- **`util/save.ts` meta schema (F0, already verifier-swept):** `MetaState` wraps it; NO schema migration
  (D8) — the empty `upgrades` maps now hold the F5 rows' levels.
- **The scene REGISTRY (F0 HUD seam):** `GameScene` publishes lives/enemies/stage/score/currency/active
  power-up each frame; the HUD reads it (D-decoupled/AC8).
- **`Effects.explosion` + `ParticlePool` (F3):** reused for the pickup/grenade/kill bursts (DRY — no new FX).

### 5.5 The shovel seam — `TileMap.fortifyBaseRing` / `revertBaseRing` (D4a, the reviewer's blocking issue)

The shovel power-up needs a REAL brick→steel→brick swap on the eagle's fort ring, but F4's `TileMap` only
exposes `destroyBrickSubCell(col,row,subCol,subRow)` (chip one of a brick tile's 4 sub-cell bodies) and
`destroy()`. Critically, the ring is built as **SUB_CELLS² (4) independent static sub-cell bodies per tile**
by `_addBrick`, while steel is **one `TILE_SIZE` static body** built by `_addSolidTile` — so a "fortify"
cannot recolour in place; it must destroy the brick bodies and add a steel body, and revert must rebuild the
brick bodies INCLUDING any erosion the bullet feature has already chipped. F5 adds the explicit seam:

```ts
// world/TileMap.ts (Phaser-coupled — NEVER verifier-imported):
private _fortifyBodies!: Phaser.Physics.Arcade.StaticGroup        // NEW — the temporary STEEL ring bodies
private _fortifyState: Map<string, Array<[number, number]>> | null = null  // NEW — per-cell SURVIVING (subCol,subRow)

// fortifyBaseRing(cells) — for each ring tile (col,row): record the (subCol,subRow) set still present in
// _brickSubCells (0..4 — a partially-eroded ring fortifies whatever brick remains), destroy those sub-cell
// bodies via the EXISTING destroyBrickSubCell path, then add ONE TILE_SIZE STEEL static body (the
// _addSolidTile shape) into _fortifyBodies tagged by (col,row). Idempotent: if _fortifyState is non-null
// (already fortified) it is a no-op. cells = the fort-ring tile coords (GameScene derives them from desc.base).
fortifyBaseRing(cells: Array<{ col: number; row: number }>): void

// revertBaseRing() — destroy every _fortifyBodies member, then for each recorded cell REBUILD exactly the
// surviving brick sub-cell bodies (the _addBrick per-sub-cell construction, restricted to the recorded
// (subCol,subRow) set) so the pre-fortify erosion state is restored byte-for-byte. Clears _fortifyState.
// Idempotent: if _fortifyState is null (nothing fortified) it is a no-op.
revertBaseRing(): void
```

- **Erosion-lossless.** `_fortifyState` records the EXACT surviving sub-cells per ring tile at fortify time;
  `revertBaseRing` rebuilds only those, so a quarter-chipped ring reverts to a quarter-chipped ring (the
  classic shovel restores your wall as you left it — AC2/§6).
- **Reuses the existing builders.** Fortify destroys via the SAME `destroyBrickSubCell` path the bullet
  erosion uses and adds steel via the SAME `_addSolidTile` shape; revert rebuilds via the SAME `_addBrick`
  per-sub-cell construction — no new geometry, DRY.
- **Ownership split (SOLID).** `TileMap` owns the BODIES (the swap); `GameScene` owns the TIMER
  (`runState.shovelTimer`) and calls fortify on the rising edge / revert on the falling edge, both DEFERRED
  via `time.delayedCall(0)` (D10 — never destroy a body inside the overlap step).
- **Teardown.** `destroy()` also `clear(true,true)`s + destroys `_fortifyBodies` and nulls `_fortifyState`,
  so a stage rebuild while fortified leaks nothing (the existing in-place rebuild discipline).
- **Pure/coupled split holds.** `TileMap` still imports Phaser, so the verifier NEVER imports it (it moves to
  the Changed-coupled list, not the verifier path). The fortify/revert correctness is a manual drive-test
  (AC2/AC3/AC10 step 7), exactly like the rest of the Phaser-coupled body work.

---

## 6. Files

**New (PURE — node-imported by the verifier):**
- `src/config/powerups.ts` — the six power-up defs + durations + `pickPowerUpKind`.
- `src/config/tank-upgrades.ts` — the permanent upgrade rows + `applyUpgrades`.
- `src/i18n/index.ts` — `t`/`tName`/`tDesc` + `getLocale`/`setLocale`/`detectLocale` + `Dict`/`Category`.
- `src/i18n/en.ts` — the EN `ui` chrome + the `upgrade` content category (the source of truth).
- `src/i18n/zh-CN.ts` — the zh-CN `ui` + `upgrade` overrides.

**New (Phaser/persistence-coupled — NEVER verifier-imported):**
- `src/entities/PowerUp.ts` — `PowerUpPool` (the pooled static sensor pickups).
- `src/core/MetaState.ts` — `createMetaState()` (wraps `util/save.ts`) + re-exports the pure `applyUpgrades`.

**Changed (PURE):**
- `src/config/constants.ts` — ADD `CURRENCY_RATIO`.
- `src/config/tanks.ts` — `TankSpec` gains OPTIONAL `startLivesBonus?` / `startTier?` (default identity, D7).
- `src/core/RunState.ts` — ADD `shieldTimer` map + `tickTimers(dt)`; `advance()` resets the timed power-ups;
  CHANGE `createRunState` to a PER-SLOT `{ [slot]: {lives, tier} }` seed map (drops the scalar `startLives`
  arg) so each player's `+startLife`/`+starStart` lands at run start (D5b/D7). The F4 verifier §7f is
  re-pinned to the new signature (D5c — the ONLY F4 verifier edit).

**Changed (Phaser/persistence-coupled):**
- `src/scenes/GameScene.ts` — `PowerUpPool` + the player×pickup overlap + `_applyPowerUp`; `tickTimers` +
  the `gdt=0` freeze; the shovel fortify/revert via `tileMap.fortifyBaseRing(ringCells)`/`revertBaseRing()`
  (`ringCells` derived once from `desc.base` — D4a); the deferred grenade; the per-slot `createRunState` seed
  map from `MetaState.startSpec(slot)` (D5b) + the live tank spec
  `applyUpgrades(applyStarTier(tier[slot]), this.upgrades[slot])` at `_buildPlayer` + the star re-fold (D4b);
  the FULL HUD registry publish; `bankRun` + the GameOver summary on the run-over edge.
- `src/scenes/HubScene.ts` — REWRITE: the two-column P1|P2 shared-bank Hub (reads/writes `MetaState` only).
- `src/scenes/HUDScene.ts` — REWRITE: the full registry-driven overlay.
- `src/scenes/GameOverScene.ts` — REWRITE: the summary-snapshot screen → Hub.
- `src/scenes/TitleScene.ts` — inline literals → `t(...)`.
- `src/main.ts` — `setLocale(...)` at boot (one block).

**Changed (the gate):**
- `scripts/verify-gen.mjs` — ADD the F5 section (power-up/upgrade well-formedness, `applyUpgrades`
  identity + monotone-helpful, `pickPowerUpKind` determinism, the `RunState` timer decay + advance-reset);
  the F0–F4 sweep is unchanged.

**Changed (Phaser-coupled — the shovel seam, D4a):**
- `src/world/TileMap.ts` — ADD `fortifyBaseRing(cells)` + `revertBaseRing()` (brick ring ⇄ steel, lossless
  w.r.t. erosion); `destroy()` also clears the new `_fortifyBodies` group. STILL imports Phaser → NEVER
  verifier-imported (the pure/coupled split holds — §5.5).

**Unchanged / NOT touched:** `world/LevelGenerator.ts` (no new generator call — the F2/F4 regression pin
holds; the shovel's ring cells are DERIVED in `GameScene` from the existing `desc.base` fort-ring, no
generator change), `config/tiles.ts`, `config/stages.ts`, `combat/BulletPool.ts`, `effects/*`,
`core/Input.ts`, `entities/Base.ts`, `util/rng.ts`, `util/save.ts` (the schema is reused as-is — D8),
`scenes/BootScene.ts`.

---

## 7. Verification

> Every AC maps to a `typecheck`/`build`/`verify` check, a code-presence grep, or a manual `npm run dev`
> drive-test. The PURE data + folds + the `RunState` timer decay gain REAL headless assertions (the F5
> quality gate); the pickup/Hub/HUD/banking are exercised by `typecheck` + a manual drive (Phaser-coupled).

- **`npm run typecheck`** (strict, `noEmit`) — proves the new modules + the changed scenes/`RunState`/
  `TankSpec` typecheck under strict TS (AC11). Covers: the `PowerUpPool`/`MetaState`/Hub/HUD/GameOver
  shapes compile; the optional `TankSpec` fields don't break the F4 specs; the i18n `Dict`/`Category`
  types are sound; every `t(...)` call site typechecks.
- **`npm run build`** (Vite) — proves the production bundle builds offline (no `load.*`, programmer-art
  only — AC11), incl. the new scenes + the i18n layer.
- **`npm run verify`** (tsx, headless node — the F5 quality gate, AC11) — the EXISTING F0–F4 sweep stays
  green (rng pin, constants, save round-trip incl. the meta schema F5 reuses, tiles, stage monotonicity,
  the stage sweep + regression pin, the F4 roster checks, the `RunState.advance()` seed-chain check) — with
  the SINGLE exception that §7f's `createRunState` calls are RE-PINNED to the new per-slot seed-map signature
  (D5b/D5c: `createRunState(RS_SEED, {1:{lives:3,tier:0}, 2:{lives:3,tier:0}})` asserting the same fresh-state
  invariants + a new `createRunState(SEED, {1:{lives:5,tier:2}})` proving the per-slot lives/tier fold) — PLUS
  the NEW F5 section that node-imports `config/powerups.ts` + `config/tank-upgrades.ts` + the extended
  `core/RunState.ts` + the `i18n/index.ts`/`en.ts`/`zh-CN.ts` layer and asserts:
  - **Power-ups (AC1/AC2/AC11):** all six `PowerUpKind`s present in `POWERUP_KINDS`; every `PowerUpDef` is
    well-formed (numeric `color`, `durationSec ≥ 0`, the timed kinds helmet/clock/shovel have
    `durationSec > 0`); `pickPowerUpKind` returns ONLY a known kind + is deterministic for a fixed rng (two
    fresh rngs from one seed → the same kind sequence).
  - **Upgrades (AC6/AC11):** every `TankUpgrade` row well-formed (`costs.length === maxLevel`, `costs`
    MONOTONE non-decreasing); `applyUpgrades(PLAYER_BASE, {})` deep-equals a clone of `PLAYER_BASE` (the
    identity fold — a fresh meta is byte-unchanged); for each row + each level, `apply` returns a NEW
    object (referential safety) that NEVER WEAKENS the player on the field it touches (≥ base; the
    reference's never-weaker check); an unknown id + an over-`maxLevel` stored level degrade gracefully
    (skipped/clamped, no throw).
  - **`RunState` timers + the re-pinned per-slot seed (AC3/AC6/AC11):** `tickTimers(dt)` decays
    `freezeTimer`/`shovelTimer`/`shieldTimer[*]` toward 0, never below 0 (drive it past a timer's value → it
    lands at exactly 0); `advance()` RESETS the timed power-ups to 0 (set them, advance, assert 0); the
    carried `score`/`lives`/`tier` are still untouched by `tickTimers`/`advance` (the F4 D10 invariant
    holds). The re-pinned §7f (D5c) constructs `createRunState` with the NEW per-slot map and asserts the
    per-slot `lives`/`tier` seed reaches the run (a `{1:{lives:5,tier:2}}` seed yields `lives[1]===5` /
    `tier[1]===2` — the Hub `+startLife`/`+starStart` fold lands at run start, AC6).
  - **i18n dictionaries (AC9/AC11) — re-scoped to what's headlessly PROVABLE (the scenes are NOT imported,
    and there is no shared scene-key registry, so "every key the scenes use exists in en" is NOT assertable;
    this block proves the dictionary structure instead):** `i18n/index.ts` + `en.ts` + `zh-CN.ts` node-import
    cleanly (purity); `EN.ui` is non-empty; every key in `ZH_CN.ui` exists in `EN.ui` (zh is a SUBSET — no
    orphan chrome key without an en fallback source); every `upgrade` content `Entry` in BOTH locales is
    well-formed (`name`/`desc`, when present, are strings) and every id `ZH_CN.upgrade` overrides exists in
    `TANK_UPGRADES_BY_ID` (no orphan content override); the fallback chain is correct — with the live locale
    forced to `zh-CN`, `t(<an en-only key>)` returns the EN string (never blank) and `t(<absent key>)`
    returns the key verbatim (never blank/undefined), and `tName/tDesc(<id with no zh override>)` returns the
    passed-in en string. (Scene-used-key coverage is the §7 grep + the manual drive-test, not this block.)
  - **Purity re-proof (AC11):** the successful node-import of `config/powerups.ts` +
    `config/tank-upgrades.ts` + `core/RunState.ts` + `i18n/index.ts` (+ `en.ts`/`zh-CN.ts`) re-proves their
    purity (a stray `import 'phaser'` throws under node). `entities/PowerUp.ts`, `world/TileMap.ts`, the
    scenes, and `core/MetaState.ts`'s storage methods are NEVER imported by the verifier (they'd throw /
    touch `localStorage`).
- **Code-presence greps (the seams are wired):** `_applyPowerUp` + the six `case` kinds in `GameScene`;
  `powerups.acquire` in the `_markDrop` swap; `runState.tickTimers` + `freezeTimer > 0 ? 0` (the freeze
  boundary) in `update`; `fortifyBaseRing` + `revertBaseRing` in both `world/TileMap.ts` (the API) and
  `GameScene` (the calls, D4a); `applyUpgrades(applyStarTier(` in `_buildPlayer` + the star re-fold (the
  live Hub-over-star fold, D4b); `meta.bankRun` under the `gameOver` guard; `meta.buy(slot,` in the Hub;
  `meta.startSpec(` + the per-slot `createRunState({` seed map in `GameScene.create`; the P2-column
  `TWO_PLAYER` hide in the Hub + HUD; `setLocale(` in `main.ts`; `t('` at the Title/Hub/HUD/GameOver text
  sites.
- **Manual `npm run dev` drive-test (the Phaser-coupled behaviour, AC1–AC10):**
  1. **AC9/AC7** — boot: chrome renders localised (zh-CN on a zh browser); Title → Hub.
  2. **AC6** — Hub: two columns (co-op) / one column (1P, P2 hidden) on ONE currency header; buy a P1
     upgrade (P1 fire) + a P2 upgrade (P2 fire) — the shared currency drops, the per-player level rises; an
     unaffordable/maxed buy is a no-op. START RUN.
  3. **AC1/AC2/AC4** — kill a red carrier → a power-up drops; drive over each kind: helmet (the tank
     blinks invuln), clock (enemies freeze), shovel (the eagle BRICK ring turns STEEL via
     `TileMap.fortifyBaseRing`, then reverts to brick — D4a), star (the tank fires faster/more — and ON TOP
     of any Hub upgrade, the star COMPOSES with the bought stats, never strips them — D4b/AC6), grenade
     (every enemy pops), tank (a life is added). The score + lives track in the HUD.
  4. **AC3/AC10 (erosion-lossless revert)** — chip a couple of the ring's brick sub-cells with a bullet,
     THEN pick up a shovel: the chipped ring fortifies to steel; wait out `SHOVEL_FORTIFY_SEC` and the
     `revertBaseRing` restores the ring to its EXACT chipped state (the chipped quarters stay gone — D4a).
     Wait out the clock/helmet timers too: the freeze releases, the shield ends — cleanly. Clear the stage →
     the timed power-ups are gone next stage.
  5. **AC8** — the HUD shows P1 (+ P2 in co-op) lives, enemies-remaining, stage, score, currency, and the
     active power-up + its remaining seconds; the P2 line is hidden in 1P.
  6. **AC5/AC7** — lose the eagle / all lives → GameOver shows the score, stage, CURRENCY BANKED, and the
     bests; → Hub shows the banked currency (immediately spendable); reload the page → the currency + bests
     persist (a private-mode/disabled storage degrades silently — no throw).
  7. **AC10** — a grenade clearing the last enemies advances the stage without a crash (deferred teardown);
     the shovel fortify/revert never corrupts the world step.

export const meta = {
  name: 'rich-playability',
  description: 'Implement the full Tank 1990 rich-playability roadmap (13 features), each design->implement->review->one commit, sequentially',
  phases: [
    { title: 'Steel-break', detail: 'max-star tank breaks steel' },
    { title: '1UP milestones', detail: 'extra life at score thresholds' },
    { title: 'Bonus tally', detail: 'between-stage bonus screen' },
    { title: 'Ice sliding', detail: 'ice low-friction movement' },
    { title: 'Smarter AI', detail: 'eagle-rush, aimed fire, tactics' },
    { title: 'Boat + Drill', detail: 'two new power-ups' },
    { title: 'Stealth tank', detail: 'enemy concealed in trees' },
    { title: 'Difficulty select', detail: 'difficulty + start-stage on Title' },
    { title: 'Seed challenge', detail: 'shareable seed run' },
    { title: 'Music/jingle', detail: 'synthesized theme + jingle' },
    { title: 'Settings', detail: 'volume/difficulty/language screen' },
    { title: 'Touch controls', detail: 'on-screen mobile controls' },
    { title: 'Construction mode', detail: 'level editor' },
    { title: 'Polish', detail: 'sync README + CREDITS, final verify' },
  ],
}

// ── Shared, immutable repo contract every agent must obey ──
const COMMON = [
  'REPO: /Users/chencheng/Projects/tank-1990 — a Battle City / Tank 1990 clone (Phaser 3 + Vite + TypeScript). Branch: feat/rich-playability-2.',
  '',
  'HARD CONSTRAINTS (violating any is a failure):',
  '- Programmer-art ONLY: colored rectangles / Phaser Graphics / generated textures / synthesized WebAudio. NO external sprite/font/audio asset files. Must run fully offline and from file://.',
  '- PURE/COUPLED SPLIT: modules under src/config/* and src/world/LevelGenerator.ts import NOTHING from Phaser (the headless verifier npm run verify node-imports them under plain node). NEVER add a Phaser import to those files. Phaser-coupled code lives only in scenes/, entities/, world/TileMap.ts, effects/, audio/.',
  '- Shared numeric constants live ONCE in src/config/constants.ts (DRY) — do not inline duplicates.',
  '- i18n: every NEW user-facing string must be added to BOTH src/i18n/en.ts and src/i18n/zh-CN.ts and read via src/i18n (t()).',
  '- Match the existing heavy explanatory-comment style, naming, and the F-feature design-doc convention in docs/designs/.',
  '- Principles: KISS, YAGNI, DRY, SOLID. Smallest correct change. Do not gold-plate.',
  '',
  'QUALITY GATE (mandatory, non-negotiable): npm run typecheck (tsc strict) AND npm run verify (determinism + procedural-stage gate) must BOTH stay green. npm run build should also succeed.',
  'NEVER run npm run dev or vite or any long-running/watch process — they never exit and will hang you. Only run: npm run typecheck, npm run verify, npm run build, and git.',
].join('\n')

const FEATURES = [
  {
    slug: 'steel-break', title: 'Steel-break', scope: 'combat',
    commit: 'feat(combat): max-star tank breaks steel',
    goal: 'Wire the already-reserved canBreakSteel flag so a max-star (tier 3) player tank destroys whole STEEL tiles with its bullets. Currently the flag exists on the spec (config/tanks.ts) but NO bullet reads it, and _onBulletHitSolid steel branch is a no-op. Carry the firer canBreakSteel onto the bullet (combat/BulletPool.ts), and in GameScene._onBulletHitSolid, when a canBreakSteel bullet hits STEEL, destroy that steel tile (add TileMap.destroySteelTile mirroring the brick chip but whole-tile, deferred out of the overlap step per the footgun discipline). Add a small impact/break effect. Keep enemy/normal bullets unable to break steel.',
  },
  {
    slug: 'extra-life', title: '1UP milestones', scope: 'meta',
    commit: 'feat(meta): 1UP extra life at score milestones',
    goal: 'Classic 1UP: every EXTRA_LIFE_SCORE points (new constant, e.g. 20000) granted during a run, award +1 life to all present player slots, with a chime (Sound.ts) and a celebratory popup/effect. Track the next threshold on RunState so it fires once per crossing and survives stage advance. Surface a brief HUD cue. Keep verify green (RunState is pure — add a pure tested helper for threshold-crossing if it lives in core/RunState).',
  },
  {
    slug: 'stage-bonus', title: 'Bonus tally', scope: 'flow',
    commit: 'feat(flow): between-stage bonus tally screen',
    goal: 'The classic between-stage bonus screen. Track kills-by-enemy-type for the current stage on RunState (basic/fast/power/armor/boss counts, reset each stage). On EVERY stage clear (not just boss stages) show a brief tally overlay: per type count x points, plus a stage clear bonus, then proceed to the next stage curtain. Reuse the existing overlay/registry pattern (see entities/PauseOverlay.ts and the HUD banner mechanism). Make timing feel snappy (a couple seconds, skippable with fire/start). Must not break the deferred stage-advance one-shot guards.',
  },
  {
    slug: 'ice-slide', title: 'Ice sliding', scope: 'feel',
    commit: 'feat(feel): ice low-friction sliding',
    goal: 'Make ICE tiles actually slippery (the seam is reserved in TileMap.ts and tiles.ts but unused). When a tank center sits on an ICE tile, it should glide: releasing the direction key keeps it sliding ~1 tile with momentum decay instead of stopping instantly, and turns are slippery. Implement in entities/Tank.ts movement spine. CRITICAL: preserve the no-diagonal invariant (never two velocity components non-zero in one frame) and the lane-snap behavior (defer/relax the snap while sliding, re-settle when stopped). Add an ICE_FRICTION-style constant to constants.ts. Sample the tile under the body via a helper (the scene can pass the tilemap or a tile-kind query). Keep it KISS — single-axis glide only.',
  },
  {
    slug: 'smart-ai', title: 'Smarter AI', scope: 'ai',
    commit: 'feat(ai): eagle-rush cohort, aimed fire, type tactics',
    goal: 'Deepen enemy AI in entities/Tank.updateAI without adding A*. Three additions: (1) an eagle-rush cohort — a configurable fraction of enemies hard-commit to the eagle base (high seek bias toward eagle) so there is real base pressure; (2) aimed firing — an enemy only fires when roughly axis-aligned with a target (eagle or a player) within a tolerance, so shots look intentional rather than random; (3) light type-specific flavor — fast flanks/wanders more, power holds lanes and shoots aligned, armor pushes straighter toward the base. Add tunables to constants.ts. Keep the FSM intent-producer shape (no new movement path). Ensure determinism gates unaffected (AI uses runtime randomness off the seeded pin — keep it that way).',
  },
  {
    slug: 'powerups-boat-drill', title: 'Boat + Drill', scope: 'powerups',
    commit: 'feat(powerups): boat (cross water) + drill-round (pierce brick)',
    goal: 'Add TWO new power-ups to the existing 6 (config/powerups.ts + the GameScene _applyPowerUp switch + i18n + HUD timer support + pickPowerUpKind). BOAT: timed — the player tank can drive over WATER tiles for the duration (toggle a per-slot boat flag the tank-vs-water collider respects; restore on expiry). DRILL: timed — the player bullet pierces ONE brick layer and continues (carry a drill/pierce flag on the bullet like steel-break; on brick hit, chip the brick but DO NOT despawn the bullet the first time). Update the verifier-relevant pure config (powerups.ts is pure — keep it Phaser-free; the verifier asserts the power-up set is well-formed, so update any count/shape it checks consistently). Keep both well-formed for the existing verify checks.',
  },
  {
    slug: 'stealth-enemy', title: 'Stealth tank', scope: 'enemy',
    commit: 'feat(enemy): stealth tank concealed in trees',
    goal: 'Add a new enemy archetype: a STEALTH tank that is nearly invisible while sitting on/under TREES tiles (trees already render above tanks for concealment), becoming visible only when moving in the open or firing. Add a new TankSpec + behavior tag (the FSM supports tags — see config/tanks.ts; the verifier sweeps ENEMY_ARCHETYPES for well-formedness and pairwise distinctness, so make it distinct on a real stat and keep all verifier invariants green). Wire its alpha/visibility cue in entities/Tank.ts (a render-only branch, like the carrier/telegraph cues). Add it to the roster weights sensibly (stages.ts) so it appears but is not overwhelming. Keep rosterPick returning known ids and all F4 verifier checks green.',
  },
  {
    slug: 'difficulty-select', title: 'Difficulty select', scope: 'meta',
    commit: 'feat(meta): difficulty + start-stage select on Title',
    goal: 'Add a difficulty selector (Easy/Normal/Hard) and an optional starting-stage choice on the Title screen. Difficulty scales the stages.ts pressure ramps (enemy speed/spawn cadence/counts) and/or starting lives via a pure multiplier so the verifier monotonicity still holds (scale factors must keep ramps non-decreasing/bounded — verify difficulty as a pure scalar applied to the existing closed-form ramps, do not break the sweep). Persist the choice (util/save.ts pattern). Thread it into RunState/GameScene run setup. i18n both locales. Keep verify green (if you parameterize stageConfig, ensure the verifier still exercises the default and any new pure function stays monotone/bounded).',
  },
  {
    slug: 'seed-challenge', title: 'Seed challenge', scope: 'meta',
    commit: 'feat(meta): shareable seed challenge run',
    goal: 'Let the player enter (or copy) a SEED on the Title screen to play a fully reproducible run (runs are already deterministic from RunState.advance given a seed — see _mintSeed). Add a small UI to input/display the current run seed, and a way to start a run from a specified seed instead of the minted one. Persist last-used seed. Keep it KISS (numeric/hex seed). i18n both locales. No verifier changes needed beyond staying green.',
  },
  {
    slug: 'music', title: 'Music/jingle', scope: 'audio',
    commit: 'feat(audio): synthesized title theme + stage jingle',
    goal: 'Add synthesized (WebAudio, NO asset files) background music: a short looping Title theme and a stage-start jingle, plus optionally a brief game-over sting. Extend audio/Sound.ts (the single audio owner) with a tiny sequencer/oscillator melody player. Respect the existing mute (M) toggle and keep everything a safe no-op under the NoAudio path. Wire the title theme to TitleScene and the jingle to the stage curtain in GameScene. Keep it tasteful and short; do not block gameplay. Persisted mute should also silence music.',
  },
  {
    slug: 'settings', title: 'Settings', scope: 'ui',
    commit: 'feat(ui): settings screen (volume/difficulty/language)',
    goal: 'Add a Settings screen reachable from the Title (and/or pause): master volume (wire to Sound.ts), default difficulty, and a language toggle (en / zh-CN — i18n already supports both; make the active locale persistent and switchable at runtime). Persist all settings via util/save.ts (defensive try/catch, never throws). Reuse the existing overlay/scene patterns. i18n every label in both locales. Keep verify green (i18n structure check: zh-CN keys subset of en — keep them in sync).',
  },
  {
    slug: 'touch-controls', title: 'Touch controls', scope: 'input',
    commit: 'feat(input): on-screen touch controls for mobile',
    goal: 'Add on-screen touch controls (a D-pad + a fire button) for touch devices, gated so they only appear/activate on touch-capable devices (do not interfere with keyboard play on desktop). Feed them into the SAME PlayerIntent contract that core/Input.ts produces (one intent consumer — Tank.update), so no new movement path. Programmer-art primitives, camera-fixed, drawn above the playfield. Keep it P1-only (KISS) unless trivial to support P2. Ensure they pause-aware and do not leak input on resume.',
  },
  {
    slug: 'construction-mode', title: 'Construction mode', scope: 'editor',
    commit: 'feat(editor): construction mode level editor',
    goal: 'The Battle City staple: a Construction (level editor) mode reachable from the Title. Let the player paint the tile grid (cycle EMPTY/BRICK/STEEL/WATER/TREES/ICE/BASE) on a 17x17 board with the cursor/keys (and touch if easy), save the layout to localStorage (util/save.ts), and PLAY the custom map (feed a hand-authored StageDescription into GameScene instead of the procedural generator — add a clean seam so a saved grid can be loaded as the stage, reusing TileMap + the existing combat). Keep the pure generator untouched and verify green. This is the largest feature — keep the architecture clean (its own scene), reuse existing rendering/combat, and do not regress the procedural path.',
  },
]

const designPath = (slug) => 'docs/designs/2026-06-19-' + slug + '.md'

function designPrompt(f) {
  return [
    'You are a senior engineer doing the DISCOVERY + DESIGN phase (the /one-shot design step) for ONE feature of this game.',
    '',
    COMMON,
    '',
    'STEP 0 (clean baseline): cd to the repo and run: git reset --hard HEAD && git clean -fd   — this clears any leftover changes from a prior failed step so you start from the committed branch tip. (node_modules is gitignored and is preserved.)',
    '',
    'FEATURE: ' + f.title + ' [' + f.slug + ']',
    'GOAL: ' + f.goal,
    '',
    'TASKS:',
    '1. Read an existing design doc under docs/designs/ to match the house style, then read the actual source files this feature will touch (use Grep/Glob/Read) so your design is grounded in the real code (real symbol names, real seams).',
    '2. Write a CONCISE design doc (~60-130 lines) to EXACTLY this path: ' + designPath(f.slug),
    '   Include: Problem/intent; Key decisions (with rationale, KISS/DRY); Exact files to touch and what changes in each; Acceptance criteria; How it keeps npm run verify (the pure/coupled split + the determinism/monotonicity gates) green; i18n keys to add.',
    '3. Do NOT modify any source code in this step — ONLY create the design doc file.',
    '',
    'RETURN (your final message): a 5-10 line summary: the chosen approach, the exact list of files to touch, and the top acceptance criteria. This is data for the next agent, not a human message.',
  ].join('\n')
}

function implPrompt(f) {
  return [
    'You are a senior engineer doing the IMPLEMENT phase for ONE feature. A design doc already exists at: ' + designPath(f.slug),
    '',
    COMMON,
    '',
    'FEATURE: ' + f.title + ' [' + f.slug + ']',
    'GOAL: ' + f.goal,
    '',
    'TASKS:',
    '1. Read the design doc at ' + designPath(f.slug) + ' and the source files it names. Follow it, but fix it if it is wrong (the code is the source of truth).',
    '2. Implement the feature across the codebase. Match the existing heavy-comment style and naming. Honor EVERY hard constraint above (pure/coupled split, constants.ts ownership, i18n both locales, programmer-art only, offline).',
    '3. Run npm run typecheck and npm run verify. Iterate until BOTH are green. Also run npm run build to confirm it compiles. Do NOT run npm run dev / vite.',
    '4. Do NOT git commit and do NOT git reset — leave all changes in the working tree for the review/commit agent.',
    '',
    'If a verifier check needs updating because you legitimately changed a pure invariant (e.g. added a power-up kind or roster type), update the pure config consistently so the existing check passes truthfully — never weaken or delete a check to make it pass.',
    '',
    'RETURN (final message, data not prose): bullet list of files changed + what each change does, plus the FINAL status of typecheck / verify / build (PASS or FAIL with the error). Note any deviation from the design doc.',
  ].join('\n')
}

const FEATURE_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slug: { type: 'string' },
    status: { type: 'string', enum: ['committed', 'failed'] },
    commit: { type: 'string', description: 'short commit hash if committed, else empty' },
    typecheck: { type: 'boolean' },
    verify: { type: 'boolean' },
    notes: { type: 'string', description: 'one-line outcome / why failed' },
  },
  required: ['slug', 'status', 'typecheck', 'verify', 'notes'],
}

function commitPrompt(f) {
  return [
    'You are a senior REVIEWER + COMMITTER (the /one-shot review step, then the commit) for ONE feature that was just implemented in the working tree.',
    '',
    COMMON,
    '',
    'FEATURE: ' + f.title + ' [' + f.slug + ']',
    'DESIGN DOC: ' + designPath(f.slug),
    '',
    'TASKS:',
    '1. Review the change: run git status and git --no-pager diff. Critique against the design doc acceptance criteria AND the hard constraints. Specifically check: no Phaser import leaked into a pure module (config/* or world/LevelGenerator.ts); shared constants in constants.ts (no inline duplication); new user-facing strings present in BOTH en.ts and zh-CN.ts; no dead code; correctness bugs; no regression of existing one-shot/guard discipline.',
    '2. Fix every real issue you find directly in the code.',
    '3. Run npm run typecheck AND npm run verify. Both MUST be green. (Run npm run build too.) Do NOT run npm run dev.',
    '4a. IF both gates are green: stage EVERYTHING including the design doc (git add -A) and create ONE commit so design + implementation land together:  git commit -m "' + f.commit + '"  . Capture the short commit hash (git rev-parse --short HEAD).',
    '4b. IF you cannot make the gates green after a genuine effort: run git reset --hard HEAD && git clean -fd to restore a clean tree (so the next feature is not corrupted), and report status failed.',
    '',
    'Return the structured result (slug, status, commit hash, typecheck/verify booleans, one-line notes).',
  ].join('\n')
}

// ── Sequential drive: features overlap the same files, so they MUST run one-at-a-time, each building on the
// prior commit. Within a feature: design -> implement -> review+commit, each awaited (later stages read the
// design doc + working tree the earlier ones produced). No parallel()/pipeline() — that would race file edits.
const results = []
for (let i = 0; i < FEATURES.length; i++) {
  const f = FEATURES[i]
  phase(f.title)
  log('▶ [' + (i + 1) + '/' + FEATURES.length + '] ' + f.slug + ' — design')
  const design = await agent(designPrompt(f), { label: 'design:' + f.slug, phase: f.title, effort: 'high', agentType: 'general-purpose' })
  if (design == null) {
    results.push({ slug: f.slug, status: 'failed', typecheck: false, verify: false, notes: 'design agent died' })
    log('✗ ' + f.slug + ' — design agent died; skipping')
    continue
  }

  log('▶ [' + (i + 1) + '/' + FEATURES.length + '] ' + f.slug + ' — implement')
  const impl = await agent(implPrompt(f), { label: 'impl:' + f.slug, phase: f.title, effort: 'high', agentType: 'general-purpose' })
  if (impl == null) {
    results.push({ slug: f.slug, status: 'failed', typecheck: false, verify: false, notes: 'implement agent died' })
    log('✗ ' + f.slug + ' — implement agent died; next feature will reset the tree')
    continue
  }

  log('▶ [' + (i + 1) + '/' + FEATURES.length + '] ' + f.slug + ' — review + commit')
  const res = await agent(commitPrompt(f), { label: 'commit:' + f.slug, phase: f.title, effort: 'high', agentType: 'general-purpose', schema: FEATURE_RESULT })
  const r = res || { slug: f.slug, status: 'failed', typecheck: false, verify: false, notes: 'commit agent died' }
  results.push(r)
  log((r.status === 'committed' ? '✓ ' : '✗ ') + f.slug + ' — ' + r.status + (r.commit ? ' (' + r.commit + ')' : '') + ': ' + r.notes)
}

// ── Capstone polish: sync docs to whatever actually shipped, final gate, one docs commit. ──
phase('Polish')
const committed = results.filter((r) => r && r.status === 'committed').map((r) => r.slug)
const failed = results.filter((r) => !r || r.status !== 'committed').map((r) => (r ? r.slug : '?'))
log('Roadmap done — committed: ' + committed.length + '/' + FEATURES.length + (failed.length ? ' | failed: ' + failed.join(', ') : ''))

const polishPrompt = [
  'You are doing the FINAL POLISH pass after a batch of features shipped on branch feat/rich-playability-2.',
  '',
  COMMON,
  '',
  'CONTEXT: features committed this run: ' + (committed.join(', ') || 'none') + (failed.length ? ' | features that FAILED to ship: ' + failed.join(', ') : ''),
  '',
  'TASKS:',
  '1. Read git --no-pager log --oneline -20 and skim the new features. Update README.md so its feature list and the Controls table reflect what actually shipped (new power-ups, difficulty/seed/settings/touch/editor, music, etc). Update CREDITS.md only if relevant. Keep README accurate — do not document features that FAILED to ship.',
  '2. Run npm run typecheck, npm run verify, and npm run build — all must be green. If something is red, fix the smallest thing to restore green (or report clearly if it is a shipped-feature regression).',
  '3. Commit the doc sync (and any tiny green-restoring fix) as ONE commit: git add -A && git commit -m "docs(rich-playability): sync README + CREDITS for shipped features". If there is nothing to change and the tree is clean, skip the commit.',
  '',
  'RETURN: a short final report — which features shipped, final typecheck/verify/build status, and anything left unfinished.',
].join('\n')

const finalReport = await agent(polishPrompt, { label: 'polish', phase: 'Polish', effort: 'high', agentType: 'general-purpose' })

return {
  shipped: committed,
  failed,
  perFeature: results,
  finalReport,
}

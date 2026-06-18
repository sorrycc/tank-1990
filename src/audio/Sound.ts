import type Phaser from 'phaser'

// ── Procedural SFX façade (F6 Boss & co-op polish §5.5, Decisions D6/D7/D8, AC6) ──
// The audio twin of effects/Effects.ts: ONE semantic call per event (sound.fire(), sound.explosion({big}))
// with all the WebAudio synthesis hidden behind it (SOLID). The SCENE's resolution sites never touch the
// audio graph — they call a named method, exactly as the visual juice façade is called at every impact (D6:
// audio is wired at the scene, the event orchestrator, NOT inside the entities). The project ships NO audio
// assets (programmer-art primitives only), so every sound is SYNTHESIZED at runtime from OscillatorNodes + a
// short noise buffer through gain envelopes — the audio equivalent of "colored rectangles", ZERO assets, no
// `load.*` calls (AC6). Ported VERBATIM IN SHAPE from the read-only `dead-cell` reference's audio/Sound.ts
// (its Decisions 1–7) + TRIMMED to Tank 1990's events (YAGNI — the reference's swing/parry/wall-jump/flask/…
// are OMITTED; Tank 1990 has no melee/parry/wall-jump).
//
// CONTEXT SOURCE (D7, the reference's Decision 1): we reuse Phaser's ONE shared AudioContext
// (scene.sound.context) rather than newing our own — Phaser owns a single WebAudioSoundManager across all
// scenes and already resumes it on the first user gesture (the Title requires a click/key to advance, so the
// context is running before any gameplay sound plays). scene.sound.mute/.volume integrate for free.
// FALLBACK (AC6): under a NoAudioSoundManager (headless / `verify` / a NoAudio browser) there is no `.context`
// → we store ctx = null and EVERY method early-returns. The whole class is then a safe silent no-op that never
// throws — so a scene constructed without WebAudio behaves identically. NEVER imported by the verifier (it
// touches WebAudio — Phaser-coupled, AC10).
//
// SCHEDULING (the reference's Decision 5): every sound schedules on the WebAudio clock (ctx.currentTime), NOT
// the gameplay dt — so the fire "pew" / clear flourish is audible even during the run-end freeze beat (mirrors
// how Effects runs on real dt while the world is frozen). No coupling to any gameplay timer.
//
// ALLOCATION: each sound makes a handful of short-lived OscillatorNode/GainNode/noise nodes that auto-disconnect
// on `stop` and are GC'd — no steady-state churn (the fire-and-forget shape ParticlePool's transients have). A
// per-key throttle (_gateOk) collapses a multi-hit frame (e.g. several bricks chipped at once, or a busy boss
// volley) into ONE transient so stacked sounds never pile up (the reference's Decision 6 pile-up guard).

// ── Master level + soft headroom (the reference's Decision 4) ── one master GainNode per instance → destination,
// base level kept well under 1 so several transients in one frame don't clip. Multiplied by the live Phaser
// global volume each sound, and skipped entirely when muted.
const MASTER_GAIN = 0.32 // base master level (× scene.sound.volume per sound).
const THROTTLE_GAP = 0.03 // s — per-key min interval on the WebAudio clock (the pile-up guard).

// A minimal AudioContext shape — we only ever touch this subset. Typed locally so the file needs no lib.dom
// WebAudio ambient beyond what TS already provides (AudioContext is a DOM global).
type Ctx = AudioContext

// Tone params for the _tone primitive (an oscillator → gain envelope, optional linear freq sweep).
interface ToneOpts {
  freq: number // start frequency (Hz).
  type?: OscillatorType // 'sine' | 'square' | 'sawtooth' | 'triangle' (default 'square').
  dur?: number // total duration (s) — the gain decays to ~0 over it.
  gain?: number // peak gain (pre-master) — scaled by MASTER_GAIN × global volume.
  sweepTo?: number // optional end frequency (Hz) — a linear ramp from freq over dur.
  delay?: number // optional start offset (s) from now — for layering/flourishes.
  attack?: number // optional attack time (s) before the exponential decay (default tiny).
}

// Noise params for the _noise primitive (a white-noise buffer → biquad filter → gain envelope).
interface NoiseOpts {
  dur?: number // duration (s).
  gain?: number // peak gain (pre-master).
  type?: BiquadFilterType // filter type ('lowpass' | 'highpass' | 'bandpass'); default 'lowpass'.
  freq?: number // filter cutoff/center (Hz).
  delay?: number // optional start offset (s) from now.
}

export class Sound {
  private sm: Phaser.Sound.BaseSoundManager
  private ctx: Ctx | null
  private master: GainNode | null
  private _last: Record<string, number> // per-key throttle stamps on the ctx clock (the reference's Decision 6).

  // scene: any Phaser.Scene (every scene shares Phaser's ONE sound manager / context). We grab the WebAudio
  // context off the manager; if it's absent (NoAudio) the whole façade no-ops (AC6).
  constructor(scene: Phaser.Scene) {
    this.sm = scene.sound
    // WebAudio only: NoAudioSoundManager lacks `.context`. Guard on createOscillator so a half-shaped / stubbed
    // manager (e.g. a test double) still degrades to silence rather than throwing later.
    const ctx = (this.sm as unknown as { context?: Ctx }).context ?? null
    this.ctx = ctx && typeof ctx.createOscillator === 'function' ? ctx : null
    this.master = this.ctx ? this.ctx.createGain() : null
    if (this.master && this.ctx) this.master.connect(this.ctx.destination)
    this._last = {}
  }

  // ── Mute proxy (D8, the reference's Decision 7) ── reads/writes Phaser's GLOBAL mute (game.sound.mute) so the
  // M toggle flips audio everywhere at once (and a Phaser-level mute is respected automatically — every sound
  // checks `this.sm.mute` before playing). KISS: the façade owns no separate mute flag (the runtime-only toggle
  // the brief asks; persisting it would need a save-schema field — YAGNI, D8).
  get mute(): boolean {
    return this.sm.mute
  }
  set mute(v: boolean) {
    this.sm.mute = v
  }

  // ── _gateOk(key, minGap) ── the shared guard EVERY semantic method calls first: returns false (so the method
  // bails to silence) when there is no WebAudio context (AC6), Phaser is muted (AC6), OR the same key fired within
  // `minGap` seconds (the throttle — collapses a multi-hit frame into one transient). When it returns true it
  // stamps the ctx-clock time for the next call.
  private _gateOk(key: string, minGap = THROTTLE_GAP): boolean {
    if (!this.ctx || !this.master || this.sm.mute) return false
    const now = this.ctx.currentTime
    const last = this._last[key] ?? -Infinity
    if (now - last < minGap) return false
    this._last[key] = now
    return true
  }

  // ── _tone(o) (the reference's Decision 3) ── an OscillatorNode → its own GainNode (a short attack + exponential
  // decay to silence, optional linear frequency sweep) → master. Fire-and-forget: scheduled on the ctx clock and
  // auto-stopped, so it disconnects + GCs on its own (no pooling needed for a <1s transient). Caller MUST have
  // passed _gateOk first (so ctx/master are non-null here).
  private _tone(o: ToneOpts): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.12
    const attack = Math.min(o.attack ?? 0.004, dur * 0.5)
    const peak = (o.gain ?? 0.5) * MASTER_GAIN * this.sm.volume
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = o.type ?? 'square'
    osc.frequency.setValueAtTime(o.freq, t0)
    if (o.sweepTo != null) osc.frequency.linearRampToValueAtTime(o.sweepTo, t0 + dur)
    // Envelope: ramp up over the (tiny) attack, then exponential decay to a near-zero floor (an exponential ramp
    // can't reach exactly 0, so we target a small epsilon for a clean tail).
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  // ── _noise(o) (the reference's Decision 3) ── a small white-noise buffer → a BiquadFilter (shapes it: a lowpass
  // thud, a highpass hiss) → a GainNode envelope → master. Used for impacts/explosions where a pure tone reads too
  // "clean". The buffer is allocated per call (a few hundred samples) and GC'd with the source — fine for a
  // transient (no steady-state churn, just short-lived nodes).
  private _noise(o: NoiseOpts): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.12
    const peak = (o.gain ?? 0.4) * MASTER_GAIN * this.sm.volume
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1 // white noise (cosmetic — off Math.random).
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = o.type ?? 'lowpass'
    filter.frequency.setValueAtTime(o.freq ?? 1200, t0)
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master!)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  // ── Semantic SFX (one method per event, AC6) ── each early-returns via _gateOk (no ctx / muted / throttled →
  // silence), then composes the two primitives into a distinct timbre so the classic events read by ear.

  // fire — a short bright "pew": a quick downward square sweep (a tank shot). Wired at ALL THREE fire sites
  // (P1/P2/enemy) through the scene's tryFire boolean (D6); the throttle collapses a same-frame multi-shot.
  fire(): void {
    if (!this._gateOk('fire')) return
    this._tone({ freq: 720, type: 'square', dur: 0.1, gain: 0.26, sweepTo: 240 })
    this._noise({ dur: 0.04, gain: 0.14, type: 'highpass', freq: 2600 }) // the muzzle crack.
  }

  // brickHit — a dry low crunch (filtered-noise thud) when a bullet chips brick.
  brickHit(): void {
    if (!this._gateOk('brickHit')) return
    this._noise({ dur: 0.08, gain: 0.34, type: 'lowpass', freq: 520 })
    this._tone({ freq: 180, type: 'square', dur: 0.06, gain: 0.14, sweepTo: 90 })
  }

  // steelClink — a bright metallic "tink" (a high noise blip + a high tone) when a bullet glances off steel.
  steelClink(): void {
    if (!this._gateOk('steelClink')) return
    this._noise({ dur: 0.05, gain: 0.26, type: 'bandpass', freq: 3200 })
    this._tone({ freq: 1800, type: 'sine', dur: 0.08, gain: 0.18, sweepTo: 2400 })
  }

  // explosion(opts?) — a noise thud (a tank/base/kill burst). LOUDER + LONGER for a `big` burst (a tank/base
  // kill) vs a small spark (a brick chip / bullet-vs-bullet). One method, two strengths (DRY).
  explosion(opts: { big?: boolean } = {}): void {
    if (!this._gateOk('explosion')) return
    const big = !!opts.big
    this._noise({ dur: big ? 0.3 : 0.12, gain: big ? 0.5 : 0.28, type: 'lowpass', freq: big ? 420 : 700 })
    this._tone({ freq: big ? 160 : 240, type: 'sawtooth', dur: big ? 0.26 : 0.1, gain: big ? 0.3 : 0.16, sweepTo: big ? 50 : 90 })
  }

  // powerUp — an ascending "gained" blip when a player walks over a power-up (every kind).
  powerUp(): void {
    if (!this._gateOk('powerUp')) return
    this._tone({ freq: 560, type: 'square', dur: 0.12, gain: 0.24, sweepTo: 1100 })
  }

  // oneUp — a three-note rising chime, layered ON TOP of powerUp for the `tank` (+1 life) pickup (the classic
  // 1-up jingle). A distinct key so it isn't throttled against the same-frame powerUp().
  oneUp(): void {
    if (!this._gateOk('oneUp', 0.2)) return
    this._tone({ freq: 660, type: 'square', dur: 0.12, gain: 0.26 }) // E5
    this._tone({ freq: 880, type: 'square', dur: 0.12, gain: 0.26, delay: 0.1 }) // A5
    this._tone({ freq: 1320, type: 'square', dur: 0.22, gain: 0.26, delay: 0.2, sweepTo: 1480 }) // E6 + a lift.
  }

  // bossSpawn — a low ominous swell so the capstone announces itself (the reference's bossSpawn, in shape).
  bossSpawn(): void {
    if (!this._gateOk('bossSpawn', 0.2)) return
    this._tone({ freq: 60, type: 'sawtooth', dur: 0.7, gain: 0.4, sweepTo: 140 })
    this._tone({ freq: 90, type: 'square', dur: 0.6, gain: 0.18, sweepTo: 70, delay: 0.05 })
    this._noise({ dur: 0.5, gain: 0.16, type: 'lowpass', freq: 240 })
  }

  // stageCleared — a short ascending win flourish (a three-note "win" arpeggio) for the STAGE-N-CLEARED banner.
  stageCleared(): void {
    if (!this._gateOk('stageCleared', 0.2)) return
    this._tone({ freq: 440, type: 'square', dur: 0.16, gain: 0.3 }) // A4
    this._tone({ freq: 660, type: 'square', dur: 0.16, gain: 0.3, delay: 0.12 }) // E5
    this._tone({ freq: 880, type: 'square', dur: 0.3, gain: 0.3, delay: 0.24, sweepTo: 990 }) // A5 + a lift.
  }

  // gameOver — a low descending knell when the run ends (the eagle falls / all lives spent).
  gameOver(): void {
    if (!this._gateOk('gameOver', 0.2)) return
    this._tone({ freq: 320, type: 'sawtooth', dur: 0.6, gain: 0.4, sweepTo: 50 })
    this._tone({ freq: 160, type: 'square', dur: 0.5, gain: 0.2, sweepTo: 40, delay: 0.04 })
  }

  // uiSelect — a brighter confirm blip for the Title's start gesture (the menu blip; reused from the reference).
  uiSelect(): void {
    if (!this._gateOk('uiSelect', 0.02)) return
    this._tone({ freq: 660, type: 'square', dur: 0.08, gain: 0.24, sweepTo: 990 })
  }
}

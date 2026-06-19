# P2 fire: dual-bind Shift (+ Numpad0) so MacBooks work

## 1. Background

P2's fire key is bound to `Numpad0` (`src/core/Input.ts:92`), and the Hub's P2
"buy" reuses the same key (`src/scenes/HubScene.ts:119`). MacBook keyboards have
no numeric keypad, so in 2-player co-op a MacBook P2 cannot fire or buy upgrades.

## 2. Requirements Summary

- **Goal:** Give P2 a fire/buy key that exists on a laptop, without removing the
  numpad binding that already works on full keyboards.
- **Scope:** Add `Shift` (either side) as an ALTERNATE P2 fire key and an
  alternate Hub P2 buy key. Keep `Numpad0`. Update the control-reference labels.
- **Out of scope:** P1 controls, touch controls, any new key for solo play.
- **Key decisions (locked with user before this doc):**
  - Bind `Shift` (both sides) — Phaser 3.90 `KeyCodes` has no `RIGHT_SHIFT`
    (only `SHIFT: 16`), so isolating right-Shift would need a raw
    `event.code === 'ShiftRight'` listener, breaking the single-owner `addKeys`
    pattern. Both-Shift is harmless: P1 uses WASD+J and never presses Shift in play.
  - Dual-bind (Shift OR Numpad0), not replace.
  - Label token: `Shift / Numpad0`.

## 3. Acceptance Criteria

1. In co-op, pressing EITHER Shift fires P2's tank, exactly once per press
   (JustDown edge — no auto-repeat while the key is held).
2. `Numpad0` still fires P2 (unchanged for full keyboards).
3. In the Hub co-op screen, `Shift` OR `Numpad0` buys P2's selected upgrade.
4. P1 is byte-identical (no `p1FireAlt`); no new conflict with WASD / J / arrows
   / M / P / ESC / SPACE / ENTER.
5. Control labels read `Shift / Numpad0`: Title controls reference (en + zh
   `controls.p2Fire.keys`), Hub co-op footer (en + zh), and README controls table.
6. `npm run typecheck` passes.

## 4. Problem Analysis

- **Approach A — replace Numpad0 with a single laptop key.** Simplest, but drops
  full-keyboard users who already use Numpad0. Rejected: user chose dual-bind.
- **Approach B — isolate right-Shift via a raw `event.code` listener.** Lets the
  label say literally "Right Shift", but Input is the single owner of bindings via
  `addKeys` (keyCode-based) and owns the JustDown edge discipline. A side-channel
  raw listener with its own edge tracking duplicates that and invites bugs.
  Rejected for KISS / single-owner.
- **Chosen — add an optional alternate fire key per player.** `addKeys` gains
  `p2FireAlt: SHIFT`. `readPlayer` ORs a second JustDown when an alt key exists.
  P1 has no alt → its path is unchanged. The Hub adds a parallel
  `keydown-SHIFT` handler beside the existing `keydown-NUMPAD_ZERO`. Minimal,
  stays inside the existing single-owner design, DRY across run + Hub.

## 5. Decision Log

**1. Which physical key for the laptop P2 fire?**
- Options: A) `/` slash · B) `Shift` (both sides) · C) `.` period · D) Right Shift only
- Decision: **B)** — user-selected. Phaser can't cleanly isolate right-Shift
  (`KeyCodes.SHIFT` = 16 for both), and both-Shift is conflict-free since P1
  never uses Shift. The 5x-Shift OS sticky-keys prompt is the known tradeoff.

**2. Replace Numpad0, or keep both?**
- Options: A) replace · B) dual-bind
- Decision: **B)** — user-selected. Full-keyboard users keep Numpad0; laptops gain Shift.

**3. How to add the second key without forking `readPlayer`?**
- Options: A) optional `${prefix}FireAlt` key OR'd in · B) fire-keys-as-array · C) duplicate readPlayer for p2
- Decision: **A)** — one optional key, one OR. B/C are YAGNI/duplication. Both
  JustDowns are read every frame (no short-circuit) so neither key's internal
  `_justDown` flag latches — the same discipline the pause edges already use.

**4. Label wording across the table vs. the footer, en vs. zh.**
- Options: A) one identical token everywhere · B) preserve each string's existing token convention, prepend `Shift / `
- Decision: **B)** — today zh's controls table already uses literal `Numpad0`
  (`zh-CN.ts:56`) while its footer uses localized `小键盘0` (`zh-CN.ts:72`).
  Preserve each context and prepend `Shift / `. en table/footer + README use
  `Shift / Numpad0` / `Shift / Numpad 0` matching their existing token.

## 6. Design

### Input.ts (single owner of bindings + the fire edge)

Add one key to `addKeys`:

```ts
// P2 — arrow move + Numpad0 fire, with Shift as a laptop-friendly ALT (D1/D2).
p2Fire: KC.NUMPAD_ZERO,
p2FireAlt: KC.SHIFT,
```

`readPlayer` ORs an optional alternate fire key. Both JustDowns are read every
frame so neither latches (the pause-edge discipline, Input.ts:108–116):

```ts
const fireMain = Phaser.Input.Keyboard.JustDown(k[`${prefix}Fire`])
const altKey = k[`${prefix}FireAlt`]
const fireAlt = altKey ? Phaser.Input.Keyboard.JustDown(altKey) : false
const firePressed = fireMain || fireAlt
```

P1 has no `p1FireAlt`, so `altKey` is undefined → `fireAlt` is `false` and
`JustDown` is never called for P1 → P1 path byte-identical (AC4).

The `const fireAlt = ...` extraction is load-bearing: it MUST be computed into
its own `const` BEFORE the `||`. Do NOT "tidy" it to
`fireMain || JustDown(altKey)` — `||` short-circuits, so when `fireMain` is true
the alt `JustDown` would be skipped, leaving the alt key's internal `_justDown`
flag latched. The next frame it would read as a fresh edge and the key would fire
twice / repeat — breaking the once-per-press edge (AC1). Both JustDowns must run
every frame, exactly like the pause edges at Input.ts:108–116.

### HubScene.ts (P2 buy reuses the run's fire keys, DRY)

In the `TWO_PLAYER` branch, add a parallel handler beside the numpad one:

```ts
kb.on('keydown-NUMPAD_ZERO', () => this._buy(2)) // full-keyboard P2 buy.
kb.on('keydown-SHIFT', () => this._buy(2))       // laptop P2 buy (run's alt fire key — DRY).
```

`keydown-SHIFT` is the standard Phaser event name (same convention as the
existing `keydown-W` / `keydown-NUMPAD_ZERO`), fires on either Shift.

Both P2 buy handlers (`keydown-NUMPAD_ZERO` and the new `keydown-SHIFT`) go ONLY
inside the existing `if (TWO_PLAYER)` branch (HubScene.ts:116–119), beside the P2
arrow-nav handlers — NEVER in the solo `else` branch (:120–125). Shift therefore
stays completely inert in solo play (no P2 column exists), and no stray solo
binding is introduced.

### Labels

- en `controls.p2Fire.keys`: `Numpad0` -> `Shift / Numpad0`
- en `hub.footerCoop`: `Numpad0 buy` -> `Shift / Numpad0 buy`
- zh `controls.p2Fire.keys`: `Numpad0` -> `Shift / Numpad0`
- zh `hub.footerCoop`: `小键盘0 购买` -> `Shift / 小键盘0 购买`
- README controls table: `Numpad 0` -> `Shift / Numpad 0`

Layout: Title controls keys render left-anchored at `LEFT_CX+14 ≈ 144`; the
hi-score column starts ~490 — room to spare. Hub footer is centered on a 1280px
canvas — the ~6 extra chars do not overflow.

### Comments

Update the binding-describing comments to reflect the dual-bind (identified by
content, not line number — numbers drift as edits land):

- Input.ts — the sole-JustDown-owner header comment that enumerates the fire keys
  as "J / NUMPAD_ZERO": add SHIFT so the sole-owner list is complete.
- Input.ts — the P2 binding comments ("P2 — arrow move + Numpad0 fire" and
  "P2 fire = NUMPAD_ZERO ... avoiding the sticky-keys '/'+RShift trap"): note Shift
  is now the laptop-friendly ALT; the sticky-keys remark stays relevant (Shift is
  exactly that key) so keep it.
- HubScene.ts — the header + wiring comments describing "P2 ... buys with Numpad0":
  add Shift as the parallel laptop buy key.
- TitleScene.ts — the header comment listing "P2 = arrows + Numpad0": add Shift.
- i18n/index.ts — the comment listing the P2 token ("arrows move · Numpad0 fire"):
  add Shift.

## 7. Files Changed

- `src/core/Input.ts` — add `p2FireAlt: KC.SHIFT`; OR an optional alt fire
  JustDown in `readPlayer`; update binding comments.
- `src/scenes/HubScene.ts` — add `keydown-SHIFT -> _buy(2)` in the co-op branch;
  update comments.
- `src/i18n/en.ts` — `controls.p2Fire.keys` + `hub.footerCoop` tokens.
- `src/i18n/zh-CN.ts` — `controls.p2Fire.keys` + `hub.footerCoop` tokens.
- `README.md` — controls table fire row.
- `docs/designs/2026-06-19-p2-fire-shift.md` — this doc.

## 8. Verification

1. [AC1] Co-op run: tap Left Shift and Right Shift — P2 tank fires once each;
   hold Shift — fires once, no machine-gun.
2. [AC2] Co-op run: press Numpad0 (or external numpad) — P2 still fires.
3. [AC3] Hub co-op: select a P2 upgrade, press Shift — it buys; press Numpad0 — it buys.
4. [AC4] Solo + co-op: P1 fires only on J; pressing Shift never fires/affects P1.
   No regression on M / P / ESC / SPACE / ENTER / arrows / WASD.
5. [AC5] Title shows `P2 FIRE  Shift / Numpad0`; Hub co-op footer shows
   `Shift / Numpad0 buy` (en) / `Shift / 小键盘0 购买` (zh); README updated.
6. [AC6] `npm run typecheck` passes.

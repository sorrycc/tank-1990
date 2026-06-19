// ── 简体中文 (zh-CN) dictionary — F5 §5.2, Decision D12, AC9 ───────────────────────────────────────────────
// UI chrome (`ui`) + the ONE content category override (`upgrade` — the permanent tank-upgrade name/desc,
// keyed by each row's stable `id` in config/tank-upgrades.ts). Any missing key falls back to English
// (i18n/index.ts: zh → en → key). config/* keeps English as the source of truth — these are overrides only.
//
// The verifier asserts (AC9): every key in ZH_CN.ui exists in EN.ui (no orphan chrome key without an EN
// fallback source); every `upgrade` id here exists in TANK_UPGRADES_BY_ID (no orphan content override); each
// `upgrade` Entry's name/desc (when present) is a string. Keyboard tokens (WASD, SPACE, ENTER, J, Numpad0)
// stay literal — they name physical keys, not translatable words.

import type { Dict } from './index.js'

export const ZH_CN: Dict = {
  ui: {
    // ── 标题 ──
    'title.heading': 'TANK 1990',
    'title.subtitle': '坦克大战 — Battle City',
    'title.start': '按 SPACE / ENTER 或点击开始',
    'title.best': '最高分数 {score} · 最高关卡 {stage}', // F7 (D6/AC6) — 标题界面的最佳成绩行。

    // ── 高分榜（持久化的前 5 名战绩 — 标题界面 + 游戏结束，D6）── 标题、行模板（名次 · 分数 · 关卡）、空状态行。
    'hi.title': '高分榜',
    'hi.row': '{rank}. {score} · 关卡 {stage}',
    'hi.empty': '暂无战绩 — 来争第一吧！',

    // ── 操作说明（F6 §5.2, D9, AC7 — 标题界面的双人按键参考）── 动作名翻译，按键 TOKEN（WASD/J/Numpad0/SPACE/
    // ENTER/M）保持原文（它们指代物理按键，按键绑定由 core/Input.ts 拥有，这里只是可读的镜像）。
    'controls.title': '操作说明',
    'controls.p1Move': 'P1 移动',
    'controls.p1Move.keys': 'W A S D',
    'controls.p1Fire': 'P1 开火',
    'controls.p1Fire.keys': 'J',
    'controls.p2Move': 'P2 移动',
    'controls.p2Move.keys': '方向键',
    'controls.p2Fire': 'P2 开火',
    'controls.p2Fire.keys': 'Numpad0',
    'controls.start': '开始',
    'controls.start.keys': 'SPACE / ENTER',
    'controls.mute': '静音',
    'controls.mute.keys': 'M',

    // ── 大厅（双列共享货币升级大厅 — D9）──
    'hub.title': '大厅',
    'hub.currency': '货币 {n}',
    'hub.p1': '玩家 1',
    'hub.p2': '玩家 2',
    'hub.lv': '等级 {owned}/{max}',
    'hub.max': '已满',
    'hub.cost': '{cost}',
    'hub.start': '开始游戏',
    'hub.best': '最高分数 {score} · 最高关卡 {stage}', // F7 (D6/AC6) — 货币标题旁的最佳成绩行。
    'hub.footerCoop': 'P1：WASD 移动 · J 购买  |  P2：方向键移动 · 小键盘0 购买  |  SPACE/ENTER：开始游戏',
    'hub.footerSolo': 'WASD / 方向键：选择 · J / SPACE：购买  |  SPACE / ENTER：开始游戏',

    // ── HUD（并行覆盖层 — D8）──
    'hud.stage': '关卡 {n}',
    'hud.score': '分数 {n}',
    'hud.currency': '货币 {n}',
    'hud.enemies': '剩余敌人 {n}',
    'hud.p1Lives': 'P1 生命 {n}',
    'hud.p2Lives': 'P2 生命 {n}',
    'hud.power': '道具 {name} {secs}秒',
    'hud.powerInstant': '道具 {name}',
    'hud.stageCleared': '关卡 {n} 通关', // F6 (D5, AC3) — Boss 关通关横幅（定时覆盖层）。
    'hud.stageIntro': '关卡 {n}', // (D3/D5, AC2) — 每关开始前居中显示的 STAGE-N 开场幕布。
    'hud.muted': '已静音', // F6 (D8, AC6) — 静音时的提示（M 键切换）。
    'hud.oneUp': '额外生命', // (extra-life, D5, AC5/AC6) — 跨越分数里程碑时居中显示的 1UP 提示。

    // ── 游戏结束（结算快照 — AC5）──
    'over.heading': '游戏结束',
    'over.score': '分数 {n}',
    'over.stage': '到达关卡 {n}',
    'over.banked': '存入货币 {n}',
    'over.bestScore': '最高分数 {n}',
    'over.bestStage': '最高关卡 {n}',
    'over.continue': '按 SPACE / ENTER 或点击继续',

    // ── 暂停覆盖层（F7 §5.3, D3/D9, AC4 — 只读的冻结面板：标题、本局摘要、恢复提示）──
    'pause.title': '已暂停',
    'pause.run': '本局',
    'pause.stage': '关卡',
    'pause.score': '分数',
    'pause.enemies': '剩余敌人',
    'pause.p1Lives': 'P1 生命',
    'pause.p2Lives': 'P2 生命',
    'pause.help': '按 P / ESC 恢复游戏',

    // ── 道具名称（HUD 当前道具 — AC2/AC8）──
    'power.helmet': '护盾',
    'power.clock': '冻结',
    'power.shovel': '加固',
    'power.star': '升级',
    'power.grenade': '炸弹',
    'power.tank': '加命',
  },

  // ── 升级条目内容覆盖（按 TANK_UPGRADES 行的 id 键控）── tName/tDesc('upgrade', id, en) 读取这里；缺失则回退到
  // config/tank-upgrades.ts 的英文源串。每个 id 必须存在于 TANK_UPGRADES_BY_ID（验证器断言无孤立覆盖 — AC9）。
  upgrade: {
    maxBullets: { name: '+弹药上限', desc: '每级 +1 同屏子弹' },
    bulletSpeed: { name: '+子弹速度', desc: '每级 +60 子弹速度' },
    tankSpeed: { name: '+坦克速度', desc: '每级 +16 移动速度' },
    startLife: { name: '+初始生命', desc: '每级 +1 初始生命' },
    baseArmor: { name: '基础护甲', desc: '每级 +1 初始血量' },
    starStart: { name: '初始星级', desc: '每级提升开局星级' },
  },
}

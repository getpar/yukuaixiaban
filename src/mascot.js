/**
 * 鱼快下班 · 吉祥物「大肥鱼」
 * ---------------------------------------------------------------------------
 * 原创 SVG 插画 + 7 档情绪 + 待机微动画 + 点击互动。灵感来自「上班摸鱼 / 大肥鱼」
 * 的社区梗，全部图形由本文件内的路径手绘，不使用任何官方素材、位图或网络字体。
 *
 * 设计约束：
 * - 模块顶层不访问 document / window，保证 Node 里可以直接 import 做单测。
 * - 表情、姿态、动效全部由 mascot.css 通过根元素 data-state / class 驱动。
 * - 本文件只负责：注入内联 SVG、维护状态与随机调度、给出文案。
 *
 * 导出契约（app.js 依赖，签名不可改）：
 *   STATES          string[]                       七档状态名（顺序固定）
 *   stateFor        (phase, progress) => state     根据班次阶段 / 进度取状态
 *   createMascot    (container) => handle          注入 SVG，返回控制句柄
 *   QUOTES          Record<state, string[]>        每档 3-5 句中文摸鱼吐槽
 *   quoteFor        (state, nonce) => string       同一 nonce 稳定返回同一句
 *
 * 句柄（比 v1 多出 setLook / poke，其余不变）：
 *   { setState(state), setMotion({reduceMotion}), setLook(nx, ny), poke(), destroy() }
 */

/** 七档情绪，顺序与开发文档 §6.3 一致。 */
export const STATES = ['sleep', 'slouch', 'soulless', 'reviving', 'hopeful', 'sprint', 'celebrate'];

/* -------------------------------------------------------------------------- */
/* 状态机                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 班中进度分段：区间取「左闭右开」。
 * 0%–15% 鱼饼瘫 / 15%–40% 灵魂出窍 / 40%–65% 逐渐回魂 / 65%–85% 眼里有光 / 85%+ 归心似箭
 * 例：0.149 -> slouch，0.15 -> soulless，0.85 -> sprint。
 */
const WORKING_BANDS = [
  [0.15, 'slouch'],
  [0.4, 'soulless'],
  [0.65, 'reviving'],
  [0.85, 'hopeful'],
  [Infinity, 'sprint'],
];

/**
 * 根据班次阶段与当天进度决定情绪。
 * @param {'before'|'working'|'after'|string} phase 班次阶段
 * @param {number} progress 当天工作进度 0–1（上班前为 0，下班后为 1）
 * @returns {string} STATES 中的状态名
 */
export function stateFor(phase, progress) {
  const stage = typeof phase === 'string' ? phase.trim().toLowerCase() : '';
  if (stage === 'before') return 'sleep';
  if (stage === 'after') return 'celebrate';

  // 'working' 以及任何未知阶段都按班中进度处理
  const ratio = clamp01(progress);
  for (let i = 0; i < WORKING_BANDS.length; i += 1) {
    if (ratio < WORKING_BANDS[i][0]) return WORKING_BANDS[i][1];
  }
  return 'sprint';
}

/** 把任意输入收敛成 STATES 中的合法状态名，非法返回 null。 */
function normalizeState(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return STATES.indexOf(key) === -1 ? null : key;
}

/** 进度夹到 [0, 1]，非法值按 0 处理。 */
function clamp01(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

/** 视线输入夹到 [-1, 1]。 */
function clampSigned(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= -1) return -1;
  if (num >= 1) return 1;
  return num;
}

/** FNV-1a 32 位哈希：稳定、无随机数，便于测试复现。 */
function hashString(input) {
  const text = String(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* -------------------------------------------------------------------------- */
/* 文案                                                                        */
/* -------------------------------------------------------------------------- */

/** 每档 4-5 句摸鱼吐槽，由 app.js 按 20 秒节奏轮换，poke() 也会随机返回一句。 */
export const QUOTES = {
  sleep: [
    '再睡五分钟……就五分钟……',
    '闹钟你先忙，我还没开机。',
    '梦里不用打卡，梦里全是自由。',
    '别叫醒我，我还没开始上班呢。',
  ],
  slouch: [
    '工位好硬，人生好难。',
    '刚坐下就已经开始想下班了。',
    '我现在的状态：一张会呼吸的鱼饼。',
    '早上的我雄心壮志，现在的我平铺。',
    '让我摊一会儿，就一会儿。',
  ],
  soulless: [
    '我是谁？我为什么在上班？',
    '灵魂已经先我一步下班了。',
    '眼睛睁着，脑子关机。',
    '鼠标点哪儿了？不管了，先点着。',
    '今天我是台会眨眼的打印机。',
  ],
  reviving: [
    '好像……快要过半了？',
    '回魂中，进度条开始有香味了。',
    '眼神逐渐聚焦，目标：下班。',
    '再熬一下，下午就过去一大半了。',
  ],
  hopeful: [
    '闻到下班的味道了！',
    '眼里有光，光在楼下等我。',
    '再撑一会儿，快乐就在前面。',
    '笑容开始解冻，倒计时开始加速。',
  ],
  sprint: [
    '最后冲刺！谁也别拦我下班！',
    '手指已经在收电脑包了。',
    '下班倒计时进入读秒，电梯归我。',
    '再坚持三分钟，三分钟后我就是自由鱼。',
    '这班我上得很快乐，真的，快下班那种快乐。',
  ],
  celebrate: [
    '下班啦！今天也辛苦啦 🎉',
    '电脑一合，人生重启。',
    '今天这条鱼终于游回了家。',
    '工位再见，明天我还来（大概）。',
    '自由的风吹在鱼鳍上，真爽。',
  ],
};

/**
 * 被戳时的通用吐槽（兜底池）。app.js 里若 poke() 返回空会拿它顶上，
 * 正常路径优先用 poke() 返回的「当前状态」吐槽，更贴情绪。
 */
export const POKE_QUOTES = [
  '别戳啦，我在上班呢。',
  '摸鱼被发现了……',
  '戳我也不会提前下班的。',
  '再戳就把你的 KPI 吃掉。',
];

/**
 * 取当前状态的文案。同一 state + 同一 nonce 永远返回同一句；
 * nonce 用整数（例如每 20 秒 +1）时会依次轮换，不会重复卡住。
 * @param {string} state 状态名
 * @param {number|string} [nonce] 轮换序号
 * @returns {string}
 */
export function quoteFor(state, nonce) {
  const key = normalizeState(state) || 'slouch';
  const list = QUOTES[key];
  if (!Array.isArray(list) || list.length === 0) return '';

  const base = hashString(key);
  const num = nonce == null ? 0 : Number(nonce);
  const step = Number.isFinite(num) ? Math.abs(Math.trunc(num)) : hashString(String(nonce));
  return list[(base + step) % list.length];
}

/* -------------------------------------------------------------------------- */
/* 造型                                                                        */
/* -------------------------------------------------------------------------- */

/** 胖鱼身体轮廓：比正圆更宽更扁（宽高约 1.3），有点鲸鱼 / 河豚的敦实感。 */
const BODY_PATH =
  'M120 36 C156 36 184 50 192 76 C199 101 191 125 168 139 C149 151 118 154 96 148 ' +
  'C69 140 49 128 42 108 C34 87 42 64 58 50 C73 37 96 36 120 36 Z';

/** 分叉尾巴：上、下两瓣 + 中间凹口，根部藏在身体后面。 */
const TAIL_PATH =
  'M62 70 C46 52 26 40 8 40 C9 60 18 80 30 94 C18 108 9 128 8 148 ' +
  'C26 148 46 132 62 112 Z';

/** 小汗滴路径（soulless 状态用）。 */
const DROP_PATH = 'M0 -8 C3 -3 6 0 6 4 A6 6 0 0 1 -6 4 C-6 0 -3 -3 0 -8 Z';

/** 四角星（星光 / 撒花都用）。 */
const STAR_PATH = 'M0 -8 L2.2 -2.2 L8 0 L2.2 2.2 L0 8 L-2.2 2.2 L-8 0 L-2.2 -2.2 Z';

/**
 * 眼睛组件：眼白球 + 高光 + 小亮点，外加「闭眼弧 / 努力眉」两个可切换零件。
 * .fish__blink 单独一层，随机眨眼时只压扁这一层，不会覆盖各状态的眼睛姿态。
 */
function eyeMarkup(side, x, y, rx, ry) {
  const brow = side === 'l' ? 'M-9 -20 Q0 -23 9 -17' : 'M-9 -17 Q0 -23 9 -20';
  return (
    `<g transform="translate(${x} ${y})"><g class="fish__eye fish__eye--${side}">` +
    '<g class="fish__eyeball"><g class="fish__blink">' +
    `<ellipse class="fish__eye-ball" rx="${rx}" ry="${ry}"/>` +
    `<ellipse class="fish__eye-shine" cx="${-rx * 0.34}" cy="${-ry * 0.39}" rx="${rx * 0.36}" ry="${ry * 0.29}"/>` +
    `<circle class="fish__eye-spark" cx="${rx * 0.3}" cy="${ry * 0.42}" r="${rx * 0.17}"/>` +
    '</g></g>' +
    '<path class="fish__eye-arc fish__eye-arc--sleep" d="M-10 1 Q0 9 10 1"/>' +
    '<path class="fish__eye-arc fish__eye-arc--happy" d="M-10 5 Q0 -7 10 5"/>' +
    `<path class="fish__eye-brow" d="${brow}"/>` +
    '</g></g>'
  );
}

/** 内联 SVG：单个文件里手绘的大肥鱼，data-state / class 由 createMascot 维护。 */
const FISH_SVG =
  '<svg class="fish" viewBox="0 0 240 180" data-state="sleep" data-reduce-motion="false" ' +
  'role="presentation" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
  '<defs>' +
  '<linearGradient id="__ID__-body" x1="0.16" y1="0.02" x2="0.78" y2="1">' +
  '<stop class="fish-stop-top" offset="0"/>' +
  '<stop class="fish-stop-mid" offset="0.52"/>' +
  '<stop class="fish-stop-deep" offset="1"/>' +
  '</linearGradient>' +
  '<linearGradient id="__ID__-belly" x1="0.5" y1="0" x2="0.5" y2="1">' +
  '<stop class="fish-stop-belly-top" offset="0"/>' +
  '<stop class="fish-stop-belly-bottom" offset="1"/>' +
  '</linearGradient>' +
  '<linearGradient id="__ID__-tail" x1="0.9" y1="0.1" x2="0.15" y2="0.9">' +
  '<stop class="fish-stop-tail-top" offset="0"/>' +
  '<stop class="fish-stop-tail-bottom" offset="1"/>' +
  '</linearGradient>' +
  '<radialGradient id="__ID__-gloss" cx="0.36" cy="0.3" r="0.68">' +
  '<stop class="fish-stop-gloss" offset="0"/>' +
  '<stop class="fish-stop-gloss-out" offset="1"/>' +
  '</radialGradient>' +
  '<radialGradient id="__ID__-aura" cx="0.5" cy="0.5" r="0.5">' +
  '<stop class="fish-stop-aura" offset="0"/>' +
  '<stop class="fish-stop-aura-out" offset="1"/>' +
  '</radialGradient>' +
  `<clipPath id="__ID__-clip"><path d="${BODY_PATH}"/></clipPath>` +
  '</defs>' +
  /* 整体右移一点点，让「尾巴 + 身体」的视觉重心落在画布中间 */
  '<g class="fish__stage" transform="translate(5 0)">' +
  /* 背景光晕与地面阴影 */
  '<ellipse class="fish__aura" cx="120" cy="94" rx="100" ry="80" fill="url(#__ID__-aura)"/>' +
  '<ellipse class="fish__shadow" cx="124" cy="168" rx="54" ry="6"/>' +
  /* 周围气泡 */
  '<g class="fish__bubbles">' +
  '<circle class="fish__bubble" cx="34" cy="86" r="5"/>' +
  '<circle class="fish__bubble" cx="206" cy="104" r="4.5"/>' +
  '<circle class="fish__bubble" cx="54" cy="150" r="3.6"/>' +
  '<circle class="fish__bubble" cx="192" cy="146" r="5.6"/>' +
  '<circle class="fish__bubble" cx="24" cy="130" r="3"/>' +
  '<circle class="fish__bubble" cx="216" cy="58" r="3.2"/>' +
  '</g>' +
  /* 冲刺速度线（世界坐标，不跟着鱼跳） */
  '<g class="fish__speed">' +
  '<path class="fish__speed-line" d="M2 84 H15"/>' +
  '<path class="fish__speed-line" d="M0 104 H12"/>' +
  '<path class="fish__speed-line" d="M3 124 H16"/>' +
  '</g>' +
  /* 被戳时的粒子爆开 */
  '<g class="fish__burst">' +
  '<g class="fish__burst-unit" transform="translate(122 10)"><circle class="fish__burst-dot" r="2.6"/></g>' +
  '<g class="fish__burst-unit" transform="translate(184 28)"><circle class="fish__burst-dot" r="2.2"/></g>' +
  '<g class="fish__burst-unit" transform="translate(212 98)"><circle class="fish__burst-dot" r="2.8"/></g>' +
  '<g class="fish__burst-unit" transform="translate(184 168)"><circle class="fish__burst-dot" r="2.2"/></g>' +
  '<g class="fish__burst-unit" transform="translate(120 176)"><circle class="fish__burst-dot" r="2.4"/></g>' +
  '<g class="fish__burst-unit" transform="translate(54 166)"><circle class="fish__burst-dot" r="2.2"/></g>' +
  '<g class="fish__burst-unit" transform="translate(24 98)"><circle class="fish__burst-dot" r="2.8"/></g>' +
  '<g class="fish__burst-unit" transform="translate(56 28)"><circle class="fish__burst-dot" r="2.2"/></g>' +
  '</g>' +
  /* 被戳时冒出的爱心 */
  '<g class="fish__hearts">' +
  '<g transform="translate(170 36)"><path class="fish__heart" d="M0 4.2 C-4.6 1.2 -5.4 -3.4 -2.4 -4.2 C-0.9 -4.6 0 -3.4 0 -2.2 C0 -3.4 0.9 -4.6 2.4 -4.2 C5.4 -3.4 4.6 1.2 0 4.2 Z"/></g>' +
  '<g transform="translate(190 52) scale(.66)"><path class="fish__heart" d="M0 4.2 C-4.6 1.2 -5.4 -3.4 -2.4 -4.2 C-0.9 -4.6 0 -3.4 0 -2.2 C0 -3.4 0.9 -4.6 2.4 -4.2 C5.4 -3.4 4.6 1.2 0 4.2 Z"/></g>' +
  '</g>' +
  /* 主体：scene（状态位移） > act（待机小动作） > look（视线跟随） */
  '<g class="fish__scene">' +
  '<g class="fish__act">' +
  '<g class="fish__look">' +
  '<g class="fish__tail">' +
  '<g class="fish__tail-act">' +
  `<path class="fish__tail-shape" d="${TAIL_PATH}" fill="url(#__ID__-tail)"/>` +
  '<path class="fish__tail-shine" d="M54 74 C41 58 28 48 16 46"/>' +
  '</g></g>' +
  '<g class="fish__body">' +
  `<path class="fish__body-shape" d="${BODY_PATH}" fill="url(#__ID__-body)"/>` +
  '<g clip-path="url(#__ID__-clip)">' +
  '<ellipse class="fish__belly" cx="118" cy="168" rx="76" ry="40" fill="url(#__ID__-belly)"/>' +
  '<ellipse class="fish__gloss" cx="92" cy="58" rx="42" ry="28" fill="url(#__ID__-gloss)"/>' +
  '<ellipse class="fish__blush fish__blush--l" cx="78" cy="88" rx="11" ry="6.5"/>' +
  '<ellipse class="fish__blush fish__blush--r" cx="168" cy="85" rx="10" ry="6"/>' +
  '<g class="fish__scale-wrap" transform="translate(64 78) rotate(-14)"><ellipse class="fish__scale" rx="8" ry="5"/></g>' +
  '<g class="fish__scale-wrap" transform="translate(82 60) rotate(-24)"><ellipse class="fish__scale" rx="7.4" ry="4.6"/></g>' +
  '<g class="fish__scale-wrap" transform="translate(102 48) rotate(-32)"><ellipse class="fish__scale" rx="6.8" ry="4.2"/></g>' +
  '</g>' +
  '<path class="fish__rim" d="M60 56 C76 40 98 36 124 36"/>' +
  /* 小胸鳍：近侧一片从身侧伸出（带小手表），远侧一片收在身体里 */
  '<g class="fish__fin fish__fin--far"><path d="M74 94 C62 96 54 106 55 117 C56 124 63 125 67 119 C73 110 76 100 74 94 Z"/></g>' +
  '<g class="fish__fin fish__fin--near">' +
  '<path d="M170 94 C184 98 193 110 190 122 C188 130 179 131 175 123 C169 113 166 100 170 94 Z"/>' +
  '<path class="fish__fin-shine" d="M172 98 C182 102 189 110 191 119"/>' +
  '<g class="fish__watch" transform="translate(181 116) rotate(18)">' +
  '<circle class="fish__watch-face" r="7.2"/>' +
  '<path class="fish__watch-hand" d="M0 -3.8 V0 H3.2"/>' +
  '</g></g>' +
  /* 头顶喷气孔 */
  '<ellipse class="fish__blowhole" cx="104" cy="42" rx="6.6" ry="2.5"/>' +
  '<ellipse class="fish__blowhole-in" cx="104" cy="41.7" rx="2.9" ry="1"/>' +
  /* 表情 */
  eyeMarkup('l', 104, 69, 13.5, 15.5) +
  eyeMarkup('r', 146, 66, 12.5, 14.5) +
  '<g class="fish__mouths">' +
  '<path class="fish__mouth fish__mouth--flat" d="M117 102 H139"/>' +
  '<path class="fish__mouth fish__mouth--frown" d="M117 106 Q128 98 139 106"/>' +
  '<path class="fish__mouth fish__mouth--smile" d="M116 96 Q128 109 141 96"/>' +
  '<path class="fish__mouth fish__mouth--grin" d="M112 94 Q128 119 144 94"/>' +
  '<path class="fish__mouth fish__mouth--open" d="M114 93 Q128 89 142 93 Q141 115 128 118 Q115 115 114 93 Z"/>' +
  '<path class="fish__mouth fish__mouth--yawn" d="M115 88 Q128 84 141 88 Q140 118 128 122 Q116 118 115 88 Z"/>' +
  '<ellipse class="fish__tongue" cx="128" cy="112" rx="7" ry="4"/>' +
  '<ellipse class="fish__tongue fish__tongue--yawn" cx="128" cy="115" rx="6.5" ry="3.6"/>' +
  '</g>' +
  /* 喷气水花 */
  '<g class="fish__spray">' +
  '<circle class="fish__spray-dot" cx="99" cy="26" r="2.6"/>' +
  '<circle class="fish__spray-dot" cx="109" cy="17" r="2.2"/>' +
  '<circle class="fish__spray-dot" cx="118" cy="27" r="1.9"/>' +
  '<circle class="fish__spray-dot" cx="105" cy="8" r="1.7"/>' +
  '</g>' +
  /* 灵魂出窍的汗滴 */
  '<g class="fish__sweats">' +
  `<g transform="translate(166 50) scale(.8)"><path class="fish__sweat" d="${DROP_PATH}"/></g>` +
  `<g transform="translate(178 70) scale(.6)"><path class="fish__sweat" d="${DROP_PATH}"/></g>` +
  '</g>' +
  /* 吐泡泡串（待机小动作） */
  '<g class="fish__idle-bubbles">' +
  '<circle class="fish__idle-bubble" cx="146" cy="100" r="3.4"/>' +
  '<circle class="fish__idle-bubble" cx="156" cy="92" r="3"/>' +
  '<circle class="fish__idle-bubble" cx="164" cy="84" r="2.6"/>' +
  '<circle class="fish__idle-bubble" cx="172" cy="76" r="2.2"/>' +
  '</g>' +
  '</g>' +
  '</g>' +
  '</g>' +
  '</g>' +
  /* 灵魂出窍的小幽灵 */
  '<g transform="translate(166 30)"><g class="fish__ghost">' +
  '<path class="fish__ghost-shape" d="M-12 -2 C-12 -12 12 -12 12 -2 L12 10 Q6 4 0 10 Q-6 4 -12 10 Z"/>' +
  '<ellipse class="fish__ghost-eye" cx="-4.6" cy="-3" rx="1.8" ry="2.2"/>' +
  '<ellipse class="fish__ghost-eye" cx="4.6" cy="-3" rx="1.8" ry="2.2"/>' +
  '</g></g>' +
  /* 沉睡 Zzz */
  '<g class="fish__zzz">' +
  '<g transform="translate(142 26) scale(.68)"><path class="fish__zzz-glyph" d="M0 0 H12 L0 12 H12"/></g>' +
  '<g transform="translate(160 13) scale(.86)"><path class="fish__zzz-glyph" d="M0 0 H12 L0 12 H12"/></g>' +
  '<g transform="translate(180 2) scale(1.02)"><path class="fish__zzz-glyph" d="M0 0 H12 L0 12 H12"/></g>' +
  '</g>' +
  /* 星光 */
  '<g class="fish__sparkles">' +
  `<g transform="translate(58 54) scale(.9)"><path class="fish__sparkle" d="${STAR_PATH}"/></g>` +
  `<g transform="translate(198 64) scale(.8)"><path class="fish__sparkle" d="${STAR_PATH}"/></g>` +
  `<g transform="translate(168 22) scale(.7)"><path class="fish__sparkle" d="${STAR_PATH}"/></g>` +
  `<g transform="translate(74 30) scale(.6)"><path class="fish__sparkle" d="${STAR_PATH}"/></g>` +
  `<g transform="translate(212 116) scale(.55)"><path class="fish__sparkle" d="${STAR_PATH}"/></g>` +
  '</g>' +
  /* 撒花彩纸 */
  '<g class="fish__confetti">' +
  '<g transform="translate(52 14) rotate(18)"><rect class="fish__confetti-piece fish__confetti-piece--c1" width="6" height="10" rx="1.6"/></g>' +
  '<g transform="translate(76 36) rotate(-32)"><rect class="fish__confetti-piece fish__confetti-piece--c2" width="5" height="9" rx="1.5"/></g>' +
  '<g transform="translate(100 8) rotate(58)"><rect class="fish__confetti-piece fish__confetti-piece--c3" width="6" height="9" rx="1.5"/></g>' +
  '<g transform="translate(128 32) rotate(-12)"><rect class="fish__confetti-piece fish__confetti-piece--c4" width="5" height="10" rx="1.6"/></g>' +
  '<g transform="translate(154 8) rotate(42)"><rect class="fish__confetti-piece fish__confetti-piece--c2" width="6" height="8" rx="1.5"/></g>' +
  '<g transform="translate(180 30) rotate(-48)"><rect class="fish__confetti-piece fish__confetti-piece--c1" width="5" height="9" rx="1.5"/></g>' +
  '<g transform="translate(202 12) rotate(14)"><rect class="fish__confetti-piece fish__confetti-piece--c3" width="5" height="8" rx="1.4"/></g>' +
  '<g transform="translate(38 40) rotate(-24)"><rect class="fish__confetti-piece fish__confetti-piece--c4" width="5" height="9" rx="1.5"/></g>' +
  '<g transform="translate(66 56)"><circle class="fish__confetti-piece fish__confetti-piece--c3" r="3"/></g>' +
  '<g transform="translate(116 54)"><circle class="fish__confetti-piece fish__confetti-piece--c1" r="2.6"/></g>' +
  '<g transform="translate(170 62)"><circle class="fish__confetti-piece fish__confetti-piece--c4" r="2.8"/></g>' +
  '</g>' +
  '</g>' +
  '</svg>';

/* -------------------------------------------------------------------------- */
/* 待机小动作                                                                   */
/* -------------------------------------------------------------------------- */

/** 每个小动作：class 名 + 持续时间（与 CSS 动画时长对齐）。 */
const ACTIONS = {
  yawn: { cls: 'is-yawn', ms: 2000 },
  lookAround: { cls: 'is-look-around', ms: 2600 },
  stretch: { cls: 'is-stretch', ms: 2200 },
  tailFlick: { cls: 'is-tail-flick', ms: 1500 },
  bubbles: { cls: 'is-bubble-string', ms: 2800 },
  checkWatch: { cls: 'is-check-watch', ms: 2200 },
};

/** 各状态可用的待机小动作池（sleep 只呼吸 + Zzz）。 */
const ACTION_POOL = {
  sleep: [],
  slouch: [ACTIONS.yawn, ACTIONS.tailFlick],
  soulless: [ACTIONS.yawn, ACTIONS.checkWatch],
  reviving: [ACTIONS.lookAround, ACTIONS.stretch],
  hopeful: [ACTIONS.bubbles, ACTIONS.lookAround, ACTIONS.stretch],
  sprint: [ACTIONS.checkWatch, ACTIONS.tailFlick, ACTIONS.bubbles],
  celebrate: [ACTIONS.stretch, ACTIONS.bubbles],
};

/** 各状态随机眨眼的间隔区间（毫秒）；null 表示这档不眨眼。 */
const BLINK_INTERVAL = {
  sleep: null, // 闭眼睡觉
  slouch: [5200, 9000], // 慢眨
  soulless: [6000, 10000], // 慢半拍
  reviving: [3200, 6200],
  hopeful: [2600, 5000],
  sprint: [1200, 2600], // 瞪眼，快速
  celebrate: null, // 眼睛是笑弧
};

/** 所有会临时挂到根节点的 class，切换状态 / 暂停时统一清理。 */
const FLASH_CLASSES = [
  ACTIONS.yawn.cls,
  ACTIONS.lookAround.cls,
  ACTIONS.stretch.cls,
  ACTIONS.tailFlick.cls,
  ACTIONS.bubbles.cls,
  ACTIONS.checkWatch.cls,
  'is-blinking',
  'is-poke',
];

/* -------------------------------------------------------------------------- */
/* 实例                                                                        */
/* -------------------------------------------------------------------------- */

let instanceCount = 0;

/**
 * 把大肥鱼注入容器，并返回控制器。
 * @param {HTMLElement} container 形如 &lt;div id="mascot"&gt; 的空容器
 */
export function createMascot(container) {
  if (!container || typeof container !== 'object') {
    throw new TypeError('createMascot(container)：需要一个 DOM 容器元素');
  }
  if (typeof container.setAttribute !== 'function' || typeof container.querySelector !== 'function') {
    throw new TypeError('createMascot(container)：容器不是有效的 DOM 元素');
  }

  instanceCount += 1;
  const uid = `xb-fish-${instanceCount}`;
  container.innerHTML = FISH_SVG.replace(/__ID__/g, uid);

  const svg = container.querySelector('svg.fish') || container.querySelector('svg');
  if (!svg) {
    container.innerHTML = '';
    throw new Error('createMascot：大肥鱼 SVG 注入失败');
  }

  // 纯装饰图形：对读屏软件隐藏
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  container.setAttribute('aria-hidden', 'true');

  const doc = container.ownerDocument && typeof container.ownerDocument === 'object' ? container.ownerDocument : null;
  const win = doc && doc.defaultView ? doc.defaultView : null;
  const hasWin = Boolean(win && typeof win.setTimeout === 'function');

  let state = normalizeState(svg.getAttribute('data-state')) || 'sleep';
  let reduceMotion = false;
  let destroyed = false;
  let paused = false;
  let lookX = 0;
  let lookY = 0;
  const timers = new Set();

  const writeState = (value) => {
    svg.setAttribute('data-state', value);
    container.setAttribute('data-state', value);
  };
  writeState(state);

  /* ---- 小工具 ---------------------------------------------------------- */

  const later = (fn, ms) => {
    if (!hasWin) return 0;
    const id = win.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const clearTimers = () => {
    if (!hasWin) return;
    timers.forEach((id) => win.clearTimeout(id));
    timers.clear();
  };

  const clearFlashes = () => {
    FLASH_CLASSES.forEach((cls) => svg.classList.remove(cls));
  };

  /** 系统级「减少动态效果」：也会关掉随机调度与位移，只留表情与颜色。 */
  const prefersReduced = () =>
    Boolean(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const motionOff = () => reduceMotion || prefersReduced();

  const idleBlocked = () => destroyed || motionOff() || paused || !hasWin;

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* ---- 视线跟随 -------------------------------------------------------- */

  const applyLook = () => {
    const off = motionOff();
    const sx = (off ? 0 : lookX).toFixed(3);
    const sy = (off ? 0 : lookY).toFixed(3);
    [svg, container].forEach((el) => {
      if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
      el.style.setProperty('--look-x', sx);
      el.style.setProperty('--look-y', sy);
    });
  };

  /* ---- 随机调度 -------------------------------------------------------- */

  const scheduleBlink = () => {
    const range = BLINK_INTERVAL[state];
    if (!range) return;
    const [min, max] = range;
    later(() => {
      if (idleBlocked()) return;
      const current = BLINK_INTERVAL[state];
      if (current) {
        svg.classList.add('is-blinking');
        later(() => svg.classList.remove('is-blinking'), 340);
      }
      scheduleBlink();
    }, min + Math.random() * (max - min));
  };

  const scheduleAction = () => {
    const pool = ACTION_POOL[state] || [];
    if (pool.length === 0) return;
    later(
      () => {
        if (idleBlocked()) return;
        const nextPool = ACTION_POOL[state] || [];
        if (nextPool.length > 0 && !svg.classList.contains('is-poke')) {
          const action = pick(nextPool);
          FLASH_CLASSES.forEach((cls) => {
            if (cls !== 'is-blinking' && cls !== 'is-poke') svg.classList.remove(cls);
          });
          svg.classList.add(action.cls);
          later(() => svg.classList.remove(action.cls), action.ms);
        }
        scheduleAction();
      },
      20000 + Math.random() * 25000,
    );
  };

  const restartIdle = () => {
    clearTimers();
    if (idleBlocked()) return;
    scheduleBlink();
    scheduleAction();
  };

  applyLook();
  restartIdle();

  /* ---- 可见性：切到后台就停掉所有动画与随机调度 ------------------------ */

  const onVisibility = () => {
    const hidden = Boolean(doc && doc.hidden);
    if (hidden === paused) return;
    paused = hidden;
    if (paused) {
      clearTimers();
      clearFlashes();
      svg.classList.add('is-paused');
    } else {
      svg.classList.remove('is-paused');
      applyLook();
      restartIdle();
    }
  };
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibility);
  }

  /* ---- 对外接口 -------------------------------------------------------- */

  return {
    /** 切换情绪档位；未知值忽略，保证 CSS 始终有合法的 data-state。 */
    setState(next) {
      if (destroyed) return state;
      const value = normalizeState(next);
      if (!value || value === state) return state;
      state = value;
      writeState(state);
      // 换档时中断正在播放的小动作，避免两套姿态叠在一起
      FLASH_CLASSES.forEach((cls) => svg.classList.remove(cls));
      // 眨眼频率 / 小动作池是按状态分的，换档后重新排期（sleep 这类没有调度）
      restartIdle();
      return state;
    },

    /** 降低动态效果开关（同时写 data-reduce-motion 供 CSS 兜底）。 */
    setMotion(options) {
      if (destroyed) return;
      const opts = options && typeof options === 'object' ? options : {};
      const next = opts.reduceMotion !== undefined ? opts.reduceMotion : opts.reducedMotion;
      reduceMotion = Boolean(next);
      const flag = reduceMotion ? 'true' : 'false';
      svg.setAttribute('data-reduce-motion', flag);
      container.setAttribute('data-reduce-motion', flag);
      // 切开关时先收掉正在播的一次性动作，避免类名残留
      clearFlashes();
      applyLook();
      restartIdle();
    },

    /**
     * 视线跟随：nx / ny ∈ [-1, 1]，通过 CSS 变量驱动眼球与身体轻微偏移。
     * 只改自定义属性，不触发布局；减少动态效果时归零。
     */
    setLook(nx, ny) {
      if (destroyed) return;
      const nextX = clampSigned(nx);
      const nextY = clampSigned(ny);
      if (nextX === lookX && nextY === lookY) return;
      lookX = nextX;
      lookY = nextY;
      applyLook();
    },

    /**
     * 戳一下：挤压回弹 + 随机吐槽，约 1.2s 后回到当前情绪。
     * 返回这一句吐槽，方便 app.js 直接显示在气泡里。
     */
    poke() {
      if (destroyed) return '';
      // 一半是「当前情绪」的吐槽，一半是通用被戳吐槽，连着戳也不容易重复
      const list = QUOTES[state] || QUOTES.slouch;
      const quip = Math.random() < 0.5 ? pick(POKE_QUOTES) : pick(list);
      if (motionOff() || paused) return quip;

      // 打断正在播放的小动作，重新触发挤压动画
      clearFlashes();
      if (typeof svg.getBoundingClientRect === 'function') svg.getBoundingClientRect();
      svg.classList.add('is-poke');
      later(() => svg.classList.remove('is-poke'), 1200);
      return quip;
    },

    /** 卸载注入的 SVG、定时器与事件，重复调用安全。 */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', onVisibility);
      }
      if (svg && typeof svg.remove === 'function') svg.remove();
      else if (typeof container.removeChild === 'function') container.removeChild(svg);
      [container, svg].forEach((el) => {
        if (!el || typeof el.removeAttribute !== 'function') return;
        el.removeAttribute('data-state');
        el.removeAttribute('data-reduce-motion');
      });
      if (container.innerHTML === '') container.removeAttribute('aria-hidden');
    },
  };
}

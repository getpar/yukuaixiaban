/**
 * 「鱼快下班」下班跑步彩蛋 · 纯规划内核（无 DOM / Electron 依赖，可单测）
 * ---------------------------------------------------------------------------
 * v2：学习优秀桌宠（Mocha Casa / Shimeji / modbender）后重做。
 * 核心改进：
 *   1) 用 easeInOutCubic 曲线驱动位移 —— 起步加速、端点减速，告别“机器人匀速”；
 *   2) 跑线贴工作区底部（脚踩地面，避开任务栏）；所有坐标夹在工作区内；
 *   3) 分方向：向右跑正常、向左跑由调用方镜像；每段的 dir 明确给出；
 *   4) 一段完整“下班小剧场”：钻出欢呼 → 跑 → 急停转身 → 跑回 → 跳+撒花 → 挥手淡出；
 *   5) 支持“安静 / 活跃”两档节奏；
 *   6) 支持鼠标避让：传入 cursor 坐标，跑线遇到光标时抬高档位绕开。
 *
 * 这里只做纯计算，主进程据此 setPosition 移动窗口，并推送节拍给渲染层。
 *
 * @module runner-plan
 */

/** 从有向路径里，每段的方向常量。 */
export const DIR = { RIGHT: 'right', LEFT: 'left' };

/** 台词池：边跑边说。 */
export const RUN_LINES = [
  '下班啦——！',
  '溜了溜了～',
  '今天的钱我赚够啦！',
  '谁也别拦我，我要回家！',
  '老板看不见我，我看不见老板～',
  '干饭去咯！',
  '明天见👋',
  '冲鸭！！自由了！',
  '打卡下班，一秒都不多待～',
  '这工资，我拿得问心无愧！',
];

export const OPENING_LINES = ['到点啦！大肥鱼出笼——', '下班时间到，我先跑了！'];
export const CLOSING_LINES = ['明天见👋', '散会，回家睡觉！', '今天也辛苦啦，晚安～'];

/** 节奏档位：安静（短、少跑） / 活跃（完整小剧场）。 */
export const MODES = {
  calm: { durationMs: 6000, loopCount: 1, cruise: 320, label: '安静' },
  active: { durationMs: 9000, loopCount: 2, cruise: 520, label: '活跃' },
};

export const RUNNER_DEFAULTS = {
  mode: 'active',
  fps: 60,
  winWidth: 300,
  winHeight: 320,
  slideInMs: 600, // 从主窗“钻出”的过渡
  pauseAtEndMs: 420, // 端点急停转身的停顿
  outroMs: 1600, // 收尾表演 + 淡出
  bottomGap: 0, // 跑线离工作区底部的像素（脚踩线）
  cursorAvoidPx: 26, // 光标在上方时，跑线抬高多少绕开
  cruiseSpeedPx: 320, // 巡航速度（像素/秒）；ease 峰值约 1.28×，保证不“飞太快”
  maxSpeedPx: 560, // 速度硬上限，超过就拉长该段时长，避免脚底打滑
};

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 三次缓入缓出：起步慢、中间快、收尾慢。 */
export function easeInOutCubic(t) {
  const x = clamp(num(t, 0), 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * 梯形速度曲线的位置函数（更像“起跑-匀速-刹住”，峰值速度 = 1/0.8 × 平均速度）。
 * accelFrac：加减速各占的比例（默认 0.2）。
 * u∈[0,1] → 返回 [0,1] 的位置比例。峰值速度仅约平均的 1.25 倍，远没有 cubic 那么尖，
 * 因此窗口移动不会突然飙速，脚底不易打滑。
 */
export function easeTrapezoid(u, accelFrac = 0.2) {
  const x = clamp(num(u, 0), 0, 1);
  const a = clamp(num(accelFrac, 0.2), 0.01, 0.49);
  const vpeak = 1 / (1 - a); // 归一化：总距离=1
  if (x < a) {
    // 加速段：v = vpeak * (x/a)
    return 0.5 * vpeak * (x * x) / a;
  }
  if (x > 1 - a) {
    const r = 1 - x; // 距离结束的剩余
    return 1 - 0.5 * vpeak * (r * r) / a;
  }
  // 巡航段
  const accelDist = 0.5 * vpeak * a;
  return accelDist + vpeak * (x - a);
}

/** 梯形速度曲线的峰值/平均速度比（供时长估算）。 */
export function trapezoidPeakFactor(accelFrac = 0.2) {
  const a = clamp(num(accelFrac, 0.2), 0.01, 0.49);
  return 1 / (1 - a);
}

/** 归一化工作区矩形，非法时回退常见主屏。 */
export function normalizeArea(area) {
  const a = area && typeof area === 'object' ? area : {};
  const width = Math.max(200, num(a.width, 1280));
  const height = Math.max(200, num(a.height, 720));
  return { x: num(a.x, 0), y: num(a.y, 0), width, height };
}

function clampPosition(area, winWidth, winHeight, x, y) {
  const maxX = area.x + area.width - winWidth;
  const maxY = area.y + area.height - winHeight;
  return { x: Math.round(clamp(x, area.x, maxX)), y: Math.round(clamp(y, area.y, maxY)) };
}

/** 解析模式参数。 */
function modeParams(mode) {
  return MODES[mode] || MODES[RUNNER_DEFAULTS.mode];
}

/**
 * 规划一次“下班跑步”。
 *
 * @param {object} opts
 * @param {object} opts.area 工作区 workArea
 * @param {object|null} [opts.origin] 主窗当前 bounds（“钻出”起点）
 * @param {{x:number,y:number}|null} [opts.cursor] 光标屏幕坐标（用于避让）
 * @param {'calm'|'active'} [opts.mode]
 * @param {number} [opts.durationMs]
 * @param {number} [opts.loopCount]
 * @param {number} [opts.winWidth]
 * @param {number} [opts.winHeight]
 * @param {(arr:any[])=>any} [opts.pick]
 * @returns {object} 计划
 */
export function planRun(opts = {}) {
  const area = normalizeArea(opts.area);
  const pick = typeof opts.pick === 'function' ? opts.pick : (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mp = modeParams(opts.mode);

  const winWidth = Math.round(clamp(num(opts.winWidth, RUNNER_DEFAULTS.winWidth), 100, Math.min(area.width, 640)));
  const winHeight = Math.round(clamp(num(opts.winHeight, RUNNER_DEFAULTS.winHeight), 100, Math.min(area.height, 640)));
  const durationMs = Math.round(clamp(num(opts.durationMs, mp.durationMs), 2000, 30000));
  const loopCount = Math.round(clamp(num(opts.loopCount, mp.loopCount), 1, 10));
  const fps = clamp(num(opts.fps, RUNNER_DEFAULTS.fps), 10, 120);

  // 跑线：脚踩工作区底部（再减去 bottomGap），并夹紧不出界。
  let groundY = area.y + area.height - winHeight - num(RUNNER_DEFAULTS.bottomGap, 0);
  // 鼠标避让：若光标恰好落在跑线上方不远处，把整条跑线抬高绕开。
  const cursor = opts.cursor && Number.isFinite(opts.cursor.y) ? opts.cursor : null;
  if (cursor) {
    const cursorScreenY = cursor.y;
    const onLine = Math.abs(cursorScreenY - (groundY + winHeight * 0.7)) < winHeight * 0.55;
    if (onLine) groundY -= num(RUNNER_DEFAULTS.cursorAvoidPx, 0);
  }
  groundY = Math.round(clamp(groundY, area.y, area.y + area.height - winHeight));

  const leftX = area.x + Math.round(area.width * 0.03);
  const rightX = area.x + area.width - winWidth - Math.round(area.width * 0.03);

  // 起点：从主窗附近“钻出”。
  const origin = opts.origin && Number.isFinite(opts.origin.x) ? opts.origin : null;
  const startBounds = origin
    ? clampPosition(area, winWidth, winHeight, origin.x, num(origin.y, groundY))
    : clampPosition(area, winWidth, winHeight, leftX, groundY);

  // 决定第一段方向：起点偏左先向右跑，偏右先向左跑。
  const towardRightFirst = startBounds.x <= (leftX + rightX) / 2;
  // 途经点序列：每个元素是“本段终点 x + 方向”。
  const legs = [];
  for (let i = 0; i < loopCount; i += 1) {
    const goRight = i % 2 === 0 ? towardRightFirst : !towardRightFirst;
    legs.push({ x: goRight ? rightX : leftX, dir: goRight ? DIR.RIGHT : DIR.LEFT });
  }

  // 时间轴：slide-in → [每段 跑 + 端点停顿] → outro。
  // 关键：每段时长由“距离 / 巡航速度”推导（而不是固定总时长），确保峰值速度不超过上限，
  // 否则鱼的移动会远远快过腿部步频，看着就是“滑冰”。
  const slideInMs = num(RUNNER_DEFAULTS.slideInMs, 600);
  const pauseAtEndMs = num(RUNNER_DEFAULTS.pauseAtEndMs, 420);
  const outroMs = num(RUNNER_DEFAULTS.outroMs, 1600);
  const cruiseSpeed = Math.max(60, num(opts.cruiseSpeedPx, mp.cruise || RUNNER_DEFAULTS.cruiseSpeedPx));
  const maxSpeed = Math.max(cruiseSpeed, num(RUNNER_DEFAULTS.maxSpeedPx, 460));
  const accelFrac = 0.22;
  // 梯形曲线峰值速度 = avg / (1-accelFrac)，据此反推段时长，保证峰值不超过上限。
  const peakFactor = trapezoidPeakFactor(accelFrac);

  const keyframes = [];
  const beats = [];
  const stages = [];

  // 0) 钻出：从主窗位置落到跑线，再开始第一段奔跑。
  const firstLeg = legs[0];
  keyframes.push({ t: 0, x: startBounds.x, y: startBounds.y });

  // slide-in：在“原地”从主窗高度落到跑线高度（横向基本不动，避免出现空白滑行）。
  const slideSteps = Math.max(6, Math.round((slideInMs / 1000) * fps));
  for (let k = 1; k <= slideSteps; k += 1) {
    const p = easeInOutCubic(k / slideSteps);
    keyframes.push({
      t: Math.round((slideInMs * k) / slideSteps),
      x: startBounds.x,
      y: Math.round(startBounds.y + (groundY - startBounds.y) * p),
    });
  }
  beats.push({ t: 0, clip: null, line: pick(OPENING_LINES), kind: 'enter', dir: firstLeg.dir });

  let cursorX = startBounds.x;
  let t = slideInMs;
  let lineIdx = Math.floor(Math.random() * RUN_LINES.length);
  let actualRunTotalMs = 0;

  legs.forEach((leg, idx) => {
    const fromX = cursorX;
    const toX = clampPosition(area, winWidth, winHeight, leg.x, groundY).x;
    const distance = Math.abs(toX - fromX);
    // 段时长：按巡航速度算，且保证峰值不超过 maxSpeed。
    let legRunMs = Math.max(500, Math.round((distance / cruiseSpeed) * 1000));
    const peakSpeed = (distance / (legRunMs / 1000)) * peakFactor;
    if (peakSpeed > maxSpeed) {
      legRunMs = Math.round((distance * peakFactor / maxSpeed) * 1000);
    }
    actualRunTotalMs += legRunMs;

    const legStartT = t;
    const samplesPerLeg = Math.max(8, Math.round((legRunMs / 1000) * fps));
    for (let k = 1; k <= samplesPerLeg; k += 1) {
      const p = easeTrapezoid(k / samplesPerLeg, accelFrac);
      keyframes.push({
        t: Math.round(legStartT + (legRunMs * k) / samplesPerLeg),
        x: Math.round(fromX + (toX - fromX) * p),
        y: groundY,
      });
    }
    beats.push({
      t: Math.round(legStartT + legRunMs * 0.12),
      clip: null,
      line: RUN_LINES[lineIdx % RUN_LINES.length],
      kind: 'run',
      dir: leg.dir,
    });
    lineIdx += 1;
    stages.push({ kind: 'run', dir: leg.dir, fromX, toX, startT: legStartT, endT: legStartT + legRunMs });
    t = legStartT + legRunMs;
    cursorX = toX;

    if (idx < legs.length - 1) {
      beats.push({ t: Math.round(t), clip: 'spin', line: null, kind: 'turn' });
      stages.push({ kind: 'turn', startT: t, endT: t + pauseAtEndMs });
      keyframes.push({ t: Math.round(t + pauseAtEndMs), x: cursorX, y: groundY });
      t += pauseAtEndMs;
    }
  });

  // 收尾：跳跃 + 撒花 + 挥手告别。
  const outroStart = t;
  beats.push({ t: Math.round(outroStart), clip: 'hop', line: null, kind: 'show' });
  beats.push({
    t: Math.round(outroStart + Math.min(520, outroMs * 0.4)),
    clip: 'celebrate',
    line: pick(CLOSING_LINES),
    kind: 'outro',
  });
  beats.push({ t: Math.round(outroStart + Math.min(900, outroMs * 0.7)), clip: 'wave', line: null, kind: 'leave' });
  stages.push({ kind: 'outro', startT: outroStart, endT: outroStart + outroMs });
  // 收尾窗口不动
  keyframes.push({ t: Math.round(outroStart + outroMs), x: cursorX, y: groundY });

  const totalMs = Math.round(outroStart + outroMs);

  return {
    area,
    winWidth,
    winHeight,
    durationMs: totalMs,
    loopCount,
    mode: mp === MODES.calm ? 'calm' : 'active',
    groundY,
    startBounds,
    startClip: null,
    startLine: beats[0].line,
    startDir: firstLeg.dir,
    keyframes,
    beats,
    stages,
    endBounds: { x: cursorX, y: groundY },
    outroStartMs: Math.round(outroStart),
  };
}

/** 在关键帧之间线性插值，返回 t 时刻窗口左上角坐标。 */
export function boundsAt(keyframes, t) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return { x: 0, y: 0 };
  if (keyframes.length === 1) return { x: keyframes[0].x, y: keyframes[0].y };
  const time = num(t, 0);
  if (time <= keyframes[0].t) return { x: keyframes[0].x, y: keyframes[0].y };
  const last = keyframes[keyframes.length - 1];
  if (time >= last.t) return { x: last.x, y: last.y };

  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= time) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo];
  const b = keyframes[hi];
  const span = b.t - a.t;
  const p = span > 0 ? (time - a.t) / span : 1;
  return { x: Math.round(a.x + (b.x - a.x) * p), y: Math.round(a.y + (b.y - a.y) * p) };
}

/** 返回 t 时刻及之前最近的节拍。 */
export function beatAt(beats, t) {
  if (!Array.isArray(beats) || beats.length === 0) return null;
  const time = num(t, 0);
  let found = null;
  for (const beat of beats) {
    if (beat.t <= time) found = beat;
    else break;
  }
  return found;
}

/** 返回 t 时刻所在的阶段（用于渲染层判断当前该跑/转身/收尾）。 */
export function stageAt(stages, t) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const time = num(t, 0);
  for (const s of stages) {
    if (time >= s.startT && time < s.endT) return s;
  }
  return stages[stages.length - 1];
}

/**
 * 估算某一时刻窗口的“瞬时水平速度”（像素/秒），供渲染层按速度微调 webm playbackRate，
 * 让腿的“捣腾”速度与位移耦合，减少滑冰感。
 */
export function speedAt(keyframes, t, dtMs = 16) {
  const a = boundsAt(keyframes, num(t, 0) - dtMs);
  const b = boundsAt(keyframes, num(t, 0));
  return Math.abs(b.x - a.x) / (dtMs / 1000);
}

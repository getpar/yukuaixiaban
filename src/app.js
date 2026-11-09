/* ==========================================================================
   鱼快下班 · 渲染进程
   状态机：上班前 / 上班中 / 已下班；每 250ms 按真实时间重算，不做累加。
   ========================================================================== */

import {
  DEFAULT_SETTINGS,
  shiftFor,
  payFor,
  formatHMS,
  formatMoney,
  formatPercent,
  validateSettings,
} from './calc.mjs';
// 用命名空间导入，方便对 mascot 的增强能力（poke / setLook）做特性检测。
// 形象实现可切换：./pet.js 是社区桌宠（webm 动画），./mascot.js 是原创 SVG 鱼。
import * as MascotModule from './pet.js';

const createMascot = MascotModule.createMascot;
const stateFor = MascotModule.stateFor;
const quoteFor = MascotModule.quoteFor;

const FALLBACK_POKE_QUOTES = [
  '别戳啦，我在上班呢。',
  '摸鱼被发现了！',
  '戳我也不会提前下班的……',
  '再戳就跳进你的工资条里。',
];

const TICK_MS = 250;
const BUBBLE_ROTATE_MS = 20000;

const els = {
  body: document.body,
  status: document.getElementById('status-pill'),
  countdown: document.getElementById('countdown'),
  countdownLabel: document.getElementById('countdown-label'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  shiftText: document.getElementById('shift-text'),
  earned: document.getElementById('earned'),
  perMinute: document.getElementById('per-minute'),
  remaining: document.getElementById('remaining'),
  bubble: document.getElementById('bubble'),
  footerShift: document.getElementById('footer-shift'),
  pin: document.getElementById('btn-pin'),
  confetti: document.getElementById('confetti'),
  panel: document.getElementById('panel'),
  scrim: document.getElementById('scrim'),
  preview: document.getElementById('preview'),
  formError: document.getElementById('form-error'),
  inputs: {
    monthlySalary: document.getElementById('input-salary'),
    monthlyWorkdays: document.getElementById('input-workdays'),
    hourlyRate: document.getElementById('input-hourly'),
    workStart: document.getElementById('input-start'),
    workEnd: document.getElementById('input-end'),
    lunchEnabled: document.getElementById('input-lunch'),
    lunchStart: document.getElementById('input-lunch-start'),
    lunchEnd: document.getElementById('input-lunch-end'),
    notify: document.getElementById('input-notify'),
    sound: document.getElementById('input-sound'),
    alwaysOnTop: document.getElementById('input-ontop'),
    reduceMotion: document.getElementById('input-reduce-motion'),
    autoLaunch: document.getElementById('input-autolaunch'),
    desktopRun: document.getElementById('input-desktop-run'),
  },
  errors: {
    monthlySalary: document.getElementById('err-salary'),
    monthlyWorkdays: document.getElementById('err-workdays'),
    hourlyRate: document.getElementById('err-hourly'),
    workStart: document.getElementById('err-start'),
    workEnd: document.getElementById('err-end'),
    lunchStart: document.getElementById('err-lunch-start'),
    lunchEnd: document.getElementById('err-lunch-end'),
  },
  salaryType: document.getElementById('salary-type'),
  desktopRunMode: document.getElementById('desktop-run-mode'),
  fieldDesktopRunMode: document.getElementById('field-desktop-run-mode'),
  fieldSalary: document.getElementById('field-salary'),
  fieldWorkdays: document.getElementById('field-workdays'),
  fieldHourly: document.getElementById('field-hourly'),
  lunchTimes: document.getElementById('lunch-times'),
  customMascotName: document.getElementById('custom-mascot-name'),
  btnPickMascot: document.getElementById('btn-pick-mascot'),
  btnClearMascot: document.getElementById('btn-clear-mascot'),
  tabSettings: document.getElementById('tab-settings'),
  tabHistory: document.getElementById('tab-history'),
  panelSettings: document.getElementById('panel-settings'),
  panelHistory: document.getElementById('panel-history'),
  historySummary: document.getElementById('history-summary'),
  historyList: document.getElementById('history-list'),
  panelFoot: document.querySelector('.panel-foot'),
};

/** 浏览器里直接打开 index.html 时的降级桥，方便快速看样式。 */
function memoryBridge() {
  const KEY = 'xb:settings';
  return {
    async loadSettings() {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      } catch {
        saved = null;
      }
      return {
        settings: { ...DEFAULT_SETTINGS, ...(saved || {}) },
        hasSalary: Boolean(saved && Number(saved.monthlySalary) > 0),
        demo: { nowMs: null, screen: null },
        appVersion: 'dev',
      };
    },
    async saveSettings(next) {
      localStorage.setItem(KEY, JSON.stringify(next));
      return { ok: true, settings: next };
    },
    async setAlwaysOnTop() {
      return { ok: true };
    },
    setTrayTooltip() {},
    minimize() {},
    close() {},
    bossHide() {},
    async startDesktopRun() {
      return { ok: false, reason: '浏览器预览不支持桌面跑步' };
    },
    onOpenSettings() {
      return () => {};
    },
    onSettingsChanged() {
      return () => {};
    },
  };
}

const bridge = window.xb ?? memoryBridge();

const state = {
  settings: { ...DEFAULT_SETTINGS },
  salaryType: 'monthly',
  desktopRunMode: 'active',
  customMascot: null,
  hasSalary: false,
  demo: { nowMs: null, screen: null },
  mascot: null,
  mascotState: null,
  bubbleNonce: -1,
  bubbleState: null,
  bubbleLockUntil: 0,
  lastTooltipAt: 0,
  lastTooltip: '',
  celebratedDay: '',
  milestones: new Set(),
  panelOpen: false,
  firstRun: false,
};

const textCache = new Map();
function setText(el, value) {
  if (!el) return;
  const key = el.id || el;
  if (textCache.get(key) === value) return;
  textCache.set(key, value);
  el.textContent = value;
}

function nowMs() {
  return Number.isFinite(state.demo.nowMs) ? state.demo.nowMs : Date.now();
}

function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  let payload;
  try {
    payload = await bridge.loadSettings();
  } catch (err) {
    console.error('读取设置失败', err);
    payload = { settings: { ...DEFAULT_SETTINGS }, hasSalary: false, demo: {} };
  }

  state.demo = payload.demo || { nowMs: null, screen: null };
  state.settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
  state.hasSalary = Boolean(payload.hasSalary);
  state.mascot = createMascot(document.getElementById('mascot'));

  const versionEl = document.getElementById('app-version');
  if (versionEl && payload.appVersion) versionEl.textContent = `v${payload.appVersion}`;

  // 开发调试句柄（需 XB_DEBUG=1 且非打包环境），用于自测脚本触发彩蛋
  if (state.demo.debug) {
    window.__xb = {
      mascot: state.mascot,
      settings: () => state.settings,
      trigger: (tagOrId) => state.mascot?.playAction?.(tagOrId),
      // 手动触发“下班跑步”彩蛋（自测用）
      runEgg: () =>
        bridge.startDesktopRun?.({
          earned: state.hasSalary ? 0 : null,
        }),
    };
  }

  bindEvents();
  applySettings(state.settings, { silent: true });
  tick();
  window.setInterval(tick, TICK_MS);

  if (!state.hasSalary) {
    openPanel({ firstRun: true });
  } else if (state.demo.screen === 'settings') {
    openPanel();
  }
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

function tick() {
  const now = nowMs();
  let shift;
  try {
    shift = shiftFor(now, state.settings.workStart, state.settings.workEnd, lunchOption());
  } catch (err) {
    console.error('班次计算失败', err);
    return;
  }

  const pay = state.hasSalary ? payFor(state.settings, shift) : null;
  render(now, shift, pay);
}

function render(now, shift, pay) {
  const phase = shift.kind;
  if (els.body.dataset.phase !== phase) els.body.dataset.phase = phase;

  /* 顶部状态 */
  const statusText =
    phase === 'before'
      ? '还没开工'
      : phase === 'after'
        ? '下班啦'
        : phase === 'lunch'
          ? '午休中'
          : state.hasSalary
            ? '在岗摸鱼中'
            : '先设置一下';
  setText(els.status, statusText);
  if (els.status.dataset.phase !== phase) els.status.dataset.phase = phase;

  /* 倒计时 */
  const counting = phase === 'after' ? 0 : shift.remainSec;
  setText(els.countdown, formatHMS(counting));
  setText(
    els.countdownLabel,
    phase === 'before'
      ? '距离上班'
      : phase === 'after'
        ? '今天到此为止'
        : phase === 'lunch'
          ? '午休中 · 距下班'
          : '距离下班'
  );

  /* 进度 */
  const pct = Math.max(0, Math.min(1, shift.progress));
  const width = `${(pct * 100).toFixed(2)}%`;
  if (els.progressFill.dataset.w !== width) {
    els.progressFill.dataset.w = width;
    els.progressFill.style.width = width;
  }
  setText(els.progressText, `今天已过 ${formatPercent(pct)}%`);

  /* 金额 */
  if (pay) {
    setText(els.earned, formatMoney(pay.earned));
    setText(els.perMinute, formatMoney(pay.perMinute));
    setText(els.remaining, formatMoney(pay.remaining));
  } else {
    setText(els.earned, '--');
    setText(els.perMinute, '--');
    setText(els.remaining, '--');
  }

  /* 大肥鱼：午休时让她睡一觉 */
  const mood = phase === 'lunch' ? 'sleep' : stateFor(phase, pct);
  if (state.mascot && state.mascotState !== mood) {
    state.mascotState = mood;
    state.mascot.setState(mood);
  }

  /* 气泡文案：每 20 秒最多换一次；被戳后的吐槽短暂优先 */
  const nonce = Math.floor(now / BUBBLE_ROTATE_MS);
  const locked = Date.now() < state.bubbleLockUntil;
  if (!locked && (nonce !== state.bubbleNonce || state.bubbleState !== mood)) {
    state.bubbleNonce = nonce;
    state.bubbleState = mood;
    swapBubble(quoteFor(mood, nonce));
  } else if (locked) {
    state.bubbleState = mood;
  }

  /* 托盘提示 */
  updateTray(phase, counting);

  /* 工资里程碑彩蛋：25% / 50% / 75% 各一次 */
  if (phase === 'working' && state.hasSalary) {
    const MILESTONES = [
      [0.25, 'quarter'],
      [0.5, 'half'],
      [0.75, 'threeQuarter'],
    ];
    MILESTONES.forEach(([threshold, key]) => {
      if (pct >= threshold && !state.milestones.has(key)) {
        state.milestones.add(key);
        try {
          state.mascot?.playMilestone?.(key);
        } catch (err) {
          /* 彩蛋失败不影响主流程 */
        }
      }
    });
  }

  /* 下班撒花：每个自然日一次 */
  if (phase === 'after') {
    const key = dayKey(now);
    if (state.celebratedDay !== key) {
      state.celebratedDay = key;
      state.milestones.clear();
      try {
        state.mascot?.playMilestone?.('done');
      } catch (err) {
        /* 忽略 */
      }
      celebrate();
      runDesktopEgg(pay);
      finishDay(now, pay);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 下班彩蛋：大肥鱼从窗口跑出去到桌面撒欢                                 */
/* ------------------------------------------------------------------ */

/** 关掉彩蛋时，主进程会把最后一次结果缓存，避免每个 tick 都重试。 */
let desktopEggAttemptedDay = '';

/**
 * 触发“下班跑步”覆盖窗彩蛋。
 * 仅在：设置开启 desktopRun、未开启降低动态效果、桥支持 startDesktopRun 时才跑。
 * 任何失败都静默——它只是锦上添花，绝不能影响撒花/通知/记账。
 */
function runDesktopEgg(pay) {
  const today = dayKey(nowMs());
  if (desktopEggAttemptedDay === today) return;
  desktopEggAttemptedDay = today;

  if (!state.settings.desktopRun) return;
  if (state.settings.reduceMotion) return;
  const reduceBySystem =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceBySystem) return;
  if (typeof bridge.startDesktopRun !== 'function') return;

  const earned = pay && Number.isFinite(pay.earned) ? Math.round(pay.earned * 100) / 100 : null;
  Promise.resolve(bridge.startDesktopRun({ earned })).catch((err) => {
    console.warn('下班跑步彩蛋启动失败', err);
  });
}

/* ------------------------------------------------------------------ */
/* 下班收尾：通知 / 提示音 / 记一笔                                      */
/* ------------------------------------------------------------------ */

async function finishDay(now, pay) {
  const earned = pay ? pay.earned : 0;
  const dailyPay = pay ? pay.dailyPay : 0;

  if (state.settings.notifyOnDone) {
    try {
      await bridge.notifyDone?.({
        title: '下班啦 🎉',
        body: `今天赚了 ¥${formatMoney(earned)}，收拾东西回家吧。`,
      });
    } catch (err) {
      console.warn('系统通知失败', err);
    }
  }

  if (state.settings.soundOnDone) playChime();

  try {
    await bridge.recordHistory?.({ date: dayKey(now), earned, dailyPay });
  } catch (err) {
    console.warn('记录今日收入失败', err);
  }
}

/** 用 WebAudio 合成一段三音提示音，不依赖音频文件。 */
function playChime() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const start = ctx.currentTime + 0.02;
    const notes = [
      [880, 0],
      [1174.66, 0.12],
      [1567.98, 0.24],
    ];
    notes.forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.16, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.6);
    });
    window.setTimeout(() => ctx.close?.().catch?.(() => {}), 1400);
  } catch (err) {
    console.warn('提示音播放失败', err);
  }
}

let bubbleTimer = null;
function swapBubble(text) {
  if (!els.bubble || !text) return;
  if (els.bubble.textContent === text) return;
  els.bubble.classList.add('is-swapping');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    els.bubble.textContent = text;
    els.bubble.classList.remove('is-swapping');
  }, 160);
}

function updateTray(phase, remainSec) {
  const now = Date.now();
  if (now - state.lastTooltipAt < 1000) return;
  state.lastTooltipAt = now;
  const prefix =
    phase === 'before' ? '距上班' : phase === 'after' ? '已下班' : phase === 'lunch' ? '午休中 · 距下班' : '距下班';
  const text = `鱼快下班 · ${prefix} ${formatHMS(remainSec)}`;
  if (text === state.lastTooltip) return;
  state.lastTooltip = text;
  bridge.setTrayTooltip(text);
}

/* ------------------------------------------------------------------ */
/* 撒花                                                                */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#7de3f4', '#4d6bfe', '#ffb86b', '#ff8ea8', '#b8ffd9', '#ffffff'];

function celebrate() {
  if (!els.confetti) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  els.confetti.textContent = '';
  const count = 28;
  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 140}px`);
    piece.style.setProperty('--spin', `${180 + Math.random() * 540}deg`);
    piece.style.setProperty('--delay', `${Math.random() * 0.5}s`);
    piece.style.setProperty('--dur', `${1.7 + Math.random() * 1.1}s`);
    els.confetti.appendChild(piece);
  }
  window.setTimeout(() => {
    if (els.confetti) els.confetti.textContent = '';
  }, 3200);
}

/* ------------------------------------------------------------------ */
/* 设置应用 / 面板                                                     */
/* ------------------------------------------------------------------ */

function applySettings(next, opts = {}) {
  state.settings = { ...DEFAULT_SETTINGS, ...next };
  state.salaryType = state.settings.salaryType === 'hourly' ? 'hourly' : 'monthly';
  state.hasSalary =
    state.settings.salaryType === 'hourly'
      ? Number(state.settings.hourlyRate) > 0
      : Number(state.settings.monthlySalary) > 0;
  state.customMascot = state.settings.customMascot || null;
  setDesktopRunModeUI(state.settings.desktopRunMode);

  if (els.pin) els.pin.setAttribute('aria-pressed', String(Boolean(state.settings.alwaysOnTop)));

  // 把「降低动态效果」同步给大肥鱼（系统级 prefers-reduced-motion 由 CSS 兜底）
  try {
    state.mascot?.setMotion?.({ reduceMotion: Boolean(state.settings.reduceMotion) });
  } catch (err) {
    console.warn('设置动效偏好失败', err);
  }

  applyCustomMascot();
  updateCustomMascotUI();

  const { workStart, workEnd } = state.settings;
  setText(els.shiftText, `${workStart} – ${workEnd}`);
  let lunchText = '';
  if (state.settings.lunchEnabled) {
    const a = toMinutes(state.settings.lunchStart);
    const b = toMinutes(state.settings.lunchEnd);
    if (a !== null && b !== null && b > a) {
      const hours = (b - a) / 60;
      lunchText = ` · 午休${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
    }
  }
  setText(els.footerShift, `${workStart} 上班 · ${workEnd} 下班${lunchText}`);

  if (!opts.silent) {
    state.mascotState = null;
    state.bubbleState = null;
    state.lastTooltip = '';
    tick();
  }
}

/** 'HH:MM' -> 分钟；非法返回 null。 */
function toMinutes(text) {
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : null;
}

/** 应用自定义形象（图片/视频），没有则回到内置桌宠。 */
async function applyCustomMascot() {
  const file = state.customMascot;
  try {
    if (!file) {
      state.mascot?.clearCustomMedia?.();
      return;
    }
    const res = await bridge.customMascotUrl?.();
    if (res && res.url) {
      const kind = /\.(mp4|webm|mov|m4v)$/i.test(file) ? 'video' : 'image';
      state.mascot?.setCustomMedia?.(res.url, kind);
    }
  } catch (err) {
    console.warn('应用自定义形象失败', err);
  }
}

const FIELD_MAP = {
  monthlySalary: ['input-salary', 'err-salary'],
  monthlyWorkdays: ['input-workdays', 'err-workdays'],
  hourlyRate: ['input-hourly', 'err-hourly'],
  workStart: ['input-start', 'err-start'],
  workEnd: ['input-end', 'err-end'],
  lunchStart: ['input-lunch-start', 'err-lunch-start'],
  lunchEnd: ['input-lunch-end', 'err-lunch-end'],
};

function clearErrors() {
  Object.values(els.errors).forEach((el) => {
    if (el) el.textContent = '';
  });
  Object.values(els.inputs).forEach((el) => el && el.classList.remove('is-invalid'));
  if (els.formError) {
    els.formError.hidden = true;
    els.formError.textContent = '';
  }
}

function showErrors(errors) {
  clearErrors();
  let firstInvalid = null;
  Object.entries(errors || {}).forEach(([field, message]) => {
    const ids = FIELD_MAP[field];
    if (!ids) {
      if (els.formError) {
        els.formError.hidden = false;
        els.formError.textContent = message;
      }
      return;
    }
    const [inputId, errorId] = ids;
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.textContent = message;
    if (input) {
      input.classList.add('is-invalid');
      if (!firstInvalid) firstInvalid = input;
    }
  });
  if (firstInvalid) firstInvalid.focus();
}

function setSalaryTypeUI(type) {
  state.salaryType = type === 'hourly' ? 'hourly' : 'monthly';
  const monthly = state.salaryType === 'monthly';
  if (els.fieldSalary) els.fieldSalary.hidden = !monthly;
  if (els.fieldWorkdays) els.fieldWorkdays.hidden = !monthly;
  if (els.fieldHourly) els.fieldHourly.hidden = monthly;
  if (els.salaryType) {
    els.salaryType.querySelectorAll('.seg').forEach((btn) => {
      const active = btn.dataset.type === state.salaryType;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
}

function setLunchUI(enabled) {
  if (els.lunchTimes) els.lunchTimes.hidden = !enabled;
}

/** 彩蛋节奏（安静/活跃）分段控件。 */
function setDesktopRunModeUI(mode) {
  state.desktopRunMode = mode === 'calm' ? 'calm' : 'active';
  if (els.desktopRunMode) {
    els.desktopRunMode.querySelectorAll('.seg').forEach((btn) => {
      const active = btn.dataset.mode === state.desktopRunMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
}

function updateCustomMascotUI() {
  const file = state.customMascot;
  if (els.customMascotName) els.customMascotName.textContent = file ? '自定义形象' : '内置桌宠';
  if (els.btnClearMascot) els.btnClearMascot.hidden = !file;
}

function fillPanel() {
  const s = state.settings;
  setSalaryTypeUI(s.salaryType);
  setDesktopRunModeUI(s.desktopRunMode);
  if (els.inputs.monthlySalary) {
    els.inputs.monthlySalary.value = Number(s.monthlySalary) > 0 ? String(s.monthlySalary) : '';
  }
  if (els.inputs.monthlyWorkdays) {
    els.inputs.monthlyWorkdays.value = String(s.monthlyWorkdays || DEFAULT_SETTINGS.monthlyWorkdays);
  }
  if (els.inputs.hourlyRate) {
    els.inputs.hourlyRate.value = Number(s.hourlyRate) > 0 ? String(s.hourlyRate) : '';
  }
  if (els.inputs.workStart) els.inputs.workStart.value = s.workStart;
  if (els.inputs.workEnd) els.inputs.workEnd.value = s.workEnd;
  if (els.inputs.lunchEnabled) els.inputs.lunchEnabled.checked = Boolean(s.lunchEnabled);
  setLunchUI(Boolean(s.lunchEnabled));
  if (els.inputs.lunchStart) els.inputs.lunchStart.value = s.lunchStart || '12:00';
  if (els.inputs.lunchEnd) els.inputs.lunchEnd.value = s.lunchEnd || '13:00';
  if (els.inputs.notify) els.inputs.notify.checked = s.notifyOnDone !== false;
  if (els.inputs.sound) els.inputs.sound.checked = s.soundOnDone !== false;
  if (els.inputs.alwaysOnTop) els.inputs.alwaysOnTop.checked = Boolean(s.alwaysOnTop);
  if (els.inputs.reduceMotion) els.inputs.reduceMotion.checked = Boolean(s.reduceMotion);
  if (els.inputs.autoLaunch) els.inputs.autoLaunch.checked = Boolean(s.autoLaunch);
  if (els.inputs.desktopRun) els.inputs.desktopRun.checked = s.desktopRun !== false;
  updateCustomMascotUI();
  updatePreview();
}

function readPanel() {
  return {
    version: 2,
    salaryType: state.salaryType,
    monthlySalary: els.inputs.monthlySalary?.value ?? '',
    monthlyWorkdays: els.inputs.monthlyWorkdays?.value ?? '',
    hourlyRate: els.inputs.hourlyRate?.value ?? '',
    workStart: els.inputs.workStart?.value ?? '',
    workEnd: els.inputs.workEnd?.value ?? '',
    lunchEnabled: Boolean(els.inputs.lunchEnabled?.checked),
    lunchStart: els.inputs.lunchStart?.value ?? '',
    lunchEnd: els.inputs.lunchEnd?.value ?? '',
    alwaysOnTop: Boolean(els.inputs.alwaysOnTop?.checked),
    reduceMotion: Boolean(els.inputs.reduceMotion?.checked),
    notifyOnDone: Boolean(els.inputs.notify?.checked),
    soundOnDone: Boolean(els.inputs.sound?.checked),
    autoLaunch: Boolean(els.inputs.autoLaunch?.checked),
    desktopRun: Boolean(els.inputs.desktopRun?.checked),
    desktopRunMode: state.desktopRunMode === 'calm' ? 'calm' : 'active',
    customMascot: state.customMascot,
  };
}

/** 午休配置：传给 calc 的 shiftFor。 */
function lunchOption(settings = state.settings) {
  return { enabled: Boolean(settings.lunchEnabled), start: settings.lunchStart, end: settings.lunchEnd };
}

function updatePreview() {
  if (!els.preview) return;
  const draft = readPanel();
  const hourly = draft.salaryType === 'hourly';
  const salary = Number(hourly ? draft.hourlyRate : draft.monthlySalary);
  const workdays = Number(draft.monthlyWorkdays);
  const salaryOk = hourly ? Number.isFinite(salary) && salary > 0 : Number.isFinite(salary) && salary > 0 && Number.isFinite(workdays) && workdays > 0;
  if (!salaryOk) {
    els.preview.textContent = '日薪 ¥-- · 每分钟 ¥--';
    return;
  }
  try {
    const shift = shiftFor(nowMs(), draft.workStart, draft.workEnd, lunchOption(draft));
    const pay = payFor({ ...DEFAULT_SETTINGS, ...draft }, shift);
    const hours = (shift.effectiveTotalSec || shift.totalSec) / 3600;
    const hoursText = hours.toFixed(1).replace(/\.0$/, '');
    els.preview.textContent = `日薪 ¥${formatMoney(pay.dailyPay)} · 每分钟 ¥${formatMoney(pay.perMinute)} · ${hoursText} 小时`;
  } catch {
    els.preview.textContent = '日薪 ¥-- · 每分钟 ¥--';
  }
}

function openPanel(opts = {}) {
  if (!els.panel) return;
  state.panelOpen = true;
  state.firstRun = Boolean(opts.firstRun);
  clearErrors();
  fillPanel();
  showTab('settings');
  els.panel.hidden = false;
  if (els.scrim) els.scrim.hidden = false;
  requestAnimationFrame(() => {
    els.panel.classList.add('is-open');
    if (els.scrim) els.scrim.classList.add('is-open');
  });
  els.panel.setAttribute('aria-hidden', 'false');

  if (opts.firstRun) {
    window.setTimeout(() => els.inputs.monthlySalary?.focus(), 320);
  }
}

function closePanel() {
  if (!els.panel || !state.panelOpen) return;
  state.panelOpen = false;
  els.panel.classList.remove('is-open');
  if (els.scrim) els.scrim.classList.remove('is-open');
  els.panel.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (state.panelOpen) return;
    els.panel.hidden = true;
    if (els.scrim) els.scrim.hidden = true;
  }, 300);
}

async function savePanel() {
  const draft = readPanel();
  const check = validateSettings(draft);
  if (!check.ok) {
    showErrors(check.errors);
    return;
  }

  let result;
  try {
    result = await bridge.saveSettings(draft);
  } catch (err) {
    showErrors({ form: `保存失败：${err.message}` });
    return;
  }
  if (!result || !result.ok) {
    showErrors(result?.errors || { form: '保存失败' });
    return;
  }

  applySettings(result.settings);

  // 开机自启需要主进程配合
  const wantsAutoLaunch = Boolean(result.settings.autoLaunch);
  try {
    await bridge.setAutoLaunch?.(wantsAutoLaunch);
  } catch (err) {
    console.warn('设置开机自启失败', err);
  }

  closePanel();
}

/* ------------------------------------------------------------------ */
/* 设置面板：页签与历史记录                                             */
/* ------------------------------------------------------------------ */

function showTab(which) {
  const history = which === 'history';
  if (els.panelSettings) els.panelSettings.hidden = history;
  if (els.panelHistory) els.panelHistory.hidden = !history;
  if (els.panelFoot) els.panelFoot.hidden = history;
  if (els.tabSettings) {
    els.tabSettings.classList.toggle('is-active', !history);
    els.tabSettings.setAttribute('aria-selected', String(!history));
  }
  if (els.tabHistory) {
    els.tabHistory.classList.toggle('is-active', history);
    els.tabHistory.setAttribute('aria-selected', String(history));
  }
  if (history) loadHistory();
}

async function loadHistory() {
  let items = [];
  try {
    const res = await bridge.loadHistory?.();
    items = (res && res.items) || [];
  } catch (err) {
    console.warn('读取历史失败', err);
  }
  renderHistory(items);
}

function renderHistory(items) {
  if (!els.historyList) return;
  const recent = items.slice(-7).reverse();
  els.historyList.textContent = '';

  if (!recent.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = '还没有记录，今天下班后就会自动记一笔。';
    els.historyList.appendChild(empty);
  } else {
    recent.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = String(item.date || '').slice(5);

      const money = document.createElement('span');
      money.className = 'money';
      money.textContent = `¥${formatMoney(Number(item.earned) || 0)}`;

      li.append(date, money);
      els.historyList.appendChild(li);
    });
  }

  if (els.historySummary) {
    const total = recent.reduce((sum, item) => sum + (Number(item.earned) || 0), 0);
    const days = recent.length;
    els.historySummary.textContent = days
      ? `最近 ${days} 天合计 ¥${formatMoney(total)} · 日均 ¥${formatMoney(total / days)}`
      : '最近 7 天：暂无记录';
  }
}

/* ------------------------------------------------------------------ */
/* 自定义形象                                                          */
/* ------------------------------------------------------------------ */

async function pickCustomMascot() {
  let res;
  try {
    res = await bridge.pickCustomMascot?.();
  } catch (err) {
    console.warn('选择形象失败', err);
    return;
  }
  if (!res || !res.ok) return;
  state.customMascot = res.file || 'custom';
  state.settings.customMascot = res.file || 'custom';
  updateCustomMascotUI();
  await applyCustomMascot();
}

async function clearCustomMascot() {
  try {
    await bridge.clearCustomMascot?.();
  } catch (err) {
    console.warn('清除自定义形象失败', err);
  }
  state.customMascot = null;
  state.settings.customMascot = null;
  updateCustomMascotUI();
  state.mascot?.clearCustomMedia?.();
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

let pinBusy = false;
async function togglePin() {
  if (pinBusy) return;
  pinBusy = true;
  try {
    const next = !state.settings.alwaysOnTop;
    const result = await bridge.setAlwaysOnTop(next);
    if (result && result.ok) {
      state.settings.alwaysOnTop = Boolean(result.alwaysOnTop);
      if (els.pin) els.pin.setAttribute('aria-pressed', String(state.settings.alwaysOnTop));
    }
  } finally {
    pinBusy = false;
  }
}

/** 戳一下大肥鱼：播放被戳动作 + 说一句吐槽，短暂优先于常规气泡。 */
function pokeMascot() {
  const pool =
    Array.isArray(MascotModule.POKE_QUOTES) && MascotModule.POKE_QUOTES.length
      ? MascotModule.POKE_QUOTES
      : FALLBACK_POKE_QUOTES;
  let line = '';
  try {
    // v2 的 poke() 会直接返回一句该状态下的吐槽；没有就退回本地文案池。
    line = state.mascot?.poke?.() || '';
  } catch (err) {
    console.warn('大肥鱼被戳出错', err);
  }
  if (!line) line = pool[Math.floor(Math.random() * pool.length)];
  state.bubbleLockUntil = Date.now() + 2600;
  swapBubble(line);
}

let lookRaf = 0;
function handlePointerMove(event) {
  if (!state.mascot?.setLook) return;
  const target = document.getElementById('mascot');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const nx = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.7)));
  const ny = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.7)));
  if (lookRaf) return;
  lookRaf = requestAnimationFrame(() => {
    lookRaf = 0;
    try {
      state.mascot?.setLook?.(nx, ny);
    } catch (err) {
      /* setLook 是渐进增强能力，失败不影响主流程 */
    }
  });
}

function bindEvents() {
  document.getElementById('mascot')?.addEventListener('click', pokeMascot);
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.getElementById('mascot')?.addEventListener('pointerleave', () => {
    try {
      state.mascot?.setLook?.(0, 0);
    } catch (err) {
      /* 忽略 */
    }
  });

  document.getElementById('btn-pin')?.addEventListener('click', togglePin);
  document.getElementById('btn-settings')?.addEventListener('click', () => openPanel());
  document.getElementById('btn-open-settings')?.addEventListener('click', () => openPanel());
  document.getElementById('btn-minimize')?.addEventListener('click', () => bridge.minimize());
  document.getElementById('btn-boss')?.addEventListener('click', () => bridge.bossHide?.());
  document.getElementById('btn-close')?.addEventListener('click', () => bridge.close());

  document.getElementById('btn-panel-close')?.addEventListener('click', closePanel);
  document.getElementById('btn-cancel')?.addEventListener('click', closePanel);
  document.getElementById('btn-save')?.addEventListener('click', savePanel);
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    setSalaryTypeUI('monthly');
    if (els.inputs.monthlySalary) els.inputs.monthlySalary.value = '';
    if (els.inputs.monthlyWorkdays) els.inputs.monthlyWorkdays.value = String(DEFAULT_SETTINGS.monthlyWorkdays);
    if (els.inputs.hourlyRate) els.inputs.hourlyRate.value = '';
    if (els.inputs.workStart) els.inputs.workStart.value = DEFAULT_SETTINGS.workStart;
    if (els.inputs.workEnd) els.inputs.workEnd.value = DEFAULT_SETTINGS.workEnd;
    if (els.inputs.lunchEnabled) els.inputs.lunchEnabled.checked = false;
    setLunchUI(false);
    if (els.inputs.lunchStart) els.inputs.lunchStart.value = DEFAULT_SETTINGS.lunchStart || '12:00';
    if (els.inputs.lunchEnd) els.inputs.lunchEnd.value = DEFAULT_SETTINGS.lunchEnd || '13:00';
    if (els.inputs.notify) els.inputs.notify.checked = true;
    if (els.inputs.sound) els.inputs.sound.checked = true;
    if (els.inputs.alwaysOnTop) els.inputs.alwaysOnTop.checked = true;
    if (els.inputs.reduceMotion) els.inputs.reduceMotion.checked = false;
    if (els.inputs.autoLaunch) els.inputs.autoLaunch.checked = false;
    if (els.inputs.desktopRun) els.inputs.desktopRun.checked = true;
    setDesktopRunModeUI('active');
    if (els.fieldDesktopRunMode) els.fieldDesktopRunMode.style.opacity = '';
    clearErrors();
    updatePreview();
    els.inputs.monthlySalary?.focus();
  });

  /* 计薪方式切换 */
  els.salaryType?.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    setSalaryTypeUI(btn.dataset.type);
    clearErrors();
    updatePreview();
  });

  /* 彩蛋节奏切换 */
  els.desktopRunMode?.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    setDesktopRunModeUI(btn.dataset.mode);
  });

  /* 关闭彩蛋时，节奏选择置灰 */
  els.inputs.desktopRun?.addEventListener('change', () => {
    if (els.fieldDesktopRunMode) els.fieldDesktopRunMode.style.opacity = els.inputs.desktopRun.checked ? '' : '0.45';
  });

  /* 午休开关联动显示时间 */
  els.inputs.lunchEnabled?.addEventListener('change', () => {
    setLunchUI(Boolean(els.inputs.lunchEnabled.checked));
    updatePreview();
  });

  /* 设置面板页签 */
  els.tabSettings?.addEventListener('click', () => showTab('settings'));
  els.tabHistory?.addEventListener('click', () => showTab('history'));

  /* 自定义形象 */
  els.btnPickMascot?.addEventListener('click', pickCustomMascot);
  els.btnClearMascot?.addEventListener('click', clearCustomMascot);

  Object.values(els.inputs).forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      input.classList.remove('is-invalid');
      updatePreview();
    });
    input.addEventListener('change', updatePreview);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        savePanel();
      }
    });
  });

  els.scrim?.addEventListener('click', closePanel);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.panelOpen) {
      event.preventDefault();
      closePanel();
    } else if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      openPanel();
    }
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());

  bridge.onOpenSettings(() => openPanel());
  bridge.onSettingsChanged((next) => {
    if (!next) return;
    applySettings(next);
    if (els.inputs.alwaysOnTop) els.inputs.alwaysOnTop.checked = Boolean(next.alwaysOnTop);
  });
}

boot();

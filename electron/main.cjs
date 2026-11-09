'use strict';

/**
 * 鱼快下班 —— Electron 主进程
 * 负责：无边框窗口、置顶、托盘、设置与窗口位置的持久化、单实例。
 *
 * P2 新增：开机自启、下班系统通知、每日收入历史、自定义桌宠形象
 * （通过 xb-media:// 协议把 userData/mascot 下的文件安全地暴露给渲染层）。
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  session,
  dialog,
  Notification,
  protocol,
  net,
  globalShortcut,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runner = require('./runner.cjs');

const APP_NAME = '鱼快下班';
const ROOT = path.join(__dirname, '..');
const WIN_SIZE = { width: 420, height: 620 };
const ASSETS = path.join(ROOT, 'assets');

/** 自定义桌宠媒体协议：xb-media://local/<文件名>，只暴露 userData/mascot 目录内的文件。 */
const MEDIA_SCHEME = 'xb-media';
const MEDIA_HOST = 'local';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

/** 历史记录最多保留最近 60 天。 */
const HISTORY_LIMIT = 60;
/** 自定义形象体积上限，避免误选超大视频把配置目录撑爆。 */
const MAX_MASCOT_BYTES = 512 * 1024 * 1024;
/** 设置 schema 版本：v2 在 v1 基础上增加午休/通知/自启/自定义形象/语言。 */
const SETTINGS_VERSION = 2;

app.setName(APP_NAME);
// 开发自测时可用 XB_USERDATA 指定独立的配置目录，避免污染真实配置。
if (process.env.XB_USERDATA) {
  app.setPath('userData', process.env.XB_USERDATA);
}

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  salaryType: 'monthly',
  monthlySalary: null,
  monthlyWorkdays: 21.75,
  hourlyRate: null,
  workStart: '09:00',
  workEnd: '18:00',
  alwaysOnTop: true,
  reduceMotion: false,
  // ---- v2 新增 ----
  lunchEnabled: false,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  notifyOnDone: true,
  soundOnDone: true,
  autoLaunch: false,
  customMascot: null, // userData/mascot/ 下的文件名；null = 使用内置桌宠
  language: 'zh',
  // ---- P3 新增：下班跑出桌面彩蛋 ----
  desktopRun: true, // 到点让大肥鱼从窗口跑到桌面上撒欢（可关）
  desktopRunMode: 'active', // 彩蛋节奏：'calm' 安静 / 'active' 活跃
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CUSTOM_MASCOT_NAME = /^custom-\d{6,20}\.(png|jpe?g|gif|webp|mp4|webm)$/i;

// 自定义协议必须在 app ready 之前声明权限，否则 <video> 无法流式播放。
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let tray = null;
let settings = { ...DEFAULT_SETTINGS };
let quitting = false;
/** 持有通知对象引用，避免被 GC 后通知提前消失。 */
const liveNotifications = new Set();

/* ------------------------------------------------------------------ */
/* 文件读写                                                            */
/* ------------------------------------------------------------------ */

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function historyFile() {
  return path.join(app.getPath('userData'), 'history.json');
}

function mascotDir() {
  return path.join(app.getPath('userData'), 'mascot');
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    // 容忍记事本等编辑器写入的 UTF-8 BOM。
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!data || typeof data !== 'object') throw new Error('内容不是对象');
    return data;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      // 损坏的文件先备份一份，方便排查，不静默丢弃用户数据。
      try {
        fs.renameSync(file, `${file}.broken-${Date.now()}`);
        console.warn(`[settings] 文件损坏，已备份：${file}`);
      } catch (backupErr) {
        console.warn('[settings] 备份损坏文件失败', backupErr);
      }
    }
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ------------------------------------------------------------------ */
/* 设置校验                                                            */
/* ------------------------------------------------------------------ */

function pickNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** 布尔字段：缺失/类型不对时回退默认值（兼容 v1 旧配置升级）。 */
function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function minutesFromHHMM(text) {
  const matched = HHMM.exec(text);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : null;
}

/** 班次总分钟数（下班早于上班视为跨夜）。 */
function shiftMinutesBetween(startText, endText) {
  const startMinutes = minutesFromHHMM(startText);
  const endMinutes = minutesFromHHMM(endText);
  if (startMinutes === null || endMinutes === null) return 0;
  return endMinutes > startMinutes ? endMinutes - startMinutes : 24 * 60 - startMinutes + endMinutes;
}

/** 校验午休时段：必须合法、非零时长，且完整落在班次内（与渲染层 calc 的偏移规则一致）。 */
function lunchTimeError(lunchStart, lunchEnd, workStart, workEnd) {
  if (lunchStart === lunchEnd) return { field: 'lunchEnd', message: '午休结束时间不能与开始时间相同' };
  const shiftMinutes = shiftMinutesBetween(workStart, workEnd);
  if (shiftMinutes <= 0) return null; // 班次本身非法，已有对应错误
  const startMinutes = minutesFromHHMM(lunchStart);
  const endMinutes = minutesFromHHMM(lunchEnd);
  const workStartMinutes = minutesFromHHMM(workStart);
  const startOffset = (startMinutes - workStartMinutes + 24 * 60) % (24 * 60);
  const endOffset = (endMinutes - workStartMinutes + 24 * 60) % (24 * 60);
  if (endOffset <= startOffset) return { field: 'lunchEnd', message: '午休结束时间必须晚于开始时间' };
  if (startOffset >= shiftMinutes) return { field: 'lunchStart', message: '午休开始时间需落在上班时间内' };
  if (endOffset > shiftMinutes) return { field: 'lunchEnd', message: '午休结束时间需落在上班时间内' };
  return null;
}

/** 自定义桌宠文件名必须是 userData/mascot 下的安全文件名。 */
function sanitizeMascotName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!CUSTOM_MASCOT_NAME.test(name)) return null;
  if (name !== path.basename(name)) return null;
  return name;
}

/**
 * 主进程侧的最后一道校验：渲染进程传来的数据一律当作不可信输入。
 * 返回 { ok, errors, settings }。
 */
function validateAndSanitize(raw) {
  const errors = {};
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: { form: '设置数据无效' } };
  }

  const out = { ...DEFAULT_SETTINGS };
  out.version = SETTINGS_VERSION;
  out.salaryType = raw.salaryType === 'hourly' ? 'hourly' : 'monthly';

  const monthlySalary = pickNumber(raw.monthlySalary);
  const monthlyWorkdays = pickNumber(raw.monthlyWorkdays);
  const hourlyRate = pickNumber(raw.hourlyRate);

  if (out.salaryType === 'monthly') {
    if (monthlySalary === null || Number.isNaN(monthlySalary)) {
      errors.monthlySalary = '请填写月薪';
    } else if (monthlySalary <= 0) {
      errors.monthlySalary = '月薪必须大于 0';
    } else if (monthlySalary > 100000000) {
      errors.monthlySalary = '月薪数值过大';
    }

    if (monthlyWorkdays === null || Number.isNaN(monthlyWorkdays)) {
      errors.monthlyWorkdays = '请填写每月计薪天数';
    } else if (monthlyWorkdays <= 0 || monthlyWorkdays > 31) {
      errors.monthlyWorkdays = '计薪天数需在 0–31 之间';
    }
    out.monthlySalary = monthlySalary;
    out.monthlyWorkdays = monthlyWorkdays === null ? DEFAULT_SETTINGS.monthlyWorkdays : monthlyWorkdays;
    out.hourlyRate = null;
  } else {
    if (hourlyRate === null || Number.isNaN(hourlyRate)) {
      errors.hourlyRate = '请填写时薪';
    } else if (hourlyRate <= 0) {
      errors.hourlyRate = '时薪必须大于 0';
    }
    out.hourlyRate = hourlyRate;
    out.monthlySalary = null;
    out.monthlyWorkdays = DEFAULT_SETTINGS.monthlyWorkdays;
  }

  const start = typeof raw.workStart === 'string' ? raw.workStart.trim() : '';
  const end = typeof raw.workEnd === 'string' ? raw.workEnd.trim() : '';

  if (!HHMM.test(start)) {
    errors.workStart = '上班时间格式应为 HH:MM';
  }
  if (!HHMM.test(end)) {
    errors.workEnd = '下班时间格式应为 HH:MM';
  }
  if (!errors.workStart && !errors.workEnd && start === end) {
    errors.workEnd = '下班时间不能与上班时间相同';
  }
  out.workStart = HHMM.test(start) ? start : DEFAULT_SETTINGS.workStart;
  out.workEnd = HHMM.test(end) ? end : DEFAULT_SETTINGS.workEnd;

  // ---- v2：午休不计薪（未启用时不校验具体时间，避免历史配置升级后无法保存） ----
  out.lunchEnabled = boolOr(raw.lunchEnabled, DEFAULT_SETTINGS.lunchEnabled);
  const lunchStart = typeof raw.lunchStart === 'string' ? raw.lunchStart.trim() : '';
  const lunchEnd = typeof raw.lunchEnd === 'string' ? raw.lunchEnd.trim() : '';
  out.lunchStart = HHMM.test(lunchStart) ? lunchStart : DEFAULT_SETTINGS.lunchStart;
  out.lunchEnd = HHMM.test(lunchEnd) ? lunchEnd : DEFAULT_SETTINGS.lunchEnd;

  if (out.lunchEnabled) {
    const lunchStartOk = HHMM.test(lunchStart);
    const lunchEndOk = HHMM.test(lunchEnd);
    if (!lunchStartOk) errors.lunchStart = '午休开始时间格式应为 HH:MM';
    if (!lunchEndOk) errors.lunchEnd = '午休结束时间格式应为 HH:MM';
    if (lunchStartOk && lunchEndOk && !errors.workStart && !errors.workEnd) {
      const lunchError = lunchTimeError(lunchStart, lunchEnd, out.workStart, out.workEnd);
      if (lunchError) errors[lunchError.field] = lunchError.message;
    }
  }

  // ---- v2：通知 / 自启 / 自定义形象 / 语言 ----
  out.alwaysOnTop = boolOr(raw.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop);
  out.reduceMotion = boolOr(raw.reduceMotion, DEFAULT_SETTINGS.reduceMotion);
  out.notifyOnDone = boolOr(raw.notifyOnDone, DEFAULT_SETTINGS.notifyOnDone);
  out.soundOnDone = boolOr(raw.soundOnDone, DEFAULT_SETTINGS.soundOnDone);
  out.autoLaunch = boolOr(raw.autoLaunch, DEFAULT_SETTINGS.autoLaunch);
  out.customMascot = sanitizeMascotName(raw.customMascot);
  out.language = raw.language === 'en' ? 'en' : DEFAULT_SETTINGS.language;
  out.desktopRun = boolOr(raw.desktopRun, DEFAULT_SETTINGS.desktopRun);
  out.desktopRunMode = raw.desktopRunMode === 'calm' ? 'calm' : 'active';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors: {}, settings: out };
}

function hasSalary(s) {
  if (!s) return false;
  if (s.salaryType === 'hourly') return Number.isFinite(s.hourlyRate) && s.hourlyRate > 0;
  return Number.isFinite(s.monthlySalary) && s.monthlySalary > 0;
}

function loadSettings() {
  const raw = readJson(settingsFile(), null);
  if (!raw) return { ...DEFAULT_SETTINGS };
  const result = validateAndSanitize(raw);
  if (!result.ok) {
    console.warn('[settings] 配置文件不合法，使用默认值', result.errors);
    return { ...DEFAULT_SETTINGS, alwaysOnTop: boolOr(raw.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop) };
  }
  const loaded = result.settings;
  if (loaded.customMascot && !resolveMascotPath(loaded.customMascot)) {
    console.warn('[mascot] 自定义形象文件不存在，回退到内置桌宠：', loaded.customMascot);
    loaded.customMascot = null;
  }
  return loaded;
}

/* ------------------------------------------------------------------ */
/* 自定义桌宠：文件名解析 / 协议                                       */
/* ------------------------------------------------------------------ */

/**
 * 把“文件名”解析为 userData/mascot 内的绝对路径。
 * 任何路径穿越、非白名单扩展名、越界符号链接、文件不存在都返回 null。
 */
function resolveMascotPath(name) {
  if (typeof name !== 'string') return null;
  const fileName = name.trim();
  if (!fileName || fileName !== path.basename(fileName)) return null;
  if (fileName === '.' || fileName === '..' || fileName.startsWith('.')) return null;
  // Windows 文件名非法字符 + 控制字符，同时排除任何分隔符。
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(fileName)) return null;
  const ext = path.extname(fileName).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return null;

  const dir = path.resolve(mascotDir());
  const abs = path.resolve(dir, fileName);
  if (path.dirname(abs).toLowerCase() !== dir.toLowerCase()) return null;

  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;
    // 额外用 realpath 抵挡符号链接逃逸：真实路径必须仍在 mascot 目录内。
    const realDir = fs.realpathSync(dir);
    const realAbs = fs.realpathSync(abs);
    const relative = path.relative(realDir, realAbs);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  } catch {
    return null;
  }
  return abs;
}

function mascotKind(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

function customMascotPayload() {
  const name = settings.customMascot;
  if (!name) return { url: null, file: null, kind: null };
  const abs = resolveMascotPath(name);
  if (!abs) return { url: null, file: null, kind: null };
  return {
    url: `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(name)}`,
    file: name,
    kind: mascotKind(name),
  };
}

function mediaError(status, message) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** 只把 userData/mascot 内的媒体文件通过 xb-media://local/<文件名> 暴露出去。 */
async function handleMediaRequest(request) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return mediaError(405, '不支持的请求方法');
    }
    const url = new URL(request.url);
    if (url.hostname !== MEDIA_HOST) return mediaError(403, '不允许的媒体地址');

    let fileName;
    try {
      fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return mediaError(400, '媒体地址无效');
    }

    const absPath = resolveMascotPath(fileName);
    if (!absPath) return mediaError(404, '媒体文件不存在');
    return await net.fetch(pathToFileURL(absPath).toString());
  } catch (err) {
    console.warn('[xb-media] 读取媒体失败', err);
    return mediaError(500, '读取媒体失败');
  }
}

function registerMediaProtocol() {
  try {
    protocol.handle(MEDIA_SCHEME, handleMediaRequest);
  } catch (err) {
    console.warn('[xb-media] 注册自定义协议失败', err);
  }
}

/* ------------------------------------------------------------------ */
/* 历史记录                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把日期键归一化为 'YYYY-MM-DD'。
 * 渲染层的 dayKey() 可能给出未补零的 '2026-11-6'，这里一并兼容；非法日期返回 null。
 */
function normalizeDateKey(text) {
  if (typeof text !== 'string') return null;
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 金额：非负有限数字，最多两位小数；非法返回 null。 */
function pickMoney(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) return null;
  return Math.round(n * 100) / 100;
}

function sanitizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = normalizeDateKey(raw.date);
  if (!date) return null;
  const earned = pickMoney(raw.earned);
  const dailyPay = pickMoney(raw.dailyPay);
  if (earned === null || dailyPay === null) return null;
  return { date, earned, dailyPay };
}

function byDateAscending(a, b) {
  if (a.date === b.date) return 0;
  return a.date < b.date ? -1 : 1;
}

/** 读取历史：同一天去重（后写覆盖）、按日期升序、只保留最近 60 条。 */
function loadHistory() {
  const raw = readJson(historyFile(), null);
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
  const byDate = new Map();
  for (const item of list) {
    const clean = sanitizeHistoryEntry(item);
    if (clean) byDate.set(clean.date, clean);
  }
  return [...byDate.values()].sort(byDateAscending).slice(-HISTORY_LIMIT);
}

function saveHistory(items) {
  writeJsonAtomic(historyFile(), { version: 1, items });
}

/* ------------------------------------------------------------------ */
/* 开机自启                                                            */
/* ------------------------------------------------------------------ */

function loginItemPath() {
  // 便携版会把程序解压到临时目录，process.execPath 重启后可能失效。
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: loginItemPath(),
    });
    return true;
  } catch (err) {
    console.warn('[auto-launch] 设置开机自启失败', err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 窗口位置                                                            */
/* ------------------------------------------------------------------ */

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - WIN_SIZE.width - 32),
    y: Math.round(area.y + Math.max(24, Math.round(area.height * 0.12))),
  };
}

function isVisiblePosition(pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      pos.x + WIN_SIZE.width > area.x &&
      pos.x < area.x + area.width &&
      pos.y >= area.y - 40 &&
      pos.y < area.y + area.height - 60
    );
  });
}

function loadWindowPosition() {
  const saved = readJson(windowStateFile(), null);
  if (saved && isVisiblePosition(saved)) return { x: Math.round(saved.x), y: Math.round(saved.y) };
  return defaultPosition();
}

let savePositionTimer = null;
function scheduleSaveWindowPosition(win) {
  if (!win || win.isDestroyed()) return;
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    savePositionTimer = null;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    try {
      writeJsonAtomic(windowStateFile(), { x, y });
    } catch (err) {
      console.warn('[window] 保存窗口位置失败', err);
    }
  }, 400);
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

/**
 * 开发自测时把渲染进程的控制台输出转发到主进程 stdout，方便 XB_CAPTURE 抓错。
 * 仅开发模式 + XB_CAPTURE/XB_DEBUG 时启用，不影响正式行为。
 */
function attachDevDiagnostics(win) {
  if (app.isPackaged || !(process.env.XB_CAPTURE || process.env.XB_DEBUG)) return;
  const wc = win.webContents;
  wc.on('console-message', (details) => {
    // 新版签名：单个 Event<WebContentsConsoleMessageEventParams> 参数（带 level/message 字段）。
    const safeLevel = (details && details.level) || 'log';
    const safeMessage = String((details && details.message) || '');
    console.log(`[renderer:${safeLevel}] ${safeMessage}`);
  });
  wc.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error);
  });
  wc.on('did-fail-load', (_event, code, description, url) => {
    console.error('[did-fail-load]', code, description, url);
  });
  wc.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', details);
  });
}

function createWindow() {
  const pos = loadWindowPosition();

  mainWindow = new BrowserWindow({
    ...WIN_SIZE,
    x: pos.x,
    y: pos.y,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    moveable: true,
    show: false,
    title: APP_NAME,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setVisibleOnAllWorkspaces(false);

  attachDevDiagnostics(mainWindow);

  mainWindow.loadFile(path.join(ROOT, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    maybeCapture();
  });

  mainWindow.on('move', () => scheduleSaveWindowPosition(mainWindow));

  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition();
      try {
        writeJsonAtomic(windowStateFile(), { x, y });
      } catch (err) {
        console.warn('[window] 退出时保存窗口位置失败', err);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 安全基线：不允许跳转、不允许开新窗口、不允许 webview 挂载。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  return mainWindow;
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                */
/* ------------------------------------------------------------------ */

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? '隐藏窗口' : '显示窗口',
      click: () => toggleWindow(),
    },
    {
      label: '老板键：一键隐藏',
      accelerator: 'CommandOrControl+Shift+B',
      click: () => toggleBossKey(),
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        applyAlwaysOnTop();
        persistAlwaysOnTop();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:settings-changed', settings);
        }
      },
    },
    { type: 'separator' },
    {
      label: '设置…',
      click: () => {
        showWindow();
        runner.stopDesktopRun('open-settings');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:open-settings');
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function persistAlwaysOnTop() {
  try {
    writeJsonAtomic(settingsFile(), settings);
  } catch (err) {
    console.warn('[settings] 保存置顶状态失败', err);
  }
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/* ------------------------------------------------------------------ */
/* 老板键：一键隐藏 / 唤回                                              */
/* ------------------------------------------------------------------ */

/** 全局快捷键：按一下藏起来，再按一下叫回来。 */
const BOSS_HOTKEY = 'CommandOrControl+Shift+B';

/**
 * 老板键切换：
 * - 窗口可见 → 立即隐藏（含任务栏/失焦，纯 hide 不留任何痕迹）；
 * - 窗口已隐藏 → 重新显示并聚焦。
 * 隐藏后仍可从托盘图标或全局快捷键唤回，不会“消失找不回来”。
 */
function toggleBossKey() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  rebuildTrayMenu();
}

/** 注册全局快捷键；被其他程序占用等情况下静默失败，不影响按钮本身可用。 */
function registerBossShortcut() {
  try {
    const ok = globalShortcut.register(BOSS_HOTKEY, () => toggleBossKey());
    if (!ok) console.warn(`[boss] 全局快捷键 ${BOSS_HOTKEY} 注册失败（可能已被占用）`);
  } catch (err) {
    console.warn('[boss] 注册全局快捷键失败', err);
  }
}


function createTray() {
  const trayIconPath = path.join(ASSETS, 'tray.png');
  let image = nativeImage.createFromPath(trayIconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  }
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => showWindow());
  rebuildTrayMenu();
}

function applyAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function isTrusted(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      (!event.senderFrame || event.senderFrame === mainWindow.webContents.mainFrame)
  );
}

function demoPayload() {
  const rawNow = process.env.XB_NOW;
  let nowMs = null;
  if (rawNow) {
    const asNumber = Number(rawNow);
    nowMs = Number.isFinite(asNumber) && rawNow.trim() !== '' ? asNumber : Date.parse(rawNow);
    if (!Number.isFinite(nowMs)) nowMs = null;
  }
  return {
    nowMs,
    screen: process.env.XB_SCREEN || null,
    debug: Boolean(process.env.XB_DEBUG) && !app.isPackaged,
  };
}

/** 把设置原子写回磁盘；失败返回错误说明。 */
function persistSettings() {
  writeJsonAtomic(settingsFile(), settings);
}

function registerIpc() {
  ipcMain.handle('settings:load', (event) => {
    if (!isTrusted(event)) return { ok: false };
    return {
      settings,
      hasSalary: hasSalary(settings),
      demo: demoPayload(),
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle('settings:save', (event, payload) => {
    if (!isTrusted(event)) return { ok: false, errors: { form: '来源不可信' } };
    // 保存设置（多半是打开设置面板后再保存）时，先把正在跑的彩蛋收掉，避免关设置后它还在跑。
    runner.stopDesktopRun('settings-save');
    const result = validateAndSanitize(payload);
    if (!result.ok) return result;
    // 文件名合法但文件已被删除时回退到内置桌宠，避免设置里留下失效引用。
    if (result.settings.customMascot && !resolveMascotPath(result.settings.customMascot)) {
      result.settings.customMascot = null;
    }

    const previousSettings = settings;
    const previousAutoLaunch = Boolean(settings.autoLaunch);
    settings = result.settings;
    try {
      persistSettings();
    } catch (err) {
      settings = previousSettings;
      return { ok: false, errors: { form: `保存失败：${err.message}` } };
    }
    // 自启状态以系统登录项为准，这里保证两边同步。
    if (Boolean(settings.autoLaunch) !== previousAutoLaunch) {
      applyLoginItem(Boolean(settings.autoLaunch));
    }
    applyAlwaysOnTop();
    rebuildTrayMenu();
    return { ok: true, settings };
  });

  ipcMain.handle('window:set-always-on-top', (event, flag) => {
    if (!isTrusted(event)) return { ok: false };
    settings.alwaysOnTop = Boolean(flag);
    applyAlwaysOnTop();
    persistAlwaysOnTop();
    rebuildTrayMenu();
    return { ok: true, alwaysOnTop: settings.alwaysOnTop };
  });

  ipcMain.on('window:minimize', (event) => {
    if (!isTrusted(event)) return;
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:close', (event) => {
    if (!isTrusted(event)) return;
    quitting = true;
    app.quit();
  });

  // 老板键按钮：从渲染层请求一键隐藏。唤回走全局快捷键或托盘。
  ipcMain.on('window:boss-hide', (event) => {
    if (!isTrusted(event)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      rebuildTrayMenu();
    }
  });

  ipcMain.on('tray:set-tooltip', (event, text) => {
    if (!isTrusted(event)) return;
    if (!tray) return;
    const safe = String(text || '').slice(0, 120);
    tray.setToolTip(safe);
  });

  /* ---------------- P2：开机自启 ---------------- */

  ipcMain.handle('app:set-auto-launch', (event, enabled) => {
    if (!isTrusted(event)) return { ok: false, autoLaunch: Boolean(settings.autoLaunch) };
    const desired = Boolean(enabled);
    const previous = Boolean(settings.autoLaunch);

    if (!applyLoginItem(desired)) {
      return { ok: false, autoLaunch: previous, reason: '系统不允许设置开机自启' };
    }

    settings.autoLaunch = desired;
    try {
      persistSettings();
    } catch (err) {
      settings.autoLaunch = previous;
      applyLoginItem(previous);
      return { ok: false, autoLaunch: previous, reason: `保存设置失败：${err.message}` };
    }
    return { ok: true, autoLaunch: settings.autoLaunch };
  });

  /* ---------------- P2：下班系统通知 ---------------- */

  ipcMain.handle('notify:done', (event, payload) => {
    if (!isTrusted(event)) return { ok: false, reason: '来源不可信' };
    try {
      if (!Notification.isSupported()) return { ok: false, reason: '当前系统不支持通知' };
      const data = payload && typeof payload === 'object' ? payload : {};
      const options = {
        title: String(data.title || '鱼快下班').slice(0, 120),
        body: String(data.body || '下班啦，今天也辛苦啦。').slice(0, 400),
        // 提示音由渲染层按 soundOnDone 用 WebAudio 播放，默认静音避免系统通知再响一遍。
        silent: typeof data.silent === 'boolean' ? data.silent : true,
      };
      if (app.isPackaged) options.icon = path.join(ASSETS, 'icon.png');

      const notification = new Notification(options);
      liveNotifications.add(notification);
      const release = () => liveNotifications.delete(notification);
      notification.on('close', release);
      notification.on('failed', (_event, error) => {
        release();
        console.warn('[notify] 通知发送失败', error);
      });
      notification.on('click', () => {
        release();
        showWindow();
      });
      notification.show();
      return { ok: true };
    } catch (err) {
      console.warn('[notify] 通知发送失败', err);
      return { ok: false, reason: err && err.message ? err.message : '通知发送失败' };
    }
  });

  /* ---------------- P2：历史每日收入 ---------------- */

  ipcMain.handle('history:load', (event) => {
    if (!isTrusted(event)) return { items: [] };
    return { items: loadHistory() };
  });

  ipcMain.handle('history:record', (event, payload) => {
    const current = loadHistory();
    if (!isTrusted(event)) return { ok: false, items: current, reason: '来源不可信' };
    const entry = sanitizeHistoryEntry(payload);
    if (!entry) return { ok: false, items: current, reason: '记录数据无效：需要 date=YYYY-MM-DD、earned/dailyPay≥0' };

    const byDate = new Map(current.map((item) => [item.date, item]));
    byDate.set(entry.date, entry);
    const items = [...byDate.values()].sort(byDateAscending).slice(-HISTORY_LIMIT);
    try {
      saveHistory(items);
    } catch (err) {
      console.warn('[history] 保存历史失败', err);
      return { ok: false, items: current, reason: `保存历史失败：${err.message}` };
    }
    return { ok: true, items };
  });

  /* ---------------- P2：自定义桌宠形象 ---------------- */

  ipcMain.handle('mascot:pick-custom', async (event) => {
    if (!isTrusted(event)) return { ok: false, reason: '来源不可信' };
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择自定义桌宠形象',
        buttonLabel: '使用这个形象',
        properties: ['openFile'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: '视频', extensions: ['mp4', 'webm'] },
          { name: '所有支持的媒体', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm'] },
        ],
      });
      if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      const source = result.filePaths[0];
      const ext = path.extname(source).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) return { ok: false, reason: '不支持的文件格式（仅支持 png/jpg/jpeg/gif/webp/mp4/webm）' };

      const stat = fs.statSync(source);
      if (!stat.isFile()) return { ok: false, reason: '请选择一个文件' };
      if (stat.size > MAX_MASCOT_BYTES) return { ok: false, reason: '文件过大（上限 512 MB）' };

      const dir = mascotDir();
      fs.mkdirSync(dir, { recursive: true });

      // 时间戳命名，极端情况下同一毫秒重复则顺延，避免覆盖。
      let fileName = '';
      const stamp = Date.now();
      for (let i = 0; i < 5; i += 1) {
        const candidate = `custom-${stamp + i}${ext}`;
        if (!fs.existsSync(path.join(dir, candidate))) {
          fileName = candidate;
          break;
        }
      }
      if (!fileName) return { ok: false, reason: '生成形象文件名失败，请重试' };

      const destination = path.join(dir, fileName);
      fs.copyFileSync(source, destination);

      const previousMascot = settings.customMascot;
      settings.customMascot = fileName;
      try {
        persistSettings();
      } catch (err) {
        settings.customMascot = previousMascot;
        try {
          fs.unlinkSync(destination);
        } catch (cleanupErr) {
          console.warn('[mascot] 清理新拷贝文件失败', cleanupErr);
        }
        return { ok: false, reason: `保存设置失败：${err.message}` };
      }

      // 写入成功后再清理旧文件，避免设置保存失败时丢失现有形象。
      cleanupCustomMascotFiles(fileName);
      return { ok: true, file: fileName, kind: mascotKind(fileName) };
    } catch (err) {
      console.warn('[mascot] 选择自定义形象失败', err);
      return { ok: false, reason: `选择形象失败：${err && err.message ? err.message : '未知错误'}` };
    }
  });

  ipcMain.handle('mascot:clear-custom', (event) => {
    if (!isTrusted(event)) return { ok: false, customMascot: settings.customMascot || null };
    const previousMascot = settings.customMascot;
    settings.customMascot = null;
    try {
      persistSettings();
    } catch (err) {
      settings.customMascot = previousMascot;
      return { ok: false, customMascot: previousMascot, reason: `保存设置失败：${err.message}` };
    }
    if (previousMascot) {
      const oldPath = resolveMascotPath(previousMascot);
      if (oldPath) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          console.warn('[mascot] 删除旧形象失败', err);
        }
      }
    }
    return { ok: true, customMascot: null };
  });

  ipcMain.handle('mascot:custom-url', (event) => {
    if (!isTrusted(event)) return { url: null, file: null, kind: null };
    return customMascotPayload();
  });

  /* ---------------- P3：下班跑出桌面彩蛋 ---------------- */

  let lastRunAt = 0;
  ipcMain.handle('runner:start', async (event, payload) => {
    const now = Date.now();
    if (!isTrusted(event)) return { ok: false, reason: '来源不可信' };
    if (!settings.desktopRun) return { ok: false, reason: '设置里已关闭下班跑步' };
    if (runner.isRunning()) return { ok: false, reason: '已经在跑啦' };
    // 防止渲染层重复触发（同一分钟内只允许一次），避免异常循环开窗。
    if (now - lastRunAt < 60 * 1000) return { ok: false, reason: '刚刚跑过啦' };
    lastRunAt = now;

    const earned = payload && Number.isFinite(payload.earned) ? payload.earned : null;
    const originBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    return runner.startDesktopRun({ mainWindow, originBounds, earned, mode: settings.desktopRunMode });
  });

  ipcMain.on('runner:ready', (event) => {
    runner.handleRunnerReady(event);
  });

  ipcMain.on('runner:done', (event) => {
    runner.handleRunnerDone(event);
  });
}

/** 删除 mascot 目录里除 keepName 之外的旧 custom-* 文件，避免堆积。 */
function cleanupCustomMascotFiles(keepName) {
  const dir = mascotDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[mascot] 读取形象目录失败', err);
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === keepName) continue;
    if (!/^custom-/i.test(entry.name)) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.name));
    } catch (err) {
      console.warn('[mascot] 清理旧形象失败', entry.name, err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 自测截图（仅开发用，由 XB_CAPTURE 环境变量触发）                     */
/* ------------------------------------------------------------------ */

function maybeCapture() {
  const dir = process.env.XB_CAPTURE;
  if (!dir) return;
  const name = process.env.XB_CAPTURE_NAME || 'window';
  const delay = Number(process.env.XB_CAPTURE_DELAY || 1800);
  setTimeout(async () => {
    try {
      // 开发自测钩子：可在截图前执行一段渲染进程脚本并打印结果（仅开发模式 + 环境变量触发）。
      if (process.env.XB_EVAL && !app.isPackaged) {
        const value = await mainWindow.webContents.executeJavaScript(process.env.XB_EVAL, true);
        console.log('[eval]', JSON.stringify(value));
      }
      fs.mkdirSync(dir, { recursive: true });
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
      console.log(`[capture] ${name}.png`);

      // 自测：若覆盖窗正在跑，也抓一张（XB_RUNNER_CAPTURE=1 时）
      if (process.env.XB_RUNNER_CAPTURE) {
        const rw = runner._getWindow();
        if (rw) {
          const rimg = await rw.webContents.capturePage();
          fs.writeFileSync(path.join(dir, `${name}-runner.png`), rimg.toPNG());
          console.log(`[capture] ${name}-runner.png bounds=${JSON.stringify(rw.getBounds())}`);
          if (process.env.XB_DEBUG) {
            try {
              const st = await rw.webContents.executeJavaScript(
                `(()=>{const p=document.getElementById('pet');const f=document.getElementById('fish');const b=document.getElementById('bubble');return {cls:p.className, src:p.getAttribute('src'), rate:p.playbackRate, fishTx:getComputedStyle(f).transform, bubbleHidden:b.hidden, bubble:b.textContent, frames:window.__runnerFrames||0}})()`,
                true,
              );
              console.log('[runner-state]', JSON.stringify(st));
            } catch (e) {
              console.log('[runner-state] err', e && e.message);
            }
          }
        } else {
          console.log('[capture] 覆盖窗不存在（runner window null）');
        }
      }
    } catch (err) {
      console.error('[capture] 失败', err);
    } finally {
      quitting = true;
      app.quit();
    }
  }, delay);
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.local.yukuaixiaban');

    // 拒绝一切权限申请：本应用不需要摄像头/麦克风/通知等能力。
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    registerMediaProtocol();

    settings = loadSettings();
    registerIpc();
    createWindow();
    createTray();
    registerBossShortcut();
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    quitting = true;
    runner.stopDesktopRun('quit');
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

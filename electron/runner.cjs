'use strict';

/**
 * 鱼快下班 · 下班跑步彩蛋（主进程模块） —— v2
 * ---------------------------------------------------------------------------
 * 职责：下班时弹出一个“全屏透明、置顶、点击穿透”的独立窗口，沿着缓动曲线在桌面上
 * 来回奔跑，同时把 阶段/节拍/瞬时速度 推给渲染层（让动画朝向、步频、台词跟位移耦合），
 * 跑完淡出并销毁。
 *
 * 相比 v1 的改进（对齐优秀桌宠 Mocha Casa 的做法）：
 * - 位移用 easeInOutCubic 曲线（起步/收尾缓动），不再机器人匀速；
 * - 每帧把“瞬时速度”推给渲染层微调 playbackRate，脚底不易打滑；
 * - 分方向：向右跑正常、向左跑镜像；
 * - 跑线贴工作区底部（脚踩地面，避任务栏）；支持按光标位置抬高避让；
 * - 一段完整小剧场：钻出→跑→急停转身→跑回→跳+撒花→挥手→淡出。
 *
 * 约束不变：只由主进程移动；窗口点击穿透不挡办公；任何异常收敛为“彩蛋失败”，
 * 绝不影响下班主流程；单例；是否启用由调用方按设置判断。
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, screen } = require('electron');

const SRC_DIR = path.join(__dirname, '..', 'src');

/** @type {BrowserWindow|null} */
let runnerWin = null;
let rafTimer = null;
let byeTimer = null;
let readyTimer = null;
let runToken = 0;
let readyResolver = null;

let planModule = null;
async function loadPlanModule() {
  if (!planModule) planModule = await import(pathToFileURL(path.join(SRC_DIR, 'runner-plan.mjs')).toString());
  return planModule;
}

/** 工作区：优先主窗所在显示器，退化到主显示器。 */
function workAreaFor(mainWindow) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      if (display && display.workArea) return display.workArea;
    }
  } catch (err) {
    console.warn('[runner] 获取主窗所在显示器失败', err);
  }
  return screen.getPrimaryDisplay().workArea;
}

/** 当前光标屏幕坐标（避让用），失败返回 null。 */
function cursorPoint() {
  try {
    const p = screen.getCursorScreenPoint();
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

function createRunnerWindow(bounds) {
  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(120, Math.round(bounds.width)),
    height: Math.max(120, Math.round(bounds.height)),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    movable: false,
    show: false,
    webPreferences: {
      preload: path.join(SRC_DIR, 'runner-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: false,
      backgroundThrottling: false,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  return win;
}

function isCurrent(token) {
  return token === runToken;
}

function cleanupWindow() {
  if (readyResolver) {
    readyResolver(false);
    readyResolver = null;
  }
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  if (rafTimer) {
    clearTimeout(rafTimer);
    rafTimer = null;
  }
  if (byeTimer) {
    clearTimeout(byeTimer);
    byeTimer = null;
  }
  if (runnerWin && !runnerWin.isDestroyed()) {
    try {
      runnerWin.destroy();
    } catch (err) {
      console.warn('[runner] 销毁覆盖窗失败', err);
    }
  }
  runnerWin = null;
}

function stopDesktopRun(reason) {
  runToken += 1;
  cleanupWindow();
  return { ok: true, stopped: true, reason: reason || null };
}

function isRunning() {
  return Boolean(runnerWin && !runnerWin.isDestroyed());
}

/**
 * 开始一次“下班跑步”。
 * @param {object} [options]
 * @param {import('electron').BrowserWindow} [options.mainWindow]
 * @param {object} [options.originBounds]
 * @param {'calm'|'active'} [options.mode]
 * @param {number} [options.earned]
 * @returns {Promise<{ok:boolean, reason?:string, durationMs?:number}>}
 */
async function startDesktopRun(options = {}) {
  try {
    if (isRunning()) stopDesktopRun('restart');

    const mod = await loadPlanModule();
    const area = workAreaFor(options.mainWindow || null);
    let origin = options.originBounds || null;
    if (!origin && options.mainWindow && !options.mainWindow.isDestroyed()) {
      origin = options.mainWindow.getBounds();
    }
    const cursor = cursorPoint();

    const plan = mod.planRun({
      area,
      origin,
      cursor,
      mode: options.mode,
      durationMs: options.durationMs,
      loopCount: options.loopCount,
    });

    const token = ++runToken;
    // v3：窗口一次性铺满整个工作区并静止；鱼在窗内用 transform 移动（GPU 合成、丝滑）。
    runnerWin = createRunnerWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    });
    const win = runnerWin;

    const ready = await new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        if (readyResolver === done) readyResolver = null;
        resolve(Boolean(ok));
      };
      readyResolver = done;

      readyTimer = setTimeout(() => {
        console.warn('[runner] 覆盖窗就绪超时');
        done(false);
      }, 4000);

      win.webContents.on('render-process-gone', (_e, details) => {
        console.warn('[runner] 覆盖窗渲染进程异常', details);
        done(false);
      });
      win.once('ready-to-show', () => {
        try {
          win.showInactive();
        } catch (err) {
          console.warn('[runner] 显示覆盖窗失败', err);
        }
      });

      win.loadFile(path.join(SRC_DIR, 'runner.html')).catch((err) => {
        console.warn('[runner] 加载 runner.html 失败', err);
        done(false);
      });
    });

    if (!ready || !isCurrent(token) || !isRunning()) {
      if (isCurrent(token)) cleanupWindow();
      return { ok: false, reason: '覆盖窗未能就绪' };
    }

    // 一次性下发整条时间轴：渲染层用 rAF 自己跑，主进程不再逐帧驱动。
    try {
      win.webContents.send('runner:start', {
        keyframes: plan.keyframes,
        beats: plan.beats,
        stages: plan.stages,
        durationMs: plan.durationMs,
        outroStartMs: plan.outroStartMs,
        winWidth: plan.winWidth,
        winHeight: plan.winHeight,
        originX: area.x, // 窗口左上角在屏幕上的坐标（窗内坐标 = 屏幕坐标 - origin）
        originY: area.y,
        startDir: plan.startDir,
        startLine: plan.startLine,
      });
    } catch (err) {
      console.warn('[runner] 发送开跑事件失败', err);
    }

    // 兜底：万一渲染层没回报 done，超时也销毁窗口。
    byeTimer = setTimeout(
      () => {
        if (isCurrent(token)) cleanupWindow();
      },
      plan.durationMs + 3000,
    );

    return { ok: true, durationMs: plan.durationMs };
  } catch (err) {
    console.warn('[runner] 启动下班跑步失败', err);
    cleanupWindow();
    return { ok: false, reason: err && err.message ? err.message : '启动失败' };
  }
}

/* v3 不再有 animate 主循环；窗口移动完全交给渲染层的 rAF + transform。 */

function handleRunnerReady(event) {
  if (!runnerWin || runnerWin.isDestroyed()) return;
  if (event.sender !== runnerWin.webContents) return;
  if (readyResolver) {
    readyResolver(true);
    readyResolver = null;
  }
}

/** 渲染层跑完（淡出结束）后回调，销毁窗口。 */
function handleRunnerDone(event) {
  if (!runnerWin || runnerWin.isDestroyed()) return;
  if (event.sender !== runnerWin.webContents) return;
  runToken += 1; // 让兜底超时失效
  cleanupWindow();
}

module.exports = {
  startDesktopRun,
  stopDesktopRun,
  isRunning,
  handleRunnerReady,
  handleRunnerDone,
  _getWindow: () => (runnerWin && !runnerWin.isDestroyed() ? runnerWin : null),
};

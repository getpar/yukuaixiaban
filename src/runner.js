/**
 * 鱼快下班 · 下班跑步彩蛋（覆盖窗渲染进程） —— v3（丝滑版）
 * ---------------------------------------------------------------------------
 * 架构改进（解决掉帧）：
 *   v2 是「主进程每 16ms setTimeout + setPosition 移动小窗口」——JS 定时器精度差、
 *   每次 SetWindowPos 都要让合成器重排透明层，60fps 很难稳住。
 *   v3 改成业界通行的做法：
 *   - 覆盖窗一次性铺满整个工作区（大而静止）；
 *   - 鱼在窗内用 CSS `transform: translate3d()` 移动 —— 走 GPU 合成，rAF 稳定 60fps；
 *   - 整个路线（keyframes/stages/beats）由主进程一次下发，渲染层用 requestAnimationFrame
 *     自己跑完整条时间轴；不再逐帧 IPC、不再逐帧 setPosition。
 *
 * 其余不变：素材 a012 源朝左（向左跑不镜像、向右跑镜像）；playbackRate 随速度耦合；
 * 多行气泡不裁切；点击穿透由窗口层保证。
 */

import { PET_BASE, RUNNER_ANIM } from './pet-manifest.js';
import { boundsAt, speedAt, stageAt, beatAt } from './runner-plan.mjs';

const SRC = (id) => `${PET_BASE}${id}.webm`;

const els = {
  runner: document.getElementById('runner'),
  fish: document.getElementById('fish'),
  bubble: document.getElementById('bubble'),
  pet: document.getElementById('pet'),
};

let currentLine = '';
let currentClip = '';
let currentMirror = false;

/* rAF 时间轴状态 */
let rafId = 0;
let plan = null; // { keyframes, stages, beats, durationMs, winWidth, winHeight, outroStartMs, startDir, startLine }
let startTime = 0;
let lastBeatT = -1;
let lastStageKey = '';
let stopped = false;
let byeTimer = 0;

/* ---------------- 基础操作 ---------------- */

function playClip(id, { loop = true } = {}) {
  if (!id || id === currentClip || !els.pet) return;
  currentClip = id;
  els.pet.loop = loop;
  els.pet.src = SRC(id);
  els.pet.currentTime = 0;
  const p = els.pet.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

/** 设置朝向：源素材 a012 朝左；向右跑时镜像，向左跑保持原样。 */
function setDir(dir) {
  const next = dir === 'left' ? 'left' : 'right';
  const sourceFacesRight = Boolean(RUNNER_ANIM.run.facesRight);
  const mirror = (next === 'right') !== sourceFacesRight;
  currentMirror = mirror;
  els.pet?.classList.toggle('is-mirror', mirror);
}

/** 按速度调 playbackRate，让腿速与位移耦合。 */
function setPace(speedPx) {
  if (!els.pet || !Number.isFinite(speedPx)) return;
  const { baseRate = 1, maxRate = 1.35 } = RUNNER_ANIM.run;
  const ratio = Math.min(Math.max(speedPx / 480, 0), 1);
  try {
    els.pet.playbackRate = baseRate + (maxRate - baseRate) * ratio;
  } catch {
    /* ignore */
  }
}

function say(text) {
  if (!els.bubble) return;
  const line = typeof text === 'string' ? text.trim() : '';
  if (!line) return;
  if (line === currentLine && !els.bubble.hidden) return;
  currentLine = line;
  els.bubble.hidden = false;
  els.bubble.classList.add('is-swap');
  window.requestAnimationFrame(() => {
    setTimeout(() => {
      els.bubble.textContent = line;
      els.bubble.classList.remove('is-swap');
    }, 60);
  });
}

function hideBubble() {
  currentLine = '';
  els.bubble?.classList.add('is-swap');
  setTimeout(() => {
    if (els.bubble) {
      els.bubble.hidden = true;
      els.bubble.classList.remove('is-swap');
    }
  }, 140);
}

/** 用 transform 把整只“鱼+气泡”放到大窗的 (x,y)——GPU 合成，丝滑。 */
function placePet(x, y) {
  if (!els.fish) return;
  els.fish.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

/* ---------------- 主时间轴（rAF） ---------------- */

function applyStage(stage) {
  if (!stage) return;
  if (stage.kind === 'run') {
    els.pet?.classList.remove('is-hop');
    playClip(RUNNER_ANIM.run.clip, { loop: true });
  } else if (stage.kind === 'turn') {
    playClip(RUNNER_ANIM.spin, { loop: false });
  }
}

function applyBeat(beat) {
  if (!beat) return;
  if (beat.dir) setDir(beat.dir);
  if (beat.kind === 'turn') {
    playClip(RUNNER_ANIM.spin, { loop: false });
    hideBubble();
    return;
  }
  if (beat.clip === 'hop') {
    playClip(RUNNER_ANIM.hop, { loop: false });
    els.pet?.classList.add('is-hop');
    setTimeout(() => els.pet?.classList.remove('is-hop'), 520);
  } else if (beat.clip === 'celebrate') {
    playClip(RUNNER_ANIM.celebrate, { loop: false });
  } else if (beat.clip === 'wave') {
    playClip(RUNNER_ANIM.wave, { loop: false });
  }
  if (beat.line) say(beat.line);
}

function tickFrame(now) {
  if (stopped || !plan) return;
  const elapsed = now - startTime;
  const clamped = Math.min(elapsed, plan.durationMs);
  // 诊断用：统计实际渲染帧数（不影响功能）
  window.__runnerFrames = (window.__runnerFrames || 0) + 1;

  // 1) 位置：用 plan 里“绝对屏幕坐标”的关键帧，减去窗口原点（原点恒为 area.x/area.y，这里直接当作 0 偏移的窗内坐标）
  const pos = boundsAt(plan.keyframes, clamped);
  placePet(pos.x - plan.originX, pos.y - plan.originY);

  // 2) 朝向 + 阶段
  const stage = stageAt(plan.stages, clamped);
  if (stage) {
    const key = `${stage.kind}:${stage.dir || ''}`;
    if (key !== lastStageKey) {
      lastStageKey = key;
      if (stage.dir) setDir(stage.dir);
      applyStage(stage);
    }
  }

  // 3) 节拍
  const beat = beatAt(plan.beats, clamped);
  if (beat && beat.t !== lastBeatT) {
    lastBeatT = beat.t;
    applyBeat(beat);
  }

  // 4) 速度 → playbackRate
  setPace(speedAt(plan.keyframes, clamped));

  // 5) 收尾淡出
  const outroStop = plan.outroStartMs + Math.max(600, plan.durationMs - plan.outroStartMs - 400);
  if (clamped >= outroStop && !byeTimer) {
    els.runner?.classList.add('is-bye');
    byeTimer = setTimeout(() => {
      window.runnerBridge?.done?.();
    }, 520);
  }

  if (clamped < plan.durationMs) {
    rafId = window.requestAnimationFrame(tickFrame);
  }
}

function startTimeline(payload) {
  stopTimeline();
  stopped = false;
  plan = payload;
  startTime = 0;
  lastBeatT = -1;
  lastStageKey = '';

  // 复位
  currentClip = '';
  currentLine = '';
  els.pet?.classList.remove('is-mirror', 'is-hop');
  if (els.bubble) {
    els.bubble.hidden = true;
    els.bubble.textContent = '';
  }
  els.runner?.classList.remove('is-bye');

  setDir(payload.startDir || 'left');
  // 设置“鱼+气泡”容器尺寸（与计划里的窗口尺寸一致），并先摆到起点。
  if (els.fish) {
    els.fish.style.width = `${payload.winWidth}px`;
    els.fish.style.height = `${payload.winHeight}px`;
  }
  const p0 = boundsAt(plan.keyframes, 0);
  placePet(p0.x - plan.originX, p0.y - plan.originY);
  playClip(RUNNER_ANIM.run.clip, { loop: true });
  if (payload.startLine) say(payload.startLine);

  // 用第一个 rAF 的时刻作为起点，避免加载延迟被计入
  window.requestAnimationFrame((now) => {
    startTime = now;
    rafId = window.requestAnimationFrame(tickFrame);
  });
}

function stopTimeline() {
  stopped = true;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (byeTimer) {
    clearTimeout(byeTimer);
    byeTimer = 0;
  }
}

function bind() {
  const api = window.runnerBridge;
  if (!api) {
    // 直接双击 runner.html 预览：默认原地小跑。
    playClip(RUNNER_ANIM.run.clip, { loop: true });
    return;
  }
  api.onStart((payload) => startTimeline(payload));
  api.ready?.();
}

els.pet?.addEventListener('error', () => {
  if (currentClip !== RUNNER_ANIM.run.clip) playClip(RUNNER_ANIM.run.clip, { loop: true });
});

bind();

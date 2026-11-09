/**
 * 下班跑步彩蛋 · 纯规划内核单测（v2）
 * - easeInOutCubic 缓动正确（端点、中点、单调）；
 * - 路线关键帧时间单调、坐标始终夹在工作区内；
 * - 跑线贴底、支持鼠标避让抬高；
 * - 分方向：每段 dir 明确，首尾方向合理；
 * - 阶段脚本覆盖 跑/转身/收尾；
 * - 安静/活跃两档时长不同；
 * - 非法入参有安全兜底。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planRun,
  boundsAt,
  beatAt,
  stageAt,
  speedAt,
  easeInOutCubic,
  normalizeArea,
  DIR,
  MODES,
  RUNNER_DEFAULTS,
  RUN_LINES,
  OPENING_LINES,
  CLOSING_LINES,
} from '../src/runner-plan.mjs';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const fixedPick = (arr) => arr[0];

test('easeInOutCubic：端点 0/1、中点 0.5、单调递增', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9);
  let prev = -1;
  for (let i = 0; i <= 20; i += 1) {
    const v = easeInOutCubic(i / 20);
    assert.ok(v >= prev, `缓动非单调：${prev} -> ${v}`);
    prev = v;
  }
});

test('工作区归一化：非法输入回退到安全默认', () => {
  const area = normalizeArea(null);
  assert.ok(area.width >= 200 && area.height >= 200);
  const bad = normalizeArea({ width: -5, height: 'x' });
  assert.ok(bad.width >= 200 && bad.height >= 200);
});

test('关键帧时间单调不减', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  for (let i = 1; i < plan.keyframes.length; i += 1) {
    assert.ok(plan.keyframes[i].t >= plan.keyframes[i - 1].t);
  }
});

test('所有关键帧坐标都在工作区内（不越界）', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const maxX = AREA.x + AREA.width - plan.winWidth;
  const maxY = AREA.y + AREA.height - plan.winHeight;
  plan.keyframes.forEach((k, i) => {
    assert.ok(k.x >= AREA.x && k.x <= maxX, `第 ${i} 帧 x 越界：${k.x}`);
    assert.ok(k.y >= AREA.y && k.y <= maxY, `第 ${i} 帧 y 越界：${k.y}`);
  });
});

test('跑线贴工作区底部（脚踩地面）', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const expected = AREA.y + AREA.height - plan.winHeight;
  // 跑动段的 y 应等于 groundY（≈贴底），差异只在夹紧范围内
  assert.ok(Math.abs(plan.groundY - expected) <= 2, `groundY 未贴底：${plan.groundY} vs ${expected}`);
});

test('鼠标避让：光标落在跑线上时跑线抬高', () => {
  const base = planRun({ area: AREA, mode: 'active', pick: fixedPick }).groundY;
  const cursorOnLine = { x: 900, y: AREA.height - RUNNER_DEFAULTS.winHeight + 200 };
  const avoided = planRun({ area: AREA, mode: 'active', cursor: cursorOnLine, pick: fixedPick }).groundY;
  assert.ok(avoided < base, `避让未抬高：${avoided} 应 < ${base}`);
});

test('起点贴近主窗位置（从画布钻出）', () => {
  const origin = { x: 1468, y: 120, width: 420, height: 620 };
  const plan = planRun({ area: AREA, origin, mode: 'active', pick: fixedPick });
  assert.ok(Math.abs(plan.startBounds.x - origin.x) <= plan.winWidth);
});

test('分方向：每段 dir 合法，多段时左右交替', () => {
  const plan = planRun({ area: AREA, origin: { x: 100, y: 800, width: 420, height: 620 }, mode: 'active', pick: fixedPick });
  const runStages = plan.stages.filter((s) => s.kind === 'run');
  assert.ok(runStages.length >= 2, '应至少有 2 段跑');
  runStages.forEach((s) => assert.ok(s.dir === DIR.LEFT || s.dir === DIR.RIGHT));
  // 相邻两段方向相反
  for (let i = 1; i < runStages.length; i += 1) {
    assert.notEqual(runStages[i].dir, runStages[i - 1].dir, '相邻跑段方向应相反');
  }
});

test('阶段脚本覆盖 跑 / 转身 / 收尾', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const kinds = new Set(plan.stages.map((s) => s.kind));
  assert.ok(kinds.has('run'));
  assert.ok(kinds.has('turn'), '缺少急停转身');
  assert.ok(kinds.has('outro'), '缺少收尾');
  const ids = plan.beats.map((b) => b.clip).filter(Boolean);
  assert.ok(ids.includes('hop') && ids.includes('celebrate') && ids.includes('wave'), '收尾动作不全');
});

test('台词都来自定义的池', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const allowed = new Set([...RUN_LINES, ...OPENING_LINES, ...CLOSING_LINES]);
  plan.beats.forEach((b) => {
    if (b.line !== null) assert.ok(allowed.has(b.line), `未定义台词：${b.line}`);
  });
});

test('安静 / 活跃两档时长不同', () => {
  const active = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const calm = planRun({ area: AREA, mode: 'calm', pick: fixedPick });
  assert.equal(active.mode, 'active');
  assert.equal(calm.mode, 'calm');
  assert.ok(active.durationMs > calm.durationMs, '活跃时长应大于安静');
  assert.ok(MODES.active.loopCount > MODES.calm.loopCount);
});

test('boundsAt / beatAt / stageAt：空数组与越界安全', () => {
  assert.deepEqual(boundsAt([], 100), { x: 0, y: 0 });
  assert.equal(beatAt([], 100), null);
  assert.equal(stageAt([], 100), null);
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const first = plan.keyframes[0];
  assert.deepEqual(boundsAt(plan.keyframes, -100), { x: first.x, y: first.y });
});

test('speedAt：跑动中速度 > 0，端点停顿时接近 0', () => {
  const plan = planRun({ area: AREA, mode: 'active', pick: fixedPick });
  const runStage = plan.stages.find((s) => s.kind === 'run');
  const midstage = (runStage.startT + runStage.endT) / 2;
  assert.ok(speedAt(plan.keyframes, midstage) > 10, '跑动中应有速度');
  // 停顿时（turn 结尾）速度应很小
  const turn = plan.stages.find((s) => s.kind === 'turn');
  if (turn) {
    assert.ok(speedAt(plan.keyframes, turn.endT - 5) < 5, '停顿时速度应接近 0');
  }
});

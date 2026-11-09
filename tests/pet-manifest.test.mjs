/**
 * 桌宠动画清单自检
 * - 96 个动画都存在且可解码前先确认文件在磁盘上
 * - id 唯一、分类合法
 * - 每个动画都能被某一层调度到（基础情绪 / 点击 / 摸鱼 / 打瞌睡 / 整点彩蛋 / 里程碑）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PET_MOODS, PET_ACTIONS, PET_BASE } from '../src/pet-manifest.js';
import { PET_SCHEDULES } from '../src/pet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PET_DIR = path.join(ROOT, 'assets', 'pet', 'all');
const VALID_TAGS = new Set(['click', 'sleep', 'work', 'money', 'eat', 'festival', 'dance', 'move', 'play', 'misc']);

test('清单包含 96 个动画且 id 唯一', () => {
  assert.equal(PET_ACTIONS.length, 96);
  const ids = PET_ACTIONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('每个动画的分类都合法', () => {
  PET_ACTIONS.forEach((item) => {
    assert.ok(VALID_TAGS.has(item.tag), `${item.id} 的分类 ${item.tag} 不合法`);
    assert.ok(item.name && item.name.length > 0);
  });
});

test('七档情绪都指向存在的动画', () => {
  const ids = new Set(PET_ACTIONS.map((item) => item.id));
  Object.entries(PET_MOODS).forEach(([state, id]) => {
    assert.ok(ids.has(id), `${state} 指向了不存在的 ${id}`);
  });
  assert.equal(Object.keys(PET_MOODS).length, 7);
});

test('每个动画都至少能被一层调度到（96 个全覆盖）', () => {
  const covered = new Set();
  Object.values(PET_SCHEDULES).forEach((pool) => pool.forEach((id) => covered.add(id)));

  const missing = PET_ACTIONS.filter((item) => !covered.has(item.id)).map((item) => `${item.id} ${item.name}`);
  assert.deepEqual(missing, [], `以下动画永远不会被播到：${missing.join('、')}`);
});

test('96 个动画文件都在磁盘上且非空', () => {
  const missing = [];
  PET_ACTIONS.forEach((item) => {
    const file = path.join(PET_DIR, `${item.id}.webm`);
    if (!fs.existsSync(file) || fs.statSync(file).size < 10_000) missing.push(item.id);
  });
  assert.deepEqual(missing, []);
});

test('素材目录配置正确', () => {
  assert.equal(PET_BASE, '../assets/pet/all/');
});

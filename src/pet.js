/**
 * 鱼快下班 · 桌宠版大肥鱼（蓝鲸娘）
 * ---------------------------------------------------------------------------
 * 96 个社区动画分三层使用：
 *   1) 基础情绪：7 档随工作进度循环（sleep → slouch → … → celebrate）
 *   2) 随机摸鱼：上班中每 25–60 秒随机播一个小动作（吃/玩/走动/工作小动作）
 *   3) 彩蛋：整点随机节日或撒欢动画；赚到 25%/50%/75%/100% 时播「余额」系列
 * 另外点击会随机播「点击回应」。
 *
 * 素材许可：CC BY-NC-SA 4.0（署名 · 非商业 · 相同方式共享），
 * 来源 https://github.com/PC2005-cloud/dsh-pet ，详见 THIRD-PARTY-NOTICES.md。
 *
 * 导出契约与 mascot.js 一致，app.js 可以无缝切换。
 */

import { QUOTES, POKE_QUOTES, stateFor, quoteFor, STATES } from './mascot.js';
import { PET_MOODS, PET_ACTIONS, PET_BASE } from './pet-manifest.js';

export { QUOTES, POKE_QUOTES, stateFor, quoteFor, STATES };

const SRC = (id) => `${PET_BASE}${id}.webm`;

/** 上班中的情绪（只有这些状态才排摸鱼小动作）。 */
const WORKING_STATES = new Set(['slouch', 'soulless', 'reviving', 'hopeful', 'sprint']);

/** 摸鱼小动作的可用分类（不含节日/余额/点击这类特殊动画）。 */
const IDLE_TAGS = ['work', 'eat', 'play', 'move', 'dance', 'misc'];
/** 犯困时额外可以播的睡觉类动作（打瞌睡被惊醒、原地小憩沉眠…）。 */
const SLEEP_TAG = ['sleep'];
/** 整点彩蛋的分类：节日、撒欢、以及「余额」系列（工资相关的小剧场）。 */
const EGG_TAGS = ['festival', 'dance', 'play', 'money'];

const byTag = (tags) => PET_ACTIONS.filter((item) => tags.includes(item.tag));
const CLICK_POOL = byTag(['click']).map((item) => item.id);
const IDLE_POOL = byTag(IDLE_TAGS).map((item) => item.id);
const EGG_POOL = byTag(EGG_TAGS).map((item) => item.id);

/** 赚到里程碑时播的「余额」动画（按原名定位）。 */
const MONEY_BY_NAME = {
  quarter: '余额-数金皱眉',
  half: '余额-钱袋如常',
  threeQuarter: '余额-金袋叮当',
  done: '余额-钱袋满溢',
};

const MOOD_IDS = new Set(Object.values(PET_MOODS));
/** 摸鱼池里去掉与基础情绪重复的动画，避免“切了个寂寞”。 */
const IDLE_IDS = IDLE_POOL.filter((id) => !MOOD_IDS.has(id));
/** 犯困专用（睡觉类里去掉当基础情绪的循环动画）。 */
const SLEEP_IDS = byTag(SLEEP_TAG).map((item) => item.id).filter((id) => !MOOD_IDS.has(id));
/** 犯困情绪下，有多大概率改播“打瞌睡/惊醒”这类动作。 */
const SLEEP_ACTION_CHANCE = 0.3;

/** 导出给自检脚本核对：96 个动画是否都能被某一层调度到。 */
export const PET_SCHEDULES = {
  moods: Object.values(PET_MOODS),
  click: CLICK_POOL,
  idle: IDLE_IDS,
  sleep: SLEEP_IDS,
  egg: EGG_POOL,
  milestone: Object.values(MONEY_BY_NAME)
    .map((name) => PET_ACTIONS.find((item) => item.name === name))
    .filter(Boolean)
    .map((item) => item.id),
};

function pick(pool, excludeId) {
  const usable = pool.length > 1 && excludeId ? pool.filter((id) => id !== excludeId) : pool;
  return usable[Math.floor(Math.random() * usable.length)];
}

function moneyIdFor(kind) {
  const name = MONEY_BY_NAME[kind];
  const found = PET_ACTIONS.find((item) => item.name === name);
  return found ? found.id : null;
}

function makeVideo(src, { loop }) {
  const video = document.createElement('video');
  video.className = 'pet__layer';
  video.muted = true;
  video.loop = loop;
  video.autoplay = loop;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  if (src) video.src = src;
  return video;
}

function tryPlay(video) {
  try {
    const promise = video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  } catch (err) {
    /* 自动播放被拒绝时静默忽略 */
  }
}

const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * 生成桌宠形象。
 * @param {HTMLElement} container 宿主容器（index.html 里的 #mascot）
 */
export function createMascot(container) {
  const root = document.createElement('div');
  root.className = 'pet';

  const moodLayers = new Map();
  Object.entries(PET_MOODS).forEach(([key, id]) => {
    const video = makeVideo(SRC(id), { loop: true });
    moodLayers.set(key, video);
    root.appendChild(video);
  });

  // 两个动作层轮换：一个在播，另一个用来预载下一段
  const actionLayers = [makeVideo(null, { loop: false }), makeVideo(null, { loop: false })];
  actionLayers.forEach((video) => {
    video.classList.add('pet__layer--action');
    video.preload = 'auto';
    root.appendChild(video);
  });

  container.textContent = '';
  container.appendChild(root);

  let state = 'sleep';
  let reduceMotion = false;
  let destroyed = false;
  let activeIndex = 0; // 当前在播的动作层
  let actionTimer = 0;
  let idleTimer = 0;
  let eggTimer = 0;
  let lastClipId = '';

  const clearTimer = (id) => {
    if (id) clearTimeout(id);
    return 0;
  };

  const currentMoodVideo = () => moodLayers.get(state) || moodLayers.get('slouch');

  /* ---------------- 基础情绪层 ---------------- */

  function showMood(next) {
    const acting = root.classList.contains('is-action');
    moodLayers.forEach((video, key) => {
      if (key === next) {
        video.classList.add('is-active');
        if (!reduceMotion && !acting) tryPlay(video);
      } else {
        video.classList.remove('is-active');
        video.pause();
      }
    });
  }

  /* ---------------- 动作层 ---------------- */

  function stopActions() {
    actionTimer = clearTimer(actionTimer);
    actionLayers.forEach((video) => {
      video.classList.remove('is-active');
      video.pause();
    });
    root.classList.remove('is-action');
    const mood = currentMoodVideo();
    if (mood && !reduceMotion) tryPlay(mood);
  }

  function onActionEnded() {
    stopActions();
  }

  actionLayers.forEach((video) => video.addEventListener('ended', onActionEnded));

  /**
   * 播放一段一次性动画；结束后自动回到当前情绪。
   * @param {string} id 动画 id（a001…a096）
   * @param {{duration?: number, quiet?: boolean}} [options]
   */
  function playClip(id, options = {}) {
    if (destroyed || !id) return;
    if (reduceMotion) {
      // 降低动态效果时不播动作，只切静帧；这里直接忽略
      return;
    }

    const layer = actionLayers[activeIndex];
    const other = actionLayers[1 - activeIndex];
    activeIndex = 1 - activeIndex;

    other.classList.remove('is-active');
    other.pause();

    // 基础情绪层立刻让位：暂停播放并隐藏，避免两套姿势叠出重影
    const currentMood = currentMoodVideo();
    if (currentMood) currentMood.pause();
    root.classList.add('is-action');

    layer.loop = false;
    layer.src = SRC(id);
    layer.currentTime = 0;
    layer.classList.add('is-active');
    tryPlay(layer);

    lastClipId = id;
    actionTimer = clearTimer(actionTimer);
    // 兜底：万一 ended 没触发（文件异常/解码卡住），15 秒后强制回情绪
    actionTimer = setTimeout(stopActions, options.duration || 15000);
  }

  /* ---------------- 摸鱼小动作 & 整点彩蛋 ---------------- */

  function scheduleIdle() {
    idleTimer = clearTimer(idleTimer);
    if (destroyed || reduceMotion) return;
    const delay = randomBetween(25000, 60000);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!destroyed && !reduceMotion && WORKING_STATES.has(state)) {
        // 鱼饼瘫 / 灵魂出窍 时，偶尔让她打个瞌睡（睡觉类动作）
        const dozing = (state === 'slouch' || state === 'soulless') && Math.random() < SLEEP_ACTION_CHANCE;
        const pool = dozing && SLEEP_IDS.length ? SLEEP_IDS : IDLE_IDS;
        if (pool.length) playClip(pick(pool, lastClipId));
      }
      scheduleIdle();
    }, delay);
  }

  function scheduleEgg() {
    eggTimer = clearTimer(eggTimer);
    if (destroyed || reduceMotion) return;
    // 整点彩蛋：每小时左右来一次，带一点抖动，避免整点同时触发
    const delay = randomBetween(55, 65) * 60 * 1000;
    eggTimer = setTimeout(() => {
      eggTimer = 0;
      if (!destroyed && !reduceMotion && state !== 'sleep' && EGG_POOL.length) {
        playClip(pick(EGG_POOL, lastClipId));
      }
      scheduleEgg();
    }, delay);
  }

  /* ---------------- 视线 ---------------- */

  let lookX = 0;
  let lookY = 0;
  function applyLook() {
    root.style.setProperty('--look-x', String(lookX));
    root.style.setProperty('--look-y', String(lookY));
  }

  /* ---------------- 自定义形象（用户选的图片/视频） ---------------- */

  let customEl = null;

  function dropCustomMedia() {
    if (customEl) {
      customEl.remove();
      customEl = null;
    }
    root.classList.remove('has-custom');
    if (!reduceMotion) tryPlay(currentMoodVideo());
  }

  function applyCustomMedia(url, kind) {
    if (destroyed || !url) return;
    dropCustomMedia();
    if (kind === 'video') {
      customEl = document.createElement('video');
      customEl.muted = true;
      customEl.loop = true;
      customEl.autoplay = true;
      customEl.playsInline = true;
      customEl.setAttribute('playsinline', '');
    } else {
      customEl = document.createElement('img');
      customEl.alt = '';
    }
    customEl.className = 'pet__custom';
    customEl.src = url;
    root.appendChild(customEl);
    root.classList.add('has-custom');
    if (kind === 'video') tryPlay(customEl);
  }

  showMood(state);
  applyLook();
  scheduleIdle();
  scheduleEgg();

  return {
    /** 切换基础情绪（由 app.js 按工作进度调用）。 */
    setState(next) {
      if (destroyed || !PET_MOODS[next] || next === state) return state;
      state = next;
      showMood(next);
      if (!WORKING_STATES.has(next)) {
        // 上班前/下班后不排摸鱼小动作
        idleTimer = clearTimer(idleTimer);
      } else {
        scheduleIdle();
      }
      return state;
    },

    /** 降低动态效果：暂停所有动画，只保留当前静帧。 */
    setMotion(options = {}) {
      if (destroyed) return;
      reduceMotion = Boolean(options.reduceMotion);
      root.classList.toggle('is-static', reduceMotion);
      if (reduceMotion) {
        idleTimer = clearTimer(idleTimer);
        eggTimer = clearTimer(eggTimer);
        stopActions();
        moodLayers.forEach((video) => video.pause());
      } else {
        tryPlay(currentMoodVideo());
        scheduleIdle();
        scheduleEgg();
      }
    },

    /** 视线跟随：轻微视差位移。 */
    setLook(nx, ny) {
      if (destroyed) return;
      lookX = Math.max(-1, Math.min(1, Number(nx) || 0));
      lookY = Math.max(-1, Math.min(1, Number(ny) || 0));
      applyLook();
    },

    /** 戳一下：随机播放点击回应，返回一句吐槽。 */
    poke() {
      if (destroyed) return '';
      const list = QUOTES[state] || QUOTES.slouch;
      const line = list[Math.floor(Math.random() * list.length)];
      if (CLICK_POOL.length) playClip(pick(CLICK_POOL, lastClipId));
      return line;
    },

    /**
     * 工资里程碑彩蛋：progress 跨过 25% / 50% / 75% / 100% 时由 app.js 触发。
     * @param {'quarter'|'half'|'threeQuarter'|'done'} kind
     */
    playMilestone(kind) {
      if (destroyed) return;
      const id = moneyIdFor(kind);
      if (id) playClip(id);
    },

    /** 手动播放某类动画（调试 / 未来扩展用）。 */
    playAction(tagOrId) {
      if (destroyed) return;
      if (/^a\d{3}$/.test(tagOrId)) {
        playClip(tagOrId);
        return;
      }
      const pool = byTag([tagOrId]).map((item) => item.id).filter((id) => !MOOD_IDS.has(id));
      if (pool.length) playClip(pick(pool, lastClipId));
    },

    /** 用自定义图片/视频替换内置桌宠。 */
    setCustomMedia(url, kind) {
      if (destroyed) return;
      applyCustomMedia(url, kind);
    },

    /** 回到内置桌宠。 */
    clearCustomMedia() {
      if (destroyed) return;
      dropCustomMedia();
    },

    /** 卸载。 */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      idleTimer = clearTimer(idleTimer);
      eggTimer = clearTimer(eggTimer);
      actionTimer = clearTimer(actionTimer);
      [...moodLayers.values(), ...actionLayers].forEach((video) => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      root.remove();
    },
  };
}

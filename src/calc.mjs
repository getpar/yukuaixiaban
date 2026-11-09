/**
 * 「鱼快下班」计算内核（纯函数，无 DOM / Electron / 网络依赖）。
 *
 * 设计约束（详见 docs/开发文档.md §6.1）：
 * - 所有时间按调用方的系统本地时区解释，不做时区换算；
 * - 默认午休不切分（上班到下班全部计薪）；传入 lunch 时午休不计薪（P2）；
 * - 金额内部保留完整浮点精度，只在 formatMoney 里四舍五入到两位；
 * - `shiftFor` 对非法上下班时间抛出可读的 Error，绝不返回 NaN 结构。
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

/** 默认设置（与 docs/开发文档.md §6.4 的默认 settings.json 逐字段一致，P2 增加午休三项）。 */
export const DEFAULT_SETTINGS = {
  version: 1,
  salaryType: 'monthly',
  monthlySalary: null,
  monthlyWorkdays: 21.75,
  hourlyRate: null,
  workStart: '09:00',
  workEnd: '18:00',
  lunchEnabled: false,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  alwaysOnTop: true,
  reduceMotion: false,
};

/** HH:MM，也接受 H:MM；小时 00–23、分钟 00–59。 */
const HHMM_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 金额格式化器：英文区域保证千分位是 ASCII 逗号、小数点是 ASCII 句号。 */
const MONEY_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * 把输入转成有限数字；空串、null、undefined、NaN、Infinity 一律返回 NaN。
 * 允许数字字符串（设置面板的 <input> 值可能是字符串）。
 */
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string' && value.trim() !== '') return Number(value.trim());
  return Number.NaN;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 视为“未填写”的值：null / undefined / 空白字符串。 */
function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** 用于错误信息的安全展示。 */
function describe(value) {
  if (typeof value === 'string') return value === '' ? '空字符串' : JSON.stringify(value);
  return String(value);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 取某个时间戳所在“本地自然日”的 00:00:00.000。 */
function startOfLocalDay(ms) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 分钟差 → 0–1439 的“相对上班时刻”偏移（跨夜班次也按这个口径）。 */
function minuteOffset(minutes, originMinutes) {
  return ((minutes - originMinutes) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 解析 "HH:MM" 为当天分钟数；非法输入返回 null（不抛错）。 */
export function parseHHMM(text) {
  if (typeof text !== 'string') return null;
  const matched = HHMM_PATTERN.exec(text.trim());
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

/** 解析班次时间，非法时抛出可读 Error。 */
function parseTimeOrThrow(value, label) {
  const minutes = parseHHMM(value);
  if (minutes === null) {
    throw new Error(`${label}无效：${describe(value)}，应为 HH:MM 格式（00:00–23:59）`);
  }
  return minutes;
}

/**
 * 解析午休配置，返回相对班次起点的偏移；不启用 / 时间非法 / 不在班次内一律返回 null。
 *
 * 判定规则（P2 任务书 §三）：
 *   lunchStartOffset = (lunchStart - workStart + 1440) % 1440，lunchEndOffset 同理；
 *   仅当 endOffset > startOffset 且 endOffset <= 班次总分钟数时午休才生效。
 * 因此 22:00–06:00 + 02:00–03:00 这类夜班午休也能正确识别（偏移 240–300 分钟）。
 */
function resolveLunchPlan(lunch, workStartMinutes, totalMinutes) {
  if (!lunch || typeof lunch !== 'object') return null;

  // 标准入参是 { enabled, start, end }；同时容忍直接传 settings（lunchEnabled/lunchStart/lunchEnd）。
  const enabled = lunch.enabled !== undefined ? lunch.enabled : lunch.lunchEnabled;
  if (enabled !== undefined && !enabled) return null;
  const startText = lunch.start !== undefined ? lunch.start : lunch.lunchStart;
  const endText = lunch.end !== undefined ? lunch.end : lunch.lunchEnd;

  const startMinutes = parseHHMM(startText);
  const endMinutes = parseHHMM(endText);
  if (startMinutes === null || endMinutes === null) return null;

  const startOffset = minuteOffset(startMinutes, workStartMinutes);
  const endOffset = minuteOffset(endMinutes, workStartMinutes);
  if (!(endOffset > startOffset) || !(endOffset <= totalMinutes)) return null;

  return {
    startOffset,
    endOffset,
    durationSec: (endOffset - startOffset) * SECONDS_PER_MINUTE,
  };
}

/** 工作区间内再细分出 'lunch'：now 落在午休区间内（左闭右开）。 */
function workingKindAt(nowMs, shiftStartMs, lunchPlan) {
  if (!lunchPlan) return 'working';
  const lunchStartMs = shiftStartMs + lunchPlan.startOffset * MS_PER_MINUTE;
  const lunchEndMs = shiftStartMs + lunchPlan.endOffset * MS_PER_MINUTE;
  return nowMs >= lunchStartMs && nowMs < lunchEndMs ? 'lunch' : 'working';
}

/**
 * 组装班次结果。
 * - totalSec / workedSec：墙上时间（跨夜、午休照常走）；
 * - effectiveTotalSec / effectiveWorkedSec：扣除午休后的计薪时间；
 * - progress 用有效时间计算；remainSec 始终是距下班的真实倒计时。
 */
function buildShift(kind, startMs, endMs, totalSec, nowMs, lunchPlan) {
  const totalMs = endMs - startMs;
  const lunchDurationSec = lunchPlan ? lunchPlan.durationSec : 0;
  const effectiveTotalSec = totalSec - lunchDurationSec;
  const lunchStartMs = lunchPlan ? startMs + lunchPlan.startOffset * MS_PER_MINUTE : null;
  const lunchEndMs = lunchPlan ? startMs + lunchPlan.endOffset * MS_PER_MINUTE : null;

  const isBefore = kind === 'before';
  const isAfter = kind === 'after';

  let elapsedMs = 0;
  if (isAfter) elapsedMs = totalMs;
  else if (!isBefore) elapsedMs = clamp(nowMs - startMs, 0, totalMs);

  // 已落入午休区间的秒数：午休开始前为 0，午休中随时间增长，午休结束后固定为整段时长。
  let lunchOverlapMs = 0;
  if (lunchPlan && elapsedMs > 0) {
    lunchOverlapMs = clamp(nowMs - lunchStartMs, 0, lunchEndMs - lunchStartMs);
  }
  const effectiveWorkedMs = Math.max(elapsedMs - lunchOverlapMs, 0);

  const workedSec = isAfter ? totalSec : Math.floor(elapsedMs / 1000);
  const effectiveWorkedSec = isAfter ? effectiveTotalSec : Math.floor(effectiveWorkedMs / 1000);

  let progress = 0;
  if (isAfter) progress = 1;
  else if (!isBefore && effectiveTotalSec > 0) {
    progress = clamp(effectiveWorkedMs / (effectiveTotalSec * 1000), 0, 1);
  }

  let remainSec = 0;
  if (isBefore) remainSec = Math.max(Math.ceil((startMs - nowMs) / 1000), 0);
  else if (!isAfter) remainSec = Math.max(Math.ceil((endMs - nowMs) / 1000), 0);

  return {
    kind,
    startMs,
    endMs,
    totalSec,
    workedSec,
    remainSec,
    progress,
    effectiveTotalSec,
    effectiveWorkedSec,
    lunchStartMs,
    lunchEndMs,
    lunchActive: Boolean(lunchPlan),
  };
}

/**
 * 计算 nowMs 所对应的“当前/最近一个班次”。
 *
 * - 上班前：kind='before'，remainSec=距上班秒数，progress=0；
 * - 工作区间内：kind='working'，按秒计入已工作；
 * - 午休区间内：kind='lunch'，progress 冻结在午休开始时的值；
 * - 下班后：kind='after'，remainSec=0，progress=1。
 *
 * 跨夜班次（workEnd <= workStart 视为次日下班）：
 * - 凌晨仍处于昨晚开始的班次时，班次起点按前一天计算（working）；
 * - 该班次当天结束后到下一次上班前，状态为 after（最近一个班次已下班）。
 *   普通白班则在凌晨到上班前显示 before（今日班次尚未开始），
 *   这样“上班前”状态在每天 00:00 后仍然可达，符合文档 §6.2。
 *
 * @param {number|Date} nowMs 当前毫秒时间戳
 * @param {string} workStart 上班时间 'HH:MM'
 * @param {string} workEnd 下班时间 'HH:MM'
 * @param {{enabled?: boolean, start?: string, end?: string}} [lunch] 午休配置；不传 = 午休照常计薪。
 *   也兼容直接传 settings（读取 lunchEnabled / lunchStart / lunchEnd）。
 */
export function shiftFor(nowMs, workStart, workEnd, lunch) {
  const now = nowMs instanceof Date ? nowMs.getTime() : nowMs;
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new Error(`nowMs 必须是有效的毫秒时间戳，收到：${describe(nowMs)}`);
  }

  const startMinutes = parseTimeOrThrow(workStart, '上班时间');
  const endMinutes = parseTimeOrThrow(workEnd, '下班时间');
  if (startMinutes === endMinutes) {
    throw new Error(`上班时间与下班时间不能相同（${workStart}），班次时长必须大于 0`);
  }

  const isOvernight = endMinutes < startMinutes;
  const totalMinutes = isOvernight
    ? MINUTES_PER_DAY - startMinutes + endMinutes
    : endMinutes - startMinutes;
  const totalSec = totalMinutes * SECONDS_PER_MINUTE;
  const totalMs = totalMinutes * MS_PER_MINUTE;

  const lunchPlan = resolveLunchPlan(lunch, startMinutes, totalMinutes);

  const todayStartMs = startOfLocalDay(now) + startMinutes * MS_PER_MINUTE;
  const todayEndMs = todayStartMs + totalMs;
  const previousStartMs = todayStartMs - MS_PER_DAY;
  const previousEndMs = todayEndMs - MS_PER_DAY;

  // 1) 今天开始的班次正在进行
  if (now >= todayStartMs && now < todayEndMs) {
    const kind = workingKindAt(now, todayStartMs, lunchPlan);
    return buildShift(kind, todayStartMs, todayEndMs, totalSec, now, lunchPlan);
  }
  // 2) 跨夜班次：仍处于昨晚开始、今晨结束的那一班
  if (isOvernight && now >= previousStartMs && now < previousEndMs) {
    const kind = workingKindAt(now, previousStartMs, lunchPlan);
    return buildShift(kind, previousStartMs, previousEndMs, totalSec, now, lunchPlan);
  }
  // 3) 今天的班次已经结束
  if (now >= todayEndMs) {
    return buildShift('after', todayStartMs, todayEndMs, totalSec, now, lunchPlan);
  }
  // 4) 跨夜班次：最近一个班次今天已经结束（例如 22:00–06:00 的 12:00）
  if (isOvernight && now >= previousEndMs) {
    return buildShift('after', previousStartMs, previousEndMs, totalSec, now, lunchPlan);
  }
  // 5) 今日班次尚未开始
  return buildShift('before', todayStartMs, todayEndMs, totalSec, now, lunchPlan);
}

/** 从班次对象里取 0–1 的进度；progress 缺失时用 workedSec/totalSec 兜底。 */
function progressOf(shift) {
  const progress = toFiniteNumber(shift.progress);
  if (Number.isFinite(progress)) return clamp(progress, 0, 1);
  const workedSec = toFiniteNumber(shift.workedSec);
  if (Number.isFinite(workedSec)) return clamp(workedSec / shift.totalSec, 0, 1);
  return 0;
}

/**
 * 由设置与班次计算工资数据。
 *
 * 月薪：dailyPay = 月薪 ÷ 计薪天数；perMinute = dailyPay ÷ 有效班次分钟数。
 * 时薪：perMinute = 时薪 ÷ 60；dailyPay = perMinute × 有效班次分钟数。
 * earned = dailyPay × progress；remaining 不小于 0。
 *
 * “有效班次”= 扣除午休后的计薪时长（shift.effectiveTotalSec）；午休未启用时与原口径一致。
 * 工资未填写 / 非法时返回全 0（并保留班次进度），保证界面不会出现 NaN；
 * 是否允许保存由 validateSettings 决定。
 */
export function payFor(settings, shift) {
  if (!shift || typeof shift !== 'object' || !Number.isFinite(shift.totalSec) || shift.totalSec <= 0) {
    throw new Error('payFor 需要有效的班次数据：shift.totalSec 必须是大于 0 的秒数');
  }

  const progress = progressOf(shift);
  const paidTotalSec =
    Number.isFinite(shift.effectiveTotalSec) && shift.effectiveTotalSec > 0
      ? shift.effectiveTotalSec
      : shift.totalSec;
  const totalMinutes = paidTotalSec / SECONDS_PER_MINUTE;
  const source = settings && typeof settings === 'object' ? settings : {};

  let dailyPay = 0;
  let perMinute = 0;

  if (source.salaryType === 'hourly') {
    const hourlyRate = toFiniteNumber(source.hourlyRate);
    if (Number.isFinite(hourlyRate) && hourlyRate > 0) {
      perMinute = hourlyRate / SECONDS_PER_MINUTE;
      dailyPay = perMinute * totalMinutes;
    }
  } else {
    const monthlySalary = toFiniteNumber(source.monthlySalary);
    const monthlyWorkdays = toFiniteNumber(source.monthlyWorkdays);
    if (
      Number.isFinite(monthlySalary) &&
      monthlySalary > 0 &&
      Number.isFinite(monthlyWorkdays) &&
      monthlyWorkdays > 0
    ) {
      dailyPay = monthlySalary / monthlyWorkdays;
      perMinute = dailyPay / totalMinutes;
    }
  }

  const earned = dailyPay * progress;
  const remaining = Math.max(dailyPay - earned, 0);

  return { dailyPay, perMinute, earned, remaining, progress };
}

/**
 * 秒数格式化为 HH:MM:SS。
 * 负数按 0；小时可以超过 99（如 100:00:00）；小数秒向下取整。
 */
export function formatHMS(totalSeconds) {
  let seconds = Math.floor(toFiniteNumber(totalSeconds));
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const restSeconds = seconds % SECONDS_PER_MINUTE;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(restSeconds)}`;
}

/**
 * 金额格式化为两位小数 + 千分位，不带货币符号。
 * 采用十进制字符串移位实现“四舍五入”，避免 1.005 * 100 这类二进制误差。
 */
export function formatMoney(value) {
  const amount = toFiniteNumber(value);
  if (!Number.isFinite(amount)) return '0.00';

  const negative = amount < 0;
  const abs = Math.abs(amount);

  // 用字符串移位得到分，再取整：等价于十进制四舍五入（1.005 -> 1.01）。
  let cents = Math.round(Number(`${abs}e2`));
  if (!Number.isFinite(cents)) cents = Math.round(abs * 100);
  if (!Number.isFinite(cents)) return MONEY_FORMATTER.format(abs);

  const text = MONEY_FORMATTER.format(cents / 100);
  return negative && cents > 0 ? `-${text}` : text;
}

/**
 * 进度格式化为 0–100 的整数百分比字符串（不带 %）。
 * 输入先夹到 [0, 1]，非法输入按 0。
 */
export function formatPercent(progress) {
  const value = toFiniteNumber(progress);
  if (!Number.isFinite(value)) return '0';

  const clamped = clamp(value, 0, 1);
  const shifted = Math.round(Number(`${clamped}e2`));
  const percent = Number.isFinite(shifted) ? shifted : Math.round(clamped * 100);
  return String(clamp(percent, 0, 100));
}

/** 校验 salaryType='monthly' 的字段。 */
function validateMonthly(source, errors) {
  const salary = toFiniteNumber(source.monthlySalary);
  if (isBlank(source.monthlySalary)) errors.monthlySalary = '请填写月薪';
  else if (!Number.isFinite(salary)) errors.monthlySalary = '月薪必须是数字';
  else if (salary <= 0) errors.monthlySalary = '月薪必须大于 0';

  const workdays = toFiniteNumber(source.monthlyWorkdays);
  if (isBlank(source.monthlyWorkdays)) errors.monthlyWorkdays = '请填写每月计薪天数';
  else if (!Number.isFinite(workdays)) errors.monthlyWorkdays = '每月计薪天数必须是数字';
  else if (workdays <= 0) errors.monthlyWorkdays = '每月计薪天数必须大于 0';
}

/** 校验 salaryType='hourly' 的字段。 */
function validateHourly(source, errors) {
  const rate = toFiniteNumber(source.hourlyRate);
  if (isBlank(source.hourlyRate)) errors.hourlyRate = '请填写时薪';
  else if (!Number.isFinite(rate)) errors.hourlyRate = '时薪必须是数字';
  else if (rate <= 0) errors.hourlyRate = '时薪必须大于 0';
}

/** 校验午休：lunchEnabled 为 true 时才检查，字段错误写在 lunchStart / lunchEnd。 */
function validateLunch(source, errors) {
  if (!source.lunchEnabled) return;

  const startMinutes = parseHHMM(source.lunchStart);
  if (isBlank(source.lunchStart)) errors.lunchStart = '请填写午休开始时间';
  else if (startMinutes === null) errors.lunchStart = '午休开始时间格式应为 HH:MM（如 12:00）';

  const endMinutes = parseHHMM(source.lunchEnd);
  if (isBlank(source.lunchEnd)) errors.lunchEnd = '请填写午休结束时间';
  else if (endMinutes === null) errors.lunchEnd = '午休结束时间格式应为 HH:MM（如 13:00）';

  if (startMinutes === null || endMinutes === null) return;

  if (startMinutes === endMinutes) {
    errors.lunchEnd = '午休开始与结束时间不能相同';
    return;
  }

  // 上班/下班时间本身非法或相同时，无法判断午休是否在班次内，交给上下班字段报错即可。
  const workStartMinutes = parseHHMM(source.workStart);
  const workEndMinutes = parseHHMM(source.workEnd);
  if (
    workStartMinutes === null ||
    workEndMinutes === null ||
    workStartMinutes === workEndMinutes
  ) {
    return;
  }

  const totalMinutes =
    workEndMinutes < workStartMinutes
      ? MINUTES_PER_DAY - workStartMinutes + workEndMinutes
      : workEndMinutes - workStartMinutes;
  const startOffset = minuteOffset(startMinutes, workStartMinutes);
  const endOffset = minuteOffset(endMinutes, workStartMinutes);

  if (endOffset <= startOffset) {
    errors.lunchStart = '午休时间必须完整落在上班与下班时间之内';
  } else if (endOffset > totalMinutes) {
    errors.lunchEnd = '午休时间必须完整落在上班与下班时间之内';
  }
}

/**
 * 校验设置，返回 { ok, errors }；errors 的 key 与设置字段同名，值为中文提示。
 * 校验项与文档 §6.4 一致：工资 > 0、计薪天数 > 0、时间有效、班次时长 > 0；
 * lunchEnabled 为 true 时额外校验午休时间合法、不同、且完整落在班次内。
 */
export function validateSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const errors = {};

  const salaryType = source.salaryType === undefined ? 'monthly' : source.salaryType;
  if (salaryType !== 'monthly' && salaryType !== 'hourly') {
    errors.salaryType = '计薪方式只能是月薪或时薪';
  }

  if (salaryType === 'hourly') validateHourly(source, errors);
  else validateMonthly(source, errors);

  const startMinutes = parseHHMM(source.workStart);
  if (isBlank(source.workStart)) errors.workStart = '请填写上班时间';
  else if (startMinutes === null) errors.workStart = '上班时间格式应为 HH:MM（如 09:00）';

  const endMinutes = parseHHMM(source.workEnd);
  if (isBlank(source.workEnd)) errors.workEnd = '请填写下班时间';
  else if (endMinutes === null) errors.workEnd = '下班时间格式应为 HH:MM（如 18:00）';

  if (!errors.workStart && !errors.workEnd && startMinutes === endMinutes) {
    errors.workEnd = '上班时间与下班时间不能相同';
  }

  validateLunch(source, errors);

  return { ok: Object.keys(errors).length === 0, errors };
}

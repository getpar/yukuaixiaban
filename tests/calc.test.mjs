// 「鱼快下班」计算内核单元测试：node:test + node:assert/strict，零依赖。
// 运行：在 D:\CodexDemo\XiaBan 下执行 `node --test "tests/*.mjs"`（Node 24 不接受目录参数）

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  parseHHMM,
  shiftFor,
  payFor,
  formatHMS,
  formatMoney,
  formatPercent,
  validateSettings,
} from '../src/calc.mjs';

/** 本地时区时间戳（月份 1–12，测试在任何时区都成立）。 */
function local(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime();
}

/** 浮点近似断言。 */
function closeTo(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    `${message || '数值不在容差内'}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`,
  );
}

// ---------------------------------------------------------------- 默认设置

test('DEFAULT_SETTINGS 与文档 §6.4 的默认值完全一致（P2 增加午休三项）', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
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
  });
});

// ---------------------------------------------------------------- parseHHMM

test('parseHHMM 解析合法 HH:MM', () => {
  assert.equal(parseHHMM('09:05'), 545);
  assert.equal(parseHHMM('00:00'), 0);
  assert.equal(parseHHMM('00:59'), 59);
  assert.equal(parseHHMM('23:59'), 1439);
  assert.equal(parseHHMM('9:05'), 545);
  assert.equal(parseHHMM(' 09:05 '), 545); // 前后空白容错
});

test('parseHHMM 对非法输入返回 null', () => {
  const invalid = [
    '24:00',
    '09:60',
    '09:5',
    '09:05:00',
    '9',
    '',
    '   ',
    'abc',
    '09-05',
    null,
    undefined,
    905,
    {},
    Number.NaN,
  ];
  for (const value of invalid) {
    assert.equal(parseHHMM(value), null, `应判为非法: ${String(value)}`);
  }
});

// ---------------------------------------------------------------- shiftFor：普通白班

test('shiftFor 上班前：before，remainSec=距上班秒数，progress=0', () => {
  const now = local(2026, 11, 6, 8, 0, 0);
  const shift = shiftFor(now, '09:00', '18:00');

  assert.equal(shift.kind, 'before');
  assert.equal(shift.startMs, local(2026, 11, 6, 9, 0, 0));
  assert.equal(shift.endMs, local(2026, 11, 6, 18, 0, 0));
  assert.equal(shift.totalSec, 9 * 3600);
  assert.equal(shift.workedSec, 0);
  assert.equal(shift.remainSec, 3600);
  assert.equal(shift.progress, 0);
});

test('shiftFor 工作中 15:45：progress=0.75，剩余 2:15:00', () => {
  const now = local(2026, 11, 6, 15, 45, 0);
  const shift = shiftFor(now, '09:00', '18:00');

  assert.equal(shift.kind, 'working');
  assert.equal(shift.startMs, local(2026, 11, 6, 9, 0, 0));
  assert.equal(shift.endMs, local(2026, 11, 6, 18, 0, 0));
  assert.equal(shift.totalSec, 32400);
  assert.equal(shift.workedSec, 24300);
  assert.equal(shift.remainSec, 8100);
  assert.equal(shift.progress, 0.75);
  assert.equal(formatHMS(shift.remainSec), '02:15:00');
});

test('shiftFor 边界：上班瞬间 working，下班瞬间 after', () => {
  const atStart = shiftFor(local(2026, 11, 6, 9, 0, 0), '09:00', '18:00');
  assert.equal(atStart.kind, 'working');
  assert.equal(atStart.progress, 0);
  assert.equal(atStart.workedSec, 0);
  assert.equal(atStart.remainSec, 32400);

  const atEnd = shiftFor(local(2026, 11, 6, 18, 0, 0), '09:00', '18:00');
  assert.equal(atEnd.kind, 'after');
  assert.equal(atEnd.progress, 1);
  assert.equal(atEnd.workedSec, 32400);
  assert.equal(atEnd.remainSec, 0);
});

test('shiftFor 下班后：after，progress=1，remainSec=0', () => {
  const shift = shiftFor(local(2026, 11, 6, 20, 30, 0), '09:00', '18:00');

  assert.equal(shift.kind, 'after');
  assert.equal(shift.startMs, local(2026, 11, 6, 9, 0, 0));
  assert.equal(shift.endMs, local(2026, 11, 6, 18, 0, 0));
  assert.equal(shift.workedSec, 32400);
  assert.equal(shift.remainSec, 0);
  assert.equal(shift.progress, 1);
});

test('shiftFor 跨过 00:00 后重新显示今日上班前的倒计时', () => {
  const shift = shiftFor(local(2026, 11, 6, 0, 30, 0), '09:00', '18:00');

  assert.equal(shift.kind, 'before');
  assert.equal(shift.startMs, local(2026, 11, 6, 9, 0, 0));
  assert.equal(shift.remainSec, 8.5 * 3600);
  assert.equal(shift.progress, 0);
});

test('shiftFor 接受 Date 对象作为 nowMs', () => {
  const shift = shiftFor(new Date(local(2026, 11, 6, 15, 45, 0)), '09:00', '18:00');
  assert.equal(shift.kind, 'working');
  assert.equal(shift.progress, 0.75);
});

// ---------------------------------------------------------------- shiftFor：跨夜

test('shiftFor 跨夜 22:00-06:00 在 02:00：属于昨晚开始的班次，progress≈0.5', () => {
  const now = local(2026, 11, 6, 2, 0, 0);
  const shift = shiftFor(now, '22:00', '06:00');

  assert.equal(shift.kind, 'working');
  assert.equal(shift.startMs, local(2026, 11, 5, 22, 0, 0));
  assert.equal(shift.endMs, local(2026, 11, 6, 6, 0, 0));
  assert.equal(shift.totalSec, 8 * 3600);
  assert.equal(shift.workedSec, 4 * 3600);
  assert.equal(shift.remainSec, 4 * 3600);
  closeTo(shift.progress, 0.5);
});

test('shiftFor 跨夜：00:00 与 23:00 都处于当天开始的班次', () => {
  const midnight = shiftFor(local(2026, 11, 6, 0, 0, 0), '22:00', '06:00');
  assert.equal(midnight.kind, 'working');
  assert.equal(midnight.startMs, local(2026, 11, 5, 22, 0, 0));
  assert.equal(midnight.workedSec, 2 * 3600);
  closeTo(midnight.progress, 0.25);

  const lateNight = shiftFor(local(2026, 11, 6, 23, 0, 0), '22:00', '06:00');
  assert.equal(lateNight.kind, 'working');
  assert.equal(lateNight.startMs, local(2026, 11, 6, 22, 0, 0));
  assert.equal(lateNight.endMs, local(2026, 11, 7, 6, 0, 0));
  assert.equal(lateNight.workedSec, 3600);
  closeTo(lateNight.progress, 1 / 8);
});

test('shiftFor 跨夜：下班后（当天 06:00 之后到 22:00）显示 after', () => {
  const atEnd = shiftFor(local(2026, 11, 6, 6, 0, 0), '22:00', '06:00');
  assert.equal(atEnd.kind, 'after');
  assert.equal(atEnd.startMs, local(2026, 11, 5, 22, 0, 0));
  assert.equal(atEnd.endMs, local(2026, 11, 6, 6, 0, 0));
  assert.equal(atEnd.workedSec, 28800);
  assert.equal(atEnd.remainSec, 0);
  assert.equal(atEnd.progress, 1);

  const noon = shiftFor(local(2026, 11, 6, 12, 0, 0), '22:00', '06:00');
  assert.equal(noon.kind, 'after');
  assert.equal(noon.startMs, local(2026, 11, 5, 22, 0, 0));
  assert.equal(noon.endMs, local(2026, 11, 6, 6, 0, 0));
  assert.equal(noon.progress, 1);
});

test('shiftFor 跨夜：下班前一秒仍是 working', () => {
  const shift = shiftFor(local(2026, 11, 6, 5, 59, 59), '22:00', '06:00');
  assert.equal(shift.kind, 'working');
  assert.equal(shift.remainSec, 1);
  assert.ok(shift.progress > 0.999);
});

test('shiftFor 非法输入抛出可读 Error，而不是返回 NaN 结构', () => {
  const now = local(2026, 11, 6, 10, 0, 0);

  assert.throws(() => shiftFor(now, '9:75', '18:00'), /上班时间/);
  assert.throws(() => shiftFor(now, '09:00', '18:00:00'), /下班时间/);
  assert.throws(() => shiftFor(now, null, '18:00'), /上班时间/);
  assert.throws(() => shiftFor(now, '09:00', '09:00'), /不能相同/);
  assert.throws(() => shiftFor(now, '18:00', '18:00'), /不能相同/);
  assert.throws(() => shiftFor(Number.NaN, '09:00', '18:00'), /nowMs/);
  assert.throws(() => shiftFor(undefined, '09:00', '18:00'), /nowMs/);
});

// ---------------------------------------------------------------- payFor

test('payFor 月薪算例：12000 / 21.75 / 09:00-18:00 / 15:45', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  const shift = shiftFor(local(2026, 11, 6, 15, 45, 0), '09:00', '18:00');
  const pay = payFor(settings, shift);

  closeTo(pay.dailyPay, 12000 / 21.75);
  closeTo(pay.perMinute, 1.02, 0.01, '每分钟收入');
  closeTo(pay.earned, 413.79, 0.01, '今日已赚');
  closeTo(pay.remaining, 137.93, 0.01, '今日还能赚');
  assert.equal(pay.progress, 0.75);

  assert.equal(formatMoney(pay.perMinute), '1.02');
  assert.equal(formatMoney(pay.earned), '413.79');
  assert.equal(formatMoney(pay.remaining), '137.93');
  assert.equal(formatMoney(pay.dailyPay), '551.72');
});

test('payFor 时薪算例：60 元/时，09:00-18:00 → 日薪 540、每分钟 1.00', () => {
  const settings = { ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: 60 };
  const shift = shiftFor(local(2026, 11, 6, 15, 45, 0), '09:00', '18:00');
  const pay = payFor(settings, shift);

  assert.equal(pay.dailyPay, 540);
  assert.equal(pay.perMinute, 1);
  assert.equal(pay.earned, 405);
  assert.equal(pay.remaining, 135);
  assert.equal(formatMoney(pay.dailyPay), '540.00');
  assert.equal(formatMoney(pay.perMinute), '1.00');
  assert.equal(formatMoney(pay.earned), '405.00');
});

test('payFor 上班前：earned=0、progress=0、remaining=日薪', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  const shift = shiftFor(local(2026, 11, 6, 8, 0, 0), '09:00', '18:00');
  const pay = payFor(settings, shift);

  assert.equal(pay.progress, 0);
  assert.equal(pay.earned, 0);
  closeTo(pay.remaining, pay.dailyPay);
  assert.equal(formatMoney(pay.earned), '0.00');
  assert.equal(formatMoney(pay.remaining), '551.72');
});

test('payFor 下班后：earned=dailyPay、progress=1、remaining=0', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  const shift = shiftFor(local(2026, 11, 6, 20, 0, 0), '09:00', '18:00');
  const pay = payFor(settings, shift);

  assert.equal(pay.progress, 1);
  closeTo(pay.earned, pay.dailyPay);
  assert.equal(pay.remaining, 0);
  assert.equal(formatMoney(pay.earned), '551.72');
});

test('payFor 跨夜班次：月薪在 02:00 已赚一半', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  const shift = shiftFor(local(2026, 11, 6, 2, 0, 0), '22:00', '06:00');
  const pay = payFor(settings, shift);

  assert.equal(pay.progress, 0.5);
  closeTo(pay.earned, (12000 / 21.75) * 0.5);
  assert.equal(formatMoney(pay.earned), '275.86');
  assert.equal(formatMoney(pay.remaining), '275.86');
});

test('payFor 跨夜班次：时薪日薪按 8 小时班次计算', () => {
  const settings = { ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: 60 };
  const shift = shiftFor(local(2026, 11, 6, 2, 0, 0), '22:00', '06:00');
  const pay = payFor(settings, shift);

  assert.equal(pay.perMinute, 1);
  assert.equal(pay.dailyPay, 480);
  assert.equal(pay.earned, 240);
  assert.equal(pay.remaining, 240);
});

test('payFor 工资未设置时返回全 0，不产生 NaN', () => {
  const shift = shiftFor(local(2026, 11, 6, 15, 45, 0), '09:00', '18:00');
  const pay = payFor(DEFAULT_SETTINGS, shift); // monthlySalary: null

  assert.deepEqual(pay, {
    dailyPay: 0,
    perMinute: 0,
    earned: 0,
    remaining: 0,
    progress: 0.75,
  });
});

test('payFor 兼容数字字符串，并在 progress 缺失时用 workedSec 兜底', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: '12000', monthlyWorkdays: '21.75' };
  const shift = { totalSec: 32400, workedSec: 24300 };
  const pay = payFor(settings, shift);

  assert.equal(pay.progress, 0.75);
  closeTo(pay.earned, 413.79, 0.01);
});

test('payFor 拒绝无效班次数据', () => {
  assert.throws(() => payFor(DEFAULT_SETTINGS, null), /班次/);
  assert.throws(() => payFor(DEFAULT_SETTINGS, { totalSec: 0 }), /班次/);
  assert.throws(() => payFor(DEFAULT_SETTINGS, { totalSec: Number.NaN }), /班次/);
});

// ---------------------------------------------------------------- validateSettings

test('validateSettings 默认设置缺月薪 → 不通过', () => {
  const result = validateSettings(DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.ok(result.errors.monthlySalary);
  assert.equal(result.errors.monthlyWorkdays, undefined);
});

test('validateSettings 合法月薪 / 时薪设置 → 通过', () => {
  const monthly = validateSettings({ ...DEFAULT_SETTINGS, monthlySalary: 12000 });
  assert.deepEqual(monthly, { ok: true, errors: {} });

  const monthlyStrings = validateSettings({ ...DEFAULT_SETTINGS, monthlySalary: '12000', monthlyWorkdays: '21.75' });
  assert.equal(monthlyStrings.ok, true);

  const hourly = validateSettings({ ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: 60 });
  assert.deepEqual(hourly, { ok: true, errors: {} });
});

test('validateSettings 工资为空 / 0 / 负数 / 非数字', () => {
  const cases = [
    { value: null, pattern: /请填写月薪/ },
    { value: undefined, pattern: /请填写月薪/ },
    { value: '', pattern: /请填写月薪/ },
    { value: '   ', pattern: /请填写月薪/ },
    { value: 0, pattern: /大于 0/ },
    { value: -100, pattern: /大于 0/ },
    { value: 'abc', pattern: /数字/ },
  ];
  for (const { value, pattern } of cases) {
    const result = validateSettings({ ...DEFAULT_SETTINGS, monthlySalary: value });
    assert.equal(result.ok, false, `应校验失败: ${String(value)}`);
    assert.match(result.errors.monthlySalary ?? '', pattern, `提示不符: ${String(value)}`);
  }

  const { monthlySalary: _removed, ...withoutSalary } = DEFAULT_SETTINGS;
  assert.ok(validateSettings(withoutSalary).errors.monthlySalary);
});

test('validateSettings 计薪天数非法', () => {
  const base = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  for (const value of [0, -1, 'abc']) {
    const result = validateSettings({ ...base, monthlyWorkdays: value });
    assert.equal(result.ok, false, `应校验失败: ${String(value)}`);
    assert.ok(result.errors.monthlyWorkdays);
  }
  const blank = validateSettings({ ...base, monthlyWorkdays: '' });
  assert.match(blank.errors.monthlyWorkdays ?? '', /请填写/);
});

test('validateSettings 时薪模式只校验 hourlyRate', () => {
  const blank = validateSettings({ ...DEFAULT_SETTINGS, salaryType: 'hourly' });
  assert.equal(blank.ok, false);
  assert.ok(blank.errors.hourlyRate);
  assert.equal(blank.errors.monthlySalary, undefined);

  for (const value of [0, -5, 'abc', '']) {
    const result = validateSettings({ ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: value });
    assert.equal(result.ok, false, `应校验失败: ${String(value)}`);
    assert.ok(result.errors.hourlyRate);
  }
});

test('validateSettings 时间格式非法 / 空 / 起止相同', () => {
  const base = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };

  const badStart = validateSettings({ ...base, workStart: '25:00' });
  assert.equal(badStart.ok, false);
  assert.match(badStart.errors.workStart ?? '', /格式/);

  const badEnd = validateSettings({ ...base, workEnd: '18:60' });
  assert.equal(badEnd.ok, false);
  assert.match(badEnd.errors.workEnd ?? '', /格式/);

  const emptyStart = validateSettings({ ...base, workStart: '' });
  assert.equal(emptyStart.ok, false);
  assert.match(emptyStart.errors.workStart ?? '', /请填写上班时间/);

  for (const same of ['09:00', '22:00']) {
    const result = validateSettings({ ...base, workStart: same, workEnd: same });
    assert.equal(result.ok, false, `起止相同应校验失败: ${same}`);
    assert.match(result.errors.workEnd ?? '', /不能相同/);
  }

  // 跨夜是合法配置
  const overnight = validateSettings({ ...base, workStart: '22:00', workEnd: '06:00' });
  assert.equal(overnight.ok, true);
});

test('validateSettings 对 null / 非对象输入不抛错', () => {
  const result = validateSettings(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.monthlySalary);
  assert.ok(result.errors.workStart);
});

// ---------------------------------------------------------------- 格式化

test('formatHMS 边界：0、负数、跨 99 小时、小数秒', () => {
  assert.equal(formatHMS(0), '00:00:00');
  assert.equal(formatHMS(59), '00:00:59');
  assert.equal(formatHMS(60), '00:01:00');
  assert.equal(formatHMS(3599), '00:59:59');
  assert.equal(formatHMS(3725), '01:02:05');
  assert.equal(formatHMS(86399), '23:59:59');
  assert.equal(formatHMS(86400), '24:00:00');
  assert.equal(formatHMS(359999), '99:59:59');
  assert.equal(formatHMS(360000), '100:00:00'); // 小时可超过 99
  assert.equal(formatHMS(3725.9), '01:02:05'); // 小数秒向下取整
  assert.equal(formatHMS(-5), '00:00:00'); // 负数按 0
  assert.equal(formatHMS(Number.NaN), '00:00:00');
  assert.equal(formatHMS(undefined), '00:00:00');
});

test('formatMoney 边界：两位小数、千分位、负数、四舍五入进位', () => {
  assert.equal(formatMoney(413.7866), '413.79');
  assert.equal(formatMoney(12345.6), '12,345.60');
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(0.5), '0.50');
  assert.equal(formatMoney(1234567.891), '1,234,567.89');
  assert.equal(formatMoney(1000000), '1,000,000.00');
  assert.equal(formatMoney(-1234.5), '-1,234.50');
  assert.equal(formatMoney(-0.004), '0.00'); // 不出现 -0.00
  assert.equal(formatMoney(1.005), '1.01'); // 十进制四舍五入
  assert.equal(formatMoney(2.675), '2.68');
  assert.equal(formatMoney(999.995), '1,000.00'); // 进位
  assert.equal(formatMoney(0.1 + 0.2), '0.30');
  assert.equal(formatMoney('413.7866'), '413.79');
  assert.equal(formatMoney(Number.NaN), '0.00');
  assert.equal(formatMoney(null), '0.00');

  assert.match(formatMoney(413.7866), /^[0-9,]+\.\d{2}$/); // 全 ASCII，无货币符号
  assert.doesNotMatch(formatMoney(413.7866), /[¥￥$]/);
});

test('formatPercent 边界：取整、夹紧 0–100、非法输入', () => {
  assert.equal(formatPercent(0), '0');
  assert.equal(formatPercent(0.58), '58');
  assert.equal(formatPercent(0.5), '50');
  assert.equal(formatPercent(0.75), '75');
  assert.equal(formatPercent(1), '100');
  assert.equal(formatPercent(0.999), '100');
  assert.equal(formatPercent(0.585), '59'); // 四舍五入
  assert.equal(formatPercent(0.004), '0');
  assert.equal(formatPercent(-0.2), '0'); // 负数按 0
  assert.equal(formatPercent(1.2), '100'); // 超过 1 按 100
  assert.equal(formatPercent(Number.NaN), '0');
  assert.equal(formatPercent(undefined), '0');
});

// ---------------------------------------------------------------- 午休不计薪（P2）

const LUNCH_DAY = { enabled: true, start: '12:00', end: '13:00' };
const LUNCH_NIGHT = { enabled: true, start: '02:00', end: '03:00' };

test('午休（09:00-18:00 + 12:00-13:00）12:00 进入 lunch，有效班次扣掉 1 小时', () => {
  const shift = shiftFor(local(2026, 11, 6, 12, 0, 0), '09:00', '18:00', LUNCH_DAY);

  assert.equal(shift.kind, 'lunch');
  assert.equal(shift.startMs, local(2026, 11, 6, 9, 0, 0));
  assert.equal(shift.endMs, local(2026, 11, 6, 18, 0, 0));
  assert.equal(shift.totalSec, 32400); // 墙上时间 9 小时不变
  assert.equal(shift.effectiveTotalSec, 28800); // 有效班次 8 小时
  assert.equal(shift.workedSec, 10800); // 墙上已过 3 小时
  assert.equal(shift.effectiveWorkedSec, 10800); // 有效已工作 3 小时
  assert.equal(shift.remainSec, 21600); // 距下班真实倒计时 6 小时
  assert.equal(shift.progress, 0.375); // 3h / 8h
  assert.equal(shift.lunchActive, true);
  assert.equal(shift.lunchStartMs, local(2026, 11, 6, 12, 0, 0));
  assert.equal(shift.lunchEndMs, local(2026, 11, 6, 13, 0, 0));
});

test('午休期间（12:30）kind=lunch，progress 与 12:00 保持一致', () => {
  const at1200 = shiftFor(local(2026, 11, 6, 12, 0, 0), '09:00', '18:00', LUNCH_DAY);
  const at1230 = shiftFor(local(2026, 11, 6, 12, 30, 0), '09:00', '18:00', LUNCH_DAY);

  assert.equal(at1230.kind, 'lunch');
  assert.equal(at1230.effectiveWorkedSec, at1200.effectiveWorkedSec);
  assert.equal(at1230.progress, at1200.progress);
  assert.equal(at1230.workedSec, 12600); // 墙上 3.5 小时
  assert.equal(at1230.remainSec, 19800); // 距下班 5.5 小时（不扣午休）
});

test('午休（09:00-18:00 + 12:00-13:00）13:00 已下班午休，progress=3/8', () => {
  // 任务书示例写的是“13:00 → 7/8”；按公式 13:00 的有效已工作 = 4h - 1h = 3h → 3/8。
  // 7/8 出现在 17:00（见下一个用例）。这里把 13:00 的真实口径钉住。
  const shift = shiftFor(local(2026, 11, 6, 13, 0, 0), '09:00', '18:00', LUNCH_DAY);

  assert.equal(shift.kind, 'working'); // 午休区间左闭右开，13:00 已恢复 working
  assert.equal(shift.effectiveWorkedSec, 10800);
  assert.equal(shift.progress, 0.375);
  assert.equal(shift.remainSec, 18000); // 距下班 5 小时
});

test('午休（09:00-18:00 + 12:00-13:00）17:00 progress=7/8，earned=日薪×0.875', () => {
  const shift = shiftFor(local(2026, 11, 6, 17, 0, 0), '09:00', '18:00', LUNCH_DAY);
  assert.equal(shift.kind, 'working');
  assert.equal(shift.effectiveWorkedSec, 25200); // 8h - 1h = 7h
  closeTo(shift.progress, 7 / 8);
  assert.equal(formatPercent(shift.progress), '88'); // 87.5 四舍五入

  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000, lunchEnabled: true };
  const pay = payFor(settings, shift);
  const dailyPay = 12000 / 21.75;

  closeTo(pay.earned, dailyPay * 0.875);
  closeTo(pay.remaining, dailyPay * 0.125);
  closeTo(pay.perMinute, dailyPay / 480); // 每分钟收入按有效 8 小时算
  assert.equal(formatMoney(pay.earned), '482.76');
  assert.equal(formatMoney(pay.remaining), '68.97');
  assert.equal(formatMoney(pay.perMinute), '1.15');
});

test('午休（09:00-18:00 + 12:00-13:00）18:00 下班后 progress=1、有效已工作=有效班次', () => {
  const shift = shiftFor(local(2026, 11, 6, 18, 0, 0), '09:00', '18:00', LUNCH_DAY);

  assert.equal(shift.kind, 'after');
  assert.equal(shift.progress, 1);
  assert.equal(shift.workedSec, 32400);
  assert.equal(shift.effectiveWorkedSec, 28800);
  assert.equal(shift.effectiveTotalSec, 28800);
  assert.equal(shift.remainSec, 0);
});

test('午休（09:00-18:00 + 12:00-13:00）上班前：有效已工作 0，午休时间字段照常给出', () => {
  const shift = shiftFor(local(2026, 11, 6, 8, 0, 0), '09:00', '18:00', LUNCH_DAY);

  assert.equal(shift.kind, 'before');
  assert.equal(shift.progress, 0);
  assert.equal(shift.workedSec, 0);
  assert.equal(shift.effectiveWorkedSec, 0);
  assert.equal(shift.effectiveTotalSec, 28800);
  assert.equal(shift.remainSec, 3600);
  assert.equal(shift.lunchStartMs, local(2026, 11, 6, 12, 0, 0));
  assert.equal(shift.lunchEndMs, local(2026, 11, 6, 13, 0, 0));
  assert.equal(shift.lunchActive, true);
});

test('午休未启用时，结果与不传参数完全一致（向后兼容）', () => {
  const now = local(2026, 11, 6, 15, 45, 0);
  const plain = shiftFor(now, '09:00', '18:00');

  assert.deepEqual(shiftFor(now, '09:00', '18:00', undefined), plain);
  assert.deepEqual(shiftFor(now, '09:00', '18:00', null), plain);
  assert.deepEqual(shiftFor(now, '09:00', '18:00', {}), plain);
  assert.deepEqual(shiftFor(now, '09:00', '18:00', { enabled: false, start: '12:00', end: '13:00' }), plain);

  const disabled = shiftFor(now, '09:00', '18:00', { enabled: false, start: '12:00', end: '13:00' });
  assert.equal(disabled.effectiveTotalSec, disabled.totalSec);
  assert.equal(disabled.effectiveWorkedSec, disabled.workedSec);
  assert.equal(disabled.lunchStartMs, null);
  assert.equal(disabled.lunchEndMs, null);
  assert.equal(disabled.lunchActive, false);
});

test('shiftFor 兼容把 settings 直接当第 4 个参数（lunchEnabled / lunchStart / lunchEnd）', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000, lunchEnabled: true };
  const shift = shiftFor(local(2026, 11, 6, 12, 30, 0), '09:00', '18:00', settings);

  assert.equal(shift.kind, 'lunch');
  assert.equal(shift.effectiveTotalSec, 28800);
  assert.equal(shift.lunchStartMs, local(2026, 11, 6, 12, 0, 0));
});

test('跨夜班次 + 午休（22:00-06:00 + 02:00-03:00）：02:30 kind=lunch', () => {
  const at0230 = shiftFor(local(2026, 11, 6, 2, 30, 0), '22:00', '06:00', LUNCH_NIGHT);

  assert.equal(at0230.kind, 'lunch');
  assert.equal(at0230.startMs, local(2026, 11, 5, 22, 0, 0));
  assert.equal(at0230.endMs, local(2026, 11, 6, 6, 0, 0));
  assert.equal(at0230.totalSec, 28800); // 墙上 8 小时
  assert.equal(at0230.effectiveTotalSec, 25200); // 有效 7 小时
  assert.equal(at0230.workedSec, 16200); // 墙上 4.5 小时
  assert.equal(at0230.effectiveWorkedSec, 14400); // 有效 4 小时
  assert.equal(at0230.remainSec, 12600); // 距下班 3.5 小时
  closeTo(at0230.progress, 4 / 7);
  assert.equal(at0230.lunchStartMs, local(2026, 11, 6, 2, 0, 0));
  assert.equal(at0230.lunchEndMs, local(2026, 11, 6, 3, 0, 0));
  assert.equal(at0230.lunchActive, true);
});

test('跨夜班次 + 午休：03:30 progress 按有效 7 小时计算', () => {
  const at0330 = shiftFor(local(2026, 11, 6, 3, 30, 0), '22:00', '06:00', LUNCH_NIGHT);

  assert.equal(at0330.kind, 'working');
  assert.equal(at0330.effectiveWorkedSec, 16200); // 5.5h - 1h = 4.5h
  closeTo(at0330.progress, 4.5 / 7);
  assert.equal(at0330.remainSec, 9000); // 距 06:00 还有 2.5 小时

  const settings = { ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: 60 };
  const pay = payFor(settings, at0330);
  assert.equal(pay.dailyPay, 420); // 有效 7 小时 × 60
  assert.equal(pay.perMinute, 1);
  closeTo(pay.earned, 270); // 4.5h × 60
});

test('跨夜班次 + 午休：午休结束后（12:00）显示 after，有效已工作=有效班次', () => {
  const shift = shiftFor(local(2026, 11, 6, 12, 0, 0), '22:00', '06:00', LUNCH_NIGHT);

  assert.equal(shift.kind, 'after');
  assert.equal(shift.progress, 1);
  assert.equal(shift.workedSec, 28800);
  assert.equal(shift.effectiveTotalSec, 25200);
  assert.equal(shift.effectiveWorkedSec, 25200);
  assert.equal(shift.lunchStartMs, local(2026, 11, 6, 2, 0, 0));
  assert.equal(shift.lunchEndMs, local(2026, 11, 6, 3, 0, 0));
});

test('午休在班次外 / 跨出班次 / 格式非法 / 起止相同都被忽略（=未启用）', () => {
  const now = local(2026, 11, 6, 15, 45, 0);
  const plain = shiftFor(now, '09:00', '18:00');

  const ignored = [
    { enabled: true, start: '20:00', end: '21:00' }, // 完全在班次后
    { enabled: true, start: '07:00', end: '08:30' }, // 完全在班次前
    { enabled: true, start: '17:00', end: '19:00' }, // 跨出下班时间
    { enabled: true, start: '08:00', end: '09:30' }, // 跨过上班时间
    { enabled: true, start: '12:00', end: '12:00' }, // 起止相同
    { enabled: true, start: '12:XX', end: '13:00' }, // 格式非法
    { enabled: true, start: '12:00', end: '13:00:00' }, // 格式非法
    { enabled: true }, // 没填时间
  ];
  for (const lunch of ignored) {
    const shift = shiftFor(now, '09:00', '18:00', lunch);
    assert.deepEqual(shift, plain, `应忽略午休: ${JSON.stringify(lunch)}`);
    assert.equal(shift.lunchActive, false);
  }
});

test('时薪 + 午休：日薪按有效 8 小时计算', () => {
  const settings = { ...DEFAULT_SETTINGS, salaryType: 'hourly', hourlyRate: 60, lunchEnabled: true };
  const shift = shiftFor(local(2026, 11, 6, 17, 0, 0), '09:00', '18:00', LUNCH_DAY);
  const pay = payFor(settings, shift);

  assert.equal(pay.dailyPay, 480); // 8h × 60，而不是 9h × 60
  assert.equal(pay.perMinute, 1);
  assert.equal(pay.earned, 420);
  assert.equal(pay.remaining, 60);
});

test('午休关闭时 payFor 结果与未传午休时完全一致', () => {
  const settings = { ...DEFAULT_SETTINGS, monthlySalary: 12000 };
  const now = local(2026, 11, 6, 15, 45, 0);
  const plainShift = shiftFor(now, '09:00', '18:00');
  const disabledShift = shiftFor(now, '09:00', '18:00', { enabled: false, start: '12:00', end: '13:00' });

  assert.deepEqual(payFor(settings, disabledShift), payFor(settings, plainShift));
});

test('validateSettings 午休合法配置通过（白班 + 跨夜）', () => {
  const base = { ...DEFAULT_SETTINGS, monthlySalary: 12000, lunchEnabled: true };

  assert.deepEqual(validateSettings(base), { ok: true, errors: {} });
  assert.deepEqual(validateSettings({ ...base, lunchStart: '09:00', lunchEnd: '10:00' }), {
    ok: true,
    errors: {},
  }); // 午休从上班时刻开始也合法
  assert.equal(
    validateSettings({ ...base, workStart: '22:00', workEnd: '06:00', lunchStart: '02:00', lunchEnd: '03:00' }).ok,
    true,
  );
});

test('validateSettings 午休起止相同 / 越界 / 格式非法 / 空', () => {
  const base = { ...DEFAULT_SETTINGS, monthlySalary: 12000, lunchEnabled: true };

  const same = validateSettings({ ...base, lunchStart: '12:00', lunchEnd: '12:00' });
  assert.equal(same.ok, false);
  assert.match(same.errors.lunchEnd ?? '', /不能相同/);

  const afterShift = validateSettings({ ...base, lunchStart: '20:00', lunchEnd: '21:00' });
  assert.equal(afterShift.ok, false);
  assert.match(afterShift.errors.lunchEnd ?? '', /完整落在/);

  const beforeShift = validateSettings({ ...base, lunchStart: '08:00', lunchEnd: '09:30' });
  assert.equal(beforeShift.ok, false);
  assert.match(beforeShift.errors.lunchStart ?? '', /完整落在/);

  const badStart = validateSettings({ ...base, lunchStart: '12:0', lunchEnd: '13:00' });
  assert.equal(badStart.ok, false);
  assert.match(badStart.errors.lunchStart ?? '', /格式/);

  const badEnd = validateSettings({ ...base, lunchStart: '12:00', lunchEnd: '13:00:00' });
  assert.equal(badEnd.ok, false);
  assert.match(badEnd.errors.lunchEnd ?? '', /格式/);

  const empty = validateSettings({ ...base, lunchStart: '', lunchEnd: '' });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.lunchStart ?? '', /请填写午休开始时间/);
  assert.match(empty.errors.lunchEnd ?? '', /请填写午休结束时间/);

  const nightOut = validateSettings({
    ...base,
    workStart: '22:00',
    workEnd: '06:00',
    lunchStart: '20:00',
    lunchEnd: '21:00',
  });
  assert.equal(nightOut.ok, false);
  assert.match(nightOut.errors.lunchEnd ?? '', /完整落在/);
});

test('validateSettings 午休关闭时不校验午休字段', () => {
  const base = { ...DEFAULT_SETTINGS, monthlySalary: 12000, lunchEnabled: false };

  assert.equal(validateSettings({ ...base, lunchStart: 'xx', lunchEnd: 'yy' }).ok, true);
  assert.equal(validateSettings({ ...base, lunchStart: '12:00', lunchEnd: '12:00' }).ok, true);
  assert.equal(validateSettings({ ...base, lunchStart: '', lunchEnd: '' }).ok, true);
});

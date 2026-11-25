import type { Clock } from './types.js';

export type { Clock } from './types.js';

/** 时区字面量：日界定义只允许 Asia/Shanghai（design.md ADR-007）。 */
const TIME_ZONE = 'Asia/Shanghai' as const;

/** 系统时钟：唯一允许调用 new Date() 的业务模块（ESLint 强制）。 */
export const systemClock: Clock = {
  timeZone: TIME_ZONE,
  now: () => new Date(),
};

/** 测试用固定时钟：`now()` 始终返回构造时的时刻。 */
export class FixedClock implements Clock {
  readonly timeZone: 'Asia/Shanghai' = TIME_ZONE;
  private readonly at: Date;

  constructor(at: Date) {
    this.at = new Date(at.getTime());
  }

  now(): Date {
    return new Date(this.at.getTime());
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  // hourCycle: 'h23' 避免 0 点被格式化为 "24"（en-US 默认 h24）。
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** 把某一时刻投影到目标时区的「墙上时间」，不依赖进程 TZ。 */
function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** 目标时区在某一时刻相对 UTC 的偏移（毫秒）。 */
function offsetMilliseconds(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 把目标时区的某个墙上日期 00:00 转成绝对时刻。 */
function startOfDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const tentative = new Date(wallClockAsUtc);
  const firstOffset = offsetMilliseconds(tentative, timeZone);
  const instant = new Date(wallClockAsUtc - firstOffset);
  // 固定偏移时区一次即准；带夏令时的时区需按实际偏移再校正一次。
  const secondOffset = offsetMilliseconds(instant, timeZone);
  return secondOffset === firstOffset ? instant : new Date(wallClockAsUtc - secondOffset);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 判定某一时刻属于 Asia/Shanghai 的哪一天，返回 'YYYY-MM-DD'（design.md §4.3）。
 * 禁止用 `toISOString().slice(0, 10)` 之类的 UTC 截断（R-04）。
 */
export function dayKey(clock: Clock, at: Date): string {
  const { year, month, day } = zonedParts(at, clock.timeZone);
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 给定日期的统计窗口 [since, until)，左闭右开（design.md §4.3）。
 * 入参约束：`date` 为 'YYYY-MM-DD'，由 CLI 层校验后传入。
 */
export function dayWindow(clock: Clock, date: string): { since: Date; until: Date } {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return {
    since: startOfDayUtc(year, month, day, clock.timeZone),
    until: startOfDayUtc(year, month, day + 1, clock.timeZone),
  };
}

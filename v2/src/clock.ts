import type { Clock } from './types.js';

export type { Clock } from './types.js';

const TIME_ZONE = 'Asia/Shanghai' as const;

export const systemClock: Clock = {
  timeZone: TIME_ZONE,
  now: () => new Date(),
};

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

function offsetMilliseconds(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function startOfDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const tentative = new Date(wallClockAsUtc);
  const firstOffset = offsetMilliseconds(tentative, timeZone);
  const instant = new Date(wallClockAsUtc - firstOffset);
  const secondOffset = offsetMilliseconds(instant, timeZone);
  return secondOffset === firstOffset ? instant : new Date(wallClockAsUtc - secondOffset);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dayKey(clock: Clock, at: Date): string {
  const { year, month, day } = zonedParts(at, clock.timeZone);
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function dayWindow(clock: Clock, date: string): { since: Date; until: Date } {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return {
    since: startOfDayUtc(year, month, day, clock.timeZone),
    until: startOfDayUtc(year, month, day + 1, clock.timeZone),
  };
}

export function toZonedIsoString(clock: Clock, at: Date): string {
  const p = zonedParts(at, clock.timeZone);
  const offsetMinutes = offsetMilliseconds(at, clock.timeZone) / 60000;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
  const millis = String(at.getUTCMilliseconds()).padStart(3, '0');
  return (
    `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}` +
    `T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}.${millis}${offset}`
  );
}

export function parseInstant(value: string | number): Date {
  return new Date(value);
}

export function minutesOfDay(clock: Clock, at: Date): number {
  const p = zonedParts(at, clock.timeZone);
  return p.hour * 60 + p.minute;
}

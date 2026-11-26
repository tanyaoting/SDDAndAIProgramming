import { afterEach, describe, expect, it } from 'vitest';
import { FixedClock, dayKey, dayWindow, minutesOfDay, toZonedIsoString } from '../src/clock.js';

describe('dayKey', () => {
  const previousTz = process.env.TZ;

  afterEach(() => {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  });

  it('UTC 16:30 计入 Asia/Shanghai 次日', () => {
    const clock = new FixedClock(new Date('2026-11-25T16:30:00.000Z'));
    expect(dayKey(clock, clock.now())).toBe('2026-11-26');
  });

  it('UTC 15:59:59 仍属当日', () => {
    const clock = new FixedClock(new Date('2026-11-25T15:59:59.000Z'));
    expect(dayKey(clock, clock.now())).toBe('2026-11-25');
  });

  it('结果与进程 TZ 无关', () => {
    const at = new Date('2026-11-25T16:30:00.000Z');
    const clock = new FixedClock(at);
    process.env.TZ = 'UTC';
    const utc = dayKey(clock, at);
    process.env.TZ = 'Asia/Shanghai';
    const shanghai = dayKey(clock, at);
    expect(utc).toBe('2026-11-26');
    expect(shanghai).toBe(utc);
  });
});

describe('dayWindow', () => {
  it('返回左闭右开的本地日窗口', () => {
    const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
    const { since, until } = dayWindow(clock, '2026-11-25');
    expect(dayKey(clock, since)).toBe('2026-11-25');
    expect(dayKey(clock, new Date(until.getTime() - 1))).toBe('2026-11-25');
    expect(dayKey(clock, until)).toBe('2026-11-26');
  });
});

describe('toZonedIsoString / minutesOfDay', () => {
  it('输出带 +08:00 偏移', () => {
    const clock = new FixedClock(new Date('2026-11-25T01:02:03.000Z'));
    const iso = toZonedIsoString(clock, clock.now());
    expect(iso).toMatch(/\+08:00$/);
    expect(iso.startsWith('2026-11-25T09:02:03')).toBe(true);
  });

  it('minutesOfDay 按本地墙钟计算', () => {
    const clock = new FixedClock(new Date('2026-11-25T01:30:00.000Z'));
    expect(minutesOfDay(clock, clock.now())).toBe(9 * 60 + 30);
  });
});

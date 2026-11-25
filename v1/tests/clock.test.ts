import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixedClock, dayKey, dayWindow, systemClock } from '../src/clock.js';

const anchor = new Date('2026-11-25T00:00:00Z');
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe('T-025 时钟与时区日界', () => {
  it('系统时钟声明的时区为 Asia/Shanghai', () => {
    expect(systemClock.timeZone).toBe('Asia/Shanghai');
    expect(new FixedClock(anchor).timeZone).toBe('Asia/Shanghai');
  });

  it('dayKey 按 Asia/Shanghai 判定当日：UTC 16:00 之后进入次日（R-04）', () => {
    const clock = new FixedClock(anchor);
    expect(dayKey(clock, new Date('2026-11-25T16:30:00Z'))).toBe('2026-11-26');
    expect(dayKey(clock, new Date('2026-11-25T15:59:59Z'))).toBe('2026-11-25');
    expect(dayKey(clock, new Date('2026-11-25T16:00:00Z'))).toBe('2026-11-26');
  });

  it('dayWindow 返回左闭右开边界（+08:00 对应 UTC 前一日 16:00）', () => {
    const { since, until } = dayWindow(new FixedClock(anchor), '2026-11-25');
    expect(since.toISOString()).toBe('2026-11-24T16:00:00.000Z');
    expect(until.toISOString()).toBe('2026-11-25T16:00:00.000Z');
    expect(until.getTime() - since.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('窗口边界与 dayKey 自洽：since 属于当日，until 属于次日', () => {
    const clock = new FixedClock(anchor);
    const { since, until } = dayWindow(clock, '2026-11-25');
    expect(dayKey(clock, since)).toBe('2026-11-25');
    expect(dayKey(clock, until)).toBe('2026-11-26');
  });

  it('跨月跨年时 until 正确进位', () => {
    const clock = new FixedClock(anchor);
    // 2027-01-01 00:00 +08:00 == 2026-12-31T16:00:00Z
    expect(dayWindow(clock, '2026-12-31').since.toISOString()).toBe('2026-12-30T16:00:00.000Z');
    expect(dayWindow(clock, '2026-12-31').until.toISOString()).toBe('2026-12-31T16:00:00.000Z');
    expect(dayWindow(clock, '2026-02-28').until.toISOString()).toBe('2026-02-28T16:00:00.000Z');
  });

  it('结果与进程 TZ 无关（TZ=UTC 与 TZ=Asia/Shanghai 一致）', async () => {
    const instant = new Date('2026-11-25T16:30:00Z');

    process.env.TZ = 'UTC';
    vi.resetModules();
    const asUtc = await import('../src/clock.js');
    const utcDay = asUtc.dayKey(asUtc.systemClock, instant);
    const utcWindow = asUtc.dayWindow(asUtc.systemClock, '2026-11-25');

    process.env.TZ = 'Asia/Shanghai';
    vi.resetModules();
    const asShanghai = await import('../src/clock.js');
    const shanghaiDay = asShanghai.dayKey(asShanghai.systemClock, instant);
    const shanghaiWindow = asShanghai.dayWindow(asShanghai.systemClock, '2026-11-25');

    expect(utcDay).toBe('2026-11-26');
    expect(shanghaiDay).toBe(utcDay);
    expect(shanghaiWindow.since.toISOString()).toBe(utcWindow.since.toISOString());
    expect(shanghaiWindow.until.toISOString()).toBe(utcWindow.until.toISOString());
  });

  it('FixedClock 每次 now() 返回独立副本', () => {
    const clock = new FixedClock(anchor);
    const first = clock.now();
    first.setTime(0);
    expect(clock.now().toISOString()).toBe('2026-11-25T00:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { ERROR_CODES } from '../../src/errors.js';
import { assignBlocks } from '../../src/generator/timeline.js';
import type { WorkBlock } from '../../src/generator/timeline.js';
import type { Event } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

const BLOCKS: readonly WorkBlock[] = [
  { name: 'morning', start: '09:00', end: '12:00' },
  { name: 'afternoon', start: '13:30', end: '18:00' },
  { name: 'evening', start: '19:00', end: '22:00' },
];

function event(id: string, at: string): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: id,
    kind: 'commit',
    occurredAt: new Date(at),
    title: `feat: ${id}`,
    dedupeKey: `dk-${id}`,
    isPrimary: true,
    runId: 'run-1',
  };
}

function blockOf(at: string): string | undefined {
  const result = assignBlocks([event('x', at)], BLOCKS, clock);
  for (const [name, events] of result) {
    if (events.length > 0) return name;
  }
  return undefined;
}

describe('T-012 时段划分', () => {
  it('落在休息区间的事件归入前一工作时段（IR-05）', () => {
    expect(blockOf('2026-11-25T12:30:00+08:00')).toBe('morning');
    expect(blockOf('2026-11-25T13:00:00+08:00')).toBe('morning');
    expect(blockOf('2026-11-25T18:30:00+08:00')).toBe('afternoon');
  });

  it('边界与跨时段：左闭右开，只按开始时间归位一次', () => {
    expect(blockOf('2026-11-25T09:00:00+08:00')).toBe('morning');
    expect(blockOf('2026-11-25T12:00:00+08:00')).toBe('morning');
    expect(blockOf('2026-11-25T13:30:00+08:00')).toBe('afternoon');

    const result = assignBlocks([event('a', '2026-11-25T11:59:00+08:00')], BLOCKS, clock);
    expect([...result.values()].reduce((sum, list) => sum + list.length, 0)).toBe(1);
  });

  it('早于首时段归首段，晚于末时段归末段', () => {
    expect(blockOf('2026-11-25T07:30:00+08:00')).toBe('morning');
    expect(blockOf('2026-11-25T23:10:00+08:00')).toBe('evening');
  });

  it('时刻按 clock.timeZone 解释，与进程时区无关', () => {
    // UTC 04:30 = Asia/Shanghai 12:30 → 归入上午（休息区间回退）
    expect(blockOf('2026-11-25T04:30:00Z')).toBe('morning');
  });

  it('时段重叠或乱序抛 SDR-E301', () => {
    const overlapping: WorkBlock[] = [
      { name: 'a', start: '09:00', end: '12:00' },
      { name: 'b', start: '11:00', end: '13:00' },
    ];
    expect(() => assignBlocks([], overlapping, clock)).toThrowError(/b/);
    try {
      assignBlocks([], overlapping, clock);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ERROR_CODES.WORK_BLOCKS_INVALID);
    }

    const unsorted: WorkBlock[] = [
      { name: 'late', start: '14:00', end: '18:00' },
      { name: 'early', start: '09:00', end: '12:00' },
    ];
    expect(() => assignBlocks([], unsorted, clock)).toThrowError(/early/);
  });

  it('每个时段的条目按发生时间升序', () => {
    const result = assignBlocks(
      [
        event('late', '2026-11-25T10:30:00+08:00'),
        event('early', '2026-11-25T09:10:00+08:00'),
      ],
      BLOCKS,
      clock,
    );
    expect(result.get('morning')?.map((item) => item.sourceId)).toEqual(['early', 'late']);
  });
});

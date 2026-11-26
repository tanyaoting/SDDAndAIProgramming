import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import type { WorkBlock } from '../../src/config.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { assignBlocks } from '../../src/generator/timeline.js';
import type { Event } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

const BLOCKS: readonly WorkBlock[] = [
  { name: 'morning', start: '09:00', end: '12:00' },
  { name: 'afternoon', start: '13:30', end: '18:00' },
  { name: 'evening', start: '19:00', end: '22:00' },
];

function ev(id: string, at: string): Event {
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

function blockFor(at: string): string | undefined {
  const map = assignBlocks([ev('x', at)], BLOCKS, clock);
  for (const [name, list] of map) {
    if (list.length > 0) return name;
  }
  return undefined;
}

describe('T-012 时段划分', () => {
  it('落在休息区间的事件归入前一工作时段（IR-05）', () => {
    expect(blockFor('2026-11-25T12:30:00+08:00')).toBe('morning');
    expect(blockFor('2026-11-25T13:00:00+08:00')).toBe('morning');
    expect(blockFor('2026-11-25T18:30:00+08:00')).toBe('afternoon');
  });

  it('左闭右开，仅按开始时间归位一次', () => {
    expect(blockFor('2026-11-25T09:00:00+08:00')).toBe('morning');
    expect(blockFor('2026-11-25T12:00:00+08:00')).toBe('morning');
    expect(blockFor('2026-11-25T13:30:00+08:00')).toBe('afternoon');
    const map = assignBlocks([ev('a', '2026-11-25T11:59:00+08:00')], BLOCKS, clock);
    const total = [...map.values()].reduce((n, xs) => n + xs.length, 0);
    expect(total).toBe(1);
  });

  it('早于首段归首段，晚于末段归末段', () => {
    expect(blockFor('2026-11-25T07:30:00+08:00')).toBe('morning');
    expect(blockFor('2026-11-25T23:10:00+08:00')).toBe('evening');
  });

  it('时刻按 clock.timeZone 解释', () => {
    expect(blockFor('2026-11-25T04:30:00Z')).toBe('morning');
  });

  it('时段重叠或乱序抛 SDR-E301', () => {
    const overlap: WorkBlock[] = [
      { name: 'a', start: '09:00', end: '12:00' },
      { name: 'b', start: '11:00', end: '13:00' },
    ];
    expect(() => assignBlocks([], overlap, clock)).toThrow(SdrError);
    try {
      assignBlocks([], overlap, clock);
    } catch (error) {
      expect((error as SdrError).code).toBe(ERROR_CODES.WORK_BLOCKS_INVALID);
    }
  });

  it('同段事件按发生时间升序', () => {
    const map = assignBlocks(
      [ev('late', '2026-11-25T10:30:00+08:00'), ev('early', '2026-11-25T09:10:00+08:00')],
      BLOCKS,
      clock,
    );
    expect(map.get('morning')?.map((e) => e.sourceId)).toEqual(['early', 'late']);
  });
});
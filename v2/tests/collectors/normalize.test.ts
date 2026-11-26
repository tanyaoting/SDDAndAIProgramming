import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import type { Event } from '../../src/types.js';
import { buildDedupeKey, dedupe } from '../../src/collectors/normalize.js';

describe('buildDedupeKey', () => {
  const clock = new FixedClock(new Date('2026-11-25T16:30:00.000Z'));

  it('日期部分取自 dayKey', () => {
    const at = new Date('2026-11-25T16:30:00.000Z');
    const sameDay = new Date('2026-11-25T18:00:00.000Z');
    const otherDay = new Date('2026-11-24T12:00:00.000Z');
    const keyA = buildDedupeKey('sha-1', at, 1, clock);
    const keyB = buildDedupeKey('sha-1', at, 1, clock);
    const keySameDay = buildDedupeKey('sha-1', sameDay, 1, clock);
    const keyOtherDay = buildDedupeKey('sha-1', otherDay, 1, clock);
    expect(keyA).toBe(keyB);
    expect(keySameDay).toBe(keyA);
    expect(keyOtherDay).not.toBe(keyA);
  });

  it('CS-19：跨越 UTC 零点但 dayKey 相同则 key 一致', () => {
    const clockBoundary = new FixedClock(new Date('2026-11-25T16:30:00.000Z'));
    const atA = new Date('2026-11-25T16:30:00.000Z');
    const atB = new Date('2026-11-25T18:00:00.000Z');
    const k1 = buildDedupeKey('same-sha', atA, 9, clockBoundary);
    const k2 = buildDedupeKey('same-sha', atB, 9, clockBoundary);
    expect(k1).toBe(k2);
  });
});

describe('dedupe', () => {
  const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

  const base = (overrides: Partial<Event> & Pick<Event, 'occurredAt' | 'sourceId'>): Event => ({
    memberId: 1,
    source: 'github',
    kind: 'commit',
    title: 't',
    dedupeKey: buildDedupeKey(overrides.sourceId, overrides.occurredAt, 1, clock),
    isPrimary: false,
    runId: 'r',
    ...overrides,
  });

  it('同 dedupeKey 保留 isPrimary', () => {
    const t1 = new Date('2026-11-25T02:00:00.000Z');
    const t2 = new Date('2026-11-25T03:00:00.000Z');
    const key = buildDedupeKey('dup', t1, 1, clock);
    const events = dedupe([
      base({ sourceId: 'dup', occurredAt: t1, dedupeKey: key, isPrimary: false, source: 'local' }),
      base({ sourceId: 'dup', occurredAt: t2, dedupeKey: key, isPrimary: true, source: 'github' }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.isPrimary).toBe(true);
    expect(events[0]?.source).toBe('github');
  });

  it('按 occurredAt 升序', () => {
    const early = new Date('2026-11-25T01:00:00.000Z');
    const late = new Date('2026-11-25T06:00:00.000Z');
    const sorted = dedupe([
      base({ occurredAt: late, sourceId: 'b' }),
      base({ occurredAt: early, sourceId: 'a' }),
    ]);
    expect(sorted.map((e) => e.sourceId)).toEqual(['a', 'b']);
  });
});
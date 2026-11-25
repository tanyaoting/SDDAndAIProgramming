import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { dedupe, makeDedupeKey } from '../../src/collectors/normalize.js';
import type { Event } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

function event(overrides: Partial<Event> = {}): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T09:00:00+08:00'),
    title: 'feat: 示例',
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
    ...overrides,
  };
}

describe('T-010 事件归一与去重', () => {
  it('dedupeKey 同输入同输出，日期部分取自 Asia/Shanghai 日界', () => {
    const input = {
      sourceId: 'sha-1',
      memberId: 1,
      occurredAt: new Date('2026-11-25T16:30:00Z'),
      clock,
    };
    expect(makeDedupeKey(input)).toBe(makeDedupeKey(input));
    expect(makeDedupeKey(input)).toHaveLength(40);
  });

  it('跨 UTC 日界的同一提交去重键一致（CS-19）', () => {
    // 两个时刻都属于 Asia/Shanghai 的 2026-11-26，但 UTC 日期不同（25 / 26）。
    const before = makeDedupeKey({
      sourceId: 'sha-1',
      memberId: 1,
      occurredAt: new Date('2026-11-25T16:30:00Z'),
      clock,
    });
    const after = makeDedupeKey({
      sourceId: 'sha-1',
      memberId: 1,
      occurredAt: new Date('2026-11-26T01:00:00Z'),
      clock,
    });
    expect(after).toBe(before);
  });

  it('同一事件采集两次仅保留一条（CS-01）', () => {
    const first = event({ sourceId: 'sha-1', dedupeKey: 'dk-1' });
    const duplicate = event({ sourceId: 'sha-1', dedupeKey: 'dk-1', title: '重复采集' });

    expect(dedupe([first, duplicate])).toEqual([first]);
  });

  it('多源同一事件保留主源', () => {
    const auxiliary = event({ source: 'feishu', isPrimary: false, title: '任务记录' });
    const primary = event({ source: 'github', isPrimary: true, title: '提交记录' });

    const result = dedupe([auxiliary, primary]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('github');
    expect(result[0]?.isPrimary).toBe(true);
  });

  it('同为辅助源时保留最早发生者', () => {
    const early = event({
      source: 'feishu',
      isPrimary: false,
      occurredAt: new Date('2026-11-25T09:00:00+08:00'),
    });
    const late = event({
      source: 'feishu',
      isPrimary: false,
      occurredAt: new Date('2026-11-25T10:00:00+08:00'),
    });
    expect(dedupe([late, early])).toEqual([early]);
  });

  it('结果按 occurredAt 升序', () => {
    const late = event({ dedupeKey: 'dk-late', occurredAt: new Date('2026-11-25T18:00:00+08:00') });
    const early = event({ dedupeKey: 'dk-early', occurredAt: new Date('2026-11-25T09:00:00+08:00') });
    const middle = event({ dedupeKey: 'dk-middle', occurredAt: new Date('2026-11-25T13:00:00+08:00') });

    expect(dedupe([late, middle, early]).map((item) => item.dedupeKey)).toEqual([
      'dk-early',
      'dk-middle',
      'dk-late',
    ]);
  });
});

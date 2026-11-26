import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { createManualEvent } from '../../src/collectors/manual.js';

describe('createManualEvent', () => {
  const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

  it('生成 manual/note 事件', () => {
    const event = createManualEvent({
      text: '今日协助排查 CI',
      ref: '飞书群聊纪要',
      memberId: 4,
      runId: 'run-manual',
      clock,
    });

    expect(event).toMatchObject({
      source: 'manual',
      kind: 'note',
      title: '今日协助排查 CI',
      memberId: 4,
      isPrimary: true,
    });
    expect(event.detail).toBe('飞书群聊纪要');
    expect(event.dedupeKey.length).toBeGreaterThan(0);
  });

  it('拒绝空白 text', () => {
    expect(() =>
      createManualEvent({
        text: '   ',
        ref: '说明',
        memberId: 4,
        runId: 'run-manual',
        clock,
      }),
    ).toThrow();
  });
});
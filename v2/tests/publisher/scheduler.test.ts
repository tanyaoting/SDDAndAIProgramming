import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import {
  evaluatePushSchedule,
  hasSuccessfulPush,
  missedPushCatchUpDeadline,
  parsePushTime,
} from '../../src/publisher/scheduler.js';

describe('T-019 scheduler', () => {
  it('到达推送时刻应触发', () => {
    const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
    const decision = evaluatePushSchedule(clock, '18:00', '2026-11-25', false);
    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe('on_time');
  });

  it('错过时段后 5 分钟内补发', () => {
    const clock = new FixedClock(new Date('2026-11-25T18:04:00+08:00'));
    const decision = evaluatePushSchedule(clock, '18:00', '2026-11-25', false);
    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe('catch_up');
  });

  it('已成功推送则去重', () => {
    const clock = new FixedClock(new Date('2026-11-25T18:01:00+08:00'));
    const decision = evaluatePushSchedule(clock, '18:00', '2026-11-25', true);
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe('already_sent');
  });

  it('推送时刻前不发送', () => {
    const clock = new FixedClock(new Date('2026-11-25T17:30:00+08:00'));
    const decision = evaluatePushSchedule(clock, '18:00', '2026-11-25', false);
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe('too_early');
  });

  it('补发截止为推送时刻 +5 分钟', () => {
    const { hour, minute } = parsePushTime('18:00');
    const deadline = missedPushCatchUpDeadline(
      new FixedClock(new Date('2026-11-25T12:00:00+08:00')),
      '2026-11-25',
      hour,
      minute,
    );
    expect(deadline.getTime()).toBe(new Date('2026-11-25T18:05:00+08:00').getTime());
  });

  it('hasSuccessfulPush 识别 push_log 成功记录', () => {
    const logs = [
      { reportDate: '2026-11-25', channel: 'daily', result: 'SDR-E401' },
      { reportDate: '2026-11-25', channel: 'daily', result: 'ok' },
    ];
    expect(hasSuccessfulPush(logs, '2026-11-25', 'daily')).toBe(true);
    expect(hasSuccessfulPush(logs, '2026-11-24', 'daily')).toBe(false);
  });
});
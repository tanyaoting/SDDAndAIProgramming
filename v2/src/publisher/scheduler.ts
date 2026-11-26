import { dayKey, minutesOfDay, parseInstant } from '../clock.js';
import type { Clock } from '../types.js';

export interface PushLogSlice {
  readonly reportDate: string;
  readonly channel: string;
  readonly result: string;
}

export type ScheduleReason = 'on_time' | 'catch_up' | 'already_sent' | 'too_early' | 'past_window';

export interface ScheduleDecision {
  readonly shouldSend: boolean;
  readonly reason: ScheduleReason;
  readonly retryCount: number;
}

export function parsePushTime(pushTime: string): { hour: number; minute: number } {
  const [hour = '0', minute = '0'] = pushTime.split(':');
  return { hour: Number(hour), minute: Number(minute) };
}

export function missedPushCatchUpDeadline(
  clock: Clock,
  reportDate: string,
  hour: number,
  minute: number,
): Date {
  void clock;
  const start = parseInstant(
    `${reportDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
  );
  return new Date(start.getTime() + 5 * 60_000);
}

function scheduledMinute(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function hasSuccessfulPush(
  logs: readonly PushLogSlice[],
  reportDate: string,
  channel: string,
): boolean {
  return logs.some(
    (row) => row.reportDate === reportDate && row.channel === channel && row.result === 'ok',
  );
}

export function evaluatePushSchedule(
  clock: Clock,
  pushTime: string,
  reportDate: string,
  alreadySent: boolean,
): ScheduleDecision {
  if (alreadySent) {
    return { shouldSend: false, reason: 'already_sent', retryCount: 0 };
  }

  const today = dayKey(clock, clock.now());
  if (today !== reportDate) {
    return { shouldSend: false, reason: 'too_early', retryCount: 0 };
  }

  const { hour, minute } = parsePushTime(pushTime);
  const target = scheduledMinute(hour, minute);
  const nowMinute = minutesOfDay(clock, clock.now());

  if (nowMinute < target) {
    return { shouldSend: false, reason: 'too_early', retryCount: 0 };
  }

  if (nowMinute === target) {
    return { shouldSend: true, reason: 'on_time', retryCount: 0 };
  }

  const deadline = missedPushCatchUpDeadline(clock, reportDate, hour, minute);
  if (clock.now().getTime() <= deadline.getTime()) {
    return { shouldSend: true, reason: 'catch_up', retryCount: 1 };
  }

  return { shouldSend: false, reason: 'past_window', retryCount: 0 };
}
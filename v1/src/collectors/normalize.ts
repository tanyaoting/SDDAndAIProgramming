import { createHash } from 'node:crypto';
import { dayKey } from '../clock.js';
import type { Clock, Event } from '../types.js';

/**
 * 去重键：`sha1(source_id + dayKey(occurred_at) + member_id)`（design.md §3.2）。
 * 日期取 Asia/Shanghai 日界，跨 UTC 日界的同一提交仍得到同一键（CS-19）。
 */
export interface DedupeKeyInput {
  readonly sourceId: string;
  readonly memberId: number;
  readonly occurredAt: Date;
  readonly clock: Clock;
}

export function makeDedupeKey(input: DedupeKeyInput): string {
  const material = `${input.sourceId}${dayKey(input.clock, input.occurredAt)}${input.memberId}`;
  return createHash('sha1').update(material).digest('hex');
}

/**
 * 事件归一与去重（FR-05）。
 * 同一 `dedupeKey` 仅保留主源事件；同为辅助源时保留最早发生者；结果按发生时间升序。
 */
export function dedupe(events: readonly Event[]): Event[] {
  const byKey = new Map<string, Event>();
  for (const event of events) {
    const existing = byKey.get(event.dedupeKey);
    if (existing === undefined) {
      byKey.set(event.dedupeKey, event);
      continue;
    }
    if (existing.isPrimary && !event.isPrimary) continue;
    if (!existing.isPrimary && event.isPrimary) {
      byKey.set(event.dedupeKey, event);
      continue;
    }
    if (event.occurredAt < existing.occurredAt) {
      byKey.set(event.dedupeKey, event);
    }
  }

  return [...byKey.values()].sort((left, right) => {
    const delta = left.occurredAt.getTime() - right.occurredAt.getTime();
    return delta !== 0 ? delta : left.sourceId.localeCompare(right.sourceId);
  });
}

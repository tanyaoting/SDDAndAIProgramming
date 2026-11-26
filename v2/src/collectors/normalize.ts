import { createHash } from 'node:crypto';
import { dayKey } from '../clock.js';
import type { Clock, Event } from '../types.js';

export function buildDedupeKey(
  sourceId: string,
  occurredAt: Date,
  memberId: number,
  clock: Clock,
): string {
  const digest = createHash('sha1')
    .update(`${sourceId}${dayKey(clock, occurredAt)}${String(memberId)}`)
    .digest('hex');
  return digest;
}

export function dedupe(events: readonly Event[]): Event[] {
  const byKey = new Map<string, Event>();

  for (const event of events) {
    const existing = byKey.get(event.dedupeKey);
    if (existing === undefined) {
      byKey.set(event.dedupeKey, event);
      continue;
    }
    if (!existing.isPrimary && event.isPrimary) {
      byKey.set(event.dedupeKey, event);
    } else if (
      existing.isPrimary === event.isPrimary &&
      event.occurredAt.getTime() < existing.occurredAt.getTime()
    ) {
      byKey.set(event.dedupeKey, event);
    }
  }

  return [...byKey.values()].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
}
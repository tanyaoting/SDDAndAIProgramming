import type { Clock, Event } from '../types.js';
import { buildDedupeKey } from './normalize.js';

export interface ManualEventInput {
  readonly text: string;
  readonly ref: string;
  readonly memberId: number;
  readonly runId: string;
  readonly clock: Clock;
}

export function createManualEvent(input: ManualEventInput): Event {
  const text = input.text.trim();
  const ref = input.ref.trim();
  if (text === '' || ref === '') {
    throw new Error('manual text and ref must be non-empty');
  }

  const occurredAt = input.clock.now();
  const sourceId = `manual:${String(occurredAt.getTime())}:${text.slice(0, 32)}`;

  return {
    memberId: input.memberId,
    source: 'manual',
    sourceId,
    kind: 'note',
    occurredAt,
    title: text,
    detail: ref,
    dedupeKey: buildDedupeKey(sourceId, occurredAt, input.memberId, input.clock),
    isPrimary: true,
    runId: input.runId,
    payload: { ref },
  };
}
import { createHash } from 'node:crypto';
import { dayKey } from '../clock.js';
import type { Clock } from '../types.js';

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

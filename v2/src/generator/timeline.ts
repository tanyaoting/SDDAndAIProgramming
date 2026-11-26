import { minutesOfDay } from '../clock.js';
import type { WorkBlock } from '../config.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Clock, Event } from '../types.js';

export type { WorkBlock } from '../config.js';

function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function validateBlocks(blocks: readonly WorkBlock[]): void {
  if (blocks.length === 0) {
    throw new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, '时段配置不能为空', { source: 'config' });
  }
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (toMinutes(block.start) >= toMinutes(block.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段 ${block.name} 的 start 必须早于 end`,
        { source: 'config' },
      );
    }
    const prev = blocks[i - 1];
    if (prev === undefined) continue;
    if (toMinutes(block.start) < toMinutes(prev.start)) {
      throw new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, `时段 ${block.name} 未按起点升序`, {
        source: 'config',
      });
    }
    if (toMinutes(block.start) < toMinutes(prev.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段 ${block.name} 与 ${prev.name} 重叠`,
        { source: 'config' },
      );
    }
  }
}

/** IR-05：休息区间内的事件归入前一工作时段；时刻经 clock.timeZone 解释。 */
export function assignBlocks(
  events: readonly Event[],
  blocks: readonly WorkBlock[],
  clock: Clock,
): Map<string, Event[]> {
  validateBlocks(blocks);
  const buckets = new Map<string, Event[]>();
  for (const block of blocks) buckets.set(block.name, []);

  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of sorted) {
    const at = minutesOfDay(clock, event.occurredAt);
    let target = blocks[0]!;
    for (const block of blocks) {
      if (at >= toMinutes(block.start)) target = block;
      if (at >= toMinutes(block.start) && at < toMinutes(block.end)) {
        target = block;
        break;
      }
    }
    buckets.get(target.name)?.push(event);
  }

  return buckets;
}
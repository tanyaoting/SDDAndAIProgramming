import { minutesOfDay } from '../clock.js';
import type { WorkBlock } from '../config.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Clock, Event } from '../types.js';

export type { WorkBlock } from '../config.js';

function minutesOf(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** 时段表不合法（重叠 / 乱序 / 空区间）抛 SDR-E301，信息含时段名。 */
export function assertWorkBlocks(blocks: readonly WorkBlock[]): void {
  if (blocks.length === 0) {
    throw new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, '时段配置不能为空', { source: 'config' });
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) continue;
    if (minutesOf(block.start) >= minutesOf(block.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段 ${block.name} 的 start 必须早于 end`,
        { source: 'config' },
      );
    }
    const previous = blocks[index - 1];
    if (previous === undefined) continue;
    if (minutesOf(block.start) < minutesOf(previous.start)) {
      throw new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, `时段 ${block.name} 未按起点升序`, {
        source: 'config',
      });
    }
    if (minutesOf(block.start) < minutesOf(previous.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段 ${block.name} 与 ${previous.name} 重叠`,
        { source: 'config' },
      );
    }
  }
}

/**
 * 按时段归位事件（FR-07 / IR-05）：休息区间的事件归入前一工作时段，
 * 时刻按 `clock.timeZone` 解释；每个事件只按开始时间归位一次。
 */
export function assignBlocks(
  events: readonly Event[],
  blocks: readonly WorkBlock[],
  clock: Clock,
): Map<string, Event[]> {
  assertWorkBlocks(blocks);

  const result = new Map<string, Event[]>();
  for (const block of blocks) result.set(block.name, []);

  const ordered = [...events].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );

  for (const event of ordered) {
    const at = minutesOfDay(clock, event.occurredAt);
    let target = blocks[0];
    for (const block of blocks) {
      if (at >= minutesOf(block.start)) target = block;
      if (at >= minutesOf(block.start) && at < minutesOf(block.end)) {
        target = block;
        break;
      }
    }
    if (target === undefined) continue;
    result.get(target.name)?.push(event);
  }

  return result;
}

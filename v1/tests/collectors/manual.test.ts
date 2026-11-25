import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { ManualInputError, assertManualPair, collectManual } from '../../src/collectors/manual.js';

const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));

function options(texts: readonly string[]): Parameters<typeof collectManual>[0] {
  return { texts, ref: '群聊沟通：协助定位线上问题', memberId: 3, runId: 'run-1', clock };
}

describe('T-009 手工补充入口', () => {
  it('--manual 与 --ref 必须成对出现', () => {
    expect(() => assertManualPair(undefined, undefined)).not.toThrow();
    expect(() => assertManualPair('补充内容', undefined)).toThrow(ManualInputError);
    expect(() => assertManualPair(undefined, '来源说明')).toThrow(ManualInputError);
    expect(() => assertManualPair('补充内容', '来源说明')).not.toThrow();
  });

  it('空串与纯空白被拒绝', () => {
    expect(() => assertManualPair('   ', '来源')).toThrow(ManualInputError);
    expect(() => assertManualPair('内容', '  ')).toThrow(ManualInputError);
    expect(() => collectManual(options(['   ']))).toThrow(ManualInputError);
    expect(() => collectManual({ ...options([]), ref: '' })).toThrow(ManualInputError);
  });

  it('单次可录入多条，生成 manual 事件与 note 链接', () => {
    const collected = collectManual(options(['协助排查线上 500', '参加需求评审']));

    expect(collected).toHaveLength(2);
    expect(collected.map((item) => item.event.title)).toEqual(['协助排查线上 500', '参加需求评审']);
    for (const item of collected) {
      expect(item.event).toMatchObject({
        source: 'manual',
        kind: 'note',
        memberId: 3,
        runId: 'run-1',
        isPrimary: true,
      });
      expect(item.link).toEqual({
        linkType: 'note',
        target: '群聊沟通：协助定位线上问题',
      });
    }
    expect(new Set(collected.map((item) => item.event.sourceId)).size).toBe(2);
  });

  it('同一内容重复录入得到相同去重键', () => {
    const first = collectManual(options(['协助排查线上 500']))[0]?.event.dedupeKey;
    const second = collectManual(options(['协助排查线上 500']))[0]?.event.dedupeKey;
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});

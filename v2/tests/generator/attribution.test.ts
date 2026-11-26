import { describe, expect, it } from 'vitest';
import {
  resolveAttribution,
  type AttributionContext,
} from '../../src/generator/attribution.js';
import type { Event } from '../../src/types.js';

function commit(detail?: string, payload?: unknown): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T10:00:00+08:00'),
    title: 'feat: 协作能力',
    ...(detail === undefined ? {} : { detail }),
    ...(payload === undefined ? {} : { payload }),
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
  };
}

function ctx(
  lookup: (key: string) => number | undefined,
  taskMembers: readonly number[] = [],
): AttributionContext {
  return {
    findMemberByGithubLogin: lookup,
    findMemberByEmailOrName: lookup,
    taskWindowMembers: () => taskMembers,
  };
}

describe('T-013 协作归属三级策略', () => {
  it('Co-authored-by 返回全部作者（CS-03）', () => {
    const event = commit(
      ['Co-authored-by: bob <bob@example.com>', 'Co-authored-by: carol <carol@example.com>'].join(
        '\n',
      ),
    );
    const directory: Record<string, number> = {
      bob: 2,
      'bob@example.com': 2,
      carol: 3,
      'carol@example.com': 3,
    };
    const result = resolveAttribution(event, ctx((k) => directory[k]));
    expect(result.kind).toBe('coauthor');
    expect(result.confirmed).toBe(true);
    expect(result.members).toEqual([
      { memberId: 1, role: 'primary' },
      { memberId: 2, role: 'co' },
      { memberId: 3, role: 'co' },
    ]);
  });

  it('仅标注提交作者时不扩增归属', () => {
    const event = commit('Co-authored-by: alice <alice@example.com>');
    const result = resolveAttribution(
      event,
      ctx((k) => (k === 'alice@example.com' || k === 'alice' ? 1 : undefined)),
    );
    expect(result.kind).toBe('fallback');
    expect(result.members).toEqual([{ memberId: 1, role: 'primary' }]);
  });

  it('任务时间窗 → task_window', () => {
    const result = resolveAttribution(commit(), ctx(() => undefined, [1, 4]));
    expect(result.kind).toBe('task_window');
    expect(result.confirmed).toBe(true);
    expect(result.members).toEqual([
      { memberId: 1, role: 'primary' },
      { memberId: 4, role: 'co' },
    ]);
  });

  it('无法判定 → fallback 待确认', () => {
    expect(resolveAttribution(commit(), ctx(() => undefined))).toEqual({
      kind: 'fallback',
      confirmed: false,
      members: [{ memberId: 1, role: 'primary' }],
    });
  });

  it('非 commit 按源作者归属', () => {
    const event: Event = { ...commit(), kind: 'task_done', source: 'feishu' };
    expect(resolveAttribution(event, ctx(() => undefined))).toEqual({
      kind: 'author',
      confirmed: true,
      members: [{ memberId: 1, role: 'primary' }],
    });
  });

  it('禁止仅以 event.memberId 充当多人归属', () => {
    const result = resolveAttribution(commit(), ctx(() => undefined));
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.memberId).toBe(1);
  });
});
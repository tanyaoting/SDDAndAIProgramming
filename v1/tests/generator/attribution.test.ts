import { describe, expect, it } from 'vitest';
import { resolveAttribution } from '../../src/generator/attribution.js';
import type { RepoIndex } from '../../src/generator/attribution.js';
import type { Event } from '../../src/types.js';

function commit(detail?: string): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T10:00:00+08:00'),
    title: 'feat: 实现协作功能',
    ...(detail === undefined ? {} : { detail }),
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
  };
}

function index(
  resolve: (value: string) => number | undefined,
  taskMembers: readonly number[] = [],
): RepoIndex {
  return {
    findMemberByCoauthor: resolve,
    findTaskWindowMembers: () => taskMembers,
  };
}

describe('T-013 协作归属三级策略', () => {
  it('Co-authored-by 返回全部作者：提交作者 primary，其余 co（CS-03）', () => {
    const event = commit(
      ['Co-authored-by: Bob <bob@example.com>', 'Co-authored-by: Carol <carol@example.com>'].join(
        '\n',
      ),
    );
    const directory: Record<string, number> = {
      'bob@example.com': 2,
      'carol@example.com': 3,
    };

    const result = resolveAttribution(event, index((value) => directory[value]));

    expect(result.kind).toBe('coauthor');
    expect(result.confirmed).toBe(true);
    expect(result.members).toEqual([
      { memberId: 1, role: 'primary' },
      { memberId: 2, role: 'co' },
      { memberId: 3, role: 'co' },
    ]);
  });

  it('Co-authored-by 重复标注提交作者时不产生重复归属', () => {
    const event = commit('Co-authored-by: Alice <alice@example.com>');
    const result = resolveAttribution(event, index((value) => (value === 'alice@example.com' ? 1 : undefined)));
    expect(result.members).toEqual([{ memberId: 1, role: 'primary' }]);
    expect(result.kind).toBe('fallback');
  });

  it('无标记但命中任务时间窗 → task_window 且已确认', () => {
    const result = resolveAttribution(commit(), index(() => undefined, [1, 4]));
    expect(result.kind).toBe('task_window');
    expect(result.confirmed).toBe(true);
    expect(result.members).toEqual([
      { memberId: 1, role: 'primary' },
      { memberId: 4, role: 'co' },
    ]);
  });

  it('仍无法判定 → fallback 且待确认，仅提交作者', () => {
    const result = resolveAttribution(commit(), index(() => undefined));
    expect(result).toEqual({
      kind: 'fallback',
      confirmed: false,
      members: [{ memberId: 1, role: 'primary' }],
    });
  });

  it('非 commit 事件按事实源作者归属且已确认', () => {
    const event: Event = { ...commit(), kind: 'task_done', source: 'feishu' };
    expect(resolveAttribution(event, index(() => undefined))).toEqual({
      kind: 'author',
      confirmed: true,
      members: [{ memberId: 1, role: 'primary' }],
    });
  });
});

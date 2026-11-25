import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../src/clock.js';
import { queryHistory, renderHistory } from '../src/history.js';
import type { EntryInput } from '../src/store/repo.js';
import { Repo } from '../src/store/repo.js';
import { initSchema } from '../src/store/schema.js';

const NOW = '2026-11-25T09:00:00+08:00';
const clock = new FixedClock(new Date(NOW));

let db: Database.Database;
let repo: Repo;

function seedMembers(): void {
  const insert = db.prepare(
    'INSERT INTO member (id, github_login, display_name, manager_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run(1, 'alice', 'Alice', null, NOW);
  insert.run(2, 'bob', 'Bob', 1, NOW);
  insert.run(3, 'carol', 'Carol', null, NOW);
}

function entry(index: number): EntryInput {
  return {
    timeBlock: 'morning',
    state: 'done',
    content: `任务 ${index}`,
    orderIndex: index,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ memberId: 2, role: 'primary' }],
    links: [{ linkType: 'url', target: `https://example.com/${index}` }],
  };
}

function seedReport(memberId: number, date: string, count: number): void {
  repo.saveReportBundle({
    memberId,
    reportDate: date,
    status: 'draft',
    body: '',
    entries: Array.from({ length: count }, (_, index) => ({
      ...entry(index),
      members: [{ memberId, role: 'primary' as const }],
    })),
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  repo = new Repo(db, clock);
  seedMembers();
});

afterEach(() => {
  repo.close();
});

describe('T-020 历史查询与权限校验', () => {
  it('本人可查询；直属上级可查询下属；无关成员被拒（CS-09）', () => {
    seedReport(2, '2026-11-25', 2);

    const self = queryHistory(repo, { actorId: 2, memberId: 2, from: '2026-11-01', to: '2026-11-30' });
    expect(self.ok).toBe(true);

    const manager = queryHistory(repo, {
      actorId: 1,
      memberId: 2,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(manager.ok).toBe(true);

    const stranger = queryHistory(repo, {
      actorId: 3,
      memberId: 2,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(stranger).toEqual({ ok: false, reason: 'forbidden' });

    const anonymous = queryHistory(repo, { memberId: 2, from: '2026-11-01', to: '2026-11-30' });
    expect(anonymous.ok).toBe(false);
  });

  it('按 --from/--to 区间过滤，渲染结果只含目标成员正文', () => {
    seedReport(2, '2026-11-20', 1);
    seedReport(2, '2026-11-25', 1);
    seedReport(1, '2026-11-25', 1);

    const result = queryHistory(repo, { actorId: 1, memberId: 2, from: '2026-11-24', to: '2026-11-30' });
    if (!result.ok) throw new Error('应允许查询');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.report.reportDate).toBe('2026-11-25');

    const text = renderHistory(result);
    expect(text).toContain('任务 0');
    expect(text).not.toContain('Alice');
  });

  it('1000 条数据下查询 ≤ 2 秒（CS-10）', () => {
    seedReport(2, '2026-11-25', 1000);
    const startedAt = performance.now();
    const result = queryHistory(repo, { actorId: 2, memberId: 2, from: '2026-11-01', to: '2026-11-30' });
    const elapsedMs = performance.now() - startedAt;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reports[0]?.entries).toHaveLength(1000);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

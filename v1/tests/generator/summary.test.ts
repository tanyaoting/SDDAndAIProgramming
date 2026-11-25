import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { findSummaryRows, renderTeamSummary } from '../../src/generator/summary.js';
import { SUMMARY_SQL } from '../../src/store/model.js';
import { Repo } from '../../src/store/repo.js';
import type { EntryInput, ReportBundleInput } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';

const NOW = '2026-11-25T18:00:00+08:00';
const DATE = '2026-11-25';
const clock = new FixedClock(new Date(NOW));

let db: Database.Database;
let repo: Repo;

function entry(content: string, state: EntryInput['state'], orderIndex = 0): EntryInput {
  return {
    timeBlock: 'morning',
    state,
    content,
    orderIndex,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ memberId: 1, role: 'primary' }],
    links: [{ linkType: 'note', target: '来源说明' }],
  };
}

function bundle(memberId: number, status: ReportBundleInput['status'], entries: EntryInput[]): void {
  repo.saveReportBundle({ memberId, reportDate: DATE, status, entries });
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  const insert = db.prepare(
    'INSERT INTO member (id, github_login, display_name, created_at) VALUES (?, ?, ?, ?)',
  );
  for (const [id, login, name] of [
    [1, 'alice', 'Alice'],
    [2, 'bob', 'Bob'],
    [3, 'carol', 'Carol'],
    [4, 'dave', 'Dave'],
    [5, 'eve', 'Eve'],
  ] as const) {
    insert.run(id, login, name, NOW);
  }
  repo = new Repo(db, clock);

  bundle(1, 'draft', [entry('完成登录接口', 'done', 0), entry('修复分页', 'done', 1), entry('联调支付', 'doing', 2)]);
  bundle(2, 'confirmed', [entry('阻塞：等待第三方接口', 'blocked', 0)]);
  bundle(3, 'blank', [entry('今日无进展记录', 'doing', 0)]);
  bundle(4, 'leave', [entry('请假（未出勤）', 'plan', 0)]);
});

afterEach(() => {
  repo.close();
});

describe('T-016 团队汇总', () => {
  it('查询 SQL 使用投影白名单，不含正文列（CS-09 / ADR-006）', () => {
    const sql = SUMMARY_SQL.toLowerCase();
    expect(sql).not.toMatch(/\bcontent\b/);
    expect(sql).not.toMatch(/\btitle\b/);
    expect(sql).not.toMatch(/\bdetail\b/);
    expect(sql).not.toMatch(/\bbody\b/);
  });

  it('按成员聚合条目计数与状态分布', () => {
    const rows = findSummaryRows(repo, DATE);

    expect(rows.map((row) => row.displayName)).toEqual(['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    expect(rows[0]).toMatchObject({
      memberId: 1,
      status: 'draft',
      entryCount: 3,
      byState: { done: 2, doing: 1, plan: 0, blocked: 0 },
    });
    expect(rows[1]?.byState.blocked).toBe(1);
    expect(rows[4]).toMatchObject({ status: null, entryCount: 0 });
  });

  it('固定数据渲染出勤矩阵、状态分布与阻塞定位（不含正文）', () => {
    const text = renderTeamSummary(findSummaryRows(repo, DATE), DATE);

    expect(text).toContain('团队日报 2026-11-25');
    expect(text).toContain('出勤：正常 2 人 / 请假 1 人 / 空白 2 人');
    expect(text).toContain('- Alice（draft）：3 条（完成 2 / 进行中 1 / 计划 0 / 阻塞 0）');
    expect(text).toContain('阻塞定位：Bob 1 条');
    expect(text).toContain('sdr history --member 2 --from 2026-11-25 --to 2026-11-25');
    expect(text).not.toContain('等待第三方接口');
    expect(text).not.toContain('完成登录接口');
  });
});

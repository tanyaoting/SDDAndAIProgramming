import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { renderSummary } from '../../src/generator/summary.js';
import { openDatabase } from '../../src/store/db.js';
import { SUMMARY_ROWS_SQL, createRepo, type SaveReportBundleInput } from '../../src/store/repo.js';

const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
const DATE = '2026-11-25';

function entry(
  content: string,
  state: SaveReportBundleInput['entries'][number]['state'],
  orderIndex = 0,
): SaveReportBundleInput['entries'][number] {
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

function seedRepo() {
  const db = openDatabase(':memory:');
  const repo = createRepo(db, clock);
  const insert = db.prepare(
    `INSERT INTO member (id, github_login, display_name, active, created_at) VALUES (?, ?, ?, 1, ?)`,
  );
  const ts = clock.now().toISOString();
  for (const [id, login, name] of [
    [1, 'alice', 'Alice'],
    [2, 'bob', 'Bob'],
    [3, 'carol', 'Carol'],
    [4, 'dave', 'Dave'],
    [5, 'eve', 'Eve'],
  ] as const) {
    insert.run(id, login, name, ts);
  }

  const save = (
    memberId: number,
    status: SaveReportBundleInput['report']['status'],
    entries: SaveReportBundleInput['entries'],
  ) => {
    repo.saveReportBundle({
      report: { memberId, reportDate: DATE, status, generatedAt: clock.now() },
      entries,
    });
  };

  save(1, 'draft', [
    entry('完成登录', 'done', 0),
    entry('修复分页', 'done', 1),
    entry('联调支付', 'doing', 2),
  ]);
  save(2, 'confirmed', [entry('阻塞：等待接口', 'blocked', 0)]);
  save(3, 'blank', [entry('今日无进展记录', 'doing', 0)]);
  save(4, 'leave', [entry('请假（未出勤）', 'plan', 0)]);
  return repo;
}

describe('T-016 团队汇总', () => {
  it('汇总 SQL 投影白名单不含正文（CS-09）', () => {
    const sql = SUMMARY_ROWS_SQL.toLowerCase();
    expect(sql).not.toMatch(/\bcontent\b/);
    expect(sql).not.toMatch(/\btitle\b/);
    expect(sql).not.toMatch(/\bdetail\b/);
    expect(sql).not.toMatch(/\bbody\b/);
  });

  it('按成员聚合条目计数与状态分布', () => {
    const repo = seedRepo();
    const rows = repo.findSummaryRows(DATE);
    expect(rows.map((r) => r.displayName)).toEqual(['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    expect(rows[0]).toMatchObject({
      memberId: 1,
      status: 'draft',
      entryCount: 3,
      byState: { done: 2, doing: 1, plan: 0, blocked: 0 },
    });
    expect(rows[1]?.byState.blocked).toBe(1);
    expect(rows[4]).toMatchObject({ status: null, entryCount: 0 });
  });

  it('渲染出勤矩阵与阻塞定位，不含条目正文', () => {
    const repo = seedRepo();
    const text = renderSummary(repo.findSummaryRows(DATE), DATE);
    expect(text).toContain('团队日报 2026-11-25');
    expect(text).toContain('出勤：正常 2 人 / 请假 1 人 / 空白 2 人');
    expect(text).toContain('- Alice（draft）：3 条（完成 2 / 进行中 1 / 计划 0 / 阻塞 0）');
    expect(text).toContain('阻塞定位：Bob 1 条');
    expect(text).toContain('sdr history --member 2 --from 2026-11-25 --to 2026-11-25');
    expect(text).not.toContain('等待接口');
    expect(text).not.toContain('完成登录');
  });
});
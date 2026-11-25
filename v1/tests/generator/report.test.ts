import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { loadKeywordRules, loadWorkBlocks } from '../../src/config.js';
import { generateReport, renderReportBody } from '../../src/generator/report.js';
import type { RepoIndex } from '../../src/generator/attribution.js';
import { renderEntry } from '../../src/generator/render.js';
import { Repo } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';
import type { Event } from '../../src/types.js';

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../config');
const NOW = '2026-11-25T18:00:00+08:00';
const clock = new FixedClock(new Date(NOW));
const rules = loadKeywordRules(join(CONFIG_DIR, 'keywords.yaml'));
const blocks = loadWorkBlocks(join(CONFIG_DIR, 'work-hours.yaml'));
const repoIndex: RepoIndex = {
  findMemberByCoauthor: () => undefined,
  findTaskWindowMembers: () => [],
};

let db: Database.Database;
let repo: Repo;

function seed(): void {
  const insert = db.prepare(
    'INSERT INTO member (id, github_login, display_name, created_at) VALUES (?, ?, ?, ?)',
  );
  insert.run(1, 'alice', 'Alice', NOW);
  insert.run(2, 'bob', 'Bob', NOW);
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T09:30:00+08:00'),
    title: '完成登录接口',
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
    payload: { html_url: 'https://github.com/acme/app/commit/sha-1' },
    ...overrides,
  };
}

function options(overrides: Partial<Parameters<typeof generateReport>[0]> = {}) {
  return {
    repo,
    clock,
    memberId: 1,
    reportDate: '2026-11-25',
    events: [event()],
    rules,
    blocks,
    repoIndex,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  seed();
  repo = new Repo(db, clock);
});

afterEach(() => {
  repo.close();
});

describe('T-015 日报装配与状态机', () => {
  it('按事件生成 draft 日报，正文与条目渲染一致', () => {
    const result = generateReport(
      options({
        events: [
          event({ dedupeKey: 'dk-1' }),
          event({
            dedupeKey: 'dk-2',
            sourceId: 'sha-2',
            occurredAt: new Date('2026-11-25T14:00:00+08:00'),
            title: '修复分页越界',
            payload: { html_url: 'https://github.com/acme/app/commit/sha-2' },
          }),
        ],
      }),
    );

    expect(result.status).toBe('draft');
    expect(result.skipped).toBe(false);

    const bundle = repo.loadReportBundle(result.reportId);
    expect(bundle?.entries.map((entry) => entry.timeBlock)).toEqual(['morning', 'afternoon']);
    expect(bundle?.report.body).toBe(
      renderReportBody([
        {
          timeBlock: 'morning',
          state: 'done',
          content: '完成登录接口',
          orderIndex: 0,
          isManual: false,
          attributionKind: 'fallback',
          attributionConfirmed: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://github.com/acme/app/commit/sha-1' }],
        },
        {
          timeBlock: 'afternoon',
          state: 'done',
          content: '修复分页越界',
          orderIndex: 1,
          isManual: false,
          attributionKind: 'fallback',
          attributionConfirmed: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://github.com/acme/app/commit/sha-2' }],
        },
      ]),
    );

    const rendered = (bundle?.entries ?? [])
      .map((entry) =>
        renderEntry(
          entry,
          (bundle?.links ?? []).filter((link) => link.entryId === entry.id),
        ),
      )
      .join('\n');
    expect(bundle?.report.body).toBe(rendered);
  });

  it('请假生成占位条目而非空文件', () => {
    const result = generateReport(options({ events: [], leave: true }));
    const bundle = repo.loadReportBundle(result.reportId);
    expect(bundle?.report.status).toBe('leave');
    expect(bundle?.entries).toHaveLength(1);
    expect(bundle?.entries[0]?.content).toBe('请假（未出勤）');
    expect(bundle?.report.body).toContain('请假（未出勤）');
  });

  it('无事件生成可编辑空白模板（CS-06 / CS-14）', () => {
    const result = generateReport(options({ events: [] }));
    const bundle = repo.loadReportBundle(result.reportId);
    expect(result.status).toBe('blank');
    expect(bundle?.report.status).toBe('blank');
    expect(bundle?.entries[0]?.content).toBe('今日无进展记录');
  });

  it('跨天任务写入 original_date 并渲染「自 M-D 起」（CS-16）', () => {
    const createdAt = String(Date.parse('2026-11-23T10:00:00+08:00'));
    const result = generateReport(
      options({
        events: [
          event({
            source: 'feishu',
            kind: 'task_done',
            sourceId: 't1',
            dedupeKey: 'dk-t1',
            title: '完成跨天任务',
            payload: { state: 'done', created_at: createdAt },
          }),
        ],
      }),
    );
    const bundle = repo.loadReportBundle(result.reportId);
    expect(bundle?.entries[0]?.originalDate).toBe('2026-11-23');
    expect(bundle?.report.body).toContain('（自 11-23 起）');
  });

  it('已确认日报不被覆盖，除非 force；一人一日仅一份', () => {
    const first = generateReport(options());
    repo.updateReportStatus(first.reportId, 'confirmed');

    const skipped = generateReport(options({ events: [event({ title: '不应覆盖' })] }));
    expect(skipped.skipped).toBe(true);
    expect(repo.loadReportBundle(first.reportId)?.entries[0]?.content).toBe('完成登录接口');

    const forced = generateReport(options({ events: [event({ title: '强制重生成' })], force: true }));
    expect(forced.skipped).toBe(false);
    expect(forced.reportId).not.toBe(first.reportId);
    expect(repo.loadReportBundle(forced.reportId)?.entries[0]?.content).toBe('强制重生成');

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM report WHERE member_id = 1 AND report_date = ?')
      .get('2026-11-25') as { n: number };
    expect(count.n).toBe(1);
  });
});

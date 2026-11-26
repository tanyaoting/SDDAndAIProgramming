import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { loadKeywordRules, loadWorkBlocks } from '../../src/config.js';
import type { AttributionContext } from '../../src/generator/attribution.js';
import { renderEntry } from '../../src/generator/render.js';
import { assembleReport, renderReportBody } from '../../src/generator/report.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo, type SaveReportBundleEntry } from '../../src/store/repo.js';
import type { Event, ReportStatus } from '../../src/types.js';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../../config');
const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
const rules = loadKeywordRules(join(CONFIG, 'keywords.yaml'));
const blocks = loadWorkBlocks(join(CONFIG, 'work-hours.yaml'));

const attributionCtx: AttributionContext = {
  findMemberByGithubLogin: () => undefined,
  findMemberByEmailOrName: () => undefined,
  taskWindowMembers: () => [],
};

function setupRepo() {
  const db = openDatabase(':memory:');
  const repo = createRepo(db, clock);
  repo.insertMember({ githubLogin: 'alice', displayName: 'Alice', active: true });
  return { db, repo };
}

function ghEvent(overrides: Partial<Event> = {}): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T09:30:00+08:00'),
    title: '完成鉴权接口',
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
    payload: { html_url: 'https://github.com/acme/app/commit/sha-1' },
    ...overrides,
  };
}

function loadBundle(db: ReturnType<typeof openDatabase>, reportId: number) {
  const report = db
    .prepare(`SELECT * FROM report WHERE id = ?`)
    .get(reportId) as {
    id: number;
    status: ReportStatus;
    body: string | null;
  };
  const entries = db
    .prepare(`SELECT * FROM entry WHERE report_id = ? ORDER BY order_index`)
    .all(reportId) as Array<{
    id: number;
    time_block: string;
    state: string;
    content: string;
    order_index: number;
    original_date: string | null;
    attribution_kind: string;
    attribution_confirmed: number;
  }>;
  const links = db
    .prepare(
      `SELECT sl.* FROM source_link sl
       JOIN entry e ON e.id = sl.entry_id WHERE e.report_id = ?`,
    )
    .all(reportId) as Array<{ entry_id: number; link_type: string; target: string }>;
  return { report, entries, links };
}

describe('T-015 日报装配与状态机', () => {
  it('有事件时生成 draft，正文与渲染一致', () => {
    const { db, repo } = setupRepo();
    const result = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [
        ghEvent(),
        ghEvent({
          dedupeKey: 'dk-2',
          sourceId: 'sha-2',
          occurredAt: new Date('2026-11-25T14:00:00+08:00'),
          title: '修复分页越界',
          payload: { html_url: 'https://github.com/acme/app/commit/sha-2' },
        }),
      ],
      rules,
      blocks,
      attributionCtx,
    });
    expect(result.status).toBe('draft');
    expect(result.skipped).toBe(false);
    const bundle = loadBundle(db, result.reportId);
    expect(bundle.entries.map((e) => e.time_block)).toEqual(['morning', 'afternoon']);
    const lines = bundle.entries.map((e) => {
      const entryLinks = linksFor(bundle.links, e.id);
      return renderEntry(
        {
          reportId: result.reportId,
          timeBlock: e.time_block,
          state: e.state as SaveReportBundleEntry['state'],
          content: e.content,
          orderIndex: e.order_index,
          isManual: false,
          attributionKind: e.attribution_kind as SaveReportBundleEntry['attributionKind'],
          attributionConfirmed: e.attribution_confirmed === 1,
          members: [{ entryId: e.id, memberId: 1, role: 'primary' }],
        },
        entryLinks,
      );
    });
    expect(bundle.report.body).toBe(lines.join('\n'));
  });

  it('请假生成占位条目（CS-06）', () => {
    const { db, repo } = setupRepo();
    const result = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [],
      rules,
      blocks,
      attributionCtx,
      leave: true,
    });
    const bundle = loadBundle(db, result.reportId);
    expect(bundle.report.status).toBe('leave');
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]?.content).toBe('请假（未出勤）');
  });

  it('无事件生成空白模板（CS-14）', () => {
    const { db, repo } = setupRepo();
    const result = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [],
      rules,
      blocks,
      attributionCtx,
    });
    const bundle = loadBundle(db, result.reportId);
    expect(result.status).toBe('blank');
    expect(bundle.report.status).toBe('blank');
    expect(bundle.entries[0]?.content).toBe('今日无进展记录');
  });

  it('跨天任务写入 original_date（CS-16）', () => {
    const { db, repo } = setupRepo();
    const createdAt = Date.parse('2026-11-23T10:00:00+08:00');
    const result = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [
        ghEvent({
          source: 'feishu',
          kind: 'task_done',
          sourceId: 't1',
          dedupeKey: 'dk-t1',
          title: '完成跨天任务',
          payload: { state: 'done', created_at: String(createdAt) },
        }),
      ],
      rules,
      blocks,
      attributionCtx,
    });
    const bundle = loadBundle(db, result.reportId);
    expect(bundle.entries[0]?.original_date).toBe('2026-11-23');
    expect(bundle.report.body).toContain('（自 11-23 起）');
  });

  it('已确认日报不被覆盖，除非 force', () => {
    const { db, repo } = setupRepo();
    const first = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [ghEvent()],
      rules,
      blocks,
      attributionCtx,
    });
    db.prepare(`UPDATE report SET status = 'confirmed' WHERE id = ?`).run(first.reportId);

    const skipped = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [ghEvent({ title: '不应写入' })],
      rules,
      blocks,
      attributionCtx,
    });
    expect(skipped.skipped).toBe(true);
    expect(loadBundle(db, first.reportId).entries[0]?.content).toBe('完成鉴权接口');

    const forced = assembleReport({
      repo,
      clock,
      memberId: 1,
      reportDate: '2026-11-25',
      events: [ghEvent({ title: '强制重生', dedupeKey: 'dk-force' })],
      rules,
      blocks,
      attributionCtx,
      force: true,
    });
    expect(forced.skipped).toBe(false);
    expect(loadBundle(db, forced.reportId).entries[0]?.content).toBe('强制重生');
    const count = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM report WHERE member_id = 1 AND report_date = ?`)
        .get('2026-11-25') as { n: number }
    ).n;
    expect(count).toBe(1);
  });
});

function linksFor(
  rows: Array<{ entry_id: number; link_type: string; target: string }>,
  entryId: number,
) {
  return rows
    .filter((r) => r.entry_id === entryId)
    .map((r) => ({
      entryId,
      linkType: r.link_type as 'url' | 'path' | 'note',
      target: r.target,
    }));
}

describe('renderReportBody', () => {
  it('多行正文与逐条渲染一致', () => {
    const drafts: SaveReportBundleEntry[] = [
      {
        timeBlock: 'morning',
        state: 'done',
        content: '条目一',
        orderIndex: 0,
        isManual: false,
        attributionKind: 'author',
        attributionConfirmed: true,
        members: [{ memberId: 1, role: 'primary' }],
        links: [{ linkType: 'note', target: '说明' }],
      },
    ];
    expect(renderReportBody(drafts)).toContain('条目一');
  });
});
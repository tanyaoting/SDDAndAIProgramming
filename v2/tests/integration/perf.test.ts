import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { loadKeywordRules, loadWorkBlocks } from '../../src/config.js';
import { buildDedupeKey } from '../../src/collectors/normalize.js';
import type { AttributionContext } from '../../src/generator/attribution.js';
import { assembleReport } from '../../src/generator/report.js';
import { renderSummary } from '../../src/generator/summary.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo, type SaveReportBundleInput } from '../../src/store/repo.js';
import type { Event } from '../../src/types.js';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../../config');
const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
const rules = loadKeywordRules(join(CONFIG, 'keywords.yaml'));
const blocks = loadWorkBlocks(join(CONFIG, 'work-hours.yaml'));

function attributionCtx(repo: ReturnType<typeof createRepo>): AttributionContext {
  return {
    findMemberByGithubLogin: (login) => repo.findMemberByGithubLogin(login)?.id,
    findMemberByEmailOrName: () => undefined,
    taskWindowMembers: () => [],
  };
}

function entry(content: string, orderIndex: number): SaveReportBundleInput['entries'][number] {
  return {
    timeBlock: 'morning',
    state: 'done',
    content,
    orderIndex,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ memberId: 1, role: 'primary' }],
    links: [{ linkType: 'note', target: 'perf-fixture' }],
  };
}

describe('T-022 进程内性能（FixedClock，不含网络）', () => {
  it('CS-11：单成员单日生成 < 2000ms', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({ githubLogin: 'perf', displayName: '性能', active: true });
    const events: Event[] = [];
    for (let i = 0; i < 120; i += 1) {
      const at = new Date(`2026-11-25T09:${String(i % 60).padStart(2, '0')}:00+08:00`);
      events.push({
        memberId: member.id ?? 0,
        source: 'github',
        sourceId: `sha-${i}`,
        kind: 'commit',
        occurredAt: at,
        title: `提交 ${i}`,
        dedupeKey: buildDedupeKey(`sha-${i}`, at, member.id ?? 0, clock),
        isPrimary: true,
        runId: 'perf',
        payload: { html_url: `https://github.com/acme/repo/commit/sha-${i}` },
      });
    }
    for (const ev of events) repo.upsertEvent(ev);

    const start = performance.now();
    assembleReport({
      repo,
      clock,
      memberId: member.id ?? 0,
      reportDate: '2026-11-25',
      events: repo.findEventsForDate(member.id ?? 0, '2026-11-25'),
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('CS-12：10 人团队汇总 < 2000ms', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const date = '2026-11-25';
    for (let i = 1; i <= 10; i += 1) {
      const m = repo.insertMember({
        githubLogin: `m${i}`,
        displayName: `成员${i}`,
        active: true,
      });
      repo.saveReportBundle({
        report: { memberId: m.id ?? 0, reportDate: date, status: 'draft', generatedAt: clock.now() },
        entries: [entry(`工作${i}`, 0), entry(`工作${i}-b`, 1)],
      });
    }
    const start = performance.now();
    const text = renderSummary(repo.findSummaryRows(date), date);
    const elapsed = performance.now() - start;
    expect(text).toContain('团队日报');
    expect(elapsed).toBeLessThan(2000);
  });

  it('CS-10：历史查询 1000 条 < 2000ms', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({ githubLogin: 'hist', displayName: '历史', active: true });
    const mid = member.id ?? 0;
    const insert = db.transaction(() => {
      for (let i = 0; i < 1000; i += 1) {
        const anchor = new Date('2020-01-01T00:00:00+08:00');
        anchor.setUTCDate(anchor.getUTCDate() + i);
        const y = anchor.getUTCFullYear();
        const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
        const d = String(anchor.getUTCDate()).padStart(2, '0');
        const reportDate = `${y}-${m}-${d}`;
        repo.saveReportBundle({
          report: {
            memberId: mid,
            reportDate,
            status: 'draft',
            generatedAt: clock.now(),
            body: `日报-${i}`,
          },
          entries: [entry(`条目-${i}`, 0)],
        });
      }
    });
    insert();

    const start = performance.now();
    const rows = repo.findHistory(mid, mid, '2020-01-01', '2022-09-27');
    const elapsed = performance.now() - start;
    expect(rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});
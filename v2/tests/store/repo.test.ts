import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { ERROR_CODES } from '../../src/errors.js';
import { openDatabase } from '../../src/store/db.js';
import {
  HistoryAccessDenied,
  SUMMARY_ROWS_SQL,
  createRepo,
  type SaveReportBundleInput,
} from '../../src/store/repo.js';
import type { Event, Member } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

function member(overrides: Partial<Member> = {}): Omit<Member, 'id'> {
  return {
    githubLogin: 'dev',
    displayName: '开发者',
    active: true,
    ...overrides,
  };
}

function sampleEvent(dedupeKey: string): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'abc',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T09:00:00+08:00'),
    title: 'feat: x',
    dedupeKey,
    isPrimary: true,
    runId: 'run-1',
  };
}

describe('T-004 repository', () => {
  it('upsertEvent 相同 dedupe_key 二次写入仍为一行', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember(member());
    const ev = sampleEvent('dedupe-a');
    repo.upsertEvent(ev);
    repo.upsertEvent({ ...ev, title: 'changed title' });
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM event`).get() as { c: number }).c;
    expect(count).toBe(1);
    const row = repo.upsertEvent(ev);
    expect(row.title).toBe('feat: x');
  });

  it('saveReportBundle 冲突时整批回滚', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember(member());
    const bundle: SaveReportBundleInput = {
      report: {
        memberId: 1,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
      },
      entries: [
        {
          timeBlock: 'morning',
          state: 'done',
          content: '工作一',
          orderIndex: 0,
          attributionKind: 'author',
          attributionConfirmed: true,
          isManual: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://example.com/a' }],
        },
        {
          timeBlock: 'afternoon',
          state: 'doing',
          content: '工作二',
          orderIndex: 0,
          attributionKind: 'fallback',
          attributionConfirmed: false,
          isManual: false,
          members: [
            { memberId: 1, role: 'primary' },
            { memberId: 1, role: 'co' },
          ],
          links: [{ linkType: 'note', target: '手工说明' }],
        },
      ],
    };
    expect(() => repo.saveReportBundle(bundle)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.STORE_TRANSACTION_FAILED }),
    );
    expect((db.prepare(`SELECT COUNT(*) AS c FROM report`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM entry`).get() as { c: number }).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS c FROM entry_member`).get() as { c: number }).c).toBe(
      0,
    );
    expect((db.prepare(`SELECT COUNT(*) AS c FROM source_link`).get() as { c: number }).c).toBe(0);
  });

  it('acceptAttribution 确认待确认条目并返回条数', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember(member());
    const { reportId } = repo.saveReportBundle({
      report: {
        memberId: 1,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
      },
      entries: [
        {
          timeBlock: 'morning',
          state: 'blocked',
          content: '阻塞项',
          orderIndex: 0,
          attributionKind: 'fallback',
          attributionConfirmed: false,
          isManual: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'path', target: '/tmp/x' }],
        },
        {
          timeBlock: 'afternoon',
          state: 'done',
          content: '已完成',
          orderIndex: 0,
          attributionKind: 'author',
          attributionConfirmed: true,
          isManual: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://example.com' }],
        },
      ],
    });
    const n = repo.acceptAttribution(reportId, true);
    expect(n).toBe(1);
    const pending = (
      db.prepare(`SELECT COUNT(*) AS c FROM entry WHERE attribution_confirmed = 0`).get() as {
        c: number;
      }
    ).c;
    expect(pending).toBe(0);
  });

  it('findSummaryRows 查询 SQL 不含 content 列', () => {
    expect(SUMMARY_ROWS_SQL.toLowerCase()).not.toContain('content');
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember(member({ displayName: '张三' }));
    repo.saveReportBundle({
      report: {
        memberId: 1,
        reportDate: '2026-11-26',
        status: 'confirmed',
        generatedAt: clock.now(),
      },
      entries: [
        {
          timeBlock: 'morning',
          state: 'done',
          content: '不应出现在汇总 SQL',
          orderIndex: 0,
          attributionKind: 'author',
          attributionConfirmed: true,
          isManual: false,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://x' }],
        },
      ],
    });
    const rows = repo.findSummaryRows('2026-11-26');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryCount).toBe(1);
    expect(rows[0]?.byState.done).toBe(1);
  });

  it('findHistory 仅本人或直属上级可访问', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const leadId = repo.insertMember(
      member({ githubLogin: 'lead', displayName: '组长' }),
    ).id;
    const memberId = repo.insertMember(
      member({ githubLogin: 'ic', displayName: '员工', managerId: leadId }),
    ).id;
    const outsiderId = repo.insertMember(
      member({ githubLogin: 'other', displayName: '外人' }),
    ).id;
    repo.saveReportBundle({
      report: {
        memberId,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
      },
      entries: [],
    });
    expect(() =>
      repo.findHistory(outsiderId, memberId, '2026-11-01', '2026-11-30'),
    ).toThrow(HistoryAccessDenied);
    const self = repo.findHistory(memberId, memberId, '2026-11-01', '2026-11-30');
    expect(self).toHaveLength(1);
    const mgr = repo.findHistory(leadId, memberId, '2026-11-01', '2026-11-30');
    expect(mgr).toHaveLength(1);
  });

  it('getMember 回读 email', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const id = repo.insertMember(
      member({ email: 'dev@corp.example', githubLogin: 'e' }),
    ).id;
    expect(repo.getMember(id)?.email).toBe('dev@corp.example');
  });
});
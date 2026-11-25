import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { Repo, openRepo } from '../../src/store/repo.js';
import type { EntryInput, ReportBundleInput } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';
import type { Event } from '../../src/types.js';

const NOW = '2026-11-25T09:00:00+08:00';
const clock = new FixedClock(new Date(NOW));

let dir: string;
let db: Database.Database;
let repo: Repo;

function seedMembers(): void {
  const insert = db.prepare(
    'INSERT INTO member (id, github_login, display_name, created_at) VALUES (?, ?, ?, ?)',
  );
  insert.run(1, 'alice', 'Alice', NOW);
  insert.run(2, 'bob', 'Bob', NOW);
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    memberId: 1,
    source: 'github',
    sourceId: 'sha-1',
    kind: 'commit',
    occurredAt: new Date('2026-11-25T09:30:00+08:00'),
    title: 'feat: 初始化',
    dedupeKey: 'dk-1',
    isPrimary: true,
    runId: 'run-1',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    timeBlock: 'morning',
    state: 'done',
    content: '完成初始化',
    orderIndex: 0,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ memberId: 1, role: 'primary' }],
    links: [{ linkType: 'url', target: 'https://example.com/commit/sha-1' }],
    ...overrides,
  };
}

function makeBundle(overrides: Partial<ReportBundleInput> = {}): ReportBundleInput {
  return {
    memberId: 1,
    reportDate: '2026-11-25',
    status: 'draft',
    entries: [makeEntry()],
    ...overrides,
  };
}

function countRows(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  seedMembers();
  repo = new Repo(db, clock);
  dir = mkdtempSync(join(tmpdir(), 'sdr-repo-'));
});

afterEach(() => {
  repo.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('T-004 数据访问层与行映射', () => {
  it('事件写入后可往返读取（含可选字段与带偏移时间）', () => {
    const { id, inserted } = repo.insertEvent(
      makeEvent({ detail: '正文说明', payload: { sha: 'sha-1', files: 3 } }),
    );
    expect(inserted).toBe(true);

    const found = repo.findEventById(id);
    expect(found).toMatchObject({
      memberId: 1,
      source: 'github',
      sourceId: 'sha-1',
      kind: 'commit',
      title: 'feat: 初始化',
      dedupeKey: 'dk-1',
      isPrimary: true,
      runId: 'run-1',
      detail: '正文说明',
      payload: { sha: 'sha-1', files: 3 },
    });
    expect(found?.occurredAt.toISOString()).toBe('2026-11-25T01:30:00.000Z');

    const stored = db
      .prepare('SELECT occurred_at FROM event WHERE id = ?')
      .get(id) as { occurred_at: string };
    expect(stored.occurred_at).toBe('2026-11-25T09:30:00.000+08:00');
  });

  it('重复 dedupeKey 返回幂等结果而非抛错（CS-01）', () => {
    const first = repo.insertEvent(makeEvent());
    const second = repo.insertEvent(makeEvent({ title: 'feat: 重复采集' }));
    expect(second).toEqual({ id: first.id, inserted: false });
    expect(countRows('event')).toBe(1);
  });

  it('findEventsBetween 左闭右开且按发生时间升序', () => {
    repo.insertEvent(makeEvent({ sourceId: 'a', dedupeKey: 'dk-a', occurredAt: new Date('2026-11-25T09:00:00+08:00') }));
    repo.insertEvent(makeEvent({ sourceId: 'b', dedupeKey: 'dk-b', occurredAt: new Date('2026-11-25T10:00:00+08:00') }));
    repo.insertEvent(makeEvent({ sourceId: 'c', dedupeKey: 'dk-c', occurredAt: new Date('2026-11-26T00:00:00+08:00') }));

    const rows = repo.findEventsBetween(
      new Date('2026-11-25T00:00:00+08:00'),
      new Date('2026-11-26T00:00:00+08:00'),
    );
    expect(rows.map((row) => row.sourceId)).toEqual(['a', 'b']);
  });

  it('日报读写与状态/正文更新', () => {
    const reportId = repo.insertReport({
      memberId: 1,
      reportDate: '2026-11-25',
      status: 'draft',
      body: '草稿正文',
    });
    expect(repo.findReport(1, '2026-11-25')?.body).toBe('草稿正文');
    expect(repo.findReportById(reportId)?.status).toBe('draft');

    repo.updateReportStatus(reportId, 'confirmed');
    repo.updateReportBody(reportId, '确认正文');
    const updated = repo.findReportById(reportId);
    expect(updated?.status).toBe('confirmed');
    expect(updated?.body).toBe('确认正文');
    expect(updated?.generatedAt.toISOString()).toBe('2026-11-25T01:00:00.000Z');
  });

  it('四表原子写入后可整体加载（含归属与链接）', () => {
    const reportId = repo.saveReportBundle(
      makeBundle({
        entries: [
          makeEntry({
            orderIndex: 1,
            attributionKind: 'coauthor',
            members: [
              { memberId: 1, role: 'primary' },
              { memberId: 2, role: 'co' },
            ],
          }),
          makeEntry({ orderIndex: 0, timeBlock: 'morning', content: '修复缺陷' }),
        ],
      }),
    );

    const bundle = repo.loadReportBundle(reportId);
    expect(bundle?.report.reportDate).toBe('2026-11-25');
    expect(bundle?.entries.map((entry) => entry.content)).toEqual(['修复缺陷', '完成初始化']);
    expect(
      bundle?.entries[1]?.members?.map(({ memberId, role }) => ({ memberId, role })),
    ).toEqual([
      { memberId: 1, role: 'primary' },
      { memberId: 2, role: 'co' },
    ]);
    expect(bundle?.links).toHaveLength(2);
    expect(repo.loadReportBundle(9999)).toBeUndefined();
  });

  it('四表写入失败时整体回滚并抛 SDR-E501', () => {
    let caught: unknown;
    try {
      repo.saveReportBundle(
        makeBundle({
          entries: [
            makeEntry(),
            makeEntry({
              orderIndex: 2,
              members: [{ memberId: 999, role: 'co' }],
            }),
          ],
        }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SdrError);
    expect((caught as SdrError).code).toBe(ERROR_CODES.STORE_TRANSACTION_FAILED);
    expect(countRows('report')).toBe(0);
    expect(countRows('entry')).toBe(0);
    expect(countRows('entry_member')).toBe(0);
    expect(countRows('source_link')).toBe(0);
  });

  it('删除条目同步清理归属与链接', () => {
    const reportId = repo.saveReportBundle(makeBundle());
    const entryId = repo.findEntriesByReport(reportId)[0]?.id;
    expect(entryId).toBeDefined();

    repo.deleteEntry(entryId as number);
    expect(countRows('entry')).toBe(0);
    expect(countRows('entry_member')).toBe(0);
    expect(countRows('source_link')).toBe(0);
  });

  it('acceptAttribution 批量确认并返回条数，逐条模式只确认一条', () => {
    const pending = (orderIndex: number): EntryInput =>
      makeEntry({ orderIndex, attributionKind: 'fallback', attributionConfirmed: false });

    const batchId = repo.saveReportBundle(
      makeBundle({ entries: [pending(0), pending(1), makeEntry({ orderIndex: 2 })] }),
    );
    expect(repo.acceptAttribution(batchId, true)).toBe(2);
    expect(repo.findEntriesByReport(batchId).every((entry) => entry.attributionConfirmed)).toBe(true);

    const singleId = repo.saveReportBundle(
      makeBundle({ reportDate: '2026-11-26', entries: [pending(0), pending(1)] }),
    );
    expect(repo.acceptAttribution(singleId, false)).toBe(1);
    expect(repo.findEntriesByReport(singleId).filter((entry) => entry.attributionConfirmed)).toHaveLength(1);
  });

  it('openRepo 在文件库上建表并可重复打开', () => {
    const path = join(dir, 'data.db');
    openRepo(path, clock).close();
    openRepo(path, clock).close();

    const check = new Database(path);
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    check.close();
    expect(tables.map((row) => row.name)).toContain('entry_member');
  });
});

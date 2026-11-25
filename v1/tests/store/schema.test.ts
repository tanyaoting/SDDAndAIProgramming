import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TABLE_NAMES, initSchema } from '../../src/store/schema.js';

const NOW = '2026-11-25T09:00:00+08:00';

let dir: string;
let db: Database.Database;

/** 断言 SQLite 抛出的约束错误码，而不是仅匹配消息文本。 */
function expectSqliteCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `应抛出 ${code}`).toBeDefined();
  expect((caught as { code?: string }).code).toBe(code);
}

function insertMember(login = 'alice', name = 'Alice'): number {
  const info = db
    .prepare('INSERT INTO member (github_login, display_name, created_at) VALUES (?, ?, ?)')
    .run(login, name, NOW);
  return Number(info.lastInsertRowid);
}

function insertEvent(memberId: number, dedupeKey = 'dk-1'): number {
  const info = db
    .prepare(
      `INSERT INTO event (member_id, source, source_id, kind, occurred_at, title, dedupe_key, run_id, created_at)
       VALUES (?, 'github', 'sha-1', 'commit', ?, 'feat: 初始化', ?, 'run-1', ?)`,
    )
    .run(memberId, NOW, dedupeKey, NOW);
  return Number(info.lastInsertRowid);
}

function insertReport(memberId: number, status = 'draft', date = '2026-11-25'): number {
  const info = db
    .prepare(
      'INSERT INTO report (member_id, report_date, status, generated_at) VALUES (?, ?, ?, ?)',
    )
    .run(memberId, date, status, NOW);
  return Number(info.lastInsertRowid);
}

function insertEntry(reportId: number, state = 'done'): number {
  const info = db
    .prepare(
      'INSERT INTO entry (report_id, time_block, state, content, order_index) VALUES (?, ?, ?, ?, ?)',
    )
    .run(reportId, 'morning', state, '完成初始化', 0);
  return Number(info.lastInsertRowid);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sdr-schema-'));
  db = new Database(join(dir, 'sdr.db'));
  initSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('T-003 建表脚本与约束校验', () => {
  it('建出设计要求的 9 张表', () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = rows.map((row) => row.name);
    for (const table of TABLE_NAMES) {
      expect(names).toContain(table);
    }
  });

  it('对同一库重复初始化幂等，且不丢数据', () => {
    const memberId = insertMember();
    expect(() => initSchema(db)).not.toThrow();
    const count = db.prepare('SELECT COUNT(*) AS n FROM member').get() as { n: number };
    expect(count.n).toBe(1);
    expect(memberId).toBe(1);
  });

  it('启用 WAL 与外键约束', () => {
    expect(String(db.pragma('journal_mode', { simple: true }))).toBe('wal');
    expect(Number(db.pragma('foreign_keys', { simple: true }))).toBe(1);
  });

  it('重复 dedupe_key 被 UNIQUE 拒绝', () => {
    const memberId = insertMember();
    insertEvent(memberId, 'dk-dup');
    expectSqliteCode(() => insertEvent(memberId, 'dk-dup'), 'SQLITE_CONSTRAINT_UNIQUE');
  });

  it('report.status 非法值被 CHECK 拒绝', () => {
    const memberId = insertMember();
    expectSqliteCode(() => insertReport(memberId, 'finished'), 'SQLITE_CONSTRAINT_CHECK');
  });

  it('entry.state 非法值被 CHECK 拒绝', () => {
    const memberId = insertMember();
    const reportId = insertReport(memberId);
    expectSqliteCode(() => insertEntry(reportId, 'unknown'), 'SQLITE_CONSTRAINT_CHECK');
  });

  it('source_link.link_type 非法值被 CHECK 拒绝', () => {
    const memberId = insertMember();
    const entryId = insertEntry(insertReport(memberId));
    const insert = db.prepare(
      'INSERT INTO source_link (entry_id, link_type, target) VALUES (?, ?, ?)',
    );
    expectSqliteCode(
      () => insert.run(entryId, 'image', 'x.png'),
      'SQLITE_CONSTRAINT_CHECK',
    );
  });

  it('entry_member 同一 (entry_id, member_id) 重复插入失败', () => {
    const author = insertMember('alice', 'Alice');
    const coauthor = insertMember('bob', 'Bob');
    const entryId = insertEntry(insertReport(author));
    const insert = db.prepare(
      'INSERT INTO entry_member (entry_id, member_id, role) VALUES (?, ?, ?)',
    );
    insert.run(entryId, coauthor, 'co');
    expectSqliteCode(
      () => insert.run(entryId, coauthor, 'primary'),
      'SQLITE_CONSTRAINT_PRIMARYKEY',
    );
  });

  it('无效外键被拒绝（PRAGMA foreign_keys 生效）', () => {
    expectSqliteCode(() => insertEvent(999), 'SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('一人一日仅一份日报（UNIQUE 约束）', () => {
    const memberId = insertMember();
    insertReport(memberId);
    expectSqliteCode(() => insertReport(memberId), 'SQLITE_CONSTRAINT_UNIQUE');
  });

  it('ingestion_run 每源一条（UNIQUE(run_id, source)）', () => {
    const insert = db.prepare(
      `INSERT INTO ingestion_run (run_id, source, started_at, result)
       VALUES (?, ?, ?, 'ok')`,
    );
    insert.run('run-1', 'github', NOW);
    expectSqliteCode(
      () => insert.run('run-1', 'github', NOW),
      'SQLITE_CONSTRAINT_UNIQUE',
    );
  });
});

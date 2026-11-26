import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/store/db.js';
import { migrate } from '../../src/store/schema.js';

function freshDb(): Database.Database {
  return openDatabase(':memory:');
}

describe('T-003 schema migrate', () => {
  it('migrate 两次幂等且 user_version 为 1', () => {
    const db = freshDb();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    migrate(db);
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      'consent',
      'entry',
      'entry_member',
      'event',
      'ingestion_run',
      'member',
      'push_log',
      'report',
      'source_link',
    ]);
  });

  it('拒绝非法 report.status', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO member (github_login, display_name, active, created_at) VALUES ('a', 'A', 1, '2026-01-01T00:00:00+08:00')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO report (member_id, report_date, status, generated_at) VALUES (1, '2026-11-25', 'invalid', '2026-11-25T18:00:00+08:00')`,
        )
        .run(),
    ).toThrow();
  });

  it('外键开启时拒绝无效 member_id', () => {
    const db = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO event (member_id, source, source_id, kind, occurred_at, title, dedupe_key, is_primary, run_id, created_at)
           VALUES (999, 'github', 'x', 'commit', '2026-11-25T10:00:00+08:00', 't', 'dk1', 1, 'run', '2026-11-25T10:00:00+08:00')`,
        )
        .run(),
    ).toThrow();
  });

  it('member 可写入 email', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO member (github_login, display_name, email, active, created_at) VALUES ('u', 'U', 'u@example.com', 1, '2026-01-01T00:00:00+08:00')`,
    ).run();
    const row = db.prepare(`SELECT email FROM member WHERE github_login = 'u'`).get() as {
      email: string;
    };
    expect(row.email).toBe('u@example.com');
  });

  it('entry_member 主键重复插入失败', () => {
    const db = freshDb();
    const now = '2026-11-25T10:00:00+08:00';
    db.prepare(
      `INSERT INTO member (github_login, display_name, active, created_at) VALUES ('m', 'M', 1, ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO report (member_id, report_date, status, generated_at) VALUES (1, '2026-11-25', 'draft', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO entry (report_id, time_block, state, content, order_index, attribution_kind, attribution_confirmed, is_manual)
       VALUES (1, 'morning', 'done', 'c', 0, 'author', 1, 0)`,
    ).run();
    db.prepare(`INSERT INTO entry_member (entry_id, member_id, role) VALUES (1, 1, 'primary')`).run();
    expect(() =>
      db.prepare(`INSERT INTO entry_member (entry_id, member_id, role) VALUES (1, 1, 'co')`).run(),
    ).toThrow();
  });
});
import type Database from 'better-sqlite3';

/**
 * 建表脚本（design.md §3.2）。
 * 使用 `CREATE TABLE IF NOT EXISTS` 保证对空库/既有库重复执行均幂等；
 * 列名 camelCase 映射由 store/repo.ts 负责，此处保持 snake_case。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS member (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  github_login   TEXT    NOT NULL UNIQUE,
  feishu_open_id TEXT    UNIQUE,
  display_name   TEXT    NOT NULL,
  manager_id     INTEGER REFERENCES member(id),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES member(id),
  source      TEXT    NOT NULL CHECK (source IN ('github', 'feishu', 'local', 'manual')),
  source_id   TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('commit', 'task_done', 'file_change', 'note')),
  occurred_at TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  detail      TEXT,
  dedupe_key  TEXT    NOT NULL UNIQUE,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  run_id      TEXT    NOT NULL,
  payload     TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER NOT NULL REFERENCES member(id),
  report_date  TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('draft', 'confirmed', 'leave', 'blank')),
  body         TEXT,
  generated_at TEXT    NOT NULL,
  pushed_at    TEXT,
  UNIQUE (member_id, report_date)
);

CREATE TABLE IF NOT EXISTS entry (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id             INTEGER NOT NULL REFERENCES report(id),
  time_block            TEXT    NOT NULL,
  state                 TEXT    NOT NULL CHECK (state IN ('done', 'doing', 'plan', 'blocked')),
  content               TEXT    NOT NULL,
  order_index           INTEGER NOT NULL,
  original_date         TEXT,
  source_event_id       INTEGER REFERENCES event(id),
  is_manual             INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
  attribution_kind      TEXT    NOT NULL DEFAULT 'author'
                                CHECK (attribution_kind IN ('author', 'coauthor', 'task_window', 'fallback')),
  attribution_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (attribution_confirmed IN (0, 1))
);

CREATE TABLE IF NOT EXISTS entry_member (
  entry_id  INTEGER NOT NULL REFERENCES entry(id),
  member_id INTEGER NOT NULL REFERENCES member(id),
  role      TEXT    NOT NULL CHECK (role IN ('primary', 'co')),
  PRIMARY KEY (entry_id, member_id)
);

CREATE TABLE IF NOT EXISTS source_link (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id  INTEGER NOT NULL REFERENCES entry(id),
  link_type TEXT    NOT NULL CHECK (link_type IN ('url', 'path', 'note')),
  target    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  source      TEXT    NOT NULL CHECK (source IN ('github', 'feishu', 'local', 'manual')),
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  result      TEXT    NOT NULL CHECK (result IN ('ok', 'partial', 'failed', 'skipped')),
  error_code  TEXT,
  error_msg   TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (run_id, source)
);

CREATE TABLE IF NOT EXISTS push_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT    NOT NULL,
  channel     TEXT    NOT NULL,
  sent_at     TEXT    NOT NULL,
  result      TEXT    NOT NULL CHECK (result IN ('ok', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consent (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES member(id),
  agreed_at TEXT    NOT NULL,
  scope     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_occurred_at ON event(occurred_at);
CREATE INDEX IF NOT EXISTS idx_report_date ON report(report_date);
CREATE INDEX IF NOT EXISTS idx_entry_report ON entry(report_id);
CREATE INDEX IF NOT EXISTS idx_push_log_date ON push_log(report_date);
`;

/** 设计文档要求的 9 张表（仅供测试与自检引用）。 */
export const TABLE_NAMES = [
  'member',
  'event',
  'report',
  'entry',
  'entry_member',
  'source_link',
  'ingestion_run',
  'push_log',
  'consent',
] as const;

/**
 * 初始化数据库：设置 PRAGMA 并建表。
 * 幂等：重复调用不会报错，也不会破坏已有数据。
 */
export function initSchema(db: Database.Database): void {
  // WAL 让读写不互锁（内存库会退化为 memory，不视为失败）。
  db.pragma('journal_mode = WAL');
  // SQLite 默认关闭外键，必须显式开启（design.md §3.3 第 5 条）。
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
}

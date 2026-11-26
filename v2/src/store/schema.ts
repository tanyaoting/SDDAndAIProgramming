import type Database from 'better-sqlite3';

const SCHEMA_V1 = `
CREATE TABLE member (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_login TEXT NOT NULL UNIQUE,
  feishu_open_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  manager_id INTEGER REFERENCES member(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES member(id),
  source TEXT NOT NULL CHECK (source IN ('github', 'feishu', 'local', 'manual')),
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'task_done', 'file_change', 'note')),
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  run_id TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES member(id),
  report_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'leave', 'blank')),
  body TEXT,
  generated_at TEXT NOT NULL,
  pushed_at TEXT,
  UNIQUE(member_id, report_date)
);

CREATE TABLE entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES report(id),
  time_block TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done', 'doing', 'plan', 'blocked')),
  content TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  original_date TEXT,
  source_event_id INTEGER REFERENCES event(id),
  is_manual INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
  attribution_kind TEXT NOT NULL DEFAULT 'author'
    CHECK (attribution_kind IN ('author', 'coauthor', 'task_window', 'fallback')),
  attribution_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (attribution_confirmed IN (0, 1))
);

CREATE TABLE entry_member (
  entry_id INTEGER NOT NULL REFERENCES entry(id),
  member_id INTEGER NOT NULL REFERENCES member(id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'co')),
  PRIMARY KEY (entry_id, member_id)
);

CREATE TABLE source_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entry(id),
  link_type TEXT NOT NULL CHECK (link_type IN ('url', 'path', 'note')),
  target TEXT NOT NULL
);

CREATE TABLE ingestion_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github', 'feishu', 'local', 'manual')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL CHECK (result IN ('ok', 'partial', 'failed', 'skipped')),
  error_code TEXT,
  error_msg TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, source)
);

CREATE TABLE push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  result TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE consent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES member(id),
  agreed_at TEXT NOT NULL,
  scope TEXT NOT NULL
);
`;

export function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) {
    db.exec(SCHEMA_V1);
    db.pragma('user_version = 1');
    return;
  }
  if (version !== 1) {
    throw new Error(`unsupported schema version: ${version}`);
  }
}
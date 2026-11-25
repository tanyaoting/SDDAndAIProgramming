import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedClock } from '../../src/clock.js';
import type { CliContext } from '../../src/cli/context.js';
import type { SdrConfig } from '../../src/config.js';
import type { MailPayload, Mailer } from '../../src/publisher/mail.js';
import { Repo } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';

/** 集成测试共用装配：内存库 + 固定时钟 + 可观测 stdout/stderr/邮件。 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const V1_ROOT = resolve(HERE, '../..');
export const NOW = '2026-11-25T12:00:00+08:00';

export const CONFIG: SdrConfig = {
  github: { token: 'ghp_integration_token' },
  feishu: { appId: 'cli_integration', appSecret: 'feishu-secret' },
  smtp: { host: 'smtp.example.com', port: 587, user: 'bot', pass: 'pass', from: 'bot@example.com' },
  dbPath: ':memory:',
  pushTime: '18:00',
};

export class RecordingMailer implements Mailer {
  readonly sent: MailPayload[] = [];

  send(payload: MailPayload): Promise<{ ok: true; messageId: string }> {
    this.sent.push(payload);
    return Promise.resolve({ ok: true, messageId: `m-${this.sent.length}` });
  }
}

export interface Harness {
  readonly db: Database.Database;
  readonly repo: Repo;
  readonly context: CliContext;
  readonly output: string[];
  readonly errors: string[];
  readonly mailer: RecordingMailer;
}

export interface SeedMember {
  readonly id: number;
  readonly login: string;
  readonly name: string;
  readonly managerId?: number;
  readonly feishuOpenId?: string;
}

export function seedMember(db: Database.Database, member: SeedMember): void {
  db.prepare(
    'INSERT INTO member (id, github_login, feishu_open_id, display_name, manager_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    member.id,
    member.login,
    member.feishuOpenId ?? null,
    member.name,
    member.managerId ?? null,
    NOW,
  );
}

export function createHarness(iso: string = NOW): Harness {
  const clock = new FixedClock(new Date(iso));
  const db = new Database(':memory:');
  initSchema(db);
  const repo = new Repo(db, clock);
  const output: string[] = [];
  const errors: string[] = [];
  const mailer = new RecordingMailer();
  const context: CliContext = {
    repo,
    clock,
    config: CONFIG,
    mailer,
    env: {},
    cwd: V1_ROOT,
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
    close: () => undefined,
  };
  return { db, repo, context, output, errors, mailer };
}

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { notifyFailure, renderAlert } from '../../src/publisher/alert.js';
import { deliverReport, mailChannel } from '../../src/publisher/deliver.js';
import type { MailPayload, Mailer } from '../../src/publisher/mail.js';
import { Repo } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';
import type { Member } from '../../src/types.js';

const NOW = '2026-11-25T18:05:00+08:00';
const clock = new FixedClock(new Date(NOW));

class RecordingMailer implements Mailer {
  readonly sent: MailPayload[] = [];

  constructor(private readonly failure?: unknown) {}

  send(payload: MailPayload): Promise<{ ok: true; messageId: string }> {
    this.sent.push(payload);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ ok: true, messageId: `m-${this.sent.length}` });
  }
}

let db: Database.Database;
let repo: Repo;
let alice: Member;

function seed(): void {
  db.prepare(
    'INSERT INTO member (id, github_login, display_name, manager_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'alice', 'Alice', null, NOW);
  const row = repo.members.findById(1);
  if (row === undefined) throw new Error('seed failed');
  alice = row;
}

function seedReport(): number {
  return repo.saveReportBundle({
    memberId: 1,
    reportDate: '2026-11-25',
    status: 'draft',
    body: '',
    entries: [
      {
        timeBlock: 'morning',
        state: 'done',
        content: '完成登录接口开发',
        orderIndex: 0,
        isManual: false,
        attributionKind: 'author',
        attributionConfirmed: true,
        members: [{ memberId: 1, role: 'primary' }],
        links: [{ linkType: 'url', target: 'https://github.com/acme/api/commit/sha-1' }],
      },
    ],
  });
}

function deliverOptions(mailer: Mailer, report = repo.findReport(1, '2026-11-25')) {
  if (report === undefined) throw new Error('报告缺失');
  return {
    repo,
    mailer,
    clock,
    reportDate: '2026-11-25',
    member: alice,
    report,
    to: ['alice@example.com'],
    alertTo: ['lead@example.com'],
    logger: (): void => undefined,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  repo = new Repo(db, clock);
  seed();
});

afterEach(() => {
  repo.close();
});

describe('T-018 投递与 push_log', () => {
  it('发送成功写 push_log(ok) 并回写 pushed_at', async () => {
    const mailer = new RecordingMailer();
    seedReport();
    const outcome = await deliverReport(deliverOptions(mailer));
    expect(outcome.status).toBe('sent');
    expect(mailer.sent[0]?.subject).toBe('日报 2026-11-25 Alice');
    expect(repo.audit.findPushes('2026-11-25', mailChannel(1))).toMatchObject([{ result: 'ok' }]);
    expect(repo.findReport(1, '2026-11-25')?.pushedAt).toBeDefined();
  });

  it('同一渠道已成功推送则跳过（补发去重）', async () => {
    const mailer = new RecordingMailer();
    seedReport();
    await deliverReport(deliverOptions(mailer));
    const second = await deliverReport(deliverOptions(mailer));
    expect(second.status).toBe('skipped');
    expect(mailer.sent).toHaveLength(1);
  });

  it('认证失败写 push_log(failed) 并触发一封告警邮件（标注错误类型）', async () => {
    const authError = new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, 'SMTP 认证失败（EAUTH）', {
      source: 'mail',
    });
    const mailer = new RecordingMailer(authError);
    seedReport();
    const outcome = await deliverReport(deliverOptions(mailer));
    expect(outcome.status).toBe('failed');
    expect(repo.audit.findPushes('2026-11-25', mailChannel(1))).toMatchObject([
      { result: 'failed', retryCount: 1 },
    ]);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.subject).toContain('SDR-E401');
    expect(mailer.sent[1]?.text).toContain('错误类型：SDR-E401');
  });
});

describe('T-018 告警模板', () => {
  it('告警正文包含错误类型与来源，便于定位（CS-07）', () => {
    const mail = renderAlert({
      code: 'SDR-E104',
      layer: '采集（github）',
      message: 'GitHub 提交超过 20 页上限',
      occurredAt: '2026-11-25T10:00:00+08:00',
    });
    expect(mail.subject).toBe('[告警] SDR-E104 采集（github） 失败');
    expect(mail.text).toContain('错误类型：SDR-E104');
    expect(mail.text).toContain('2026-11-25T10:00:00+08:00');
  });

  it('告警发送失败不抛错，仅返回 false（不影响其他源）', async () => {
    const logs: string[] = [];
    const mailer: Mailer = { send: () => Promise.reject(new Error('smtp down')) };
    const sent = await notifyFailure({
      mailer,
      to: ['lead@example.com'],
      logger: (line) => logs.push(line),
      alert: { code: 'SDR-E101', layer: '采集（github）', message: '401', occurredAt: NOW },
    });
    expect(sent).toBe(false);
    expect(logs.join('\n')).toContain('告警邮件发送失败');
  });

  it('无告警收件人时跳过发送', async () => {
    const sent = await notifyFailure({
      mailer: new RecordingMailer(),
      to: [],
      logger: (): void => undefined,
      alert: { code: 'SDR-E201', layer: '采集（feishu）', message: 'auth', occurredAt: NOW },
    });
    expect(sent).toBe(false);
  });
});

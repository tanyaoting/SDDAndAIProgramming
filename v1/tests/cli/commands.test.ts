import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import type { SdrConfig } from '../../src/config.js';
import { main } from '../../src/cli.js';
import type { CliContext } from '../../src/cli/context.js';
import { runEdit } from '../../src/cli/edit.js';
import { runHistory } from '../../src/cli/history.js';
import { runPush } from '../../src/cli/push.js';
import { parseArgs } from '../../src/cli/args.js';
import type { MailPayload, Mailer } from '../../src/publisher/mail.js';
import type { EntryInput } from '../../src/store/repo.js';
import { Repo } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V1_ROOT = resolve(HERE, '../..');
const GOLDEN = readFileSync(resolve(HERE, '../fixtures/golden/mail_basic.txt'), 'utf8');
const NOW = '2026-11-25T18:05:00+08:00';
const clock = new FixedClock(new Date(NOW));

const CONFIG: SdrConfig = {
  github: { token: 'token' },
  feishu: { appId: 'app', appSecret: 'secret' },
  smtp: { host: 'smtp.example.com', port: 587, user: 'bot', pass: 'pass', from: 'bot@example.com' },
  dbPath: ':memory:',
  pushTime: '18:00',
};

class RecordingMailer implements Mailer {
  readonly sent: MailPayload[] = [];
  send(payload: MailPayload): Promise<{ ok: true; messageId: string }> {
    this.sent.push(payload);
    return Promise.resolve({ ok: true, messageId: `m-${this.sent.length}` });
  }
}

let db: Database.Database;
let repo: Repo;
let output: string[];
let errors: string[];
let context: CliContext;

function goldenEntries(): EntryInput[] {
  return [
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
    {
      timeBlock: 'morning',
      state: 'done',
      content: '修复分页缺陷',
      orderIndex: 1,
      isManual: false,
      attributionKind: 'fallback',
      attributionConfirmed: false,
      members: [{ memberId: 1, role: 'primary' }],
      links: [{ linkType: 'note', target: '飞书群聊 11-25 15:30' }],
    },
    {
      timeBlock: 'afternoon',
      state: 'doing',
      content: '联调任务接口',
      orderIndex: 2,
      isManual: false,
      attributionKind: 'coauthor',
      attributionConfirmed: true,
      members: [
        { memberId: 1, role: 'primary' },
        { memberId: 2, role: 'co' },
      ],
      links: [{ linkType: 'path', target: '/repo/src/api.ts' }],
    },
  ];
}

function seed(): void {
  const insert = db.prepare(
    'INSERT INTO member (id, github_login, display_name, manager_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run(1, 'alice', 'Alice', null, NOW);
  insert.run(2, 'bob', 'Bob', 1, NOW);
  insert.run(3, 'carol', 'Carol', null, NOW);
  repo.saveReportBundle({
    memberId: 1,
    reportDate: '2026-11-25',
    status: 'draft',
    body: '',
    entries: goldenEntries(),
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  repo = new Repo(db, clock);
  seed();
  output = [];
  errors = [];
  context = {
    repo,
    clock,
    config: CONFIG,
    mailer: new RecordingMailer(),
    env: {},
    cwd: V1_ROOT,
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
    close: () => undefined,
  };
});

afterEach(() => {
  repo.close();
});

describe('T-017 push --dry-run 输出与 golden 一致', () => {
  it('正文逐字匹配，且不写 push_log', async () => {
    const code = await runPush(context, parseArgs(['push', '--date', '2026-11-25', '--dry-run']));
    expect(code).toBe(0);
    const printed = output.join('\n');
    expect(printed).toContain(GOLDEN);
    expect(printed).toContain('=== 日报 2026-11-25 Alice ===');
    expect(repo.audit.findPushes('2026-11-25')).toHaveLength(0);
  });

  it('非 dry-run 发送成功并写 push_log', async () => {
    const code = await runPush(context, parseArgs(['push', '--date', '2026-11-25']));
    expect(code).toBe(0);
    expect(repo.audit.hasSuccessfulPush('2026-11-25')).toBe(true);
  });
});

describe('edit 命令', () => {
  it('新增条目后状态回到 draft 且正文重渲染', () => {
    const code = runEdit(
      context,
      parseArgs(['edit', '--date', '2026-11-25', '--member', '1', '--add-text', '完成联调准备']),
    );
    expect(code).toBe(0);
    const report = repo.findReport(1, '2026-11-25');
    expect(report?.status).toBe('draft');
    expect(report?.body).toContain('完成联调准备');
    expect(repo.findEntriesByReport(report?.id ?? 0)).toHaveLength(4);
  });

  it('删除不存在的条目返回退出码 6', () => {
    const code = runEdit(context, parseArgs(['edit', '--date', '2026-11-25', '--member', '1', '--remove-entry', '9999']));
    expect(code).toBe(6);
  });

  it('确认归属后 [待确认] 标记消失', () => {
    const code = runEdit(
      context,
      parseArgs(['edit', '--date', '2026-11-25', '--member', '1', '--accept-attribution', '--all']),
    );
    expect(code).toBe(0);
    expect(repo.findReport(1, '2026-11-25')?.body).not.toContain('[待确认]');
  });
});

describe('T-020 history 命令退出码', () => {
  it('越权返回 8，本人返回 0', () => {
    const denied = runHistory(
      context,
      parseArgs(['history', '--member', '1', '--actor', '3', '--from', '2026-11-01', '--to', '2026-11-30']),
    );
    expect(denied).toBe(8);

    const allowed = runHistory(
      context,
      parseArgs(['history', '--member', '1', '--actor', '1', '--from', '2026-11-01', '--to', '2026-11-30']),
    );
    expect(allowed).toBe(0);
    expect(output.join('\n')).toContain('完成登录接口开发');
  });
});

describe('cli 入口退出码', () => {
  it('--help 返回 0 并打印用法', async () => {
    const code = await main(['--help'], { stdout: (line) => output.push(line) });
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('用法：sdr');
  });

  it('参数错误返回 2', async () => {
    const code = await main(['push', '--unknown'], {
      context,
      stderr: (line) => errors.push(line),
    });
    expect(code).toBe(2);
  });

  it('缺少环境变量返回 9（E303）', async () => {
    const code = await main(['history', '--member', '1'], {
      env: {},
      stderr: (line) => errors.push(line),
      stdout: (line) => output.push(line),
    });
    expect(code).toBe(9);
    expect(errors.join('\n')).toContain('SDR-E303');
  });
});

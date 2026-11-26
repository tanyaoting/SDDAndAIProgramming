import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { main } from '../../src/cli.js';
import { UsageError, parseArgs } from '../../src/cli/args.js';
import type { CliContext } from '../../src/cli/context.js';
import { runMember } from '../../src/cli/member.js';
import type { SdrConfig } from '../../src/config.js';
import { ERROR_CODES } from '../../src/errors.js';
import type { MailPayload, Mailer } from '../../src/publisher/mail.js';
import { Repo } from '../../src/store/repo.js';
import { initSchema } from '../../src/store/schema.js';

class NoopMailer implements Mailer {
  send(_payload: MailPayload): Promise<{ ok: true; messageId: string }> {
    return Promise.resolve({ ok: true, messageId: 'noop' });
  }
}

const CONFIG: SdrConfig = {
  github: { token: 'token' },
  feishu: { appId: 'app', appSecret: 'secret' },
  smtp: { host: 'smtp.example.com', port: 587, user: 'bot', pass: 'pass', from: 'bot@example.com' },
  dbPath: ':memory:',
  pushTime: '18:00',
};

let db: Database.Database;
let repo: Repo;
let output: string[];
let context: CliContext;

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  repo = new Repo(db, new FixedClock(new Date('2026-11-26T10:00:00+08:00')));
  output = [];
  context = {
    repo,
    clock: new FixedClock(new Date('2026-11-26T10:00:00+08:00')),
    config: CONFIG,
    mailer: new NoopMailer(),
    env: {},
    cwd: '/tmp',
    stdout: (line) => output.push(line),
    stderr: (line) => output.push(`ERR ${line}`),
    close: () => undefined,
  };
});

afterEach(() => {
  repo.close();
});

describe('member add/list', () => {
  it('录入成员并输出 id', () => {
    const code = runMember(
      context,
      parseArgs(['member', 'add', '--github', 'alice', '--name', 'Alice']),
    );
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('已添加 #1 alice（Alice）');
    expect(repo.members.findById(1)?.displayName).toBe('Alice');
  });

  it('--name 缺省时用 GitHub 登录名，--manager 校验存在性', () => {
    runMember(context, parseArgs(['member', 'add', '--github', 'alice']));
    runMember(
      context,
      parseArgs(['member', 'add', '--github', 'bob', '--manager', '1', '--feishu-open-id', 'ou_bob']),
    );
    expect(repo.members.findById(2)).toMatchObject({
      displayName: 'bob',
      managerId: 1,
      feishuOpenId: 'ou_bob',
    });

    expect(() =>
      runMember(context, parseArgs(['member', 'add', '--github', 'carol', '--manager', '999'])),
    ).toThrow(UsageError);
  });

  it('重复 GitHub 登录名与已占用的 open_id 均拒绝', () => {
    runMember(context, parseArgs(['member', 'add', '--github', 'alice', '--feishu-open-id', 'ou_a']));

    expect(() => runMember(context, parseArgs(['member', 'add', '--github', 'alice']))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.STORE_TRANSACTION_FAILED }),
    );
    expect(() =>
      runMember(context, parseArgs(['member', 'add', '--github', 'bob', '--feishu-open-id', 'ou_a'])),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.STORE_TRANSACTION_FAILED }));
  });

  it('list 输出表头与成员行', () => {
    runMember(context, parseArgs(['member', 'add', '--github', 'alice', '--name', 'Alice']));
    output.length = 0;
    expect(runMember(context, parseArgs(['member', 'list']))).toBe(0);
    expect(output[0]).toContain('github');
    expect(output[1]).toBe('1\talice\t-\tAlice\t-\t1');
  });

  it('缺少子命令、缺少 --github、未知子命令均为用法错误（退出码 2）', async () => {
    expect(() => runMember(context, parseArgs(['member']))).toThrow(UsageError);
    expect(() => runMember(context, parseArgs(['member', 'add']))).toThrow(UsageError);
    expect(() => parseArgs(['member', 'remove'])).toThrow(UsageError);

    const code = await main(['member', 'add', '--github', 'alice'], { context });
    expect(code).toBe(0);
    const bad = await main(['member', 'add'], { context });
    expect(bad).toBe(2);
  });
});

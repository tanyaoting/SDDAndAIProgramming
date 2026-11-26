import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { UsageError, parseArgs } from '../../src/cli/args.js';
import type { CliContext } from '../../src/cli/context.js';
import { runFeishuAuth } from '../../src/cli/feishu-auth.js';
import type { SdrConfig } from '../../src/config.js';
import { ERROR_CODES } from '../../src/errors.js';
import type { FeishuTokenRecord } from '../../src/feishu-tokens.js';
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
  feishu: { appId: 'cli_test', appSecret: 'secret-value-123456' },
  smtp: { host: 'smtp.example.com', port: 587, user: 'bot', pass: 'pass', from: 'bot@example.com' },
  dbPath: ':memory:',
  pushTime: '18:00',
};
const NOW = '2026-11-26T10:00:00+08:00';

let db: Database.Database;
let repo: Repo;
let dir: string;
let tokenPath: string;
let mockAgent: MockAgent;
let original: Dispatcher;

function makeContext(openId = 'ou_alice'): CliContext {
  repo.members.insert({ githubLogin: 'alice', displayName: 'Alice', feishuOpenId: openId });
  return {
    repo,
    clock: new FixedClock(new Date(NOW)),
    config: CONFIG,
    mailer: new NoopMailer(),
    env: { SDR_FEISHU_TOKEN_FILE: tokenPath },
    cwd: dir,
    stdout: () => undefined,
    stderr: () => undefined,
    close: () => undefined,
  };
}

function stubFeishu(openId: string): void {
  mockAgent
    .get('https://accounts.feishu.cn')
    .intercept({ path: '/oauth/v3/token', method: 'POST' })
    .reply(
      200,
      JSON.stringify({
        code: 0,
        access_token: 'u-1',
        expires_in: 7200,
        refresh_token: 'r-1',
        refresh_token_expires_in: 604800,
      }),
    );
  mockAgent
    .get('https://open.feishu.cn')
    .intercept({ path: '/open-apis/authen/v1/user_info', method: 'GET' })
    .reply(200, JSON.stringify({ code: 0, data: { open_id: openId, name: 'Alice' } }));
}

/** 模拟浏览器回调：成功后关闭连接，避免 server.close 等待 keep-alive。 */
function hitCallback(port: number, query: string): Promise<number> {
  return fetch(`http://127.0.0.1:${port}/callback?${query}`, {
    headers: { connection: 'close' },
  }).then((response) => response.status);
}

beforeAll(() => {
  original = getGlobalDispatcher();
});

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  repo = new Repo(db, new FixedClock(new Date(NOW)));
  dir = mkdtempSync(join(tmpdir(), 'sdr-auth-'));
  tokenPath = join(dir, 'feishu-tokens.json');
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  mockAgent.enableNetConnect(/127\.0\.0\.1/);
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
  repo.close();
  rmSync(dir, { recursive: true, force: true });
});

function authArgs(): ReturnType<typeof parseArgs> {
  return parseArgs(['feishu-auth', '--member', '1', '--port', '0']);
}

describe('feishu-auth 本地回调', () => {
  it('收到合法回调后换 token、绑定成员并落盘', async () => {
    const context = makeContext();
    stubFeishu('ou_alice');

    const code = await runFeishuAuth(context, authArgs(), {
      timeoutMs: 5000,
      onReady: ({ port, state }) => {
        void hitCallback(port, `code=code-1&state=${state}`);
      },
    });

    expect(code).toBe(0);
    expect(repo.members.findById(1)?.feishuOpenId).toBe('ou_alice');
    const persisted = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      tokens: Record<string, FeishuTokenRecord>;
    };
    expect(persisted.tokens.ou_alice).toMatchObject({
      memberId: 1,
      name: 'Alice',
      accessToken: 'u-1',
      refreshToken: 'r-1',
    });
  });

  it('state 不匹配时拒绝授权（SDR-E201）', async () => {
    const context = makeContext();
    stubFeishu('ou_alice');

    const error = await runFeishuAuth(context, authArgs(), {
      timeoutMs: 5000,
      onReady: ({ port }) => {
        void hitCallback(port, 'code=code-1&state=forged');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.FEISHU_AUTH_FAILED });
    expect(repo.members.findById(1)?.feishuOpenId).toBe('ou_alice');
  });

  it('成员已绑定其他飞书账号时拒绝覆盖', async () => {
    const context = makeContext('ou_old');
    stubFeishu('ou_new');

    const error = await runFeishuAuth(context, authArgs(), {
      timeoutMs: 5000,
      onReady: ({ port, state }) => {
        void hitCallback(port, `code=code-1&state=${state}`);
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.FEISHU_AUTH_FAILED });
    expect(repo.members.findById(1)?.feishuOpenId).toBe('ou_old');
  });

  it('成员不存在时直接报用法错误，不启动授权流程', async () => {
    const context: CliContext = {
      ...makeContext(),
      repo,
    };
    await expect(
      runFeishuAuth(context, parseArgs(['feishu-auth', '--member', '99'])),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

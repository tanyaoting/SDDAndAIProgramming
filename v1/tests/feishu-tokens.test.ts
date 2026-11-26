import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../src/clock.js';
import { ERROR_CODES } from '../src/errors.js';
import {
  FeishuTokenStore,
  canRefresh,
  ensureFreshToken,
  needsRefresh,
  resolveTokenFilePath,
} from '../src/feishu-tokens.js';
import type { FeishuTokenRecord } from '../src/feishu-tokens.js';

const NOW = Date.parse('2026-11-26T10:00:00+08:00');
const clock = new FixedClock(new Date(NOW));
let dir: string;
let path: string;

function record(overrides: Partial<FeishuTokenRecord> = {}): FeishuTokenRecord {
  return {
    openId: 'ou_alice',
    memberId: 1,
    name: 'Alice',
    accessToken: 'u-1',
    refreshToken: 'r-1',
    expiresAt: NOW + 7_200_000,
    refreshExpiresAt: NOW + 604_800_000,
    scope: 'task:task:read offline_access',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sdr-tokens-'));
  path = join(dir, 'feishu-tokens.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('飞书 token 文件存储', () => {
  it('写入为 0600 并可按成员读取', () => {
    const store = new FeishuTokenStore(path);
    store.save(record());

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new FeishuTokenStore(path).findByMember(1)?.openId).toBe('ou_alice');
    expect(new FeishuTokenStore(path).list()).toHaveLength(1);
  });

  it('多条记录按成员 id 排序且互不覆盖', () => {
    const store = new FeishuTokenStore(path);
    store.save(record({ openId: 'ou_bob', memberId: 2, name: 'Bob' }));
    store.save(record());

    expect(store.list().map((item) => item.memberId)).toEqual([1, 2]);
    expect(store.findByMember(2)?.openId).toBe('ou_bob');
  });

  it('同一 open_id 重复保存时覆盖旧 token', () => {
    const store = new FeishuTokenStore(path);
    store.save(record());
    store.save(record({ accessToken: 'u-2' }));

    expect(store.list()).toHaveLength(1);
    expect(store.findByMember(1)?.accessToken).toBe('u-2');
  });

  it('文件损坏时报 SDR-E201 而不是静默丢 token', () => {
    writeFileSync(path, '{ not-json', 'utf8');
    expect(() => new FeishuTokenStore(path).list()).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.FEISHU_AUTH_FAILED }),
    );
  });

  it('token 文件路径默认落到 data/，绝对路径原样使用', () => {
    expect(resolveTokenFilePath({}, '/repo')).toBe(join('/repo', 'data/feishu-tokens.json'));
    expect(resolveTokenFilePath({ SDR_FEISHU_TOKEN_FILE: '/abs/t.json' }, '/repo')).toBe('/abs/t.json');
    expect(resolveTokenFilePath({ SDR_FEISHU_TOKEN_FILE: '  ' }, '/repo')).toBe(
      join('/repo', 'data/feishu-tokens.json'),
    );
  });

  it('提前 60 秒判定过期，refresh_token 需未过期才可续期', () => {
    expect(needsRefresh(record({ expiresAt: NOW + 61_000 }), NOW)).toBe(false);
    expect(needsRefresh(record({ expiresAt: NOW + 60_000 }), NOW)).toBe(true);
    expect(needsRefresh(record({ expiresAt: NOW - 1 }), NOW)).toBe(true);

    expect(canRefresh(record(), NOW)).toBe(true);
    expect(canRefresh(record({ refreshToken: '' }), NOW)).toBe(false);
    expect(canRefresh(record({ refreshExpiresAt: NOW }), NOW)).toBe(false);
  });
});

describe('ensureFreshToken 续期', () => {
  let mockAgent: MockAgent;
  let original: Dispatcher;

  beforeAll(() => {
    original = getGlobalDispatcher();
  });

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    setGlobalDispatcher(original);
    await mockAgent.close();
  });

  it('未到期不发起请求', async () => {
    const store = new FeishuTokenStore(path);
    const fresh = await ensureFreshToken(record(), {
      app: { appId: 'cli_test', appSecret: 'secret-value-123456' },
      clock,
      store,
    });
    expect(fresh.accessToken).toBe('u-1');
  });

  it('到期前刷新并回写新 refresh_token', async () => {
    mockAgent
      .get('https://accounts.feishu.cn')
      .intercept({ path: '/oauth/v3/token', method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          code: 0,
          access_token: 'u-new',
          expires_in: 7200,
          refresh_token: 'r-new',
          refresh_token_expires_in: 604800,
          scope: 'task:task:read offline_access',
        }),
      );

    const store = new FeishuTokenStore(path);
    store.save(record({ expiresAt: NOW + 1000 }));
    const fresh = await ensureFreshToken(record({ expiresAt: NOW + 1000 }), {
      app: { appId: 'cli_test', appSecret: 'secret-value-123456' },
      clock,
      store,
    });

    expect(fresh.accessToken).toBe('u-new');
    expect(fresh.refreshToken).toBe('r-new');
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      tokens: Record<string, FeishuTokenRecord>;
    };
    expect(persisted.tokens.ou_alice?.refreshToken).toBe('r-new');
  });

  it('refresh_token 过期时提示重新授权（SDR-E201）', async () => {
    await expect(
      ensureFreshToken(record({ expiresAt: NOW - 1, refreshExpiresAt: NOW - 1 }), {
        app: { appId: 'cli_test', appSecret: 'secret-value-123456' },
        clock,
        store: new FeishuTokenStore(path),
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FEISHU_AUTH_FAILED,
      message: expect.stringContaining('sdr feishu-auth --member 1'),
    });
  });
});

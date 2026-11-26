import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import {
  DEFAULT_FEISHU_SCOPE,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  refreshUserToken,
} from '../../src/collectors/feishu-oauth.js';
import { ERROR_CODES } from '../../src/errors.js';

const ACCOUNTS = 'https://accounts.feishu.cn';
const OPEN = 'https://open.feishu.cn';
const TOKEN_PATH = '/oauth/v3/token';
const USER_INFO_PATH = '/open-apis/authen/v1/user_info';
const noop = (): void => undefined;
const clock = new FixedClock(new Date('2026-11-26T10:00:00+08:00'));
const APP = { appId: 'cli_test', appSecret: 'secret-value-123456' };
const http = { clock, sleep: () => Promise.resolve(), logger: noop };

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

describe('飞书用户身份 OAuth', () => {
  it('授权页 URL 参数完整且经过编码', () => {
    const url = new URL(
      buildAuthorizeUrl({
        appId: 'cli_test',
        redirectUri: 'http://localhost:8787/callback?x=1',
        state: 'state-1',
      }),
    );
    expect(url.origin).toBe(ACCOUNTS);
    expect(url.pathname).toBe('/open-apis/authen/v1/authorize');
    expect(url.searchParams.get('client_id')).toBe('cli_test');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/callback?x=1');
    expect(url.searchParams.get('scope')).toBe(DEFAULT_FEISHU_SCOPE);
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('授权码换 token：按 expires_in 计算绝对过期时刻', async () => {
    mockAgent
      .get(ACCOUNTS)
      .intercept({ path: TOKEN_PATH, method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          code: 0,
          access_token: 'u-token',
          expires_in: 7200,
          refresh_token: 'r-token',
          refresh_token_expires_in: 604800,
          scope: 'task:task:read offline_access',
        }),
      );

    const token = await exchangeCode({
      app: APP,
      code: 'code-1',
      redirectUri: 'http://localhost:8787/callback',
      ...http,
    });

    expect(token).toMatchObject({
      accessToken: 'u-token',
      refreshToken: 'r-token',
      scope: 'task:task:read offline_access',
    });
    expect(token.expiresAt).toBe(clock.now().getTime() + 7_200_000);
    expect(token.refreshExpiresAt).toBe(clock.now().getTime() + 604_800_000);
  });

  it('刷新 token 失败时映射为 SDR-E201 并保留官方错误描述', async () => {
    mockAgent
      .get(ACCOUNTS)
      .intercept({ path: TOKEN_PATH, method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          code: 20037,
          error: 'invalid_grant',
          error_description: 'refresh token expired',
        }),
      );

    const error = await refreshUserToken({
      app: APP,
      refreshToken: 'r-old',
      ...http,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.FEISHU_AUTH_FAILED });
    expect((error as Error).message).toContain('refresh token expired');
  });

  it('未开通 offline_access（无 refresh_token）时换 token 报错', async () => {
    mockAgent
      .get(ACCOUNTS)
      .intercept({ path: TOKEN_PATH, method: 'POST' })
      .reply(200, JSON.stringify({ code: 0, access_token: 'u-1', expires_in: 7200 }));

    const error = await refreshUserToken({
      app: APP,
      refreshToken: 'r-old',
      ...http,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: ERROR_CODES.FEISHU_AUTH_FAILED });
  });

  it('读取用户信息返回 open_id 与姓名', async () => {
    mockAgent
      .get(OPEN)
      .intercept({ path: USER_INFO_PATH, method: 'GET' })
      .reply(200, JSON.stringify({ code: 0, msg: 'success', data: { open_id: 'ou_alice', name: 'Alice' } }));

    await expect(fetchUserInfo({ accessToken: 'u-token', ...http })).resolves.toEqual({
      openId: 'ou_alice',
      name: 'Alice',
    });
  });

  it('用户信息缺少 open_id 时映射为 SDR-E201', async () => {
    mockAgent
      .get(OPEN)
      .intercept({ path: USER_INFO_PATH, method: 'GET' })
      .reply(200, JSON.stringify({ code: 20005, msg: 'invalid token', data: {} }));

    await expect(fetchUserInfo({ accessToken: 'bad', ...http })).rejects.toMatchObject({
      code: ERROR_CODES.FEISHU_AUTH_FAILED,
    });
  });
});

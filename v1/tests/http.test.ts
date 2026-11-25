import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpError, maskSecrets, request } from '../src/http.js';

const BASE = 'https://api.example.com';
const noop = (): void => undefined;

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

describe('T-005 HTTP 客户端封装', () => {
  it('超时按 1/2/4 秒退避重试 3 次后抛网络层错误', async () => {
    const pool = mockAgent.get(BASE);
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: '/slow', method: 'GET' }).reply(200, 'ok').delay(100);
    }
    const waits: number[] = [];

    await expect(
      request(`${BASE}/slow`, {
        timeoutMs: 10,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        logger: noop,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });

    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('400/401/403/404 不重试，直接返回响应', async () => {
    const pool = mockAgent.get(BASE);
    const statuses = [400, 401, 403, 404];
    for (const status of statuses) {
      pool.intercept({ path: `/s${status}`, method: 'GET' }).reply(status, 'nope');
    }
    const waits: number[] = [];

    for (const status of statuses) {
      const response = await request(`${BASE}/s${status}`, {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        logger: noop,
      });
      expect(response.status).toBe(status);
      expect(response.body).toBe('nope');
    }

    expect(waits).toEqual([]);
    mockAgent.assertNoPendingInterceptors();
  });

  it('5xx 重试 3 次后返回最后一次响应（由调用方分类）', async () => {
    const pool = mockAgent.get(BASE);
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: '/fail', method: 'GET' }).reply(503, 'down');
    }
    const waits: number[] = [];

    const response = await request(`${BASE}/fail`, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      logger: noop,
    });

    expect(response.status).toBe(503);
    expect(response.body).toBe('down');
    expect(waits).toEqual([1000, 2000, 4000]);
    mockAgent.assertNoPendingInterceptors();
  });

  it('408 与 429 属于可重试状态码', async () => {
    const pool = mockAgent.get(BASE);
    for (const path of ['/t408', '/t429']) {
      pool.intercept({ path, method: 'GET' }).reply(path === '/t408' ? 408 : 429, '');
      pool.intercept({ path, method: 'GET' }).reply(200, 'ok');
    }
    const waits: number[] = [];

    for (const path of ['/t408', '/t429']) {
      const response = await request(`${BASE}${path}`, {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        logger: noop,
      });
      expect(response.status).toBe(200);
    }

    expect(waits).toEqual([1000, 1000]);
  });

  it('网络错误重试 3 次后抛 kind=network', async () => {
    const pool = mockAgent.get(BASE);
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: '/net', method: 'GET' }).replyWithError(new Error('socket hang up'));
    }
    const waits: number[] = [];

    await expect(
      request(`${BASE}/net`, {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        logger: noop,
      }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('日志中的令牌被掩码（>8 位整体替换）', async () => {
    const pool = mockAgent.get(BASE);
    const secret = 'ghp_SECRETTOKEN123456';
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: `/leak?token=${secret}`, method: 'GET' }).reply(500, '');
    }
    const lines: string[] = [];

    await request(`${BASE}/leak?token=${secret}`, {
      secrets: [secret],
      sleep: () => Promise.resolve(),
      logger: (line) => lines.push(line),
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes('***'))).toBe(true);
    expect(lines.every((line) => !line.includes(secret))).toBe(true);
  });

  it('maskSecrets 只替换长度大于 8 的敏感串', () => {
    expect(maskSecrets('token=abcdefghijklmnop 结束', ['abcdefghijklmnop'])).toBe('token=*** 结束');
    expect(maskSecrets('short', ['short'])).toBe('short');
    expect(maskSecrets('无敏感串')).toBe('无敏感串');
  });
});

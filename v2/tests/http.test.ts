import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { ERROR_CODES } from '../src/errors.js';
import {
  HttpResponseError,
  createHttpClient,
  paginatePages,
  type HttpClient,
} from '../src/http.js';

describe('requestJson', () => {
  let agent: MockAgent;
  let client: HttpClient;
  const sleepCalls: number[] = [];
  const logLines: string[] = [];

  const sleep = async (ms: number): Promise<void> => {
    sleepCalls.push(ms);
  };

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    client = createHttpClient({ sleep, onLog: (line) => logLines.push(line) });
    sleepCalls.length = 0;
    logLines.length = 0;
  });

  afterEach(async () => {
    await agent.close();
  });

  it('解析 200 JSON 响应', async () => {
    const pool = agent.get('https://api.example.com');
    pool
      .intercept({ path: '/ok', method: 'GET' })
      .reply(200, { hello: 'world' }, { headers: { 'content-type': 'application/json' } });

    const body = await client.requestJson<{ hello: string }>('https://api.example.com/ok', {});
    expect(body).toEqual({ hello: 'world' });
  });

  it('401 不重试并抛出 HttpResponseError', async () => {
    const pool = agent.get('https://api.example.com');
    pool.intercept({ path: '/unauth', method: 'GET' }).reply(401, { message: 'bad token' });

    await expect(
      client.requestJson('https://api.example.com/unauth', { token: 'ghp_secret_token_value' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(sleepCalls).toHaveLength(0);
  });

  it('500 恰好重试 3 次，退避 1s/2s/4s', async () => {
    let hits = 0;
    const retryClient = createHttpClient({
      sleep,
      fetchImpl: async () => {
        hits += 1;
        return new Response('err', { status: 500 });
      },
    });

    await expect(retryClient.requestJson('https://api.example.com/flaky', {})).rejects.toBeInstanceOf(
      HttpResponseError,
    );
    expect(hits).toBe(4);
    expect(sleepCalls).toEqual([1000, 2000, 4000]);
  });

  it('429 在重试后成功', async () => {
    let hits = 0;
    const retryClient = createHttpClient({
      sleep,
      fetchImpl: async () => {
        hits += 1;
        if (hits < 3) return new Response('slow down', { status: 429 });
        return Response.json({ ok: true });
      },
    });

    const body = await retryClient.requestJson<{ ok: boolean }>('https://api.example.com/rate', {});
    expect(body).toEqual({ ok: true });
    expect(hits).toBe(3);
    expect(sleepCalls).toEqual([1000, 2000]);
  });

  it('网络错误按可重试策略退避', async () => {
    let hits = 0;
    const retryClient = createHttpClient({
      sleep,
      fetchImpl: async () => {
        hits += 1;
        if (hits < 2) throw new TypeError('fetch failed');
        return Response.json({ recovered: true });
      },
    });

    const body = await retryClient.requestJson<{ recovered: boolean }>(
      'https://api.example.com/net',
      {},
    );
    expect(body).toEqual({ recovered: true });
    expect(sleepCalls).toEqual([1000]);
  });

  it('日志中掩码长度大于 8 的 token', async () => {
    const pool = agent.get('https://api.example.com');
    pool.intercept({ path: '/t', method: 'GET' }).reply(200, { ok: true });

    await client.requestJson('https://api.example.com/t', {
      token: '12345678901',
      headers: { authorization: 'Bearer 12345678901' },
    });

    const joined = logLines.join('\n');
    expect(joined).not.toContain('12345678901');
    expect(joined).toContain('token=123****901');
  });

  it('404 不重试', async () => {
    const pool = agent.get('https://api.example.com');
    let hits = 0;
    pool.intercept({ path: '/missing', method: 'GET' }).reply(() => {
      hits += 1;
      return { statusCode: 404, data: 'nope' };
    });

    await expect(client.requestJson('https://api.example.com/missing', {})).rejects.toMatchObject({
      status: 404,
    });
    expect(hits).toBe(1);
    expect(sleepCalls).toHaveLength(0);
  });
});

describe('paginatePages', () => {
  it('合并各页 items', async () => {
    const pages = [
      { items: [1, 2], hasNext: true },
      { items: [3], hasNext: false },
    ];
    let page = 0;
    const all = await paginatePages({
      fetchPage: async (p) => {
        expect(p).toBe(page + 1);
        const chunk = pages[page];
        page += 1;
        return chunk!;
      },
    });
    expect(all).toEqual([1, 2, 3]);
  });

  it('第 maxPages 页仍 hasNext 时抛 SDR-E104', async () => {
    await expect(
      paginatePages({
        maxPages: 2,
        fetchPage: async () => ({ items: ['x'], hasNext: true }),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_PAGINATION_OVERFLOW });
  });

  it('不返回部分结果：超限前已拉取页也不透出', async () => {
    let calls = 0;
    await expect(
      paginatePages({
        maxPages: 1,
        fetchPage: async () => {
          calls += 1;
          return { items: ['partial'], hasNext: true };
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
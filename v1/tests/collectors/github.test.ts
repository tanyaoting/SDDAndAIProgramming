import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toZonedIsoString } from '../../src/clock.js';
import { FixedClock } from '../../src/clock.js';
import { collectGithub } from '../../src/collectors/github.js';
import type { GithubCollectOptions } from '../../src/collectors/github.js';
import { ERROR_CODES } from '../../src/errors.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const BASE = 'https://api.github.com';
const noop = (): void => undefined;
const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

function makeOptions(overrides: Partial<GithubCollectOptions> = {}): GithubCollectOptions {
  return {
    repo: 'acme/app',
    since: new Date('2026-11-25T00:00:00+08:00'),
    until: new Date('2026-11-26T00:00:00+08:00'),
    token: 'ghp_testtoken123456',
    runId: 'run-1',
    clock,
    resolveMemberId: (login) => (login === 'alice' ? 1 : login === 'bob' ? 2 : undefined),
    sleep: () => Promise.resolve(),
    logger: noop,
    timeoutMs: 1000,
    ...overrides,
  };
}

function commit(sha: string, login = 'alice'): unknown {
  return {
    sha,
    author: { login },
    commit: {
      message: `feat: ${sha}`,
      author: { name: login, email: `${login}@example.com`, date: '2026-11-25T09:30:00Z' },
    },
  };
}

function pageBody(count: number, offset = 0): string {
  return JSON.stringify(
    Array.from({ length: count }, (_unused, index) => commit(`sha-${offset + index}`)),
  );
}

const LINK_NEXT = '<https://api.github.com/repositories/1/commits?page=2>; rel="next"';

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

describe('T-006 GitHub 提交采集器', () => {
  it('固定 fixture 产出预期条数并按作者映射成员（外部作者跳过）', async () => {
    const body = readFileSync(join(FIXTURE_DIR, 'github_commits.json'), 'utf8');
    mockAgent
      .get(BASE)
      .intercept({ path: /\/repos\/acme\/app\/commits/, method: 'GET' })
      .reply(200, body, { headers: { 'content-type': 'application/json' } });

    const events = await collectGithub(makeOptions());

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sourceId)).toEqual(['a1b2c3d4e5f6', 'b2c3d4e5f6a1']);
    expect(events.map((event) => event.memberId)).toEqual([1, 2]);

    const first = events[0];
    expect(first).toMatchObject({
      source: 'github',
      kind: 'commit',
      title: 'feat: 实现登录接口',
      detail: '补充鉴权单元测试',
      isPrimary: true,
      runId: 'run-1',
    });
    expect(toZonedIsoString(clock, first?.occurredAt as Date)).toBe('2026-11-25T17:30:00.000+08:00');
    expect(first?.dedupeKey).toBe(
      createHash('sha1').update('a1b2c3d4e5f62026-11-251').digest('hex'),
    );
  });

  it('401 映射为令牌失效 SDR-E101', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: /\/commits/, method: 'GET' })
      .reply(401, '{"message":"Bad credentials"}');

    await expect(collectGithub(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.GITHUB_TOKEN_INVALID,
    });
  });

  it('403 + 限流头映射为 SDR-E102', async () => {
    mockAgent
      .get(BASE)
      .intercept({ path: /\/commits/, method: 'GET' })
      .reply(403, '{"message":"rate limit"}', { headers: { 'x-ratelimit-remaining': '0' } });

    await expect(collectGithub(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.GITHUB_RATE_LIMITED,
    });
  });

  it('429 映射为限流 SDR-E102（http 层重试耗尽后返回）', async () => {
    const pool = mockAgent.get(BASE);
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: /\/commits/, method: 'GET' }).reply(429, '');
    }

    await expect(collectGithub(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.GITHUB_RATE_LIMITED,
    });
  });

  it('超时映射为 SDR-E103（重试由 http 层完成）', async () => {
    const pool = mockAgent.get(BASE);
    for (let i = 0; i < 4; i += 1) {
      pool.intercept({ path: /\/commits/, method: 'GET' }).reply(200, '[]').delay(50);
    }

    await expect(collectGithub(makeOptions({ timeoutMs: 10 }))).rejects.toMatchObject({
      code: ERROR_CODES.GITHUB_TIMEOUT,
    });
  });

  it('250 条跨 3 页返回全部事件', async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: /\/commits/, method: 'GET' })
      .reply(200, pageBody(100, 0), { headers: { link: LINK_NEXT } });
    pool
      .intercept({ path: /\/commits/, method: 'GET' })
      .reply(200, pageBody(100, 100), { headers: { link: LINK_NEXT } });
    pool.intercept({ path: /\/commits/, method: 'GET' }).reply(200, pageBody(50, 200));

    const events = await collectGithub(makeOptions());

    expect(events).toHaveLength(250);
    expect(new Set(events.map((event) => event.sourceId)).size).toBe(250);
  });

  it('达到 20 页上限仍有 next 时抛 SDR-E104，不返回部分结果', async () => {
    const pool = mockAgent.get(BASE);
    for (let page = 0; page < 20; page += 1) {
      pool
        .intercept({ path: /\/commits/, method: 'GET' })
        .reply(200, pageBody(100, page * 100), { headers: { link: LINK_NEXT } });
    }

    await expect(collectGithub(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.GITHUB_PAGINATION_OVERFLOW,
    });
  });
});

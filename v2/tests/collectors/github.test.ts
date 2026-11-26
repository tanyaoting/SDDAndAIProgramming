import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { FixedClock, dayWindow, toZonedIsoString } from '../../src/clock.js';
import { ERROR_CODES } from '../../src/errors.js';
import { createHttpClient } from '../../src/http.js';
import { collectGithub } from '../../src/collectors/github.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const sampleCommits = JSON.parse(
  readFileSync(join(fixtureDir, 'github_commits.json'), 'utf8'),
) as unknown[];

describe('collectGithub', () => {
  const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
  const { since, until } = dayWindow(clock, '2026-11-25');
  const runId = 'run-github-1';

  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await agent.close();
  });

  it('fixture 提交映射为 Event', async () => {
    const pool = agent.get('https://api.github.com');
    pool
      .intercept({ path: /\/repos\/acme\/sdr\/commits/, method: 'GET' })
      .reply(200, sampleCommits, { headers: { 'content-type': 'application/json' } });

    const http = createHttpClient();
    const events = await collectGithub({
      repo: 'acme/sdr',
      since,
      until,
      token: 'test-token',
      clock,
      memberId: 1,
      runId,
      http,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: 'github',
      sourceId: 'aaa111',
      kind: 'commit',
      memberId: 1,
      isPrimary: true,
      runId,
    });
    expect(toZonedIsoString(clock, events[0]!.occurredAt)).toMatch(/\+08:00$/);
  });

  it('401 映射 SDR-E101', async () => {
    const pool = agent.get('https://api.github.com');
    pool.intercept({ path: /\/repos\/acme\/sdr\/commits/, method: 'GET' }).reply(401, {});

    await expect(
      collectGithub({
        repo: 'acme/sdr',
        since,
        until,
        token: 'bad',
        clock,
        memberId: 1,
        runId,
        http: createHttpClient(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_TOKEN_INVALID });
  });

  it('403 且限流头映射 SDR-E102', async () => {
    const pool = agent.get('https://api.github.com');
    pool
      .intercept({ path: /\/repos\/acme\/sdr\/commits/, method: 'GET' })
      .reply(403, {}, { headers: { 'x-ratelimit-remaining': '0' } });

    await expect(
      collectGithub({
        repo: 'acme/sdr',
        since,
        until,
        token: 'ok',
        clock,
        memberId: 1,
        runId,
        http: createHttpClient(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_RATE_LIMITED });
  });

  it('超时映射 SDR-E103', async () => {
    const http = createHttpClient({
      sleep: async () => undefined,
      fetchImpl: async () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    });

    await expect(
      collectGithub({
        repo: 'acme/sdr',
        since,
        until,
        token: 'ok',
        clock,
        memberId: 1,
        runId,
        http,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_TIMEOUT });
  });

  it('分页超限抛 SDR-E104', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      sha: `sha-${String(index)}`,
      commit: {
        message: 'bulk',
        author: { date: '2026-11-25T02:00:00Z' },
      },
    }));
    const http = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fullPage), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });

    await expect(
      collectGithub({
        repo: 'acme/sdr',
        since,
        until,
        token: 'ok',
        clock,
        memberId: 1,
        runId,
        http,
        maxPages: 1,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_PAGINATION_OVERFLOW });
  });

  it('非法 repo 格式拒绝', async () => {
    await expect(
      collectGithub({
        repo: 'not-a-valid-repo',
        since,
        until,
        token: 'ok',
        clock,
        memberId: 1,
        runId,
        http: createHttpClient(),
      }),
    ).rejects.toThrow();
  });
});
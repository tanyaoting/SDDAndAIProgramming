import { platform, release } from 'node:os';
import type { Dispatcher } from 'undici';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { runCollect } from '../../src/cli/collect.js';
import { runGenerate } from '../../src/cli/generate.js';
import { findSummaryRows, renderTeamSummary } from '../../src/generator/summary.js';
import { createHarness, seedMember } from './helpers.js';
import type { Harness } from './helpers.js';

/**
 * 性能实测（T-022）：CS-11 单成员单日（三源采集 + 生成）≤ 30 秒，
 * CS-12 团队汇总（10 人）≤ 60 秒。数据在进程内生成，指标只反映本机处理开销。
 */

const GITHUB = 'https://api.github.com';
const FEISHU = 'https://open.feishu.cn';

let mockAgent: MockAgent;
let original: Dispatcher;
let harness: Harness;

function stubSources(): void {
  mockAgent
    .get(GITHUB)
    .intercept({ path: /\/repos\/acme\/app\/commits/, method: 'GET' })
    .reply(
      200,
      JSON.stringify([
        {
          sha: 'sha-perf',
          html_url: 'https://github.com/acme/app/commit/sha-perf',
          author: { login: 'alice' },
          commit: {
            message: '完成性能样例',
            author: { name: 'alice', email: 'alice@example.com', date: '2026-11-25T09:30:00+08:00' },
          },
        },
      ]),
    );
  const feishu = mockAgent.get(FEISHU);
  feishu
    .intercept({ path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST' })
    .reply(200, JSON.stringify({ code: 0, tenant_access_token: 't-perf' }));
  feishu
    .intercept({ path: /\/open-apis\/task\/v2\/tasks/, method: 'GET' })
    .reply(
      200,
      JSON.stringify({
        code: 0,
        data: {
          items: [
            {
              guid: 'task-perf',
              summary: '完成任务拆解',
              status: 'done',
              completed_at: String(Date.parse('2026-11-25T10:00:00+08:00')),
              assignee: { open_id: 'ou_alice' },
            },
          ],
          has_more: false,
        },
      }),
    );
}

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  stubSources();
  harness = createHarness();
  seedMember(harness.db, { id: 1, login: 'alice', name: 'Alice', feishuOpenId: 'ou_alice' });
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
  harness.repo.close();
});

describe('T-022 性能指标', () => {
  it('CS-11 单成员单日（三源采集 + 生成）≤ 30 秒', async () => {
    const startedAt = performance.now();
    await runCollect(
      harness.context,
      parseArgs([
        'collect',
        '--date',
        '2026-11-25',
        '--repo',
        'acme/app',
        '--member',
        '1',
        '--manual',
        '补充联调结论',
        '--ref',
        '飞书群聊 11-25 11:00',
      ]),
    );
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25', '--member', '1']));
    const elapsedMs = performance.now() - startedAt;
    console.log(
      `[T-022] CS-11 耗时 ${elapsedMs.toFixed(1)}ms（Node ${process.version} / ${platform()} ${release()}）`,
    );
    expect(elapsedMs).toBeLessThan(30_000);
    expect(harness.repo.findReport(1, '2026-11-25')?.status).toBe('draft');
  });

  it('CS-12 团队汇总（10 人）≤ 60 秒', () => {
    for (let id = 2; id <= 10; id += 1) {
      seedMember(harness.db, { id, login: `member${id}`, name: `成员${id}` });
    }
    const startedAt = performance.now();
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25']));
    const summary = renderTeamSummary(findSummaryRows(harness.repo, '2026-11-25'), '2026-11-25');
    const elapsedMs = performance.now() - startedAt;
    console.log(`[T-022] CS-12 耗时 ${elapsedMs.toFixed(1)}ms（10 人）`);
    expect(elapsedMs).toBeLessThan(60_000);
    expect(summary).toContain('成员10');
  });
});

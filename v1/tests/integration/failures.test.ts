import type { Dispatcher } from 'undici';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { runCollect } from '../../src/cli/collect.js';
import { runPush } from '../../src/cli/push.js';
import { collectGithub } from '../../src/collectors/github.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { Scheduler } from '../../src/publisher/scheduler.js';
import { createHarness, seedMember } from './helpers.js';
import type { Harness } from './helpers.js';

/** 失败路径与原子性（T-021）：CS-07 / CS-08 / CS-17 + 四表事务回滚。 */

const GITHUB = 'https://api.github.com';
const FEISHU = 'https://open.feishu.cn';
const noop = (): void => undefined;

let mockAgent: MockAgent;
let original: Dispatcher;
let harness: Harness;

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  harness = createHarness();
  seedMember(harness.db, { id: 1, login: 'alice', name: 'Alice', feishuOpenId: 'ou_alice' });
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
  harness.repo.close();
});

function feishuOk(): void {
  const feishu = mockAgent.get(FEISHU);
  feishu
    .intercept({ path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST' })
    .reply(200, JSON.stringify({ code: 0, tenant_access_token: 't-1' }));
  feishu
    .intercept({ path: /\/open-apis\/task\/v2\/tasks/, method: 'GET' })
    .reply(200, JSON.stringify({ code: 0, data: { items: [], has_more: false } }));
}

describe('CS-07 凭证失效与告警', () => {
  it('GitHub 401 标注 SDR-E101 并告警，飞书采集不中断', async () => {
    mockAgent
      .get(GITHUB)
      .intercept({ path: /\/repos\/acme\/app\/commits/, method: 'GET' })
      .reply(401, JSON.stringify({ message: 'Bad credentials' }));
    feishuOk();

    const summary = await runCollect(
      harness.context,
      parseArgs([
        'collect',
        '--date',
        '2026-11-25',
        '--source',
        'github',
        '--source',
        'feishu',
        '--repo',
        'acme/app',
      ]),
    );

    expect(summary).toMatchObject({ ok: 1, failed: 1 });
    expect(harness.errors.join('\n')).toContain('SDR-E101');
    expect(harness.mailer.sent).toHaveLength(1);
    expect(harness.mailer.sent[0]?.subject).toContain('SDR-E101');

    const runs = harness.db
      .prepare('SELECT source, result, error_code FROM ingestion_run ORDER BY source')
      .all() as { source: string; result: string; error_code: string | null }[];
    expect(runs).toEqual([
      { source: 'feishu', result: 'ok', error_code: null },
      { source: 'github', result: 'failed', error_code: 'SDR-E101' },
    ]);
  });
});

describe('CS-17 外部 API 超时', () => {
  it('超时映射 SDR-E103，且不返回部分结果', async () => {
    mockAgent
      .get(GITHUB)
      .intercept({ path: /\/repos\/acme\/app\/commits/, method: 'GET' })
      .reply(200, '[]')
      .delay(120);

    await expect(
      collectGithub({
        repo: 'acme/app',
        since: new Date('2026-11-25T00:00:00+08:00'),
        until: new Date('2026-11-26T00:00:00+08:00'),
        token: 'ghp_token',
        runId: 'run-timeout',
        clock: harness.context.clock,
        resolveMemberId: () => 1,
        sleep: () => Promise.resolve(),
        logger: noop,
        timeoutMs: 20,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.GITHUB_TIMEOUT });
  });
});

describe('CS-08 调度补发与 push_log 去重', () => {
  it('错过时点后补发一次，再次 tick 不重复发送', async () => {
    const late = createHarness('2026-11-25T18:03:00+08:00');
    seedMember(late.db, { id: 1, login: 'alice', name: 'Alice' });
    late.repo.saveReportBundle({
      memberId: 1,
      reportDate: '2026-11-25',
      status: 'draft',
      body: '',
      entries: [
        {
          timeBlock: 'morning',
          state: 'done',
          content: '完成登录接口开发',
          orderIndex: 0,
          isManual: false,
          attributionKind: 'author',
          attributionConfirmed: true,
          members: [{ memberId: 1, role: 'primary' }],
          links: [{ linkType: 'url', target: 'https://github.com/acme/app/commit/sha-1' }],
        },
      ],
    });

    const scheduler = new Scheduler({
      clock: late.context.clock,
      pushTime: () => '18:00',
      hasPushed: (date) => late.repo.audit.hasSuccessfulPush(date),
      push: async (date) => {
        await runPush(late.context, parseArgs(['push', '--date', date]));
      },
      logger: noop,
    });

    expect(await scheduler.tick()).toMatchObject({ pushed: true, catchUp: true });
    expect(late.repo.audit.findPushes('2026-11-25')).toMatchObject([{ result: 'ok' }]);
    expect(await scheduler.tick()).toMatchObject({ pushed: false, reason: 'already-pushed' });
    expect(late.mailer.sent).toHaveLength(1);
    late.repo.close();
  });
});

describe('四表原子写入（E501）', () => {
  it('entry_member 主键冲突时整体回滚，不留半份日报', () => {
    expect(() =>
      harness.repo.saveReportBundle({
        memberId: 1,
        reportDate: '2026-11-25',
        status: 'draft',
        body: '',
        entries: [
          {
            timeBlock: 'morning',
            state: 'done',
            content: '完成登录接口开发',
            orderIndex: 0,
            isManual: false,
            attributionKind: 'author',
            attributionConfirmed: true,
            members: [
              { memberId: 1, role: 'primary' },
              { memberId: 1, role: 'co' },
            ],
            links: [{ linkType: 'url', target: 'https://example.com/1' }],
          },
        ],
      }),
    ).toThrow(SdrError);

    const reports = (harness.db.prepare('SELECT COUNT(*) AS n FROM report').get() as { n: number }).n;
    const entries = (harness.db.prepare('SELECT COUNT(*) AS n FROM entry').get() as { n: number }).n;
    expect(reports).toBe(0);
    expect(entries).toBe(0);
  });
});

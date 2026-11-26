import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import type { Dispatcher } from 'undici';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { collectFeishu, collectFeishuWithToken, mapFeishuStatus } from '../../src/collectors/feishu.js';
import type { FeishuCollectOptions } from '../../src/collectors/feishu.js';
import { ERROR_CODES } from '../../src/errors.js';

const BASE = 'https://open.feishu.cn';
const TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TASKS_PATH = /\/open-apis\/task\/v2\/tasks/;
const noop = (): void => undefined;
const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
const IN_WINDOW = Date.parse('2026-11-25T10:00:00+08:00');

function makeOptions(overrides: Partial<FeishuCollectOptions> = {}): FeishuCollectOptions {
  return {
    appId: 'cli_test',
    appSecret: 'secret-value-123456',
    since: new Date('2026-11-25T00:00:00+08:00'),
    until: new Date('2026-11-26T00:00:00+08:00'),
    runId: 'run-1',
    clock,
    resolveMemberId: (openId) => (openId === 'ou_alice' ? 1 : undefined),
    sleep: () => Promise.resolve(),
    logger: noop,
    ...overrides,
  };
}

type Pool = ReturnType<MockAgent['get']>;

function tokenReply(pool: Pool, code = 0): void {
  pool
    .intercept({ path: TOKEN_PATH, method: 'POST' })
    .reply(200, JSON.stringify({ code, msg: code === 0 ? 'ok' : 'auth failed', tenant_access_token: 't-123' }));
}

function tasksReply(pool: Pool, items: readonly unknown[], code = 0): void {
  pool
    .intercept({ path: TASKS_PATH, method: 'GET' })
    .reply(200, JSON.stringify({ code, msg: 'ok', data: { items, has_more: false } }));
}

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

describe('T-007 飞书任务采集器', () => {
  it('状态映射逐条断言：完成→done，未知→doing', () => {
    expect(mapFeishuStatus('done')).toBe('done');
    expect(mapFeishuStatus('completed')).toBe('done');
    expect(mapFeishuStatus('完成')).toBe('done');
    expect(mapFeishuStatus('in_progress')).toBe('doing');
    expect(mapFeishuStatus('whatever')).toBe('doing');
    expect(mapFeishuStatus(undefined)).toBe('doing');
  });

  it('采集窗口内任务并映射成员，辅助源不设主源标记', async () => {
    const pool = mockAgent.get(BASE);
    tokenReply(pool);
    tasksReply(pool, [
      {
        guid: 't1',
        summary: '完成登录联调',
        status: 'completed',
        completed_at: String(IN_WINDOW),
        assignee: { open_id: 'ou_alice' },
      },
      {
        guid: 't2',
        summary: '进行中的任务',
        status: 'in_progress',
        updated_at: String(IN_WINDOW + 3600_000),
        assignee: { open_id: 'ou_alice' },
      },
      {
        guid: 't3',
        summary: '窗口外任务',
        status: 'completed',
        completed_at: String(Date.parse('2026-11-20T10:00:00+08:00')),
        assignee: { open_id: 'ou_alice' },
      },
      {
        guid: 't4',
        summary: '非团队成员',
        status: 'completed',
        completed_at: String(IN_WINDOW),
        assignee: { open_id: 'ou_other' },
      },
    ]);

    const events = await collectFeishu(makeOptions());

    expect(events.map((event) => event.sourceId)).toEqual(['t1', 't2']);
    expect(events[0]).toMatchObject({
      source: 'feishu',
      kind: 'task_done',
      memberId: 1,
      title: '完成登录联调',
      isPrimary: false,
      runId: 'run-1',
      payload: { status: 'completed', state: 'done' },
    });
    expect(events[1]?.payload).toMatchObject({ state: 'doing' });
  });

  it('鉴权响应 code 非 0 映射为 SDR-E201', async () => {
    tokenReply(mockAgent.get(BASE), 99991663);
    await expect(collectFeishu(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.FEISHU_AUTH_FAILED,
    });
  });

  it('任务接口 code 非 0 映射为 SDR-E201', async () => {
    const pool = mockAgent.get(BASE);
    tokenReply(pool);
    tasksReply(pool, [], 99991663);
    await expect(collectFeishu(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.FEISHU_AUTH_FAILED,
    });
  });

  it('任务字段缺失映射为 SDR-E202', async () => {
    const pool = mockAgent.get(BASE);
    tokenReply(pool);
    tasksReply(pool, [
      { guid: 't1', status: 'completed', completed_at: String(IN_WINDOW) },
    ]);
    await expect(collectFeishu(makeOptions())).rejects.toMatchObject({
      code: ERROR_CODES.FEISHU_FIELD_MISSING,
    });
  });

  it('用户身份路径直接使用传入 token，不再申请 tenant_access_token', async () => {
    tasksReply(mockAgent.get(BASE), [
      {
        guid: 't9',
        summary: '用户身份任务',
        status: 'completed',
        completed_at: String(IN_WINDOW),
        assignee: { open_id: 'ou_alice' },
      },
    ]);

    const events = await collectFeishuWithToken({
      accessToken: 'u-token-123',
      since: new Date('2026-11-25T00:00:00+08:00'),
      until: new Date('2026-11-26T00:00:00+08:00'),
      runId: 'run-2',
      clock,
      resolveMemberId: (openId) => (openId === 'ou_alice' ? 1 : undefined),
      sleep: () => Promise.resolve(),
      logger: noop,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sourceId: 't9', memberId: 1, runId: 'run-2' });
  });
});

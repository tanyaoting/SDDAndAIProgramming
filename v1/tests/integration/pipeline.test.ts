import type { Dispatcher } from 'undici';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { runCollect } from '../../src/cli/collect.js';
import { runGenerate } from '../../src/cli/generate.js';
import { runPush } from '../../src/cli/push.js';
import { queryHistory, renderHistory } from '../../src/history.js';
import { findSummaryRows, renderTeamSummary } from '../../src/generator/summary.js';
import type { Entry } from '../../src/types.js';
import { createHarness, seedMember } from './helpers.js';
import type { Harness } from './helpers.js';

/** 端到端集成（T-021）：固定数据 → 采集 → 生成 → --dry-run 推送，全程无真实网络。 */

const GITHUB = 'https://api.github.com';
const FEISHU = 'https://open.feishu.cn';

function commit(sha: string, login: string, date: string, message: string): unknown {
  return {
    sha,
    html_url: `https://github.com/acme/app/commit/${sha}`,
    author: { login },
    commit: { message, author: { name: login, email: `${login}@example.com`, date } },
  };
}

const COMMITS_25 = [
  commit('sha-1', 'alice', '2026-11-25T09:30:00+08:00', '完成登录接口开发\n\nCo-authored-by: Bob <bob@example.com>'),
  commit('sha-2', 'alice', '2026-11-25T14:00:00+08:00', '联调任务接口'),
  commit('sha-3', 'bob', '2026-11-25T19:30:00+08:00', '完成部署'),
  commit('sha-0', 'bob', '2026-11-25T15:59:59Z', '收官修复'),
];
const COMMITS_26 = [commit('sha-4', 'alice', '2026-11-25T16:30:00Z', '跨日提交')];

const TASKS = [
  {
    guid: 'task-1',
    summary: '修复分页缺陷',
    status: 'done',
    completed_at: String(Date.parse('2026-11-25T10:00:00+08:00')),
    created_at: String(Date.parse('2026-11-24T09:00:00+08:00')),
    assignee: { open_id: 'ou_alice' },
  },
  {
    guid: 'task-2',
    summary: '准备演示',
    status: 'todo',
    updated_at: String(Date.parse('2026-11-25T15:00:00+08:00')),
    created_at: String(Date.parse('2026-11-25T08:00:00+08:00')),
    assignee: { open_id: 'ou_bob' },
  },
];

let mockAgent: MockAgent;
let original: Dispatcher;
let harness: Harness;

function seed(): void {
  seedMember(harness.db, { id: 1, login: 'alice', name: 'Alice', feishuOpenId: 'ou_alice' });
  seedMember(harness.db, { id: 2, login: 'bob', name: 'Bob', managerId: 1, feishuOpenId: 'ou_bob' });
  seedMember(harness.db, { id: 3, login: 'carol', name: 'Carol' });
}

function collectArgs(date: string, extra: string[] = []): string[] {
  return [
    'collect',
    '--date',
    date,
    '--source',
    'github',
    '--source',
    'feishu',
    '--source',
    'manual',
    '--repo',
    'acme/app',
    '--member',
    '1',
    '--manual',
    '完成登录接口开发',
    '--ref',
    '飞书群聊 11-25 10:00 与 Bob 讨论',
    ...extra,
  ];
}

function entryByContent(entries: readonly Entry[], text: string): Entry {
  const found = entries.find((entry) => entry.content === text);
  if (found === undefined) throw new Error(`未找到条目：${text}`);
  return found;
}

function countEvents(): number {
  return (harness.db.prepare('SELECT COUNT(*) AS n FROM event').get() as { n: number }).n;
}

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const github = mockAgent.get(GITHUB);
  github
    .intercept({ path: /since=2026-11-24T16%3A00%3A00.000Z/, method: 'GET' })
    .reply(200, JSON.stringify(COMMITS_25))
    .persist();
  github
    .intercept({ path: /since=2026-11-25T16%3A00%3A00.000Z/, method: 'GET' })
    .reply(200, JSON.stringify(COMMITS_26))
    .persist();

  const feishu = mockAgent.get(FEISHU);
  feishu
    .intercept({ path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST' })
    .reply(200, JSON.stringify({ code: 0, tenant_access_token: 't-1' }))
    .persist();
  feishu
    .intercept({ path: /\/open-apis\/task\/v2\/tasks/, method: 'GET' })
    .reply(200, JSON.stringify({ code: 0, data: { items: TASKS, has_more: false } }))
    .persist();

  harness = createHarness();
  seed();
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
  harness.repo.close();
});

describe('CS-01/CS-15 重复采集去重，CS-19 UTC 16:00 日界', () => {
  it('同一窗口采集两次仅入库一次；UTC 16:30 提交计入本地次日', async () => {
    const first = await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    expect(first.failed).toBe(0);
    expect(countEvents()).toBe(7);

    await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    expect(countEvents()).toBe(7);

    await runCollect(harness.context, parseArgs(collectArgs('2026-11-26')));
    const row = harness.db.prepare("SELECT occurred_at FROM event WHERE source_id = 'sha-4'").get() as
      | { occurred_at: string }
      | undefined;
    expect(row?.occurred_at.startsWith('2026-11-26T00:30:00')).toBe(true);
    expect(countEvents()).toBe(8);
  });
});

describe('CS-02/03/04/05/16 生成与渲染', () => {
  it('时段归位、多作者归属、来源标识、去人称与跨天标记', async () => {
    await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25']));

    const alice = harness.repo.findReport(1, '2026-11-25');
    if (alice?.id === undefined) throw new Error('Alice 日报缺失');
    const entries = harness.repo.findEntriesByReport(alice.id);

    // CS-02：09:30 → morning，14:00 → afternoon，10:00 任务 → morning
    expect(entryByContent(entries, '完成登录接口开发').timeBlock).toBe('morning');
    expect(entryByContent(entries, '联调任务接口').timeBlock).toBe('afternoon');
    expect(entryByContent(entries, '修复分页缺陷').timeBlock).toBe('morning');

    // CS-03：Co-authored-by 命中 Bob，条目归属两人
    const coauthored = entryByContent(entries, '完成登录接口开发');
    expect(coauthored.attributionKind).toBe('coauthor');
    expect(coauthored.members?.map((member) => member.memberId).sort()).toEqual([1, 2]);

    // CS-16：任务创建于前一日，保留起始日并加前缀
    const crossDay = entryByContent(entries, '修复分页缺陷');
    expect(crossDay.originalDate).toBe('2026-11-24');
    expect(alice.body).toContain('（自 11-24 起）');

    // CS-04：每条条目都有来源；CS-05：无第一人称
    for (const entry of entries) {
      expect(harness.repo.findLinksByReport(alice.id).some((link) => link.entryId === entry.id)).toBe(true);
    }
    expect(alice.body).toContain('https://github.com/acme/app/commit/sha-1');
    expect(alice.body).toContain('来源：飞书群聊 11-25 10:00 与 Bob 讨论');
    expect(alice.body).not.toMatch(/我/);
  });

  it('CS-06/CS-14 空白模板与 CS-18 请假保留当日记录', async () => {
    await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25', '--member', '3']));

    const blank = harness.repo.findReport(3, '2026-11-25');
    expect(blank?.status).toBe('blank');
    expect(blank?.body).toContain('今日无进展记录');

    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25', '--member', '1', '--leave']));
    const leave = harness.repo.findReport(1, '2026-11-25');
    if (leave?.id === undefined) throw new Error('请假日报缺失');
    expect(leave.status).toBe('leave');
    const entries = harness.repo.findEntriesByReport(leave.id);
    expect(entries.length).toBeGreaterThan(1);
    expect(leave.body).toContain('请假（未出勤，存在当日记录待确认）');
    expect(leave.body).toContain('完成登录接口开发');
  });
});

describe('CS-09/CS-10 权限、汇总投影与查询时延', () => {
  it('越权查询被拒；团队汇总不含正文', async () => {
    await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25']));

    const denied = queryHistory(harness.repo, {
      actorId: 3,
      memberId: 1,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(denied).toEqual({ ok: false, reason: 'forbidden' });

    const summary = renderTeamSummary(findSummaryRows(harness.repo, '2026-11-25'), '2026-11-25');
    expect(summary).toContain('Alice');
    expect(summary).not.toContain('完成登录接口开发');
  });

  it('1000 条历史查询 ≤ 2 秒', () => {
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      timeBlock: 'morning',
      state: 'done' as const,
      content: `任务 ${index}`,
      orderIndex: index,
      isManual: false,
      attributionKind: 'author' as const,
      attributionConfirmed: true,
      members: [{ memberId: 1, role: 'primary' as const }],
      links: [{ linkType: 'url' as const, target: `https://example.com/${index}` }],
    }));
    harness.repo.saveReportBundle({
      memberId: 1,
      reportDate: '2026-11-20',
      status: 'draft',
      body: '',
      entries,
    });
    const startedAt = performance.now();
    const result = queryHistory(harness.repo, {
      actorId: 1,
      memberId: 1,
      from: '2026-11-20',
      to: '2026-11-20',
    });
    expect(performance.now() - startedAt).toBeLessThan(2000);
    if (!result.ok) throw new Error('应允许本人查询');
    expect(renderHistory(result)).toContain('任务 999');
  });
});

describe('T-017 端到端 --dry-run 推送', () => {
  it('输出主题与正文，不含 HTML，不写 push_log', async () => {
    await runCollect(harness.context, parseArgs(collectArgs('2026-11-25')));
    runGenerate(harness.context, parseArgs(['generate', '--date', '2026-11-25']));
    const code = await runPush(harness.context, parseArgs(['push', '--date', '2026-11-25', '--dry-run']));
    expect(code).toBe(0);
    const printed = harness.output.join('\n');
    expect(printed).toContain('=== 日报 2026-11-25 Alice ===');
    expect(printed).toContain('完成登录接口开发');
    expect(printed).not.toMatch(/<[a-z][^>]*>/i);
    expect(harness.repo.audit.findPushes('2026-11-25')).toHaveLength(0);
  });
});

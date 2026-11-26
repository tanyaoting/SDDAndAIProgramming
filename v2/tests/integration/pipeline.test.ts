import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { FixedClock, dayKey } from '../../src/clock.js';
import { runPush } from '../../src/cli/push.js';
import { EXIT } from '../../src/cli/exit.js';
import { loadKeywordRules, loadWorkBlocks } from '../../src/config.js';
import { buildDedupeKey } from '../../src/collectors/normalize.js';
import type { AttributionContext } from '../../src/generator/attribution.js';
import { assembleReport } from '../../src/generator/report.js';
import { renderSummary } from '../../src/generator/summary.js';
import { evaluatePushSchedule } from '../../src/publisher/scheduler.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo } from '../../src/store/repo.js';
import type { SdrConfig } from '../../src/config.js';
import type { Event } from '../../src/types.js';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../../config');
const REPORT_DATE = '2026-11-25';
const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
const rules = loadKeywordRules(join(CONFIG, 'keywords.yaml'));
const blocks = loadWorkBlocks(join(CONFIG, 'work-hours.yaml'));

const smtpConfig: SdrConfig = {
  github: { token: 'gh-test' },
  feishu: { appId: 'app', appSecret: 'sec' },
  smtp: {
    host: 'smtp.test',
    port: 587,
    user: 'u',
    pass: 'p',
    from: 'bot@example.com',
  },
  dbPath: ':memory:',
  pushTime: '18:00',
};

let agent: MockAgent | undefined;
let priorDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  priorDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent?.close();
  setGlobalDispatcher(priorDispatcher);
});

function attributionCtx(repo: ReturnType<typeof createRepo>): AttributionContext {
  return {
    findMemberByGithubLogin: (login) => repo.findMemberByGithubLogin(login)?.id,
    findMemberByEmailOrName: (name) => {
      const hit = repo.listActiveMembers().find(
        (m) => m.displayName.toLowerCase() === name || m.email?.toLowerCase() === name,
      );
      return hit?.id;
    },
    taskWindowMembers: () => [],
  };
}

function ghCommit(
  memberId: number,
  sourceId: string,
  occurredAt: Date,
  title: string,
  extra: Partial<Event> = {},
): Event {
  return {
    memberId,
    source: 'github',
    sourceId,
    kind: 'commit',
    occurredAt,
    title,
    dedupeKey: buildDedupeKey(sourceId, occurredAt, memberId, clock),
    isPrimary: true,
    runId: 'integration-run',
    payload: { html_url: `https://github.com/acme/repo/commit/${sourceId}` },
    ...extra,
  };
}

function feishuTask(
  memberId: number,
  sourceId: string,
  occurredAt: Date,
  title: string,
  state: 'done' | 'doing' | 'plan',
): Event {
  return {
    memberId,
    source: 'feishu',
    sourceId,
    kind: 'task_done',
    occurredAt,
    title,
    dedupeKey: buildDedupeKey(sourceId, occurredAt, memberId, clock),
    isPrimary: true,
    runId: 'integration-run',
    payload: { state, ref: `飞书任务 ${sourceId}` },
  };
}

function manualNote(memberId: number, sourceId: string, occurredAt: Date, title: string): Event {
  return {
    memberId,
    source: 'manual',
    sourceId,
    kind: 'note',
    occurredAt,
    title,
    dedupeKey: buildDedupeKey(sourceId, occurredAt, memberId, clock),
    isPrimary: true,
    runId: 'integration-run',
    payload: { ref: '飞书群聊 11-25 与张三讨论接口' },
  };
}

describe('T-021 端到端管线（固定内存库，无真实网络）', () => {
  it('CS-01/CS-15：成员+知情同意 → 事件幂等写入 → 生成条目覆盖率与去重', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const alice = repo.insertMember({
      githubLogin: 'alice',
      displayName: 'Alice',
      active: true,
      email: 'alice@corp.example',
    });
    const bob = repo.insertMember({
      githubLogin: 'bob',
      displayName: 'Bob',
      active: true,
      email: 'bob@corp.example',
    });
    repo.insertConsent({
      memberId: alice.id ?? 0,
      agreedAt: clock.now(),
      scope: 'github,feishu,local',
    });
    repo.insertConsent({
      memberId: bob.id ?? 0,
      agreedAt: clock.now(),
      scope: 'github',
    });

    const events: Event[] = [
      ghCommit(alice.id ?? 0, 'c1', new Date('2026-11-25T09:15:00+08:00'), '完成鉴权模块'),
      ghCommit(alice.id ?? 0, 'c2', new Date('2026-11-25T10:00:00+08:00'), '补充单元测试'),
      ghCommit(alice.id ?? 0, 'c3', new Date('2026-11-25T11:00:00+08:00'), '修复 lint 告警'),
      ghCommit(alice.id ?? 0, 'c4', new Date('2026-11-25T14:30:00+08:00'), '联调支付回调'),
      ghCommit(alice.id ?? 0, 'c5', new Date('2026-11-25T16:00:00+08:00'), '更新部署文档'),
      feishuTask(alice.id ?? 0, 't1', new Date('2026-11-25T09:45:00+08:00'), '需求评审关闭', 'done'),
      feishuTask(alice.id ?? 0, 't2', new Date('2026-11-25T15:00:00+08:00'), '接口联调推进', 'doing'),
      feishuTask(alice.id ?? 0, 't3', new Date('2026-11-25T17:00:00+08:00'), '明日排期确认', 'plan'),
      manualNote(alice.id ?? 0, 'm1', new Date('2026-11-25T19:30:00+08:00'), '纪要同步给测试'),
    ];

    for (const ev of events) repo.upsertEvent(ev);
    const dup = { ...events[0]!, title: '重复采集不应新增行' };
    repo.upsertEvent(dup);

    const count = (db.prepare(`SELECT COUNT(*) AS c FROM event WHERE member_id = ?`).get(alice.id) as {
      c: number;
    }).c;
    expect(count).toBe(events.length);

    const loaded = repo.findEventsForDate(alice.id ?? 0, REPORT_DATE);
    expect(loaded).toHaveLength(events.length);

    const gen = assembleReport({
      repo,
      clock,
      memberId: alice.id ?? 0,
      reportDate: REPORT_DATE,
      events: loaded,
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    expect(gen.status).toBe('draft');

    const entryCount = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM entry e JOIN report r ON r.id = e.report_id WHERE r.id = ?`)
        .get(gen.reportId) as { c: number }
    ).c;
    expect(entryCount).toBeGreaterThanOrEqual(Math.floor(loaded.length * 0.8));

    const titles = (
      db.prepare(`SELECT title FROM event WHERE member_id = ? ORDER BY occurred_at`).all(alice.id) as Array<{
        title: string;
      }>
    ).map((r) => r.title);
    const body = repo.findReport(alice.id ?? 0, REPORT_DATE)?.body ?? '';
    for (const t of titles) {
      const short = t.length > 80 ? `${t.slice(0, 79)}…` : t;
      expect(body).toContain(short.slice(0, 20));
    }

    assembleReport({
      repo,
      clock,
      memberId: bob.id ?? 0,
      reportDate: REPORT_DATE,
      events: [],
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    expect(repo.findReport(bob.id ?? 0, REPORT_DATE)?.status).toBe('blank');
  });

  it('CS-02/CS-04/CS-05：时段归位、来源链接、正文无人称', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({ githubLogin: 'dev', displayName: '开发者', active: true });
    const evs = [
      ghCommit(member.id ?? 0, 'a1', new Date('2026-11-25T10:00:00+08:00'), '上午提交'),
      ghCommit(member.id ?? 0, 'a2', new Date('2026-11-25T15:00:00+08:00'), '下午提交'),
      ghCommit(member.id ?? 0, 'a3', new Date('2026-11-25T20:00:00+08:00'), '晚间提交'),
    ];
    for (const ev of evs) repo.upsertEvent(ev);
    const result = assembleReport({
      repo,
      clock,
      memberId: member.id ?? 0,
      reportDate: REPORT_DATE,
      events: repo.findEventsForDate(member.id ?? 0, REPORT_DATE),
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    const rows = db
      .prepare(`SELECT time_block, content FROM entry WHERE report_id = ? ORDER BY order_index`)
      .all(result.reportId) as Array<{ time_block: string; content: string }>;
    expect(rows.map((r) => r.time_block)).toEqual(['morning', 'afternoon', 'evening']);

    const links = db
      .prepare(
        `SELECT sl.target FROM source_link sl
         JOIN entry e ON e.id = sl.entry_id WHERE e.report_id = ?`,
      )
      .all(result.reportId) as Array<{ target: string }>;
    expect(links.every((l) => l.target.trim().length > 0)).toBe(true);

    const body = repo.findReport(member.id ?? 0, REPORT_DATE)?.body ?? '';
    expect(body).not.toMatch(/我|我们/);
    expect((body.match(/我|我们/g) ?? []).length).toBe(0);
  });

  it('CS-03：Co-authored-by 多作者归属', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const alice = repo.insertMember({ githubLogin: 'alice', displayName: 'Alice', active: true });
    const bob = repo.insertMember({ githubLogin: 'bob', displayName: 'Bob', active: true });
    const ev = ghCommit(alice.id ?? 0, 'co1', new Date('2026-11-25T10:30:00+08:00'), '结对功能', {
      detail: 'Co-authored-by: Bob <bob@corp.example>',
    });
    repo.upsertEvent(ev);
    const gen = assembleReport({
      repo,
      clock,
      memberId: alice.id ?? 0,
      reportDate: REPORT_DATE,
      events: repo.findEventsForDate(alice.id ?? 0, REPORT_DATE),
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    const members = db
      .prepare(
        `SELECT member_id, role FROM entry_member em
         JOIN entry e ON e.id = em.entry_id WHERE e.report_id = ?`,
      )
      .all(gen.reportId) as Array<{ member_id: number; role: string }>;
    expect(members.some((m) => m.member_id === alice.id && m.role === 'primary')).toBe(true);
    expect(members.some((m) => m.member_id === bob.id && m.role === 'co')).toBe(true);
  });

  it('CS-06/CS-14/CS-18：请假、空白与请假冲突占位', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const leaveOnly = repo.insertMember({ githubLogin: 'off', displayName: '请假者', active: true });
    const conflict = repo.insertMember({ githubLogin: 'mix', displayName: '冲突', active: true });

    const leaveRes = assembleReport({
      repo,
      clock,
      memberId: leaveOnly.id ?? 0,
      reportDate: REPORT_DATE,
      events: [],
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
      leave: true,
    });
    expect(leaveRes.status).toBe('leave');
    expect(repo.findReport(leaveOnly.id ?? 0, REPORT_DATE)?.body).toContain('请假');

    const blankRes = assembleReport({
      repo,
      clock,
      memberId: conflict.id ?? 0,
      reportDate: REPORT_DATE,
      events: [],
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    expect(blankRes.status).toBe('blank');

    repo.upsertEvent(
      ghCommit(conflict.id ?? 0, 'x1', new Date('2026-11-25T11:00:00+08:00'), '仍有一处提交'),
    );
    const mixed = assembleReport({
      repo,
      clock,
      memberId: conflict.id ?? 0,
      reportDate: REPORT_DATE,
      events: repo.findEventsForDate(conflict.id ?? 0, REPORT_DATE),
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
      leave: true,
    });
    expect(mixed.status).toBe('leave');
    const entries = db
      .prepare(`SELECT content FROM entry WHERE report_id = ?`)
      .all(mixed.reportId) as Array<{ content: string }>;
    expect(entries.length).toBeGreaterThan(1);
    expect(entries[0]?.content).toContain('待确认');
  });

  it('CS-16：跨天任务 original_date 写入正文前缀', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({ githubLogin: 'dev', displayName: '开发者', active: true });
    const createdAt = Date.parse('2026-11-23T10:00:00+08:00');
    repo.upsertEvent({
      memberId: member.id ?? 0,
      source: 'feishu',
      sourceId: 'long-task',
      kind: 'task_done',
      occurredAt: new Date('2026-11-25T15:00:00+08:00'),
      title: '跨天完成任务',
      dedupeKey: buildDedupeKey('long-task', new Date('2026-11-25T15:00:00+08:00'), member.id ?? 0, clock),
      isPrimary: true,
      runId: 'integration-run',
      payload: { state: 'done', created_at: String(createdAt), ref: '飞书' },
    });
    const gen = assembleReport({
      repo,
      clock,
      memberId: member.id ?? 0,
      reportDate: REPORT_DATE,
      events: repo.findEventsForDate(member.id ?? 0, REPORT_DATE),
      rules,
      blocks,
      attributionCtx: attributionCtx(repo),
    });
    const row = db
      .prepare(`SELECT original_date FROM entry WHERE report_id = ?`)
      .get(gen.reportId) as { original_date: string | null };
    expect(row.original_date).toBe('2026-11-23');
    expect(repo.findReport(member.id ?? 0, REPORT_DATE)?.body).toContain('（自 11-23 起）');
  });

  it('CS-19：UTC 16:00 后提交计入本地次日且去重键一致', () => {
    const boundaryClock = new FixedClock(new Date('2026-11-26T01:00:00+08:00'));
    const db = openDatabase(':memory:');
    const repo = createRepo(db, boundaryClock);
    const member = repo.insertMember({ githubLogin: 'tz', displayName: '时区', active: true });
    const atA = new Date('2026-11-25T16:30:00.000Z');
    const atB = new Date('2026-11-25T18:00:00.000Z');
    const keyA = buildDedupeKey('boundary-sha', atA, member.id ?? 0, boundaryClock);
    const keyB = buildDedupeKey('boundary-sha', atB, member.id ?? 0, boundaryClock);
    expect(keyA).toBe(keyB);
    expect(dayKey(boundaryClock, atA)).toBe('2026-11-26');

    repo.upsertEvent({
      memberId: member.id ?? 0,
      source: 'github',
      sourceId: 'boundary-sha',
      kind: 'commit',
      occurredAt: atA,
      title: '午夜后提交',
      dedupeKey: keyA,
      isPrimary: true,
      runId: 'integration-run',
      payload: { html_url: 'https://github.com/acme/repo/commit/boundary-sha' },
    });
    repo.upsertEvent({
      memberId: member.id ?? 0,
      source: 'github',
      sourceId: 'boundary-sha',
      kind: 'commit',
      occurredAt: atB,
      title: '重复采集',
      dedupeKey: keyB,
      isPrimary: true,
      runId: 'integration-run',
      payload: { html_url: 'https://github.com/acme/repo/commit/boundary-sha' },
    });
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM event`).get() as { c: number }).c;
    expect(count).toBe(1);
    expect(repo.findEventsForDate(member.id ?? 0, '2026-11-26')).toHaveLength(1);
  });

  it('CS-09/CS-05：assembleReport → renderSummary → push dry-run 不含他人正文', async () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const alice = repo.insertMember({
      githubLogin: 'alice',
      displayName: 'Alice',
      active: true,
      email: 'alice@corp.example',
    });
    const bob = repo.insertMember({
      githubLogin: 'bob',
      displayName: 'Bob',
      active: true,
      email: 'bob@corp.example',
    });
    repo.insertConsent({ memberId: alice.id ?? 0, agreedAt: clock.now(), scope: 'all' });

    const secretTitle = '机密阻塞详情不应出现在汇总';
    for (const [member, title, state] of [
      [alice, '完成登录功能', 'done'],
      [bob, secretTitle, 'blocked'],
    ] as const) {
      repo.upsertEvent(
        ghCommit(member.id ?? 0, `${member.githubLogin}-1`, new Date('2026-11-25T10:00:00+08:00'), title, {
          payload: {
            html_url: `https://github.com/acme/repo/commit/${member.githubLogin}-1`,
            state,
          },
        }),
      );
      assembleReport({
        repo,
        clock,
        memberId: member.id ?? 0,
        reportDate: REPORT_DATE,
        events: repo.findEventsForDate(member.id ?? 0, REPORT_DATE),
        rules,
        blocks,
        attributionCtx: attributionCtx(repo),
      });
    }

    const summaryText = renderSummary(repo.findSummaryRows(REPORT_DATE), REPORT_DATE);
    expect(summaryText).toContain('团队日报');
    expect(summaryText).not.toContain(secretTitle);
    expect(summaryText).not.toContain('完成登录');

    const chunks: string[] = [];
    const code = await runPush(
      { repo, clock, config: smtpConfig },
      { date: REPORT_DATE, dryRun: true },
      (t) => chunks.push(t),
    );
    expect(code).toBe(EXIT.OK);
    const pushed = chunks.join('');
    expect(pushed).toContain('团队日报');
    const teamSummary = pushed.split('团队 ·')[1] ?? pushed.slice(pushed.lastIndexOf('团队日报'));
    expect(teamSummary).not.toContain(secretTitle);
    expect(teamSummary).not.toContain('完成登录');
    expect(pushed).not.toMatch(/我|我们/);
  });

  it('CS-08：错过推送时刻 5 分钟内补发窗口', () => {
    const late = new FixedClock(new Date('2026-11-25T18:04:00+08:00'));
    const decision = evaluatePushSchedule(late, '18:00', REPORT_DATE, false);
    expect(decision.shouldSend).toBe(true);
    expect(decision.reason).toBe('catch_up');
  });
});
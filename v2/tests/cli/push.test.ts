import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { runPush } from '../../src/cli/push.js';
import { EXIT } from '../../src/cli/exit.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo } from '../../src/store/repo.js';
import type { SdrConfig } from '../../src/config.js';
import { createMailTransport } from '../../src/publisher/mail.js';

const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));

const smtpConfig: SdrConfig = {
  github: { token: 't' },
  feishu: { appId: 'a', appSecret: 's' },
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

describe('T-020 push CLI', () => {
  it('--dry-run 将正文写到 stdout', async () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({
      githubLogin: 'dev',
      displayName: '开发者',
      active: true,
      email: 'dev@corp.example',
    });
    repo.saveReportBundle({
      report: {
        memberId: member.id ?? 0,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
        body: '完成联调',
      },
      entries: [],
    });
    const chunks: string[] = [];
    const code = await runPush(
      { repo, clock, config: smtpConfig },
      { date: '2026-11-25', dryRun: true },
      (text) => chunks.push(text),
    );
    expect(code).toBe(EXIT.OK);
    expect(chunks.join('')).toContain('完成联调');
  });

  it('推送成功写入 push_log', async () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const member = repo.insertMember({
      githubLogin: 'dev',
      displayName: '开发者',
      active: true,
      email: 'dev@corp.example',
    });
    repo.saveReportBundle({
      report: {
        memberId: member.id ?? 0,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
        body: '完成联调',
      },
      entries: [],
    });
    const transport = createMailTransport(smtpConfig.smtp, {
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    });
    const code = await runPush(
      { repo, clock, config: smtpConfig, transport },
      { date: '2026-11-25', forceSchedule: true },
    );
    expect(code).toBe(EXIT.OK);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM push_log WHERE result = 'ok'`).get() as {
      c: number;
    }).c;
    expect(count).toBeGreaterThan(0);
  });
});
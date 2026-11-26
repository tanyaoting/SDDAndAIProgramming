import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { runHistory } from '../../src/cli/history.js';
import { EXIT } from '../../src/cli/exit.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo } from '../../src/store/repo.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

describe('T-020 history CLI', () => {
  it('越权访问返回退出码 8', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const self = repo.insertMember({
      githubLogin: 'a',
      displayName: '甲',
      active: true,
    });
    const other = repo.insertMember({
      githubLogin: 'b',
      displayName: '乙',
      active: true,
    });
    const code = runHistory(repo, {
      actor: self.id ?? 0,
      member: other.id ?? 0,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(code).toBe(EXIT.ACCESS_DENIED);
  });

  it('本人查询成功返回 0', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const self = repo.insertMember({
      githubLogin: 'a',
      displayName: '甲',
      active: true,
    });
    repo.saveReportBundle({
      report: {
        memberId: self.id ?? 0,
        reportDate: '2026-11-25',
        status: 'draft',
        generatedAt: clock.now(),
        body: '正文',
      },
      entries: [],
    });
    const code = runHistory(repo, {
      actor: self.id ?? 0,
      member: self.id ?? 0,
      from: '2026-11-25',
      to: '2026-11-25',
    });
    expect(code).toBe(EXIT.OK);
  });
});
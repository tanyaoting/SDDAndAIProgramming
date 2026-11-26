import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { runCollect } from '../../src/cli/collect.js';
import { EXIT } from '../../src/cli/exit.js';
import { openDatabase } from '../../src/store/db.js';
import { createRepo } from '../../src/store/repo.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import type { Event, Source } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));

function stubCollector(source: Source, fail?: boolean) {
  return async (): Promise<Event[]> => {
    if (fail === true) {
      throw new SdrError(ERROR_CODES.GITHUB_TOKEN_INVALID, '令牌无效', { source });
    }
    return [
      {
        memberId: 1,
        source,
        sourceId: `${source}-1`,
        kind: 'note',
        occurredAt: clock.now(),
        title: `evt-${source}`,
        dedupeKey: `dedupe-${source}`,
        isPrimary: true,
        runId: 'run-x',
      },
    ];
  };
}

describe('Task 10 collect CLI', () => {
  it('部分失败退出码 3', async () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember({ githubLogin: 'a', displayName: '甲', active: true });
    const code = await runCollect(
      { repo, clock },
      { date: '2026-11-25', sources: ['github', 'feishu'] },
      {
        github: stubCollector('github'),
        feishu: stubCollector('feishu', true),
      },
    );
    expect(code).toBe(EXIT.PARTIAL);
  });

  it('全部失败退出码 4', async () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    repo.insertMember({ githubLogin: 'a', displayName: '甲', active: true });
    const code = await runCollect(
      { repo, clock },
      { date: '2026-11-25', sources: ['github'] },
      { github: stubCollector('github', true) },
    );
    expect(code).toBe(EXIT.ALL_FAILED);
  });
});
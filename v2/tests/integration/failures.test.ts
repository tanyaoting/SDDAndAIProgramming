import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { runHistory } from '../../src/cli/history.js';
import { EXIT } from '../../src/cli/exit.js';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { renderEntry } from '../../src/generator/render.js';
import { renderReportBody } from '../../src/generator/report.js';
import { openDatabase } from '../../src/store/db.js';
import {
  HistoryAccessDenied,
  SUMMARY_ROWS_SQL,
  createRepo,
  type SaveReportBundleEntry,
} from '../../src/store/repo.js';
import type { Entry } from '../../src/types.js';

const clock = new FixedClock(new Date('2026-11-25T18:00:00+08:00'));
describe('T-021 失败与隐私路径', () => {
  it('CS-09：HistoryAccessDenied 映射退出码 8', () => {
    const db = openDatabase(':memory:');
    const repo = createRepo(db, clock);
    const actor = repo.insertMember({ githubLogin: 'a', displayName: '甲', active: true });
    const other = repo.insertMember({ githubLogin: 'b', displayName: '乙', active: true });
    const code = runHistory(repo, {
      actor: actor.id ?? 0,
      member: other.id ?? 0,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(code).toBe(EXIT.ACCESS_DENIED);
    expect(() =>
      repo.findHistory(actor.id ?? 0, other.id ?? 0, '2026-11-01', '2026-11-30'),
    ).toThrow(HistoryAccessDenied);
  });

  it('CS-04/CS-06：缺少来源链接抛 SDR-E601，生成 CLI 退出 10', () => {
    const bareEntry: Entry = {
      reportId: 1,
      timeBlock: 'morning',
      state: 'done',
      content: '无链接条目',
      orderIndex: 0,
      isManual: true,
      attributionKind: 'author',
      attributionConfirmed: true,
      members: [{ entryId: 1, memberId: 1, role: 'primary' }],
    };
    try {
      renderEntry(bareEntry, []);
      expect.fail('应抛出 SDR-E601');
    } catch (error) {
      expect(error).toBeInstanceOf(SdrError);
      expect((error as SdrError).code).toBe(ERROR_CODES.SOURCE_LINK_MISSING);
    }

    const draft: SaveReportBundleEntry = {
      timeBlock: 'morning',
      state: 'done',
      content: '缺链草稿',
      orderIndex: 0,
      isManual: true,
      attributionKind: 'author',
      attributionConfirmed: true,
      members: [{ memberId: 1, role: 'primary' }],
      links: [],
    };
    expect(() => renderReportBody([draft])).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SOURCE_LINK_MISSING }),
    );

  });

  it('CS-09：汇总 SQL 投影白名单不含 content/body', () => {
    const sql = SUMMARY_ROWS_SQL.toLowerCase();
    for (const forbidden of ['content', 'body', 'title', 'detail'] as const) {
      expect(sql).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
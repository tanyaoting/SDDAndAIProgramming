import type Database from 'better-sqlite3';
import { dayWindow, toZonedIsoString } from '../clock.js';
import type { Clock, Member } from '../types.js';
import { mapEntryRow, mapEvent, mapMemberFull } from './repo-map.js';
import type { EntryRow, EventRow, MemberRow, ReportRow } from './repo-types.js';

function iso(clock: Clock, at: Date): string {
  return toZonedIsoString(clock, at);
}

export function createRepoCliQueries(db: Database.Database, clock: Clock) {
  const listActiveMembers = (): Member[] => {
    const rows = db
      .prepare(`SELECT * FROM member WHERE active = 1 ORDER BY display_name`)
      .all() as MemberRow[];
    return rows.map(mapMemberFull);
  };

  const findMemberByGithubLogin = (login: string): Member | undefined => {
    const row = db
      .prepare(`SELECT * FROM member WHERE LOWER(github_login) = LOWER(?)`)
      .get(login) as MemberRow | undefined;
    return row === undefined ? undefined : mapMemberFull(row);
  };

  const findEventsForDate = (memberId: number, reportDate: string): ReturnType<typeof mapEvent>[] => {
    const { since, until } = dayWindow(clock, reportDate);
    const rows = db
      .prepare(
        `SELECT * FROM event WHERE member_id = ? AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at`,
      )
      .all(memberId, iso(clock, since), iso(clock, until)) as EventRow[];
    return rows.map(mapEvent);
  };

  const hasPushLogOk = (reportDate: string, channel: string): boolean => {
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM push_log WHERE report_date = ? AND channel = ? AND result = 'ok' LIMIT 1`,
      )
      .get(reportDate, channel);
    return row !== undefined;
  };

  const removeEntryById = (entryId: number): boolean => {
    const exists = db.prepare(`SELECT report_id FROM entry WHERE id = ?`).get(entryId) as
      | { report_id: number }
      | undefined;
    if (exists === undefined) return false;
    db.transaction(() => {
      db.prepare(`DELETE FROM entry_member WHERE entry_id = ?`).run(entryId);
      db.prepare(`DELETE FROM source_link WHERE entry_id = ?`).run(entryId);
      db.prepare(`DELETE FROM entry WHERE id = ?`).run(entryId);
      db.prepare(`UPDATE report SET status = 'draft' WHERE id = ?`).run(exists.report_id);
    })();
    return true;
  };

  const addManualTextEntry = (
    memberId: number,
    reportDate: string,
    text: string,
    ref: string,
    timeBlock: string,
  ): number => {
    const report = db
      .prepare(`SELECT * FROM report WHERE member_id = ? AND report_date = ?`)
      .get(memberId, reportDate) as ReportRow | undefined;
    if (report === undefined) {
      throw new Error('report_not_found');
    }
    const maxOrder = db
      .prepare(`SELECT COALESCE(MAX(order_index), -1) AS mx FROM entry WHERE report_id = ?`)
      .get(report.id) as { mx: number };
    const orderIndex = maxOrder.mx + 1;
    const entryResult = db
      .prepare(
        `INSERT INTO entry (
          report_id, time_block, state, content, order_index, is_manual,
          attribution_kind, attribution_confirmed
        ) VALUES (?, ?, 'doing', ?, ?, 1, 'author', 1)`,
      )
      .run(report.id, timeBlock, text.trim(), orderIndex);
    const entryId = Number(entryResult.lastInsertRowid);
    db.prepare(`INSERT INTO entry_member (entry_id, member_id, role) VALUES (?, ?, 'primary')`).run(
      entryId,
      memberId,
    );
    db.prepare(`INSERT INTO source_link (entry_id, link_type, target) VALUES (?, 'note', ?)`).run(
      entryId,
      ref.trim(),
    );
    const appended = `${report.body ?? ''}\n${text.trim()}`.trim();
    db.prepare(`UPDATE report SET status = 'draft', body = ? WHERE id = ?`).run(appended, report.id);
    return entryId;
  };

  const getEntry = (entryId: number) => {
    const row = db.prepare(`SELECT * FROM entry WHERE id = ?`).get(entryId) as EntryRow | undefined;
    return row === undefined ? undefined : mapEntryRow(row);
  };

  return {
    listActiveMembers,
    findMemberByGithubLogin,
    findEventsForDate,
    hasPushLogOk,
    removeEntryById,
    addManualTextEntry,
    getEntry,
  };
}
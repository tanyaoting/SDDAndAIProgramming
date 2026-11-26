import type Database from 'better-sqlite3';
import { toZonedIsoString } from '../clock.js';
import type { Clock, Member } from '../types.js';
import { mapEntryRow, mapReportRow } from './repo-map.js';
import {
  HistoryAccessDenied,
  type ConsentInput,
  type EntryRow,
  type HistoryReport,
  type IngestionRunInput,
  type MemberRow,
  type PushLogInput,
  type ReportRow,
} from './repo-types.js';

function iso(clock: Clock, at: Date): string {
  return toZonedIsoString(clock, at);
}

export function createHistoryAccess(
  db: Database.Database,
  getMember: (id: number) => Member | undefined,
) {
  function assertHistoryAccess(actorMemberId: number, targetMemberId: number): void {
    if (actorMemberId === targetMemberId) return;
    const target = getMember(targetMemberId);
    if (target?.managerId === actorMemberId) return;
    throw new HistoryAccessDenied();
  }

  function findHistory(
    actorMemberId: number,
    memberId: number,
    from: string,
    to: string,
  ): HistoryReport[] {
    assertHistoryAccess(actorMemberId, memberId);

    const reports = db
      .prepare(
        `SELECT * FROM report WHERE member_id = ? AND report_date >= ? AND report_date <= ? ORDER BY report_date`,
      )
      .all(memberId, from, to) as ReportRow[];

    return reports.map((row) => {
      const report = mapReportRow(row);
      const entryRows = db
        .prepare(`SELECT * FROM entry WHERE report_id = ? ORDER BY order_index`)
        .all(report.id) as EntryRow[];
      return { report, entries: entryRows.map(mapEntryRow) };
    });
  }

  return { findHistory };
}

export function createAuditWrites(db: Database.Database, clock: Clock) {
  function insertIngestionRun(input: IngestionRunInput): number {
    const result = db
      .prepare(
        `INSERT INTO ingestion_run (run_id, source, started_at, finished_at, result, error_code, error_msg, event_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.source,
        iso(clock, input.startedAt),
        input.finishedAt === undefined ? null : iso(clock, input.finishedAt),
        input.result,
        input.errorCode ?? null,
        input.errorMsg ?? null,
        input.eventCount,
      );
    return Number(result.lastInsertRowid);
  }

  function insertPushLog(input: PushLogInput): number {
    const result = db
      .prepare(
        `INSERT INTO push_log (report_date, channel, sent_at, result, retry_count)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.reportDate,
        input.channel,
        iso(clock, input.sentAt),
        input.result,
        input.retryCount ?? 0,
      );
    return Number(result.lastInsertRowid);
  }

  function insertConsent(input: ConsentInput): number {
    const result = db
      .prepare(`INSERT INTO consent (member_id, agreed_at, scope) VALUES (?, ?, ?)`)
      .run(input.memberId, iso(clock, input.agreedAt), input.scope);
    return Number(result.lastInsertRowid);
  }

  return { insertIngestionRun, insertPushLog, insertConsent };
}

export function selectMemberById(
  db: Database.Database,
  id: number,
): MemberRow | undefined {
  return db.prepare(`SELECT * FROM member WHERE id = ?`).get(id) as MemberRow | undefined;
}
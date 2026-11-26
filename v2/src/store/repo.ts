import type Database from 'better-sqlite3';
import { parseInstant, toZonedIsoString } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Clock, EntryState, Event, Member, Report, ReportStatus, SummaryRow } from '../types.js';
import { createAuditWrites, createHistoryAccess, selectMemberById } from './repo-extra.js';
import {
  emptyByState,
  isUniqueViolation,
  mapEvent,
  mapMemberFull,
} from './repo-map.js';
import {
  SUMMARY_ROWS_SQL,
  type ConsentInput,
  type EventRow,
  type HistoryReport,
  type IngestionRunInput,
  type PushLogInput,
  type SaveReportBundleInput,
  type SummaryQueryRow,
} from './repo-types.js';

export {
  HistoryAccessDenied,
  SUMMARY_ROWS_SQL,
  type ConsentInput,
  type HistoryReport,
  type IngestionRunInput,
  type PushLogInput,
  type SaveReportBundleEntry,
  type SaveReportBundleInput,
} from './repo-types.js';

type ReportRow = {
  id: number;
  member_id: number;
  report_date: string;
  status: ReportStatus;
  body: string | null;
  generated_at: string;
  pushed_at: string | null;
};

function mapReport(row: ReportRow): Report {
  return {
    id: row.id,
    memberId: row.member_id,
    reportDate: row.report_date,
    status: row.status,
    ...(row.body === null ? {} : { body: row.body }),
    generatedAt: parseInstant(row.generated_at),
    ...(row.pushed_at === null ? {} : { pushedAt: parseInstant(row.pushed_at) }),
  };
}

export interface Repo {
  insertMember(input: Omit<Member, 'id'>): Member;
  getMember(id: number): Member | undefined;
  upsertEvent(event: Event): Event;
  findReport(memberId: number, reportDate: string): Report | undefined;
  deleteReport(reportId: number): void;
  saveReportBundle(bundle: SaveReportBundleInput): { reportId: number };
  acceptAttribution(reportId: number, all: boolean): number;
  findSummaryRows(reportDate: string): SummaryRow[];
  findHistory(
    actorMemberId: number,
    memberId: number,
    from: string,
    to: string,
  ): HistoryReport[];
  insertIngestionRun(input: IngestionRunInput): number;
  insertPushLog(input: PushLogInput): number;
  insertConsent(input: ConsentInput): number;
}

function iso(clock: Clock, at: Date): string {
  return toZonedIsoString(clock, at);
}

export function createRepo(db: Database.Database, clock: Clock): Repo {
  const selectEventByDedupe = db.prepare(`SELECT * FROM event WHERE dedupe_key = ?`);

  const insertMemberStmt = db.prepare(`
    INSERT INTO member (github_login, feishu_open_id, display_name, email, manager_id, active, created_at)
    VALUES (@githubLogin, @feishuOpenId, @displayName, @email, @managerId, @active, @createdAt)
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO event (
      member_id, source, source_id, kind, occurred_at, title, detail, dedupe_key, is_primary, run_id, payload, created_at
    ) VALUES (
      @memberId, @source, @sourceId, @kind, @occurredAt, @title, @detail, @dedupeKey, @isPrimary, @runId, @payload, @createdAt
    )
  `);

  function insertMember(input: Omit<Member, 'id'>): Member {
    const result = insertMemberStmt.run({
      githubLogin: input.githubLogin,
      feishuOpenId: input.feishuOpenId ?? null,
      displayName: input.displayName,
      email: input.email ?? null,
      managerId: input.managerId ?? null,
      active: input.active ? 1 : 0,
      createdAt: iso(clock, clock.now()),
    });
    const id = Number(result.lastInsertRowid);
    const row = selectMemberById(db, id);
    if (row === undefined) {
      throw new SdrError(ERROR_CODES.STORE_TRANSACTION_FAILED, '成员写入后读取失败');
    }
    return mapMemberFull(row);
  }

  function getMember(id: number): Member | undefined {
    const row = selectMemberById(db, id);
    return row === undefined ? undefined : mapMemberFull(row);
  }

  const { findHistory } = createHistoryAccess(db, getMember);
  const { insertIngestionRun, insertPushLog, insertConsent } = createAuditWrites(db, clock);

  function upsertEvent(event: Event): Event {
    try {
      const result = insertEventStmt.run({
        memberId: event.memberId,
        source: event.source,
        sourceId: event.sourceId,
        kind: event.kind,
        occurredAt: iso(clock, event.occurredAt),
        title: event.title,
        detail: event.detail ?? null,
        dedupeKey: event.dedupeKey,
        isPrimary: event.isPrimary ? 1 : 0,
        runId: event.runId,
        payload: event.payload === undefined ? null : JSON.stringify(event.payload),
        createdAt: iso(clock, clock.now()),
      });
      const id = Number(result.lastInsertRowid);
      const row = db.prepare(`SELECT * FROM event WHERE id = ?`).get(id) as EventRow;
      return mapEvent(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = selectEventByDedupe.get(event.dedupeKey) as EventRow | undefined;
      if (existing === undefined) {
        throw new SdrError(ERROR_CODES.STORE_TRANSACTION_FAILED, '去重键冲突但未找到既有事件', {
          cause: error,
        });
      }
      return mapEvent(existing);
    }
  }

  const insertReport = db.prepare(`
    INSERT INTO report (member_id, report_date, status, body, generated_at, pushed_at)
    VALUES (@memberId, @reportDate, @status, @body, @generatedAt, @pushedAt)
  `);

  const insertEntry = db.prepare(`
    INSERT INTO entry (
      report_id, time_block, state, content, order_index, original_date, source_event_id,
      is_manual, attribution_kind, attribution_confirmed
    ) VALUES (
      @reportId, @timeBlock, @state, @content, @orderIndex, @originalDate, @sourceEventId,
      @isManual, @attributionKind, @attributionConfirmed
    )
  `);

  const insertEntryMember = db.prepare(`
    INSERT INTO entry_member (entry_id, member_id, role) VALUES (@entryId, @memberId, @role)
  `);

  const insertSourceLink = db.prepare(`
    INSERT INTO source_link (entry_id, link_type, target) VALUES (@entryId, @linkType, @target)
  `);

  const selectReportByMemberDate = db.prepare(
    `SELECT * FROM report WHERE member_id = ? AND report_date = ?`,
  );

  function findReport(memberId: number, reportDate: string): Report | undefined {
    const row = selectReportByMemberDate.get(memberId, reportDate) as ReportRow | undefined;
    return row === undefined ? undefined : mapReport(row);
  }

  function deleteReport(reportId: number): void {
    db.transaction(() => {
      const entryIds = (
        db.prepare(`SELECT id FROM entry WHERE report_id = ?`).all(reportId) as { id: number }[]
      ).map((r) => r.id);
      for (const entryId of entryIds) {
        db.prepare(`DELETE FROM entry_member WHERE entry_id = ?`).run(entryId);
        db.prepare(`DELETE FROM source_link WHERE entry_id = ?`).run(entryId);
      }
      db.prepare(`DELETE FROM entry WHERE report_id = ?`).run(reportId);
      db.prepare(`DELETE FROM report WHERE id = ?`).run(reportId);
    })();
  }

  function saveReportBundle(bundle: SaveReportBundleInput): { reportId: number } {
    const write = db.transaction(() => {
      const reportResult = insertReport.run({
        memberId: bundle.report.memberId,
        reportDate: bundle.report.reportDate,
        status: bundle.report.status,
        body: bundle.report.body ?? null,
        generatedAt: iso(clock, bundle.report.generatedAt),
        pushedAt:
          bundle.report.pushedAt === undefined ? null : iso(clock, bundle.report.pushedAt),
      });
      const reportId = Number(reportResult.lastInsertRowid);

      for (const item of bundle.entries) {
        const entryResult = insertEntry.run({
          reportId,
          timeBlock: item.timeBlock,
          state: item.state,
          content: item.content,
          orderIndex: item.orderIndex,
          originalDate: item.originalDate ?? null,
          sourceEventId: item.sourceEventId ?? null,
          isManual: item.isManual ? 1 : 0,
          attributionKind: item.attributionKind,
          attributionConfirmed: item.attributionConfirmed ? 1 : 0,
        });
        const entryId = Number(entryResult.lastInsertRowid);

        for (const em of item.members) {
          insertEntryMember.run({ entryId, memberId: em.memberId, role: em.role });
        }
        for (const link of item.links) {
          insertSourceLink.run({ entryId, linkType: link.linkType, target: link.target });
        }
      }

      return { reportId };
    });

    try {
      return write();
    } catch (error) {
      throw new SdrError(ERROR_CODES.STORE_TRANSACTION_FAILED, '日报四表写入失败', { cause: error });
    }
  }

  function acceptAttribution(reportId: number, all: boolean): number {
    const sql = all
      ? `UPDATE entry SET attribution_confirmed = 1 WHERE report_id = ? AND attribution_confirmed = 0`
      : `UPDATE entry SET attribution_confirmed = 1
         WHERE report_id = ? AND attribution_confirmed = 0 AND attribution_kind = 'fallback'`;
    const result = db.prepare(sql).run(reportId);
    return result.changes;
  }

  function findSummaryRows(reportDate: string): SummaryRow[] {
    const rows = db.prepare(SUMMARY_ROWS_SQL).all(reportDate) as SummaryQueryRow[];
    type MutableSummary = {
      memberId: number;
      displayName: string;
      status: ReportStatus | null;
      entryCount: number;
      byState: Record<EntryState, number>;
    };
    const grouped = new Map<number, MutableSummary>();

    for (const row of rows) {
      let summary = grouped.get(row.member_id);
      if (summary === undefined) {
        summary = {
          memberId: row.member_id,
          displayName: row.display_name,
          status: row.status,
          entryCount: 0,
          byState: emptyByState(),
        };
        grouped.set(row.member_id, summary);
      }
      if (row.state !== null) {
        const count = row.state_count;
        summary.byState[row.state] += count;
        summary.entryCount += count;
      }
    }

    return [...grouped.values()];
  }

  return {
    insertMember,
    getMember,
    upsertEvent,
    findReport,
    deleteReport,
    saveReportBundle,
    acceptAttribution,
    findSummaryRows,
    findHistory,
    insertIngestionRun,
    insertPushLog,
    insertConsent,
  };
}
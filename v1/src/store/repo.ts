import Database from 'better-sqlite3';
import { toZonedIsoString } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Clock, Entry, EntryMember, Event, Report, ReportStatus, SourceLink } from '../types.js';
import { errorMessage, isUniqueViolation, toEntry, toEvent, toReport, toSourceLink } from './model.js';
import type { EntryMemberRow, EntryRow, EventRow, ReportRow, SourceLinkRow } from './model.js';
import { initSchema } from './schema.js';
import { AuditRepo } from './audit-repo.js';
import { EntryRepo } from './entry-repo.js';
import { HistoryRepo } from './history-repo.js';
import { MemberRepo } from './member-repo.js';

import type {
  ReportBundle,
  ReportBundleInput,
  ReportInput,
  InsertEventResult,
  SummaryQueryRow,
} from './model.js';
import { SUMMARY_SQL } from './model.js';
export type {
  EntryInput,
  EntryMemberInput,
  InsertEventResult,
  ReportBundle,
  ReportBundleInput,
  ReportInput,
  SourceLinkInput,
} from './model.js';

/* 数据访问层 */

export class Repo {
  /** 成员、审计与历史查询作为同库子仓储暴露，调用方仍只依赖 Repo 一个入口。 */
  readonly members: MemberRepo;
  readonly audit: AuditRepo;
  readonly history: HistoryRepo;
  readonly entries: EntryRepo;

  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {
    this.members = new MemberRepo(db, clock);
    this.audit = new AuditRepo(db, clock);
    this.history = new HistoryRepo(db);
    this.entries = new EntryRepo(db);
  }

  close(): void {
    this.db.close();
  }

  /** 写入事件；`dedupe_key` 冲突视为「已存在」，返回原 id 而非抛错（CS-01）。 */
  insertEvent(event: Event): InsertEventResult {
    try {
      const info = this.db
        .prepare(
          `INSERT INTO event
             (member_id, source, source_id, kind, occurred_at, title, detail, dedupe_key, is_primary, run_id, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.memberId,
          event.source,
          event.sourceId,
          event.kind,
          toZonedIsoString(this.clock, event.occurredAt),
          event.title,
          event.detail ?? null,
          event.dedupeKey,
          event.isPrimary ? 1 : 0,
          event.runId,
          event.payload === undefined ? null : JSON.stringify(event.payload),
          toZonedIsoString(this.clock, this.clock.now()),
        );
      return { id: Number(info.lastInsertRowid), inserted: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = this.db
        .prepare('SELECT id FROM event WHERE dedupe_key = ?')
        .get(event.dedupeKey) as { id: number } | undefined;
      if (existing !== undefined) return { id: existing.id, inserted: false };
      throw error;
    }
  }

  findEventById(id: number): Event | undefined {
    const row = this.db.prepare('SELECT * FROM event WHERE id = ?').get(id) as
      | EventRow
      | undefined;
    return row === undefined ? undefined : toEvent(row);
  }

  /** 读取 [since, until) 区间内的事件，按发生时间升序。 */
  findEventsBetween(since: Date, until: Date): Event[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM event WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at ASC, id ASC',
      )
      .all(toZonedIsoString(this.clock, since), toZonedIsoString(this.clock, until)) as EventRow[];
    return rows.map(toEvent);
  }

  insertReport(input: ReportInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO report (member_id, report_date, status, body, generated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.memberId,
        input.reportDate,
        input.status,
        input.body ?? null,
        toZonedIsoString(this.clock, this.clock.now()),
      );
    return Number(info.lastInsertRowid);
  }

  findReport(memberId: number, reportDate: string): Report | undefined {
    const row = this.db
      .prepare('SELECT * FROM report WHERE member_id = ? AND report_date = ?')
      .get(memberId, reportDate) as ReportRow | undefined;
    return row === undefined ? undefined : toReport(row);
  }

  findReportById(id: number): Report | undefined {
    const row = this.db.prepare('SELECT * FROM report WHERE id = ?').get(id) as
      | ReportRow
      | undefined;
    return row === undefined ? undefined : toReport(row);
  }

  updateReportStatus(id: number, status: ReportStatus): void {
    this.db.prepare('UPDATE report SET status = ? WHERE id = ?').run(status, id);
  }

  updateReportBody(id: number, body: string): void {
    this.db.prepare('UPDATE report SET body = ? WHERE id = ?').run(body, id);
  }

  /** 推送成功后回写 `pushed_at`（design.md §3.2 report）。 */
  updateReportPushedAt(id: number, at: Date): void {
    this.db
      .prepare('UPDATE report SET pushed_at = ? WHERE id = ?')
      .run(toZonedIsoString(this.clock, at), id);
  }

  /** 单事务写入 report + entry + entry_member + source_link，任一失败整体回滚（E501）。 */
  saveReportBundle(input: ReportBundleInput): number {
    const write = this.db.transaction((bundle: ReportBundleInput): number => {
      const reportId = this.insertReport(bundle);
      const insertEntry = this.db.prepare(
        `INSERT INTO entry
           (report_id, time_block, state, content, order_index, original_date, source_event_id,
            is_manual, attribution_kind, attribution_confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertMember = this.db.prepare(
        'INSERT INTO entry_member (entry_id, member_id, role) VALUES (?, ?, ?)',
      );
      const insertLink = this.db.prepare(
        'INSERT INTO source_link (entry_id, link_type, target) VALUES (?, ?, ?)',
      );

      for (const entry of bundle.entries) {
        const info = insertEntry.run(
          reportId,
          entry.timeBlock,
          entry.state,
          entry.content,
          entry.orderIndex,
          entry.originalDate ?? null,
          entry.sourceEventId ?? null,
          entry.isManual ? 1 : 0,
          entry.attributionKind,
          entry.attributionConfirmed ? 1 : 0,
        );
        const entryId = Number(info.lastInsertRowid);
        for (const member of entry.members) {
          insertMember.run(entryId, member.memberId, member.role);
        }
        for (const link of entry.links) {
          insertLink.run(entryId, link.linkType, link.target);
        }
      }
      return reportId;
    });

    try {
      return write(input);
    } catch (error) {
      if (error instanceof SdrError) throw error;
      throw new SdrError(
        ERROR_CODES.STORE_TRANSACTION_FAILED,
        `日报四表原子写入失败：${errorMessage(error)}`,
        { source: 'store', cause: error },
      );
    }
  }

  loadReportBundle(reportId: number): ReportBundle | undefined {
    const report = this.findReportById(reportId);
    if (report === undefined) return undefined;
    return {
      report,
      entries: this.findEntriesByReport(reportId),
      links: this.findLinksByReport(reportId),
    };
  }

  findEntriesByReport(reportId: number): Entry[] {
    const rows = this.db
      .prepare('SELECT * FROM entry WHERE report_id = ? ORDER BY order_index ASC, id ASC')
      .all(reportId) as EntryRow[];
    const memberRows = this.db
      .prepare(
        `SELECT em.entry_id, em.member_id, em.role
           FROM entry_member em
           JOIN entry e ON e.id = em.entry_id
          WHERE e.report_id = ?`,
      )
      .all(reportId) as EntryMemberRow[];

    const byEntry = new Map<number, EntryMember[]>();
    for (const row of memberRows) {
      const list = byEntry.get(row.entry_id) ?? [];
      list.push({ entryId: row.entry_id, memberId: row.member_id, role: row.role });
      byEntry.set(row.entry_id, list);
    }
    return rows.map((row) => toEntry(row, byEntry.get(row.id) ?? []));
  }

  findLinksByReport(reportId: number): SourceLink[] {
    const rows = this.db
      .prepare(
        `SELECT sl.entry_id, sl.link_type, sl.target
           FROM source_link sl
           JOIN entry e ON e.id = sl.entry_id
          WHERE e.report_id = ?`,
      )
      .all(reportId) as SourceLinkRow[];
    return rows.map(toSourceLink);
  }

  /**
   * 团队汇总查询（ADR-006）：投影白名单，只取 display_name / status / state / COUNT，
   * 不读取 entry.content，隐私边界设在查询层。
   */
  findSummaryRows(reportDate: string): SummaryQueryRow[] {
    return this.db.prepare(SUMMARY_SQL).all(reportDate) as SummaryQueryRow[];
  }

  /** 删除日报及其全部条目、归属与链接（用于重新生成草稿）。 */
  deleteReport(reportId: number): void {
    const remove = this.db.transaction((id: number): void => {
      const entryIds = 'SELECT id FROM entry WHERE report_id = ?';
      this.db.prepare(`DELETE FROM entry_member WHERE entry_id IN (${entryIds})`).run(id);
      this.db.prepare(`DELETE FROM source_link WHERE entry_id IN (${entryIds})`).run(id);
      this.db.prepare('DELETE FROM entry WHERE report_id = ?').run(id);
      this.db.prepare('DELETE FROM report WHERE id = ?').run(id);
    });
    remove(reportId);
  }

  /** 删除条目及其归属、链接（无级联删除，须按外键顺序清理）。 */
  deleteEntry(entryId: number): void {
    const remove = this.db.transaction((id: number): void => {
      this.db.prepare('DELETE FROM entry_member WHERE entry_id = ?').run(id);
      this.db.prepare('DELETE FROM source_link WHERE entry_id = ?').run(id);
      this.db.prepare('DELETE FROM entry WHERE id = ?').run(id);
    });
    remove(entryId);
  }

  /**
   * 确认归属：`all` 为真时一次性确认该日报全部 [待确认] 条目，否则只确认最早一条。
   * 返回实际确认条数（T-004 / R-13）。
   */
  acceptAttribution(reportId: number, all: boolean): number {
    const statement = all
      ? 'UPDATE entry SET attribution_confirmed = 1 WHERE report_id = ? AND attribution_confirmed = 0'
      : `UPDATE entry SET attribution_confirmed = 1
          WHERE id = (SELECT id FROM entry
                       WHERE report_id = ? AND attribution_confirmed = 0
                       ORDER BY order_index ASC, id ASC LIMIT 1)`;
    return this.db.prepare(statement).run(reportId).changes;
  }
}

/** 打开（或创建）数据库并建表，返回数据访问层实例。 */
export function openRepo(dbPath: string, clock: Clock): Repo {
  const db = new Database(dbPath);
  initSchema(db);
  return new Repo(db, clock);
}


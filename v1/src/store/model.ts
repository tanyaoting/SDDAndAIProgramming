import { parseInstant } from '../clock.js';
import type {
  AttributionKind,
  Entry,
  EntryMember,
  EntryState,
  Event,
  EventKind,
  LinkType,
  Report,
  ReportStatus,
  Source,
  SourceLink,
} from '../types.js';

/* 读写契约 */

export interface EntryMemberInput {
  readonly memberId: number;
  readonly role: 'primary' | 'co';
}

export interface SourceLinkInput {
  readonly linkType: LinkType;
  readonly target: string;
}

export interface EntryInput {
  readonly timeBlock: string;
  readonly state: EntryState;
  readonly content: string;
  readonly orderIndex: number;
  readonly originalDate?: string;
  readonly sourceEventId?: number;
  readonly isManual: boolean;
  readonly attributionKind: AttributionKind;
  readonly attributionConfirmed: boolean;
  readonly members: readonly EntryMemberInput[];
  readonly links: readonly SourceLinkInput[];
}

export interface ReportInput {
  readonly memberId: number;
  readonly reportDate: string;
  readonly status: ReportStatus;
  readonly body?: string;
}

export interface ReportBundleInput extends ReportInput {
  readonly entries: readonly EntryInput[];
}

export interface ReportBundle {
  readonly report: Report;
  readonly entries: readonly Entry[];
  readonly links: readonly SourceLink[];
}

export interface InsertEventResult {
  readonly id: number;
  readonly inserted: boolean;
}

/** 团队汇总的查询行（仅计数与状态，不含正文）。 */
export interface SummaryQueryRow {
  readonly memberId: number;
  readonly displayName: string;
  readonly status: ReportStatus | null;
  readonly state: EntryState | null;
  readonly entryCount: number;
}

/** 投影白名单（ADR-006 / CS-09）：不得出现 entry.content。 */
export const SUMMARY_SQL = `
  SELECT m.id           AS memberId,
         m.display_name AS displayName,
         r.status       AS status,
         e.state        AS state,
         COUNT(e.id)    AS entryCount
    FROM member m
    LEFT JOIN report r ON r.member_id = m.id AND r.report_date = ?
    LEFT JOIN entry e ON e.report_id = r.id
   WHERE m.active = 1
   GROUP BY m.id, m.display_name, r.status, e.state
   ORDER BY m.display_name ASC
`;

/* ------------------------------------------------------------------ */
/* 行类型（snake_case）与映射（→ camelCase）                            */
/* 映射集中在本文件，repo.ts 只做 SQL 与事务编排，避免映射散落。        */
/* ------------------------------------------------------------------ */

export interface EventRow {
  id: number;
  member_id: number;
  source: Source;
  source_id: string;
  kind: EventKind;
  occurred_at: string;
  title: string;
  detail: string | null;
  dedupe_key: string;
  is_primary: number;
  run_id: string;
  payload: string | null;
}

export interface ReportRow {
  id: number;
  member_id: number;
  report_date: string;
  status: ReportStatus;
  body: string | null;
  generated_at: string;
  pushed_at: string | null;
}

export interface EntryRow {
  id: number;
  report_id: number;
  time_block: string;
  state: EntryState;
  content: string;
  order_index: number;
  original_date: string | null;
  source_event_id: number | null;
  is_manual: number;
  attribution_kind: AttributionKind;
  attribution_confirmed: number;
}

export interface EntryMemberRow {
  entry_id: number;
  member_id: number;
  role: 'primary' | 'co';
}

export interface SourceLinkRow {
  entry_id: number;
  link_type: LinkType;
  target: string;
}

export function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    memberId: row.member_id,
    source: row.source,
    sourceId: row.source_id,
    kind: row.kind,
    occurredAt: parseInstant(row.occurred_at),
    title: row.title,
    ...(row.detail === null ? {} : { detail: row.detail }),
    dedupeKey: row.dedupe_key,
    isPrimary: row.is_primary === 1,
    runId: row.run_id,
    ...(row.payload === null ? {} : { payload: JSON.parse(row.payload) as unknown }),
  };
}

export function toReport(row: ReportRow): Report {
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

export function toEntry(row: EntryRow, members: readonly EntryMember[]): Entry {
  return {
    id: row.id,
    reportId: row.report_id,
    timeBlock: row.time_block,
    state: row.state,
    content: row.content,
    orderIndex: row.order_index,
    ...(row.original_date === null ? {} : { originalDate: row.original_date }),
    ...(row.source_event_id === null ? {} : { sourceEventId: row.source_event_id }),
    isManual: row.is_manual === 1,
    attributionKind: row.attribution_kind,
    attributionConfirmed: row.attribution_confirmed === 1,
    members,
  };
}

export function toSourceLink(row: SourceLinkRow): SourceLink {
  return { entryId: row.entry_id, linkType: row.link_type, target: row.target };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

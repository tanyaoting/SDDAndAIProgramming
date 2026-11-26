import { parseInstant } from '../clock.js';
import type { Entry, EntryState, Event, Member, Report } from '../types.js';
import type { EntryRow, EventRow, MemberRow, ReportRow } from './repo-types.js';

export function emptyByState(): Record<EntryState, number> {
  return { done: 0, doing: 0, plan: 0, blocked: 0 };
}

export function mapMemberFull(row: MemberRow): Member {
  return {
    id: row.id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    active: row.active === 1,
    ...(row.feishu_open_id !== null ? { feishuOpenId: row.feishu_open_id } : {}),
    ...(row.email !== null ? { email: row.email } : {}),
    ...(row.manager_id !== null ? { managerId: row.manager_id } : {}),
  };
}

export function mapEvent(row: EventRow): Event {
  const base: Event = {
    id: row.id,
    memberId: row.member_id,
    source: row.source,
    sourceId: row.source_id,
    kind: row.kind,
    occurredAt: parseInstant(row.occurred_at),
    title: row.title,
    dedupeKey: row.dedupe_key,
    isPrimary: row.is_primary === 1,
    runId: row.run_id,
  };
  if (row.detail !== null) {
    const withDetail = { ...base, detail: row.detail };
    if (row.payload !== null) {
      return { ...withDetail, payload: JSON.parse(row.payload) as unknown };
    }
    return withDetail;
  }
  if (row.payload !== null) {
    return { ...base, payload: JSON.parse(row.payload) as unknown };
  }
  return base;
}

export function mapEntryRow(e: EntryRow): Entry {
  return {
    id: e.id,
    reportId: e.report_id,
    timeBlock: e.time_block,
    state: e.state,
    content: e.content,
    orderIndex: e.order_index,
    isManual: e.is_manual === 1,
    attributionKind: e.attribution_kind,
    attributionConfirmed: e.attribution_confirmed === 1,
    ...(e.original_date !== null ? { originalDate: e.original_date } : {}),
    ...(e.source_event_id !== null ? { sourceEventId: e.source_event_id } : {}),
  };
}

export function mapReportRow(row: ReportRow): Report {
  return {
    id: row.id,
    memberId: row.member_id,
    reportDate: row.report_date,
    status: row.status,
    generatedAt: parseInstant(row.generated_at),
    ...(row.body !== null ? { body: row.body } : {}),
    ...(row.pushed_at !== null ? { pushedAt: parseInstant(row.pushed_at) } : {}),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
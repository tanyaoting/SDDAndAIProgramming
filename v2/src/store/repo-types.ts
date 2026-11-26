import type { Entry, EntryMember, EntryState, Event, Report, ReportStatus, Source, SourceLink } from '../types.js';

export class HistoryAccessDenied extends Error {
  override readonly name = 'HistoryAccessDenied';

  constructor() {
    super('无权访问该成员历史日报');
  }
}

export const SUMMARY_ROWS_SQL = `
SELECT
  m.id AS member_id,
  m.display_name,
  r.status,
  e.state,
  COUNT(*) AS state_count
FROM member m
LEFT JOIN report r ON r.member_id = m.id AND r.report_date = ?
LEFT JOIN entry e ON e.report_id = r.id
WHERE m.active = 1
GROUP BY m.id, m.display_name, r.status, e.state
ORDER BY m.display_name
`;

export type MemberRow = {
  id: number;
  github_login: string;
  feishu_open_id: string | null;
  display_name: string;
  email: string | null;
  manager_id: number | null;
  active: number;
  created_at: string;
};

export type EventRow = {
  id: number;
  member_id: number;
  source: Source;
  source_id: string;
  kind: Event['kind'];
  occurred_at: string;
  title: string;
  detail: string | null;
  dedupe_key: string;
  is_primary: number;
  run_id: string;
  payload: string | null;
  created_at: string;
};

export interface SaveReportBundleEntry {
  readonly timeBlock: string;
  readonly state: Entry['state'];
  readonly content: string;
  readonly orderIndex: number;
  readonly originalDate?: string;
  readonly sourceEventId?: number;
  readonly isManual: boolean;
  readonly attributionKind: Entry['attributionKind'];
  readonly attributionConfirmed: boolean;
  readonly members: ReadonlyArray<Omit<EntryMember, 'entryId'>>;
  readonly links: ReadonlyArray<Omit<SourceLink, 'entryId'>>;
}

export interface SaveReportBundleInput {
  readonly report: Omit<Report, 'id'>;
  readonly entries: readonly SaveReportBundleEntry[];
}

export interface HistoryReport {
  readonly report: Report;
  readonly entries: Entry[];
}

export interface IngestionRunInput {
  readonly runId: string;
  readonly source: Source;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly result: 'ok' | 'partial' | 'failed' | 'skipped';
  readonly errorCode?: string;
  readonly errorMsg?: string;
  readonly eventCount: number;
}

export interface PushLogInput {
  readonly reportDate: string;
  readonly channel: string;
  readonly sentAt: Date;
  readonly result: string;
  readonly retryCount?: number;
}

export interface ConsentInput {
  readonly memberId: number;
  readonly agreedAt: Date;
  readonly scope: string;
}

export type SummaryQueryRow = {
  member_id: number;
  display_name: string;
  status: ReportStatus | null;
  state: EntryState | null;
  state_count: number;
};

export type ReportRow = {
  id: number;
  member_id: number;
  report_date: string;
  status: ReportStatus;
  body: string | null;
  generated_at: string;
  pushed_at: string | null;
};

export type EntryRow = {
  id: number;
  report_id: number;
  time_block: string;
  state: EntryState;
  content: string;
  order_index: number;
  original_date: string | null;
  source_event_id: number | null;
  is_manual: number;
  attribution_kind: Entry['attributionKind'];
  attribution_confirmed: number;
};
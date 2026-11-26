export type Source = 'github' | 'feishu' | 'local' | 'manual';
export type EntryState = 'done' | 'doing' | 'plan' | 'blocked';
export type ReportStatus = 'draft' | 'confirmed' | 'leave' | 'blank';
export type AttributionKind = 'author' | 'coauthor' | 'task_window' | 'fallback';
export type LinkType = 'url' | 'path' | 'note';
export type EventKind = 'commit' | 'task_done' | 'file_change' | 'note';

export interface Clock {
  now(): Date;
  readonly timeZone: 'Asia/Shanghai';
}

export interface Member {
  readonly id: number;
  readonly githubLogin: string;
  readonly feishuOpenId?: string;
  readonly displayName: string;
  readonly email?: string;
  readonly managerId?: number;
  readonly active: boolean;
}

export interface Event {
  readonly id?: number;
  readonly memberId: number;
  readonly source: Source;
  readonly sourceId: string;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly title: string;
  readonly detail?: string;
  readonly dedupeKey: string;
  readonly isPrimary: boolean;
  readonly runId: string;
  readonly payload?: unknown;
}

export interface Report {
  readonly id?: number;
  readonly memberId: number;
  readonly reportDate: string;
  readonly status: ReportStatus;
  readonly body?: string;
  readonly generatedAt: Date;
  readonly pushedAt?: Date;
}

export interface Entry {
  readonly id?: number;
  readonly reportId: number;
  readonly timeBlock: string;
  readonly state: EntryState;
  readonly content: string;
  readonly orderIndex: number;
  readonly originalDate?: string;
  readonly sourceEventId?: number;
  readonly isManual: boolean;
  readonly attributionKind: AttributionKind;
  readonly attributionConfirmed: boolean;
  readonly members?: readonly EntryMember[];
}

export interface EntryMember {
  readonly entryId: number;
  readonly memberId: number;
  readonly role: 'primary' | 'co';
}

export interface SourceLink {
  readonly entryId: number;
  readonly linkType: LinkType;
  readonly target: string;
}

export interface SummaryRow {
  readonly memberId: number;
  readonly displayName: string;
  readonly status: ReportStatus | null;
  readonly entryCount: number;
  readonly byState: Readonly<Record<EntryState, number>>;
}

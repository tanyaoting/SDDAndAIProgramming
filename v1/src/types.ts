/**
 * 核心类型（design.md §4.1）。
 * 字段一律 readonly：条目生成后不就地修改，编辑走「新建 + 删除旧条目」。
 */

export type Source = 'github' | 'feishu' | 'local' | 'manual';

/** 条目状态：既是进展阶段，也是渲染分组依据。 */
export type EntryState = 'done' | 'doing' | 'plan' | 'blocked';

export type ReportStatus = 'draft' | 'confirmed' | 'leave' | 'blank';

export type AttributionKind = 'author' | 'coauthor' | 'task_window' | 'fallback';

export type LinkType = 'url' | 'path' | 'note';

export type EventKind = 'commit' | 'task_done' | 'file_change' | 'note';

/** 时钟端口：业务代码不得直接调用 new Date()（design.md ADR-007 / R-10）。 */
export interface Clock {
  now(): Date;
  readonly timeZone: 'Asia/Shanghai';
}

export interface Event {
  readonly id?: number;
  /** 事实源作者（提交作者 / 文件所有者），不是归属声明；归属见 EntryMember。 */
  readonly memberId: number;
  readonly source: Source;
  readonly sourceId: string;
  readonly kind: EventKind;
  /** 带偏移的时间点；落库时格式化为带 +08:00 的 ISO 8601。 */
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
  /** 日期（YYYY-MM-DD，Asia/Shanghai）。 */
  readonly reportDate: string;
  readonly status: ReportStatus;
  /** 渲染后的邮件正文快照；编辑以 entry 为准，推送前重渲染。 */
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
  /** 跨天任务起始日（CS-16），同日开始为 undefined。 */
  readonly originalDate?: string;
  readonly sourceEventId?: number;
  readonly isManual: boolean;
  readonly attributionKind: AttributionKind;
  /** false → 渲染 [待确认]，由 acceptAttribution 置 true。 */
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

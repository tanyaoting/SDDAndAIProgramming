import { dayKey, parseInstant } from '../clock.js';
import type { KeywordRule, WorkBlock } from '../config.js';
import type { Repo, EntryInput, SourceLinkInput } from '../store/repo.js';
import type { Clock, Entry, EntryState, Event, ReportStatus, SourceLink } from '../types.js';
import { resolveAttribution } from './attribution.js';
import type { RepoIndex } from './attribution.js';
import { classifyState } from './extract.js';
import { renderEntry } from './render.js';
import { assignBlocks } from './timeline.js';

const STATE_VALUES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];

export interface GenerateReportOptions {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly memberId: number;
  readonly reportDate: string;
  readonly events: readonly Event[];
  readonly rules: readonly KeywordRule[];
  readonly blocks: readonly WorkBlock[];
  readonly repoIndex: RepoIndex;
  readonly force?: boolean;
  readonly leave?: boolean;
}

export interface GenerateReportResult {
  readonly reportId: number;
  readonly status: ReportStatus;
  readonly skipped: boolean;
}

function payloadOf(event: Event): Record<string, unknown> | undefined {
  return typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : undefined;
}

function eventState(event: Event, rules: readonly KeywordRule[]): EntryState {
  const state = payloadOf(event)?.state;
  if (typeof state === 'string' && (STATE_VALUES as readonly string[]).includes(state)) {
    return state as EntryState;
  }
  return classifyState(`${event.title} ${event.detail ?? ''}`, rules).state;
}

function linkForEvent(event: Event): SourceLinkInput {
  const payload = payloadOf(event);
  if (event.source === 'github' && typeof payload?.html_url === 'string') {
    return { linkType: 'url', target: payload.html_url };
  }
  if (event.source === 'local' && typeof payload?.path === 'string') {
    return { linkType: 'path', target: payload.path };
  }
  if (event.source === 'manual' && typeof payload?.ref === 'string') {
    return { linkType: 'note', target: payload.ref };
  }
  return { linkType: 'note', target: `${event.source} ${event.sourceId}` };
}

/** 跨天任务：任务创建日早于日报日期时写入 original_date（CS-16）。 */
function originalDateOf(event: Event, reportDate: string, clock: Clock): string | undefined {
  const raw = payloadOf(event)?.created_at;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const text = String(raw);
  if (text === '' || text === '0') return undefined;
  const created = parseInstant(Number(text));
  if (Number.isNaN(created.getTime())) return undefined;
  const key = dayKey(clock, created);
  return key < reportDate ? key : undefined;
}

/** 把事件装配为条目输入（不落库），按时段与时间排序。 */
export function assembleEntries(options: GenerateReportOptions): EntryInput[] {
  const grouped = assignBlocks(options.events, options.blocks, options.clock);
  const entries: EntryInput[] = [];
  let orderIndex = 0;

  for (const block of options.blocks) {
    for (const event of grouped.get(block.name) ?? []) {
      const attribution = resolveAttribution(event, options.repoIndex);
      const originalDate = originalDateOf(event, options.reportDate, options.clock);
      entries.push({
        timeBlock: block.name,
        state: eventState(event, options.rules),
        content: event.title.trim(),
        orderIndex,
        ...(originalDate === undefined ? {} : { originalDate }),
        ...(event.id === undefined ? {} : { sourceEventId: event.id }),
        isManual: event.source === 'manual',
        attributionKind: attribution.kind,
        attributionConfirmed: attribution.confirmed,
        members: attribution.members.map((member) => ({
          memberId: member.memberId,
          role: member.role,
        })),
        links: [linkForEvent(event)],
      });
      orderIndex += 1;
    }
  }

  return entries;
}

function toEntry(entry: EntryInput): Entry {
  return {
    reportId: 0,
    timeBlock: entry.timeBlock,
    state: entry.state,
    content: entry.content,
    orderIndex: entry.orderIndex,
    ...(entry.originalDate === undefined ? {} : { originalDate: entry.originalDate }),
    ...(entry.sourceEventId === undefined ? {} : { sourceEventId: entry.sourceEventId }),
    isManual: entry.isManual,
    attributionKind: entry.attributionKind,
    attributionConfirmed: entry.attributionConfirmed,
    members: entry.members.map((member) => ({
      entryId: 0,
      memberId: member.memberId,
      role: member.role,
    })),
  };
}

function toLinks(entry: EntryInput): SourceLink[] {
  return entry.links.map((link) => ({ entryId: 0, linkType: link.linkType, target: link.target }));
}

/** 日报正文：与条目渲染结果逐行一致（推送前重渲染，避免两处不一致）。 */
export function renderReportBody(entries: readonly EntryInput[]): string {
  return entries.map((entry) => renderEntry(toEntry(entry), toLinks(entry))).join('\n');
}

function placeholderEntry(
  memberId: number,
  timeBlock: string,
  content: string,
  note: string,
  state: EntryState,
): EntryInput {
  return {
    timeBlock,
    state,
    content,
    orderIndex: 0,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ memberId, role: 'primary' }],
    links: [{ linkType: 'note', target: note }],
  };
}

/**
 * 日报装配与状态机（FR-07 / CS-06 / CS-14）：
 * 请假与空白生成占位条目而非空文件；已确认日报不覆盖，除非 force。
 */
export function generateReport(options: GenerateReportOptions): GenerateReportResult {
  const existing = options.repo.findReport(options.memberId, options.reportDate);
  if (existing !== undefined && existing.status === 'confirmed' && options.force !== true) {
    return { reportId: existing.id ?? 0, status: 'confirmed', skipped: true };
  }
  if (existing?.id !== undefined) {
    options.repo.deleteReport(existing.id);
  }

  const status: ReportStatus =
    options.leave === true ? 'leave' : options.events.length === 0 ? 'blank' : 'draft';
  const firstBlock = options.blocks[0]?.name ?? 'morning';
  const entries =
    status === 'leave'
      ? [placeholderEntry(options.memberId, firstBlock, '请假（未出勤）', '请假', 'plan')]
      : status === 'blank'
        ? [placeholderEntry(options.memberId, firstBlock, '今日无进展记录', '空白模板', 'doing')]
        : assembleEntries(options);

  const reportId = options.repo.saveReportBundle({
    memberId: options.memberId,
    reportDate: options.reportDate,
    status,
    body: renderReportBody(entries),
    entries,
  });

  return { reportId, status, skipped: false };
}

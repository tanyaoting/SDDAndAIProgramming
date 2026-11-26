import { dayKey, parseInstant } from '../clock.js';
import type { KeywordRule, WorkBlock } from '../config.js';
import type { Repo, SaveReportBundleEntry } from '../store/repo.js';
import type { Clock, Entry, EntryState, Event, ReportStatus, SourceLink } from '../types.js';
import { resolveAttribution, type AttributionContext } from './attribution.js';
import { classifyState } from './extract.js';
import { renderEntry } from './render.js';
import { assignBlocks } from './timeline.js';

const STATE_VALUES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];

export interface AssembleReportInput {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly memberId: number;
  readonly reportDate: string;
  readonly events: readonly Event[];
  readonly rules: readonly KeywordRule[];
  readonly blocks: readonly WorkBlock[];
  readonly attributionCtx: AttributionContext;
  readonly force?: boolean;
  readonly leave?: boolean;
}

export interface AssembleReportResult {
  readonly reportId: number;
  readonly status: ReportStatus;
  readonly skipped: boolean;
}

function payloadRecord(event: Event): Record<string, unknown> | undefined {
  return typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : undefined;
}

function stateOf(event: Event, rules: readonly KeywordRule[]): EntryState {
  const raw = payloadRecord(event)?.state;
  if (typeof raw === 'string' && (STATE_VALUES as readonly string[]).includes(raw)) {
    return raw as EntryState;
  }
  return classifyState(`${event.title} ${event.detail ?? ''}`, rules).state;
}

function linkFromEvent(event: Event): Omit<SourceLink, 'entryId'> {
  const payload = payloadRecord(event);
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

function originalDateOf(event: Event, reportDate: string, clock: Clock): string | undefined {
  const raw = payloadRecord(event)?.created_at;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const text = String(raw);
  if (text === '' || text === '0') return undefined;
  const created = parseInstant(Number(text));
  if (Number.isNaN(created.getTime())) return undefined;
  const key = dayKey(clock, created);
  return key < reportDate ? key : undefined;
}

export function buildEntryDrafts(input: AssembleReportInput): SaveReportBundleEntry[] {
  const grouped = assignBlocks(input.events, input.blocks, input.clock);
  const drafts: SaveReportBundleEntry[] = [];
  let orderIndex = 0;

  for (const block of input.blocks) {
    for (const event of grouped.get(block.name) ?? []) {
      const attribution = resolveAttribution(event, input.attributionCtx);
      const originalDate = originalDateOf(event, input.reportDate, input.clock);
      drafts.push({
        timeBlock: block.name,
        state: stateOf(event, input.rules),
        content: event.title.trim(),
        orderIndex,
        ...(originalDate === undefined ? {} : { originalDate }),
        ...(event.id === undefined ? {} : { sourceEventId: event.id }),
        isManual: event.source === 'manual',
        attributionKind: attribution.kind,
        attributionConfirmed: attribution.confirmed,
        members: attribution.members.map((m: (typeof attribution.members)[number]) => ({
          memberId: m.memberId,
          role: m.role,
        })),
        links: [linkFromEvent(event)],
      });
      orderIndex += 1;
    }
  }
  return drafts;
}

function toRenderableEntry(entry: SaveReportBundleEntry): Entry {
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
    members: entry.members.map((m: SaveReportBundleEntry['members'][number]) => ({
      entryId: 0,
      memberId: m.memberId,
      role: m.role,
    })),
  };
}

function toLinks(entry: SaveReportBundleEntry): SourceLink[] {
  return entry.links.map((l: SaveReportBundleEntry['links'][number]) => ({
    entryId: 0,
    linkType: l.linkType,
    target: l.target,
  }));
}

export function renderReportBody(entries: readonly SaveReportBundleEntry[]): string {
  return entries.map((e) => renderEntry(toRenderableEntry(e), toLinks(e))).join('\n');
}

function placeholder(
  memberId: number,
  timeBlock: string,
  content: string,
  note: string,
  state: EntryState,
): SaveReportBundleEntry {
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

export function assembleReport(input: AssembleReportInput): AssembleReportResult {
  const existing = input.repo.findReport(input.memberId, input.reportDate);
  if (existing !== undefined && existing.status === 'confirmed' && input.force !== true) {
    return { reportId: existing.id ?? 0, status: 'confirmed', skipped: true };
  }
  if (existing?.id !== undefined) input.repo.deleteReport(existing.id);

  const status: ReportStatus =
    input.leave === true ? 'leave' : input.events.length === 0 ? 'blank' : 'draft';
  const firstBlock = input.blocks[0]?.name ?? 'morning';
  const fromEvents = buildEntryDrafts(input);
  const leaveCopy =
    fromEvents.length > 0 ? '请假（未出勤，存在当日记录待确认）' : '请假（未出勤）';
  const entries =
    status === 'leave'
      ? [placeholder(input.memberId, firstBlock, leaveCopy, '请假', 'plan'), ...fromEvents]
      : status === 'blank'
        ? [placeholder(input.memberId, firstBlock, '今日无进展记录', '空白模板', 'doing')]
        : fromEvents;

  const { reportId } = input.repo.saveReportBundle({
    report: {
      memberId: input.memberId,
      reportDate: input.reportDate,
      status,
      body: renderReportBody(entries),
      generatedAt: input.clock.now(),
    },
    entries,
  });

  return { reportId, status, skipped: false };
}
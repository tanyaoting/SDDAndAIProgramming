import type { AttributionKind, Event } from '../types.js';

export interface AttributionResult {
  readonly members: readonly { readonly memberId: number; readonly role: 'primary' | 'co' }[];
  readonly kind: AttributionKind;
  /** false → 条目渲染 [待确认]，由 acceptAttribution 批量确认。 */
  readonly confirmed: boolean;
}

/** 协作归属所需的索引（由调用方按成员表构造，生成层不直接读库）。 */
export interface RepoIndex {
  /** 由 Co-authored-by 的姓名或邮箱反查成员。 */
  readonly findMemberByCoauthor: (nameOrEmail: string) => number | undefined;
  /** 同一任务时间窗内的其他操作者。 */
  readonly findTaskWindowMembers: (event: Event) => readonly number[];
}

const COAUTHOR_PATTERN = /co-authored-by:\s*(.+)/gi;

function coauthorIds(event: Event, index: RepoIndex): number[] {
  const text = `${event.title}\n${event.detail ?? ''}`;
  const found = new Set<number>();
  for (const match of text.matchAll(COAUTHOR_PATTERN)) {
    const raw = (match[1] ?? '').trim();
    if (raw === '') continue;
    const email = /<([^>]+)>/.exec(raw)?.[1]?.trim();
    const name = raw.replace(/<[^>]*>/g, '').trim();
    for (const candidate of [email, name]) {
      if (candidate === undefined || candidate === '') continue;
      const memberId = index.findMemberByCoauthor(candidate);
      if (memberId !== undefined && memberId !== event.memberId) found.add(memberId);
    }
  }
  return [...found];
}

/**
 * 三级协作归属（ADR-004）：
 * ① Co-authored-by → coauthor / confirmed；
 * ② 无标记但有任务时间窗 → task_window / confirmed；
 * ③ 仍无法判定 → fallback / 待确认。
 * 非 commit 事件（任务、文件、手工）按事实源作者归属，已确认。
 */
export function resolveAttribution(event: Event, index: RepoIndex): AttributionResult {
  const primary = { memberId: event.memberId, role: 'primary' as const };

  if (event.kind !== 'commit') {
    return { members: [primary], kind: 'author', confirmed: true };
  }

  const coauthors = coauthorIds(event, index);
  if (coauthors.length > 0) {
    return {
      members: [primary, ...coauthors.map((memberId) => ({ memberId, role: 'co' as const }))],
      kind: 'coauthor',
      confirmed: true,
    };
  }

  const taskMembers = index
    .findTaskWindowMembers(event)
    .filter((memberId) => memberId !== event.memberId);
  if (taskMembers.length > 0) {
    return {
      members: [primary, ...taskMembers.map((memberId) => ({ memberId, role: 'co' as const }))],
      kind: 'task_window',
      confirmed: true,
    };
  }

  return { members: [primary], kind: 'fallback', confirmed: false };
}

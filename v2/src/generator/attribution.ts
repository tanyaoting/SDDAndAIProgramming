import type { AttributionKind, Event } from '../types.js';

export interface AttributionResult {
  readonly members: readonly { readonly memberId: number; readonly role: 'primary' | 'co' }[];
  readonly kind: AttributionKind;
  readonly confirmed: boolean;
}

export interface AttributionContext {
  readonly findMemberByGithubLogin: (login: string) => number | undefined;
  readonly findMemberByEmailOrName: (nameOrEmail: string) => number | undefined;
  readonly taskWindowMembers: (event: Event) => readonly number[];
}

const COAUTHOR_LINE = /co-authored-by:\s*(.+)/gi;

function coauthorText(event: Event): string {
  const chunks: string[] = [];
  if (event.detail !== undefined && event.detail !== '') chunks.push(event.detail);
  if (typeof event.payload === 'string') chunks.push(event.payload);
  if (typeof event.payload === 'object' && event.payload !== null) {
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.body === 'string') chunks.push(payload.body);
    if (typeof payload.message === 'string') chunks.push(payload.message);
  }
  return chunks.join('\n');
}

function resolveCoauthors(event: Event, ctx: AttributionContext): number[] {
  const seen = new Set<number>();
  const text = coauthorText(event);
  for (const match of text.matchAll(COAUTHOR_LINE)) {
    const raw = (match[1] ?? '').trim();
    if (raw === '') continue;
    const email = /<([^>]+)>/.exec(raw)?.[1]?.trim();
    const name = raw.replace(/<[^>]*>/g, '').trim();
    const loginGuess = name.includes('@') ? undefined : name.toLowerCase();
    const candidates = [loginGuess, email, name].filter(
      (v): v is string => v !== undefined && v !== '',
    );
    for (const key of candidates) {
      const id =
        ctx.findMemberByGithubLogin(key) ?? ctx.findMemberByEmailOrName(key.toLowerCase());
      if (id !== undefined && id !== event.memberId) seen.add(id);
    }
  }
  return [...seen];
}

/** 三级归属：Co-authored-by → 任务窗 → fallback；禁止单用 event.memberId 冒充多人。 */
export function resolveAttribution(event: Event, ctx: AttributionContext): AttributionResult {
  const primary = { memberId: event.memberId, role: 'primary' as const };

  if (event.kind !== 'commit') {
    return { members: [primary], kind: 'author', confirmed: true };
  }

  const coauthors = resolveCoauthors(event, ctx);
  if (coauthors.length > 0) {
    return {
      members: [primary, ...coauthors.map((memberId) => ({ memberId, role: 'co' as const }))],
      kind: 'coauthor',
      confirmed: true,
    };
  }

  const others = ctx
    .taskWindowMembers(event)
    .filter((memberId) => memberId !== event.memberId);
  if (others.length > 0) {
    return {
      members: [primary, ...others.map((memberId) => ({ memberId, role: 'co' as const }))],
      kind: 'task_window',
      confirmed: true,
    };
  }

  return { members: [primary], kind: 'fallback', confirmed: false };
}
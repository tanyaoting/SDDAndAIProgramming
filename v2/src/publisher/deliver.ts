import type { Member } from '../types.js';

export interface RecipientEnv {
  readonly notifyTo?: string;
  readonly smtpFrom?: string;
}

export interface RecipientQuery {
  readonly memberIds: readonly number[];
  readonly cliTo?: string;
}

function splitAddresses(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function firstNonEmpty(...values: (string | undefined)[]): string[] {
  for (const value of values) {
    const parts = splitAddresses(value);
    if (parts.length > 0) return parts;
  }
  return [];
}

/** 收件人优先 member.email，回退 SDR_NOTIFY_TO / CLI --to / SMTP_FROM（HANDOVER D-03）。 */
export function resolveRecipients(
  members: readonly Member[],
  query: RecipientQuery,
  env: RecipientEnv,
): Map<number, string[]> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const fallback = firstNonEmpty(query.cliTo, env.notifyTo, env.smtpFrom);
  const result = new Map<number, string[]>();

  for (const memberId of query.memberIds) {
    const member = byId.get(memberId);
    const fromEmail = member?.email !== undefined ? splitAddresses(member.email) : [];
    if (fromEmail.length > 0) {
      result.set(memberId, fromEmail);
      continue;
    }
    result.set(memberId, [...fallback]);
  }
  return result;
}
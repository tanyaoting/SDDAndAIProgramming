import { ERROR_CODES, SdrError } from '../errors.js';
import type { Entry, SourceLink } from '../types.js';
import {
  COLLAB_SUFFIX,
  MAX_SENTENCE_LENGTH,
  NOTE_SOURCE_PREFIX,
  PENDING_PREFIX,
  formatOriginalDate,
} from './phrases.js';

function shorten(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SENTENCE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_SENTENCE_LENGTH - 1)}…`;
}

function formatLinks(links: readonly SourceLink[]): string {
  const parts = links.map((link) =>
    link.linkType === 'note' ? `${NOTE_SOURCE_PREFIX}${link.target}` : link.target,
  );
  return `（${parts.join('；')}）`;
}

export function renderEntry(entry: Entry, links: readonly SourceLink[]): string {
  if (links.length === 0) {
    throw new SdrError(ERROR_CODES.SOURCE_LINK_MISSING, `条目缺少来源标识：${entry.content}`, {
      source: 'generator',
    });
  }
  const pending = entry.attributionConfirmed ? '' : PENDING_PREFIX;
  const since = entry.originalDate === undefined ? '' : formatOriginalDate(entry.originalDate);
  const collab = (entry.members?.length ?? 1) > 1 ? COLLAB_SUFFIX : '';
  return `${pending}${since}${shorten(entry.content)}${collab}${formatLinks(links)}`;
}
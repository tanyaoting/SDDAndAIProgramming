export const PENDING_PREFIX = '[待确认] ';
export const COLLAB_SUFFIX = '（协作）';
export const NOTE_SOURCE_PREFIX = '来源：';
export const MAX_SENTENCE_LENGTH = 60;

export function formatOriginalDate(isoDate: string): string {
  return `（自 ${isoDate.slice(5)} 起）`;
}
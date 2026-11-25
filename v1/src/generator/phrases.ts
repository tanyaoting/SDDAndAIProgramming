/** 去人称渲染的固定措辞（ADR-003：措辞以具名常量集中存放）。 */
export const PENDING_PREFIX = '[待确认] ';
export const COLLAB_SUFFIX = '（协作）';
export const NOTE_SOURCE_PREFIX = '来源：';

/** 单句上限（CS-05）。 */
export const MAX_SENTENCE_LENGTH = 60;

/** 跨天任务前缀：`（自 MM-DD 起）`（CS-16）。 */
export function formatOriginalDate(date: string): string {
  return `（自 ${date.slice(5)} 起）`;
}

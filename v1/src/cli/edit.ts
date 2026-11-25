import { join } from 'node:path';
import { dayKey } from '../clock.js';
import { loadKeywordRules, loadWorkBlocks } from '../config.js';
import { renderEntry } from '../generator/render.js';
import { classifyState } from '../generator/extract.js';
import type { ParsedArgs } from './args.js';
import { UsageError, flagValue, hasFlag, requireDate, requireMemberId } from './args.js';
import type { CliContext } from './context.js';
import { KEYWORDS_PATH, WORK_HOURS_PATH } from './generate.js';

/** 重新渲染日报正文快照（design.md §3.3 第 4 条：编辑以 entry 为准，推送前重渲染）。 */
export function rerenderBody(context: CliContext, reportId: number): void {
  const entries = context.repo.findEntriesByReport(reportId);
  const links = context.repo.findLinksByReport(reportId);
  const body = entries
    .map((entry) => renderEntry(entry, links.filter((link) => link.entryId === entry.id)))
    .join('\n');
  context.repo.updateReportBody(reportId, body);
}

/** 编辑命令（design.md §4.2）：增条目、删条目、确认归属；编辑后状态回到 draft。 */
export function runEdit(context: CliContext, args: ParsedArgs): number {
  const date = requireDate(flagValue(args, 'date'), dayKey(context.clock, context.clock.now()));
  const memberId = requireMemberId(flagValue(args, 'member'));
  const addText = flagValue(args, 'add-text');
  const removeEntry = flagValue(args, 'remove-entry');
  const accept = hasFlag(args, 'accept-attribution');

  if (addText === undefined && removeEntry === undefined && !accept) {
    throw new UsageError('edit 需要 --add-text、--remove-entry 或 --accept-attribution 之一');
  }

  const report = context.repo.findReport(memberId, date);
  if (report?.id === undefined) {
    context.stderr(`[edit] ${date} 成员 ${memberId} 没有日报`);
    return 6;
  }
  const reportId = report.id;
  const entries = context.repo.findEntriesByReport(reportId);

  if (removeEntry !== undefined) {
    const entryId = Number(removeEntry);
    if (!entries.some((entry) => entry.id === entryId)) {
      context.stderr(`[edit] 条目不存在：${removeEntry}`);
      return 6;
    }
    context.repo.deleteEntry(entryId);
  }

  if (addText !== undefined) {
    if (addText.trim() === '') throw new UsageError('--add-text 内容不能为空');
    const blocks = loadWorkBlocks(join(context.cwd, WORK_HOURS_PATH));
    const rules = loadKeywordRules(join(context.cwd, KEYWORDS_PATH));
    const state = classifyState(addText, rules).state;
    context.repo.entries.insertEntry(reportId, {
      timeBlock: blocks[0]?.name ?? 'morning',
      state,
      content: addText.trim(),
      orderIndex: entries.length,
      isManual: true,
      attributionKind: 'author',
      attributionConfirmed: true,
      members: [{ memberId, role: 'primary' }],
      links: [{ linkType: 'note', target: '手工补充' }],
    });
  }

  if (accept) {
    const confirmed = context.repo.acceptAttribution(reportId, hasFlag(args, 'all'));
    context.stdout(`[edit] 已确认 ${confirmed} 条归属`);
  }

  rerenderBody(context, reportId);
  context.repo.updateReportStatus(reportId, 'draft');
  context.stdout(`[edit] ${date} 成员 ${memberId} 已更新（draft）`);
  return 0;
}

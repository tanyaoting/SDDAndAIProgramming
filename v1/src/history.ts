import { renderEntry } from './generator/render.js';
import type { Repo } from './store/repo.js';
import type { ReportBundle } from './store/repo.js';
import type { Member } from './types.js';

/**
 * 历史查询与可见性校验（T-020 / CS-09 / CS-10）。
 * 权限判定在查询层完成：调用者既非本人也非直属上级时，不返回任何日报内容。
 */

export interface HistoryRequest {
  readonly actorId?: number;
  readonly memberId: number;
  readonly from: string;
  readonly to: string;
}

export type HistoryResult =
  | { readonly ok: true; readonly member: Member; readonly reports: readonly ReportBundle[] }
  | { readonly ok: false; readonly reason: 'forbidden' };

export function queryHistory(repo: Repo, request: HistoryRequest): HistoryResult {
  if (!repo.members.canAccess(request.actorId, request.memberId)) {
    return { ok: false, reason: 'forbidden' };
  }
  const member = repo.members.findById(request.memberId);
  if (member === undefined) return { ok: false, reason: 'forbidden' };

  const reports = repo.history
    .findReportsBetween(request.memberId, request.from, request.to)
    .flatMap((report) => {
      if (report.id === undefined) return [];
      const bundle = repo.loadReportBundle(report.id);
      return bundle === undefined ? [] : [bundle];
    });
  return { ok: true, member, reports };
}

export function renderHistory(result: { readonly member: Member; readonly reports: readonly ReportBundle[] }): string {
  const { member, reports } = result;
  if (reports.length === 0) return `${member.displayName} 在查询区间内没有日报`;

  const lines: string[] = [];
  for (const bundle of reports) {
    lines.push(`${bundle.report.reportDate} [${bundle.report.status}] ${member.displayName}`);
    for (const entry of bundle.entries) {
      const links = bundle.links.filter((link) => link.entryId === entry.id);
      lines.push(`- [${entry.timeBlock}] ${renderEntry(entry, links)}`);
    }
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

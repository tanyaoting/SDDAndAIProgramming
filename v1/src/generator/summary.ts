import type { Repo } from '../store/repo.js';
import type { EntryState, ReportStatus, SummaryRow } from '../types.js';

export type { SummaryRow } from '../types.js';

const EMPTY_STATE: Record<EntryState, number> = { done: 0, doing: 0, plan: 0, blocked: 0 };
const STATES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];

/**
 * 团队汇总（FR-10 / ADR-006）：聚合查询层返回的计数行，
 * 不读取任何条目正文；每人一行，含状态分布。
 */
export function findSummaryRows(repo: Repo, reportDate: string): SummaryRow[] {
  const rows = repo.findSummaryRows(reportDate);
  const byMember = new Map<number, { displayName: string; status: ReportStatus | null; byState: Record<EntryState, number>; entryCount: number }>();

  for (const row of rows) {
    const current = byMember.get(row.memberId) ?? {
      displayName: row.displayName,
      status: row.status,
      byState: { ...EMPTY_STATE },
      entryCount: 0,
    };
    if (row.state !== null && row.entryCount > 0) {
      current.byState[row.state] += row.entryCount;
      current.entryCount += row.entryCount;
    }
    if (current.status === null) current.status = row.status;
    byMember.set(row.memberId, current);
  }

  return [...byMember.entries()].map(([memberId, value]) => ({
    memberId,
    displayName: value.displayName,
    status: value.status,
    entryCount: value.entryCount,
    byState: value.byState,
  }));
}

function attendanceOf(status: ReportStatus | null): 'normal' | 'leave' | 'blank' {
  if (status === 'leave') return 'leave';
  if (status === 'draft' || status === 'confirmed') return 'normal';
  return 'blank';
}

/** 渲染团队日报：出勤矩阵 + 条目计数/状态分布 + 阻塞定位（无正文）。 */
export function renderTeamSummary(rows: readonly SummaryRow[], reportDate: string): string {
  const counts = { normal: 0, leave: 0, blank: 0 };
  for (const row of rows) counts[attendanceOf(row.status)] += 1;

  const lines = [
    `团队日报 ${reportDate}`,
    `出勤：正常 ${counts.normal} 人 / 请假 ${counts.leave} 人 / 空白 ${counts.blank} 人`,
  ];

  for (const row of rows) {
    const distribution = STATES.map((state) => `${stateLabel(state)} ${row.byState[state]}`).join(' / ');
    lines.push(`- ${row.displayName}（${row.status ?? '未生成'}）：${row.entryCount} 条（${distribution}）`);
  }

  const blocked = rows.filter((row) => row.byState.blocked > 0);
  if (blocked.length > 0) {
    lines.push(
      `阻塞定位：${blocked
        .map(
          (row) =>
            `${row.displayName} ${row.byState.blocked} 条（查看：sdr history --member ${row.memberId} --from ${reportDate} --to ${reportDate}）`,
        )
        .join('；')}`,
    );
  }

  return lines.join('\n');
}

function stateLabel(state: EntryState): string {
  return { done: '完成', doing: '进行中', plan: '计划', blocked: '阻塞' }[state];
}

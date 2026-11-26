import { SUMMARY_ROWS_SQL } from '../store/repo.js';
import type { EntryState, ReportStatus, SummaryRow } from '../types.js';

export { SUMMARY_ROWS_SQL };

const STATES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];

const STATE_LABEL: Record<EntryState, string> = {
  done: '完成',
  doing: '进行中',
  plan: '计划',
  blocked: '阻塞',
};

function attendanceBucket(status: ReportStatus | null): 'normal' | 'leave' | 'blank' {
  if (status === 'leave') return 'leave';
  if (status === 'draft' || status === 'confirmed') return 'normal';
  return 'blank';
}

/** 团队汇总纯文本：出勤矩阵、状态分布、阻塞定位；不含条目正文（CS-09）。 */
export function renderSummary(rows: readonly SummaryRow[], reportDate: string): string {
  const counts = { normal: 0, leave: 0, blank: 0 };
  for (const row of rows) counts[attendanceBucket(row.status)] += 1;

  const lines = [
    `团队日报 ${reportDate}`,
    `出勤：正常 ${counts.normal} 人 / 请假 ${counts.leave} 人 / 空白 ${counts.blank} 人`,
  ];

  for (const row of rows) {
    const breakdown = STATES.map((s) => `${STATE_LABEL[s]} ${row.byState[s]}`).join(' / ');
    lines.push(
      `- ${row.displayName}（${row.status ?? '未生成'}）：${row.entryCount} 条（${breakdown}）`,
    );
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
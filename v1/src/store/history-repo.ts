import type Database from 'better-sqlite3';
import type { Report } from '../types.js';
import type { ReportRow } from './model.js';
import { toReport } from './model.js';

/**
 * 历史查询的数据访问（CS-10）：按人按日区间取 `report`，正文与条目由
 * `Repo.loadReportBundle` 读取，避免在此重复拼装。
 *
 * `report` 上的 UNIQUE(member_id, report_date) 自带索引，区间查询走索引而非全表扫描。
 */
export class HistoryRepo {
  constructor(private readonly db: Database.Database) {}

  findReportsBetween(memberId: number, from: string, to: string): Report[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM report
          WHERE member_id = ? AND report_date >= ? AND report_date <= ?
          ORDER BY report_date DESC`,
      )
      .all(memberId, from, to) as ReportRow[];
    return rows.map(toReport);
  }
}

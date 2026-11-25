import type Database from 'better-sqlite3';
import { toZonedIsoString } from '../clock.js';
import type { Clock, Source } from '../types.js';

/**
 * 审计数据访问（design.md §3.2 ingestion_run / push_log）。
 * - `ingestion_run`：每源一条，记录采集结果与错误码（CS-07 / IR-02）。
 * - `push_log`：推送与补发留痕，也是调度补发的去重依据（CS-08）。
 */

export type IngestionResult = 'ok' | 'partial' | 'failed' | 'skipped';
export type PushResult = 'ok' | 'failed';

export interface IngestionRunInput {
  readonly runId: string;
  readonly source: Source;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly result: IngestionResult;
  readonly errorCode?: string;
  readonly errorMsg?: string;
  readonly eventCount?: number;
}

export interface PushLogInput {
  readonly reportDate: string;
  readonly channel: string;
  readonly sentAt?: Date;
  readonly result: PushResult;
  readonly retryCount?: number;
}

export interface PushLogEntry {
  readonly id: number;
  readonly reportDate: string;
  readonly channel: string;
  readonly sentAt: string;
  readonly result: PushResult;
  readonly retryCount: number;
}

interface PushLogRow {
  id: number;
  report_date: string;
  channel: string;
  sent_at: string;
  result: PushResult;
  retry_count: number;
}

function toPushLog(row: PushLogRow): PushLogEntry {
  return {
    id: row.id,
    reportDate: row.report_date,
    channel: row.channel,
    sentAt: row.sent_at,
    result: row.result,
    retryCount: row.retry_count,
  };
}

export class AuditRepo {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  /** 同一 (run_id, source) 只保留最终状态：重复上报覆盖而非报错。 */
  recordIngestionRun(input: IngestionRunInput): void {
    this.db
      .prepare(
        `INSERT INTO ingestion_run
           (run_id, source, started_at, finished_at, result, error_code, error_msg, event_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, source) DO UPDATE SET
           finished_at = excluded.finished_at,
           result      = excluded.result,
           error_code  = excluded.error_code,
           error_msg   = excluded.error_msg,
           event_count = excluded.event_count`,
      )
      .run(
        input.runId,
        input.source,
        toZonedIsoString(this.clock, input.startedAt),
        input.finishedAt === undefined ? null : toZonedIsoString(this.clock, input.finishedAt),
        input.result,
        input.errorCode ?? null,
        input.errorMsg ?? null,
        input.eventCount ?? 0,
      );
  }

  recordPush(input: PushLogInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO push_log (report_date, channel, sent_at, result, retry_count)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.reportDate,
        input.channel,
        toZonedIsoString(this.clock, input.sentAt ?? this.clock.now()),
        input.result,
        input.retryCount ?? 0,
      );
    return Number(info.lastInsertRowid);
  }

  findPushes(reportDate: string, channel?: string): PushLogEntry[] {
    const rows = (
      channel === undefined
        ? this.db
            .prepare('SELECT * FROM push_log WHERE report_date = ? ORDER BY id ASC')
            .all(reportDate)
        : this.db
            .prepare('SELECT * FROM push_log WHERE report_date = ? AND channel = ? ORDER BY id ASC')
            .all(reportDate, channel)
    ) as PushLogRow[];
    return rows.map(toPushLog);
  }

  /** 补发去重：该日期（可选渠道）已成功推送过即视为已发送（CS-08）。 */
  hasSuccessfulPush(reportDate: string, channel?: string): boolean {
    return this.findPushes(reportDate, channel).some((entry) => entry.result === 'ok');
  }
}

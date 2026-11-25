import { dayKey, dayWindow, parseInstant } from '../clock.js';
import type { Clock } from '../types.js';

/**
 * 调度与补发（FR-11 / CS-08）。
 * 时间一律取自注入的 `Clock`；推送时间由 `pushTime()` 每次读取，
 * 因此修改配置后下一次 tick 立即按新时间判断（无需重启进程）。
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 默认 tick 间隔 60 秒，保证错过时点后 5 分钟内完成补发（CS-08）。 */
export const DEFAULT_TICK_MS = 60_000;

export interface SchedulerOptions {
  readonly clock: Clock;
  /** 推送时间（HH:mm，Asia/Shanghai）；每次 tick 重新读取以支持运行时修改。 */
  readonly pushTime: () => string;
  /** 该日期是否已成功推送（通常查 push_log），用于补发去重。 */
  readonly hasPushed: (reportDate: string) => boolean;
  /** 执行当日推送（可包含多份日报，内部按渠道去重）。 */
  readonly push: (reportDate: string) => Promise<void>;
  readonly logger?: (line: string) => void;
}

export type TickResult =
  | { readonly pushed: false; readonly reportDate: string; readonly reason: 'not-due' | 'already-pushed' }
  | { readonly pushed: true; readonly reportDate: string; readonly catchUp: boolean };

/** 解析 HH:mm 为当日分钟数；非法配置直接抛错（由 config 层保证合法）。 */
export function minutesOfTime(time: string): number {
  const matched = TIME_PATTERN.exec(time);
  if (matched === null) throw new Error(`推送时间格式非法：${time}（应为 HH:mm）`);
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

export class Scheduler {
  private readonly logger: (line: string) => void;

  constructor(private readonly options: SchedulerOptions) {
    this.logger = options.logger ?? ((line: string): void => console.log(line));
  }

  /** 某日的计划推送时刻：以 Asia/Shanghai 当日 00:00 为基准加分钟偏移。 */
  dueInstant(reportDate: string): Date {
    const window = dayWindow(this.options.clock, reportDate);
    return parseInstant(window.since.getTime() + minutesOfTime(this.options.pushTime()) * 60_000);
  }

  async tick(): Promise<TickResult> {
    const now = this.options.clock.now();
    const reportDate = dayKey(this.options.clock, now);
    const due = this.dueInstant(reportDate);
    if (now.getTime() < due.getTime()) {
      return { pushed: false, reportDate, reason: 'not-due' };
    }
    if (this.options.hasPushed(reportDate)) {
      return { pushed: false, reportDate, reason: 'already-pushed' };
    }

    const delayMs = now.getTime() - due.getTime();
    const catchUp = delayMs >= DEFAULT_TICK_MS;
    this.logger(
      `[scheduler] ${reportDate} ${catchUp ? '补发' : '按时'}推送（计划 ${this.options.pushTime()}，延迟 ${Math.round(delayMs / 1000)}s）`,
    );
    await this.options.push(reportDate);
    return { pushed: true, reportDate, catchUp };
  }
}

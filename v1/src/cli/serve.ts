import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_TICK_MS, Scheduler } from '../publisher/scheduler.js';
import type { ParsedArgs } from './args.js';
import { flagValue } from './args.js';
import type { CliContext } from './context.js';
import { defaultRecipients, pushReports } from './push.js';

/** 推送时间格式；运行时可通过环境变量调整（CS-08：修改后下次推送按新时间执行）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 常驻调度（design.md §4.2 serve）：启动后立即 tick 一次，用于补发错过的时点；
 * 之后按 interval 轮询，`pushTime` 每次从环境变量重新读取，因此改配置无需重启。
 */
export async function runServe(context: CliContext, args: ParsedArgs): Promise<number> {
  const fallback = flagValue(args, 'push-time') ?? context.config.pushTime;
  const intervalSeconds = Number(flagValue(args, 'interval') ?? '60');
  const intervalMs =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds * 1000
      : DEFAULT_TICK_MS;

  const pushTime = (): string => {
    const raw = context.env.SDR_PUSH_TIME;
    return raw !== undefined && TIME_PATTERN.test(raw) ? raw : fallback;
  };

  const scheduler = new Scheduler({
    clock: context.clock,
    pushTime,
    hasPushed: (reportDate) => context.repo.audit.hasSuccessfulPush(reportDate),
    push: async (reportDate) => {
      const summary = await pushReports(context, {
        date: reportDate,
        dryRun: false,
        to: defaultRecipients(context),
      });
      if (summary.failed > 0) {
        context.stderr(`[serve] ${reportDate} 有 ${summary.failed} 份日报推送失败，等待下次补发`);
      }
    },
    logger: context.stderr,
  });

  context.stdout(`[serve] 已启动，推送时间 ${pushTime()}（间隔 ${intervalMs / 1000}s）`);
  for (;;) {
    await scheduler.tick();
    await delay(intervalMs);
  }
}

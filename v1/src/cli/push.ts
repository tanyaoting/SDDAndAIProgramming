import type { ParsedArgs } from './args.js';
import { flagList, flagValue, requireDate } from './args.js';
import { dayKey } from '../clock.js';
import { buildMailEntries, deliverReport } from '../publisher/deliver.js';
import { renderMail } from '../publisher/mail.js';
import type { CliContext } from './context.js';
import { alertRecipients } from './context.js';

/**
 * 推送命令（design.md §4.2）：`--dry-run` 只渲染并写 stdout，不发送、不写 push_log。
 * 发送失败由 deliverReport 记录 push_log 并告警，命令最终返回退出码 7。
 */

export interface PushOptions {
  readonly date: string;
  readonly dryRun: boolean;
  readonly to: readonly string[];
}

export interface PushSummary {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly reports: number;
}

/** 收件人：`--to` 优先，其次 `SDR_NOTIFY_TO`，缺省发给发件人自身（演示可用）。 */
export function defaultRecipients(context: CliContext): string[] {
  const raw = context.env.SDR_NOTIFY_TO;
  if (raw !== undefined && raw.trim() !== '') {
    return raw.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  return [context.config.smtp.from];
}

export function pushRecipients(context: CliContext, args: ParsedArgs): string[] {
  const explicit = flagList(args, 'to');
  return explicit.length > 0 ? explicit : defaultRecipients(context);
}

/** 推送某日全部在册成员的日报；同渠道已成功推送的自动跳过（补发去重）。 */
export async function pushReports(context: CliContext, options: PushOptions): Promise<PushSummary> {
  const members = context.repo.members.listActive();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let reports = 0;

  for (const member of members) {
    const report = context.repo.findReport(member.id, options.date);
    if (report?.id === undefined) continue;
    reports += 1;

    if (options.dryRun) {
      const rendered = renderMail({
        reportDate: options.date,
        memberName: member.displayName,
        entries: buildMailEntries(context.repo, report.id),
      });
      context.stdout(`=== ${rendered.subject} ===`);
      context.stdout(rendered.text);
      context.stdout('');
      sent += 1;
      continue;
    }

    const outcome = await deliverReport({
      repo: context.repo,
      mailer: context.mailer,
      clock: context.clock,
      reportDate: options.date,
      member,
      report,
      to: options.to,
      alertTo: alertRecipients(context),
      logger: context.stderr,
    });
    if (outcome.status === 'sent') {
      sent += 1;
      context.stdout(`[push] ${member.displayName} ${options.date} 已发送`);
    } else if (outcome.status === 'skipped') {
      skipped += 1;
      context.stdout(`[push] ${member.displayName} ${options.date} 已发送过，跳过`);
    } else {
      failed += 1;
      context.stderr(`[push] ${member.displayName} ${options.date} 发送失败`);
    }
  }

  return { sent, skipped, failed, reports };
}

export async function runPush(context: CliContext, args: ParsedArgs): Promise<number> {
  const date = requireDate(flagValue(args, 'date'), dayKey(context.clock, context.clock.now()));
  const summary = await pushReports(context, {
    date,
    dryRun: args.values.get('dry-run') === true,
    to: pushRecipients(context, args),
  });
  if (summary.reports === 0) context.stderr(`[push] ${date} 没有日报可推送`);
  return summary.failed > 0 ? 7 : 0;
}

import { toZonedIsoString } from '../clock.js';
import type { SdrError } from '../errors.js';
import type { Repo } from '../store/repo.js';
import type { Clock, Member, Report } from '../types.js';
import { notifyFailure } from './alert.js';
import type { MailEntry, Mailer } from './mail.js';
import { renderMail } from './mail.js';

/**
 * 单份日报的投递编排：渲染 → 发送 → 写 push_log → 失败告警（T-018）。
 * 补发去重与重试次数都以 `push_log` 为准，调度器只负责调用时机（T-019）。
 */

export const MAIL_RESULT_FIELDS = ['ok', 'failed'] as const;

/** 渠道标识：同一成员同一天的推送记录唯一（push_log 无 member_id 列）。 */export function mailChannel(memberId: number): string {
  return `email:member:${memberId}`;
}

export interface DeliverInput {
  readonly repo: Repo;
  readonly mailer: Mailer;
  readonly clock: Clock;
  readonly reportDate: string;
  readonly member: Member;
  readonly report: Report;
  readonly to: readonly string[];
  readonly alertTo: readonly string[];
  readonly logger?: (line: string) => void;
}

export type DeliverOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'skipped' }
  | { readonly status: 'failed'; readonly error: SdrError | Error };

export function buildMailEntries(repo: Repo, reportId: number): MailEntry[] {
  const entries = repo.findEntriesByReport(reportId);
  const links = repo.findLinksByReport(reportId);
  return entries.map((entry) => ({
    entry,
    links: links.filter((link) => link.entryId === entry.id),
  }));
}

export async function deliverReport(input: DeliverInput): Promise<DeliverOutcome> {
  const logger = input.logger ?? ((line: string): void => console.warn(line));
  const reportId = input.report.id;
  if (reportId === undefined) {
    return { status: 'failed', error: new Error('日报缺少 id，无法投递') };
  }

  const channel = mailChannel(input.member.id);
  if (input.repo.audit.hasSuccessfulPush(input.reportDate, channel)) {
    logger(`[deliver] ${input.reportDate} ${input.member.displayName} 已成功推送，跳过（补发去重）`);
    return { status: 'skipped' };
  }

  const retryCount = input.repo.audit
    .findPushes(input.reportDate, channel)
    .filter((entry) => entry.result === 'failed').length;

  try {
    const rendered = renderMail({
      reportDate: input.reportDate,
      memberName: input.member.displayName,
      entries: buildMailEntries(input.repo, reportId),
    });
    await input.mailer.send({ to: input.to, subject: rendered.subject, text: rendered.text });
    input.repo.audit.recordPush({
      reportDate: input.reportDate,
      channel,
      sentAt: input.clock.now(),
      result: 'ok',
      retryCount,
    });
    input.repo.updateReportPushedAt(reportId, input.clock.now());
    return { status: 'sent' };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'SDR-E402';
    input.repo.audit.recordPush({
      reportDate: input.reportDate,
      channel,
      sentAt: input.clock.now(),
      result: 'failed',
      retryCount: retryCount + 1,
    });
    const message = error instanceof Error ? error.message : String(error);
    await notifyFailure({
      mailer: input.mailer,
      to: input.alertTo,
      logger,
      alert: {
        code,
        layer: `推送（${input.member.displayName}）`,
        message,
        occurredAt: toZonedIsoString(input.clock, input.clock.now()),
      },
    });
    return { status: 'failed', error: error instanceof Error ? error : new Error(message) };
  }
}

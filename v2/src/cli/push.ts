import type { SdrConfig } from '../config.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { renderSummary } from '../generator/summary.js';
import { sendFailureAlert } from '../publisher/alert.js';
import { resolveRecipients } from '../publisher/deliver.js';
import {
  createMailTransport,
  renderMailText,
  sendMail,
  type MailTransport,
} from '../publisher/mail.js';
import { evaluatePushSchedule } from '../publisher/scheduler.js';
import type { Repo } from '../store/repo.js';
import type { Clock } from '../types.js';
import { EXIT, type ExitCode } from './exit.js';

export interface PushContext {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly config: SdrConfig;
  readonly transport?: MailTransport;
  readonly notifyTo?: string;
}

export interface PushOptions {
  readonly date: string;
  readonly dryRun?: boolean;
  readonly to?: string;
  readonly forceSchedule?: boolean;
}

export async function runPush(
  ctx: PushContext,
  options: PushOptions,
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<ExitCode> {
  const channel = 'daily';
  const alreadySent = ctx.repo.hasPushLogOk(options.date, channel);
  const schedule = evaluatePushSchedule(ctx.clock, ctx.config.pushTime, options.date, alreadySent);
  if (options.dryRun !== true && options.forceSchedule !== true && !schedule.shouldSend) {
    if (schedule.reason === 'already_sent') return EXIT.OK;
    if (schedule.reason === 'too_early') return EXIT.OK;
  }

  const members = ctx.repo.listActiveMembers();
  const smtp = ctx.config.smtp;
  const transport = ctx.transport ?? createMailTransport(smtp);
  let failed = false;

  for (const member of members) {
    const report = ctx.repo.findReport(member.id ?? 0, options.date);
    if (report === undefined || report.body === undefined || report.body.trim() === '') continue;

    const mail = renderMailText({
      displayName: member.displayName,
      reportDate: options.date,
      body: report.body,
    });

    if (options.dryRun === true) {
      write(`${mail.text}\n\n`);
      continue;
    }

    const recipients = resolveRecipients(
      [member],
      { memberIds: [member.id ?? 0], ...(options.to === undefined ? {} : { cliTo: options.to }) },
      {
        ...(ctx.notifyTo === undefined ? {} : { notifyTo: ctx.notifyTo }),
        smtpFrom: smtp.from,
      },
    );
    const to = recipients.get(member.id ?? 0) ?? [];
    if (to.length === 0) continue;

    try {
      await sendMail(transport, { to, subject: mail.subject, text: mail.text, from: smtp.from });
      ctx.repo.insertPushLog({
        reportDate: options.date,
        channel: `member:${member.id}`,
        sentAt: ctx.clock.now(),
        result: 'ok',
      });
    } catch (error) {
      failed = true;
      const code = error instanceof SdrError ? error.code : ERROR_CODES.SMTP_TIMEOUT;
      ctx.repo.insertPushLog({
        reportDate: options.date,
        channel: `member:${member.id}`,
        sentAt: ctx.clock.now(),
        result: code,
      });
      const notify =
        ctx.notifyTo
          ?.split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean) ?? [smtp.from];
      await sendFailureAlert({
        transport,
        smtp,
        notifyTo: notify,
        phase: 'push',
        errorCode: error instanceof SdrError ? error.code : ERROR_CODES.SMTP_TIMEOUT,
        message: error instanceof Error ? error.message : '推送失败',
        reportDate: options.date,
      }).catch(() => undefined);
    }
  }

  const summary = renderSummary(ctx.repo.findSummaryRows(options.date), options.date);
  const summaryMail = renderMailText({
    displayName: '团队',
    reportDate: options.date,
    body: summary,
  });

  if (options.dryRun === true) {
    write(`${summaryMail.text}\n`);
    return EXIT.OK;
  }

  if (!failed) {
    const notifyFallback = resolveRecipients(
      [],
      { memberIds: [] },
      {
        ...(ctx.notifyTo === undefined ? {} : { notifyTo: ctx.notifyTo }),
        smtpFrom: smtp.from,
      },
    );
    const teamTo =
      ctx.notifyTo
        ?.split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s !== '') ?? [];
    const addresses =
      teamTo.length > 0
        ? teamTo
        : [...notifyFallback.values()].flat().length > 0
          ? [...notifyFallback.values()].flat()
          : [smtp.from];
    try {
      await sendMail(transport, {
        to: addresses,
        subject: summaryMail.subject,
        text: summaryMail.text,
        from: smtp.from,
      });
      ctx.repo.insertPushLog({
        reportDate: options.date,
        channel,
        sentAt: ctx.clock.now(),
        result: 'ok',
        retryCount: schedule.retryCount,
      });
      return EXIT.OK;
    } catch (error) {
      failed = true;
      ctx.repo.insertPushLog({
        reportDate: options.date,
        channel,
        sentAt: ctx.clock.now(),
        result: error instanceof SdrError ? error.code : ERROR_CODES.SMTP_TIMEOUT,
      });
    }
  }

  return failed ? EXIT.PUSH_FAILED : EXIT.OK;
}
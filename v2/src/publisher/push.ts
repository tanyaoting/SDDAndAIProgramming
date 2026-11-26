import type { Repo } from '../store/repo.js';
import type { SdrConfig } from '../config.js';
import type { Clock } from '../types.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { sendFailureAlert } from './alert.js';
import { resolveRecipients } from './deliver.js';
import {
  createMailTransport,
  renderMailText,
  sendMail,
  type MailTransport,
} from './mail.js';

export interface PushMemberOptions {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly config: SdrConfig;
  readonly transport?: MailTransport;
  readonly reportDate: string;
  readonly memberId: number;
  readonly displayName: string;
  readonly body: string;
  readonly cliTo?: string;
  readonly dryRun?: boolean;
  readonly notifyTo?: string;
}

export async function pushMemberReport(options: PushMemberOptions): Promise<void> {
  const mail = renderMailText({
    displayName: options.displayName,
    reportDate: options.reportDate,
    body: options.body,
  });

  if (options.dryRun === true) {
    process.stdout.write(`${mail.text}\n`);
    return;
  }

  const smtp = options.config.smtp;
  const transport = options.transport ?? createMailTransport(smtp);
  const member = options.repo.getMember(options.memberId);
  const recipients = resolveRecipients(
    member === undefined ? [] : [member],
    { memberIds: [options.memberId], ...(options.cliTo === undefined ? {} : { cliTo: options.cliTo }) },
    {
      ...(options.notifyTo === undefined ? {} : { notifyTo: options.notifyTo }),
      smtpFrom: smtp.from,
    },
  );
  const to = recipients.get(options.memberId) ?? [];
  if (to.length === 0) {
    throw new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, '无可用收件人');
  }

  const sentAt = options.clock.now();
  try {
    await sendMail(transport, { to, subject: mail.subject, text: mail.text });
    options.repo.insertPushLog({
      reportDate: options.reportDate,
      channel: `member:${options.memberId}`,
      sentAt,
      result: 'ok',
    });
  } catch (error) {
    const code = error instanceof SdrError ? error.code : ERROR_CODES.SMTP_TIMEOUT;
    options.repo.insertPushLog({
      reportDate: options.reportDate,
      channel: `member:${options.memberId}`,
      sentAt,
      result: code,
    });
    const notify =
      options.notifyTo !== undefined
        ? options.notifyTo
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [smtp.from];
    await sendFailureAlert({
      transport,
      smtp,
      notifyTo: notify,
      phase: 'push',
      errorCode: code,
      message: error instanceof Error ? error.message : '推送失败',
      reportDate: options.reportDate,
    }).catch(() => undefined);
    throw error;
  }
}
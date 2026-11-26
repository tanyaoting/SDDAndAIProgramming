import type { ErrorCode } from '../errors.js';
import {
  renderMailSubject,
  sendMail,
  type MailTransport,
  type SmtpSettings,
} from './mail.js';

export type AlertPhase = 'collect' | 'push';

export interface AlertInput {
  readonly phase: AlertPhase;
  readonly errorCode: ErrorCode;
  readonly message: string;
  readonly reportDate: string;
  readonly source?: string;
}

export function renderAlertText(input: AlertInput): string {
  const lines = [
    `【SDR 告警】阶段=${input.phase}`,
    `日期=${input.reportDate}`,
    `错误码=${input.errorCode}`,
    `说明=${input.message}`,
  ];
  if (input.source !== undefined && input.source !== '') {
    lines.push(`来源=${input.source}`);
  }
  return lines.join('\n');
}

export interface SendFailureAlertOptions extends AlertInput {
  readonly transport: MailTransport;
  readonly smtp: SmtpSettings;
  readonly notifyTo: readonly string[];
}

export async function sendFailureAlert(options: SendFailureAlertOptions): Promise<void> {
  const text = renderAlertText(options);
  const subject = renderMailSubject('运维', `告警 ${options.reportDate}`);
  if (options.notifyTo.length === 0) return;
  await sendMail(options.transport, {
    to: options.notifyTo,
    subject,
    text,
    from: options.smtp.from,
  });
}
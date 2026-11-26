import nodemailer, { type Transporter } from 'nodemailer';
import { ERROR_CODES, SdrError } from '../errors.js';

export interface RenderMailInput {
  readonly displayName: string;
  readonly reportDate: string;
  readonly body: string;
  readonly summary?: string;
}

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
}

export function renderMailSubject(displayName: string, reportDate: string): string {
  return `${displayName} 日报 ${reportDate}`;
}

/** 纯文本邮件（EX-08）：不生成 HTML。 */
export function renderMailText(input: RenderMailInput): RenderedMail {
  const subject = renderMailSubject(input.displayName, input.reportDate);
  const lines = [`${input.displayName} · ${input.reportDate}`, '', input.body.trim()];
  if (input.summary !== undefined && input.summary.trim() !== '') {
    lines.push('', '---', input.summary.trim());
  }
  return { subject, text: lines.join('\n') };
}

export interface MailPayload {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly from?: string;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

export type MailTransport = Transporter;

export function createMailTransport(
  smtp: SmtpSettings,
  options: Record<string, unknown> = {},
): MailTransport {
  if (options.streamTransport === true) {
    return nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
      ...options,
    });
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    ...options,
  });
}

function mapSmtpError(error: unknown): SdrError {
  const err = error as { code?: string; responseCode?: number; message?: string };
  const responseCode = err.responseCode;
  const code = err.code ?? '';
  if (
    code === 'EAUTH' ||
    responseCode === 535 ||
    /auth/i.test(String(err.message ?? ''))
  ) {
    return new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, 'SMTP 认证失败', { cause: error });
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEOUT'
  ) {
    return new SdrError(ERROR_CODES.SMTP_TIMEOUT, 'SMTP 连接超时', { cause: error });
  }
  return new SdrError(ERROR_CODES.SMTP_TIMEOUT, 'SMTP 发送失败', { cause: error });
}

export async function sendMail(
  transport: MailTransport,
  payload: MailPayload,
): Promise<{ ok: true; messageId: string }> {
  if (payload.to.length === 0) {
    throw new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, '收件人不能为空');
  }
  if (payload.text.trim() === '') {
    throw new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, '邮件正文不能为空');
  }

  try {
    const info = await transport.sendMail({
      ...(payload.from === undefined ? {} : { from: payload.from }),
      to: payload.to.join(', '),
      subject: payload.subject,
      text: payload.text,
    });
    return { ok: true, messageId: String(info.messageId ?? '') };
  } catch (error) {
    throw mapSmtpError(error);
  }
}
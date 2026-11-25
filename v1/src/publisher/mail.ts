import nodemailer from 'nodemailer';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Entry, SourceLink } from '../types.js';
import { renderEntry } from '../generator/render.js';

/**
 * 邮件渲染与发送（design.md §4.3 publisher/mail）。
 * 本期只产出纯文本正文（proposal EX-08：HTML 版不在范围内，不得顺手实现）。
 */

export interface MailEntry {
  readonly entry: Entry;
  readonly links: readonly SourceLink[];
}

export interface RenderMailInput {
  readonly reportDate: string;
  readonly memberName: string;
  readonly entries: readonly MailEntry[];
}

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
}

export interface MailPayload {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export interface SendResult {
  readonly ok: true;
  readonly messageId: string;
}

export interface Mailer {
  send(payload: MailPayload): Promise<SendResult>;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

/** 主题固定含日期与成员名（T-017 验收标准）。 */
export function mailSubject(reportDate: string, memberName: string): string {
  return `日报 ${reportDate} ${memberName}`;
}

function groupByBlock(entries: readonly MailEntry[]): Map<string, MailEntry[]> {
  const grouped = new Map<string, MailEntry[]>();
  for (const item of entries) {
    const list = grouped.get(item.entry.timeBlock) ?? [];
    list.push(item);
    grouped.set(item.entry.timeBlock, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => left.entry.orderIndex - right.entry.orderIndex);
  }
  return grouped;
}

/** 纯文本正文：标题行 + 按时段分组的条目行，逐行与 `renderEntry` 一致。 */
export function renderMail(input: RenderMailInput): RenderedMail {
  const lines = [`${input.reportDate} 工作日报 · ${input.memberName}`, ''];
  for (const [block, items] of groupByBlock(input.entries)) {
    lines.push(`【${block}】`);
    for (const item of items) {
      lines.push(`- ${renderEntry(item.entry, item.links)}`);
    }
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { subject: mailSubject(input.reportDate, input.memberName), text: lines.join('\n') };
}

/* ------------------------------------------------------------------ */
/* SMTP 发送                                                           */
/* ------------------------------------------------------------------ */

export interface TransportLike {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

export function createSmtpTransport(smtp: SmtpSettings): TransportLike {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

function smtpErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** 认证失败 → E401；其余连接/超时类 → E402（design.md §4.3 sendMail）。 */
export function toMailError(error: unknown): SdrError {
  if (error instanceof SdrError) return error;
  const code = smtpErrorCode(error);
  const type = code ?? (error instanceof Error ? error.name : 'UnknownError');
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'EAUTH') {
    return new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, `SMTP 认证失败（${type}）：${message}`, {
      source: 'mail',
      cause: error,
    });
  }
  return new SdrError(ERROR_CODES.SMTP_TIMEOUT, `SMTP 发送失败（${type}）：${message}`, {
    source: 'mail',
    cause: error,
  });
}

/** 邮件发送器：不重试（补发由 scheduler 负责，design.md §4.3）。 */
export function createMailer(smtp: SmtpSettings, transport: TransportLike = createSmtpTransport(smtp)): Mailer {
  return {
    async send(payload: MailPayload): Promise<SendResult> {
      if (payload.to.length === 0) {
        throw new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, '收件人不能为空', { source: 'mail' });
      }
      try {
        const info = await transport.sendMail({
          from: smtp.from,
          to: payload.to.join(', '),
          subject: payload.subject,
          text: payload.text,
        });
        return { ok: true, messageId: info.messageId ?? '' };
      } catch (error) {
        throw toMailError(error);
      }
    },
  };
}

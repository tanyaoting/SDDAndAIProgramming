import type { Mailer } from './mail.js';

/**
 * 失败告警（design.md §4.3 publisher/alert / CS-07）。
 * 采集失败与推送失败共用同一模板：必须写明错误类型，便于定位是凭证、限流还是网络问题。
 */

export interface AlertInput {
  readonly code: string;
  readonly layer: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface AlertMail {
  readonly subject: string;
  readonly text: string;
}

export function renderAlert(input: AlertInput): AlertMail {
  const subject = `[告警] ${input.code} ${input.layer} 失败`;
  const text = [
    `${input.occurredAt} ${input.layer} 执行失败`,
    `错误类型：${input.code}`,
    `原因：${input.message}`,
    '影响：本次该来源/该份日报未完成，其余流程继续；请按错误类型排查后重试。',
  ].join('\n');
  return { subject, text };
}

export interface NotifyOptions {
  readonly mailer: Mailer;
  readonly to: readonly string[];
  readonly alert: AlertInput;
  readonly logger?: (line: string) => void;
}

/**
 * 发送告警邮件；告警本身失败只记录日志，不覆盖原始错误（CS-07：其余来源不中断）。
 */
export async function notifyFailure(options: NotifyOptions): Promise<boolean> {
  const logger = options.logger ?? ((line: string): void => console.warn(line));
  if (options.to.length === 0) {
    logger(`[alert] ${options.alert.code} 无告警收件人，跳过发送`);
    return false;
  }
  const mail = renderAlert(options.alert);
  try {
    await options.mailer.send({ to: options.to, subject: mail.subject, text: mail.text });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(`[alert] 告警邮件发送失败：${message}`);
    return false;
  }
}

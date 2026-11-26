import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/errors.js';
import {
  createMailTransport,
  type MailTransport,
  type SmtpSettings,
} from '../../src/publisher/mail.js';
import { renderAlertText, sendFailureAlert } from '../../src/publisher/alert.js';

describe('T-018 alert', () => {
  const smtp: SmtpSettings = {
    host: 'smtp.test',
    port: 587,
    user: 'user',
    pass: 'pass',
    from: 'bot@example.com',
  };

  function streamTransport(): MailTransport {
    return createMailTransport(smtp, {
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    });
  }

  it('告警正文标注错误码与阶段', () => {
    const text = renderAlertText({
      phase: 'push',
      errorCode: ERROR_CODES.SMTP_AUTH_FAILED,
      message: '认证失败',
      reportDate: '2026-11-25',
    });
    expect(text).toContain(ERROR_CODES.SMTP_AUTH_FAILED);
    expect(text).toContain('push');
    expect(text).toContain('2026-11-25');
  });

  it('sendFailureAlert 经 streamTransport 发出', async () => {
    const transport = streamTransport();
    await expect(
      sendFailureAlert({
        transport,
        smtp,
        notifyTo: ['ops@example.com'],
        phase: 'collect',
        errorCode: ERROR_CODES.GITHUB_PAGINATION_OVERFLOW,
        message: '分页超限',
        reportDate: '2026-11-25',
      }),
    ).resolves.toBeUndefined();
  });
});
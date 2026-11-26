import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/errors.js';
import {
  createMailTransport,
  sendMail,
  type SmtpSettings,
} from '../../src/publisher/mail.js';

describe('T-018 sendMail', () => {
  const smtp: SmtpSettings = {
    host: 'smtp.test',
    port: 587,
    user: 'user',
    pass: 'pass',
    from: 'bot@example.com',
  };

  function streamTransport() {
    return createMailTransport(smtp, {
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    });
  }

  it('streamTransport 发送成功返回 messageId', async () => {
    const transport = streamTransport();
    const result = await sendMail(transport, {
      to: ['dev@example.com'],
      subject: '测试',
      text: 'plain only',
    });
    expect(result.ok).toBe(true);
    expect(result.messageId.length).toBeGreaterThan(0);
  });

  it('认证失败映射 SDR-E401', async () => {
    const transport = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 1,
      secure: false,
      auth: { user: 'bad', pass: 'bad' },
      connectionTimeout: 200,
      greetingTimeout: 200,
      socketTimeout: 200,
    });
    await expect(
      sendMail(transport, { to: ['x@y.com'], subject: 's', text: 't' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.SMTP_AUTH_FAILED });
  });

  it('发送 MIME 不含 text/html', async () => {
    const transport = streamTransport();
    await sendMail(transport, { to: ['a@b.com'], subject: 's', text: '正文' });
    const sent = (transport as { sent?: { message?: Buffer }[] }).sent ?? [];
    const last = sent.at(-1);
    const raw = String(last?.message ?? '');
    expect(raw).not.toMatch(/Content-Type: text\/html/i);
  });
});
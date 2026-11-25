import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import type { MailEntry, TransportLike } from '../../src/publisher/mail.js';
import { createMailer, renderMail, toMailError } from '../../src/publisher/mail.js';
import type { Entry, SourceLink } from '../../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = resolve(HERE, '../fixtures/golden/mail_basic.txt');
const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  user: 'bot@example.com',
  pass: 'secret-pass',
  from: 'bot@example.com',
};

function entry(overrides: Partial<Entry> & Pick<Entry, 'id' | 'timeBlock' | 'content' | 'orderIndex'>): Entry {
  return {
    reportId: 1,
    state: 'done',
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ entryId: overrides.id ?? 0, memberId: 1, role: 'primary' }],
    ...overrides,
  };
}

function link(entryId: number, target: string, linkType: SourceLink['linkType'] = 'url'): SourceLink {
  return { entryId, linkType, target };
}

function mailEntries(): MailEntry[] {
  const first = entry({ id: 1, timeBlock: 'morning', content: '完成登录接口开发', orderIndex: 0 });
  const second = entry({
    id: 2,
    timeBlock: 'morning',
    content: '修复分页缺陷',
    orderIndex: 1,
    attributionKind: 'fallback',
    attributionConfirmed: false,
  });
  const third = entry({
    id: 3,
    timeBlock: 'afternoon',
    content: '联调任务接口',
    orderIndex: 2,
    members: [
      { entryId: 3, memberId: 1, role: 'primary' },
      { entryId: 3, memberId: 2, role: 'co' },
    ],
  });
  return [
    { entry: first, links: [link(1, 'https://github.com/acme/api/commit/sha-1')] },
    { entry: second, links: [link(2, '飞书群聊 11-25 15:30', 'note')] },
    { entry: third, links: [link(3, '/repo/src/api.ts', 'path')] },
  ];
}

describe('T-017 邮件纯文本渲染', () => {
  it('--dry-run 正文与 golden 文件逐字一致', () => {
    const rendered = renderMail({ reportDate: '2026-11-25', memberName: 'Alice', entries: mailEntries() });
    expect(rendered.text).toBe(readFileSync(GOLDEN, 'utf8'));
    expect(rendered.subject).toBe('日报 2026-11-25 Alice');
    expect(rendered.subject).toContain('2026-11-25');
    expect(rendered.subject).toContain('Alice');
    expect('html' in rendered).toBe(false);
  });

  it('主题包含日期与成员名，正文不含 HTML 标签', () => {
    const rendered = renderMail({ reportDate: '2026-11-24', memberName: 'Bob', entries: [] });
    expect(rendered.subject).toBe('日报 2026-11-24 Bob');
    expect(rendered.text).toBe('2026-11-24 工作日报 · Bob');
    expect(rendered.text).not.toMatch(/<[a-z][^>]*>/i);
  });
});

describe('T-018 SMTP 发送', () => {
  it('streamTransport 下可发送并返回 messageId', async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    });
    const mailer = createMailer(SMTP, transport as unknown as TransportLike);
    const result = await mailer.send({ to: ['alice@example.com'], subject: '日报', text: '正文' });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeTruthy();
  });

  it('认证失败映射 SDR-E401，连接超时映射 SDR-E402', async () => {
    const authError = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
    const timeoutError = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
    expect((toMailError(authError) as SdrError).code).toBe(ERROR_CODES.SMTP_AUTH_FAILED);
    expect(toMailError(timeoutError).code).toBe(ERROR_CODES.SMTP_TIMEOUT);

    const failing: TransportLike = {
      sendMail: () => Promise.reject(authError),
    };
    const mailer = createMailer(SMTP, failing);
    await expect(mailer.send({ to: ['a@example.com'], subject: 's', text: 't' })).rejects.toMatchObject({
      code: ERROR_CODES.SMTP_AUTH_FAILED,
    });
  });

  it('收件人为空时拒绝发送', async () => {
    const mailer = createMailer(SMTP, { sendMail: () => Promise.resolve({ messageId: 'x' }) });
    await expect(mailer.send({ to: [], subject: 's', text: 't' })).rejects.toBeInstanceOf(SdrError);
  });
});

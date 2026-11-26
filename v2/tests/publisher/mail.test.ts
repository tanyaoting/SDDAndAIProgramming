import { describe, expect, it } from 'vitest';
import { renderMailSubject, renderMailText } from '../../src/publisher/mail.js';

describe('T-017 mail render', () => {
  it('主题含日期与成员名', () => {
    expect(renderMailSubject('张三', '2026-11-25')).toBe('张三 日报 2026-11-25');
  });

  it('纯文本正文不含 HTML 字段', () => {
    const mail = renderMailText({
      displayName: '张三',
      reportDate: '2026-11-25',
      body: '完成接口联调（来源：https://example.com/a）',
    });
    expect(mail.text).toContain('张三');
    expect(mail.text).toContain('完成接口联调');
    expect(mail.text).not.toMatch(/<html|<body/i);
    expect(mail.subject).toBe('张三 日报 2026-11-25');
  });

  it('dry-run 正文与渲染结果逐字一致', () => {
    const body = '进行中优化查询（来源：note 说明）';
    const mail = renderMailText({ displayName: '李四', reportDate: '2026-11-26', body });
    expect(mail.text.endsWith(body)).toBe(true);
  });
});
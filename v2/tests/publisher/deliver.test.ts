import { describe, expect, it } from 'vitest';
import { resolveRecipients } from '../../src/publisher/deliver.js';
import type { Member } from '../../src/types.js';

describe('T-018 deliver.resolveRecipients', () => {
  const members: Member[] = [
    {
      id: 1,
      githubLogin: 'a',
      displayName: '甲',
      active: true,
      email: 'a@corp.example',
    },
    {
      id: 2,
      githubLogin: 'b',
      displayName: '乙',
      active: true,
    },
  ];

  it('优先 member.email，缺失时回退环境变量', () => {
    const a = resolveRecipients(members, { memberIds: [1, 2] }, { notifyTo: 'fallback@notify' });
    expect(a.get(1)).toEqual(['a@corp.example']);
    expect(a.get(2)).toEqual(['fallback@notify']);
  });

  it('CLI --to 覆盖默认收件人', () => {
    const map = resolveRecipients(members, { memberIds: [2], cliTo: 'cli@override' }, {});
    expect(map.get(2)).toEqual(['cli@override']);
  });

  it('最后回退 SMTP_FROM', () => {
    const map = resolveRecipients(members, { memberIds: [2] }, { smtpFrom: 'from@smtp' });
    expect(map.get(2)).toEqual(['from@smtp']);
  });
});
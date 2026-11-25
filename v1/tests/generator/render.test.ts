import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { renderEntry } from '../../src/generator/render.js';
import type { Entry, EntryState, LinkType, SourceLink } from '../../src/types.js';

const STATES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];
const KINDS = ['commit', 'task_done', 'file_change', 'note', 'manual'] as const;
const LINK_TYPES: readonly LinkType[] = ['url', 'path', 'note'];

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    reportId: 1,
    timeBlock: 'morning',
    state: 'done',
    content: '完成登录接口',
    orderIndex: 0,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ entryId: 1, memberId: 1, role: 'primary' }],
    ...overrides,
  };
}

function link(linkType: LinkType, target: string): SourceLink {
  return { entryId: 1, linkType, target };
}

describe('T-014 去人称渲染', () => {
  it('5 类事件 × 4 种状态 × 3 种链接形态均满足语体与格式约束', () => {
    for (const kind of KINDS) {
      for (const state of STATES) {
        for (const linkType of LINK_TYPES) {
          const target = linkType === 'note' ? '群聊沟通' : `https://example.com/${linkType}/1`;
          const text = `${kind}-${state}-${linkType} 完成`;
          const output = renderEntry(entry({ content: text, state }), [link(linkType, target)]);

          expect(output).not.toMatch(/[我们咱]/);
          expect(output.length).toBeGreaterThan(0);
          if (linkType === 'note') {
            expect(output).toContain(`来源：${target}`);
          } else {
            expect(output).toContain(target);
          }
        }
      }
    }
  });

  it('单句超过 60 字被截断并保留省略号', () => {
    const long = '完成'.repeat(40);
    const output = renderEntry(entry({ content: long }), [link('url', 'https://example.com/1')]);
    const sentence = output.slice(0, output.indexOf('（'));
    expect(sentence.length).toBeLessThanOrEqual(60);
    expect(sentence.endsWith('…')).toBe(true);
  });

  it('待确认 / 协作 / 跨天标记按契约拼接', () => {
    const output = renderEntry(
      entry({
        attributionConfirmed: false,
        originalDate: '2026-11-24',
        content: '完成联调',
        members: [
          { entryId: 1, memberId: 1, role: 'primary' },
          { entryId: 1, memberId: 2, role: 'co' },
        ],
      }),
      [link('note', '群聊沟通')],
    );
    expect(output).toBe('[待确认] （自 11-24 起）完成联调（协作）（来源：群聊沟通）');
  });

  it('无来源链接抛 SDR-E601', () => {
    try {
      renderEntry(entry(), []);
      throw new Error('应抛出 SDR-E601');
    } catch (error) {
      expect(error).toBeInstanceOf(SdrError);
      expect((error as SdrError).code).toBe(ERROR_CODES.SOURCE_LINK_MISSING);
    }
  });

  it('快照：url 与 path 链接形态', () => {
    expect(renderEntry(entry(), [link('url', 'https://github.com/acme/app/commit/a1')])).toBe(
      '完成登录接口（https://github.com/acme/app/commit/a1）',
    );
    expect(renderEntry(entry({ content: '修复分页越界' }), [link('path', '/repo/src/a.ts')])).toBe(
      '修复分页越界（/repo/src/a.ts）',
    );
  });
});

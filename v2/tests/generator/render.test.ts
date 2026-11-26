import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError } from '../../src/errors.js';
import { renderEntry } from '../../src/generator/render.js';
import type { Entry, EntryState, LinkType, SourceLink } from '../../src/types.js';

const STATES: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];
const LINK_TYPES: readonly LinkType[] = ['url', 'path', 'note'];

function baseEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    reportId: 1,
    timeBlock: 'morning',
    state: 'done',
    content: '完成鉴权接口',
    orderIndex: 0,
    isManual: false,
    attributionKind: 'author',
    attributionConfirmed: true,
    members: [{ entryId: 1, memberId: 1, role: 'primary' }],
    ...overrides,
  };
}

function linkOf(linkType: LinkType, target: string): SourceLink {
  return { entryId: 1, linkType, target };
}

describe('T-014 去人称渲染', () => {
  it('多种状态与链接形态不含第一人称（CS-05）', () => {
    for (const state of STATES) {
      for (const linkType of LINK_TYPES) {
        const target = linkType === 'note' ? '飞书任务备注' : `https://example.com/${linkType}`;
        const content = `${state} 状态条目描述`;
        const text = renderEntry(baseEntry({ content, state }), [linkOf(linkType, target)]);
        expect(text).not.toMatch(/我|我们|咱/);
        if (linkType === 'note') {
          expect(text).toContain(`来源：${target}`);
        } else {
          expect(text).toContain(target);
        }
      }
    }
  });

  it('正文超过 60 字截断', () => {
    const long = '推进'.repeat(40);
    const text = renderEntry(baseEntry({ content: long }), [linkOf('url', 'https://example.com/x')]);
    const bodyEnd = text.indexOf('（');
    const body = bodyEnd < 0 ? text : text.slice(0, bodyEnd);
    expect(body.length).toBeLessThanOrEqual(60);
    expect(body.endsWith('…')).toBe(true);
  });

  it('待确认、协作、跨天前缀按契约拼接', () => {
    const text = renderEntry(
      baseEntry({
        attributionConfirmed: false,
        originalDate: '2026-11-24',
        content: '完成联调',
        members: [
          { entryId: 1, memberId: 1, role: 'primary' },
          { entryId: 1, memberId: 2, role: 'co' },
        ],
      }),
      [linkOf('note', '飞书沟通')],
    );
    expect(text).toBe('[待确认] （自 11-24 起）完成联调（协作）（来源：飞书沟通）');
  });

  it('无来源链接抛 SDR-E601', () => {
    expect(() => renderEntry(baseEntry(), [])).toThrow(SdrError);
    try {
      renderEntry(baseEntry(), []);
    } catch (error) {
      expect((error as SdrError).code).toBe(ERROR_CODES.SOURCE_LINK_MISSING);
    }
  });

  it('url 与 path 形态快照', () => {
    expect(
      renderEntry(baseEntry(), [linkOf('url', 'https://github.com/acme/app/commit/a1')]),
    ).toBe('完成鉴权接口（https://github.com/acme/app/commit/a1）');
    expect(
      renderEntry(baseEntry({ content: '修复分页' }), [linkOf('path', '/repo/src/a.ts')]),
    ).toBe('修复分页（/repo/src/a.ts）');
  });
});
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadKeywordRules, loadWorkBlocks, parseYaml } from '../src/config.js';
import { ERROR_CODES } from '../src/errors.js';

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../config');
let dir: string;

function writeYaml(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sdr-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('T-011/T-012 YAML 配置加载与校验', () => {
  it('解析受限 YAML 子集（映射 / 序列 / 引号 / 注释）', () => {
    const parsed = parseYaml(
      [
        '# 注释行',
        'work_blocks:',
        '  - name: morning   # 行尾注释',
        '    start: "09:00"',
        '    end: "12:00"',
        'enabled: true',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      work_blocks: [{ name: 'morning', start: '09:00', end: '12:00' }],
      enabled: true,
    });
  });

  it('加载 work-hours.yaml 得到三段默认时段', () => {
    const blocks = loadWorkBlocks(join(CONFIG_DIR, 'work-hours.yaml'));
    expect(blocks.map((block) => block.name)).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('时段重叠或乱序抛 SDR-E301 且含时段名', () => {
    const overlap = writeYaml(
      'overlap.yaml',
      ['work_blocks:', '  - name: a', '    start: "09:00"', '    end: "12:00"', '  - name: b', '    start: "11:00"', '    end: "13:00"'].join('\n'),
    );
    expect(() => loadWorkBlocks(overlap)).toThrowError(/b/);
    try {
      loadWorkBlocks(overlap);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ERROR_CODES.WORK_BLOCKS_INVALID);
    }

    const unsorted = writeYaml(
      'unsorted.yaml',
      ['work_blocks:', '  - name: late', '    start: "14:00"', '    end: "18:00"', '  - name: early', '    start: "09:00"', '    end: "12:00"'].join('\n'),
    );
    expect(() => loadWorkBlocks(unsorted)).toThrowError(/early/);
  });

  it('加载 keywords.yaml 得到四条规则', () => {
    const rules = loadKeywordRules(join(CONFIG_DIR, 'keywords.yaml'));
    expect(rules).toHaveLength(4);
    expect(rules.map((rule) => rule.state)).toEqual(['done', 'doing', 'plan', 'blocked']);
    expect(rules.every((rule) => rule.pattern instanceof RegExp)).toBe(true);
  });

  it('非法正则在校验阶段被拒（SDR-E301）', () => {
    const path = writeYaml(
      'bad-regex.yaml',
      ['rules:', '  - pattern: "([a-z"', '    state: done', '    weight: 1'].join('\n'),
    );
    expect(() => loadKeywordRules(path)).toThrowError(/正则非法/);
  });
});

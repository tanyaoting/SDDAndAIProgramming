import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadKeywordRules, loadWorkBlocks } from '../src/config.js';
import { ERROR_CODES, SdrError, exitCode } from '../src/errors.js';

const baseEnv = {
  GITHUB_TOKEN: 'gh',
  FEISHU_APP_ID: 'id',
  FEISHU_APP_SECRET: 'sec',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'u',
  SMTP_PASS: 'p',
  SMTP_FROM: 'from@example.com',
};

describe('loadConfig', () => {
  it('缺少必需变量抛 SDR-E303 且 exitCode 为 9', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SdrError);
      expect((error as SdrError).code).toBe(ERROR_CODES.ENV_MISSING);
      expect((error as SdrError).message).toContain('GITHUB_TOKEN');
      expect(exitCode(error)).toBe(9);
    }
  });

  it('合法环境变量加载成功', () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.github.token).toBe('gh');
    expect(cfg.smtp.port).toBe(587);
    expect(cfg.dbPath).toBe('data/sdr.db');
    expect(cfg.pushTime).toBe('18:00');
  });
});

describe('loadWorkBlocks', () => {
  it('重叠时段抛 SDR-E301', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdr-cfg-'));
    const path = join(dir, 'work-hours.yaml');
    writeFileSync(
      path,
      `
work_blocks:
  - name: morning
    start: "09:00"
    end: "12:00"
  - name: bad
    start: "11:00"
    end: "13:00"
`,
    );
    expect(() => loadWorkBlocks(path)).toThrow(SdrError);
    try {
      loadWorkBlocks(path);
    } catch (error) {
      expect((error as SdrError).code).toBe(ERROR_CODES.WORK_BLOCKS_INVALID);
    }
  });

  it('合法 YAML 按时段升序返回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdr-cfg-'));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'ok.yaml');
    writeFileSync(
      path,
      `
work_blocks:
  - name: morning
    start: "09:00"
    end: "12:00"
  - name: afternoon
    start: "13:30"
    end: "18:00"
`,
    );
    const blocks = loadWorkBlocks(path);
    expect(blocks.map((b) => b.name)).toEqual(['morning', 'afternoon']);
  });
});

describe('loadKeywordRules', () => {
  it('非法正则在校验阶段被拒', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdr-kw-'));
    const path = join(dir, 'keywords.yaml');
    writeFileSync(
      path,
      `
rules:
  - pattern: "("
    state: done
    weight: 1
`,
    );
    expect(() => loadKeywordRules(path)).toThrow(SdrError);
  });
});

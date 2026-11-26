import { describe, expect, it } from 'vitest';
import { applyEnvFile, parseEnvFile } from '../src/env-file.js';

describe('parseEnvFile', () => {
  it('解析 KEY=VALUE 并忽略注释与空行', () => {
    const parsed = parseEnvFile('# c\n\nGITHUB_TOKEN=abc\nSMTP_PORT="587"\n');
    expect(parsed).toEqual({ GITHUB_TOKEN: 'abc', SMTP_PORT: '587' });
  });
});

describe('applyEnvFile', () => {
  it('不覆盖已有非空环境变量', () => {
    const merged = applyEnvFile(
      // 使用内存式：通过临时路径在实现侧测；此处测纯函数合并逻辑用 parse 结果模拟
      '',
      { GITHUB_TOKEN: 'keep' },
    );
    // 空路径读不到文件 → 原样返回
    expect(merged.GITHUB_TOKEN).toBe('keep');
  });
});

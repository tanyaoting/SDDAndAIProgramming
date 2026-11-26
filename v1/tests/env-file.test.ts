import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEnvFile, parseEnvFile } from '../src/env-file.js';

describe('.env 读取', () => {
  it('解析注释、引号与空行', () => {
    const parsed = parseEnvFile(
      ['# 注释', '', 'A=1', 'B="two words"', "C='three'", 'D=', 'E=a=b'].join('\n'),
    );
    expect(parsed).toEqual({ A: '1', B: 'two words', C: 'three', D: '', E: 'a=b' });
  });

  it('已存在的非空环境变量优先，空值视为未配置', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdr-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'A=from-file\nB=from-file\nD=from-file\n', 'utf8');
    const merged = applyEnvFile(file, { A: 'from-shell', B: '', D: undefined });
    expect(merged.A).toBe('from-shell');
    expect(merged.B).toBe('from-file');
    expect(merged.D).toBe('from-file');
  });

  it('文件不存在时保持目标环境原样', () => {
    expect(applyEnvFile('/definitely/not/exists.env', { A: 'x' })).toEqual({ A: 'x' });
  });
});

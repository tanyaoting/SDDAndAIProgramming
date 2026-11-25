import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ERROR_CODES, SdrError } from '../src/errors.js';

const validEnv = {
  GITHUB_TOKEN: 'gh_test_token',
  FEISHU_APP_ID: 'cli_test_id',
  FEISHU_APP_SECRET: 'feishu_test_secret',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'sdr@example.com',
  SMTP_PASS: 'smtp_test_pass',
  SMTP_FROM: 'sdr@example.com',
};

describe('T-002 配置加载', () => {
  it('必需变量齐全时返回结构化配置，数据库路径取默认值', () => {
    const config = loadConfig(validEnv);
    expect(config.dbPath).toBe('data/sdr.db');
    expect(config.github.token).toBe('gh_test_token');
    expect(config.feishu.appId).toBe('cli_test_id');
    expect(config.smtp.host).toBe('smtp.example.com');
    expect(config.smtp.port).toBe(587);
    expect(config.smtp.from).toBe('sdr@example.com');
  });

  it('SDR_DB_PATH 可覆盖默认值', () => {
    const config = loadConfig({ ...validEnv, SDR_DB_PATH: '/tmp/other.db' });
    expect(config.dbPath).toBe('/tmp/other.db');
  });

  it('缺少必需变量时抛 SDR-E303，错误信息含全部缺失变量名', () => {
    const { GITHUB_TOKEN, SMTP_PASS, ...incomplete } = validEnv;
    expect(() => loadConfig(incomplete)).toThrowError(SdrError);
    try {
      loadConfig(incomplete);
    } catch (e) {
      const err = e as SdrError;
      expect(err.code).toBe(ERROR_CODES.ENV_MISSING);
      expect(err.message).toContain('GITHUB_TOKEN');
      expect(err.message).toContain('SMTP_PASS');
    }
  });

  it('SMTP_PORT 非数字时抛 SDR-E303', () => {
    try {
      loadConfig({ ...validEnv, SMTP_PORT: 'not-a-port' });
      expect.unreachable('应当抛出 SdrError');
    } catch (e) {
      expect(e).toBeInstanceOf(SdrError);
      expect((e as SdrError).code).toBe(ERROR_CODES.ENV_MISSING);
      expect((e as SdrError).message).toContain('SMTP_PORT');
    }
  });

  it('空字符串视为缺失', () => {
    expect(() => loadConfig({ ...validEnv, GITHUB_TOKEN: '' })).toThrowError(SdrError);
    expect(() => loadConfig({ ...validEnv, GITHUB_TOKEN: '   ' })).toThrowError(SdrError);
  });
});

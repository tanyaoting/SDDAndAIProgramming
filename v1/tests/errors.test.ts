import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError, exitCode } from '../src/sdr/errors.js';

describe('T-002 错误码体系', () => {
  it('SdrError 含 code/source/cause 三者，且是 Error 实例', () => {
    const cause = new Error('原始错误');
    const err = new SdrError(ERROR_CODES.GITHUB_TIMEOUT, '请求超时', {
      source: 'github',
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SdrError);
    expect(err.code).toBe('SDR-E103');
    expect(err.source).toBe('github');
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('请求超时');
  });

  it('错误码表覆盖 E1xx~E5xx 全部五个码段（design.md §4.4）', () => {
    const segments = new Set(
      Object.values(ERROR_CODES).map((code) => code.slice(5, 6)),
    );
    expect([...segments].sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('错误码值与 design.md §4.3 契约表一致', () => {
    expect(ERROR_CODES.GITHUB_TOKEN_INVALID).toBe('SDR-E101');
    expect(ERROR_CODES.GITHUB_RATE_LIMITED).toBe('SDR-E102');
    expect(ERROR_CODES.GITHUB_TIMEOUT).toBe('SDR-E103');
    expect(ERROR_CODES.FEISHU_AUTH_FAILED).toBe('SDR-E201');
    expect(ERROR_CODES.FEISHU_FIELD_MISSING).toBe('SDR-E202');
    expect(ERROR_CODES.WORK_BLOCKS_INVALID).toBe('SDR-E301');
    expect(ERROR_CODES.SOURCE_LINK_MISSING).toBe('SDR-E302');
    expect(ERROR_CODES.SMTP_AUTH_FAILED).toBe('SDR-E401');
    expect(ERROR_CODES.SMTP_TIMEOUT).toBe('SDR-E402');
  });

  it('退出码映射：配置类 E3xx → 9（配置非法）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, '时段重叠'))).toBe(9);
  });

  it('退出码映射：推送类 E4xx → 7（推送失败）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.SMTP_TIMEOUT, '连接超时'))).toBe(7);
  });

  it('退出码映射：非 SdrError → 1', () => {
    expect(exitCode(new Error('意外错误'))).toBe(1);
  });
});

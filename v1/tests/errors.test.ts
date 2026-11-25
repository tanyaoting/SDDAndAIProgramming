import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError, exitCode } from '../src/errors.js';

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

  it('错误码表覆盖 E1xx~E6xx 全部六个码段（design.md §4.4 v0.4）', () => {
    const segments = new Set(
      Object.values(ERROR_CODES).map((code) => code.slice(5, 6)),
    );
    expect([...segments].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('错误码值与 design.md §4.3/§4.4 表一致', () => {
    expect(ERROR_CODES.GITHUB_TOKEN_INVALID).toBe('SDR-E101');
    expect(ERROR_CODES.GITHUB_RATE_LIMITED).toBe('SDR-E102');
    expect(ERROR_CODES.GITHUB_TIMEOUT).toBe('SDR-E103');
    expect(ERROR_CODES.GITHUB_PAGINATION_OVERFLOW).toBe('SDR-E104');
    expect(ERROR_CODES.FEISHU_AUTH_FAILED).toBe('SDR-E201');
    expect(ERROR_CODES.FEISHU_FIELD_MISSING).toBe('SDR-E202');
    expect(ERROR_CODES.WORK_BLOCKS_INVALID).toBe('SDR-E301');
    expect(ERROR_CODES.ENV_MISSING).toBe('SDR-E303');
    expect(ERROR_CODES.SMTP_AUTH_FAILED).toBe('SDR-E401');
    expect(ERROR_CODES.SMTP_TIMEOUT).toBe('SDR-E402');
    expect(ERROR_CODES.STORE_TRANSACTION_FAILED).toBe('SDR-E501');
    expect(ERROR_CODES.SOURCE_LINK_MISSING).toBe('SDR-E601');
  });

  it('生成约束不再占用 E3xx 码段（评审 R-08）', () => {
    const codes: string[] = Object.values(ERROR_CODES);
    expect(codes.filter((code) => code === 'SDR-E302')).toHaveLength(0);
    expect(ERROR_CODES.SOURCE_LINK_MISSING.startsWith('SDR-E6')).toBe(true);
  });

  it('退出码映射：配置类 E3xx → 9（配置非法）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, '时段重叠'))).toBe(9);
    expect(exitCode(new SdrError(ERROR_CODES.ENV_MISSING, '缺少环境变量'))).toBe(9);
  });

  it('退出码映射：推送类 E4xx → 7（推送失败）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.SMTP_TIMEOUT, '连接超时'))).toBe(7);
  });

  it('退出码映射：生成约束 E6xx → 10（生成约束违反）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.SOURCE_LINK_MISSING, '来源标识缺失'))).toBe(10);
  });

  it('退出码映射：采集类 E1xx 不由 exitCode 决定（由 CLI 聚合 3/4）', () => {
    expect(exitCode(new SdrError(ERROR_CODES.GITHUB_PAGINATION_OVERFLOW, '分页超限'))).toBe(1);
  });

  it('退出码映射：非 SdrError → 1', () => {
    expect(exitCode(new Error('意外错误'))).toBe(1);
  });
});

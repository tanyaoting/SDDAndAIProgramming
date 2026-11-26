import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SdrError, exitCode } from '../src/errors.js';

describe('ERROR_CODES', () => {
  it('覆盖 E1xx～E6xx 分段码', () => {
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
});

describe('SdrError', () => {
  it('携带 code / source / cause', () => {
    const cause = new Error('root');
    const err = new SdrError(ERROR_CODES.ENV_MISSING, '缺 GITHUB_TOKEN', {
      source: 'config',
      cause,
    });
    expect(err.code).toBe('SDR-E303');
    expect(err.source).toBe('config');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('SdrError');
  });
});

describe('exitCode', () => {
  it('E3xx → 9', () => {
    expect(exitCode(new SdrError(ERROR_CODES.ENV_MISSING, 'x'))).toBe(9);
    expect(exitCode(new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, 'x'))).toBe(9);
  });

  it('E4xx → 7', () => {
    expect(exitCode(new SdrError(ERROR_CODES.SMTP_AUTH_FAILED, 'x'))).toBe(7);
  });

  it('E6xx → 10', () => {
    expect(exitCode(new SdrError(ERROR_CODES.SOURCE_LINK_MISSING, 'x'))).toBe(10);
  });

  it('其余 SdrError 与未知错误 → 1', () => {
    expect(exitCode(new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'x'))).toBe(1);
    expect(exitCode(new SdrError(ERROR_CODES.STORE_TRANSACTION_FAILED, 'x'))).toBe(1);
    expect(exitCode(new Error('boom'))).toBe(1);
  });
});

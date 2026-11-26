/**
 * 统一错误码（design.md §4.4 / HANDOVER §3.4）。
 */
export const ERROR_CODES = {
  GITHUB_TOKEN_INVALID: 'SDR-E101',
  GITHUB_RATE_LIMITED: 'SDR-E102',
  GITHUB_TIMEOUT: 'SDR-E103',
  GITHUB_PAGINATION_OVERFLOW: 'SDR-E104',
  FEISHU_AUTH_FAILED: 'SDR-E201',
  FEISHU_FIELD_MISSING: 'SDR-E202',
  WORK_BLOCKS_INVALID: 'SDR-E301',
  ENV_MISSING: 'SDR-E303',
  SMTP_AUTH_FAILED: 'SDR-E401',
  SMTP_TIMEOUT: 'SDR-E402',
  STORE_TRANSACTION_FAILED: 'SDR-E501',
  SOURCE_LINK_MISSING: 'SDR-E601',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface SdrErrorOptions {
  readonly source?: string;
  readonly cause?: unknown;
}

export class SdrError extends Error {
  readonly code: ErrorCode;
  readonly source: string | undefined;

  constructor(code: ErrorCode, message: string, options: SdrErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'SdrError';
    this.code = code;
    this.source = options.source;
  }
}

/** E3xx→9，E4xx→7，E6xx→10，其余→1。采集部分/全失败由 CLI 聚合为 3/4。 */
export function exitCode(error: unknown): number {
  if (error instanceof SdrError) {
    if (error.code.startsWith('SDR-E3')) return 9;
    if (error.code.startsWith('SDR-E4')) return 7;
    if (error.code.startsWith('SDR-E6')) return 10;
  }
  return 1;
}

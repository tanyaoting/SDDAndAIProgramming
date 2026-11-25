/**
 * 统一错误码表（design.md §4.4 v0.4）。
 * 码段：E1xx GitHub 采集、E2xx 飞书采集、E3xx 配置校验、
 *       E4xx 推送、E5xx 存储、E6xx 生成约束。
 */
export const ERROR_CODES = {
  // GitHub 采集（§4.3 collectGithub 契约）
  GITHUB_TOKEN_INVALID: 'SDR-E101',
  GITHUB_RATE_LIMITED: 'SDR-E102',
  GITHUB_TIMEOUT: 'SDR-E103',
  GITHUB_PAGINATION_OVERFLOW: 'SDR-E104',
  // 飞书采集（§4.3 collectFeishu 契约）
  FEISHU_AUTH_FAILED: 'SDR-E201',
  FEISHU_FIELD_MISSING: 'SDR-E202',
  // 配置校验（§4.3 assignBlocks 契约、config 加载）
  WORK_BLOCKS_INVALID: 'SDR-E301',
  ENV_MISSING: 'SDR-E303',
  // 推送（§4.3 sendMail 契约）
  SMTP_AUTH_FAILED: 'SDR-E401',
  SMTP_TIMEOUT: 'SDR-E402',
  // 存储（§4.4 E5xx：事务回滚后抛出）
  STORE_TRANSACTION_FAILED: 'SDR-E501',
  // 生成约束（§4.4 E6xx：原 E302 迁移而来，避免 E3xx→退出码 9 的语义错误）
  SOURCE_LINK_MISSING: 'SDR-E601',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface SdrErrorOptions {
  readonly source?: string;
  readonly cause?: unknown;
}

/**
 * 全系统唯一错误类型（design.md §4.4）：禁止抛裸 Error。
 */
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

/**
 * SdrError 码段 → CLI 统一退出码（design.md §4.2）：
 * E3xx 配置非法 → 9；E4xx 推送失败 → 7；E6xx 生成约束违反 → 10；其余 → 1。
 * 采集类（E1xx/E2xx）的部分/全部失败退出码（3/4）由 CLI 按 allSettled 结果聚合，不经此函数。
 */
export function exitCode(error: unknown): number {
  if (error instanceof SdrError) {
    if (error.code.startsWith('SDR-E3')) return 9;
    if (error.code.startsWith('SDR-E4')) return 7;
    if (error.code.startsWith('SDR-E6')) return 10;
  }
  return 1;
}

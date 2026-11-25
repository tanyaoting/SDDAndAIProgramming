import { setTimeout as delay } from 'node:timers/promises';

/**
 * 全系统唯一的外部请求出口（design.md §2）。
 * 统一超时、重试、退避与日志掩码；不得 import 任何业务模块（ESLint 强制）。
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
/** 指数退避：1s / 2s / 4s（ADR-001）。 */
const BACKOFF_MS = [1000, 2000, 4000] as const;

export type HttpFailureKind = 'network' | 'timeout';

/** 网络层失败（超时 / 连接错误），由采集器转换为对应错误码。 */
export class HttpError extends Error {
  readonly kind: HttpFailureKind;

  constructor(kind: HttpFailureKind, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'HttpError';
    this.kind = kind;
  }
}

export interface HttpRequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** 需要从日志中抹除的敏感串（长度 > 8 时整体替换）。 */
  readonly secrets?: readonly string[];
  /** 退避等待函数，测试可注入以避免真实等待。 */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly logger?: (line: string) => void;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

/** 日志掩码：长度 > 8 的敏感串全量替换为 `***`。 */
export function maskSecrets(text: string, secrets: readonly string[] = []): string {
  let masked = text;
  for (const secret of secrets) {
    if (secret.length > 8) {
      masked = masked.split(secret).join('***');
    }
  }
  return masked;
}

/** 仅 408 / 429 / 5xx 可重试；4xx（除 408/429）立即返回。 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'TimeoutError'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 发起请求并返回响应体。
 * 重试耗尽后：网络/超时错误抛 `HttpError`；可重试状态码返回最后一次响应，由调用方分类。
 */
export async function request(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number): Promise<void> => delay(ms));
  const logger = options.logger ?? ((line: string): void => console.warn(line));
  const secrets = options.secrets ?? [];
  const method = options.method ?? 'GET';

  const log = (line: string): void => logger(maskSecrets(line, secrets));
  let lastError: HttpError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // 超出预设次数时沿用最长间隔（默认只到 3 次，取 1/2/4 秒）。
      const wait = BACKOFF_MS[attempt - 1] ?? 4000;
      log(`[http] ${method} ${url} 第 ${attempt} 次重试，${wait}ms 后发起`);
      await sleep(wait);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        ...(options.headers === undefined ? {} : { headers: { ...options.headers } }),
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const kind: HttpFailureKind = isTimeoutError(error) ? 'timeout' : 'network';
      lastError = new HttpError(kind, `${method} ${url} ${kind === 'timeout' ? '超时' : '网络错误'}`, {
        cause: error,
      });
      log(`[http] ${method} ${url} ${kind === 'timeout' ? '超时' : '网络错误'}：${errorMessage(error)}`);
      continue;
    }

    const body = await response.text();
    if (!isRetryableStatus(response.status)) {
      return { status: response.status, headers: response.headers, body };
    }

    log(`[http] ${method} ${url} 返回 ${response.status}（可重试）`);
    lastError = undefined;
    if (attempt === maxRetries) {
      return { status: response.status, headers: response.headers, body };
    }
  }

  throw lastError ?? new HttpError('network', `${method} ${url} 请求失败`);
}

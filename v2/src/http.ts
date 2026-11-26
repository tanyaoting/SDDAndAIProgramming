import { SdrError, ERROR_CODES } from './errors.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404]);

export class HttpResponseError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${String(status)}`);
    this.name = 'HttpResponseError';
    this.status = status;
    this.body = body;
  }
}

function isRetryableStatus(status: number): boolean {
  if (NON_RETRYABLE_STATUSES.has(status)) return false;
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

export function maskToken(value: string): string {
  if (value.length <= 8) return '****';
  const head = value.slice(0, 3);
  const tail = value.slice(-3);
  return `${head}****${tail}`;
}

function maskSensitiveText(line: string): string {
  return line.replace(/[A-Za-z0-9_\-]{9,}/g, (token) => maskToken(token));
}

export interface RequestJsonOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly token?: string;
}

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpClient {
  requestJson<T>(url: string, options: RequestJsonOptions): Promise<T>;
}

export interface HttpClientDeps {
  readonly sleep?: SleepFn;
  readonly fetchImpl?: typeof fetch;
  readonly onLog?: (line: string) => void;
}

export function createHttpClient(deps: HttpClientDeps = {}): HttpClient {
  const sleep = deps.sleep ?? defaultSleep;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const onLog = deps.onLog;

  const log = (line: string): void => {
    onLog?.(maskSensitiveText(line));
  };

  const requestJson = async <T>(url: string, options: RequestJsonOptions): Promise<T> => {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
    };
    if (options.token !== undefined) {
      headers.authorization = `Bearer ${options.token}`;
    }

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    if (options.token !== undefined) {
      log(`http ${method} ${url} token=${maskToken(options.token)}`);
    } else {
      log(`http ${method} ${url}`);
    }

    let lastError: unknown;
    const attempts = RETRY_DELAYS_MS.length + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          ...init,
          signal: options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs),
        });

        const text = await response.text();
        let parsed: unknown = text;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json') && text.length > 0) {
          parsed = JSON.parse(text) as unknown;
        }

        if (!response.ok) {
          if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
            throw new HttpResponseError(response.status, parsed);
          }
          lastError = new HttpResponseError(response.status, parsed);
        } else {
          return parsed as T;
        }
      } catch (error) {
        if (error instanceof HttpResponseError) {
          if (!isRetryableStatus(error.status)) throw error;
          lastError = error;
        } else {
          lastError = error;
        }
        if (attempt === attempts - 1) {
          if (lastError instanceof HttpResponseError) throw lastError;
          throw lastError;
        }
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await sleep(delay);
    }

    if (lastError instanceof HttpResponseError) throw lastError;
    throw lastError;
  };

  return { requestJson };
}

export const httpClient = createHttpClient();

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly hasNext: boolean;
}

export interface PaginateOptions<T> {
  readonly fetchPage: (page: number) => Promise<PageResult<T>>;
  readonly maxPages?: number;
}

export async function paginatePages<T>(options: PaginateOptions<T>): Promise<T[]> {
  const maxPages = options.maxPages ?? 20;
  const collected: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { items, hasNext } = await options.fetchPage(page);
    collected.push(...items);
    if (!hasNext) return collected;
    if (page === maxPages) {
      throw new SdrError(ERROR_CODES.GITHUB_PAGINATION_OVERFLOW, 'pagination exceeded maxPages', {
        source: 'http',
      });
    }
  }

  return collected;
}
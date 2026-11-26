import type { Clock, Event, EventKind } from '../types.js';
import { parseInstant } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { HttpResponseError, type HttpClient, httpClient, paginatePages } from '../http.js';
import { buildDedupeKey } from './normalize.js';

interface FeishuTask {
  readonly id: string;
  readonly title?: string;
  readonly status?: string;
  readonly completed_at?: string;
  readonly updated_at?: string;
}

interface FeishuTaskPage {
  readonly items: readonly FeishuTask[];
  readonly has_more: boolean;
}

interface FeishuListResponse {
  readonly code: number;
  readonly data?: FeishuTaskPage;
}

export interface FeishuCollectOptions {
  readonly since: Date;
  readonly until: Date;
  readonly token: string;
  readonly clock: Clock;
  readonly memberId: number;
  readonly runId: string;
  readonly http?: HttpClient;
  readonly baseUrl?: string;
  readonly maxPages?: number;
}

function taskKind(status: string | undefined): EventKind {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return 'task_done';
  return 'note';
}

function isInWindow(at: Date, since: Date, until: Date): boolean {
  const ms = at.getTime();
  return ms >= since.getTime() && ms < until.getTime();
}

function mapFeishuError(error: unknown): SdrError {
  if (error instanceof SdrError) return error;

  if (error instanceof HttpResponseError) {
    if (error.status === 401 || error.status === 403) {
      return new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, 'Feishu authorization failed', {
        source: 'feishu',
        cause: error,
      });
    }
  }

  if (error instanceof Error && error.message.includes('field')) {
    return new SdrError(ERROR_CODES.FEISHU_FIELD_MISSING, error.message, { source: 'feishu' });
  }

  return new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, 'Feishu request failed', {
    source: 'feishu',
    cause: error,
  });
}

function parseTaskInstant(task: FeishuTask): Date {
  const value = task.completed_at ?? task.updated_at;
  if (value === undefined) {
    throw new SdrError(ERROR_CODES.FEISHU_FIELD_MISSING, 'task timestamp field missing', {
      source: 'feishu',
    });
  }
  return parseInstant(value);
}

export async function collectFeishu(options: FeishuCollectOptions): Promise<Event[]> {
  const http = options.http ?? httpClient;
  const baseUrl = options.baseUrl ?? 'https://open.feishu.cn/open-apis/task/v1/tasks';

  try {
    const tasks = await paginatePages<FeishuTask>({
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      fetchPage: async (page) => {
        const url = new URL(baseUrl);
        url.searchParams.set('page_size', '100');
        url.searchParams.set('page_token', String(page));

        const body = await http.requestJson<FeishuListResponse>(url.toString(), {
          token: options.token,
          timeoutMs: 5_000,
        });

        if (body.code !== 0 || body.data === undefined) {
          throw new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, 'Feishu API rejected request', {
            source: 'feishu',
          });
        }

        return {
          items: [...body.data.items],
          hasNext: body.data.has_more,
        };
      },
    });

    const events: Event[] = [];
    for (const task of tasks) {
      if (task.id === undefined || task.title === undefined || task.title.trim() === '') {
        throw new SdrError(ERROR_CODES.FEISHU_FIELD_MISSING, 'task required field missing', {
          source: 'feishu',
        });
      }

      const occurredAt = parseTaskInstant(task);
      if (!isInWindow(occurredAt, options.since, options.until)) continue;

      events.push({
        memberId: options.memberId,
        source: 'feishu',
        sourceId: task.id,
        kind: taskKind(task.status),
        occurredAt,
        title: task.title,
        dedupeKey: buildDedupeKey(task.id, occurredAt, options.memberId, options.clock),
        isPrimary: true,
        runId: options.runId,
        payload: { status: task.status ?? 'unknown' },
      });
    }

    return events;
  } catch (error) {
    throw mapFeishuError(error);
  }
}
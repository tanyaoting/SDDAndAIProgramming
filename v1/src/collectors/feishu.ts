import { parseInstant } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { HttpError, request } from '../http.js';
import type { Clock, EntryState, Event } from '../types.js';
import { makeDedupeKey } from './normalize.js';

/**
 * 飞书任务采集器（FR-02）。
 * 状态映射固定：完成 → done，未知 → doing（design.md §4.3）。
 */

const FEISHU_API_BASE = 'https://open.feishu.cn';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export interface FeishuCollectOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly since: Date;
  readonly until: Date;
  readonly runId: string;
  readonly clock: Clock;
  readonly resolveMemberId: (openId: string) => number | undefined;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly logger?: (line: string) => void;
}

interface FeishuTask {
  readonly guid?: string;
  readonly summary?: string;
  readonly status?: string;
  readonly completed_at?: string;
  readonly updated_at?: string;
  readonly created_at?: string;
  readonly assignee?: { readonly open_id?: string } | null;
}

interface FeishuTokenResponse {
  readonly code?: number;
  readonly msg?: string;
  readonly tenant_access_token?: string;
}

interface FeishuTaskListResponse {
  readonly code?: number;
  readonly msg?: string;
  readonly data?: {
    readonly items?: readonly FeishuTask[];
    readonly has_more?: boolean;
    readonly page_token?: string;
  };
}

/** 任务状态 → 条目状态：完成类为 done，其余（含未知）一律 doing，不猜测。 */
export function mapFeishuStatus(status: string | undefined): EntryState {
  const normalized = (status ?? '').trim().toLowerCase();
  if (['done', 'completed', 'complete', 'finished', '完成'].includes(normalized)) return 'done';
  return 'doing';
}

function requireField<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === null || value === '') {
    throw new SdrError(ERROR_CODES.FEISHU_FIELD_MISSING, `飞书任务缺少字段：${field}`, {
      source: 'feishu',
    });
  }
  return value;
}

function taskTime(task: FeishuTask): Date {
  const completed = task.completed_at;
  const updated = task.updated_at;
  if (completed !== undefined && completed !== '' && completed !== '0') return parseInstant(Number(completed));
  if (updated !== undefined && updated !== '') return parseInstant(Number(updated));
  throw new SdrError(ERROR_CODES.FEISHU_FIELD_MISSING, '飞书任务缺少完成/更新时间', {
    source: 'feishu',
  });
}

async function fetchTenantToken(options: FeishuCollectOptions): Promise<string> {
  let response;
  try {
    response = await request(`${FEISHU_API_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
      secrets: [options.appSecret],
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
  } catch (error) {
    throw toAuthError(error);
  }

  if (response.status !== 200) {
    throw new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `飞书鉴权失败：HTTP ${response.status}`, {
      source: 'feishu',
    });
  }

  const parsed = JSON.parse(response.body) as FeishuTokenResponse;
  const token = parsed.tenant_access_token;
  if (parsed.code !== 0 || token === undefined || token === '') {
    throw new SdrError(
      ERROR_CODES.FEISHU_AUTH_FAILED,
      `飞书鉴权失败：${parsed.msg ?? `code=${parsed.code ?? '未知'}`}`,
      { source: 'feishu' },
    );
  }
  return token;
}

function toAuthError(error: unknown): unknown {
  if (error instanceof HttpError) {
    return new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `飞书鉴权请求失败：${error.message}`, {
      source: 'feishu',
      cause: error,
    });
  }
  return error;
}

export async function collectFeishu(options: FeishuCollectOptions): Promise<Event[]> {
  const token = await fetchTenantToken(options);
  const events: Event[] = [];
  let pageToken = '';
  let page = 0;

  for (;;) {
    page += 1;
    if (page > MAX_PAGES) break;

    const url =
      `${FEISHU_API_BASE}/open-apis/task/v2/tasks?page_size=${PAGE_SIZE}` +
      (pageToken === '' ? '' : `&page_token=${encodeURIComponent(pageToken)}`);

    let response;
    try {
      response = await request(url, {
        headers: { Authorization: `Bearer ${token}` },
        secrets: [token, options.appSecret],
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      });
    } catch (error) {
      throw toAuthError(error);
    }

    if (response.status !== 200) {
      throw new SdrError(ERROR_CODES.FEISHU_AUTH_FAILED, `飞书任务拉取失败：HTTP ${response.status}`, {
        source: 'feishu',
      });
    }

    const parsed = JSON.parse(response.body) as FeishuTaskListResponse;
    if (parsed.code !== 0) {
      throw new SdrError(
        ERROR_CODES.FEISHU_AUTH_FAILED,
        `飞书任务拉取失败：${parsed.msg ?? `code=${parsed.code ?? '未知'}`}`,
        { source: 'feishu' },
      );
    }

    for (const task of parsed.data?.items ?? []) {
      const guid = requireField(task.guid, 'guid');
      const summary = requireField(task.summary, 'summary');
      const occurredAt = taskTime(task);
      if (occurredAt < options.since || occurredAt >= options.until) continue;

      const openId = task.assignee?.open_id;
      if (openId === undefined) continue;
      const memberId = options.resolveMemberId(openId);
      if (memberId === undefined) continue;

      const state = mapFeishuStatus(task.status);
      events.push({
        memberId,
        source: 'feishu',
        sourceId: guid,
        kind: 'task_done',
        occurredAt,
        title: summary,
        dedupeKey: makeDedupeKey({ sourceId: guid, memberId, occurredAt, clock: options.clock }),
        isPrimary: false,
        runId: options.runId,
        payload: { status: task.status ?? null, state, created_at: task.created_at ?? null },
      });
    }

    if (parsed.data?.has_more !== true) break;
    pageToken = parsed.data.page_token ?? '';
    if (pageToken === '') break;
  }

  return events;
}

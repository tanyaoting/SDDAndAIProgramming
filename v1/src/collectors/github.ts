import { parseInstant } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import { HttpError, request } from '../http.js';
import type { Clock, Event } from '../types.js';
import { makeDedupeKey } from './normalize.js';

/**
 * GitHub 提交采集器（FR-01）。
 * 分页上限 20 页（2000 条）：达上限仍有 next 时抛 E104，不返回部分结果（ADR-001 / R-06）。
 */

const GITHUB_API_BASE = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 20;

export interface GithubCollectOptions {
  readonly repo: string;
  readonly since: Date;
  readonly until: Date;
  readonly token: string;
  readonly runId: string;
  readonly clock: Clock;
  readonly resolveMemberId: (githubLogin: string) => number | undefined;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly logger?: (line: string) => void;
}

interface GithubCommit {
  readonly sha: string;
  readonly html_url?: string;
  readonly author?: { readonly login?: string } | null;
  readonly commit: {
    readonly message: string;
    readonly author?: { readonly name?: string; readonly email?: string; readonly date?: string } | null;
  };
}

function toEvent(item: GithubCommit, memberId: number, options: GithubCollectOptions): Event {
  const occurredAt = parseInstant(item.commit.author?.date ?? '');
  const [firstLine = '', ...rest] = item.commit.message.split('\n');
  const detail = rest.join('\n').trim();
  return {
    memberId,
    source: 'github',
    sourceId: item.sha,
    kind: 'commit',
    occurredAt,
    title: firstLine.trim(),
    ...(detail.length > 0 ? { detail } : {}),
    dedupeKey: makeDedupeKey({
      sourceId: item.sha,
      memberId,
      occurredAt,
      clock: options.clock,
    }),
    isPrimary: true,
    runId: options.runId,
    payload: item,
  };
}

export async function collectGithub(options: GithubCollectOptions): Promise<Event[]> {
  const events: Event[] = [];
  const since = encodeURIComponent(options.since.toISOString());
  const until = encodeURIComponent(options.until.toISOString());

  for (let page = 1; ; page += 1) {
    const url =
      `${GITHUB_API_BASE}/repos/${options.repo}/commits` +
      `?since=${since}&until=${until}&per_page=${PER_PAGE}&page=${page}`;

    let response;
    try {
      response = await request(url, {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        secrets: [options.token],
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw new SdrError(
          ERROR_CODES.GITHUB_TIMEOUT,
          error.kind === 'timeout' ? 'GitHub 请求超时' : `GitHub 网络错误：${error.message}`,
          { source: 'github', cause: error },
        );
      }
      throw error;
    }

    if (response.status === 401) {
      throw new SdrError(ERROR_CODES.GITHUB_TOKEN_INVALID, 'GitHub 令牌失效（401）', {
        source: 'github',
      });
    }
    if (response.status === 403 || response.status === 429) {
      throw new SdrError(ERROR_CODES.GITHUB_RATE_LIMITED, `GitHub 限流（${response.status}）`, {
        source: 'github',
      });
    }
    if (response.status !== 200) {
      throw new SdrError(
        ERROR_CODES.GITHUB_TIMEOUT,
        `GitHub 采集失败：HTTP ${response.status}`,
        { source: 'github' },
      );
    }

    const items = JSON.parse(response.body) as GithubCommit[];
    for (const item of items) {
      const login = item.author?.login;
      if (login === undefined) continue;
      const memberId = options.resolveMemberId(login);
      if (memberId === undefined) continue;
      events.push(toEvent(item, memberId, options));
    }

    const hasNext = /rel="next"/.test(response.headers.get('link') ?? '');
    if (!hasNext) break;
    if (page >= MAX_PAGES) {
      throw new SdrError(
        ERROR_CODES.GITHUB_PAGINATION_OVERFLOW,
        `GitHub 提交超过 ${MAX_PAGES} 页上限，数据不完整`,
        { source: 'github' },
      );
    }
  }

  return events;
}

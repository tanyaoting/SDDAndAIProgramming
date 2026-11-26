import type { Clock, Event } from '../types.js';
import { parseInstant } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import {
  HttpResponseError,
  type HttpClient,
  httpClient,
  paginatePages,
} from '../http.js';
import { buildDedupeKey } from './normalize.js';

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const PER_PAGE = 100;

interface GithubCommit {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly date: string };
  };
}

export interface GithubCollectOptions {
  readonly repo: string;
  readonly since: Date;
  readonly until: Date;
  readonly token: string;
  readonly clock: Clock;
  readonly memberId: number;
  readonly runId: string;
  readonly http?: HttpClient;
  readonly maxPages?: number;
}

function isInWindow(at: Date, since: Date, until: Date): boolean {
  const ms = at.getTime();
  return ms >= since.getTime() && ms < until.getTime();
}

function mapGithubError(error: unknown): SdrError {
  if (error instanceof SdrError) return error;

  if (error instanceof HttpResponseError) {
    if (error.status === 401) {
      return new SdrError(ERROR_CODES.GITHUB_TOKEN_INVALID, 'GitHub token invalid', {
        source: 'github',
        cause: error,
      });
    }
    if (error.status === 403) {
      return new SdrError(ERROR_CODES.GITHUB_RATE_LIMITED, 'GitHub rate limited', {
        source: 'github',
        cause: error,
      });
    }
  }

  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'GitHub request timeout', {
      source: 'github',
      cause: error,
    });
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'GitHub request timeout', {
      source: 'github',
      cause: error,
    });
  }

  if (error instanceof TypeError) {
    return new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'GitHub network error', {
      source: 'github',
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'GitHub request failed', {
      source: 'github',
      cause: error,
    });
  }

  return new SdrError(ERROR_CODES.GITHUB_TIMEOUT, 'GitHub request failed', {
    source: 'github',
    cause: error,
  });
}

export async function collectGithub(options: GithubCollectOptions): Promise<Event[]> {
  if (!REPO_PATTERN.test(options.repo)) {
    throw new SdrError(ERROR_CODES.GITHUB_TOKEN_INVALID, 'invalid repo format', {
      source: 'github',
    });
  }
  if (options.since.getTime() >= options.until.getTime()) {
    throw new SdrError(ERROR_CODES.GITHUB_TOKEN_INVALID, 'since must be before until', {
      source: 'github',
    });
  }

  const http = options.http ?? httpClient;
  const sinceIso = options.since.toISOString();
  const untilIso = options.until.toISOString();
  const baseUrl = `https://api.github.com/repos/${options.repo}/commits`;

  try {
    const rawCommits = await paginatePages<GithubCommit>({
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      fetchPage: async (page) => {
        const url = new URL(baseUrl);
        url.searchParams.set('since', sinceIso);
        url.searchParams.set('until', untilIso);
        url.searchParams.set('per_page', String(PER_PAGE));
        url.searchParams.set('page', String(page));

        const pageCommits = await http.requestJson<readonly GithubCommit[]>(url.toString(), {
          token: options.token,
          timeoutMs: 5_000,
          headers: {
            accept: 'application/vnd.github+json',
          },
        });

        return { items: [...pageCommits], hasNext: pageCommits.length === PER_PAGE };
      },
    });

    const events: Event[] = [];
    for (const commit of rawCommits) {
      const occurredAt = parseInstant(commit.commit.author.date);
      if (!isInWindow(occurredAt, options.since, options.until)) continue;

      const title = commit.commit.message.split('\n')[0] ?? commit.commit.message;
      events.push({
        memberId: options.memberId,
        source: 'github',
        sourceId: commit.sha,
        kind: 'commit',
        occurredAt,
        title,
        dedupeKey: buildDedupeKey(commit.sha, occurredAt, options.memberId, options.clock),
        isPrimary: true,
        runId: options.runId,
      });
    }

    return events;
  } catch (error) {
    throw mapGithubError(error);
  }
}
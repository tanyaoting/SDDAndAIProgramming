import { dayKey, dayWindow, toZonedIsoString } from '../clock.js';
import { collectFeishu, collectFeishuWithToken } from '../collectors/feishu.js';
import { collectGithub } from '../collectors/github.js';
import { collectLocal } from '../collectors/local.js';
import { assertManualPair, collectManual } from '../collectors/manual.js';
import { dedupe } from '../collectors/normalize.js';
import { SdrError } from '../errors.js';
import { ensureFreshToken, FeishuTokenStore, resolveTokenFilePath } from '../feishu-tokens.js';
import { notifyFailure } from '../publisher/alert.js';
import type { Event, Source } from '../types.js';
import type { ParsedArgs } from './args.js';
import { UsageError, flagList, flagValue, requireDate, requireMemberId } from './args.js';
import type { CliContext } from './context.js';
import { alertRecipients } from './context.js';

/** 采集命令（design.md §4.2）：单源失败不影响其他源（allSettled），每源写一条 ingestion_run。 */
const ALL_SOURCES: readonly Source[] = ['github', 'feishu', 'local', 'manual'];

export interface CollectSummary {
  readonly ok: number;
  readonly failed: number;
  readonly skipped: number;
  readonly events: number;
}

function errorCodeOf(error: unknown): string {
  return error instanceof SdrError ? error.code : 'SDR-E000';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSources(args: ParsedArgs): Source[] {
  const requested = flagList(args, 'source');
  if (requested.length === 0) return [...ALL_SOURCES];
  for (const name of requested) {
    if (!(ALL_SOURCES as readonly string[]).includes(name)) {
      throw new UsageError(`未知采集来源：${name}`);
    }
  }
  return requested as Source[];
}

interface SourceRun {
  readonly source: Source;
  readonly events: readonly Event[];
}

async function collectOne(
  context: CliContext,
  source: Source,
  args: ParsedArgs,
  window: { since: Date; until: Date },
  runId: string,
): Promise<SourceRun | 'skipped'> {
  const memberFlag = flagValue(args, 'member');
  switch (source) {
    case 'github': {
      const repoName = flagValue(args, 'repo') ?? context.env.SDR_GITHUB_REPO;
      if (repoName === undefined || repoName.trim() === '') return 'skipped';
      const events = await collectGithub({
        repo: repoName,
        since: window.since,
        until: window.until,
        token: context.config.github.token,
        runId,
        clock: context.clock,
        resolveMemberId: (login) => context.repo.members.findByGithubLogin(login)?.id,
        logger: context.stderr,
      });
      return { source, events };
    }
    case 'feishu': {
      const store = new FeishuTokenStore(resolveTokenFilePath(context.env, context.cwd));
      const tokens = store.list();
      if (tokens.length === 0) {
        // 未授权任何成员时回退应用身份（只能看到应用自己创建/被分享的任务）。
        const events = await collectFeishu({
          appId: context.config.feishu.appId,
          appSecret: context.config.feishu.appSecret,
          since: window.since,
          until: window.until,
          runId,
          clock: context.clock,
          resolveMemberId: (openId) => context.repo.members.findByFeishuOpenId(openId)?.id,
          logger: context.stderr,
        });
        return { source, events };
      }

      // 每个已授权成员用自己的 user_access_token 采集，再按 assignee.open_id 归属。
      const events: Event[] = [];
      for (const record of tokens) {
        const fresh = await ensureFreshToken(record, {
          app: context.config.feishu,
          clock: context.clock,
          store,
          logger: context.stderr,
        });
        const ownerId = context.repo.members.findById(fresh.memberId)?.id;
        const collected = await collectFeishuWithToken({
          accessToken: fresh.accessToken,
          since: window.since,
          until: window.until,
          runId,
          clock: context.clock,
          secrets: [fresh.refreshToken],
          resolveMemberId: (openId) =>
            context.repo.members.findByFeishuOpenId(openId)?.id ??
            (openId === fresh.openId ? ownerId : undefined),
          logger: context.stderr,
        });
        events.push(...collected);
      }
      return { source, events };
    }
    case 'local': {
      const rootDir = flagValue(args, 'local-dir') ?? context.env.SDR_LOCAL_DIR;
      if (rootDir === undefined || memberFlag === undefined) return 'skipped';
      const events = collectLocal({
        rootDir,
        memberId: requireMemberId(memberFlag),
        since: window.since,
        until: window.until,
        runId,
        clock: context.clock,
      });
      return { source, events };
    }
    case 'manual': {
      const texts = flagList(args, 'manual');
      const ref = flagValue(args, 'ref');
      if (texts.length === 0 || ref === undefined || memberFlag === undefined) return 'skipped';
      assertManualPair(texts[0], ref);
      const collected = collectManual({
        texts,
        ref,
        memberId: requireMemberId(memberFlag),
        runId,
        clock: context.clock,
      });
      return { source, events: collected.map((item) => item.event) };
    }
    default:
      return 'skipped';
  }
}

/**
 * 每源独立执行：成功写 ok，失败写 failed 并告警（CS-07 / IR-02），
 * 缺前置条件写 skipped。退出码由调用方按 ok/failed 聚合（0/3/4）。
 */
export async function runCollect(context: CliContext, args: ParsedArgs): Promise<CollectSummary> {
  const date = requireDate(flagValue(args, 'date'), dayKey(context.clock, context.clock.now()));
  const sources = parseSources(args);
  const window = dayWindow(context.clock, date);
  const runId = `run-${date.replace(/-/g, '')}-${context.clock.now().getTime()}`;
  const startedAt = context.clock.now();

  const runs = await Promise.allSettled(
    sources.map((source) => collectOne(context, source, args, window, runId)),
  );

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let eventCount = 0;

  for (let index = 0; index < runs.length; index += 1) {
    const source = sources[index] as Source;
    const settled = runs[index];

    if (settled?.status === 'fulfilled') {
      if (settled.value === 'skipped') {
        skipped += 1;
        context.repo.audit.recordIngestionRun({
          runId,
          source,
          startedAt,
          finishedAt: context.clock.now(),
          result: 'skipped',
          errorMsg: '缺少该来源的运行参数',
        });
        context.stderr(`[collect] ${source} 跳过（缺少参数）`);
        continue;
      }

      const unique = dedupe(settled.value.events);
      let inserted = 0;
      for (const event of unique) {
        if (context.repo.insertEvent(event).inserted) inserted += 1;
      }
      ok += 1;
      eventCount += inserted;
      context.repo.audit.recordIngestionRun({
        runId,
        source,
        startedAt,
        finishedAt: context.clock.now(),
        result: 'ok',
        eventCount: inserted,
      });
      context.stdout(`[collect] ${source} 成功：${inserted} 条事件`);
      continue;
    }

    failed += 1;
    const error = settled?.status === 'rejected' ? settled.reason : new Error('未知采集错误');
    const code = errorCodeOf(error);
    const message = errorMessageOf(error);
    context.repo.audit.recordIngestionRun({
      runId,
      source,
      startedAt,
      finishedAt: context.clock.now(),
      result: code === 'SDR-E104' ? 'partial' : 'failed',
      errorCode: code,
      errorMsg: message,
    });
    context.stderr(`[collect] ${source} 失败：${code} ${message}`);
    await notifyFailure({
      mailer: context.mailer,
      to: alertRecipients(context),
      logger: context.stderr,
      alert: {
        code,
        layer: `采集（${source}）`,
        message,
        occurredAt: toZonedIsoString(context.clock, context.clock.now()),
      },
    });
  }

  return { ok, failed, skipped, events: eventCount };
}

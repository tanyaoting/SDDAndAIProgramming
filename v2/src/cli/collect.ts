import { dayKey } from '../clock.js';
import { sendFailureAlert } from '../publisher/alert.js';
import { createMailTransport } from '../publisher/mail.js';
import type { Repo } from '../store/repo.js';
import type { Clock, Event, Source } from '../types.js';
import { ERROR_CODES, SdrError, type ErrorCode } from '../errors.js';
import type { SdrConfig } from '../config.js';
import { EXIT, type ExitCode } from './exit.js';

export type SourceCollector = () => Promise<Event[]>;

export interface CollectContext {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly config?: SdrConfig;
  readonly notifyTo?: string;
}

export interface CollectOptions {
  readonly date?: string;
  readonly sources: readonly Source[];
  readonly manualText?: string;
  readonly manualRef?: string;
  readonly memberId?: number;
}

function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof SdrError) return error.code;
  return ERROR_CODES.GITHUB_TOKEN_INVALID;
}

export async function runCollect(
  ctx: CollectContext,
  options: CollectOptions,
  collectors: Partial<Record<Source, SourceCollector>>,
): Promise<ExitCode> {
  const reportDate = options.date ?? dayKey(ctx.clock, ctx.clock.now());
  const runId = `collect-${reportDate}-${ctx.clock.now().getTime()}`;
  const memberId = options.memberId ?? ctx.repo.listActiveMembers()[0]?.id ?? 1;

  const sources = [...options.sources];
  if (options.manualText !== undefined || options.manualRef !== undefined) {
    if (!options.manualText || !options.manualRef) {
      return EXIT.USAGE;
    }
    sources.push('manual');
  }

  if (sources.length === 0) {
    return EXIT.USAGE;
  }

  let failures = 0;
  const transport =
    ctx.config === undefined
      ? undefined
      : createMailTransport(ctx.config.smtp, {
          streamTransport: true,
          newline: 'unix',
          buffer: true,
        });

  for (const source of sources) {
    const startedAt = ctx.clock.now();
    try {
      let events: Event[] = [];
      if (source === 'manual') {
        const fn = collectors.manual;
        if (fn !== undefined) {
          events = await fn();
        } else if (options.manualText && options.manualRef) {
          const { createManualEvent } = await import('../collectors/manual.js');
          events = [
            createManualEvent({
              text: options.manualText,
              ref: options.manualRef,
              memberId,
              runId,
              clock: ctx.clock,
            }),
          ];
        }
      } else {
        const fn = collectors[source];
        if (fn === undefined) {
          throw new SdrError(ERROR_CODES.ENV_MISSING, `未配置采集器：${source}`);
        }
        events = await fn();
      }

      for (const event of events) {
        ctx.repo.upsertEvent(event);
      }
      ctx.repo.insertIngestionRun({
        runId,
        source,
        startedAt,
        finishedAt: ctx.clock.now(),
        result: 'ok',
        eventCount: events.length,
      });
    } catch (error) {
      failures += 1;
      const code = errorCodeOf(error);
      ctx.repo.insertIngestionRun({
        runId,
        source,
        startedAt,
        finishedAt: ctx.clock.now(),
        result: 'failed',
        errorCode: code,
        errorMsg: error instanceof Error ? error.message : '采集失败',
        eventCount: 0,
      });
      if (transport !== undefined && ctx.config !== undefined) {
        const notify =
          ctx.notifyTo
            ?.split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean) ?? [ctx.config.smtp.from];
        await sendFailureAlert({
          transport,
          smtp: ctx.config.smtp,
          notifyTo: notify,
          phase: 'collect',
          errorCode: code,
          message: error instanceof Error ? error.message : '采集失败',
          reportDate,
          source,
        }).catch(() => undefined);
      }
    }
  }

  if (failures === 0) return EXIT.OK;
  if (failures === sources.length) return EXIT.ALL_FAILED;
  return EXIT.PARTIAL;
}
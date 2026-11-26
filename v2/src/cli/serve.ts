import type { SdrConfig } from '../config.js';
import { dayKey } from '../clock.js';
import { evaluatePushSchedule } from '../publisher/scheduler.js';
import type { Clock } from '../types.js';
import type { Repo } from '../store/repo.js';
import { runPush, type PushContext } from './push.js';

export interface ServeOptions {
  readonly tickMs?: number;
  readonly onTick?: (date: string) => Promise<void>;
}

export function startServeLoop(
  ctx: PushContext,
  options: ServeOptions = {},
): { stop: () => void } {
  const tickMs = options.tickMs ?? 30_000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const date = dayKey(ctx.clock, ctx.clock.now());
    const alreadySent = ctx.repo.hasPushLogOk(date, 'daily');
    const decision = evaluatePushSchedule(ctx.clock, ctx.config.pushTime, date, alreadySent);
    if (decision.shouldSend) {
      await runPush(ctx, { date, forceSchedule: true });
      if (options.onTick) await options.onTick(date);
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export function createServeContext(
  repo: Repo,
  clock: Clock,
  config: SdrConfig,
  notifyTo?: string,
): PushContext {
  return { repo, clock, config, ...(notifyTo === undefined ? {} : { notifyTo }) };
}
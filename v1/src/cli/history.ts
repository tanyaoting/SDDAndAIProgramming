import { dayKey } from '../clock.js';
import { queryHistory, renderHistory } from '../history.js';
import type { ParsedArgs } from './args.js';
import { flagValue, requireDate, requireMemberId } from './args.js';
import type { CliContext } from './context.js';

/**
 * 历史查询命令（T-020 / CS-09 / CS-10）。
 * 调用者身份取 `--actor`，缺省回退环境变量 `SDR_ACTOR`；越权返回退出码 8。
 */
export function runHistory(context: CliContext, args: ParsedArgs): number {
  const memberId = requireMemberId(flagValue(args, 'member'));
  const now = context.clock.now();
  const to = requireDate(flagValue(args, 'to'), dayKey(context.clock, now));
  const from = requireDate(flagValue(args, 'from'), to);

  const actorRaw = flagValue(args, 'actor') ?? context.env.SDR_ACTOR;
  const actorId =
    actorRaw === undefined || actorRaw.trim() === '' ? undefined : Number(actorRaw);

  const result = queryHistory(context.repo, {
    ...(actorId === undefined || Number.isNaN(actorId) ? {} : { actorId }),
    memberId,
    from,
    to,
  });

  if (!result.ok) {
    context.stderr(`[history] 无权查询成员 ${memberId} 的日报`);
    return 8;
  }
  context.stdout(renderHistory(result));
  return 0;
}

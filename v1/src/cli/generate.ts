import { join } from 'node:path';
import { dayKey, dayWindow } from '../clock.js';
import { loadKeywordRules, loadWorkBlocks } from '../config.js';
import type { RepoIndex } from '../generator/attribution.js';
import { generateReport } from '../generator/report.js';
import type { Member } from '../types.js';
import type { ParsedArgs } from './args.js';
import { UsageError, flagList, flagValue, requireDate, requireMemberId } from './args.js';
import type { CliContext } from './context.js';

/** 配置文件的固定位置（相对工作目录），与 design.md §2 config 一致。 */
export const WORK_HOURS_PATH = 'config/work-hours.yaml';
export const KEYWORDS_PATH = 'config/keywords.yaml';

/** 归属索引：协作作者按 GitHub 登录名/姓名反查；任务时间窗暂无外部数据，返回空。 */
function buildRepoIndex(members: readonly Member[]): RepoIndex {
  const byKey = new Map<string, number>();
  for (const member of members) {
    byKey.set(member.githubLogin.toLowerCase(), member.id);
    byKey.set(member.displayName.toLowerCase(), member.id);
  }
  return {
    findMemberByCoauthor: (nameOrEmail) => {
      const key = nameOrEmail.trim().toLowerCase();
      const direct = byKey.get(key);
      if (direct !== undefined) return direct;
      const local = key.includes('@') ? key.slice(0, key.indexOf('@')) : key;
      return byKey.get(local);
    },
    findTaskWindowMembers: () => [],
  };
}

function selectMembers(context: CliContext, args: ParsedArgs): Member[] {
  const ids = flagList(args, 'member');
  if (ids.length === 0) return context.repo.members.listActive();
  return ids.map((raw) => {
    const member = context.repo.members.findById(requireMemberId(raw));
    if (member === undefined) throw new UsageError(`成员不存在：${raw}`);
    return member;
  });
}

export interface GenerateSummary {
  readonly generated: number;
  readonly skipped: number;
}

/** 生成命令（design.md §4.2）：逐成员装配日报，已确认日报不覆盖（--force 除外）。 */
export function runGenerate(context: CliContext, args: ParsedArgs): GenerateSummary {
  const date = requireDate(flagValue(args, 'date'), dayKey(context.clock, context.clock.now()));
  const members = selectMembers(context, args);
  const blocks = loadWorkBlocks(join(context.cwd, WORK_HOURS_PATH));
  const rules = loadKeywordRules(join(context.cwd, KEYWORDS_PATH));
  const window = dayWindow(context.clock, date);
  const events = context.repo.findEventsBetween(window.since, window.until);
  const repoIndex = buildRepoIndex(context.repo.members.listActive());

  let generated = 0;
  let skipped = 0;
  for (const member of members) {
    const result = generateReport({
      repo: context.repo,
      clock: context.clock,
      memberId: member.id,
      reportDate: date,
      events: events.filter((event) => event.memberId === member.id),
      rules,
      blocks,
      repoIndex,
      force: args.values.get('force') === true,
      leave: args.values.get('leave') === true,
    });
    if (result.skipped) skipped += 1;
    else generated += 1;
    context.stdout(
      `[generate] ${member.displayName} ${date}：${result.status}${result.skipped ? '（已确认，跳过）' : ''}`,
    );
  }
  return { generated, skipped };
}

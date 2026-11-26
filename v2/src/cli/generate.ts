import type { KeywordRule, WorkBlock } from '../config.js';
import { assembleReport } from '../generator/report.js';
import type { AttributionContext } from '../generator/attribution.js';
import type { Repo } from '../store/repo.js';
import type { Clock } from '../types.js';
import { EXIT, type ExitCode } from './exit.js';
import { SdrError } from '../errors.js';

export interface GenerateContext {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly rules: readonly KeywordRule[];
  readonly blocks: readonly WorkBlock[];
}

export interface GenerateOptions {
  readonly date: string;
  readonly memberId?: number;
  readonly force?: boolean;
}

function attributionContext(repo: Repo): AttributionContext {
  return {
    findMemberByGithubLogin: (login) => repo.findMemberByGithubLogin(login)?.id,
    findMemberByEmailOrName: (name) => {
      const members = repo.listActiveMembers();
      const hit = members.find(
        (m) => m.displayName.toLowerCase() === name || m.email?.toLowerCase() === name,
      );
      return hit?.id;
    },
    taskWindowMembers: () => [],
  };
}

export function runGenerate(ctx: GenerateContext, options: GenerateOptions): ExitCode {
  const targets =
    options.memberId === undefined
      ? ctx.repo.listActiveMembers()
      : [ctx.repo.getMember(options.memberId)].filter((m) => m !== undefined);

  try {
    for (const member of targets) {
      if (member === undefined) continue;
      const events = ctx.repo.findEventsForDate(member.id ?? 0, options.date);
      assembleReport({
        repo: ctx.repo,
        clock: ctx.clock,
        memberId: member.id ?? 0,
        reportDate: options.date,
        events,
        rules: ctx.rules,
        blocks: ctx.blocks,
        attributionCtx: attributionContext(ctx.repo),
        ...(options.force === true ? { force: true } : {}),
      });
    }
    return EXIT.OK;
  } catch (error) {
    if (error instanceof SdrError && error.code.startsWith('SDR-E6')) {
      return EXIT.GENERATE;
    }
    throw error;
  }
}
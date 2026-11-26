#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { ManualInputError } from './collectors/manual.js';
import { exitCode, SdrError } from './errors.js';
import { runCollect } from './cli/collect.js';
import { runEdit } from './cli/edit.js';
import { runFeishuAuth } from './cli/feishu-auth.js';
import { runGenerate } from './cli/generate.js';
import { runHistory } from './cli/history.js';
import { runMember } from './cli/member.js';
import { runPush } from './cli/push.js';
import { runServe } from './cli/serve.js';
import type { ParsedArgs } from './cli/args.js';
import { UsageError, hasFlag, parseArgs } from './cli/args.js';
import type { CliContext, CreateContextOptions } from './cli/context.js';
import { createContext } from './cli/context.js';

/** 统一退出码（design.md §4.2）。 */
export const EXIT_CODES = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  partial: 3,
  collectFailed: 4,
  entryMissing: 6,
  pushFailed: 7,
  forbidden: 8,
  config: 9,
  generate: 10,
} as const;

export const USAGE = [
  '用法：sdr <命令> [选项]',
  '',
  '命令：',
  '  collect   --date [--source github|feishu|local|manual] [--repo owner/name]',
  '            [--local-dir 路径] [--member id] [--manual 文本] [--ref 来源说明]',
  '  generate  --date [--member id]... [--force] [--leave]',
  '  edit      --date --member id (--add-text 文本 | --remove-entry id |',
  '            --accept-attribution [--all])',
  '  push      --date [--dry-run] [--to 邮箱]...',
  '  history   --member id [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--actor id]',
  '  serve     [--push-time HH:mm] [--interval 秒]',
  '  member    add --github 登录名 [--name 姓名] [--feishu-open-id id] [--manager id]',
  '            | list',
  '  feishu-auth --member id [--port 8787]',
].join('\n');

function exitCodeOfCollect(summary: { ok: number; failed: number }): number {
  if (summary.failed === 0) return EXIT_CODES.ok;
  return summary.ok > 0 ? EXIT_CODES.partial : EXIT_CODES.collectFailed;
}

async function dispatch(context: CliContext, args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'collect':
      return exitCodeOfCollect(await runCollect(context, args));
    case 'generate':
      runGenerate(context, args);
      return EXIT_CODES.ok;
    case 'edit':
      return runEdit(context, args);
    case 'push':
      return runPush(context, args);
    case 'history':
      return runHistory(context, args);
    case 'serve':
      return runServe(context, args);
    case 'member':
      return runMember(context, args);
    case 'feishu-auth':
      return runFeishuAuth(context, args);
    default:
      context.stdout(USAGE);
      return EXIT_CODES.ok;
  }
}

export interface MainOptions extends CreateContextOptions {
  /** 测试可注入已装配的上下文，避免重复读环境变量。 */
  readonly context?: CliContext;
}

export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const stderr = options.stderr ?? ((line: string): void => console.error(line));
  let context: CliContext | undefined = options.context;
  const ownsContext = context === undefined;
  try {
    const args = parseArgs(argv);
    if (args.command === 'help' || hasFlag(args, 'help')) {
      (options.stdout ?? ((line: string): void => console.log(line)))(USAGE);
      return EXIT_CODES.ok;
    }
    context = context ?? createContext(options);
    return await dispatch(context, args);
  } catch (error) {
    if (error instanceof UsageError || error instanceof ManualInputError) {
      stderr(`参数错误：${error.message}`);
      return EXIT_CODES.usage;
    }
    if (error instanceof SdrError) {
      stderr(`${error.code}${error.source === undefined ? '' : ` [${error.source}]`}：${error.message}`);
      return exitCode(error);
    }
    stderr(`未预期错误：${error instanceof Error ? error.message : String(error)}`);
    return EXIT_CODES.unexpected;
  } finally {
    if (ownsContext) context?.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  process.exitCode = await main(process.argv.slice(2));
}

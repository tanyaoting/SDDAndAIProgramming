/**
 * 命令行参数解析（design.md §4.2）。
 * 手写解析：不引入 commander，保持零运行时依赖且行为可测。
 */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface ParsedArgs {
  readonly command: string;
  /** `member add|list` 这类二级命令（其余命令无此字段）。 */
  readonly subcommand?: string;
  readonly values: ReadonlyMap<string, string | true | readonly string[]>;
}

const BOOLEAN_FLAGS = new Set(['force', 'leave', 'dry-run', 'accept-attribution', 'all', 'help']);
const REPEATABLE_FLAGS = new Set(['source', 'manual', 'member', 'to']);

/** 二级命令白名单；未知名直接视为参数错误。 */
const SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  member: ['add', 'list'],
};

/** 每个命令允许的参数；其余一律视为参数错误（退出码 2）。 */
const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  collect: ['date', 'source', 'repo', 'local-dir', 'member', 'manual', 'ref', 'help'],
  generate: ['date', 'member', 'force', 'leave', 'help'],
  edit: ['date', 'member', 'add-text', 'remove-entry', 'accept-attribution', 'all', 'help'],
  push: ['date', 'dry-run', 'to', 'help'],
  history: ['member', 'from', 'to', 'actor', 'help'],
  serve: ['push-time', 'interval', 'help'],
  member: ['github', 'name', 'feishu-open-id', 'manager', 'help'],
  'feishu-auth': ['member', 'port', 'help'],
  help: ['help'],
};

export const COMMANDS = Object.keys(COMMAND_FLAGS);

function requireAllowed(command: string, name: string): void {
  const allowed = COMMAND_FLAGS[command];
  if (allowed === undefined || !allowed.includes(name)) {
    throw new UsageError(`命令 ${command} 不支持参数 --${name}`);
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const rest = [...argv];
  const command = rest.shift();
  if (command === undefined || command === '-h' || command === '--help') {
    return { command: 'help', values: new Map() };
  }
  if (COMMAND_FLAGS[command] === undefined) {
    throw new UsageError(`未知命令：${command}`);
  }

  let subcommand: string | undefined;
  const allowedSubcommands = SUBCOMMANDS[command];
  const candidate = rest[0];
  if (allowedSubcommands !== undefined && candidate !== undefined && !candidate.startsWith('-')) {
    const next = rest.shift() ?? '';
    if (!allowedSubcommands.includes(next)) {
      throw new UsageError(`未知子命令：${command} ${next}`);
    }
    subcommand = next;
  }

  const values = new Map<string, string | true | readonly string[]>();
  while (rest.length > 0) {
    const token = rest.shift() ?? '';
    if (token === '-h') {
      values.set('help', true);
      continue;
    }
    if (!token.startsWith('--') || token === '--') {
      throw new UsageError(`多余参数：${token}`);
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    requireAllowed(command, name);

    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new UsageError(`--${name} 不接受取值`);
      values.set(name, true);
      continue;
    }

    const value = equals === -1 ? rest.shift() : token.slice(equals + 1);
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError(`--${name} 缺少取值`);
    }
    if (REPEATABLE_FLAGS.has(name)) {
      const current = values.get(name);
      values.set(name, Array.isArray(current) ? [...current, value] : [value]);
    } else {
      values.set(name, value);
    }
  }

  return { command, ...(subcommand === undefined ? {} : { subcommand }), values };
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.values.get(name);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[value.length - 1];
  return undefined;
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.values.get(name);
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return [...value];
  return [];
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.values.get(name) === true;
}

/** 日期参数必须是 YYYY-MM-DD，避免把非法值传进 SQL 区间。 */
export function requireDate(value: string | undefined, fallback: string): string {
  const date = value ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new UsageError(`日期格式非法：${date}（应为 YYYY-MM-DD）`);
  }
  return date;
}

export function requireMemberId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UsageError(`成员 id 非法：${value ?? '(缺失)'}`);
  }
  return id;
}

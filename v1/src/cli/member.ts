import { ERROR_CODES, SdrError } from '../errors.js';
import type { ParsedArgs } from './args.js';
import { UsageError, flagValue, requireMemberId } from './args.js';
import type { CliContext } from './context.js';

/**
 * 成员录入（飞书用户身份 OAuth 的前置条件）。
 * 用法：sdr member add --github <登录名> [--name <姓名>] [--feishu-open-id <id>] [--manager <id>]
 *       sdr member list
 */

const USAGE_TEXT = [
  '用法：sdr member add --github <登录名> [--name <姓名>] [--feishu-open-id <id>] [--manager <id>]',
  '      sdr member list',
].join('\n');

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function addMember(context: CliContext, args: ParsedArgs): number {
  const login = nonEmpty(flagValue(args, 'github'));
  if (login === undefined) throw new UsageError('member add 缺少 --github');
  const displayName = nonEmpty(flagValue(args, 'name')) ?? login;
  const openId = nonEmpty(flagValue(args, 'feishu-open-id'));
  const managerFlag = flagValue(args, 'manager');
  const managerId = managerFlag === undefined ? undefined : requireMemberId(managerFlag);

  const existing = context.repo.members.findByGithubLogin(login);
  if (existing !== undefined) {
    throw new SdrError(
      ERROR_CODES.STORE_TRANSACTION_FAILED,
      `成员已存在：#${existing.id} ${existing.githubLogin}`,
      { source: 'store' },
    );
  }
  if (managerId !== undefined && context.repo.members.findById(managerId) === undefined) {
    throw new UsageError(`直属上级不存在：${managerId}`);
  }
  if (openId !== undefined) {
    const bound = context.repo.members.findByFeishuOpenId(openId);
    if (bound !== undefined) {
      throw new SdrError(
        ERROR_CODES.STORE_TRANSACTION_FAILED,
        `该飞书 open_id 已绑定成员 #${bound.id}`,
        { source: 'store' },
      );
    }
  }

  const id = context.repo.members.insert({
    githubLogin: login,
    displayName,
    ...(openId === undefined ? {} : { feishuOpenId: openId }),
    ...(managerId === undefined ? {} : { managerId }),
  });
  context.stdout(`[member] 已添加 #${id} ${login}（${displayName}）`);
  return 0;
}

function listMembers(context: CliContext): number {
  const members = context.repo.members.listAll();
  if (members.length === 0) {
    context.stdout('[member] 暂无成员，请先执行 sdr member add');
    return 0;
  }
  context.stdout('id\tgithub\tfeishu_open_id\tdisplay_name\tmanager\tactive');
  for (const member of members) {
    context.stdout(
      [
        member.id,
        member.githubLogin,
        member.feishuOpenId ?? '-',
        member.displayName,
        member.managerId ?? '-',
        member.active ? '1' : '0',
      ].join('\t'),
    );
  }
  return 0;
}

export function runMember(context: CliContext, args: ParsedArgs): number {
  switch (args.subcommand) {
    case 'add':
      return addMember(context, args);
    case 'list':
      return listMembers(context);
    default:
      throw new UsageError(USAGE_TEXT);
  }
}

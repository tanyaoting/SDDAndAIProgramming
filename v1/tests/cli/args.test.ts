import { describe, expect, it } from 'vitest';
import { UsageError, flagList, flagValue, hasFlag, parseArgs, requireDate } from '../../src/cli/args.js';

describe('CLI 参数解析', () => {
  it('解析命令、可重复参数与布尔参数', () => {
    const args = parseArgs(['collect', '--date', '2026-11-25', '--source', 'github', '--source', 'feishu', '--manual', '完成接口']);
    expect(args.command).toBe('collect');
    expect(flagValue(args, 'date')).toBe('2026-11-25');
    expect(flagList(args, 'source')).toEqual(['github', 'feishu']);
    expect(flagList(args, 'manual')).toEqual(['完成接口']);
    expect(hasFlag(args, 'force')).toBe(false);
  });

  it('支持 --key=value 形式', () => {
    const args = parseArgs(['push', '--date=2026-11-25', '--dry-run']);
    expect(flagValue(args, 'date')).toBe('2026-11-25');
    expect(hasFlag(args, 'dry-run')).toBe(true);
  });

  it('未知命令、未知参数、缺少取值、多余位置参数均抛 UsageError', () => {
    expect(() => parseArgs(['unknown'])).toThrow(UsageError);
    expect(() => parseArgs(['push', '--unknown'])).toThrow(UsageError);
    expect(() => parseArgs(['push', '--date'])).toThrow(UsageError);
    expect(() => parseArgs(['push', 'extra'])).toThrow(UsageError);
    expect(() => parseArgs(['push', '--dry-run=yes'])).toThrow(UsageError);
  });

  it('无参数或 --help 返回 help 命令', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['collect', '--help']).command).toBe('collect');
  });

  it('日期与成员 id 校验', () => {
    expect(requireDate('2026-11-25', '2026-01-01')).toBe('2026-11-25');
    expect(requireDate(undefined, '2026-01-01')).toBe('2026-01-01');
    expect(() => requireDate('2026/11/25', '2026-01-01')).toThrow(UsageError);
  });
});

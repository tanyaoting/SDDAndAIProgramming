import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ERROR_CODES, SdrError } from './errors.js';
import type { EntryState } from './types.js';

/**
 * 环境变量 schema（design.md §2 config 模块）。
 * 全部凭证经环境变量注入，禁止写入代码与仓库（proposal §5 技术约束）。
 */
const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  SDR_DB_PATH: z.string().min(1).default('data/sdr.db'),
});

const REQUIRED_KEYS = [
  'GITHUB_TOKEN',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const;

export interface SdrConfig {
  readonly github: { readonly token: string };
  readonly feishu: { readonly appId: string; readonly appSecret: string };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly pass: string;
    readonly from: string;
  };
  readonly dbPath: string;
}

/**
 * 从环境变量加载并校验配置。
 * 缺失或非法时抛 SDR-E303（E3xx → CLI 退出码 9），错误信息包含具体变量名（T-002 验收标准）。
 */
export function loadConfig(env: Record<string, string | undefined>): SdrConfig {
  const missing = REQUIRED_KEYS.filter((key) => !(env[key] ?? '').trim());
  if (missing.length > 0) {
    throw new SdrError(
      ERROR_CODES.ENV_MISSING,
      `缺少必需环境变量：${missing.join('、')}`,
      { source: 'config' },
    );
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const varName = first?.path.map(String).join('.') ?? '(未知变量)';
    throw new SdrError(
      ERROR_CODES.ENV_MISSING,
      `环境变量 ${varName} 非法：${first?.message ?? ''}`,
      { source: 'config' },
    );
  }

  const e = parsed.data;
  return {
    github: { token: e.GITHUB_TOKEN },
    feishu: { appId: e.FEISHU_APP_ID, appSecret: e.FEISHU_APP_SECRET },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.SMTP_FROM,
    },
    dbPath: e.SDR_DB_PATH,
  };
}

/* ------------------------------------------------------------------ */
/* YAML 配置（ADR-005 / ADR-003）：零依赖的受限子集解析器              */
/* 仅支持本项目用到的形态：块映射、对象序列、标量、引号与注释。        */
/* ------------------------------------------------------------------ */

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble) {
      const previous = raw[i - 1];
      if (i === 0 || previous === ' ' || previous === '\t') return raw.slice(0, i);
    }
  }
  return raw;
}

function parseScalar(text: string): string | number | boolean | null {
  const trimmed = text.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (quoted && trimmed.length >= 2) return trimmed.slice(1, -1);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  const num = Number(trimmed);
  return trimmed !== '' && Number.isFinite(num) ? num : trimmed;
}

function yamlError(message: string): SdrError {
  return new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, `配置解析失败：${message}`, {
    source: 'config',
  });
}

function parseMapping(
  lines: YamlLine[],
  cursor: { index: number },
  indent: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || line.text.startsWith('-')) break;
    const separator = line.text.indexOf(':');
    if (separator < 0) throw yamlError(`缺少冒号：${line.text}`);
    const key = line.text.slice(0, separator).trim();
    const inline = line.text.slice(separator + 1).trim();
    cursor.index += 1;
    if (inline !== '') {
      result[key] = parseScalar(inline);
      continue;
    }
    const next = lines[cursor.index];
    result[key] =
      next === undefined || next.indent <= indent ? null : parseNode(lines, cursor, next.indent);
  }
  return result;
}

function parseSequence(lines: YamlLine[], cursor: { index: number }, indent: number): unknown[] {
  const result: unknown[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || !line.text.startsWith('-')) break;
    const rest = line.text.slice(1).trim();
    if (rest === '') {
      cursor.index += 1;
      const next = lines[cursor.index];
      result.push(
        next === undefined || next.indent <= indent ? null : parseNode(lines, cursor, next.indent),
      );
      continue;
    }
    if (!rest.includes(':')) {
      result.push(parseScalar(rest));
      cursor.index += 1;
      continue;
    }
    // "- key: value" 视为缩进 +2 的映射起点。
    const itemIndent = indent + 2;
    lines[cursor.index] = { indent: itemIndent, text: rest };
    result.push(parseMapping(lines, cursor, itemIndent));
  }
  return result;
}

function parseNode(lines: YamlLine[], cursor: { index: number }, indent: number): unknown {
  const line = lines[cursor.index];
  if (line === undefined) return null;
  return line.text.startsWith('-') ? parseSequence(lines, cursor, indent) : parseMapping(lines, cursor, indent);
}

/** 解析受限 YAML 子集；失败抛 SDR-E301。 */
export function parseYaml(source: string): unknown {
  const lines: YamlLine[] = source
    .split('\n')
    .map((raw) => {
      const stripped = stripComment(raw);
      return {
        indent: stripped.length - stripped.trimStart().length,
        text: stripped.trim(),
      };
    })
    .filter((line) => line.text !== '');
  if (lines.length === 0) return {};
  return parseNode(lines, { index: 0 }, lines[0]?.indent ?? 0);
}

export function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'));
}

/* ------------------------------------------------------------------ */
/* 时段与关键词配置                                                    */
/* ------------------------------------------------------------------ */

export interface WorkBlock {
  readonly name: string;
  readonly start: string;
  readonly end: string;
}

export interface KeywordRule {
  readonly pattern: RegExp;
  readonly state: EntryState;
  readonly weight: number;
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const workHoursSchema = z.object({
  work_blocks: z
    .array(
      z.object({
        name: z.string().min(1),
        start: z.string().regex(timePattern),
        end: z.string().regex(timePattern),
      }),
    )
    .min(1),
});

const keywordsSchema = z.object({
  rules: z
    .array(
      z.object({
        pattern: z.string().min(1),
        state: z.enum(['done', 'doing', 'plan', 'blocked']),
        weight: z.number().positive(),
      }),
    )
    .min(1),
});

function minutesOf(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** 加载并校验时段表：升序、不重叠、start < end（违约抛 SDR-E301，含字段名）。 */
export function loadWorkBlocks(path: string): WorkBlock[] {
  const parsed = workHoursSchema.safeParse(readYamlFile(path));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SdrError(
      ERROR_CODES.WORK_BLOCKS_INVALID,
      `时段配置字段 ${issue?.path.join('.') ?? '(未知)'} 非法：${issue?.message ?? ''}`,
      { source: 'config' },
    );
  }

  const blocks: WorkBlock[] = parsed.data.work_blocks;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) continue;
    if (minutesOf(block.start) >= minutesOf(block.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段 ${block.name} 的 start 必须早于 end`,
        { source: 'config' },
      );
    }
    const previous = blocks[index - 1];
    if (previous !== undefined) {
      if (minutesOf(block.start) < minutesOf(previous.start)) {
        throw new SdrError(
          ERROR_CODES.WORK_BLOCKS_INVALID,
          `时段 ${block.name} 未按起点升序`,
          { source: 'config' },
        );
      }
      if (minutesOf(block.start) < minutesOf(previous.end)) {
        throw new SdrError(
          ERROR_CODES.WORK_BLOCKS_INVALID,
          `时段 ${block.name} 与 ${previous.name} 重叠`,
          { source: 'config' },
        );
      }
    }
  }
  return blocks;
}

/** 加载并校验关键词规则；非法正则在校验阶段即被拒（T-011）。 */
export function loadKeywordRules(path: string): KeywordRule[] {
  const parsed = keywordsSchema.safeParse(readYamlFile(path));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SdrError(
      ERROR_CODES.WORK_BLOCKS_INVALID,
      `关键词配置字段 ${issue?.path.join('.') ?? '(未知)'} 非法：${issue?.message ?? ''}`,
      { source: 'config' },
    );
  }

  return parsed.data.rules.map((rule) => {
    try {
      return { pattern: new RegExp(rule.pattern), state: rule.state, weight: rule.weight };
    } catch (error) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `关键词规则正则非法：${rule.pattern}`,
        { source: 'config', cause: error },
      );
    }
  });
}

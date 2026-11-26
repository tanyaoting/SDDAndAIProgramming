import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ERROR_CODES, SdrError } from './errors.js';
import type { EntryState } from './types.js';

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
  SDR_PUSH_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '格式应为 HH:mm')
    .default('18:00'),
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
  readonly pushTime: string;
}

export function loadConfig(env: Record<string, string | undefined>): SdrConfig {
  const missing = REQUIRED_KEYS.filter((key) => !(env[key] ?? '').trim());
  if (missing.length > 0) {
    throw new SdrError(ERROR_CODES.ENV_MISSING, `缺少必需环境变量：${missing.join('、')}`, {
      source: 'config',
    });
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
    pushTime: e.SDR_PUSH_TIME,
  };
}

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

function readYamlDocument(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, `无法读取配置文件：${path}`, {
      source: 'config',
      cause,
    });
  }
}

export function loadWorkBlocks(path: string): WorkBlock[] {
  const parsed = workHoursSchema.safeParse(readYamlDocument(path));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SdrError(
      ERROR_CODES.WORK_BLOCKS_INVALID,
      `时段配置字段 ${issue?.path.join('.') ?? '(未知)'} 非法：${issue?.message ?? ''}`,
      { source: 'config' },
    );
  }

  const blocks = parsed.data.work_blocks.map((b) => ({
    name: b.name,
    start: b.start,
    end: b.end,
  }));

  for (let i = 0; i < blocks.length; i += 1) {
    const current = blocks[i]!;
    if (minutesOf(current.start) >= minutesOf(current.end)) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `时段配置字段 work_blocks.${i} 非法：start 必须早于 end`,
        { source: 'config' },
      );
    }
    if (i > 0) {
      const prev = blocks[i - 1]!;
      if (minutesOf(current.start) < minutesOf(prev.end)) {
        throw new SdrError(
          ERROR_CODES.WORK_BLOCKS_INVALID,
          `时段配置字段 work_blocks.${i} 非法：与前一时段重叠`,
          { source: 'config' },
        );
      }
      if (minutesOf(current.start) < minutesOf(prev.start)) {
        throw new SdrError(
          ERROR_CODES.WORK_BLOCKS_INVALID,
          `时段配置字段 work_blocks.${i} 非法：须按起点升序`,
          { source: 'config' },
        );
      }
    }
  }

  return blocks;
}

export function loadKeywordRules(path: string): KeywordRule[] {
  const raw = readYamlDocument(path);
  const parsed = keywordsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SdrError(
      ERROR_CODES.WORK_BLOCKS_INVALID,
      `关键词配置字段 ${issue?.path.join('.') ?? '(未知)'} 非法：${issue?.message ?? ''}`,
      { source: 'config' },
    );
  }

  return parsed.data.rules.map((rule, index) => {
    try {
      return {
        pattern: new RegExp(rule.pattern, 'i'),
        state: rule.state,
        weight: rule.weight,
      };
    } catch (cause) {
      throw new SdrError(
        ERROR_CODES.WORK_BLOCKS_INVALID,
        `关键词配置字段 rules.${index}.pattern 非法：正则无法编译`,
        { source: 'config', cause },
      );
    }
  });
}

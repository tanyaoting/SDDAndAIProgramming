import { z } from 'zod';
import { ERROR_CODES, SdrError } from './errors.js';

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

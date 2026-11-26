import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { systemClock } from '../clock.js';
import type { Clock } from '../types.js';
import { applyEnvFile } from '../env-file.js';
import type { SdrConfig } from '../config.js';
import { loadConfig } from '../config.js';
import type { Mailer } from '../publisher/mail.js';
import { createMailer } from '../publisher/mail.js';
import type { Repo } from '../store/repo.js';
import { openRepo } from '../store/repo.js';

/** CLI 运行上下文：所有外部依赖在此装配，命令函数只依赖该接口（便于测试注入）。 */
export interface CliContext {
  readonly repo: Repo;
  readonly clock: Clock;
  readonly config: SdrConfig;
  readonly mailer: Mailer;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  close(): void;
}

export interface CreateContextOptions {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly clock?: Clock;
  readonly mailer?: Mailer;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

function resolveDbPath(cwd: string, dbPath: string): string {
  if (dbPath === ':memory:') return dbPath;
  const absolute = isAbsolute(dbPath) ? dbPath : join(cwd, dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

export function createContext(options: CreateContextOptions = {}): CliContext {
  const cwd = options.cwd ?? process.cwd();
  // 显式传入 env（测试）不读文件；正常运行自动合并当前目录 .env。
  const env = options.env ?? applyEnvFile(join(cwd, '.env'), { ...process.env });
  const clock = options.clock ?? systemClock;
  const config = loadConfig(env);
  const repo = openRepo(resolveDbPath(cwd, config.dbPath), clock);
  const mailer = options.mailer ?? createMailer(config.smtp);

  return {
    repo,
    clock,
    config,
    mailer,
    env,
    cwd,
    stdout: options.stdout ?? ((line: string): void => console.log(line)),
    stderr: options.stderr ?? ((line: string): void => console.error(line)),
    close: (): void => repo.close(),
  };
}

/** 告警收件人：`SDR_ALERT_TO` 优先，缺省回到发件人自身（避免告警无处可去）。 */
export function alertRecipients(context: CliContext): string[] {
  const raw = context.env.SDR_ALERT_TO;
  if (raw !== undefined && raw.trim() !== '') {
    return raw.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  return [context.config.smtp.from];
}

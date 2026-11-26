import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { FeishuApp, FeishuUserToken } from './collectors/feishu-oauth.js';
import { refreshUserToken } from './collectors/feishu-oauth.js';
import { ERROR_CODES, SdrError } from './errors.js';
import type { Clock } from './types.js';

/**
 * 飞书用户 token 本地存储（规格固定 9 张表，不新增表）。
 * 文件 0600、原子写；键为 open_id，一条记录对应一个已授权成员。
 */

export const DEFAULT_TOKEN_FILE = 'data/feishu-tokens.json';
const FILE_VERSION = 1;
/** 提前 60 秒视为过期，避免在请求途中失效。 */
export const REFRESH_SKEW_MS = 60_000;

export interface FeishuTokenRecord {
  readonly openId: string;
  readonly memberId: number;
  readonly name: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly refreshExpiresAt: number;
  readonly scope: string;
}

interface TokenFile {
  readonly version: number;
  readonly tokens: Record<string, FeishuTokenRecord>;
}

export function resolveTokenFilePath(
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  const configured = (env.SDR_FEISHU_TOKEN_FILE ?? '').trim();
  const path = configured === '' ? DEFAULT_TOKEN_FILE : configured;
  return isAbsolute(path) ? path : join(cwd, path);
}

function isRecord(value: unknown): value is FeishuTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<FeishuTokenRecord>;
  return (
    typeof record.openId === 'string' &&
    typeof record.memberId === 'number' &&
    typeof record.accessToken === 'string'
  );
}

export class FeishuTokenStore {
  constructor(private readonly path: string) {}

  get filePath(): string {
    return this.path;
  }

  private read(): TokenFile {
    if (!existsSync(this.path)) return { version: FILE_VERSION, tokens: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TokenFile>;
      const tokens: Record<string, FeishuTokenRecord> = {};
      for (const [openId, record] of Object.entries(parsed.tokens ?? {})) {
        if (!isRecord(record)) continue;
        tokens[openId] = record;
      }
      return { version: FILE_VERSION, tokens };
    } catch (error) {
      throw new SdrError(
        ERROR_CODES.FEISHU_AUTH_FAILED,
        `飞书 token 文件无法解析：${this.path}`,
        { source: 'feishu', cause: error },
      );
    }
  }

  list(): FeishuTokenRecord[] {
    return Object.values(this.read().tokens).sort(
      (a, b) => a.memberId - b.memberId || a.openId.localeCompare(b.openId),
    );
  }

  findByMember(memberId: number): FeishuTokenRecord | undefined {
    return this.list().find((record) => record.memberId === memberId);
  }

  /** 写入/覆盖单条记录：先写临时文件再重命名，避免半截 JSON。 */
  save(record: FeishuTokenRecord): void {
    const file = this.read();
    const next: TokenFile = {
      version: FILE_VERSION,
      tokens: { ...file.tokens, [record.openId]: record },
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, encoding: 'utf8' });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }
}

export function needsRefresh(record: FeishuTokenRecord, nowMs: number): boolean {
  return record.expiresAt - nowMs <= REFRESH_SKEW_MS;
}

export function canRefresh(record: FeishuTokenRecord, nowMs: number): boolean {
  return record.refreshToken !== '' && record.refreshExpiresAt > nowMs;
}

export interface EnsureTokenOptions {
  readonly app: FeishuApp;
  readonly clock: Clock;
  readonly store: FeishuTokenStore;
  readonly logger?: (line: string) => void;
}

/**
 * 返回可用 token：未到期直接用；到期前用 refresh_token 续期并回存。
 * 无法续期时抛 E201，提示重新执行 feishu-auth（refresh_token 有效期有限）。
 */
export async function ensureFreshToken(
  record: FeishuTokenRecord,
  options: EnsureTokenOptions,
): Promise<FeishuTokenRecord> {
  const nowMs = options.clock.now().getTime();
  if (!needsRefresh(record, nowMs)) return record;

  if (!canRefresh(record, nowMs)) {
    throw new SdrError(
      ERROR_CODES.FEISHU_AUTH_FAILED,
      `成员 #${record.memberId} 的飞书授权已过期，请重新执行：sdr feishu-auth --member ${record.memberId}`,
      { source: 'feishu' },
    );
  }

  const token: FeishuUserToken = await refreshUserToken({
    app: options.app,
    refreshToken: record.refreshToken,
    clock: options.clock,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  const next: FeishuTokenRecord = { ...record, ...token };
  options.store.save(next);
  options.logger?.(`[feishu] 成员 #${record.memberId} 的 user_access_token 已刷新`);
  return next;
}

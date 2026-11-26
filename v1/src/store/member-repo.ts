import type Database from 'better-sqlite3';
import { toZonedIsoString } from '../clock.js';
import { ERROR_CODES, SdrError } from '../errors.js';
import type { Clock, Member } from '../types.js';

/**
 * 成员查询（design.md §3.2 member / §4.2 history 权限）。
 * 采集器需要的「外部账号 → member_id」映射与 CLI 的可见性判定都收敛在此。
 */

interface MemberRow {
  id: number;
  github_login: string;
  feishu_open_id: string | null;
  display_name: string;
  manager_id: number | null;
  active: number;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    githubLogin: row.github_login,
    ...(row.feishu_open_id === null ? {} : { feishuOpenId: row.feishu_open_id }),
    displayName: row.display_name,
    ...(row.manager_id === null ? {} : { managerId: row.manager_id }),
    active: row.active === 1,
  };
}

const SELECT_ALL = 'SELECT * FROM member';

export interface MemberInput {
  readonly githubLogin: string;
  readonly displayName: string;
  readonly feishuOpenId?: string;
  readonly managerId?: number;
}

export class MemberRepo {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
  ) {}

  /** 录入成员；github_login / feishu_open_id 冲突转 SDR-E501，避免把驱动异常漏到 CLI。 */
  insert(input: MemberInput): number {
    try {
      const info = this.db
        .prepare(
          `INSERT INTO member (github_login, feishu_open_id, display_name, manager_id, active, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
        )
        .run(
          input.githubLogin,
          input.feishuOpenId ?? null,
          input.displayName,
          input.managerId ?? null,
          toZonedIsoString(this.clock, this.clock.now()),
        );
      return Number(info.lastInsertRowid);
    } catch (error) {
      throw new SdrError(
        ERROR_CODES.STORE_TRANSACTION_FAILED,
        `成员写入失败（GitHub 登录名或飞书 open_id 已被占用）：${input.githubLogin}`,
        { source: 'store', cause: error },
      );
    }
  }

  /** 绑定/解绑飞书账号（OAuth 授权成功后回写 member.feishu_open_id）。 */
  updateFeishuOpenId(id: number, openId: string | null): void {
    this.db.prepare('UPDATE member SET feishu_open_id = ? WHERE id = ?').run(openId, id);
  }

  listAll(): Member[] {
    const rows = this.db.prepare(`${SELECT_ALL} ORDER BY id ASC`).all() as MemberRow[];
    return rows.map(toMember);
  }

  findById(id: number): Member | undefined {
    const row = this.db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as MemberRow | undefined;
    return row === undefined ? undefined : toMember(row);
  }

  findByGithubLogin(login: string): Member | undefined {
    const row = this.db
      .prepare(`${SELECT_ALL} WHERE lower(github_login) = lower(?)`)
      .get(login) as MemberRow | undefined;
    return row === undefined ? undefined : toMember(row);
  }

  findByFeishuOpenId(openId: string): Member | undefined {
    const row = this.db.prepare(`${SELECT_ALL} WHERE feishu_open_id = ?`).get(openId) as
      | MemberRow
      | undefined;
    return row === undefined ? undefined : toMember(row);
  }

  listActive(): Member[] {
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE active = 1 ORDER BY id ASC`)
      .all() as MemberRow[];
    return rows.map(toMember);
  }

  /** CS-09：仅本人或直属上级可见；无调用者身份一律拒绝。 */
  canAccess(actorId: number | undefined, targetMemberId: number): boolean {
    if (actorId === undefined) return false;
    if (actorId === targetMemberId) return true;
    return this.findById(targetMemberId)?.managerId === actorId;
  }
}

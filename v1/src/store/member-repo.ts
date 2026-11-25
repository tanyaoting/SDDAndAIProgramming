import type Database from 'better-sqlite3';
import type { Member } from '../types.js';

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

export class MemberRepo {
  constructor(private readonly db: Database.Database) {}

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

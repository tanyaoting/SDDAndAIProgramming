import type Database from 'better-sqlite3';
import type { EntryInput } from './model.js';

/**
 * 单条条目的写入（`sdr edit --add-text`，design.md §4.2）。
 * 四表原子写入仍由 `Repo.saveReportBundle` 负责；此处只处理「向已有日报追加一条」。
 */
export class EntryRepo {
  constructor(private readonly db: Database.Database) {}

  insertEntry(reportId: number, entry: EntryInput): number {
    const write = this.db.transaction((): number => {
      const info = this.db
        .prepare(
          `INSERT INTO entry
             (report_id, time_block, state, content, order_index, original_date, source_event_id,
              is_manual, attribution_kind, attribution_confirmed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          entry.timeBlock,
          entry.state,
          entry.content,
          entry.orderIndex,
          entry.originalDate ?? null,
          entry.sourceEventId ?? null,
          entry.isManual ? 1 : 0,
          entry.attributionKind,
          entry.attributionConfirmed ? 1 : 0,
        );
      const entryId = Number(info.lastInsertRowid);
      const insertMember = this.db.prepare(
        'INSERT INTO entry_member (entry_id, member_id, role) VALUES (?, ?, ?)',
      );
      for (const member of entry.members) {
        insertMember.run(entryId, member.memberId, member.role);
      }
      const insertLink = this.db.prepare(
        'INSERT INTO source_link (entry_id, link_type, target) VALUES (?, ?, ?)',
      );
      for (const link of entry.links) {
        insertLink.run(entryId, link.linkType, link.target);
      }
      return entryId;
    });
    return write();
  }
}

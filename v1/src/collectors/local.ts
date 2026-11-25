import { readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { parseInstant } from '../clock.js';
import type { Clock, Event } from '../types.js';
import { makeDedupeKey } from './normalize.js';

/** 固定忽略名单，不做可配置（tasks.md 削减策略第 3 项）。 */
export const LOCAL_IGNORE_NAMES = ['.git', 'node_modules', 'dist', 'data'] as const;

export interface LocalCollectOptions {
  readonly rootDir: string;
  /** 目录所有者；本地文件无作者信息，归属由扫描根目录决定。 */
  readonly memberId: number;
  readonly since: Date;
  readonly until: Date;
  readonly runId: string;
  readonly clock: Clock;
  readonly ignoreNames?: readonly string[];
}

/** 按 mtime 扫描本地目录，返回统计窗口内的文件变更事件（FR-03）。 */
export function collectLocal(options: LocalCollectOptions): Event[] {
  const ignore = new Set(options.ignoreNames ?? LOCAL_IGNORE_NAMES);
  const root = resolve(options.rootDir);
  const events: Event[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      const stats = statSync(absolute);
      const occurredAt = parseInstant(stats.mtime.getTime());
      if (occurredAt < options.since || occurredAt >= options.until) continue;

      events.push({
        memberId: options.memberId,
        source: 'local',
        sourceId: `${absolute}:${Math.floor(stats.mtimeMs)}`,
        kind: 'file_change',
        occurredAt,
        title: basename(absolute),
        detail: relative(root, absolute),
        dedupeKey: makeDedupeKey({
          sourceId: `${absolute}:${Math.floor(stats.mtimeMs)}`,
          memberId: options.memberId,
          occurredAt,
          clock: options.clock,
        }),
        isPrimary: true,
        runId: options.runId,
        payload: { path: absolute, size: stats.size },
      });
    }
  };

  walk(root);
  return events;
}

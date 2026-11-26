import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Clock, Event } from '../types.js';
import { buildDedupeKey } from './normalize.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'data']);

export interface LocalCollectOptions {
  readonly rootDir: string;
  readonly since: Date;
  readonly until: Date;
  readonly clock: Clock;
  readonly memberId: number;
  readonly runId: string;
}

function isInWindow(at: Date, since: Date, until: Date): boolean {
  const ms = at.getTime();
  return ms >= since.getTime() && ms < until.getTime();
}

async function walk(
  dir: string,
  since: Date,
  until: Date,
  bucket: { path: string; mtime: Date }[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(fullPath, since, until, bucket);
      continue;
    }

    if (!stat.isFile()) continue;
    const absolute = resolve(fullPath);
    const mtime = stat.mtime;
    if (isInWindow(mtime, since, until)) {
      bucket.push({ path: absolute, mtime });
    }
  }
}

export async function collectLocal(options: LocalCollectOptions): Promise<Event[]> {
  const root = resolve(options.rootDir);
  const found: { path: string; mtime: Date }[] = [];
  await walk(root, options.since, options.until, found);

  return found.map((file) => ({
    memberId: options.memberId,
    source: 'local',
    sourceId: file.path,
    kind: 'file_change',
    occurredAt: file.mtime,
    title: file.path.split('/').pop() ?? file.path,
    detail: file.path,
    dedupeKey: buildDedupeKey(file.path, file.mtime, options.memberId, options.clock),
    isPrimary: false,
    runId: options.runId,
  }));
}
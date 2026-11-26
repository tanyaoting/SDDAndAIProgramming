import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixedClock, dayWindow } from '../../src/clock.js';
import { collectLocal } from '../../src/collectors/local.js';

describe('collectLocal', () => {
  const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
  const { since, until } = dayWindow(clock, '2026-11-25');

  it('按 mtime 窗口扫描并跳过忽略目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdr-local-'));
    const inWindow = join(root, 'note.md');
    writeFileSync(inWindow, 'hello');
    const touched = new Date('2026-11-25T03:00:00.000Z');
    utimesSync(inWindow, touched, touched);

    const ignoredDir = join(root, 'node_modules');
    mkdirSync(ignoredDir);
    const ignoredFile = join(ignoredDir, 'pkg.js');
    writeFileSync(ignoredFile, 'x');
    utimesSync(ignoredFile, touched, touched);

    const events = await collectLocal({
      rootDir: root,
      since,
      until,
      clock,
      memberId: 3,
      runId: 'run-local',
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('file_change');
    expect(events[0]?.detail).toBe(inWindow);
    expect(events[0]?.detail?.startsWith('/')).toBe(true);
  });

  it('不跟随符号链接', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdr-local-link-'));
    const real = join(root, 'real.txt');
    writeFileSync(real, 'linked');
    const link = join(root, 'alias.txt');
    symlinkSync(real, link);
    const touched = new Date('2026-11-25T03:00:00.000Z');
    utimesSync(link, touched, touched);

    const events = await collectLocal({
      rootDir: root,
      since,
      until,
      clock,
      memberId: 3,
      runId: 'run-local',
    });

    const paths = events.map((event) => event.detail);
    expect(paths).toContain(real);
    expect(paths).not.toContain(link);
  });
});
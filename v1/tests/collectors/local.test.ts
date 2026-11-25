import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { LOCAL_IGNORE_NAMES, collectLocal } from '../../src/collectors/local.js';

const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
const IN_WINDOW = new Date('2026-11-25T09:00:00+08:00');
const OUT_OF_WINDOW = new Date('2026-11-20T09:00:00+08:00');

let root: string;

function touch(path: string, at: Date): void {
  utimesSync(path, at, at);
}

function options(): Parameters<typeof collectLocal>[0] {
  return {
    rootDir: root,
    memberId: 7,
    since: new Date('2026-11-25T00:00:00+08:00'),
    until: new Date('2026-11-26T00:00:00+08:00'),
    runId: 'run-1',
    clock,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sdr-local-'));
  writeFileSync(join(root, 'report.md'), '今日产出');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'notes.txt'), '子目录产出');
  writeFileSync(join(root, 'old.md'), '过期文件');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'dep.js'), '依赖');
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'config'), 'git');

  touch(join(root, 'report.md'), IN_WINDOW);
  touch(join(root, 'sub', 'notes.txt'), IN_WINDOW);
  touch(join(root, 'old.md'), OUT_OF_WINDOW);
  touch(join(root, 'node_modules', 'dep.js'), IN_WINDOW);
  touch(join(root, '.git', 'config'), IN_WINDOW);

  symlinkSync(join(root, 'report.md'), join(root, 'link.md'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('T-008 本地文件扫描器', () => {
  it('仅返回窗口内 mtime 变更的文件，路径为绝对路径', () => {
    const events = collectLocal(options());

    expect(events.map((event) => event.title).sort()).toEqual(['notes.txt', 'report.md']);
    expect(events.map((event) => event.detail).sort()).toEqual(['report.md', 'sub/notes.txt']);
    expect(events.every((event) => event.source === 'local' && event.kind === 'file_change')).toBe(
      true,
    );
    expect(events.every((event) => event.memberId === 7 && event.isPrimary)).toBe(true);
    for (const event of events) {
      expect(event.sourceId.startsWith(root)).toBe(true);
      expect(event.occurredAt.getTime()).toBe(IN_WINDOW.getTime());
    }
  });

  it('跳过固定忽略名单（.git/node_modules/dist/data）', () => {
    expect([...LOCAL_IGNORE_NAMES]).toEqual(['.git', 'node_modules', 'dist', 'data']);
    const titles = collectLocal(options()).map((event) => event.title);
    expect(titles).not.toContain('dep.js');
    expect(titles).not.toContain('config');
  });

  it('不追踪符号链接（link.md 不产生重复事件）', () => {
    const titles = collectLocal(options()).map((event) => event.title);
    expect(titles.filter((title) => title === 'report.md')).toHaveLength(1);
    expect(titles).not.toContain('link.md');
  });
});

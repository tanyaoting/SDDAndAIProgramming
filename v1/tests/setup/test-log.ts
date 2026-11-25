/**
 * 测试记录落盘。
 *
 * 作为 vitest 的 setupFiles 在每个测试文件内执行，逐条把用例结果追加到
 * `tests/logs/test-YYYY-MM-DD.log`，作为「已跑过、结果如何」的本地证据。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'vitest';

const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../logs');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function logPath(): string {
  const d = new Date();
  return join(LOG_DIR, `test-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
}

function write(line: string): void {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(logPath(), `${line}\n`, 'utf8');
}

function stamp(d: Date): string {
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${d.toISOString().slice(0, 10)} ${time}`;
}

let startedAt = 0;

beforeEach(() => {
  startedAt = performance.now();
});

afterEach((context) => {
  const state = context.task.result?.state ?? 'unknown';
  const durationMs = (performance.now() - startedAt).toFixed(1).padStart(8);
  const file = relative(process.cwd(), context.task.file?.name ?? '(unknown)');
  write(`[${stamp(new Date())}] ${state.toUpperCase().padEnd(4)} ${durationMs}ms  ${file} :: ${context.task.name}`);
});

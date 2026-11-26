import { HistoryAccessDenied, type Repo } from '../store/repo.js';
import { EXIT, type ExitCode } from './exit.js';

export interface HistoryOptions {
  readonly actor: number;
  readonly member: number;
  readonly from: string;
  readonly to: string;
}

export function runHistory(
  repo: Repo,
  options: HistoryOptions,
  write: (text: string) => void = (text) => process.stdout.write(text),
): ExitCode {
  try {
    const rows = repo.findHistory(options.actor, options.member, options.from, options.to);
    for (const item of rows) {
      const header = `${item.report.reportDate} [${item.report.status}]`;
      write(`${header}\n`);
      if (item.report.body !== undefined && item.report.body !== '') {
        write(`${item.report.body}\n`);
      }
      for (const entry of item.entries) {
        write(`- ${entry.timeBlock}/${entry.state}: ${entry.content}\n`);
      }
      write('\n');
    }
    return EXIT.OK;
  } catch (error) {
    if (error instanceof HistoryAccessDenied) return EXIT.ACCESS_DENIED;
    throw error;
  }
}
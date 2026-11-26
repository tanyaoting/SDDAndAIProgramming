import type { Repo } from '../store/repo.js';
import { EXIT, type ExitCode } from './exit.js';

export interface EditOptions {
  readonly date: string;
  readonly memberId: number;
  readonly addText?: string;
  readonly addRef?: string;
  readonly removeEntry?: number;
  readonly acceptAttribution?: boolean;
  readonly acceptAll?: boolean;
  readonly timeBlock?: string;
}

export function runEdit(repo: Repo, options: EditOptions): ExitCode {
  const report = repo.findReport(options.memberId, options.date);
  if (report?.id === undefined && options.removeEntry === undefined && !options.acceptAttribution) {
    return EXIT.ENTRY_NOT_FOUND;
  }

  if (options.removeEntry !== undefined) {
    const ok = repo.removeEntryById(options.removeEntry);
    return ok ? EXIT.OK : EXIT.ENTRY_NOT_FOUND;
  }

  if (options.addText !== undefined) {
    if (!options.addRef) return EXIT.USAGE;
    try {
      repo.addManualTextEntry(
        options.memberId,
        options.date,
        options.addText,
        options.addRef,
        options.timeBlock ?? 'afternoon',
      );
      return EXIT.OK;
    } catch {
      return EXIT.ENTRY_NOT_FOUND;
    }
  }

  if (options.acceptAttribution === true && report?.id !== undefined) {
    repo.acceptAttribution(report.id, options.acceptAll === true);
    return EXIT.OK;
  }

  return EXIT.USAGE;
}
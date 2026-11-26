export interface GlobalFlags {
  readonly envFile?: string;
}

export interface ParsedArgv {
  readonly command?: string;
  readonly flags: Map<string, string | true>;
  readonly positionals: string[];
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    positionals.push(token);
  }
  const command = positionals[0];
  return {
    ...(command === undefined ? {} : { command }),
    flags,
    positionals,
  };
}

export function flagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  if (value === undefined || value === true) return undefined;
  return value;
}

export function flagBoolean(flags: Map<string, string | true>, key: string): boolean {
  return flags.get(key) === true;
}
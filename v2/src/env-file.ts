import { readFileSync } from 'node:fs';

export type EnvMap = Record<string, string | undefined>;

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (key !== '') result[key] = value;
  }
  return result;
}

export function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function applyEnvFile(path: string, target: EnvMap): EnvMap {
  const merged: EnvMap = { ...target };
  for (const [key, value] of Object.entries(readEnvFile(path))) {
    if ((merged[key] ?? '') === '' && value !== '') merged[key] = value;
  }
  return merged;
}

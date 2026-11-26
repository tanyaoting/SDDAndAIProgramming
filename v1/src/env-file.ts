import { readFileSync } from 'node:fs';

/**
 * 轻量 `.env` 读取（不引入 dotenv，保持运行时依赖不变）。
 * 规则：忽略空行与 `#` 注释；支持 `KEY=VALUE` 与成对引号；已存在的环境变量优先。
 */

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

/** 文件不存在或不可读时返回空对象，交由 `loadConfig` 统一报 E303。 */
export function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** 把文件中的键合并进目标环境：已有非空值不被覆盖；空值视为未配置（保留默认值）。 */
export function applyEnvFile(path: string, target: EnvMap): EnvMap {
  const merged: EnvMap = { ...target };
  for (const [key, value] of Object.entries(readEnvFile(path))) {
    if ((merged[key] ?? '') === '' && value !== '') merged[key] = value;
  }
  return merged;
}

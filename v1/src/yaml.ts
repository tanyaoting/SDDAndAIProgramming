import { readFileSync } from 'node:fs';
import { ERROR_CODES, SdrError } from './errors.js';

/**
 * 零依赖的受限 YAML 子集解析器（ADR-003 / ADR-005）。
 * 仅支持本项目用到的形态：块映射、对象序列、标量、引号与注释。
 */

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble) {
      const previous = raw[i - 1];
      if (i === 0 || previous === ' ' || previous === '\t') return raw.slice(0, i);
    }
  }
  return raw;
}

function parseScalar(text: string): string | number | boolean | null {
  const trimmed = text.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (quoted && trimmed.length >= 2) return trimmed.slice(1, -1);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  const num = Number(trimmed);
  return trimmed !== '' && Number.isFinite(num) ? num : trimmed;
}

function yamlError(message: string): SdrError {
  return new SdrError(ERROR_CODES.WORK_BLOCKS_INVALID, `配置解析失败：${message}`, {
    source: 'config',
  });
}

function parseMapping(
  lines: YamlLine[],
  cursor: { index: number },
  indent: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || line.text.startsWith('-')) break;
    const separator = line.text.indexOf(':');
    if (separator < 0) throw yamlError(`缺少冒号：${line.text}`);
    const key = line.text.slice(0, separator).trim();
    const inline = line.text.slice(separator + 1).trim();
    cursor.index += 1;
    if (inline !== '') {
      result[key] = parseScalar(inline);
      continue;
    }
    const next = lines[cursor.index];
    result[key] =
      next === undefined || next.indent <= indent ? null : parseNode(lines, cursor, next.indent);
  }
  return result;
}

function parseSequence(lines: YamlLine[], cursor: { index: number }, indent: number): unknown[] {
  const result: unknown[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (line === undefined || line.indent !== indent || !line.text.startsWith('-')) break;
    const rest = line.text.slice(1).trim();
    if (rest === '') {
      cursor.index += 1;
      const next = lines[cursor.index];
      result.push(
        next === undefined || next.indent <= indent ? null : parseNode(lines, cursor, next.indent),
      );
      continue;
    }
    if (!rest.includes(':')) {
      result.push(parseScalar(rest));
      cursor.index += 1;
      continue;
    }
    // "- key: value" 视为缩进 +2 的映射起点。
    const itemIndent = indent + 2;
    lines[cursor.index] = { indent: itemIndent, text: rest };
    result.push(parseMapping(lines, cursor, itemIndent));
  }
  return result;
}

function parseNode(lines: YamlLine[], cursor: { index: number }, indent: number): unknown {
  const line = lines[cursor.index];
  if (line === undefined) return null;
  return line.text.startsWith('-')
    ? parseSequence(lines, cursor, indent)
    : parseMapping(lines, cursor, indent);
}

/** 解析受限 YAML 子集；失败抛 SDR-E301。 */
export function parseYaml(source: string): unknown {
  const lines: YamlLine[] = source
    .split('\n')
    .map((raw) => {
      const stripped = stripComment(raw);
      return {
        indent: stripped.length - stripped.trimStart().length,
        text: stripped.trim(),
      };
    })
    .filter((line) => line.text !== '');
  if (lines.length === 0) return {};
  return parseNode(lines, { index: 0 }, lines[0]?.indent ?? 0);
}

export function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'));
}

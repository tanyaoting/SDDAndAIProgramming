import type { KeywordRule } from '../config.js';
import type { EntryState } from '../types.js';

export type { KeywordRule } from '../config.js';

export interface Classification {
  readonly state: EntryState;
  readonly confidence: number;
}

const STATE_ORDER: readonly EntryState[] = ['done', 'doing', 'plan', 'blocked'];

/** 关键词状态判定：按权重取最高分；无命中返回 doing / confidence 0。 */
export function classifyState(text: string, rules: readonly KeywordRule[]): Classification {
  const trimmed = text.trim();
  if (trimmed === '') return { state: 'doing', confidence: 0 };

  const scores = new Map<EntryState, number>();
  let total = 0;
  for (const rule of rules) {
    if (!rule.pattern.test(trimmed)) continue;
    scores.set(rule.state, (scores.get(rule.state) ?? 0) + rule.weight);
    total += rule.weight;
  }
  if (total === 0) return { state: 'doing', confidence: 0 };

  let best: EntryState = 'doing';
  let bestScore = 0;
  for (const state of STATE_ORDER) {
    const score = scores.get(state) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = state;
    }
  }
  return { state: best, confidence: Math.round((bestScore / total) * 100) / 100 };
}
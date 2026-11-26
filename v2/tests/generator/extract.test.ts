import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadKeywordRules } from '../../src/config.js';
import { classifyState } from '../../src/generator/extract.js';

const rules = loadKeywordRules(
  join(dirname(fileURLToPath(import.meta.url)), '../../config/keywords.yaml'),
);

const SAMPLES: readonly { text: string; expected: 'done' | 'doing' | 'plan' | 'blocked' }[] = [
  { text: '已完成鉴权模块并合入主分支', expected: 'done' },
  { text: '修复分页越界缺陷', expected: 'done' },
  { text: '实现数据导出能力', expected: 'doing' },
  { text: '发布候选版本并通过验收', expected: 'done' },
  { text: '联调支付回调链路', expected: 'doing' },
  { text: '排查生产环境告警', expected: 'doing' },
  { text: '推进合同审批流', expected: 'doing' },
  { text: '明日准备需求评审材料', expected: 'plan' },
  { text: '待办：补齐接口文档', expected: 'plan' },
  { text: '阻塞：等待第三方字段确认', expected: 'blocked' },
  { text: '卡住，依赖运维开通白名单', expected: 'blocked' },
  { text: '整理当日会议纪要', expected: 'doing' },
  { text: '调研竞品方案', expected: 'plan' },
  { text: '重构采集模块结构', expected: 'doing' },
  { text: '评审合并请求意见汇总', expected: 'doing' },
];

describe('T-011 关键词规则库与状态判定', () => {
  it('人工标注样本准确率 ≥ 90%', () => {
    const hit = SAMPLES.filter((s) => classifyState(s.text, rules).state === s.expected);
    expect(hit.length / SAMPLES.length).toBeGreaterThanOrEqual(0.9);
  });

  it('无命中返回 doing 且置信度为 0', () => {
    expect(classifyState('整理当日会议纪要', rules)).toEqual({ state: 'doing', confidence: 0 });
    expect(classifyState('   ', rules)).toEqual({ state: 'doing', confidence: 0 });
  });

  it('多规则命中按权重取最高分', () => {
    const result = classifyState('已完成鉴权模块并合入主分支', rules);
    expect(result.state).toBe('done');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
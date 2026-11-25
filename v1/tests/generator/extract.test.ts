import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadKeywordRules } from '../../src/config.js';
import { classifyState } from '../../src/generator/extract.js';

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../config');
const rules = loadKeywordRules(join(CONFIG_DIR, 'keywords.yaml'));

const SAMPLES: readonly { text: string; expected: 'done' | 'doing' | 'plan' | 'blocked' }[] = [
  { text: '完成登录接口并合入主分支', expected: 'done' },
  { text: '修复分页越界问题', expected: 'done' },
  { text: '实现导出 Excel 功能', expected: 'done' },
  { text: '上线新版本并通过验收', expected: 'done' },
  { text: '交付接口文档', expected: 'done' },
  { text: '进行中：联调支付回调', expected: 'doing' },
  { text: '开发中，接入短信服务', expected: 'doing' },
  { text: '排查线上告警', expected: 'doing' },
  { text: '调试分页参数', expected: 'doing' },
  { text: '推进合同审批流程', expected: 'doing' },
  { text: '明天准备需求评审', expected: 'plan' },
  { text: '下一步待办：补充文档', expected: 'plan' },
  { text: '后续计划重构采集层', expected: 'plan' },
  { text: '阻塞：等待第三方接口', expected: 'blocked' },
  { text: '卡住，依赖运维开通权限', expected: 'blocked' },
  { text: '无法访问测试环境', expected: 'blocked' },
  { text: '等待中：对方确认字段', expected: 'blocked' },
  { text: '完成调研，下一步计划实现导出', expected: 'done' },
  { text: '联调中：排查支付回调', expected: 'doing' },
  { text: '整理会议纪要', expected: 'doing' },
];

describe('T-011 关键词规则库与状态判定', () => {
  it('人工标注 20 条样本准确率 ≥ 90%', () => {
    const correct = SAMPLES.filter((sample) => classifyState(sample.text, rules).state === sample.expected);
    expect(correct.length / SAMPLES.length).toBeGreaterThanOrEqual(0.9);
  });

  it('无命中返回 doing 且置信度为 0', () => {
    expect(classifyState('整理会议纪要', rules)).toEqual({ state: 'doing', confidence: 0 });
    expect(classifyState('   ', rules)).toEqual({ state: 'doing', confidence: 0 });
  });

  it('多规则命中按权重取最高分并给出置信度', () => {
    const result = classifyState('完成登录接口并合入主分支', rules);
    expect(result.state).toBe('done');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

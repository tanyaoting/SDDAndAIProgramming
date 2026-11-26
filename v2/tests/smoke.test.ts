import { describe, expect, it } from 'vitest';

/**
 * 工具链冒烟测试（T-001 验收辅助）。
 *
 * 目的不是验证业务逻辑，而是证明 `vitest` 能发现、编译并执行 TS 测试：
 * 若本用例能跑通，后续的红绿循环就具备可信的运行基础。
 * 业务用例由各任务按 TDD 逐个新增，请勿在此文件堆积。
 */
describe('toolchain', () => {
  it('vitest 可执行 TypeScript 测试', () => {
    const sum: number = 1 + 1;
    expect(sum).toBe(2);
  });

  it('Node 运行时满足 engines 要求（>= 22）', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});

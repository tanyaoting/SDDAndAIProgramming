# Superpowers 技能拆解笔记：systematic-debugging

拆解对象：`superpowers` 中的 `systematic-debugging` 技能。

## 拆解笔记

拆解 superpowers v4.0.3 的 systematic-debugging。触发描述：遇到任何 bug、测试失败或异常行为，在提出修复前使用；铁律为"未查清根因不得修复"。步骤分四阶段：①根因调查——细读报错、稳定复现、查近期改动，多组件系统在边界打日志取证；②模式分析——找可用范例、逐项比对差异；③假设验证——单一假设、最小改动；④实施修复——先写失败测试再单点修复，三次失败即质疑架构。配套脚本 `find-polluter.sh` 逐个运行测试文件，定位制造多余文件或状态的"污染者"；另有 `root-cause-tracing.md`、`defense-in-depth.md`、`condition-based-waiting.md` 三份参考。其价值在于把"先取证、后动手"固化为可校验的纪律。

## 溯源

- 技能定义：`~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/superpowers/skills/systematic-debugging/SKILL.md`
- 配套脚本：同目录 `find-polluter.sh`（bash，二分式测试污染定位）
- 配套参考：同目录 `root-cause-tracing.md`、`defense-in-depth.md`、`condition-based-waiting.md`、`condition-based-waiting-example.ts`
- 触发原文：`description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes`

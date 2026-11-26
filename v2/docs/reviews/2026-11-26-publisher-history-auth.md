# code-review：推送收件人与 history 权限（T-018 / T-020）

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 评审角色 | 测试工程师（评审方） |
| 被评角色 | 开发工程师（实现方） |
| 对象提交 | `9a180ec`～`6d7524a`（告警/收件人绿 + history/push 红绿） |
| 范围 | `v2/src/publisher/**`、`v2/src/cli/history.ts`、`v2/src/cli/push.ts`、对应测试 |

## 检查项

| 检查 | 结果 |
|---|---|
| 测试先行 | 通过：各任务均有红提交在前 |
| 认证/凭证红线 | 通过：SMTP 仅经配置对象；测试用 `streamTransport`；无硬编码令牌 |
| 是否复制 v1 | 通过：收件人解析为 v2 `member.email` 优先逻辑 |
| history 越权 | 通过：用例断言 `HistoryAccessDenied` → 退出码 8 |
| 时间 / Clock | 通过：调度补发测例使用 `FixedClock` |

## 问题清单

| # | 级别 | 问题 | 处置 |
|---|---|---|---|
| 1 | 阻塞（已关闭） | 初版 publisher 残留直接 `new Date` / 类型门禁问题 | **已修复**：`53bfe95 fix: publisher 类型与 Clock 门禁残留修正` |
| 2 | 建议 | CLI `run.ts` 行覆盖率低，集成未全覆盖 serve 常驻路径 | **接受风险**：serve 以调度单测 + SIGINT 手工停为准；记入覆盖率报告改进项 |

## 结论

**修复后可以合并。** 阻塞项 1 已在 `53bfe95` 关闭；权限与凭证路径人工复核通过。

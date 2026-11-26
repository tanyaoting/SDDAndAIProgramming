# code-review：仓储汇总投影与迁移（T-003 / T-004）

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-26 |
| 评审角色 | 架构师（评审方） |
| 被评角色 | 开发工程师（实现方） |
| 对象提交 | `e716a6d`～`6b2b3cf`（schema 红绿 + repo 红绿） |
| 范围 | `v2/src/store/**`、`v2/tests/store/**` |

## 检查项

| 检查 | 结果 |
|---|---|
| 测试先行（先红后绿） | 通过：可见 `test: [T-003]/[T-004] 红` 先于 `feat` 绿 |
| 是否复制 v1 代码 | 通过：DDL/映射为重写；含 v2 delta `member.email` 与 `user_version` |
| 汇总 SQL 是否含 `content` | 通过：`SUMMARY_ROWS_SQL` 白盒断言仅白名单列 |
| 时间是否只经 Clock | 通过：写入时间走 `toZonedIsoString(clock, …)` |
| 红线（隐私） | 通过：投影在查询层，非渲染层过滤 |

## 问题清单

| # | 级别 | 问题 | 处置 |
|---|---|---|---|
| 1 | 建议 | `repo.ts` 与 `repo-cli.ts` 拆分后，CLI 扩展 API 的文档入口不够显眼 | **接受**：在 `createRepo` 导出处已 re-export；系统设计报告第 3 章已点名 `repo-cli` |
| 2 | 提问 | 迁移是否只支持 v0→v1？ | **回应**：当前仅 version 1 基线；HANDOVER 已要求有版本机制，后续改表再加迁移函数 |

## 结论

**可以合并。** 无阻塞项。隐私边界与迁移 delta 符合 design / HANDOVER。

# v2 设计 Delta（相对 v1 / specs）

> 日期：2026-11-26  
> 上游：`specs/proposal.md` v0.4、`specs/design.md` v0.4、`v2/HANDOVER.md`  
> 姿态：契约继承 + HANDOVER 改进点落地（brainstorming 已确认方案 A）  
> 裁剪：关键路径优先（方案 2）；禁止削减 CS-03 / CS-09 / CS-19

## 1. 不变契约（原样继承）

- ADR-001～007 结论（含被否决备选项的理由）
- CLI 命令、退出码、错误码分段（无退出码 5）
- 九个领域类型与三条不变量：`dayKey` 唯一日界、归属经 `entry_member`、汇总不查 `content`
- 九张表的语义与 CHECK / UNIQUE / FK 约束口径
- 生成策略：规则模板，零 LLM（EX-04）

## 2. v2 主动改进（本阶段必须落地）

| # | 改进 | 落地方式 | 验收 |
|---|---|---|---|
| D-01 | YAML 用成熟解析器 | 依赖 `yaml` + zod；删除手写子集解析 | 非法 YAML / 时段重叠 → `SDR-E301` |
| D-02 | Schema 版本与迁移 | `PRAGMA user_version` + `migrate(db)`；初始化幂等 | 重复 init 不破坏数据；版本可读 |
| D-03 | `member.email` | 建表即含 `email TEXT NULL`；推送优先该列 | 有 email 的成员按人投递；缺省回退 `SDR_NOTIFY_TO` / `--to` |
| D-04 | HTTP 分页公共能力 | `http.ts` 导出分页迭代；GitHub/飞书复用 | 达上限抛 `SDR-E104`，不返回部分结果 |

## 3. 明确不推翻 / 不做

- 不放开汇总阻塞正文（CS-09 红线）
- 不引入 LLM 进验收路径
- 不复制 `v1/src/**`、`v1/tests/**`、`v1/config/*` 正文
- 不自动采集 QQ/微信/飞书消息（EX-01/EX-02）
- 不做 HTML 邮件（EX-08）

## 4. 分层与模块（与 design.md 对齐）

`cli` → `collectors` / `generator` / `publisher` → `store`；横切：`http`、`clock`、`config`、`errors`、`types`。

依赖硬约束（ESLint）：

- 业务模块禁 `new Date()`（`clock.ts` / 测试除外）
- 仅 `store/` 可 import `better-sqlite3`
- `generator/` 不得 import `collectors/`

## 5. 工时与裁剪

- 关键词标注样本 ≥ 10 条（准确率门槛 ≥ 90% 不变）
- UML：索引规范图或最小 mermaid，不做美化
- 性能实测写入 `v2/docs/测试记录.md` 精简版
- tag `v2-superpowers` 仅在用户明确要求时打

## 6. 提交纪律

- 仅提交 `v2/` 路径
- 格式：`feat|fix|test|docs|refactor: [T-0xx] …`
- 红绿提交顺序可辨：先 `test:` 红，再 `feat:` 绿

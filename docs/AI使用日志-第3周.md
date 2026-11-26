# AI 使用日志（第 3 周 · 阶段二 Superpowers）

> **提交要求**：课程指导书要求每周提交，模板见附录 D，五列为「日期 / 工具 / 用途与提示要点 / 产出与去向 / 人工核验方式」。
> **资格项**：日志缺失或造假 → 报告部分不计分。
>
> **填写说明（务必先读）**：沿用第 1–2 周同一口径，本表由仓库提交历史反推生成，`用途`、`产出与去向`、`人工核验方式` 三列均可在 git 中复核；
> `提示要点` 一列是**据产出内容回填的摘要，不是原始提示词**。提交前须由本人逐行核对措辞，凡与实际提问不符者以实际为准，
> **不得为凑格式而编造**——日志造假与日志缺失同属资格项后果。

## 一、使用记录

| # | 日期 | 工具 | 用途与提示要点 | 产出与去向 | 人工核验方式 |
|---|---|---|---|---|---|
| 1 | 11-26 | WorkBuddy（Agent） | `brainstorming` 出阶段二设计增量：只继承 HANDOVER 的 ADR 结论与接口契约，落地 4 项改进（yaml 成熟解析、user_version 迁移、member.email 按人投递、HTTP 公共分页） | `v2/docs/plans/2026-11-26-v2-design-delta.md`（commit `3d8d568`） | 逐条核对改进点是否与 `v2/HANDOVER.md` §6 一致；确认未复制 v1 正文，仅引用决策结论 |
| 2 | 11-26 | WorkBuddy | `writing-plans` 生成任务级 TDD 实现计划：按模块排出红/绿提交序列与门禁顺序 | `v2/docs/plans/2026-11-26-sdr-v2-implementation.md`（commit `02ea25e`） | 计划任务编号与 `specs/tasks.md` 对齐；人工确认每个任务都有先行可失败测试 |
| 3 | 11-26 | WorkBuddy | TDD T-002/T-025 红→绿：错误码与退出码映射、配置加载（zod + yaml + `.env`）、Clock 日界 | `v2/src/errors.ts`、`config.ts`、`env-file.ts`、`clock.ts`（commit `0bd0adf`→`06e5f03`） | **属黄色条目**：退出码表逐条比对 `design.md` §4.4；跨时区日界用例手算复核 |
| 4 | 11-26 | WorkBuddy | TDD T-003/T-004 红→绿：SQLite 建表与 `user_version` 迁移、仓储 CRUD 与事务 | `v2/src/store/schema.ts`、`repo*.ts`（commit `e716a6d`→`6b2b3cf`） | **SQL 属黄色**：表结构对照 `design.md` §3.2 逐列核对；用「插入非法值应失败」验证 CHECK/外键；事务回滚断言人工检查 |
| 5 | 11-26 | WorkBuddy | TDD T-005 红→绿：HTTP 超时、1-2-4 退避重试、状态码分类、token 日志掩码 | `v2/src/http.ts`（commit `3eadb77`→`619d9ac`） | **属红色条目**：掩码分支逐行人工审阅，确认日志不含明文令牌；401/403/超时四类响应映射核对 |
| 6 | 11-26 | WorkBuddy | TDD T-006/T-010 红→绿：GitHub/飞书/本地/手工四源采集与事件归一去重 | `v2/src/collectors/*.ts`（commit `9ca3bdc`→`286a47a`） | 用 Mock 响应造 401/403/超时/分页四类场景；跨日界去重键人工核算 |
| 7 | 11-26 | WorkBuddy | TDD T-011～T-016 红→绿：关键词状态判定、时段划分、三级归属、去人称渲染、报表装配、团队汇总投影 | `v2/src/generator/*.ts`（commit `6de4b77`→`7eeebd4`） | **归属与隐私属黄色**：汇总 SQL 只 `SELECT` 白名单列，用例断言查询语句不含 `content`；`Co-authored-by` 三分支逐条核对 |
| 8 | 11-26 | WorkBuddy | TDD T-017～T-019 红→绿：纯文本邮件渲染、SMTP 发送与告警、调度补发与 push_log 去重 | `v2/src/publisher/*.ts`（commit `e0f43b7`→`edbb6ac`） | **属红色条目**：SMTP 凭证仅经环境变量、日志掩码人工复核；`--dry-run` 路径确认不发信 |
| 9 | 11-26 | WorkBuddy | TDD Task-10/T-020 红→绿：六命令 CLI 与 bin 入口、history 越权校验、push dry-run | `v2/src/cli/*.ts`、`main.ts`（commit `f78aed4`→`53bfe95`） | **鉴权属红色**：越权路径人工复核退出码 8；参数互斥用例逐条核对 |
| 10 | 11-26 | WorkBuddy | T-021 端到端集成与失败路径矩阵 | `v2/tests/integration/*.ts`（commit `6974b2a`） | 逐条核对「验收标准 → 用例」映射；失败矩阵人工挑 3 条本地复跑 |
| 11 | 11-26 | WorkBuddy | T-022 测试记录与实现方自检清单 | `v2/docs/测试记录.md`、`v2/docs/reviews/2026-11-26-self-check.md`（commit `6c63d50`） | 全部用例本机重跑一次；自检清单逐项人工确认后才签字 |
| 12 | 11-26 | WorkBuddy | 撰写阶段二系统设计报告（六章：概述 / 界面原型 / 目录部署 / 任务分解 / 测试证据 / 规范符合性） | `docs/系统设计报告.docx`（commit `ee076cd`） | 逐章核对 `specs/` 版本号与引用；第 6 章一致性自查逐条人工确认，结论与 specs 不符处改写 |
| 13 | 11-26 | WorkBuddy | 增加 v1/v2 四门禁 CI（GitHub Actions matrix）并归档第 3 周过程证据 | `.github/workflows/ci.yml`、`v2/docs/第3周-*.md`（commit `5e94c8e`） | 本地四门禁各跑一次；CI 配置人工核对是否覆盖 v1 与 v2 |
| 14 | 11-26 | WorkBuddy | `code-review` 互评两份（架构→开发、测试→开发）与缺陷处置记录 | `v2/docs/reviews/`（随 `5e94c8e` 归档） | 互评人须实际读过被评提交；阻塞项由 `53bfe95` 关闭后由评审人复核签字 |

## 二、合规声明（对应指导书「AI 四色清单」）

| 色级 | 定义 | 本期条目 | 处置 |
|---|---|---|---|
| 🟢 绿 | 脚手架、文档、配置，可直接采用 | #1 #2 #12 #13 | 采用后人工校对版本号、章节口径与 CI 覆盖范围 |
| 🟡 黄 | 业务逻辑、SQL、UML，须审查并留痕 | #3 #4 #6 #7 #10 | 逐条对照 `specs/` 与测试记录校验，留痕见「人工核验方式」列 |
| 🔴 红 | 认证鉴权、隐私数据处理，**禁止直接采用** | #5 #8 #9（并含 #7 的汇总隐私投影） | 逐行人工审查；凭证只经环境变量；`data/`、`*.token`、`.env` 仍由 `.gitignore` 排除 |
| ⚫ 黑 | 代写报告、伪造数据 / 提交历史 / 日志 | **0 条** | — |

**本周红线专项说明**：

1. **红→绿顺序可复核**：本周每个任务均为「test: … 红」先于「feat: … 绿」提交，`git log --oneline` 可直接看出顺序，不存在先写实现再补测试。
2. **禁止复制 v1**：v2 只读 `HANDOVER.md` 的决策结论；`v2/src`、`v2/tests` 与 v1 无逐文件比对相同的正文（评审 §1 已抽查）。
3. **凭证不入仓**：`.env`、`data/`、`*.token` 由仓库根 `.gitignore` 排除；`.env.example` 只放键名，无真实值。

## 三、待本人补录 / 核对的项

- [ ] 上述 14 行的 `提示要点` 措辞是否与实际提问一致（本列为摘要，非原文）
- [ ] 每日站会记录、tasks 勾销台账若由 AI 起草，需补对应条目
- [ ] 是否存在被否决的方案、纯讨论会话未落入提交，需补行
- [ ] 本周使用的模型 / 工具版本是否需单列

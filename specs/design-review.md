# design.md 评审记录（v0.3 评审 → v0.4 修订）

> **评审模式**：生成—评审（红队挑错 → 逐条回应/修复 → 记录结论 → 关闭条目）
> **评审对象**：`specs/design.md` v0.3（TypeScript 版，2026-11-25）
> **修订对象**：`specs/design.md` v0.4；同步 `proposal.md` v0.4、`tasks.md` v0.3
> **评审时基准**：`design.md` v0.3（对应 `proposal.md` v0.3、`tasks.md` v0.2，T-001/T-002 已落地）
> **修订后同步基准**：`proposal.md` v0.4、`tasks.md` v0.3（R-01/R-02/R-04/R-09/R-13/R-14 的验收口径已同步）
> **严重度**：阻塞（规范冲突/不可交付）＞高（影响验收可信度）＞中（契约缺失/语义歧义）＞低（表述不一致）
> **状态取值**：待回应 / 已回应待修复 / 已修复待复核 / 已关闭 / 不修（记录风险）
> **复评结果**：16 条全部「已关闭」（阻断项 3 条均以收紧设计的方式解决，未放宽任何验收口径）

---

## 一、评审记录表

| 编号 | 严重度 | 位置 | 问题摘要 | 红队建议 | 回应 | 处置/修复 | 状态 |
|---|---|---|---|---|---|---|---|
| R-01 | 阻塞 | ADR-006 ↔ CS-09 / R6 | 汇总含阻塞条目正文，与 CS-09"不含他人明细正文"互斥，且触隐私红线 | 修订 CS-09 明确例外，或 ADR-006 改为仅计数+链接；**须人工确认后改规范** | 取方案 (b)：**不改 CS-09**，改设计。不改验收口径即不触隐私红线变更，无需例外授权 | `design.md` §5 ADR-006 v0.4：撤销"阻塞正文"，汇总=出勤矩阵+状态分布+阻塞定位（成员/条数/`sdr history` 命令）；§4.3 `findSummaryRows` 投影白名单；`proposal.md` CS-09 未改，ADR-006 反向对齐 | 已关闭 |
| R-02 | 阻塞 | §3.2/3.3 ↔ ADR-004 / CS-03 | `event.member_id` 单值无法表达多作者归属，CS-03 数据层不可实现 | 增 `entry_member` 关联表，或限定归属并下调 G-03 | 采纳前者：归属是多对多关系，靠文本化无法支撑 CS-03 的 100% 断言 | `design.md` §3.2 新增 `entry_member(entry_id, member_id, role)` + `entry.attribution_kind`；§3.3-3 明确"`event.member_id` 只记事实源作者，不得用于归属"；`proposal.md` CS-03 改为按 `entry_member` 行断言 | 已关闭 |
| R-03 | 阻塞 | §4.3 `renderEntry` ↔ FR-04 | 手工条目无来源链接却被强制抛 `SDR-E302`，软性贡献无法渲染 | 为 manual 定义替代来源标识或 CS-04 例外 | 采纳替代来源标识：`link_type='note'`，录入时 `--ref` 必填 | `design.md` §3.2 `source_link.link_type` 增 `note`；§4.3 `renderEntry` 对 `note` 输出"来源：<说明>"，链接判定改为 `links.length ≥ 1`（不再要求 URL）；§4.2 `--manual` 与 `--ref` 成对校验；`tasks.md` T-009 验收同步 | 已关闭 |
| R-04 | 高 | §3.2 `occurred_at`/`dedupeKey` ↔ 提案 §5 | 未定义 UTC→Asia/Shanghai 归一与"当日"边界 | 采集层统一带时区 ISO 8601，注入 `Clock` | 采纳，并上升为独立 ADR（时间口径影响去重键、时段、补发三处，不止采集） | `design.md` §3.2 `occurred_at` 注明"带 UTC 偏移 ISO 8601"、`dedupe_key` 取 `dayKey`；§3.3-6 禁止 UTC 截断取日期；**新增 ADR-007**；`proposal.md` 新增 CS-19（时区日界） | 已关闭 |
| R-05 | 高 | ADR-001 ↔ `package.json` | 重试方案"p-retry 或手写"未决；依赖清单缺 undici/better-sqlite3/nodemailer | 选定唯一方案，补齐依赖并写入 T-005 验收 | 选自写指数退避（不足 30 行，可解释性优于依赖默认值） | `design.md` §5 ADR-001「决策」段：手写 1/2/4 秒退避、仅 `408/429/5xx` 与网络错误重试、**不使用 p-retry**；ADR 内列明完整依赖清单；`tasks.md` T-005 验收加"不得引入 p-retry"与依赖一致性断言 | 已关闭 |
| R-06 | 高 | ADR-001「后果」 | 分页上限 10 页静默截断，违反 IR-02 与 G-02 | 超限抛 `SDR-E102` 或标 `partial` 并告警 | 采纳前者+后者：抛专用码并记 `partial` | `design.md` ADR-001「后果」与 §4.3 `collectGithub`：上限 20 页（2000 条），达上限仍有 `next` 抛 `SDR-E104`，**不返回部分结果**；§4.4 E1xx 段含 E104；§6 可观测性要求 `partial` + 告警；`tasks.md` T-006 增 2001 条 fixture 用例 | 已关闭 |
| R-07 | 中 | §1.3/4.2 ↔ §3.2 `ingestion_run` | "每次执行一条"无法表达逐源失败结果 | 改为每源一条，增 `run_id` 关联 | 采纳 | `design.md` §3.2 `ingestion_run` 改为每源一条 + `UNIQUE(run_id, source)`，`event.run_id` 共享同一批次 ULID；§4.2 `collect` 行为约束写明"每源一条"；§6 可观测性同步 | 已关闭 |
| R-08 | 中 | §4.3 `SDR-E302` ↔ §4.4 | E3xx→退出码 9"配置非法"语义错误 | 新增 E6xx 或归入 E5xx | 新增 E6xx：生成期约束与配置期校验是两类失败，退出码应可区分 | `design.md` §4.4 增 `SDR-E6xx`（E601 来源标识缺失）→ 退出码 10；§4.2 统一退出码表增 `10`；§4.3 `renderEntry` 错误码改为 `SDR-E601`；原 E302 已删除并加迁移注记 | 已关闭 |
| R-09 | 中 | §3.2 `entry` ↔ CS-16 | "标注起始日期"无承载字段 | 增 `original_date` 或规范 `payload` 用法 | 采纳显式字段（`payload` 是原始 JSON 留档，不宜作业务字段） | `design.md` §3.2 `entry.original_date`（YYYY-MM-DD，同日开始为 NULL）；§4.3 `renderEntry` 非空时前缀"（自 M-D 起）"；`tasks.md` T-015 验收含 `original_date` 写入 | 已关闭 |
| R-10 | 中 | §4.3 ↔ T-019 | `Clock` 注入只覆盖调度器，去重/时段同依赖当前时间 | 定义统一 `Clock` 注入 collect/generate | 采纳，且写入 ADR 与 ESLint 约束 | `design.md` §4.1 `Clock` 端口（`now()` + 固定 `timeZone`）；§4.3 `dayKey`/`dayWindow`；ADR-007 决策④注入采集/生成/调度三处、测试用 `FixedClock`、ESLint 禁 `new Date()`；`tasks.md` 新增 T-025 | 已关闭 |
| R-11 | 中 | ADR-006 ↔ §2/§4.3/T-016 | 受限查询（只读 blocked content）缺函数契约 | §4.3 补 `findBlockedForSummary` 投影白名单 | 采纳契约，但收敛为单一函数 `findSummaryRows`：两套查询易在改模板时越界 | `design.md` §4.3 新增 `SummaryRow` 类型与 `findSummaryRows(reportDate)`，行为约束写明"SQL 不得 SELECT `entry.content`，白盒断言查询语句不含 content"；§6 安全项同步；`tasks.md` T-016 验收同步 | 已关闭 |
| R-12 | 中 | §4.2 CLI | 退出码 5"无数据"悬空，无命令使用 | 删除 5 或说明适用命令 | 删除：无数据是正常边界，不设错误码 | `design.md` §4.2 统一退出码表移除 `5`，并加说明"`generate` 无数据输出空白模板返回 0（CS-14）" | 已关闭 |
| R-13 | 中 | ADR-004 ↔ G-01 | 多条待确认需多次 edit，与"手工编辑≤1 条"冲突 | 明确 `--accept-attribution` 批量语义并写入验收 | 采纳批量语义：逐条确认会直接违反 G-01，批量是唯一可行路径 | `design.md` §4.2 `sdr edit --accept-attribution [--all]`；§4.3 `acceptAttribution(reportId, all)`；§3.2 `entry.attribution_confirmed`；`tasks.md` T-004 验收含一次性确认返回条数 | 已关闭 |
| R-14 | 中 | tasks §2 ↔ ADR-006 | 削减策略降级 T-016 与 ADR-006 冲突且未回写 EX 清单 | 预置 v1.1 排除项或删除该削减选项 | 删除该削减项，并设"禁止削减项"清单——削减不能以撤销已闭合缺陷为代价 | `tasks.md` §2 删除"T-016 降级为仅出勤矩阵"，新增禁止削减项（T-016/T-013/T-025）与"削减须回写 proposal"硬约束；`proposal.md` 新增 EX-08（HTML 邮件 v1.1），作为预置排除项 | 已关闭 |
| R-15 | 中 | §4.1 `Phase` | 同一类型兼表"进展阶段"与"条目状态"，语义二重 | 拆为 `Phase` 与 `EntryState` | 采纳合并为单一 `EntryState`：四值同源，拆两个类型会产生非法组合 | `design.md` §4.1 定义 `EntryState = 'done'\|'doing'\|'plan'\|'blocked'` 并注明"原 Phase 已拆分并更名"；§3.2 `entry.state` 与 §4.3 `assignBlocks`/`classifyState`/`SummaryRow.byState` 全部改用 `EntryState` | 已关闭 |
| R-16 | 低 | ADR-002 | "预编译安装顺畅"与"跨平台需构建工具"自相矛盾 | 统一表述并注明前置条件 | 采纳，且以实测取代推测：核查 `better-sqlite3` 13.x 包内含 8 个预编译产物（含 `linuxmusl`），原"需构建工具"的判断本身有误 | `design.md` ADR-002「后果」改为实测结论：安装无需本地编译、无需 `node-gyp`；工程侧须声明 `allowBuilds: { better-sqlite3: false }` 跳过 `install` 脚本；给出验证命令与升级到无预编译版本时的回退要求 | 已关闭 |

**汇总**：16 条 —— 阻塞 3 / 高 3 / 中 9 / 低 1；**已关闭 16 / 待回应 0**。

---

## 二、逐条记录（证据 · 影响 · 建议 · 回应）

### R-01 汇总可见性与 CS-09 冲突（阻塞）
- **证据**：CS-09"团队汇总仅含聚合信息，不含他人明细正文"；ADR-006"计数 + 阻塞项摘要（仅阻塞条目正文）"；proposal R6"不展开他人明细"。
- **影响**：CS-09 无法验收；按 ADR-006 实现则突破隐私红线。
- **建议**：(a) 修订 CS-09 明确阻塞项摘要为唯一例外并定义粒度；或 (b) ADR-006 改为只输出阻塞项计数 + 来源链接。
- **回应记录**：选 (b)。方案 (a) 要为隐私边界开一个例外，而"阻塞"由生成器关键词判定，误判即泄露他人正文，例外边界无法自证；且按流程约束，改 CS-09 须指导教师书面确认，不应在设计阶段单方面放宽。改设计可完全避免这两点。
- **修复记录**：`design.md` §5 ADR-006（v0.4 修订）——备选项表中把"计数+阻塞正文"标为"否决（v0.3 曾采纳）"并写明否决理由；决策改为三段式：出勤/状态矩阵、条目数与状态分布、阻塞定位（成员+条数+`sdr history` 命令），不含任何正文；边界下沉到 `findSummaryRows` 的 SQL 投影白名单。
- **关闭依据**：ADR-006 决策段与 §4.3 `findSummaryRows` 行为约束一致；CS-09 原文未修改，两者不再互斥。附加约束写入 §6（白盒测试断言查询不含 `content`）。

### R-02 多作者归属缺数据结构（阻塞）
- **证据**：ADR-004"归属该任务全部操作者"、CS-03"命中率 100%"；§3.2 `event.member_id` 单值 NOT NULL、`entry.source_event_id` 单值；§3.3-3"一条条目只能指向一个事件"。
- **影响**：CS-03 / G-03（协作归属 ≥80%）不可实现。
- **建议**：新增 `entry_member(entry_id, member_id, role)`；或限定归属文本化并下调 G-03。
- **回应记录**：采纳新增关联表。下调 G-03 会让"协作归属"这一差异化目标失去意义，而多对多是客观事实（一个 PR 多作者），数据模型必须能表达。
- **修复记录**：`design.md` §3.2 新增 `entry_member`（`PRIMARY KEY(entry_id, member_id)`、`role in ('primary','co')`）；`entry` 增 `attribution_kind`/`attribution_confirmed`；§3.3-3 明确事件与条目的关系及 `event.member_id` 的语义边界；`proposal.md` CS-03 改为"按 `entry_member` 行断言全部标记作者均已归属"。
- **关闭依据**：§3.2 表结构 + §3.3-3 约束说明 + §4.3 `resolveAttribution` 返回 `members[]` 三处一致，CS-03 可在数据层断言。

### R-03 手工条目无法通过渲染（阻塞）
- **证据**：EX-01/02 排除群聊自动采集，FR-04 手工补充为软性贡献唯一通道；手工条目 `isManual=true`、`sourceEventId` 空；§4.3 `renderEntry` 规定 links 空即抛 `SDR-E302`；T-014 同步该验收。
- **影响**：手工条目无法渲染，或被迫造假链接破坏 CS-04。
- **建议**：为 manual 定义替代来源标识（录入时必填来源说明 / `manual://timestamp+seq`），或在 CS-04 注明例外。
- **回应记录**：采纳"录入时必填来源说明"，落为 `link_type='note'` 而非伪造 URL——保留 CS-04"每条有来源"的强约束，同时承认来源形态可以不是链接。
- **修复记录**：`design.md` §3.2 `source_link.link_type` 增 `note`；§4.3 `renderEntry` 入参约束改为 `links.length ≥ 1`，`note` 输出"来源：<说明>"；§4.2 `--manual` 与 `--ref` 成对校验（缺一即退出码 2）；`tasks.md` T-009/T-014 验收同步。
- **关闭依据**：`design.md` §3.2 / §4.2 / §4.3 三处一致；CS-04 无需例外即可满足（手工条目有 note 来源）。

### R-04 时区归一化缺失（高）
- **证据**：proposal §5 以 Asia/Shanghai 为准；GitHub API 返回 UTC；§3.2 `occurred_at` TEXT、`dedupeKey` 含日期；§1.3"当日"。
- **影响**：UTC 16:00–24:00 提交计入次日，破坏 G-02、CS-01（跨日 key 不同）、CS-02。
- **建议**：采集层统一归一为带 `+08:00` 的 ISO 8601；定义"当日 = [00:00, 24:00) Asia/Shanghai"并注入 `Clock`。
- **回应记录**：采纳，并升为独立 ADR-007。该问题不止影响采集：去重键、时段归位、补发判定三处都依赖"哪一天/现在几点"，散落实现必然再犯同一错误。
- **修复记录**：`design.md` §3.2 `occurred_at` 注明带偏移 ISO 8601、`dedupe_key` 取 `dayKey`；§3.3-6 禁止 UTC 截断；**新增 ADR-007**（存带偏移文本 + 唯一 `dayKey`，否决 UTC 自换算/Unix 时间戳/时区库）；`proposal.md` 新增 CS-19。
- **关闭依据**：ADR-007 决策段 + §3.3-6 + `proposal.md` CS-19 形成"存储格式—日界函数—验收标准"闭环。

### R-05 ADR-001 决策未收敛（高）
- **证据**：决策"重试用 p-retry 或手写"二选一；测试依赖 undici MockAgent；`package.json` 仅 `zod`，缺 undici / better-sqlite3 / nodemailer。
- **影响**：T-005/T-018 无法按依赖清单实现；阶段评审可质疑设计与工程脱节。
- **建议**：选定唯一重试方案；补齐依赖并写入 T-005 验收。
- **回应记录**：选自写指数退避。理由是"哪些状态码可重试"属业务决策，放进依赖默认值会降低可解释性；不足 30 行代码，不值得引入一个依赖。
- **修复记录**：`design.md` ADR-001「决策」段写明手写 1/2/4 秒退避、仅 `408/429/5xx` 与网络错误重试、不使用 `p-retry`，并列出与 `v1/package.json` 一致的完整依赖清单（运行时 3 个、开发期 8 个）；`tasks.md` T-005 验收加"不得引入 `p-retry`"与依赖一致性断言。
- **关闭依据**：ADR-001 决策段唯一方案 + tasks T-005 验收可执行。工程侧 `v1/package.json` 的依赖落地由 T-001/T-005 验收核对，本次未改动 `v1/`。

### R-06 分页上限静默截断（高）
- **证据**：ADR-001"每页 100 条，最多取 10 页"，未定义超限行为。
- **影响**：单日提交 >1000 时静默丢数据，违反 IR-02、G-02。
- **建议**：超限抛 `SDR-E102`，或 `ingestion_run` 标 `partial` 并告警。
- **回应记录**：两者并用，但需独立错误码——E102 已被"速率限制"占用，混用会让告警无法区分"该等"还是"该裁"。故新增 E104 专表"分页超限"。
- **修复记录**：`design.md` ADR-001「后果」与 §4.3 `collectGithub`——上限提至 20 页（2000 条），达上限仍有 `next` 抛 `SDR-E104` 且**不返回部分结果**（避免上层把不完整数据当完整）；§4.4 E1xx 段、§6 可观测性（`partial` + 告警）、`tasks.md` T-006（2001 条 fixture）同步。
- **关闭依据**：ADR-001 + §4.3 + §4.4 + §6 + T-006 五处一致，超限行为可被集成测试断言。

### R-07～R-16 中低级条目
证据、影响与建议见第一节记录表；回应与关闭依据如下。

| 编号 | 回应记录 | 修复记录 | 关闭依据 |
|---|---|---|---|
| R-07 | 采纳每源一条。"一次执行一条"无法表达"GitHub 成功、飞书失败"，而这正是 CS-07 要求标注的粒度 | `design.md` §3.2 `ingestion_run` 改每源一条 + `UNIQUE(run_id, source)`；`event.run_id` 批次共享；§4.2 `collect` 行为约束；§6 可观测性 | §3.2 表定义 + §4.2 + §6 三处一致，可支撑"逐源失败标注" |
| R-08 | 新增 E6xx。配置期错误与生成期约束是两类失败，共用退出码 9 会让运维误判为"改配置即可" | `design.md` §4.4 增 `SDR-E6xx`→退出码 10；§4.2 退出码表增 `10`；§4.3 `renderEntry` 错误码改 `SDR-E601`；加原 E302 迁移注记 | §4.4 码段表 + §4.2 退出码表一一对应，无悬空码 |
| R-09 | 采纳显式字段。`payload` 是原始 JSON 留档，作业务字段会让渲染依赖不可控结构 | `design.md` §3.2 `entry.original_date`；§4.3 `renderEntry` 前缀"（自 M-D 起）"；`tasks.md` T-015 | §3.2 字段 + §4.3 渲染规则 + T-015 验收，CS-16 可断言 |
| R-10 | 采纳统一 `Clock`，并写成 ESLint 规则——只靠约定，AI 生成代码迟早会写 `new Date()` | `design.md` §4.1 `Clock` 端口；§4.3 `dayKey`/`dayWindow`；ADR-007 决策④；§6 可维护性禁 `new Date()`；`tasks.md` 新增 T-025 | ADR-007 + §4.1 + §6 规则 + T-025，四层约束同一口径 |
| R-11 | 采纳契约，但合并为单一 `findSummaryRows`。原建议的专用函数会让"汇总查询"出现两条路径，改模板时更易越界 | `design.md` §4.3 `SummaryRow` + `findSummaryRows`，行为约束"不得 SELECT `entry.content`"；§6 安全项；`tasks.md` T-016 | §4.3 契约 + §6 白盒断言要求 + T-016 验收 |
| R-12 | 删除退出码 5。空状态不是错误，保留会让调用方把正常边界当失败重试 | `design.md` §4.2 退出码表移除 `5` 并加说明（`generate` 无数据输出空白模板返回 0） | §4.2 退出码表无未使用码，与 CS-14 一致 |
| R-13 | 采纳批量语义。逐条 `edit` 确认会直接违反 G-01（≤1 条/日），批量是唯一可行路径 | `design.md` §4.2 `--accept-attribution [--all]`；§4.3 `acceptAttribution(reportId, all)`；§3.2 `attribution_confirmed`；`tasks.md` T-004 | §4.2 + §4.3 + T-004 一致，G-01 与 CS-03 不再冲突 |
| R-14 | 删除该削减项并设"禁止削减项"。削减工时的合法手段是缩小范围并回写 EX，而不是撤销已闭合的隐私边界 | `tasks.md` §2 删除"T-016 降级"，新增禁止削减项（T-016/T-013/T-025）与回写约束；`proposal.md` 新增 EX-08（HTML 邮件 v1.1） | `tasks.md` 削减策略 + `proposal.md` EX-08，削减不再与 ADR-006 冲突 |
| R-15 | 合并为单一 `EntryState`（而非拆两个类型）。四个取值同源，拆开会产生 `done+plan` 这类非法组合 | `design.md` §4.1 `EntryState` 定义并注明更名；§3.2 `entry.state`、§4.3 `assignBlocks`/`classifyState`/`SummaryRow.byState` 全部替换 | §4.1 类型定义与 §3.2、§4.3 全部引用一致，无 `Phase` 残留 |
| R-16 | 采纳以实测取代推测。原条文自相矛盾是因为"跨平台需工具链"本身未经核实；核查 `better-sqlite3` 13.x 包内自带 8 个预编译产物（`darwin`/`linux`/`linuxmusl`/`win32` × `x64`/`arm64`），安装并不需要编译 | `design.md` ADR-002「后果」改为实测结论 + 验证命令（`node -e` 加载内存库）+ 升级路径约束（无预编译版本须移除 `allowBuilds: false` 并补工具链） | ADR-002 表述与实测一致，且给出可复现的验证动作，不再有互相矛盾的结论 |

---

## 三、评审结论与处置顺序

- **初评结论**：16 条缺陷（阻塞 3 / 高 3 / 中 9 / 低 1），**不建议 design.md v0.3 直接通过阶段评审**。
- **修订结论**：`design.md` 升至 v0.4，16 条全部关闭；连带修订 `proposal.md` v0.4（CS-03/04/09/16、新增 CS-19、新增 EX-08、G-01/G-03 口径）与 `tasks.md` v0.3（T-006/009/013/014/015/016/017 验收、新增 T-025、削减策略）。
- **优先顺序**：R-01 → R-02 → R-03 → R-04/R-05/R-06 → 其余（实际按此顺序执行）。
- **流程约束**：R-01 涉及隐私红线，须人工确认后改规范，不得改实现绕过——**本轮的处置方式是收紧设计而非放宽 CS-09，因此未触发该路径**；若后续有人提议在汇总中呈现阻塞正文，仍须先取得指导教师书面确认。
- **仍需人工/实测确认的 3 项**（不影响条目关闭，但影响阶段评审可信度）：
  1. **G-03 归属覆盖率 ≥80%**：依赖 `Co-authored-by` 实际出现率，须第 2 周用真实提交回填基线后校准（ADR-004 后果指标）。
  2. **CS-11/CS-12 性能指标**（30s/60s）：仍为经验值，须实测记录。
  3. **工时 123 人时 vs 3 人组可用约 90 人时**（超约 37%）：`tasks.md` 已给四步削减顺序与三种处置建议，须在第 2 周第一日与指导教师确认其一。
- **下一轮**：v0.4 复评通过后进入实现（T-003 起）；本文件后续只追加新条目，不修订已关闭项——若结论变化，新增条目并以 `supersedes R-xx` 标注。

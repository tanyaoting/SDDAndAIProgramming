# v2 交接文档：从 v1 带走的结论，而不是 v1 的代码

> **文档定位**：v1（SDD 阶段）→ v2（Superpowers 阶段）的知识交接。
> **一句话规则**：本文件交的是**结论、契约与踩坑记录**；v1 的 `src/`、`tests/`、`config/` 一律不得复制进 v2。
> 课程指导书对此有硬性要求：「v2 禁止复制 v1 代码」。复制代码不仅无效，还会使两阶段对比失去意义——而两阶段的工时/缺陷/质量对比本身就是评分项。

## 0. 使用约束（先读这一节，再读别的）

### 0.1 允许带入 / 禁止带入

| 类别 | 是否带入 | 说明 |
|---|---|---|
| ADR 结论与理由（含被否决的备选项） | ✅ 允许 | 这是"决策知识"，不是代码。重做时可直接沿用结论，但须自行复核前提是否变化 |
| 接口契约（类型定义、函数签名、CLI 与退出码、错误码分段） | ✅ 允许 | 契约是设计与实现之间的合同，v2 可沿用同一套契约，从而让两版可对比 |
| SQLite 表结构与约束经验 | ✅ 允许 | 表结构与约束是数据模型决策，属设计层产物 |
| 踩坑记录与实测数据 | ✅ 允许 | 这是 v1 最有价值的产出，能直接省掉重复试错 |
| v1 的 `src/**` 实现代码 | ❌ 禁止 | 包括"只抄一个函数" |
| v1 的 `tests/**` 用例代码 | ❌ 禁止 | 测试须在 v2 按 TDD 重新写（红→绿），否则第二阶段的 TDD 证据不成立 |
| v1 的 `config/*.yaml` 具体内容 | ❌ 禁止 | 配置格式可沿用，文件须重写 |
| v1 的提交历史做法（一次性大提交） | ❌ 禁止 | v2 要求小步提交 + 红绿循环留痕 |

### 0.2 v2 的工作流与目录约定

v2 使用 Superpowers 六工作流，**顺序不可颠倒**：

1. `brainstorming` — 重新发散，允许推翻 v1 的任一结论（推翻须写理由）
2. `writing-plans` — 计划落 `v2/docs/plans/`，不写进 `specs/`
3. `executing-plans` — 按计划小步执行
4. `TDD` — 红→绿→重构，每次提交须能看出测试先行
5. `systematic-debugging` — 缺陷须走"复现→定位→假设→验证"，不允许"改到不报错"
6. `code-review` — 互评记录留痕

```
v2/
├── HANDOVER.md          # 本文件
├── README.md            # 工具链与命令
├── docs/plans/          # Superpowers 计划文档（v2 特有）
├── docs/reviews/        # code-review 互评记录
├── src/                 # 由 TDD 逐步长出，初始化时为空白
├── tests/               # 测试先行
└── .env.example
```

## 1. v1 的客观基线（对比用）

| 项 | 数值 | 来源 |
|---|---|---|
| 任务完成度 | T-001～T-025 全部完成 | `specs/tasks.md` 对照 |
| 提交数 | 35 | `git log` |
| 源码规模 | 约 4,900 行（`src/`，含注释） | `wc -l` |
| 测试规模 | 27 个测试文件 / 151 个用例，全绿 | `v1/docs/测试记录.md` |
| 门禁 | `typecheck` / `lint` / `test` / `build` 四条全通过 | 同上 |
| CS-11 单成员单日 | 25.5 ms（进程内 Mock，无网络） | 同上 |
| CS-12 团队汇总（10 人） | 2.0 ms | 同上 |
| CS-10 历史查询（1000 条） | 约 19 ms | 同上 |
| 表数量 | 9 张 | `v1/src/store/schema.ts` |

> 这些数字是 v2 的对照基准，不是 v2 的目标。v2 若因 TDD 拆得更细而代码量上升，属正常现象，应在总结报告里解释原因。

## 2. ADR 结论（七条，含"重做时会怎么改"）

| ADR | v1 结论 | 被否决的备选项 | 重做建议 |
|---|---|---|---|
| ADR-001 运行时与 HTTP | Node 22 LTS + pnpm + TS strict；HTTP 统一走 `http.ts`（内置 `fetch` + `AbortSignal.timeout`）；重试**手写** 1/2/4 秒退避，仅 `408/429/5xx` 与网络错误 | `axios`+`nock`（打桩脆弱）、`@octokit/rest` 直连（请求出口不唯一）、Bun（复现成本高）、`p-retry`（重试策略藏进依赖） | 结论可沿用。**改进点**：`http.ts` 从一开始就把"分页"作为独立能力抽出（v1 把分页写在 GitHub 采集器里，飞书复用时又写了一遍） |
| ADR-002 存储 | `better-sqlite3` + 手写 repository（约 100 行映射），零 ORM | `node:sqlite`（实验特性无类型）、`drizzle`/`prisma`（过度设计） | 结论可沿用。**注意**：`better-sqlite3` 13.x 自带 8 个预编译二进制，安装**不需要** `node-gyp`；但 pnpm 10+ 会拦截其 `install` 脚本，必须在 `pnpm-workspace.yaml` 写 `allowBuilds: { better-sqlite3: false }` |
| ADR-003 生成策略 | 规则模板拼接（零 LLM），保证可解释与可复现 | LLM 生成式改写（不可复现、无法断言） | 结论**建议保留**。若 v2 想试 LLM，只能作为"实验分支"并明确不进验收口径 |
| ADR-004 归属规则 | 三级兜底：`Co-authored-by` → 任务时间窗 → 归提交作者并标 `[待确认]`；批量确认用 `--accept-attribution --all` | 仅 `Co-authored-by`（覆盖率不足）、平均分配（不可解释） | 结论可沿用。**待补实测**：`fallback` 占比到底多少，v1 未统计（`attribution_kind` 已入库，可查） |
| ADR-005 时段与配置 | YAML + zod 校验；时段可配置，休息区间内的事件回退到前一工作时段 | TOML（解析器生态弱）、JSON（无注释） | 可沿用。**改进点**：v1 为省依赖手写了 YAML 子集解析（`src/yaml.ts`），v2 建议直接引 `yaml` 包——手写解析器是隐形维护成本 |
| ADR-006 汇总可见性 | 汇总只含出勤矩阵 / 条目计数与状态分布 / 阻塞定位，**不含任何条目正文**；边界下沉到 SQL 投影白名单（不 `SELECT content`） | 汇总展开正文（违反 CS-09 与隐私红线）、仅逐人邮件（失去汇总目标） | **必须保留**。这是隐私红线条目，v2 若为"做得更好"而放开，须先取得指导教师书面确认 |
| ADR-007 时间与日界 | `occurred_at` 存带偏移 ISO 8601；"当日"只经 `dayKey()`（Asia/Shanghai，基于 `Intl`）；`Clock` 注入采集/生成/调度三处；业务代码禁 `new Date()`（ESLint 强制） | 存 UTC 各处自换算（规则多处实现）、Unix 时间戳（不可读）、时区库（为 30 行逻辑引依赖） | **必须保留**。这是 v1 最容易出错的地方，也是最值得原样继承的约束 |

## 3. 接口契约（v2 可直接沿用的一套）

### 3.1 CLI 与退出码

| 命令 | 关键参数 | 退出码 |
|---|---|---|
| `sdr collect` | `--date`、`--source`（可重复）、`--manual <text>` 与 `--ref <说明>`（须成对） | 0 成功 / 3 部分失败 / 4 全失败 |
| `sdr generate` | `--date`、`--member`、`--force` | 0（无数据也返回 0，输出空白模板） |
| `sdr edit` | `--add-text`、`--remove-entry`、`--accept-attribution [--all]` | 0 / 6 条目不存在 |
| `sdr push` | `--date`、`--dry-run` | 0 / 7 发送失败 |
| `sdr history` | `--member`、`--from`、`--to` | 0 / 8 无权访问 |
| `sdr serve` | 无 | 常驻 |

统一退出码：`0` 成功、`1` 未预期异常、`2` 参数错误、`3` 部分失败、`4` 采集全失败、`6` 条目不存在、`7` 推送失败、`8` 权限拒绝、`9` 配置非法、`10` 生成约束违反。
**没有 5**——"无数据"是正常边界，不设错误码（v1 评审 R-12 已删除该码，勿再引入）。

### 3.2 领域类型（九个）

| 类型 | 取值 / 说明 |
|---|---|
| `Source` | `'github' \| 'feishu' \| 'local' \| 'manual'` |
| `EntryState` | `'done' \| 'doing' \| 'plan' \| 'blocked'`（**一个类型**，不要再拆 `Phase`） |
| `ReportStatus` | `'draft' \| 'confirmed' \| 'leave' \| 'blank'`（`leave` 与 `blank` 语义不同，不可混用） |
| `AttributionKind` | `'author' \| 'coauthor' \| 'task_window' \| 'fallback'` |
| `LinkType` | `'url' \| 'path' \| 'note'`（`note` 是手工条目的来源说明，不伪造 URL） |
| `Event` | 事实源事件：`source`/`sourceId`/`occurredAt`/`title`/`dedupeKey`/`isPrimary`/`runId` |
| `Entry` | 日报条目：`timeBlock`/`state`/`content`/`originalDate`/`isManual`/`attributionKind`/`attributionConfirmed` |
| `EntryMember` | 归属关系：`entryId`/`memberId`/`role('primary'\|'co')` |
| `Clock` | `now(): Date` + `timeZone: 'Asia/Shanghai'`；测试用 `FixedClock` |

### 3.3 三个不变量（v2 必须自行实现，但口径不要变）

1. **时间只经 `dayKey`**：任何"哪一天/哪个时段"的判断都调用 `dayKey(clock, at)`，禁止 `toISOString().slice(0,10)`。UTC 16:00–24:00 的提交必须计入本地次日。
2. **归属只经 `entry_member`**：`event.member_id` 只记事实源作者，**不得**用于归属判定。一个事件可生成一条归属多人的条目。
3. **汇总不出正文**：汇总查询的 SQL 只允许 `SELECT` `display_name` / `status` / `state` / `COUNT(*)`，白盒测试断言查询语句不含 `content` 列。

### 3.4 错误码分段

| 码段 | 类别 | 退出码 |
|---|---|---|
| `SDR-E1xx` | GitHub 采集（E101 令牌、E102 限流、E103 超时、E104 分页超限） | 3/4 |
| `SDR-E2xx` | 飞书采集（E201 授权、E202 字段缺失） | 3/4 |
| `SDR-E3xx` | 配置校验（E301 时段非法、E303 环境变量缺失） | 9 |
| `SDR-E4xx` | 推送（E401 认证、E402 超时） | 7 |
| `SDR-E5xx` | 存储（E501 事务失败） | 1 |
| `SDR-E6xx` | 生成约束（E601 来源标识缺失） | 10 |

> 原 `E302`（来源链接缺失）已迁移为 `E601`。不要再用 E3xx 承载生成期错误——那会让运维把"代码缺陷"当成"改配置"。

## 4. SQLite 表结构：九张表与十条教训

### 4.1 表清单与关系

```
member ─┬─< event >─ report ─< entry ─┬─< entry_member >─ member
        │                              └─< source_link
        ├─< report
        └─< consent
ingestion_run（按源一条，run_id 关联 event）
push_log（推送与补发留痕）
```

| 表 | 作用 | 关键约束 |
|---|---|---|
| `member` | 成员与上下级 | `github_login` UNIQUE；`manager_id` 决定可见性 |
| `event` | 采集到的原始事件 | `dedupe_key` UNIQUE；`run_id` 批次；`is_primary` 主源标记 |
| `report` | 一人一日一份日报 | `UNIQUE(member_id, report_date)`；`status` 四值 CHECK |
| `entry` | 日报条目 | `state` CHECK；`original_date` 承载跨天起始日；`attribution_confirmed` 管 `[待确认]` |
| `entry_member` | 条目与成员的归属（多对多） | `PRIMARY KEY(entry_id, member_id)`；`role` CHECK |
| `source_link` | 条目来源 | `link_type` 三态 CHECK |
| `ingestion_run` | 每源一条采集审计 | `UNIQUE(run_id, source)` |
| `push_log` | 推送审计与补发去重 | — |
| `consent` | 知情同意留痕 | 采集前置条件 |

### 4.2 十条教训

| # | 教训 | 具体表现 | v2 怎么做 |
|---|---|---|---|
| 1 | **归属必须多对多** | v1 design v0.3 曾用 `event.member_id` 单值表达归属，导致 CS-03（多作者 100% 归属）在数据层不可实现，被评审判为阻塞 | 建表即带 `entry_member`，并写一条约束注记"`event.member_id` 不得用于归属" |
| 2 | **时间存带偏移文本 + 唯一 `dayKey`** | 若按 UTC 截断取日期，16:00–24:00 的提交会计入次日，同时破坏去重、时段归位、补发判定 | 见 §3.3 不变量 1；`dedupe_key` 的日期部分必须取自 `dayKey` |
| 3 | **CHECK 约束在建表时写全** | 枚举值散落在 TS 联合类型与 SQL 之间，任一侧漏改就会写入非法值 | 每个枚举列都写 `CHECK IN (...)`；TDD 用"插入非法值应失败"的用例锁住 |
| 4 | **唯一约束 + 幂等转换** | 重复采集若直接抛唯一约束错误，会被上层当作失败 | 捕获 `SQLITE_CONSTRAINT_UNIQUE` → 视为"已存在"成功返回；重复采集两次，`event` 行数不变 |
| 5 | **四表写入必须在一事务内** | `report` / `entry` / `entry_member` / `source_link` 任一失败都会留下半份日报 | `db.transaction(fn)` 包住；用"`entry_member` 主键冲突 → 回滚且四表无残留"的用例验证 |
| 6 | **PRAGMA 两个都要设** | `foreign_keys` 在 SQLite **默认关闭**，不设则外键形同装饰；`journal_mode=WAL` 保证读写不互锁 | 初始化即 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`，并写"插入无效外键应失败"的用例 |
| 7 | **缺 schema 版本机制是 v1 的债** | v1 只靠 `CREATE TABLE IF NOT EXISTS` 保证幂等，没有 `user_version` 或迁移表；一旦改表结构，旧库无法升级 | v2 建议第一张表就是 `schema_version`（或 `PRAGMA user_version`）+ 迁移函数，代价很小 |
| 8 | **原生模块安装有两道坎** | ① 需 `node-gyp` 的误解——13.x 实际自带预编译；② pnpm 10+ 默认拦截 `install` 脚本，报 `ERR_PNPM_IGNORED_BUILDS` | `pnpm-workspace.yaml` 写 `allowBuilds: { better-sqlite3: false }`；装完立刻用 `node -e "new (require('better-sqlite3'))(':memory:')"` 验证 |
| 9 | **汇总查询用投影白名单** | 若在渲染层过滤正文，改模板时极易越界，且无法自证 | SQL 层就不查 `content`；白盒断言查询语句不含该列 |
| 10 | **`member` 缺邮箱列** | v1 推送收件人只能取 `--to` 或 `SDR_NOTIFY_TO`，无法按人投递 | v2 建 `member` 时就加 `email`，并把"按人投递"写进验收标准 |

## 5. v1 实际踩过的坑（可直接省掉的重复试错）

1. **`.env` 不会自动加载**：v1 到 T-007 才发现 CLI 读不到凭证，补了一次提交（`705cb1c`）。v2 应在第一个任务就把"配置加载 + 缺变量即退出码 9"作为独立任务。
2. **飞书 OAuth 令牌需持久化**：`data/feishu-tokens.json`，涉及过期与刷新；v2 若要复用，须先决定"令牌存哪里、是否入仓（**绝对不能**）"。
3. **中文文件名与 git 引号**：`git status` 会把中文路径显示为八进制转义，`core.quotepath=false` 可读性更好。
4. **分页上限静默截断**：v1 评审 R-06 指出该风险，最终改为"20 页上限，超限抛 `E104` 且不返回部分结果"。v2 若自行实现分页，这条要么照做，要么明确接受丢数据。
5. **工时超支**：`tasks.md` 计划 123 人时 vs 3 人组第 2 周可用约 90 人时，超约 37%。v2 的计划**必须**先算可用工时再拆任务，否则第 3 周末会重演。
6. **验收口径漂移**：v1 改设计时多次连带改 `proposal.md` 的 CS 编号引用，漏改就会出现"设计说 A、验收说 B"。规则：**任何改验收标准的动作，必须同一次提交内回写 proposal**。
7. **测试日志不入仓**：`v1/tests/logs/*.log` 被 `.gitignore` 排除，属本地证据。若课程要求"证据留痕"，需提前定好哪些日志要入仓（v1 的做法是 `docs/测试记录.md` 摘要入仓、原始日志本地留存）。

## 6. 必须由 v2 重新决策的点（不要直接继承）

| 议题 | v1 状态 | 为什么 v2 要重新决策 |
|---|---|---|
| 归属兜底的真实覆盖率 | 未统计（数据已入库） | G-03 的 80% 目标是估计值；v2 可用 v1 数据先算基线，或在自己的实现里统计 |
| 是否引入 schema 迁移 | 无 | v1 的债；v2 从零开始，加迁移成本最低 |
| 邮件收件人模型 | 靠 `--to`/环境变量 | 与"按人投递"的产品预期不符 |
| 汇总是否允许阻塞正文 | 明令禁止 | 属隐私红线，放开须教师书面确认 |
| 群聊（QQ/微信）采集 | 明确排除（EX-01） | 若 v2 想挑战，须先解决"无开放 API + 合规风险"两个前提，否则重蹈 v1 的 R1 风险 |
| 手写 YAML 解析 | 为省依赖自写 | 建议改用成熟解析器，减少隐形维护成本 |

## 7. v2 自查清单（每个里程碑过一遍）

- [ ] 本次提交是否体现"测试先写、再实现"（看提交顺序，不只看有没有测试）
- [ ] 新写的 SQL 是否满足不变量 2、3（归属经 `entry_member`、汇总不查 `content`）
- [ ] 新增时间逻辑是否只经 `dayKey`，测试是否用了 `FixedClock`
- [ ] 是否引入了 v1 的代码片段（若是，回头重写，并记录在 `docs/reviews/`）
- [ ] 验收标准若有变化，是否同一次提交回写了 `specs/proposal.md`
- [ ] AI 使用日志是否当日记录（资格项，缺失即一票否决）
- [ ] 计划文档（`docs/plans/`）与实际任务编号是否一致

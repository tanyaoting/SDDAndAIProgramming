# sdr v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `v2/` 从零按 TDD 重写智能日报生成器，契约对齐 specs/HANDOVER，落地 YAML 包、schema 迁移、`member.email`、HTTP 分页抽象。

**Architecture:** CLI 编排采集/生成/推送三层；层间经 `types` 契约通信；`clock`/`http`/`errors`/`config` 横切；存储经 repository 屏蔽 SQL；汇总投影白名单保证 CS-09。

**Tech Stack:** Node ≥22、pnpm、TypeScript strict、vitest、zod、yaml、better-sqlite3、nodemailer、undici(MockAgent)

## Global Constraints

- 禁止复制 `v1/src/**`、`v1/tests/**`、`v1/config/*` 正文
- 仅 `git add`/`commit` `v2/` 路径
- 提交格式：`feat|fix|test|docs|refactor: [T-0xx] …`；红在绿前
- `Asia/Shanghai` 日界只经 `dayKey`；归属只经 `entry_member`；汇总 SQL 不含 `content`
- 单文件 ≤ 300 行；`generator` 不得 import `collectors`；仅 `store/` import `better-sqlite3`
- 业务模块禁 `new Date()`（`clock.ts` 与测试除外）

## File Map

```
v2/src/
  types.ts, errors.ts, clock.ts, config.ts, env-file.ts, http.ts, cli.ts
  store/{schema.ts,db.ts,repo.ts,model.ts}
  collectors/{github.ts,feishu.ts,local.ts,manual.ts,normalize.ts}
  generator/{extract.ts,timeline.ts,attribution.ts,render.ts,phrases.ts,report.ts,summary.ts}
  publisher/{mail.ts,alert.ts,scheduler.ts,deliver.ts}
  cli/{args.ts,collect.ts,generate.ts,edit.ts,push.ts,history.ts,serve.ts,context.ts,member.ts}
v2/config/{work-hours.yaml,keywords.yaml}
v2/tests/** 镜像 src 结构 + integration/
```

---

### Task 1: T-002 错误码 + 配置加载

**Files:**
- Create: `src/errors.ts`, `src/env-file.ts`, `src/config.ts`
- Create: `tests/errors.test.ts`, `tests/config.test.ts`
- Modify: `package.json`（加 `zod`, `yaml`）
- Modify: `.env.example`（注明 member.email 推送优先）

**Produces:** `SdrError`, `ERROR_CODES`, `exitCode()`, `loadEnvFile()`, `loadConfig()`

- [ ] **Step 1:** 写 `tests/errors.test.ts`：断言 E101～E601 码值、`exitCode` 对 E3→9 / E4→7 / E6→10 / 其它→1
- [ ] **Step 2:** `pnpm test tests/errors.test.ts` 预期 FAIL（模块不存在）
- [ ] **Step 3:** 实现 `src/errors.ts`（契约见 HANDOVER §3.4）
- [ ] **Step 4:** 测试 PASS；`git commit` 仅 `v2/`：`test/feat: [T-002] errors`
- [ ] **Step 5:** 写 `tests/config.test.ts`：缺 `GITHUB_TOKEN` → `SDR-E303` / exit 9；合法 YAML 时段加载
- [ ] **Step 6:** 实现 `env-file.ts` + `config.ts`（`yaml` 包解析 work-hours）；红绿提交

---

### Task 2: T-025 时钟与日界

**Files:** Create `src/types.ts`（Clock 等核心类型）、`src/clock.ts`、`tests/clock.test.ts`

**Produces:** `systemClock`, `FixedClock`, `dayKey`, `dayWindow`, `toZonedIsoString`, `minutesOfDay`

- [ ] **Step 1:** 测试：`dayKey(FixedClock, 2026-11-25T16:30:00Z) === '2026-11-26'`；`15:59:59Z → 2026-11-25`；`TZ=UTC` 与 `Asia/Shanghai` 一致
- [ ] **Step 2:** 实现 clock；确认 eslint 对 `src/**` 禁 `new Date`（clock 除外）
- [ ] **Step 3:** 红绿提交 `test/feat: [T-025] clock dayKey`

---

### Task 3: T-003 Schema + 迁移

**Files:** Create `pnpm-workspace.yaml`（`allowBuilds.better-sqlite3: false`）、`src/store/schema.ts`、`src/store/db.ts`、`tests/store/schema.test.ts`；依赖 `better-sqlite3` + types

**Produces:** `openDatabase(path)`, `migrate(db)` → `user_version=1`；九表含 `member.email`

- [ ] **Step 1:** 测试：重复 migrate 幂等；非法 `report.status` 失败；无效 FK 失败；`user_version===1`；`member` 可插入 email
- [ ] **Step 2:** 实现 DDL + migrate；验证 `node -e "new (require('better-sqlite3'))(':memory:')"`
- [ ] **Step 3:** 提交；更新 eslint：非 store 禁 import better-sqlite3

---

### Task 4: T-004 Repository

**Files:** `src/store/repo.ts`（可拆 `entry-repo` 等若超 300 行）、`tests/store/repo.test.ts`

**Produces:** CRUD Event/Report/Entry/EntryMember/SourceLink；幂等 upsertEvent；四表事务；`acceptAttribution`；`findSummaryRows`（SQL 无 content）

- [ ] **Step 1:** 红测：重复 dedupeKey 二次插入不抛错且行数不变；事务中 entry_member 冲突整批回滚；`findSummaryRows` 源码/查询串不含 `content`
- [ ] **Step 2:** 绿实现；提交

---

### Task 5: T-005 HTTP + 分页

**Files:** `src/http.ts`, `tests/http.test.ts`；devDep `undici`

**Produces:** `requestJson(url, opts)` 重试 1/2/4s；`paginate(fetchPage, {maxPages:20})` 超限 `SDR-E104`

- [ ] 红绿提交 `test/feat: [T-005] http retry pagination`

---

### Task 6: T-006～T-010 采集与归一

**Files:** `src/collectors/{github,feishu,local,manual,normalize}.ts` + 对应 tests + fixtures

**Produces:** 四源 `Event[]`；错误码映射；`dedupe`；`buildDedupeKey` 用 `dayKey`

- [ ] 每源：红测错误映射与 happy path → 绿 → 提交
- [ ] normalize：跨 UTC 日界同 key（CS-19）；主源保留

---

### Task 7: T-011～T-016 生成层

**Files:** `config/keywords.yaml`, `config/work-hours.yaml`（重写非复制）、generator/*、tests

**Produces:** `classifyState`, `assignBlocks`, `resolveAttribution`, `renderEntry`, `assembleReport`, `findSummaryRows`/`renderSummary`

- [ ] 归属三级路径各一测（CS-03）；render 无第一人称（CS-05）；links 空 → E601；请假/空白（CS-06/14）；跨天 originalDate（CS-16）；汇总无 content（CS-09）

---

### Task 8: T-017～T-020 推送与历史

**Files:** publisher/*、cli commands、tests

**Produces:** 纯文本邮件；`--dry-run`；告警；调度补发（FixedClock）；history 越权 exit 8；收件人优先 `member.email`

---

### Task 9: T-021～T-022 集成与实测

**Files:** `tests/integration/*.ts`, `v2/docs/测试记录.md`

**Produces:** CS-01～19 关键用例标注；MockAgent 无真实网络；精简性能数字；`pnpm typecheck/lint/test/build` 全绿

---

### Task 10: CLI 入口串联

**Files:** `src/cli.ts`, `src/cli/*.ts`, `package.json` bin `sdr`

**Produces:** 六命令可调用；退出码聚合（collect 3/4）

---

## Self-Review

1. Spec coverage: FR-01～12 / CS-01～19 映射到 Task 3～9；D-01～D-04 分别在 Task1/3/4/5
2. No TBD placeholders in steps
3. Types consistent with design.md §4.1 + `member.email` 扩展

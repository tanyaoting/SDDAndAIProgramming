# sdr v2（Superpowers 阶段）

同一产品的第二遍实现：**从零写，禁止复制 v1 代码**。证据重点是 TDD 红绿痕迹、计划文档、互评与门禁，而不只是「能跑」。

**当前状态**：关键路径已交付；测试 **30 文件 / 126 用例**；tag **`v2-superpowers`** → `6974b2a`（最后一次改代码/测试；其后为文档）。

## 先读什么

1. `HANDOVER.md` —— ADR / 契约 / 表结构 / 踩坑（参考，不是起点代码）
2. `../specs/` —— proposal / design / tasks（与 v1 共用编号）
3. `docs/plans/` —— design-delta 与 implementation 计划
4. `docs/第3周-交付物索引.md` —— 站会、勾销、互评、覆盖率、门禁等过程证据

## 相对 v1 的改进（delta）

| 项 | 做法 |
|---|---|
| YAML | `yaml` 包 + zod（不手写子集解析） |
| Schema | `PRAGMA user_version` 迁移；首版含 `member.email` |
| 推送 | 收件人优先 `member.email`，再回退环境变量 / `--to` / `SMTP_FROM` |
| HTTP | 公共分页；超限 `SDR-E104`，不返回部分结果 |

## 目录

```
v2/
├── HANDOVER.md
├── docs/
│   ├── plans/              # writing-plans
│   ├── reviews/            # code-review 互评
│   ├── 测试记录.md / 覆盖率报告.md
│   └── 第3周-*.md
├── config/                 # work-hours.yaml / keywords.yaml（重写）
├── src/                    # cli / collectors / generator / publisher / store
├── tests/                  # 单测 + integration/
├── .env.example
├── pnpm-workspace.yaml     # allowBuilds.better-sqlite3: false
└── package.json            # bin: sdr → dist/cli.js
```

## 命令

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint .
pnpm test         # vitest run
pnpm build        # 产出 dist/
pnpm start -- <cmd> …   # 或：node dist/cli.js <cmd> …
```

覆盖率（可选，报告摘要已入仓）：`pnpm exec vitest run --coverage`（`coverage/` 不入仓）。

### CLI

```text
sdr <collect|generate|edit|push|history|serve> [options]
```

| 命令 | 常用参数 |
|---|---|
| `collect` | `--date`、`--source`（可重复）、`--manual` + `--ref`（成对） |
| `generate` | `--date`、`--member`、`--force` |
| `edit` | `--member`、`--add-text`/`--ref`、`--accept-attribution [--all]` |
| `push` | `--date`、`--dry-run`、`--to` |
| `history` | `--member`、`--from`、`--to`、`--actor` |
| `serve` | 常驻调度；`Ctrl+C` 结束 |

先 `cp .env.example .env` 并填入凭证。库中需有成员（当前无 `member` 子命令时可用一次性脚本 `insertMember`，见课程答疑/演示笔记）。本地扫描根目录环境变量为 **`SDR_LOCAL_ROOT`**（缺省 cwd）。

Node ≥ 22 LTS，包管理用 pnpm。

## 安装约束（better-sqlite3）

`pnpm-workspace.yaml` 须含：

```yaml
allowBuilds:
  better-sqlite3: false
```

验证：`node -e "new (require('better-sqlite3'))(':memory:')"`。

## 纪律

- 提交：`feat|fix|test|docs: [T-0xx] …`；红在绿前
- 凭证只经环境变量；`.env`、`data/`、`dist/`、`coverage/` 不入仓
- 改验收标准须同提交回写 `../specs/proposal.md`
- 远端 CI 与本地四门禁对齐（见仓库根 `.github/workflows/ci.yml`）

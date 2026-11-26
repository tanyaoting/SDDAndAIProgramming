# sdr v2（Superpowers 阶段）

同一产品的第二遍实现：**从零写，禁止复制 v1 代码**。这一版要留下的证据不是"能跑"，而是"用另一套工作流也能做出同等质量的系统"——因此 TDD 的红绿痕迹、计划文档、互评记录与 v1 的工时/缺陷对比同等重要。

## 先读什么

1. `HANDOVER.md` —— v1 的结论、契约、表结构与踩坑（**参考，不是起点代码**）
2. `../specs/` —— 三份规范（proposal / design / tasks），v2 与 v1 共用同一套编号
3. `../docs/Superpowers技能拆解笔记.md` —— 工作流拆解

## 目录

```
v2/
├── HANDOVER.md          # 交接：结论与教训（不复制代码）
├── docs/plans/          # Superpowers 计划文档（writing-plans 产物）
├── docs/reviews/        # code-review 互评记录
├── src/                 # 由 TDD 逐步长出
├── tests/               # 测试先行
├── .env.example         # 环境变量键名
├── eslint.config.js     # 含 ADR-007 的 no-new-Date 约束
├── tsconfig.json        # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── tsconfig.build.json
└── vitest.config.ts
```

## 命令

```bash
pnpm install        # 安装依赖
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint .
pnpm test           # vitest run（初始化阶段 0 用例即通过）
pnpm build          # 产出 dist/
```

Node ≥ 22 LTS，包管理统一用 pnpm。

## 依赖引入原则

初始化时**没有**任何运行时依赖，只装了工具链（typescript / vitest / eslint / prettier / @types/node）。运行库随任务引入，引一个记一条：

| 依赖 | 引入时机 | 理由（写入 ADR 或计划） |
|---|---|---|
| `zod` | 配置校验任务 | 环境变量与 YAML 的结构校验 |
| `better-sqlite3` | 存储任务 | 见下方安装约束 |
| `nodemailer` | 推送任务 | SMTP |
| `undici`（dev） | 首个采集任务 | `MockAgent` 进程内拦截，采集层可离线 TDD |

## 已知安装约束

`better-sqlite3` 是原生模块，有两个坑（HANDOVER §4.2 教训 8）：

1. **不需要 `node-gyp`**：13.x 包内自带 8 个预编译二进制。
2. **pnpm 10+ 会拦截其 `install` 脚本**，报 `ERR_PNPM_IGNORED_BUILDS`。引入时须在 `pnpm-workspace.yaml` 写：

```yaml
allowBuilds:
  better-sqlite3: false
```

装完立即验证：`node -e "new (require('better-sqlite3'))(':memory:')"`。

## 纪律

- 提交格式：`feat|fix|test|docs: [任务编号] 简述`
- 一个提交对应一个可验证的交付物；测试先行的痕迹要在提交顺序上看得出来
- 凭证只经环境变量注入；`.env`、`data/`、`dist/`、`coverage/` 不入仓
- 任何改动验收标准的动作，须同一次提交回写 `../specs/proposal.md`
- AI 使用日志每周提交（资格项）

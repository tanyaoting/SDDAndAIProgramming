# 智能日报生成器（sdr）

《软件工程职业技能实践》课程设计项目仓库。同一产品做两遍：阶段一 SDD、阶段二 Superpowers（禁止复制 v1 代码）。

| 阶段 | 周次 | 方法 | 产物 tag | 状态 |
|---|---|---|---|---|
| 阶段一 | 第 1–2 周 | SDD 六阶段工作流 | `v1-sdd` → `7a9c7ae` | 已交付（33 测试文件 / 181 用例） |
| 阶段二 | 第 3–4 周 | Superpowers 工作流 + TDD | `v2-superpowers` → `6974b2a` | 第 3 周关键路径已交付（30 文件 / 126 用例）；第 4 周待做变更涟漪等 |

CI：[`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在 `main` 的 push/PR 上并行跑 **v1 + v2** 的 `typecheck` / `lint` / `test` / `build`。

## 目录结构

```
.
├── .github/workflows/ci.yml        # 远端四门禁（v1 / v2 matrix）
├── specs/                          # 三份核心规范（两阶段共用编号）
│   ├── proposal.md / design.md / tasks.md
│   └── design-review.md            # 红队评审单（16/16 关闭）
├── docs/                           # 课程交付物（Word + 截图 + 角色评审）
│   ├── 业务调研 / 需求 / 系统分析 / 技术调研 / 系统设计 报告.docx
│   ├── screenshots/                # 脱敏实证截图
│   └── AI使用日志-第1-2周.md
├── backup/                         # 过程材料（访谈纪要等，非交付清单）
├── v1/                             # 阶段一工程根（SDD）
└── v2/                             # 阶段二工程根（Superpowers，从零重写）
    ├── HANDOVER.md                 # 结论/契约/踩坑（非代码）
    ├── docs/plans/                 # writing-plans 产物
    ├── docs/reviews/               # code-review 互评
    ├── docs/第3周-*.md             # 站会 / tasks 勾销 / 门禁等过程证据
    └── src/ tests/                 # TDD 长出的实现与测试
```

`v2` 只继承 HANDOVER 中的决策知识，**禁止**复制 `v1/src`、`v1/tests`、`v1/config` 正文。相对 v1 的主动改进：`yaml` 包、`user_version` 迁移、`member.email` 按人投递、HTTP 公共分页。

## 快速开始

```bash
# 阶段一
cd v1 && pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build

# 阶段二
cd v2 && pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cp .env.example .env   # 填凭证，勿提交
pnpm build && node dist/cli.js   # 用法：collect|generate|edit|push|history|serve
```

凭证一律环境变量注入；`.env` / `data/` / `coverage/` / `dist/` 不入仓。v2 使用说明见 [`v2/README.md`](v2/README.md)。

## 提交规范

- 格式：`feat|fix|test|docs|ci: [任务编号] 简述`
- 一次提交对应一个可验证交付物；v2 须能看出红→绿顺序
- tag 语义：指向该阶段**最后一次改代码/测试**的提交，其后只放文档（见 `v2/HANDOVER.md` §6.5）

## 文档索引

| 类别 | 路径 | 状态 |
|---|---|---|
| 规范 · 提案 | `specs/proposal.md` | v0.4（FR / EX / CS / IR） |
| 规范 · 设计 | `specs/design.md` | v0.4（7 份 ADR） |
| 规范 · 任务 | `specs/tasks.md` | v0.3.1（阶段一；v2 计划在 `v2/docs/plans/`） |
| 评审 · 设计缺陷单 | `specs/design-review.md` | 16/16 关闭 |
| 角色 · 工程可行性 / 可测性 | `docs/工程可行性评审意见.md`、`docs/验收标准可测性评审意见.md` | 已归档（署名栏待组内填写） |
| 交付 · 调研与分析报告 | `docs/*调研*.docx`、`docs/需求分析报告.docx`、`docs/系统分析报告.docx` | 已归档 |
| 交付 · 系统设计报告 | `docs/系统设计报告.docx` | 阶段二六章齐全 |
| 交付 · 截图 | `docs/screenshots/` | 13 张已脱敏 |
| 交付 · AI 日志 | `docs/AI使用日志-第1-2周.md` | 第 1–2 周；第 3 周待补 |
| 阶段一 · UML / 测试 | `v1/docs/uml/`、`v1/docs/测试记录.md` | 六图 + 实测 |
| 阶段二 · 交接 / 计划 | `v2/HANDOVER.md`、`v2/docs/plans/` | design-delta + implementation |
| 阶段二 · 第 3 周过程证据 | `v2/docs/第3周-交付物索引.md` | 站会、勾销、互评、覆盖率、门禁等 |
| 阶段二 · 测试记录 | `v2/docs/测试记录.md`、`v2/docs/覆盖率报告.md` | 126 用例；覆盖率摘要 |
| 过程 · 技能拆解 | `docs/Superpowers技能拆解笔记.md` | systematic-debugging |
| CI | `.github/workflows/ci.yml` | v1/v2 四门禁 |

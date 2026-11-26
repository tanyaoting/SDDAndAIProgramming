# 智能日报生成器（sdr）

《软件工程职业技能实践》课程设计项目仓库。基于规范驱动开发（SDD）与 AI 编程工具，同一项目分两阶段实现：

| 阶段 | 周次 | 方法 | 产物 tag |
|---|---|---|---|
| 阶段一 | 第 1–2 周 | SDD 六阶段工作流 | `v1-sdd` |
| 阶段二 | 第 3–4 周 | Superpowers 六大工作流 | `v2-superpowers` |

## 目录结构

```
.
├── specs/                          # 三份核心规范（规格先行）
│   ├── proposal.md                 # 目标 / 背景 / 范围（含"不做什么"）/ 技术约束 / 成功标准 / 术语
│   ├── design.md                   # 架构 / 模块职责 / 数据模型 / 接口契约 / ADR / 非功能约束
│   └── tasks.md                    # 任务清单（交付物 / 验收标准 / 依赖 / 预估）
├── docs/                           # 交付物（Word）
│   └── 业务调研报告.docx
├── backup/                         # 中间产物（脚手架、访谈记录，非交付物）
│   ├── 业务调研报告-框架稿.docx
│   └── 业务调研纪要.docx
├── v1/                             # 阶段一工程根（SDD 实现，Node 工程）
│   ├── src/                        # 源码（sdr 为包名，见 package.json）
│   ├── tests/                      # 测试（vitest）
│   └── .env.example                # 环境变量键名样例（禁止填真实值）
├── v2/                             # 阶段二工程根（Superpowers 实现，从零重写）
│   ├── HANDOVER.md                 # v1 → v2 交接：ADR 结论/接口契约/表结构教训（参考，非起点代码）
│   ├── docs/plans/                 # Superpowers 计划文档
│   ├── docs/reviews/               # code-review 互评记录
│   ├── src/ tests/                 # 由 TDD 逐步长出（初始化时为空壳）
│   └── .env.example                # 环境变量键名样例
└── README.md
```

`docs/` 只存放课程要求的交付物；框架稿、访谈记录等过程材料统一置于 `backup/`，保留以支撑证据追溯，但不进入交付清单。

`v1/` 是阶段一的 Node 工程根（`package.json`、`tsconfig`、ESLint、vitest 均在此目录），规范中的 `src/`、`tests/` 路径一律相对该目录解释，仓库根目录保持规范与文档整洁。

`v2/` 是阶段二的独立工程根，**禁止复制 v1 代码**：只允许带走结论性知识（`v2/HANDOVER.md` 记录了 ADR 结论、接口契约、SQLite 表结构与踩坑），实现须按 Superpowers 工作流与 TDD 从零写出。

## 提交规范

- 格式：`feat|fix|test|docs: [任务编号] 简述`
- 一次提交对应一个可验证的交付物（小步提交）
- 凭证（GitHub Token / 飞书凭证 / SMTP 授权码）一律通过环境变量注入，禁止入仓

## 文档索引

| 类别 | 路径 | 状态 |
|---|---|---|
| 规范 · 提案 | `specs/proposal.md` | v0.4（FR-01～12、EX-01～08、CS-01～19、IR-01～08） |
| 规范 · 设计 | `specs/design.md` | v0.4（7 份 ADR，已按评审单修订） |
| 规范 · 任务 | `specs/tasks.md` | v0.3（25 任务，关键路径 70 人时） |
| 评审 · 设计缺陷单 | `specs/design-review.md` | 16 条（阻塞 3 / 高 3 / 中 9 / 低 1），已全部关闭 |
| 交付 · 业务调研报告 | `docs/业务调研报告.docx` | 第 1 章完成，第 2–6 章待补 |
| 交付 · 需求/系统分析/技术调研 | `docs/需求分析报告.docx`、`docs/系统分析报告.docx`、`docs/技术调研报告.docx` | 已归档 |
| 过程 · Superpowers 拆解 | `docs/Superpowers技能拆解笔记.md` | systematic-debugging |
| 阶段二 · 交接文档 | `v2/HANDOVER.md` | v1 结论/契约/表结构教训，7 章 |
| 阶段二 · 工程 | `v2/` | 已初始化（工具链通过，业务代码待 TDD 长出） |
| 过程 · 调研纪要 | `backup/业务调研纪要.docx` | 18 项访谈结论（支撑 IR-01～08） |
| 过程 · 报告框架 | `backup/业务调研报告-框架稿.docx` | 已被第一章完成版取代 |

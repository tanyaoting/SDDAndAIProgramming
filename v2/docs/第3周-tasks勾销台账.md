# 第 3 周 · v2 tasks 勾销与验收核对台账

> 指导书：tasks 进度维护（逐任务勾销与验收标准核对）。  
> 任务编号沿用 `specs/tasks.md` 的 T-0xx；执行载体为 `docs/plans/2026-11-26-sdr-v2-implementation.md`。  
> 勾销依据：对应红/绿提交 + `pnpm test` 相关套件通过。更新日期：2026-11-26。

## 里程碑总览

| 里程碑 | 任务 | 勾销 | 验收核对摘要 |
|---|---|---|---|
| M0 | T-002 配置/错误码 | [x] | E1xx～E6xx、`exitCode` E3→9/E4→7/E6→10；缺 env → E303 |
| M0 | T-025 时钟日界 | [x] | UTC 16:30→次日；与进程 TZ 无关 |
| M1 | T-003 Schema 迁移 | [x] | `user_version=1`、九表+`member.email`、CHECK/FK |
| M1 | T-004 Repo | [x] | 幂等 dedupe、四表事务、`acceptAttribution`、汇总 SQL 无 `content` |
| M2 | T-005 HTTP | [x] | 1/2/4s 重试；分页超限 E104 |
| M2 | T-006～T-009 四源 | [x] | 错误码映射；manual 成对参数 |
| M2 | T-010 normalize | [x] | CS-19 同日界同 key；主源保留 |
| M3 | T-011～T-016 生成 | [x] | CS-03/05/06/09/14/16 等单测+集成 |
| M4 | T-017～T-020 推送/历史 | [x] | dry-run、告警、补发去重、history exit 8、email 优先 |
| M4 | Task-10 CLI 六命令 | [x] | collect 退出码 3/4；bin `sdr` |
| M5 | T-021 集成 | [x] | pipeline/failures/perf；Mock 禁网 |
| M5 | T-022 测试记录 | [x] | `docs/测试记录.md`（tag 后文档提交） |

## 依赖勾销说明

- 关键路径已按计划串行完成；采集 GitHub∥飞书、关键词∥时段在实现期按无共享文件并行策略执行。
- 禁止削减项（归属 / 汇总投影 / 日界）均已勾销，未降级。

## 未纳入本周勾销（显式排除）

| 项 | 理由 |
|---|---|
| T-023 UML 美化 | 关键路径裁剪：沿用 specs / v1 图索引，系统设计报告引用即可 |
| T-024 打 tag | 已打 `v2-superpowers` → `6974b2a`（配置管理员周产出，单独留痕） |
| 含网 CS-11/12 P95 | 仅进程内基线；见测试记录说明 |

## 门禁（勾销完成时）

```text
pnpm typecheck  # pass
pnpm lint       # pass
pnpm test       # 126 passed
pnpm build      # pass
```

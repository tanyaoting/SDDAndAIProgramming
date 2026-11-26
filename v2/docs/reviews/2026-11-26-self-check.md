# v2 自检笔记（2026-11-26）

## 范围

- 里程碑 M5：T-021 集成测试、T-022 性能记录。
- 工作目录仅限 `v2/`；**未复制 v1 测试或实现代码**（对照 `v1/tests/integration` 为手工重写）。

## 设计要点核对

- **CS-09 汇总投影**：`SUMMARY_ROWS_SQL` 白名单不含 `content`/`body`；`renderSummary` 仅输出计数与阻塞定位命令。
- **dayKey 唯一日界**：去重键与 `findEventsForDate` 均经 `dayKey` / `dayWindow`，集成用例含 UTC 16:00 跨界样本（CS-19）。
- **提交流程**：各 Task 先红后绿；M5 集成测试新增后 `pnpm test` 全绿再提交。

## 遗留与风险

- CS-07/CS-13/CS-17 仍以采集与 HTTP 单测为主，集成层未重复 Mock 全链路采集。
- 性能数字为进程内、无网络基线，不等同于 proposal 中含网 P95。
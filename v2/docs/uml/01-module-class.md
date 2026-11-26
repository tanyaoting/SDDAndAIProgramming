# 阶段二（v2）模块类图 / 依赖图

> 工具绘制：Mermaid（源文件可复现，禁止手绘拍照）。导出 PNG 时用 Mermaid 官方 CLI 或 IDE 插件生成，勿用截图替代。
> 依据：`docs/系统设计报告.docx` §1.4 / §3、`v2/src` 目录结构、`specs/design.md` §2。

```mermaid
classDiagram
    direction LR

    class CLI["cli/ (入口与命令)"] {
        +main.ts 入口
        +collect / generate / edit / push / history / serve
        +argv 解析 / exit 码映射
    }
    class Collectors["collectors/ (采集层)"] {
        +github.ts
        +feishu.ts
        +local.ts
        +manual.ts
        +normalize.ts 归一与去重
    }
    class Generator["generator/ (生成层, 纯计算)"] {
        +extract / timeline / attribution
        +phrases / render
        +report / summary
    }
    class Publisher["publisher/ (推送层)"] {
        +mail.ts 纯文本渲染
        +deliver.ts 投递
        +alert.ts 告警
        +push.ts 编排
        +scheduler.ts 调度补发
    }
    class Store["store/ (持久化)"] {
        +schema.ts 迁移 user_version
        +repo / repo-cli / repo-extra / repo-map
    }
    class Cross["横切模块"] {
        +clock.ts Clock 端口 / dayKey / dayWindow
        +http.ts 超时 / 退避 / 掩码
        +config.ts zod 校验
        +errors.ts SdrError / 退出码
        +types.ts 领域类型
    }

    CLI --> Collectors : collect
    CLI --> Generator : generate / edit
    CLI --> Publisher : push
    CLI --> Store : 读写
    Collectors --> Store : 落 event / ingestion_run
    Collectors --> Cross : http / clock
    Generator --> Store : 读 event, 写 report/entry
    Generator --> Cross : clock / errors
    Publisher --> Store : 读 report, 写 push_log
    Publisher --> Cross : mail 渲染 / 告警
    Store --> Cross : types / errors

    note for Generator "红线：禁止 import collectors；禁止 new Date()"
    note for Store "仅此层可引用 better-sqlite3"
```

## 分层约束（评审检查项）

| 约束 | 校验方式 |
|---|---|
| 生成层不得依赖采集层 | `v2/src/generator` 内无 `collectors` import；ESLint `no-restricted-imports` |
| 仅 `store` 可引用 `better-sqlite3` | ESLint 规则 + code-review 检查项 |
| 业务代码禁止 `new Date()` | 一律经 `Clock` / `dayKey`，ESLint 拦截 |
| 汇总永不 `SELECT entry.content` | `SUMMARY_ROWS_SQL` 白名单 + 白盒用例断言 |

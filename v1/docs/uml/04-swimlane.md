# 泳道图（Mermaid 源文件）

> T-023 交付物：与 ADR-004（归属）、ADR-005（时段）、ADR-007（时钟日界）一致。
> 三条泳道分别对应 `sdr collect` / `sdr generate` / `sdr push|serve`。


![泳道图（渲染图）](04-swimlane.png)

> 上图为 泳道图（渲染图），由下方 Mermaid 源码经 mermaid-cli 12.2 渲染（2026-11-26）。

```mermaid
flowchart TB
    subgraph Clock["时钟与时区（ADR-007）"]
        C1["Clock.now()"] --> C2["dayKey → YYYY-MM-DD（Asia/Shanghai）"]
        C2 --> C3["dayWindow → [since, until)"]
    end

    subgraph Collect["采集（sdr collect）"]
        S1["生成 run_id"] --> S2["GitHub / 飞书 / 本地 / 手工（allSettled）"]
        S2 --> S3["makeDedupeKey：sha1(source_id + dayKey + member_id)"]
        S3 --> S4["dedupe：主源优先 + occurredAt 升序"]
        S4 --> S5["insertEvent：dedupe_key 冲突视为已存在"]
        S2 --> S6["每源写 ingestion_run（ok/partial/failed/skipped）"]
        S6 --> S7{"失败？"}
        S7 -->|是| S8["标注错误码 + 告警邮件"]
        S7 -->|否| S9["继续其他源"]
    end

    subgraph Generate["生成（sdr generate）"]
        G1["读 [since, until) 内 event"] --> G2["classifyState（关键词 → done/doing/plan/blocked）"]
        G2 --> G3["assignBlocks（ADR-005：休息区间归前一工作时段）"]
        G3 --> G4["resolveAttribution（ADR-004）"]
        G4 --> G5{"Co-authored-by？"}
        G5 -->|有| G6["coauthor：primary + 多个 co，confirmed"]
        G5 -->|无| G7{"任务时间窗？"}
        G7 -->|有| G8["task_window：任务全部操作者，confirmed"]
        G7 -->|无| G9["fallback：提交作者，待确认"]
        G6 --> G10["renderEntry：去人称 / 60 字 / 来源标识"]
        G8 --> G10
        G9 --> G10
        G10 --> G11["状态机：draft / leave / blank（已确认不覆盖，除非 force）"]
        G11 --> G12["saveReportBundle：report + entry + entry_member + source_link 单事务"]
    end

    subgraph Publish["推送与调度（sdr push / serve）"]
        P1["读当日 report + entries + links"] --> P2["renderMail（纯文本，主题含日期与成员名）"]
        P2 --> P3{"dry-run？"}
        P3 -->|是| P4["正文写 stdout，不写 push_log"]
        P3 -->|否| P5["sendMail（SMTP）"]
        P5 --> P6{"成功？"}
        P6 -->|是| P7["push_log(ok) + 回写 report.pushed_at"]
        P6 -->|否| P8["push_log(failed, retry_count+1) + 告警邮件 + 退出码 7"]
        P9["Scheduler.tick（Clock 注入）"] --> P10{"now ≥ 计划时间？"}
        P10 -->|否| P11["等待下一次 tick"]
        P10 -->|是| P12{"push_log 已成功？"}
        P12 -->|是| P13["跳过（补发去重）"]
        P12 -->|否| P14["执行推送（错过的时点即补发，tick ≤ 5 分钟）"]
    end

    C3 -.since/until.-> G1
    C2 -.去重键日期.-> S3
    C1 -.定时/补发判定.-> P9
    S5 -.event.-> G1
    G12 -.report.-> P1
```

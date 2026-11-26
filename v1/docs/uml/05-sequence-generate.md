# 序列图：采集 → 生成主流程

> 对应 `sdr collect` → `sdr generate` 两个 CLI 命令，覆盖 design.md §1 数据流步骤 1～3。
> 渲染图见同目录 `05-sequence-generate.png`；本图为 Mermaid 源码，可用 mermaid-cli 复现。


![序列图（采集与生成主流程）](05-sequence-generate.png)

> 上图由下方 Mermaid 源码经 mermaid-cli 12.2 渲染（2026-11-26）。

```mermaid
sequenceDiagram
    autonumber
    actor U as 成员/CLI
    participant C as clock.ts
    participant G as collectors.github
    participant F as collectors.feishu
    participant L as collectors.local
    participant N as normalize.ts
    participant R as store.repo
    participant X as generator.extract
    participant T as timeline.ts
    participant A as attribution.ts
    participant RD as render.ts
    participant RP as report.ts

    U->>C: dayWindow(clock, date) → [since, until)
    Note over C: ADR-007：Asia/Shanghai 日界<br/>禁止 UTC 截断

    par GitHub 采集
        U->>G: collect(since, until)
        G->>G: http.ts 分页(fetch + 退避 1/2/4s)
        alt 20 页上限
            G-->>U: SDR-E104（不返回部分结果）
        else 正常
            G-->>N: Event[]（occurredAt 带偏移）
        end
    and 飞书任务采集
        U->>F: collect(since, until)
        F->>F: http.ts（tenant_access_token）
        F-->>N: Event[]
    and 本地文件采集
        U->>L: collect(since, until)
        L-->>N: Event[]（mtime 判定）
    end

    N->>N: dedupeKey = dayKey + 源标识 + 源 ID
    N->>N: 多源同一事件保留 isPrimary
    N->>R: upsertEvents(Event[])（UNIQUE 幂等）
    R-->>N: 写入条数 / 已存在条数
    N->>R: insertIngestionRun(run_id, source, result)

    U->>RP: generate(date, member)
    RP->>R: loadEvents(dayWindow)
    R-->>RP: Event[]
    RP->>X: extract(event.title)
    X-->>RP: EntryState + 置信度
    RP->>T: assignBlocks(events, workHours)
    T->>C: dayKey(clock, occurredAt)
    T-->>RP: timeBlock（休息区间回退前一工作时段）
    RP->>A: attribute(event)
    A->>A: ① Co-authored-by ② 任务时间窗 ③ fallback
    A-->>RP: members[] + attributionKind + confirmed
    RP->>RD: render(entry)
    RD-->>RP: 去人称正文 + 来源链接/note
    RP->>R: transaction: report + entry + entry_member + source_link
    R-->>RP: 提交成功
    RP-->>U: report.status = draft
```

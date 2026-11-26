# 阶段二（v2）主链路时序图

> 工具绘制：Mermaid（源文件可复现）。依据 `docs/系统设计报告.docx` §1.4 / §2.4、`specs/design.md` §4.2 与 `v2/src/cli/*.ts` 的实际命令编排。

```mermaid
sequenceDiagram
    autonumber
    actor U as 成员/运维
    participant CLI as sdr CLI
    participant C as 采集层
    participant G as 生成层
    participant S as store (SQLite)
    participant P as 推送层
    participant M as SMTP

    U->>CLI: sdr collect --date --source（可重复）
    CLI->>C: 生成 run_id，Promise.allSettled 并发采集
    C->>S: 写 ingestion_run（per source: ok/partial/failed）
    C->>S: 写 event（dedupe_key 幂等）
    C-->>CLI: 结果汇总
    CLI-->>U: exit 0 全成功 / 3 部分失败 / 4 全失败

    U->>CLI: sdr generate --date --member
    CLI->>S: 读 event（按日窗口、来源优先）
    CLI->>G: classifyState → assignBlocks → resolveAttribution → renderEntry
    G->>S: 事务写 report + entry + entry_member + source_link
    G-->>CLI: report（draft / blank）
    CLI-->>U: exit 0（无数据也输出空白模板）

    U->>CLI: sdr edit --accept-attribution --all
    CLI->>S: 批量确认归属，report 回 draft
    CLI-->>U: exit 0 / 6 条目不存在

    U->>CLI: sdr push --date [--dry-run]
    CLI->>S: 读 report + 成员 email
    CLI->>P: renderMailText
    alt --dry-run
        P-->>CLI: 正文打到 stdout，不发送
    else 正式发送
        P->>M: SMTP 纯文本邮件
        P->>S: 写 push_log(sent_at, result, retry_count)
        CLI-->>U: exit 0 / 7 推送失败
    end

    U->>CLI: sdr history --member --from --to
    CLI->>S: 校验 actor 权限（本人/直属上级）
    CLI-->>U: 退出 0 / 8 权限拒绝

    Note over CLI,M: sdr serve 到点串联 collect→generate→push，<br/>错过窗口按 push_log 补发，FixedClock 可测
```

## 关键契约点（与设计报告一致）

| 节点 | 契约 |
|---|---|
| collect | 每源一条 `ingestion_run`，部分失败不整体回滚（CS-07） |
| generate | 四表同事务写入；无数据 → 空白模板 + exit 0（F-06） |
| edit | 参数互斥（`--all` 不与 `--add-text`/`--remove-entry` 同用） |
| push | `--dry-run` 只渲染；`push_log` 去重保证补发不重发 |
| history | 越权立即失败 exit 8，可见性下沉仓储层 |

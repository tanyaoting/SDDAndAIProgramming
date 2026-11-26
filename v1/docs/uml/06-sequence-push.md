# 序列图：推送、失败告警与补发流程

> 对应 `sdr push` 与 `sdr serve`（调度器），覆盖 design.md §1 数据流步骤 4～5 与 §4 `sendMail` 契约。
> 渲染图见同目录 `06-sequence-push.png`；本图为 Mermaid 源码，可用 mermaid-cli 复现。


![序列图（推送、告警与补发）](06-sequence-push.png)

> 上图由下方 Mermaid 源码经 mermaid-cli 12.2 渲染（2026-11-26）。

```mermaid
sequenceDiagram
    autonumber
    participant S as publisher.scheduler
    participant C as clock.ts
    participant R as store.repo
    participant M as publisher.mail
    participant A as publisher.alert
    participant SMTP as SMTP 服务
    actor U as 收件人

    Note over S,C: 情形一：按配置时点正常推送
    S->>C: now() → 到达配置时点？
    C-->>S: true（FixedClock 驱动测试）
    S->>R: loadReports(date, status=confirmed)
    R-->>S: Report[]
    loop 每位成员
        S->>M: sendMail(report, member.email)
        M->>SMTP: nodemailer.sendMail()
        SMTP-->>M: 投递结果
        M-->>S: ok
        S->>R: insertPushLog(report_date, sent_at, 'ok')
    end

    Note over S,C: 情形二：推送失败 → 告警 + 进入补发
    S->>M: sendMail(report, member.email)
    M->>SMTP: nodemailer.sendMail()
    SMTP-->>M: E401 认证失败 / E402 连接超时
    M-->>S: throw SDR-E4xx
    S->>R: insertPushLog(result='failed', retry_count, 入补发队列)
    S->>A: alert(错误码, 影响范围)
    A->>SMTP: 告警邮件（含错误码与源标识；退出码 7）

    Note over S,R: 情形三：错过时点 → 下次启动补发
    S->>C: now() → 检测未推送的 confirmed 日报
    C-->>S: 存在漏推（date, member）
    S->>R: queryPushLog(report_date)
    R-->>S: 无成功记录
    S->>M: sendMail()
    M-->>S: ok
    S->>R: insertPushLog(result='resent')
    Note over S,R: push_log 去重：同一 report_date 已有成功记录则跳过，<br/>补发不产生重复邮件（CS-08）
    M-->>U: 日报邮件送达
```

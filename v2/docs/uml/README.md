# v2 UML 图（工具绘制）

| 文件 | 图类型 | 用途 |
|---|---|---|
| [01-module-class.md](./01-module-class.md) | 模块类图 / 依赖图 | 四层架构与分层约束（生成层不得依赖采集层等） |
| [02-sequence-main.md](./02-sequence-main.md) | 时序图 | 主链路 collect → generate → edit → push → history / serve |
| [03-er.md](./03-er.md) | ER 图 | 9 张表结构与约束（逐列对照 `v2/src/store/schema.ts`） |

## 导出 PNG（可选）

```bash
npx -y @mermaid-js/mermaid-cli -i 01-module-class.md -o 01-module-class.png
```

> 课程要求 UML 必须由工具绘制、禁止手绘拍照。本目录保留 Mermaid 源文件即为「可复现」证据；
> 若答辩要求 PNG，用上面命令或 IDE 插件导出，不要用截图替代。

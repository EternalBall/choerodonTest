# 引擎源码

端到端**使用说明**见仓库根目录 [README.md](../README.md)。

| 模块 | 职责 |
|------|------|
| `cli/` | `ata gen` / `test` / `snapshot` / `compare` / `auth` / `actions` |
| `compare/` | v1 vs current：`diff.yaml`、LLM `report.yaml` |
| `codegen/` | artifacts + playbooks → LLM → suite；元素库合并 |
| `analyzer/` | 源码检索 + LLM 分析（强制，无启发式兜底） |
| `keywords/` | suite `action` 运行时 |
| `core/schema.ts` | `FeatureArtifact`、`MetaOp`、`Flow`、`Suite` |

```bash
pnpm ata --help
```

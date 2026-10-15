# 引擎源码

## 已迁入：Kit + meta_ops → Playwright

| 模块 | 职责 |
|------|------|
| `codegen/` | `flows` + `meta_ops` → suite YAML（`compileFlow` / `defaultFlows` / `genCase`） |
| `knowledge/platformKit.ts` | 合并 `knowledge/platform/choerodon/kit.yaml` + 功能 `elements.yaml` |
| `keywords/` | suite `action` 运行时实现（与 `compileFlow` 中 kind 映射） |
| `core/schema.ts` | `FeatureArtifact`、`MetaOp`、`Flow`、`Suite` 模型 |
| `analyzer/` | 源码检索 + DeepSeek LLM 分析（强制，无启发式兜底） |
| `cli/` | `ata analyze` / `ata gen` / `ata test` / `ata actions` |

## 未迁入（后续）

- `probe/` DOM 探针
- `solidify` / `confirm` 全量沉淀

## 命令

```bash
pnpm install
pnpm ata analyze -f Material -p "path/to/feature/src"   # 须配置 DEEPSEEK_API_KEY
pnpm ata gen -i path/to/feature.yaml
pnpm ata test -c cases/generated/<slug>.yaml --skip-auth   # 业务环境去掉 --skip-auth
pnpm ata test -c cases/example-smoke.yaml --skip-auth      # 本地 demo
```

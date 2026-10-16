# 引擎源码

## 已迁入：源码 → 元操作 → suite → Playwright

端到端说明见 [docs/meta-ops-flows.md](../docs/meta-ops-flows.md)。

| 模块 | 职责 |
|------|------|
| `codegen/` | (2) artifacts + playbooks → LLM → suite；`writeFeatureElementsStub` 合并 platform kit 写元素库（`defaultFlows`/`compileFlow` 遗留） |
| `knowledge/platformKit.ts` | 合并 `knowledge/platform/choerodon/kit.yaml` + 功能 `elements.yaml` |
| `keywords/` | suite `action` 运行时实现 |
| `core/schema.ts` | `FeatureArtifact`、`MetaOp`、`Flow`、`Suite` 模型 |
| `analyzer/` | 源码检索 + playbooks 注入 + DeepSeek LLM 分析（强制，无启发式兜底） |
| `knowledge/loadPlaybooks.ts` | 加载 `knowledge/playbooks/*.md` 供分析/生成注入 |
| `cli/` | `ata analyze` / `ata gen` / `ata test` / `ata actions` |

## 未迁入（后续）

- `probe/` DOM 探针
- `solidify` / `confirm` 全量沉淀

## 命令

```bash
pnpm install
pnpm ata gen -f Material -p "path/to/feature/src"        # 元操作 + suite + elements（一步）
pnpm ata gen -i artifacts/<slug>/feature.yaml           # 仅重生成测试脚本
pnpm ata test -c cases/generated/<slug>/suite.yaml --skip-auth   # 业务环境去掉 --skip-auth
pnpm ata test -c cases/example-smoke.yaml --skip-auth            # 本地 demo
```

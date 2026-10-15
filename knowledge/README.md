# 组件知识（Knowledge）

本目录属于 **组件知识层**，会提交到本仓 Git，供分析引擎检索与遵循。

| 子目录 | 作用 |
|--------|------|
| [platform/](./platform/) | **平台定位（Kit）**：组件库级 key → locator；DOM 真相源 |
| [playbooks/](./playbooks/) | **操作手册**：某类组件在常见场景下如何操作；不规定某业务要测哪些 flow |
| [features/](./features/) | **功能路径描述**落盘区（`feature.yaml` 等）；默认 **不提交**（见根目录 `.gitignore`），仅 `_example/` 可作演示 |

分析前应先具备可用的 Kit + Playbook（[ADR 0007](../docs/adr/0007-knowledge-first-then-analyze-with-playbooks.md)）。缺覆盖时应失败并写草稿（[ADR 0008](../docs/adr/0008-analyze-fails-on-missing-component-knowledge.md)）。

功能产物中的 `elements.yaml` 为业务特例覆盖，**不能**替代平台 Kit 的长期维护。

## 已从 web_auto_test 迁入

- `platform/choerodon/kit.yaml` 及 `platform/README.md`
- `playbooks/*.md`（组件向手册；`meta-ops-flows`、`screenshot` 在 `docs/`）
- **未迁入** `knowledge/features/*`（功能路径描述，见 `.gitignore`）

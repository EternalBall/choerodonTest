# 操作手册（Playbooks）

**组件知识**：Choerodon / HZero 上「某类 UI 怎么操作、怎么从源码认 API」，供分析引擎（未来检索注入）与人工参阅。

**不包含**：功能路径描述、`meta_ops`/`flows` 编排、截图报告约定（见 [docs/meta-ops-flows.md](../../docs/meta-ops-flows.md)、[docs/screenshot.md](../../docs/screenshot.md)）。

## 索引

| 文件 | 主题 |
|------|------|
| [choerodon-table-filterBar.md](./choerodon-table-filterBar.md) | 列表动态筛选条 |
| [choerodon-create-detail.md](./choerodon-create-detail.md) | 新建 / 详情 / 编辑状态机 |
| [choerodon-table-row-edit.md](./choerodon-table-row-edit.md) | 表头编辑、增删行、行内 Lov/Switch、Popconfirm |
| [page-states.md](./page-states.md) | 页面状态与就绪条件 |
| [row-action.md](./row-action.md) | 行内动作（Radio/Switch 等，非页头保存） |
| [api-binding.md](./api-binding.md) | 从源码抽取 API 字面量 |

引擎运行时当前**只读** `platform/choerodon/kit.yaml`；playbook 正文在分析阶段引用（迁入引擎后应实现目录加载，见 ADR 0007）。

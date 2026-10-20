# Choerodon 新建/详情页（物料维护实测）
# 机器可读定位见：knowledge/platform/choerodon/kit.yaml

## 结构

```
.page-container > .hmes-style
  ├── .page-head
  │     └── .page-head-operator
  │           ├── 保存 (.c7n-pro-btn-primary + .icon-save)
  │           ├── 取消
  │           └── 站点分配 / 复制 / 扩展属性（新建时常 disabled）
  └── .page-content
        ├── 折叠「基础属性」→ form（name 为运行时 form-N，勿写死）
        │     materialCode* / materialName* / primaryUomLov* / enableFlag …
        ├── 折叠「规格尺寸」→ 另一 form
        └── 折叠「主辅单位换算」→ 子表
```

## 定位要点

- **formReady / saveBtn**：优先 `.page-head button:has(.icon-save)` 或 `role=button name=保存`（勿仅用 `.page-head-operator button.c7n-pro-btn-primary`，站点分配等页可能对不上）
- **字段**：限定 `.page-content input[name=…]`，避免和列表 filterBar 同名字段冲突
- **保存**：同上 saveBtn
- **LOV**：点 `.c7n-pro-select-wrapper:has(input[name="primaryUomLov"]) .icon-search`，关键字 `pickLov`（无特定值时默认选表第一行）；完整约定见 [choerodon-lov.md](./choerodon-lov.md)
- **Select/快码**：关键字 `pickSelect`（`name` + `first: true`）；禁止对 Select 填 `${ENV.ATA_SAMPLE}`
- **站点分配**：详情只读页头按钮 → `history.push(.../site-assignment/:materialId)`；用例须先进详情再点，禁止从列表 goto

## 必填（新建）

materialCode、materialName、primaryUomLov（LOV）

## 表格行编辑（站点分配等）

页头「编辑」后：表头 `icon-add` 增行、行内 Lov/Switch、行首 `icon-remove` + Popconfirm「是否删除此条记录？」→ 页头保存。  
机器可读：`knowledge/platform/choerodon/kit.yaml`（`tableAddLineBtn` 等）+ `knowledge/playbooks/choerodon-table-row-edit.md`。

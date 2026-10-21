# Choerodon 新建/详情页（通用结构）
# 机器可读定位见：knowledge/platform/choerodon/kit.yaml
# 页头具体按钮、字段名、关联页以**当前功能源码**为准，勿套某一业务的固定清单。

## 结构（示意）

```
.page-container > .hmes-style
  ├── .page-head
  │     └── .page-head-operator
  │           ├── 保存 / 保存并提交 / 取消 / 其它业务按钮（以 JSX 为准）
  │           └── 部分按钮可能受 canEdit、任务状态等 disabled
  └── .page-content
        ├── 折叠面板 / Tabs → form（name 为运行时 form-N，勿写死）
        └── 子表 / 抽屉入口等
```

## 定位要点

- **formReady / saveBtn**：优先 `.page-head button:has(.icon-save)` 或 `role=button name=保存`（勿仅用 `.page-head-operator button.c7n-pro-btn-primary`）
- **字段**：限定 `.page-content input[name=…]`，避免和列表 filterBar 同名字段冲突
- **保存**：同上 saveBtn；若页头无「编辑」，用例不要插入 click:editBtn
- **LOV**：点 `.c7n-pro-select-wrapper:has(input[name="…"]) .icon-search`，关键字 `pickLov`；见 [choerodon-lov.md](./choerodon-lov.md)
- **Select/快码**：关键字 `pickSelect`（`name` + `first: true`）；禁止对 Select 填 `${ENV.ATA_SAMPLE}`
- **关联页/页头跳转**：以本页按钮/链接文案与路由为准；用例须先进详情再点，禁止从列表盲 goto 带 :id 的路径

## 表格行编辑（若源码确有）

页头解锁（若有编辑）后：表头 `icon-add` 增行、行内 Lov/Switch、行首 `icon-remove` + Popconfirm → 页头保存。  
机器可读：`knowledge/platform/choerodon/kit.yaml` + `knowledge/playbooks/choerodon-table-row-edit.md`。

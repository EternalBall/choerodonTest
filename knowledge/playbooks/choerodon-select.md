# Choerodon Pro Select / Lookup（快码下拉）

源码：[components-pro/select](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/select)、[lov](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/lov)。  
继承 [TriggerField](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/trigger-field)；机器可读：`kit.yaml`（`select*`）。

与 Lov **不是**同一操作：

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **Select / Lookup** | Field `lookupCode` / `options` / `<Select>`；后缀多为下拉箭头 | 点触发 → **下拉菜单**选 option，无 Modal 表 |
| **Lov** | Field `lovCode` / `<Lov>`；后缀常为 `.icon-search` | 点搜索 → **Modal/Drawer/popup 表**选行 → 确定；用 `pickLov`（详见 [choerodon-lov.md](./choerodon-lov.md)） |
| **SelectBox** | `<SelectBox>` | 选项平铺，无下拉（选项少时） |

## DOM

```
.c7n-pro-select-wrapper
  └── .c7n-pro-select[.c7n-pro-select-expand]
        ├── input.c7n-pro-input[name=字段]
        └── .c7n-pro-select-trigger          # 箭头；Lov 时可能是 .icon-search

# 弹出层（挂 body）
.c7n-pro-select-popup
  └── .c7n-pro-select-dropdown-menu
        └── …菜单项（点文案/li 选中）
```

可搜索时：`searchable`；搜索框可在 popup 内（`searchFieldInPopup`）。多选有全选/反选（`selectAllButton` / `reverse`）。

## 源码识别

1. DS Field：`lookupCode` → Select；`lovCode` → Lov（勿混）。  
2. `type: string|number` + lookup → 选 value；`type: object` + lov → 选对象。  
3. `primitiveValue` / valueField / textField 决定回填形态。  
4. 表单项 `name` = DS 字段名 → 定位 `input[name=…]`。

## 分析产物

```yaml
field_rules:
  - name: status
    control: select          # select | lov | select_box
    editable_when: [detail_edit]
```

`control: lov` 走 pickLov；`select` 走点开下拉选 option。

## 自动化步骤

1. 定位：`.c7n-pro-select-wrapper:has(input[name="status"])`（或功能层 key）  
2. 关键字 **`pickSelect`**（推荐）或手工 click trigger → popup  
3. **样本默认选第一条**：`first: true`（无业务特定值时不要写死文案）  
4. 需要特定值时用 `option: "启用"`  

```yaml
# 独立步骤
- action: pickSelect
  args:
    name: fieldType
    first: true

# 查询条内嵌
- action: tableFilterQuery
  args:
    mode: filterBar
    fields:
      - name: fieldType
        label: 类型
        control: select
        first: true

# kit
selectPopup:
  css: .c7n-pro-select-popup
selectTrigger:
  css: .c7n-pro-select-wrapper .c7n-pro-select-trigger
```

可搜索：先在 popup 搜索框填关键词再点项（特定 option 时）。

## 常见误判

| 错误 | 正确 |
|------|------|
| Select 用 `pickLov` | 无 Modal 表；用 `pickSelect` |
| Select 填 `${ENV.ATA_SAMPLE}` | 用 `first: true` 点第一条 option |
| Lov 当 Select 只点箭头 | 点 `.icon-search` → Modal |
| 与 filterBar 同名字段冲突 | 限定 `.page-content` / form within |
| 行内编辑格未激活就点 Select | 先点可编辑格（见 row-edit） |

# Choerodon Pro Transfer / Screening（穿梭框与筛选器）

源码：[components-pro/transfer](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/transfer)、[components-pro/screening](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/screening)。  
Transfer 继承 Select（`suffixCls: 'transfer'`）；Screening 为 DataSetComponent（`suffixCls: 'screening'`，子项 `ScreeningItem` 为 `screening-item`）。  
样式前缀为 **`c7n-pro-`** + suffixCls（`transfer/__tests__/__snapshots__/demo.test.js.snap` 实测类名）。机器可读：`kit.yaml`（建议键见本文末，汇总文件 `kit-choerodon-transfer-screening.yaml`）。

## Transfer（穿梭框）

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **Transfer** | `<Transfer>`，`multiple` 固定为 true（Transfer.tsx:31-37） | 左右双列表 + 中间箭头；左列勾选后点箭头搬到右列 |
| **Select（multiple）** | `<Select multiple>` | 触发器 + 下拉菜单 `.c7n-pro-select-popup`，无双列 |
| **Screening** | `<Screening>` + `<ScreeningItem>` | 按字段分行的筛选条，见下文 |

### DOM

```
span.c7n-pro-transfer-wrapper[.c7n-pro-transfer-wrapper-sortable]
  ├── div.c7n-pro-transfer[.c7n-pro-transfer-with-header]     # 左列表（DOM 第 1 个 div）
  │     ├── div.c7n-pro-transfer-header                       # 全选 checkbox + 「n/m项」
  │     │     └── span.c7n-pro-transfer-header-title          # titles[0]
  │     └── div.c7n-pro-transfer-body[.c7n-pro-transfer-body-with-search]
  │           ├── div.c7n-pro-transfer-body-search-wrapper > input   # searchable
  │           └── div.c7n-pro-transfer-content-wrapper > ul.c7n-pro-transfer-content
  │                 └── li.c7n-pro-transfer-content-item[-active|-disabled]
  ├── div.c7n-pro-transfer-operation                          # 中间：仅图标按钮
  │     └── button:has(.icon-navigate_next) / button:has(.icon-navigate_before)
  ├── div.c7n-pro-transfer                                    # 右列表（DOM 第 3 个 div）
  └── div.c7n-pro-transfer-sort（sortable）                    # icon expand_less / expand_more
```

箭头按钮无文案（`operations` 默认 `[]`，Transfer.tsx:261），**只能按图标定位**。快照中按钮类为 `c7n-pro-btn-icon-only`。

### 源码识别

1. JSX：`<Transfer>`、`Transfer.Option`、`Transfer.OptGroup`。`children` 为函数时走 `CustomArea` 自定义渲染（TransferList.tsx:225），DOM 不同，本节不适用。
2. DataSet：`<Transfer name="字段" dataSet={ds}>`，Field 配 `lookupCode` 或 `options`（见 demo/dataset.md），`textField` / `valueField` 决定文本与值。
3. `oneWay`：无左箭头；右列表条目出现删除图标 `.c7n-pro-transfer-item-delete`（TransferList.tsx:199）。
4. `sortable`：出现 `.c7n-pro-transfer-sort`（TransferSort.tsx:37）。

### 分析产物

```yaml
field_rules:
  - name: categories
    control: transfer      # 双列穿梭；oneWay / sortable 按页面结构另标
```

### 自动化步骤

无专用关键字，用 `click` / `fill` / `assertVisible` 组合，`within` 限定到左或右列表。

1. 左列勾选：`click`，`target: transferItem`，`within: transferLeftList`，`hasText: Jack`。点击是**切换勾选**（Transfer.tsx:201-209），不直接搬移。
2. 右移：`click`，`target: transferMoveRightBtn`。仅当左侧有勾选时可点（否则 `c7n-pro-btn-disabled`）。
3. 验证：`assertVisible`，`target: transferItem`，`within: transferRightList`，`hasText: Jack`。
4. 左移：先在右列表 `click` 勾选项，再 `click` `transferMoveLeftBtn`。
5. 搜索：`fill`，`target: transferSearchInput`，`within: transferLeftList`，`value: Ja`。
6. 全选：`click`，`target: transferHeaderSelectAll`，`within: transferLeftList`。
7. 排序（sortable）：右列表先勾选一项，再 `click` `transferSortUpBtn` / `transferSortDownBtn`。

```yaml
# kit（建议新增；与 kit.yaml 现有键不重名）
transferWrapper:
  css: .c7n-pro-transfer-wrapper
transferLeftList:
  css: .c7n-pro-transfer-wrapper > .c7n-pro-transfer:nth-of-type(1)
transferRightList:
  css: .c7n-pro-transfer-wrapper > .c7n-pro-transfer:nth-of-type(3)
transferItem:
  css: .c7n-pro-transfer-content-item
  note: 必须 within 列表使用
transferHeaderSelectAll:
  css: .c7n-pro-transfer-header .c7n-pro-checkbox
  note: 必须 within 列表使用
transferSearchInput:
  css: .c7n-pro-transfer-body-search-wrapper input
transferMoveRightBtn:
  css: .c7n-pro-transfer-operation button:has(.icon-navigate_next)
transferMoveLeftBtn:
  css: .c7n-pro-transfer-operation button:has(.icon-navigate_before)
transferSortUpBtn:
  css: .c7n-pro-transfer-sort button:has(.icon-expand_less)
transferSortDownBtn:
  css: .c7n-pro-transfer-sort button:has(.icon-expand_more)
```

## Screening（筛选器）

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **Screening** | `<Screening dataSet>` + `<ScreeningItem name>` | 每个字段一行；已选值汇总到顶部「已选」条 |
| **Table filterBar** | `.c7n-pro-table-dynamic-filter-bar` | 表格查询条的动态字段，与 Screening 无关（见 choerodon-table-filterBar.md） |
| **Select** | `lookupCode` 的单下拉 | 触发器 + popup；Screening 的选项平铺在行内 |

### DOM（源码推导，无快照；<<待核实>> 处需在运行页面确认）

```
div.c7n-pro-screening                                 # Screening 根
  ├── div.c7n-pro-screening-choosed                   # 有值时出现（tagRender 时替换）
  │     ├── span.c7n-pro-screening-choosed-label      # 「已选:」
  │     └── .c7n-pro-screening-choosed-content > <<待核实：Tag 类名>>  # 「label:text」+ 关闭
  └── div.c7n-pro-screening-item[.c7n-pro-screening-item-multiple]    # 未赋值的每个 ScreeningItem
        ├── span.c7n-pro-screening-item-label         # 「label:」
        ├── div.c7n-pro-screening-item-content > div.c7n-pro-screening-item-scroll
        │     └── div.c7n-pro-screening-item-option[-selected|-disabled|-active]
        │           └── span.c7n-pro-screening-item-option-text
        ├── div.c7n-pro-screening-item-operation      # 单选态：展开 + 「多选」
        │     ├── div.c7n-pro-screening-item-expanded  # 更多 / 收起
        │     └── div.c7n-pro-screening-item-multiple  # icon add + 「多选」
        └── div.c7n-pro-screening-item-footer         # 多选态：「确认」「取消」按钮
```

### 源码识别

1. JSX：`<Screening dataSet={ds}>` 子节点为 `<ScreeningItem name="字段" />`（或 `Screening.ScreeningItem`）；`name` 必填且须为 DataSet 字段名。
2. Field：`lookupCode` 提供选项；`type: object` 时 `primitiveValue` 默认 false，`type: string` 默认为原始值（ScreeningItem.tsx:195）。
3. **同一字段有值后，该 ScreeningItem 会从筛选区消失**（screening/index.tsx:213），值改显示在「已选」条；清除需点已选条上的关闭图标。
4. `renderer` / `tagRender` / `optionRenderer` 会改变 DOM，本节不适用。

### 分析产物

```yaml
field_rules:
  - name: wearCategory
    control: screening     # 按 lookupCode 平铺选项；多选需点「确认」
```

### 自动化步骤

Screening 选项不是下拉，**不用 `pickSelect`**；用 `click` 点 option，并用 `within` 限定到具体 item。

1. 定位行：`screeningItem`，`hasText: 衣服分类1:`（label 文本带冒号）。
2. 多选（可选）：`click`，`target: screeningMultiBtn`，`within: screeningItem` 限定同一行。
3. 选项：`click`，`target: screeningOption`，`within: screeningItem`，`hasText: 选项文案`。
4. 多选态提交：`click`，`target: screeningConfirmBtn`，`within: screeningItem`。
5. 验证：`assertVisible`，`target: screeningChoosed`，`hasText: 衣服分类1`。
6. 清除：在 `screeningChoosed` 内点该 tag 的关闭图标 <<待核实：关闭图标类名>>；清除后 item 重新出现在筛选区。
7. 单选是否点击即提交：<<待核实：ScreeningItem.tsx:379-402 的分支>>。

```yaml
# kit（建议新增）
screeningRoot:
  css: .c7n-pro-screening
screeningChoosed:
  css: .c7n-pro-screening-choosed
screeningItem:
  css: .c7n-pro-screening-item
  note: 用 hasText 指定 label（文本为 label + 冒号）
screeningOption:
  css: .c7n-pro-screening-item-option
  note: 必须 within 具体 screeningItem
screeningMultiBtn:
  css: .c7n-pro-screening-item-operation .c7n-pro-screening-item-multiple
screeningConfirmBtn:
  css: .c7n-pro-screening-item-footer button:has-text("确认")
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 按文案「>」「<」点穿梭箭头 | 默认无文案，用 `button:has(.icon-navigate_next)` |
| 以为点击条目即搬移 | 点击只切换勾选，需再点箭头 |
| 双列表都写 `.c7n-pro-transfer` 不收窄 | 用 `transferLeftList` / `transferRightList`（nth-of-type） |
| Screening 当 Select 用 `pickSelect` | 无下拉，点 `screeningOption` |
| 已选字段的 item 找不到 | 字段有值后 item 已隐藏，先看「已选」条 |

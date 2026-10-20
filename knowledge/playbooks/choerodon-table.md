# Choerodon Pro Table（整表壳 / 分页 / 勾选 / 工具栏）

源码：[components-pro/table](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/table)（`Table.tsx` / `enum.tsx`）、[components-pro/pagination](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/pagination)、文档 [index.zh-CN.md](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/table/index.zh-CN.md)。  
机器可读：`kit.yaml`（`table*` / `pagination*` / `tableToolbar*` / `tableSelection*`）。

本篇覆盖**横切能力**。子主题见：

| 主题 | Playbook |
|------|----------|
| filterBar 动态筛选 | [choerodon-table-filterBar.md](./choerodon-table-filterBar.md) |
| professional / advanced 查询条 | [choerodon-table-queryBar.md](./choerodon-table-queryBar.md) |
| 行编辑增删、行内 Lov | [choerodon-table-row-edit.md](./choerodon-table-row-edit.md) |
| 行内动作 / 更多菜单 | [row-action.md](./row-action.md) / [choerodon-row-dropdown.md](./choerodon-row-dropdown.md) |
| Lov 弹层内嵌表 | [choerodon-lov.md](./choerodon-lov.md) |
| 独立 Tree 控件（非 Table mode） | [choerodon-tree.md](./choerodon-tree.md) |

## 整表壳 DOM

```
.c7n-pro-table-wrapper
  ├── queryBar 区          # filterBar / professionalBar / …（见 queryBar playbooks）
  ├── .c7n-pro-table-toolbar                 # 可选；buttons 工具栏
  │     └── .c7n-pro-table-toolbar-button-group
  ├── .c7n-spin-nested-loading
  │     └── div.c7n-pro-table[.c7n-pro-table-bordered]   # ← 断言/within 用这个
  │           └── table[.c7n-pro-table-last-row-bordered] # 内层 <table>；勿与外层并集
  │                 ├── thead
  │                 │     └── th … / .c7n-pro-table-selection-column  # 表头全选
  │                 └── tbody.c7n-pro-table-tbody
  │                       ├── tr.c7n-pro-table-empty-row              # 空态
  │                       └── tr.c7n-pro-table-row[data-index]        # 数据行
  │                             └── td[data-index=字段名] …
  └── nav.c7n-pro-table-pagination           # 内嵌 Pro Pagination
        └── .c7n-pro-pagination-* …
```

### 定位硬规则

1. **禁止** `.c7n-pro-table, table` 逗号并集 → 同时命中外层 `div` 与内层 `table` → Playwright strict 失败。  
2. 表根用 **`div.c7n-pro-table`**（常带 `-bordered`）；kit 键 `table`。  
3. 数据行：`tr.c7n-pro-table-row`；**排除** `.c7n-pro-table-empty-row` / 文案「暂无数据」。  
4. 列单元格：`td[data-index="字段名"]`（列 `name`）；链接列常见 `td a`。  
5. 多表同页：功能层 `within` 指向具体 wrapper / 带标题的父级，勿裸用全局 `table`。  
6. 加载：`.c7n-spin-spinning`（`tableSpin`）；查询后等 spin 消失再断言行。

### mode / editMode（源码识别）

| 属性 | 常见值 | 含义 |
|------|--------|------|
| `mode` | `list`（默认）/ `tree` | 树表需 DS `idField`+`parentField`；展开用 `.c7n-pro-table-expand-icon` |
| `editMode` | `cell`（默认）/ `inline` | 行编辑见 row-edit；默认点格才出编辑器 |
| `queryBar` | `filterBar` / `professionalBar` / … | 见 queryBar playbooks |
| `pagination` | `object` / `false` | `false` 无底部分页 |
| `selectionMode` | 默认文档为 `rowbox` | 见下节 |
| `buttons` | `add`/`delete`/… 或自定义 | 见工具栏 |

`mode=tree` **不是** [choerodon-tree.md](./choerodon-tree.md) 的 `.c7n-tree` 侧栏；自动化仍在 Table 行上点 expand。

## 分页（Pagination）

Table 将 [Pagination](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/pagination) 包在 `nav.c7n-pro-table-pagination` 内；内部 prefix 为 `c7n-pro-pagination`。

```
nav.c7n-pro-table-pagination
  ├── .c7n-pro-pagination-perpage + .c7n-pro-pagination-size-changer   # 「每页」+ Select
  ├── .c7n-pro-pagination-page-info                                   # 如 1 - 10 / 123
  ├── .c7n-pro-pagination-pager-first|prev|next|last                  # Icon: first_page / navigate_before / navigate_next / last_page
  ├── .c7n-pro-pagination-pager（页码按钮；active 为当前页）
  └── （可选）quick jumper / simple 模式
```

行为（源码）：

- 翻页 / 改 pageSize → `dataSet.query`（改 size 会回到第 1 页）。  
- `hideOnSinglePage`：总条数 ≤ pageSize 时可不渲染。  
- `pagination: false`：无此 nav。  
- 位置：`TablePaginationPosition` = `top` / `bottom` / `both`（分析时看配置）。

### 自动化

一期无专用 keyword 时，用 `click` + kit 键；翻页后 `waitReady`（spin hidden）再 `assertTableHasRows`。

```yaml
# 下一页
- action: click
  args: { target: paginationNext }
- action: waitReady
  args: { hidden: tableSpin }
- action: assertTableHasRows
  args: {}

# kit
pagination:
  css: .c7n-pro-table-pagination
paginationNext:
  css: .c7n-pro-table-pagination .c7n-pro-pagination-pager-next
paginationPrev:
  css: .c7n-pro-table-pagination .c7n-pro-pagination-pager-prev
paginationSizeChanger:
  css: .c7n-pro-table-pagination .c7n-pro-pagination-size-changer
```

分析：列表 query API 绑在 **查询条查询** 与 **翻页/改 pageSize** 上（同一 `transport.read` / 列表字面量）；见 [api-binding.md](./api-binding.md)。勿为「点下一页」编造第二个无关 URL。

## 勾选（selectionMode）

文档默认 `selectionMode: rowbox`。

| selectionMode | DOM / 交互 |
|---------------|------------|
| **rowbox** | 列 `.c7n-pro-table-selection-column` + 行勾选框；表头可全选 |
| **treebox** | 树表勾选（`mode=tree`） |
| **click** / **dblclick** / **mousedown** | 点行选中；无勾选列或弱化勾选 |
| **none** | 不可选；批量工具栏常禁用 |

多选时底栏可有 `.c7n-pro-table-selection-tips`（已选条数 / 缓存切换）。  
`alwaysShowRowBox`：单选也会显示勾选列。

### 自动化（批量）

```yaml
# 勾选第一行
- action: click
  args: { target: tableRowCheckboxFirst }
# 再点工具栏「删除」等（功能层按钮 + clickExpectApi）
```

```yaml
tableSelectionColumn:
  css: .c7n-pro-table-selection-column
tableRowCheckbox:
  css: .c7n-pro-table-tbody tr.c7n-pro-table-row .c7n-pro-table-selection-column .c7n-pro-checkbox-inner
  note: 多行时加 nth 或 within 行；表头全选用 thead 内同列
tableSelectionTips:
  css: .c7n-pro-table-selection-tips
```

与 Lov 弹层内勾选：**同一套** selection 列；确认仍走 Lov footer「确定」（见 lov playbook），不要当成业务批量删。

## 工具栏 buttons

`Table.buttons`：内置 `add` / `delete` / `remove` / `save` / `query` / `reset` / `expandAll` / `collapseAll` / `export`，或自定义 ReactNode。  
渲染在 `.c7n-pro-table-toolbar` → `.c7n-pro-table-toolbar-button-group`。  
`buttonsLimit`：超出进「更多」下拉（`.c7n-pro-table-dropdown-menu-item`）。

| 入口 | 特征 | 勿混用 |
|------|------|--------|
| **页头「新建」** | `.page-head` / `createBtn` | 进 create 页；见 create-detail |
| **Table.buttons add** | 表 toolbar | DS 增行 / 业务自定义 |
| **行编辑表头 icon-add** | `thead button:has(.icon-add)` | 见 row-edit；**不是** toolbar |
| **行内「更多」** | 操作列 Dropdown | 见 row-dropdown |

```yaml
tableToolbar:
  css: .c7n-pro-table-toolbar
tableToolbarBtnGroup:
  css: .c7n-pro-table-toolbar .c7n-pro-table-toolbar-button-group
```

分析产物：批量删/导出标独立 op（`type: delete` / 自定义），`entry_control` 指向 toolbar 按钮；须先勾选再点；`api` 取按钮 `onClick` / `afterClick` / DS `delete` 字面量。

## 进详情 / 断言（已有 keyword）

| 能力 | keyword |
|------|---------|
| 点行链接进详情 | `openDetailRow`（`detailLink` 等） |
| 表内有数据 | `assertTableHasRows` |
| 表空 | `assertTableEmpty` |
| 弹层/表内按文案选行 | `pickFromTable` |

```yaml
- action: tableFilterQuery
  args: { mode: filterBar, fields: […] }
- action: assertTableHasRows
  args: {}
- action: openDetailRow
  args: { target: detailLink, match: "${vars.code}" }
```

## 分析产物约定

```yaml
pages:
  - id: list
    query_bar: filterBar          # 或 professionalBar / advancedBar / none
    selection_mode: rowbox        # 无勾选列则 none / 省略
    pagination: true
    toolbar_buttons: [export]     # 若源码 Table.buttons 含内置或自定义

operations:
  - id: list_query
    type: query
    page_id: list
  - id: list_page_next            # 可选；与 list_query 同 api 字面量时可合并说明
    type: query
    page_id: list
    note: 底栏下一页触发 dataSet.query
  - id: list_batch_delete
    type: delete
    page_id: list
    entry_control: { kind: toolbar_button, name: 删除 }
    preconditions: [row_selected]
```

## 常见误判

| 错误 | 正确 |
|------|------|
| `.c7n-pro-table, table` | 只用 `div.c7n-pro-table`（kit `table`） |
| 把空态行当数据行点 | 排除 `.c7n-pro-table-empty-row` |
| 页头新建当 Table.buttons add | 看按钮所在 DOM（page-head vs toolbar） |
| 行编辑 icon-add 当 toolbar | `tableAddLineBtn` / row-edit |
| filterBar 找文案「查询」 | refresh 图标；见 filterBar playbook |
| 侧栏 Tree 当 Table `mode=tree` | 控件不同；树表点行内 expand-icon |
| 翻页编造新 API | 与列表 read 同一字面量 |
| Lov 内勾选当业务批量删 | Lov 用 `pickLov` + 确定 |

## 一期可延后

列头排序 / 表头过滤、虚拟滚动、聚合 Aggregation、列个性化 customization、`comboBar`、`editMode=inline` 全量约定——源码有能力，出现在业务且要测时再补专节。

# Choerodon Pro 大数据表格与看板（PerformanceTable / Board）

## PerformanceTable（大数据表格）

源码：[components-pro/performance-table](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/performance-table)。  
类名前缀 **`c7n-performance-table`**（Table.tsx:491），不是 `c7n-pro-table`。

| 组件 | 源码线索 | DOM |
|------|----------|-----|
| **PerformanceTable** | `<PerformanceTable>`；`virtualized` `queryBar` `toolbar` `rowSelection` | 根 `div[role=grid].c7n-performance-table` |
| pro Table | `<Table>` | `.c7n-pro-table`，kit `table*` 不适用 |

## DOM

```
div.c7n-performance-table[-bordered][-hover][-loading]   role=grid
  ├── .c7n-pro-table-dynamic-filter-bar                  # queryBar.type=filterBar
  ├── .c7n-performance-table-professional-query-bar      # queryBar.type=professionalBar
  ├── .c7n-performance-table-toolbar
  ├── .c7n-performance-table-header-row-wrapper > .c7n-performance-table-cell-header[-sortable]
  ├── .c7n-performance-table-body-row-wrapper > .c7n-performance-table-row[-row-highLight][.virtualized]
  │     └── .c7n-performance-table-cell-group > .c7n-performance-table-cell
  ├── .c7n-performance-table-body-info                   # 空态
  └── .c7n-performance-table-loader-wrapper
```

推导：`addPrefix = prefix(classPrefix)`（Table.tsx:2332）；Cell/HeaderCell/Row/CellGroup 的 classPrefix 见 Cell.tsx:97、HeaderCell.tsx:67、Row.tsx:39、CellGroup.tsx:38。行勾选框来自 `lib/checkbox`（SelectionBox.tsx:3），类名 <<待核实:行勾选框根类>>。

## 源码识别

1. JSX `<PerformanceTable>`；pro `<Table>` 不算。
2. 特征 props：`virtualized`、`queryBar`、`toolbar`、`rowSelection`；数据来自 `dataSet`（Table.tsx:113）或 `data`。
## 分析产物

```yaml
field_rules:
  - name: performanceTable
    control: performance_table     # performance_table | pro_table | board
    query_bar: filter_bar          # filter_bar | professional_bar
```

## 自动化步骤

1. 就绪：`waitFor` 的 `visible: performanceTableRoot`。
2. 行数断言须显式传 `table`，否则默认选 pro 选择器（tableAssert.ts:59）。
3. 空态：`assertTableEmpty` 只认「暂无数据」（tableAssert.ts:62-66），本组件文案不同，改用 `assertVisible` `performanceTableEmpty`。
4. 筛选：`tableFilterQuery` `mode: filterBar`，默认选择器同 pro（tableFilterQuery.ts:89）。
5. 专业查询条：`mode: professionalBar`，选择器是否适用 <<待核实:professionalBar 选择器>>。

```yaml
- action: assertTableHasRows
  args: {table: performanceTableRoot, min: 1}
- action: tableFilterQuery
  args:
    mode: filterBar
    fields: [{name: <字段名>, label: <字段标签>, control: select, first: true}]
```

6. 排序：`click` `performanceTableHeaderSortable`，`hasText: <列名>`。
7. 高亮：`click` `performanceTableCell`，`hasText: <业务值>`，再 `assertVisible` `performanceTableHighlightRow`。

## 建议新增 kit 键

```yaml
performanceTableRoot:
  css: .c7n-performance-table
performanceTableHeaderSortable:
  css: .c7n-performance-table-cell-header-sortable
performanceTableCell:
  css: .c7n-performance-table-body-row-wrapper .c7n-performance-table-cell
performanceTableHighlightRow:
  css: .c7n-performance-table-row-highLight
performanceTableEmpty:
  css: .c7n-performance-table-body-info
performanceTableToolbar:
  css: .c7n-performance-table-toolbar
performanceTableProfessionalQueryBar:
  css: .c7n-performance-table-professional-query-bar
```

## Board（看板）

源码：[components-pro/board](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/board)。  
前缀 `getProPrefixCls('board')` = **`c7n-pro-board`**（BoardWithContext.tsx:244）；视图 `ViewMode`：table / kanban / card（enum.tsx）。

| 视图 | 源码 | DOM |
|------|------|-----|
| **表格** | pro `Table`（BoardWithContext.tsx:752） | `.c7n-pro-table`，沿用 `table*` |
| **卡片** | `CardContent.tsx`（lib List + Card） | `.c7n-pro-board-card-wrapper` |
| **看板** | `KanbanContent.tsx` / `KanbanColumn.tsx` | `.c7n-pro-board-wrapper` |

## DOM

```
（Board 无固定根类，随视图渲染）
├── button.c7n-pro-btn                       # 视图切换器
│     └── .icon-baseline-arrow_drop_down（展开后为 _up）
├── .c7n-pro-board-switch-board              # 下拉挂 body，仅打开时存在（BoardWithContext.tsx:494）
│     ├── .c7n-pro-board-view-item[-active]
│     └── .c7n-pro-board-view-add
├── 卡片：.c7n-pro-board-card-wrapper > <<待核实:c7n-list 根类>> > .c7n-list-item > .c7n-pro-board-card-container > .c7n-card
└── 看板：.c7n-pro-board-wrapper > .c7n-pro-board-column-container   # KanbanColumn.tsx:198
      ├── .c7n-pro-board-column-header > .c7n-pro-board-column-header-count
      └── .c7n-pro-board-quote-container                              # QuoteItem.tsx:89
```

推导：`${prefixCls}-*` 由 `getProPrefixCls('board')` 派生；`.c7n-list-item`、`.c7n-card` 见 board/style/index.less。

## 源码识别

1. JSX `<Board dataSet={ds} tableProps={...} customizedCode="..." />`（Board.tsx 类型中两者必填）。
2. 视图配置 DataSet 字段即 `ViewField`（enum.tsx）：`viewType`、`viewName`、`id`（默认 `__DEFAULT__`）、`defaultFlag`、`dataJson`。

## 分析产物

```yaml
field_rules:
  - name: boardView
    control: board
    view_modes: [table, kanban, card]    # ViewMode 枚举
    default_view: table
```

## 自动化步骤

1. 表格视图沿用 pro Table 步骤（`table`、`filterBar`、`tableFilterQuery` 均适用）。
2. 切换视图：先 `click` `boardViewSwitcher`，再 `click` `boardViewItem` + `hasText: <视图名>`。
3. 新建视图：下拉内 `click` `boardViewAdd`。
4. 看板：`assertVisible` `boardKanbanColumn`；列计数 `boardKanbanColumnCount`；卡片选中 `boardQuote`（看板）或 `boardCard`（卡片视图），按 `hasText` 选业务记录。
5. 切换后 `waitFor` `visible: boardKanbanWrapper`（或 `boardCardWrapper`）。

```yaml
- action: click
  args: {target: boardViewSwitcher}
- action: click
  args: {target: boardViewItem, hasText: <视图名>}
```

## 建议新增 kit 键

```yaml
boardKanbanWrapper:
  css: .c7n-pro-board-wrapper
boardCardWrapper:
  css: .c7n-pro-board-card-wrapper
boardKanbanColumn:
  css: .c7n-pro-board-column-container
boardKanbanColumnCount:
  css: .c7n-pro-board-column-header-count
boardQuote:
  css: .c7n-pro-board-quote-container
boardCard:
  css: .c7n-pro-board-card-container
boardViewItem:
  css: .c7n-pro-board-switch-board .c7n-pro-board-view-item
boardViewAdd:
  css: .c7n-pro-board-switch-board .c7n-pro-board-view-add
boardViewSwitcher:
  css: '.c7n-pro-btn:has(.icon-baseline-arrow_drop_down)'
```

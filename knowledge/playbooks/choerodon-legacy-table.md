# Choerodon 旧版（choerodon-ui）表格 / 分页 / 列表

源码根：[components](https://github.com/open-hand/choerodon-ui/tree/master/components)（本册只覆盖 table、pagination、list）。  
类名由 `getPrefixCls(suffix)` 拼成 `c7n-<suffix>`（`components/configure/default.tsx:96` 的 `prefixCls: 'c7n'`）；Pro 版为 `c7n-pro-<suffix>`。机器可读：`kit.yaml` 中 `legacy*` 键（待合入，见文末）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本册） | Pro（`choerodon-ui/pro`） |
|------|--------------|---------------------------|
| JSX 导入 | `import { Table, Pagination, List } from 'choerodon-ui'` | `from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-table` / `c7n-pagination` / `c7n-list` | `c7n-pro-table` / `c7n-pro-pagination` |
| 数据绑定 | `dataSource` 数组 + `columns` 配置，**不绑定 DataSet** | 绑定 DataSet，列由 Field 驱动（见 [choerodon-table.md](./choerodon-table.md)） |
| 分页 | Table 的 `pagination` 属性内嵌，或独立 `<Pagination>` | Table 内嵌 `nav.c7n-pro-table-pagination`（见 [choerodon-table.md](./choerodon-table.md) 分页节） |
| 列表 | `<List>` | 无 Pro List 手册（playbooks 中未找到 `c7n-pro-list`） |

交叉链接：Pro 表格整表壳、勾选、工具栏、筛选条见 [choerodon-table.md](./choerodon-table.md)、[choerodon-table-filterBar.md](./choerodon-table-filterBar.md)、[choerodon-table-row-edit.md](./choerodon-table-row-edit.md)。

## Table（旧版表格）

源码：[components/table](https://github.com/open-hand/choerodon-ui/tree/master/components/table)

### DOM

类名依据：`table/Table.tsx:1474-1477`（size / bordered / empty / without-column-header）、`table/Table.tsx:1712`（`-wrapper`）、`rc-components/table/BodyTable.jsx:97`（`-body`）、`rc-components/table/BaseTable.jsx:182`（`-tbody`）、`rc-components/table/HeadTable.jsx:34`（`-header`）。

```
div.c7n-table-wrapper
  └── div.c7n-table[.c7n-table-bordered][.c7n-table-small|.c7n-table-middle][.c7n-table-empty]
        ├── div.c7n-table-title                       # title 属性
        ├── div.c7n-table-header > table > thead
        │     └── th[.c7n-table-selection-column]     # 勾选列（Table.tsx:857）
        │          th[.c7n-table-sort-ascend|descend] # 排序列（Table.tsx:115）
        ├── div.c7n-table-body > table
        │     └── tbody.c7n-table-tbody
        │           └── tr.c7n-table-row[.c7n-table-row-selected]
        │                 └── td（列内容；展开图标 .c7n-table-row-expand-icon）
        ├── div.c7n-table-footer                      # footer 属性
        └── .c7n-table-pagination                     # Table.tsx:1160，内嵌 Pagination 的 className
# 列筛选浮层（挂 body）：.c7n-table-filter-dropdown（Table.tsx:959, less:395）
# <<待核实:div.c7n-table-body 与 tbody 之间的 -body-outer / -body-inner 包裹层嵌套顺序>>（BodyTable.jsx:78,82 有这两个类）
```

### 源码识别

1. 导入来自 `'choerodon-ui'`（非 `/pro`），demo 均如此（`table/demo/basic.md`）。
2. 使用 `columns=[{ title, dataIndex, key, render }]` + `dataSource=[]`；Pro 无 `columns`。
3. `rowSelection={{ onChange }}` → 勾选列；`pagination={{ total, current, onChange }}` 或 `pagination={false}`。
4. `rowKey` 默认 `'key'`（index.zh-CN.md 默认值）。

### 分析产物

```yaml
field_rules:
  - name: records           # 业务列表字段名（旧版无 DS Field，取 dataSource 对应字段）
    control: legacy_table   # legacy_table | legacy_list | legacy_pagination
```

### 自动化步骤

```yaml
# 断言有数据 → 翻下一页 → 等 spin 消失
- action: assertTableHasRows
  args: { target: legacyTableRow }   # <<待核实:assertTableHasRows 是否接受 target 参数>>（Pro 范本 args 为空，走默认 tableRow 键）
- action: click
  args: { target: legacyPaginationNext }
- action: waitReady
  args: { hidden: tableSpin }        # <<待核实:旧版 Spin 类名前缀是否为 c7n-spin>>（tableSpin 当前只含 .c7n-spin-spinning）
- action: assertTableHasRows
  args: { target: legacyTableRow }

# 勾选第一行：点行内 checkbox
- action: click
  args: { target: legacyTableRowCheckbox }   # <<待核实:.c7n-table-tbody .c7n-table-selection-column .c7n-checkbox-input>>

# 空态断言
- action: assertVisible
  args: { target: legacyTableEmpty }
```

要点：旧版没有 DataSet，**不要**用 `tableFilterQuery`（它依赖 Pro 查询条）；列筛选点 `.c7n-table-filter-dropdown` 内的按钮，按文案定位，<<待核实:筛选浮层按钮类名>>。

## Pagination（分页）

源码：[components/pagination](https://github.com/open-hand/choerodon-ui/tree/master/components/pagination)

与易混组件：**Table 内嵌分页**（Table `pagination` 属性）类名为 `c7n-table-pagination`，本质同一个 Pagination；**Pro Pagination** 为 `c7n-pro-pagination`，见 [choerodon-table.md](./choerodon-table.md) 分页节。

### DOM

类名依据：`pagination/Pagination.tsx:120`（`getPrefixCls('pagination')`）、`:132`（`${prefixCls}-${size}` 与 `mini`）、`:588`（tiny）；rc 层 `rc-components/pagination/Pagination.jsx`（prev/next/item/jump/total-text/simple）、`Options.jsx`（size-changer/quick-jumper）。

```
.c7n-pagination[.c7n-pagination-tiny][.c7n-pagination-small|.c7n-pagination-large][.c7n-pagination-simple]
  ├── li.c7n-pagination-total-text                 # showTotal
  ├── li.c7n-pagination-prev[.c7n-pagination-disabled] > a.c7n-pagination-item-link
  ├── li.c7n-pagination-item.c7n-pagination-item-<N>[.c7n-pagination-item-active]
  ├── li.c7n-pagination-jump-prev / .c7n-pagination-jump-next   # 省略页
  ├── li.c7n-pagination-next[.c7n-pagination-disabled] > a.c7n-pagination-item-link
  └── .c7n-pagination-options
        ├── .c7n-pagination-size-changer           # <<待核实:size-changer 是否为 Select 根元素类>>
        └── .c7n-pagination-quick-jumper
```

`tiny` 默认 `true`（`Pagination.tsx:100`）；`item-<N>` 由 `rc-components/pagination/Pagination.jsx:94` 的选择器确认。

### 源码识别

1. 独立使用：`<Pagination total current onChange showSizeChanger />`，`onChange(page, pageSize)`。
2. `size="large"` / `"small"` → `c7n-pagination-large` / `-small`（`Pagination.tsx:132`）。
3. `simple` → `c7n-pagination-simple`；`showQuickJumper` → `.c7n-pagination-quick-jumper`。

### 分析产物

```yaml
field_rules:
  - name: pageNo
    control: legacy_pagination   # 旧版分页器，无 DS 字段
```

### 自动化步骤

```yaml
# 下一页
- action: click
  args: { target: legacyPaginationNext }

# 跳到第 N 页：页码 li 定位，<<待核实:li 是否输出 title 属性>>
- action: click
  args: { target: legacyPaginationItem }     # 配合 :has-text / title 过滤到目标页

# 改每页条数：先开 size-changer，再点下拉项（<<待核实:下拉项类名>>）
- action: click
  args: { target: legacyPaginationSizeChanger }
```

断言当前页：`legacyPaginationItemActive` 可见且文本等于目标页码。

## List（列表）

源码：[components/list](https://github.com/open-hand/choerodon-ui/tree/master/components/list)

与易混组件：旧版 **Table** 用于结构化行列；**List** 用于卡片式条目（`renderItem`），两者都不绑 DataSet。无 Pro 对应手册。

### DOM

类名依据：`list/index.tsx:389-396`（根修饰类）、`:408`（pagination）、`:471-473`（header/footer）、`:255`（empty）、`:318`（selection-checkbox）；`list/Item.tsx:34-115`（item-meta / item-content / item-action / item-extra）。

```
div.c7n-list[.c7n-list-bordered][.c7n-list-split][.c7n-list-lg|.c7n-list-sm][.c7n-list-vertical][.c7n-list-grid]
  ├── div.c7n-list-header                        # header 属性
  ├── div.c7n-list-empty-text                    # 无数据（empty 默认文案）
  ├── div.c7n-list-item[.c7n-list-selection][.c7n-list-selected]
  │     ├── .c7n-list-item-meta
  │     │     ├── .c7n-list-item-meta-avatar
  │     │     └── .c7n-list-item-meta-content
  │     │           ├── h4.c7n-list-item-meta-title
  │     │           └── .c7n-list-item-meta-description
  │     ├── .c7n-list-item-content[.c7n-list-item-content-single]
  │     └── ul.c7n-list-item-action > li（分隔 em.c7n-list-item-action-split）
  ├── div.c7n-list-footer                        # footer 属性
  └── div.c7n-list-pagination                    # pagination 属性（内嵌 Pagination）
```

勾选框：`.c7n-list-selection-checkbox`（`list/index.tsx:318`）。

### 源码识别

1. `import { List } from 'choerodon-ui'`；`<List dataSource={[]} renderItem={fn} />`（`dataSource` 类型见 `list/index.tsx:54`）。
2. `renderItem` 不进入 DOM 透传（`list/index.tsx:469` 的 omit 列表）。
3. `itemLayout="vertical"` → `.c7n-list-vertical`；`grid` → `.c7n-list-grid`。
4. `List.Item` / `List.Item.Meta` 的导出形式 <<待核实:index.tsx 是否挂载 Item 与 Meta 静态属性>>。

### 分析产物

```yaml
field_rules:
  - name: items
    control: legacy_list         # 旧版列表，无 DS 字段
```

### 自动化步骤

```yaml
# 列表有条目
- action: assertVisible
  args: { target: legacyListItem }

# 点第 N 条标题（标题文本由业务数据决定，用 first 取第一条）
- action: click
  args: { target: legacyListItemTitle }

# 翻页：限定在 list 内部分页器
- action: click
  args: { target: legacyListPaginationNext }
```

`legacyListPaginationNext` = `.c7n-list-pagination .c7n-pagination-next`，避免与页面其它分页器重名。

## kit 键（建议新增，与文末汇总一致）

```yaml
legacyTable:
  css: .c7n-table
  note: 旧版 Table 外层 div；勿与内层 table 写逗号并集

legacyTableWrapper:
  css: .c7n-table-wrapper
  note: 含 title / 表 / 分页；多表时功能层再收窄

legacyTableBody:
  css: .c7n-table-tbody

legacyTableRow:
  css: .c7n-table-tbody > tr.c7n-table-row
  note: 数据行；选中态带 .c7n-table-row-selected

legacyTableEmpty:
  text: 暂无数据
  note: 旧版 locale 默认 emptyText（index.zh-CN.md）

legacyTableRowCheckbox:
  css: .c7n-table-tbody .c7n-table-selection-column .c7n-checkbox-input
  note: <<待核实:checkbox 类名>>

legacyTableFilterDropdown:
  css: .c7n-table-filter-dropdown
  note: 列筛选浮层（挂 body）

legacyTablePagination:
  css: .c7n-table-pagination
  note: Table 内嵌 Pagination 的 className（Table.tsx:1160）

legacyPagination:
  css: .c7n-pagination

legacyPaginationPrev:
  css: .c7n-pagination-prev

legacyPaginationNext:
  css: .c7n-pagination-next

legacyPaginationItem:
  css: .c7n-pagination-item
  note: 页码 li；按页码定位见 playbook

legacyPaginationItemActive:
  css: .c7n-pagination-item-active

legacyPaginationTotalText:
  css: .c7n-pagination-total-text

legacyPaginationSizeChanger:
  css: .c7n-pagination-size-changer
  note: <<待核实:是否为 Select 根元素类>>

legacyPaginationQuickJumper:
  css: .c7n-pagination-quick-jumper

legacyList:
  css: .c7n-list

legacyListItem:
  css: .c7n-list-item

legacyListItemTitle:
  css: .c7n-list-item-meta-title

legacyListItemAction:
  css: .c7n-list-item-action

legacyListHeader:
  css: .c7n-list-header

legacyListFooter:
  css: .c7n-list-footer

legacyListEmptyText:
  css: .c7n-list-empty-text

legacyListSelectionCheckbox:
  css: .c7n-list-selection-checkbox

legacyListPagination:
  css: .c7n-list-pagination

legacyListPaginationNext:
  css: .c7n-list-pagination .c7n-pagination-next
```

## 待核实清单（本册）

- Table：`-body-outer/-body-inner` 嵌套顺序；`assertTableHasRows` 的 target 参数；`tableSpin` 对旧版 Spin 是否适用；行 checkbox 类名。
- Pagination：`.c7n-pagination-size-changer` 是否为 Select 根；页码 `title` 属性；size-changer 下拉项类名。
- List：`List.Item` / `List.Item.Meta` 导出形式；loading 的 spin 类名。

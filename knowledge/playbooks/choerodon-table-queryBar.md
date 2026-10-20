# Choerodon Table QueryBar（professionalBar / advanced / filterBar）

源码：[components-pro/table/query-bar](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/table/query-bar)。  
`Table.queryBar` 决定形态；关键字统一 `tableFilterQuery`（`mode`）。

| queryBar / 形态 | 根 class | 查询按钮 |
|-----------------|----------|----------|
| **filterBar**（动态筛选） | `.c7n-pro-table-dynamic-filter-bar` | `.c7n-pro-table-filter-menu-query`（**refresh 图标**，非「查询」文案） |
| **professionalBar** | `.c7n-pro-table-professional-query-bar` | 文案 **「查询」**（locale `query_button`） |
| **advancedBar** | `.c7n-pro-table-advanced-query-bar` | 主区少量字段 + 「高级查询」开 **Drawer Modal** |
| comboBar 等 | `.c7n-pro-table-combo-filter-bar` | 见源码；一期少测可标 REVIEW |

filterBar 细节见 [choerodon-table-filterBar.md](./choerodon-table-filterBar.md)。

## professionalBar DOM（TableProfessionalBar.tsx）

```
.c7n-pro-table-professional-query-bar
  ├── Form（queryDataSet 字段；默认展示前 queryFieldsLimit，默认 3）
  │     └── input / Select / DatePicker[name=字段]
  └── .c7n-pro-table-professional-query-bar-button
        ├── 「更多」按钮（展开其余 queryFields；带 expand_more / expand_less）
        ├── 「重置」
        └── 「查询」（primary）
```

工具栏按钮区：`.c7n-pro-table-professional-toolbar`。  
回车字段会触发查询（`onEnterDown` → `dataSet.query()`）。  
`autoQueryAfterReset` 默认 true：重置后自动再查。

## advancedBar（TableAdvancedQueryBar.tsx）

- 主条：少量 float 字段 + 重置 +「高级查询」  
- 点「高级查询」→ `Modal.open({ drawer: true, title: 高级查询, okText: 查询 })`  
- 确定 = `dataSet.query()`；字段在 drawer Form 内  

定位抽屉见 [choerodon-modal.md](./choerodon-modal.md)。

## 源码识别

```tsx
<Table queryBar="professionalBar" queryFieldsLimit={3} />
// 或 Table.queryBar = TableQueryBarType.professionalBar
```

`queryDataSet` / `queryFields` 定义可查字段；分析时写入 list 查询 op 的 fields。

## 分析产物

```yaml
operations:
  - id: list_query
    type: query
    page_id: list
    fields: [materialCode, materialName]
    # gen: tableFilterQuery mode 按页面 queryBar
```

## 自动化

### professionalBar

```yaml
# tableFilterQuery
mode: professionalBar
fields:
  - { name: materialCode, value: "M001" }
queryButtonName: 查询   # 可选
```

引擎：`fill input[name]` → `getByRole('button', { name: '查询' })`。  
超出默认展示数：先点「更多」再填。

### advancedBar

1. 主条能填则填；否则点「高级查询」  
2. 等 `drawer` active → fill → drawerConfirm（okText=查询）  

### filterBar

见 filterBar playbook；`mode: filterBar`（默认）。

```yaml
professionalQueryBar:
  css: .c7n-pro-table-professional-query-bar
professionalQueryBtn:
  role: button
  name: 查询
  note: 须 within professionalQueryBar，避免点到页头其它「查询」
advancedQueryBtn:
  role: button
  name: 高级查询
```

## 常见误判

| 错误 | 正确 |
|------|------|
| professionalBar 点 refresh 图标 | 点文案「查询」 |
| filterBar 找 button「查询」 | 点 `.c7n-pro-table-filter-menu-query` |
| 未点「更多」填第 4 个字段 | 先展开 moreFields |
| 重置后立刻断言旧结果 | 默认会 autoQuery |

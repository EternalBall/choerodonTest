# Choerodon 表格行编辑模式（Table row edit）

适用于：独立页/子表在 **页头点「编辑」** 后，`canEdit=true`，通过 **表头加号增行、行内控件改值、行首删除**，再点页头 **保存**。

源码参考：[choerodon-ui/components-pro/table](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/table)
（`getEditorByField` / `TableEditor` / Column.`editor`）

与下列模式区分：

| 模式 | 特征 | operation.type |
|------|------|----------------|
| 页头新建 | 列表工具栏「新建」进 create 页 | `create` |
| 详情表单编辑 | 页头编辑 → 改表单字段 → 保存 | `update` |
| 行内动作 | 只读页点 Radio/Switch，直调专用 API，不点页头保存 | `row_action` |
| **表格行编辑** | 编辑态表头 `icon-add` 增行 + 行内 Lov/Switch + `icon-remove` + Popconfirm → 页头保存 | `create`/`update`/`delete`（`page_id` 指该表所在页） |

## 行级条件（必读，禁止套刻板印象）

页头进入编辑态 **≠** 每一行都能增/删/改主键 LOV。必须读列上的 `editor` / `renderer` 条件表达式。

典型（物料站点分配）：

```tsx
// 删行：仅未落库行
renderer: ({ record }) => !record?.get('materialSiteId') && (
  <Popconfirm><Button icon="remove" /></Popconfirm>
)
// 站点 Lov：仅未落库行可编辑
editor: (record) => !record.get('materialSiteId') && canEdit && <Lov name="siteLov" />
// Switch：编辑态即可（已落库行也能改）
editor: () => canEdit && <Switch name="enableFlag" />
```

| 行状态 | 删行 icon-remove | 改站点 Lov | 改 Switch |
|--------|------------------|------------|-----------|
| 已落库（有 `materialSiteId`） | **无** | **否** | **是** |
| 未落库（刚增行） | **有** | **是** | **是** |

分析/归一化/gen 硬约束：

1. `site_assignment_update`：`fields` 只列无行门禁的控件（如三个 Switch）；`execution_chain` 含 `toggle_switch`；**禁止**假设可改已落库行的站点。
2. `site_assignment_delete_line`：**禁止**用 `table_has_rows` 当删已落库行前置；必须 `add_line` → `remove_line` → `popconfirm`（测的是删未保存新行）。
3. `site_assignment_create`：`add_line` → 点格 → `pick_lov` → `save`（正确）。
4. `field_rules`：对 Lov 写 `row_gate: "!materialSiteId"`（或等价 note）；对仅 Switch 可改的字段写清 `editable_when` + note。

## DOM 特征（实测）

```
.c7n-pro-table
  thead
    th button:has(.icon-add)          ← 增行（非 .c7n-pro-table-header）
  tbody
    .c7n-pro-table-empty-row          ← 空态「暂无数据」
    .c7n-pro-table-row                ← 有数据 / 增行后
      button:has(.icon-remove)        ← 删行（常仅未落库行渲染）
      td[data-index=…] 
        .c7n-pro-table-cell-inner-editable
        .c7n-pro-table-cell-inner-required  ← 必填可编辑格（展示层，尚未打开 Lov）
      input.c7n-pro-switch[name=…]    ← 行内开关（常直接嵌在格内）
      a[disabled]                     ← 依赖已落库 id 的链接（未保存不可点）
.c7n-popover … 「是否删除此条记录？」/「是否确认删除?」 取消 / 确定
```

平台 kit 键：`tableAddLineBtn` / `tableRemoveLineBtn` / `tableDeletePopover` / `tableDeleteConfirm` / `tableDeleteCancel` / `tableEditableRequiredCell` / `tableEmptyRow` / `tableLovOpen` / `tableActionLink`。

## 行内操作列 `<a>`（无 href）

Choerodon / 业务常见写法：

```tsx
<span className="action-link">
  <a disabled={!id} onClick={() => history.push(...)}>物料站点属性维护</a>
</span>
```

- **有** `href` 的 `<a>` → 无障碍树多为 `link`，可用 `role=link`
- **无** `href`、只靠 `onClick` → 常被当成普通文本/单元格内容，**`getByRole('link')` 找不到**
- 多行同文案时，裸 `text:` + `getByText` 易点到 **cell/row** 而非 `<a>` → 不导航、随后 URL 断言拖到超时

分析产物里 `entry_control.kind=link` 只表示「语义是链接入口」，**定位禁止默认映射成 `role: link`**。

正确沉淀：

```yaml
tableActionLink:
  css: .action-link a
  note: 行内 action-link；无 href

# 功能层（推荐 css，勿仅用 text）
siteAttrLink:
  css: .action-link a
  within: feat_xxx.siteAssignmentTable
  note: 勿用 role=link / 勿裸 text
```

`elements_hints` 应写 `text`/`css`，不要写 `role: link`（除非源码确认有 `href`）。

## 行内 Lov 展示方式（重要）

默认 **`editMode=cell`**：格子平时只是**展示层**；点格后 `TableEditor` 把 Lov **浮层叠在单元格上**，搜索图标**不一定**在 `td` 子树里。

| 阶段 | DOM / 行为 |
|------|------------|
| 增行后未点格 | `td[data-index=字段] .c7n-pro-table-cell-inner-editable`（可带 `…-required`）；**通常没有** `.icon-search` |
| 点格激活编辑 | 出现 Lov（`input` + 后缀搜索）；编辑器常在表浮层，如 `.c7n-pro-lov` / `.c7n-pro-select-wrapper:has(input[name=…])` |
| 点搜索图标 | Lov Modal/Popup 选表 → 选行回填 object 字段 |
| 已有落库主键 | `editor` 常返回 false（如站点分配 `materialSiteId` 已有）→ 只读展示，不可再开 Lov |

字段侧：`type: object` + `lovCode` → `getEditorByField` 自动 `<Lov />`；也可列上显式 `editor: () => <Lov name="siteLov" />`。

### 自动化步骤（必须分两步）

1. `click` **可编辑格**（`tableEditableCell` / 功能层 `siteLovCell`）——激活 TableEditor  
2. `pickLov` 的 `open` 指向 **浮层 Lov 搜索图标**（`tableLovOpen`），**禁止**写死 `td … .icon-search`（多数时候匹配不到）

```yaml
# 平台
tableLovOpen:
  css: .c7n-pro-select-wrapper:has(input.c7n-pro-input) .icon-search
  note: 须先点格激活；取当前可见 Lov；功能层可用 :has(input[name="siteLov"])

# 功能层示例
siteLovCell:
  css: 'td[data-index="siteLov"] .c7n-pro-table-cell-inner-editable'
  within: feat_xxx.siteAssignmentTable
siteLovOpen:
  css: '.c7n-pro-select-wrapper:has(input[name="siteLov"]) .icon-search'
  note: 不在 within 表根内；点格后出现在浮层
```

用例链：`… → add_line → click siteLovCell → pickLov(open=siteLovOpen) → save`

## 分析产物约定

```yaml
pages:
  - id: site_assignment
    scope: in_feature
operations:
  - id: site_assignment_update
    type: update
    page_id: site_assignment
    fields: [revisionFlag, productionVersionFlag, enableFlag]
    execution_chain: [list, detail, site_assignment, edit, toggle_switch, save]
    description: 已落库行仅可改 Switch；不可改站点、不可删
  - id: site_assignment_create
    type: create
    page_id: site_assignment
    scope: in_feature
    unlock: click:editBtn
    preconditions: [enter_detail, open_site_assignment, click:editBtn]
    execution_chain: [list, detail, site_assignment, edit, add_line, activate_lov_cell, pick_lov, save]
  - id: site_assignment_delete_line
    type: delete
    page_id: site_assignment
    scope: in_feature
    preconditions: [enter_detail, open_site_assignment, click:editBtn]
    execution_chain: [list, detail, site_assignment, edit, add_line, remove_line, popconfirm, save]
    description: 仅未落库行有删钮；须先增行再删
page_states:
  - id: site_assignment_edit
    mode: edit
    header_buttons: [保存, 取消]
field_rules:
  - name: siteLov
    control: lov
    editable_when: [site_assignment_edit]
    row_gate: "!materialSiteId"
  - name: enableFlag
    control: switch
    editable_when: [site_assignment_edit]
```

- 空表也可测「增行」：不必先 `assertTableHasRows`。
- 行内必填未选就保存 → `validations`（required）；应能出失败用例。
- 依赖落库 id 的行链接（如站点属性）在未保存新行上为 `disabled`，属 **跨功能出边**，勿在增行未保存时点。

## 推荐用例步骤

**已落库行编辑保存（update）**

1. 进关联页 → 点编辑
2. 确认表有行 → `click` 行内 Switch（如 `enableFlag` / `revisionFlag`，first）
3. `clickExpectApi` 页头保存

**增行保存**

1. 进关联页 → 点编辑（页头出现保存）
2. `click` `tableAddLineBtn`（within 该表；CSS 相对 `thead button:has(.icon-add)`）
3. `click` 行内必填格（激活编辑器）
4. `pickLov`（`open` = 浮层 `tableLovOpen` / 功能 `siteLovOpen`）
5. `clickExpectApi` 页头保存

**删行（未落库行）**

1. 编辑态
2. `click` `tableAddLineBtn`（先造出带 icon-remove 的行）
3. `click` `tableRemoveLineBtn`（first）
4. `click` `tableDeleteConfirm`
5. （可选）页头保存；若只删未保存行也可取消

## within 约定

`within` 已指向 `.c7n-pro-table…` 时，子选择器**禁止**再写 `.c7n-pro-table …`（会变成表内再找表 → 0 匹配）。

```yaml
siteAssignmentTable:
  css: .c7n-pro-table.c7n-pro-table-bordered
siteAddLineBtn:
  css: thead button:has(.icon-add)
  within: feat_xxx.siteAssignmentTable
siteLovCell:
  css: 'td[data-index="siteLov"] .c7n-pro-table-cell-inner-editable'
  within: feat_xxx.siteAssignmentTable
siteLovOpen:
  css: '.c7n-pro-select-wrapper:has(input[name="siteLov"]) .icon-search'
  # 不要 within 表根
```

# Choerodon Pro Lov（值列表）

源码：[components-pro/lov](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/lov)（`Lov.tsx` / `LovView.tsx`）、样式 [`style/index.less`](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/lov/style/index.less)。  
继承 [Select](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/select) / [TriggerField](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/trigger-field)；`viewMode` 枚举见 [trigger-field/enum](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/trigger-field/enum.tsx)。  
机器可读：`kit.yaml`（`lovDialog` / `lovConfirm` / `tableLovOpen`）。

与 Select **不是**同一操作：

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **Lov** | Field `lovCode` / `<Lov>`；后缀多为 `.icon-search` | 点搜索 → **Modal / Drawer / popup 表**选行 → 确定（或点行即选）；用 **`pickLov`** |
| **Select / Lookup** | Field `lookupCode` / `options` / `<Select>`；后缀多为下拉箭头 | 点触发 → **下拉菜单**选 option；用 `pickSelect`（见 [choerodon-select.md](./choerodon-select.md)） |
| **业务 Modal** | `Modal.open` 填表 | 不是 Lov；见 [choerodon-modal.md](./choerodon-modal.md) |

## viewMode（默认 modal）

`Lov.defaultProps.viewMode = TriggerViewMode.modal`。

| viewMode | 打开形态 | 容器 class（源码） | 选行确认 |
|----------|----------|-------------------|----------|
| **modal**（默认） | 居中 Pro Modal | wrapper 加 `c7n-pro-select-lov-modal`；仍是 `.c7n-pro-modal-wrapper.c7n-pro-modal-active` | 单选：点行高亮 → footer「确定」；或**双击**行即选并关；多选：勾选 →「确定」 |
| **drawer** | `drawer: true` 的 Modal | `c7n-pro-select-lov-modal-drawer` + `.c7n-pro-modal-drawer` | 同 modal；多选且 `showSelectedInView` 时侧栏已选列表 |
| **popup** | 下拉浮层（非 Modal） | `.c7n-pro-select-lov-popup`（挂 body） | 单选：**单击**行即回填并关；多选：勾选后点确认区 |

分析时：业务未写 `viewMode` → 按 **modal**；写了 `viewMode="popup"` / `"drawer"` 再换容器。自动化默认用 `lovDialog`（active Modal）；popup 模式用 `lovPopup`。

## DOM

### 触发器（表单 / filterBar）

Lov 复用 Select wrapper；与普通 Select 的差别在**后缀图标与打开物**：

```
.c7n-pro-select-wrapper          # 常带 -lov / select-lov 相关 class
  └── .c7n-pro-select
        ├── input.c7n-pro-input[name=字段]     # name = DS 字段名
        └── .icon-search                       # 后缀；点此 openModal（非下拉箭头）
```

- `viewMode=popup` 时后缀可能仍走 Select 的 trigger，弹出的是 **表**，不是 option 菜单。
- 只读详情 `showDetailWhenReadonly`：后缀可点开只读明细 Modal（无 footer / 不可选）。

定位模板：

```yaml
primaryUomLovOpen:
  css: '.page-content .c7n-pro-select-wrapper:has(input[name="primaryUomLov"]) .icon-search'
```

`platformKit` 对 `field_rules.control: lov` 会自动补 `${name}Open`。

### 弹层内（modal / drawer）

```
.c7n-pro-modal-wrapper.c7n-pro-modal-active[.c7n-pro-modal-drawer]
  ├── .c7n-pro-modal-header / -title          # 标题常来自 Lov 配置 title / 字段 label
  ├── .c7n-pro-modal-body
  │     ├── 查询条（lovQueryBar / queryBar；常有搜索 input）
  │     ├── .c7n-pro-table
  │     │     └── .c7n-pro-table-tbody
  │     │           └── tr.c7n-pro-table-row[data-index]   # 数据行；勿点 empty-row
  │     └── （多选 + showSelectedInView）已选列表
  │           ├── modal：.c7n-pro-modal-selection-list-below
  │           └── drawer：.c7n-pro-modal-selection-list
  └── .c7n-pro-modal-footer
        ├── button.c7n-pro-btn-primary        # 确定（okText，默认「确定」）
        └── button.c7n-pro-btn-default        # 取消
```

### popup 模式

```
.c7n-pro-select-lov-popup          # 源码 className；勿与 .c7n-pro-select-popup（Select option 菜单）混淆
  └── .c7n-pro-table …
```

## 源码识别（分析）

| 线索 | 含义 |
|------|------|
| DS Field `lovCode` / `<Lov name="…" />` | → `control: lov`；**不是** `lookupCode` |
| `type: object`（常见）+ lov | 回填对象；`valueField` / `textField` 决定展示 |
| `viewMode` / `modalProps.drawer` | modal / drawer / popup |
| `multiple` / `tableProps.selectionMode` | 单选 vs rowbox/treebox 多选 |
| `autoSelectSingle` | 查询仅一条时自动选中（可能不弹窗） |
| `searchAction` / `fetchSingle` | 输入即查 / 失焦查；重复时才弹窗 |
| Lov 配置 `queryBar` / `lovItems`（gridField=Y） | 弹层表列与查询条 |
| `treeFlag === 'Y'` | 弹层 Table `mode=tree`；多选常 `treebox` |

硬规则：

1. `lovCode` → Lov；`lookupCode` → Select；勿混 keyword。  
2. 表单项 / 行内编辑器 `name` = DS 字段名 → `input[name=…]`。  
3. Lov 选值本身通常**不**产生业务保存 API；API 绑在后续「保存 / 查询」上（见 [api-binding.md](./api-binding.md)）。

## 分析产物

```yaml
field_rules:
  - name: primaryUomLov
    control: lov
    editable_when: [create, detail_edit]
  - name: siteLov
    control: lov
    row_gate: "!materialSiteId"    # 行内 Lov 常有门禁；见 row-edit
```

- `control: lov` → 生成用 `pickLov`（或 `fillForm` 内嵌 lov + `open`）。  
- 行内 Lov：`execution_chain` 含激活格再 `pick_lov`（见 [choerodon-table-row-edit.md](./choerodon-table-row-edit.md)）。

## 自动化步骤

关键字 **`pickLov`**（`src/keywords/pickLov.ts`）：

1. `click` `open`（搜索图标；表单用 `${name}Open`，行内用先点格再 `tableLovOpen` / 功能层 `*Open`）  
2. 等待 dialog：优先 **`lovDialog`**（`.c7n-pro-modal-wrapper.c7n-pro-modal-active`）；popup 用 `lovPopup`  
3. 可选：弹层内搜索框填关键词 + Enter  
4. **样本默认第一行**：`first: true` / `row.first`（无业务特定值时不要写死文案）  
5. 点行后点「确定」（`lovConfirm`）；无确定钮或点行即关时 keyword 会兜底 Escape  
6. 断言弹层关闭

```yaml
# 独立步骤（表单 Lov）
- action: pickLov
  args:
    open: primaryUomLovOpen
    first: true
    # 需要特定值时：
    # row: { value: "EA" }
    # search: { value: "件" }

# fillForm 内嵌
- action: fillForm
  args:
    fields:
      - name: primaryUomLov
        control: lov
        open: primaryUomLovOpen
        first: true

# 查询条内嵌（filterBar）
- action: tableFilterQuery
  args:
    mode: filterBar
    fields:
      - name: organizationId
        label: 组织
        control: lov
        first: true

# 行内 Lov（须先激活格）
- action: click
  args: { target: siteLovCell }
- action: pickLov
  args:
    open: siteLovOpen
    first: true
```

### kit

```yaml
lovDialog:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active
  note: 默认 modal/drawer；打开态；禁止逗号并集；功能层可按 title 收窄

lovConfirm:
  role: button
  name: 确定

lovPopup:
  css: .c7n-pro-select-lov-popup
  note: viewMode=popup；与 .c7n-pro-select-popup（Select 菜单）区分

lovOpen:
  css: .c7n-pro-select-wrapper .icon-search
  note: 功能层必须 :has(input[name=字段])；行内见 tableLovOpen

tableLovOpen:
  css: .c7n-pro-select-wrapper:has(input.c7n-pro-input) .icon-search
  note: 行内须先 click 可编辑格
```

## 行内 Lov（摘要）

默认 `editMode=cell`：格子是展示层，**点格后**才出现带 `.icon-search` 的编辑器浮层；禁止写死 `td … .icon-search`。完整约定见 [choerodon-table-row-edit.md](./choerodon-table-row-edit.md)「行内 Lov 展示方式」。

## 常见误判

| 错误 | 正确 |
|------|------|
| Lov 用 `pickSelect` / 只点下拉箭头 | 点 `.icon-search` → Modal/表；用 `pickLov` |
| Select 用 `pickLov` | 无选表 Modal；用 `pickSelect` |
| `getByRole('dialog')` 当主定位 | `.c7n-pro-modal-wrapper.c7n-pro-modal-active`（见 modal playbook） |
| 未加 `-active` / 逗号并集 dialog | 会点到隐藏残留或 strict 报错 |
| 把 Lov 弹层写成业务 `opens: modal` op | 步骤用 `pickLov` + `lovDialog`，不要单独造 create Modal |
| 行内未点格就找 `.icon-search` | 先 `click` 可编辑格 |
| 对 Lov 填 `${ENV.ATA_SAMPLE}` 当文本 | 用 `first: true` 选表第一行 |
| popup Lov 当成 `.c7n-pro-select-popup` | 用 `.c7n-pro-select-lov-popup`（内含 Table） |
| 与 filterBar / 页头表单同名字段冲突 | `within` / `.page-content` 限定 |

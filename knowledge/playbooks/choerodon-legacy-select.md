# Choerodon 旧版 Select / TreeSelect / Cascader（choerodon-ui，非 Pro）

源码：[components/select](https://github.com/open-hand/choerodon-ui/tree/master/components/select)、[components/cascader](https://github.com/open-hand/choerodon-ui/tree/master/components/cascader)、[components/tree-select](https://github.com/open-hand/choerodon-ui/tree/master/components/tree-select)。  
DOM 实际由 `components/rc-components/select|cascader|tree-select` 渲染。旧版前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`。  
Pro 版见 [choerodon-select.md](./choerodon-select.md)（Select）与 [choerodon-tree.md](./choerodon-tree.md)（TreeSelect / Cascader）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro（choerodon-select.md / choerodon-tree.md） |
|------|--------------|------------------------------------------------|
| JSX 导入路径 | `import { Select, TreeSelect, Cascader } from 'choerodon-ui'`（`components/index.tsx:46/110/130`；`package.json` main=`lib/index.js`） | `import { Select } from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-select*`、`c7n-cascader*`（TreeSelect 与 Select 共用 `c7n-select`） | `c7n-pro-select-*`、`c7n-pro-tree-select-*`、`c7n-pro-cascader-*` |
| 是否绑定 DataSet | 否，源码 `components/select|cascader|tree-select` 无 DataSet 引用；由 `value` / `onChange` 或 `Form.getFieldDecorator`（`components/form/Form.tsx:126`）管理 | 是，Field `lookupCode` / `type` / DataSet |
| 选中回填 | `onChange(value, label)`（受控） | DS 字段值 |

---

## Select

源码：[components/select](https://github.com/open-hand/choerodon-ui/tree/master/components/select)

| 旧版组件 | 区别 |
|----------|------|
| **Select**（本节） | `.c7n-select` 外壳，弹层为 `.c7n-select-dropdown` 平铺菜单 |
| TreeSelect | 同一 `.c7n-select` 外壳，弹层内是树（见下节） |
| Cascader | `.c7n-cascader-picker`，弹层为多列菜单 |

### DOM

```
.c7n-select[.c7n-select-open][.c7n-select-focused][.c7n-select-disabled][.c7n-select-lg|.c7n-select-sm]
  └── .c7n-select-selection[.c7n-select-selection--single|--multiple]        # 点击触发（rc-components/select/Select.jsx:1632）
        ├── .c7n-select-selection__rendered
        │     ├── .c7n-select-selection-selected-value                       # 单选回填（Select.jsx:1279）
        │     ├── .c7n-select-selection__placeholder                         # 占位文案
        │     ├── li.c7n-select-selection__choice                            # 多选标签
        │     │     ├── .c7n-select-selection__choice__content
        │     │     └── .c7n-select-selection__choice__remove
        │     └── li.c7n-select-search--inline > input.c7n-select-search__field   # showSearch / tags / combobox
        ├── .c7n-select-clear                                                # allowClear（Select.jsx:1567）
        └── .c7n-select-arrow                                                # 下拉箭头

# 弹层（挂 body，可用 getPopupContainer 改）
.c7n-select-dropdown[.c7n-select-dropdown--single|--multiple]               # SelectTrigger.jsx:125,148
  └── .c7n-select-dropdown-menu                                              # DropdownMenu.jsx:152（prefixCls=`${prefixCls}-menu`）
        └── li.c7n-select-dropdown-menu-item[.c7n-select-dropdown-menu-item-selected]
```

### 源码识别

1. JSX：`<Select>` 包裹 `<Option value="…">`（`select/index.zh-CN.md` API 示例）。
2. `mode="multiple" | "tags" | "combobox"` 决定多选 / 标签 / 自由输入（`select/enum.tsx`）。
3. 表单内无 `input[name]`；定位需经表单项 label 收窄（<<待核实:表单项包裹类名>>）。

### 分析产物

```yaml
field_rules:
  - name: status
    control: legacy_select        # legacy_select | legacy_tree_select | legacy_cascader（旧版前缀，区别于 Pro 的 select / tree_select / cascader）
```

### 自动化步骤

1. 定位根：`legacySelectRoot` within 目标表单项（多个 Select 时收窄）。
2. 打开：`click` `legacySelectSelection`（根内）。
3. 等待：`waitFor` `legacySelectDropdown` 可见。
4. 选项：`click` `legacySelectDropdownItem`，用 hasText 指定文案；未指定业务值时点第一项。
5. 可搜索：先 `fill` `legacySelectSearchInput` 输入关键字，再点选项。
6. 多选：每点一项弹层保持打开；删除标签 `click` `legacySelectMultiRemove`。
7. 清空：`click` `legacySelectClear`（需 allowClear；是否需 hover 显示 <<待核实>>）。

### 建议新增 kit 键

```yaml
legacySelectRoot:
  css: .c7n-select:has(.c7n-select-selection)
  note: 旧版 Select / TreeSelect 共用外壳；功能层 within 表单项收窄
legacySelectSelection:
  css: .c7n-select-selection
  note: 点击打开；多个旧版下拉时 within 根
legacySelectDropdown:
  css: .c7n-select-dropdown:not(.c7n-select-tree-dropdown)
  note: 打开态平铺菜单；关闭态是否保留 DOM 待核实（<<待核实>>）
legacySelectDropdownItem:
  css: .c7n-select-dropdown-menu-item
  note: 选项；hasText 指定文案
legacySelectSearchInput:
  css: .c7n-select-search__field
  note: 搜索 / tags / combobox 输入框
legacySelectMultiRemove:
  css: .c7n-select-selection__choice__remove
  note: 多选标签删除图标
legacySelectClear:
  css: .c7n-select-clear
  note: allowClear 时出现
```

---

## TreeSelect

源码：[components/tree-select](https://github.com/open-hand/choerodon-ui/tree/master/components/tree-select)

| 旧版组件 | 区别 |
|----------|------|
| **TreeSelect**（本节） | 外壳同 Select，弹层类名带 `c7n-select-tree-dropdown`，内容为树 |
| Select | 弹层为 `-dropdown-menu` 平铺列表 |
| Pro TreeSelect | `c7n-pro-tree-select-*`，见 [choerodon-tree.md](./choerodon-tree.md) |

### DOM

```
.c7n-select[...]                                          # 外壳同 Select（tree-select/index.tsx:78-95 以 select 前缀渲染）
  └── .c7n-select-selection  …（同 Select）

# 弹层（挂 body）
.c7n-select-dropdown.c7n-select-tree-dropdown[.c7n-select-dropdown--single|--multiple]   # tree-select/index.tsx:93；SelectTrigger.jsx:90,125
  ├── .c7n-select-dropdown-search > input                                # showSearch（仅单选，SelectTrigger.jsx:228）
  ├── .c7n-select-not-found                                              # 无数据（SelectTrigger.jsx:278）
  └── .c7n-select-tree                                                   # rc-tree 前缀（SelectTrigger.jsx:163）
        └── .c7n-select-tree-treenode
              ├── .c7n-select-tree-switcher[.c7n-select-tree-switcher-noop]   # 展开箭头（tree-select/style/index.less:106-117）
              ├── .c7n-select-tree-checkbox > .c7n-select-tree-checkbox-inner # treeCheckable 时（tree-select/index.tsx:88）
              └── .c7n-select-tree-node-content-wrapper[.c7n-select-tree-node-selected]   # 节点文本
```

### 源码识别

1. JSX：`<TreeSelect treeData={[{ value, label, children }]} />`（`tree-select/index.zh-CN.md`；数据结构见 `tree-select/interface.tsx` 的 `TreeData`）。
2. `treeCheckable` / `multiple` 决定 checkbox 与多值标签形态（`interface.tsx`）。
3. 弹层类含 `-tree-dropdown` 可区分普通 Select 弹层（`tree-select/index.tsx:93`）。

### 分析产物

```yaml
field_rules:
  - name: deptId
    control: legacy_tree_select   # 与 Pro tree_select 区分
```

### 自动化步骤

1. 定位根：`legacySelectRoot` within 目标表单项。
2. 打开：`click` `legacySelectSelection`。
3. 等待：`waitFor` `legacyTreeSelectDropdown` 可见。
4. 展开父节点：`click` `legacyTreeSelectSwitcher` within 父节点 `legacyTreeSelectTreeNode`（hasText 父节点名）。
5. 选中：`click` `legacyTreeSelectNodeContent` hasText 节点名；`treeCheckable` 时点 `legacyTreeSelectCheckbox`。
6. 搜索（单选 + showSearch）：`fill` `legacyTreeSelectSearchInput`，再点匹配节点。
7. 多选关闭方式（点空白或 Escape）<<待核实>>。

### 建议新增 kit 键

```yaml
legacyTreeSelectDropdown:
  css: .c7n-select-tree-dropdown
  note: 打开态树弹层；与 legacySelectDropdown 排除关系见其 note
legacyTreeSelectTreeNode:
  css: .c7n-select-tree-treenode
  note: 树节点行；hasText 指定节点名
legacyTreeSelectSwitcher:
  css: .c7n-select-tree-switcher:not(.c7n-select-tree-switcher-noop)
  note: 仅有子节点时可点击
legacyTreeSelectNodeContent:
  css: .c7n-select-tree-node-content-wrapper
  note: 节点文本区，点击选中
legacyTreeSelectNodeSelected:
  css: .c7n-select-tree-node-content-wrapper.c7n-select-tree-node-selected
  note: 已选节点（断言用）
legacyTreeSelectCheckbox:
  css: .c7n-select-tree-checkbox-inner
  note: treeCheckable 时的勾选框
legacyTreeSelectSearchInput:
  css: .c7n-select-dropdown-search input
  note: 弹层内搜索框，仅单选 showSearch
```

---

## Cascader

源码：[components/cascader](https://github.com/open-hand/choerodon-ui/tree/master/components/cascader)

| 旧版组件 | 区别 |
|----------|------|
| **Cascader**（本节） | 触发器 `.c7n-cascader-picker`，弹层为多列 `.c7n-cascader-menu` |
| Pro Cascader | `c7n-pro-cascader-*`，见 [choerodon-tree.md](./choerodon-tree.md) |

### DOM

```
span.c7n-cascader-picker[.c7n-cascader-picker-with-value|-disabled|-show-search|-focused|-lg|-sm]   # cascader/index.tsx:405-410
  ├── span.c7n-cascader-picker-label                                  # 已选文案（index.tsx:476）
  ├── input.c7n-input.c7n-cascader-input                              # index.tsx:480-486；className 挂载层级 <<待核实>>
  ├── span.c7n-cascader-picker-clear                                  # allowClear（index.tsx:471）
  └── .c7n-cascader-picker-arrow[.c7n-cascader-picker-arrow-expand]   # index.tsx:402-403

# 弹层（Trigger prefixCls = `${prefixCls}-menus`，rc-components/cascader/Cascader.jsx:355）
.c7n-cascader-menus[.c7n-cascader-menus-empty]                        # Cascader.jsx:341
  └── .c7n-cascader-mode-multiple                                     # menuMode 默认 multiple（cascader/index.tsx:187；Menus.jsx:245）
        └── ul.c7n-cascader-menu
              └── li.c7n-cascader-menu-item[.-selected|-active|-disabled|-loading|-expand]   # Menus.jsx:102-111
                    └── span.c7n-cascader-menu-item-expand-icon

```

### 源码识别

1. JSX：`<Cascader options={…} />`（`cascader/index.zh-CN.md`），options 为 `{ value, label, children }` 树。
2. `changeOnSelect` 决定中间层点击是否回填；`menuMode` 决定 multiple / single 两种弹层；`showSearch` 决定 input 可输入（`cascader/index.zh-CN.md`）。
3. 无 DataSet、无 `lovCode` / `lookupCode`。

### 分析产物

```yaml
field_rules:
  - name: region
    control: legacy_cascader      # 与 Pro cascader 区分
```

### 自动化步骤

1. 定位根：`legacyCascaderPicker` within 目标表单项。
2. 打开：`click` `legacyCascaderPicker`（默认 click 展开，`expandTrigger` 默认 `click`）。
3. 等待：`waitFor` `legacyCascaderMenus` 可见。
4. 逐级选择：`click` 第一列 `legacyCascaderMenuItem` hasText 一级文案；再点下一列对应项。`changeOnSelect` 为默认 false 时，需点最末级叶子才回填。
5. 可搜索（showSearch）：`click` 或 `fill` `legacyCascaderInput` 输入关键字，再点结果。`loadData` 不可与 showSearch 同用（文档约束）。
6. 清空：`click` `legacyCascaderPickerClear`（需 allowClear 且有值）。

### 建议新增 kit 键

```yaml
legacyCascaderPicker:
  css: .c7n-cascader-picker
  note: 触发器；功能层 within 表单项收窄
legacyCascaderPickerLabel:
  css: .c7n-cascader-picker-label
  note: 已选文案（displayRender 结果）
legacyCascaderPickerClear:
  css: .c7n-cascader-picker-clear
  note: allowClear 且有值时
legacyCascaderPickerArrow:
  css: .c7n-cascader-picker-arrow
  note: 下拉箭头；加 -expand 表示打开
legacyCascaderInput:
  css: .c7n-cascader-picker input.c7n-cascader-input
  note: showSearch 时可输入；className 挂载层级 <<待核实>>
legacyCascaderMenus:
  css: .c7n-cascader-menus:not(.c7n-cascader-menus-empty)
  note: 打开态多列弹层（挂 body）
legacyCascaderMenuItem:
  css: .c7n-cascader-menus .c7n-cascader-menu-item
  note: 菜单项；hasText 指定文案
legacyCascaderMenuItemSelected:
  css: .c7n-cascader-menus .c7n-cascader-menu-item-selected
  note: 已选项（断言用）
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 旧版 Select 用 `.c7n-pro-select-*` 选择器 | 旧版前缀为 `c7n-select*` |
| TreeSelect 用 `.c7n-select-dropdown` 直接选 | 树弹层需加 `.c7n-select-tree-dropdown`，节点在 `.c7n-select-tree-treenode` |
| 旧版 Select 用 `pickSelect` | 其 popup 按 Pro DOM 设计，改用 click 组合 |
| Cascader 点第一列即回填 | 默认需点最末级（`changeOnSelect` 默认 false） |
| 同页同时有 Pro 与旧版下拉 | 用 `.c7n-pro-*` 与 `.c7n-select*` 前缀区分，并 within 字段收窄 |

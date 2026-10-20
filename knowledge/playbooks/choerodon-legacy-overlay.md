# Choerodon 旧版 Modal / Popconfirm / Popover / Tooltip / Dropdown（choerodon-ui，非 Pro）

源码：[components/modal](https://github.com/open-hand/choerodon-ui/tree/master/components/modal)、[popconfirm](https://github.com/open-hand/choerodon-ui/tree/master/components/popconfirm)、[popover](https://github.com/open-hand/choerodon-ui/tree/master/components/popover)、[tooltip](https://github.com/open-hand/choerodon-ui/tree/master/components/tooltip)、[dropdown](https://github.com/open-hand/choerodon-ui/tree/master/components/dropdown)。  
旧版前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`。Pro 版见 [choerodon-modal.md](./choerodon-modal.md)、[choerodon-feedback.md](./choerodon-feedback.md)（Tooltip）、[choerodon-row-dropdown.md](./choerodon-row-dropdown.md)（Dropdown）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro |
|------|--------------|-----|
| JSX 导入路径 | `import { Modal, Popconfirm, Popover, Tooltip, Dropdown } from 'choerodon-ui'` | `import { Modal, Tooltip } from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-modal*`、`c7n-confirm*`、`c7n-popover*`（**Popconfirm 也用此前缀**）、`c7n-tooltip*`、`c7n-dropdown*` | `c7n-pro-modal*`、`c7n-pro-tooltip*`；Dropdown 见 row-dropdown 文档（其类名为 `c7n-dropdown-menu`，是否旧版 DOM <<待核实>>） |
| 是否绑定 DataSet | 否，五个目录源码均无 DataSet 引用；由 `visible` / `onOk` 等 props 控制 | Modal 常与 DS 表单联动（choerodon-modal.md） |
| 打开态判定 | `.c7n-modal-wrap` 可见（rc-dialog 结构，`components/rc-components/dialog/Dialog.tsx:571`） | `.c7n-pro-modal-active` |

---

## Modal / Modal.confirm

Dialog 由 `components/rc-components/dialog` 渲染（`modal/Modal.tsx:7,203-223`），`getPrefixCls('modal')` → `c7n-modal`；`Modal.confirm` 等由 `modal/confirm.tsx` 挂载，前缀 `c7n-confirm`。

| 旧版组件 | 区别 |
|----------|------|
| **Modal**（本节） | 受控 `visible`，DOM 为 `.c7n-modal-wrap > .c7n-modal` |
| Modal.confirm / info / success / error / warning | 同 Dialog 结构，根节点追加 `c7n-confirm c7n-confirm-<type>`（`confirm.tsx:55`） |
| Popconfirm | 气泡而非居中弹窗，见下节 |

### DOM

```
.c7n-modal-wrap[.wrapClassName]                 # Dialog.tsx:571
  └── .c7n-modal[.c7n-confirm.c7n-confirm-confirm]   # className 挂此节点（Dialog.tsx:314）
        └── .c7n-modal-content                  # Dialog.tsx:317
              ├── .c7n-modal-close > .c7n-modal-close-x      # closable（Dialog.tsx:299-301）
              ├── .c7n-modal-header > .c7n-modal-title       # Dialog.tsx:284-285
              ├── .c7n-modal-body                            # Dialog.tsx:321
              └── .c7n-modal-footer                          # 默认「取消 / 确定」；footer={null} 不渲染（Dialog.tsx:275）

.c7n-modal-mask[.c7n-modal-mask-hidden]         # Dialog.tsx:436-437，遮罩与 wrap 层级 <<待核实>>
body.c7n-modal-open                              # 弹窗打开时 body 追加（modal.less:123）

# Modal.confirm 内容（confirm.tsx:95-101，children 落在 .c7n-modal-body 内 <<待核实>>）
.c7n-confirm-body-wrapper > .c7n-confirm-body
  ├── .c7n-confirm-title
  └── .c7n-confirm-content
.c7n-confirm-btns                                # ActionButton（modal/ActionButton.tsx）
```

### 源码识别

1. JSX：`<Modal visible={…} onOk onCancel footer>`（`modal/index.zh-CN.md` API 表）。
2. 命令式：`Modal.confirm({ title, content, onOk })`（`modal/index.tsx:49-55`；demo：`modal/demo/confirm.md`）。
3. 不是字段，无 `name` / DataSet；业务表单放在弹层 body 内，表单项按其字段类型走对应 playbook。

### 分析产物

```yaml
field_rules:
  - name: deleteConfirm          # 触发弹窗的操作，非 DS 字段
    control: legacy_modal        # legacy_modal | legacy_confirm（旧版前缀，区别于 Pro modal）
```

### 自动化步骤

1. 打开：`click` 触发按钮（业务文案，必要时 `exactText`）。
2. 等待：`waitFor` `legacyModal` 可见，并断言标题文案；`Modal.confirm` 则等 `legacyConfirmModal`。
3. 弹层内填表：`fill` within `legacyModal` 的目标输入框（旧版无 `name` 约定，按 label 收窄 <<待核实>>）；`fillForm` 在弹层内未验证，优先逐项 `fill`。
4. 确定：`click` `legacyModalOk`（confirm 用 `legacyConfirmOk`），再 `waitFor` 弹层消失。需要等接口时用 `clickExpectApi` 绑定确定按钮。
5. 取消 / 关闭：`click` `legacyModalCancel` 或 `legacyModalClose`。

### 建议新增 kit 键

```yaml
legacyModal:
  css: .c7n-modal-wrap > .c7n-modal:not(.c7n-confirm)
  note: 旧版居中弹窗根；与 Pro modal 的 .c7n-pro-modal-* 区分；功能层用标题文案收窄
legacyModalTitle:
  css: .c7n-modal-wrap > .c7n-modal:not(.c7n-confirm) .c7n-modal-title
legacyModalOk:
  css: .c7n-modal-wrap > .c7n-modal:not(.c7n-confirm) .c7n-modal-footer .c7n-btn-primary
  note: 默认 okText「确定」；footer 为自定义时失效
legacyModalCancel:
  css: .c7n-modal-wrap > .c7n-modal:not(.c7n-confirm) .c7n-modal-footer .c7n-btn:not(.c7n-btn-primary)
legacyModalClose:
  css: .c7n-modal-wrap > .c7n-modal .c7n-modal-close
  note: 需 closable 为 true（默认）
legacyConfirmModal:
  css: .c7n-modal.c7n-confirm
  note: Modal.confirm 系列；与 Popconfirm（.c7n-popover）区分
legacyConfirmOk:
  css: .c7n-modal.c7n-confirm .c7n-confirm-btns .c7n-btn-primary
legacyConfirmTitle:
  css: .c7n-modal.c7n-confirm .c7n-confirm-title
```

---

## Popconfirm

基于 Tooltip（`popconfirm/index.tsx:2`）。**前缀借用 `popover`**（`popconfirm/index.tsx:139` `getPrefixCls('popover', prefixCls)`），所以 DOM 是 `c7n-popover-*`，**不是** `c7n-popconfirm-*`。

| 旧版组件 | 区别 |
|----------|------|
| **Popconfirm**（本节） | 气泡内含图标、标题、取消 / 确定两个按钮；`trigger` 默认 `click`（`popconfirm/index.tsx:42`） |
| Popover | 同前缀 `c7n-popover`，但无 `-message` / `-buttons`（见下节） |
| Modal.confirm | 居中弹窗 `c7n-confirm`，不是气泡 |
| Pro 行编辑删除确认 | kit `tableDeletePopover` 已用 `.c7n-popover` 选择器，说明 Pro 表格删除气泡渲染为旧版 DOM <<待核实>>，见 [choerodon-table-row-edit.md](./choerodon-table-row-edit.md) |

### DOM

```
.c7n-popover[.c7n-popover-placement-*][.c7n-popover-hidden]   # rc-trigger 弹层根，挂 body
  └── .c7n-popover-content                                    # rc-components/trigger/PopupInner.jsx:21
        └── .c7n-popover-inner-content                        # popconfirm/index.tsx:111
              ├── .c7n-popover-message                        # :112
              │     ├── Icon（iconType；类名 <<待核实>>）      # :113
              │     └── .c7n-popover-message-title            # title 文案 :114
              └── .c7n-popover-buttons                        # :116
                    ├── button.c7n-btn                        # DOM 第 1 个：取消，onClick=onCancel（:117-119）
                    └── button.c7n-btn.c7n-btn-primary        # DOM 最后：确定，type=okType 默认 primary（:120）
```

### 源码识别

1. JSX：`<Popconfirm title="…" onConfirm onCancel okText cancelText><Button /></Popconfirm>`（`popconfirm/index.zh-CN.md`；demo：`popconfirm/demo/basic.md`）。
2. 无 DataSet；行内删除等场景由业务自行包裹触发元素。
3. 与 Popover 同前缀，唯一区分靠是否存在 `.c7n-popover-buttons`。

### 分析产物

```yaml
field_rules:
  - name: removeLine
    control: legacy_popconfirm   # 区别 Pro 行编辑的 tableRemoveLineBtn + tableDeletePopover
```

### 自动化步骤

1. `click` 触发元素（如行内删除图标，限定到目标行）。
2. `waitFor` `legacyPopconfirm` 可见，`assertVisible` `legacyPopconfirmTitle`（textContains 标题）。
3. 确定：`click` `legacyPopconfirmOk`；取消：`click` `legacyPopconfirmCancel`。
4. 确定后删除接口用 `clickExpectApi` 绑定 `legacyPopconfirmOk`。
5. 气泡挂 body，不在行内 DOM 下；多个气泡并存时需用标题文案收窄 <<待核实：是否残留隐藏节点>>。

### 建议新增 kit 键

```yaml
legacyPopconfirm:
  css: .c7n-popover:has(.c7n-popover-buttons)
  note: 旧版气泡确认；仅 Popconfirm 含 -buttons，区别于 legacyPopover
legacyPopconfirmTitle:
  css: .c7n-popover:has(.c7n-popover-buttons) .c7n-popover-message-title
legacyPopconfirmOk:
  css: .c7n-popover:has(.c7n-popover-buttons) .c7n-popover-buttons .c7n-btn-primary
  note: 与 tableDeleteConfirm 选择器一致；okType 改变时失效
legacyPopconfirmCancel:
  css: .c7n-popover:has(.c7n-popover-buttons) .c7n-popover-buttons button:first-child
```

---

## Popover

前缀 `getPrefixCls('popover')` → `c7n-popover`（`popover/index.tsx:58`），内部把 `title` / `content` 组装为 overlay（`popover/index.tsx:37-47`）后交给 Tooltip 渲染。

| 旧版组件 | 区别 |
|----------|------|
| **Popover**（本节） | `title` + `content`，**无按钮** |
| Popconfirm | 同前缀，有 `-message` / `-buttons`（见上节） |
| Tooltip | 前缀 `c7n-tooltip`，仅文案 |

### DOM

```
.c7n-popover[.c7n-popover-placement-*][.c7n-popover-hidden]   # 挂 body
  └── .c7n-popover-content
        └── div（overlay 根，popover/index.tsx:43）
              ├── .c7n-popover-title                          # title 有值时（:45）
              └── .c7n-popover-inner-content                  # content（:46）
.c7n-popover-arrow                                             # 箭头（popover/style/index.less:123）
```

`.c7n-popover-inner`（`popover/style/index.less:54`）存在，但嵌套位置 <<待核实>>。

### 源码识别

1. JSX：`<Popover title="…" content={…} placement trigger><span /></Popover>`（`popover/index.zh-CN.md`；demo：`popover/demo/basic.md`）。
2. `title` / `content` 可为函数（`popover/index.tsx:40,46`）。
3. 无 `-buttons` 节点即为 Popover，有则为 Popconfirm。

### 分析产物

```yaml
field_rules:
  - name: remarkHint
    control: legacy_popover      # 区别 legacy_popconfirm / legacy_tooltip
```

### 自动化步骤

1. `click` 触发元素（`trigger` 为 click 时）；`trigger` 为 hover 时无对应关键字，用 Playwright 原生 `hover()` 手写步骤。
2. `waitFor` `legacyPopover` 可见，`assertVisible` `legacyPopoverContent`（textContains）。
3. 关闭：点击空白处（click 触发）或移出（hover 触发），再 `waitFor` 弹层隐藏。

### 建议新增 kit 键

```yaml
legacyPopover:
  css: .c7n-popover:not(:has(.c7n-popover-buttons))
  note: 旧版 Popover 根；无按钮区
legacyPopoverTitle:
  css: .c7n-popover .c7n-popover-title
legacyPopoverContent:
  css: .c7n-popover .c7n-popover-inner-content
  note: 与 legacyPopconfirm 同为 inner-content，区别靠 -buttons 是否存在
```

---

## Tooltip

前缀 `getPrefixCls('tooltip')` → `c7n-tooltip`（`tooltip/index.tsx:245`），弹层由 `rc-components/trigger` 渲染（`PopupInner.jsx:21` 为 `-content`）。

| 旧版组件 | 区别 |
|----------|------|
| **Tooltip**（本节） | 单行文案气泡 |
| Pro Tooltip / OverflowTip | `.c7n-pro-tooltip-popup`（kit `tooltipPopup`，见 [choerodon-feedback.md](./choerodon-feedback.md)） |
| Popover | 同 rc-trigger，前缀 `c7n-popover` |

### DOM

```
[触发元素] .c7n-tooltip-open                                      # 可见时追加（tooltip/index.tsx:258）
.c7n-tooltip[.c7n-tooltip-placement-*][.c7n-tooltip-hidden]        # rc-trigger 弹层根，挂 body；hidden 见 PopupInner.jsx:10-11
  └── .c7n-tooltip-content                                         # PopupInner.jsx:21
        └── .c7n-tooltip-inner                                     # 文案容器（tooltip/style/index.less:45）；嵌套 <<待核实>>
.c7n-tooltip-arrow                                                 # tooltip/style/index.less:94
```

### 源码识别

1. JSX：`<Tooltip title="…"><span>…</span></Tooltip>`（`tooltip/index.zh-CN.md`；demo：`tooltip/demo/basic.md`）。
2. `overlay` 为旧版别名，`tooltip/index.tsx:194` 注释说明兼容用途。
3. 无 DataSet；作用于任意子元素，常见于图标提示。

### 分析产物

```yaml
field_rules:
  - name: helpIcon
    control: legacy_tooltip      # 区别 Pro 的 overflow tip（tooltipPopup）
```

### 自动化步骤

1. 触发：在触发元素上 hover（旧版无 hover 关键字，用 Playwright 原生 `hover()`；建议限定到业务元素）。
2. `waitFor` `legacyTooltip` 可见，`assertVisible` `legacyTooltipInner`（textContains 文案）。
3. 移出后 `waitFor` `legacyTooltip` 隐藏（`-hidden` 或 detached）。
4. 页面同时存在多个 tooltip 时用文案收窄，避免误判。

### 建议新增 kit 键

```yaml
legacyTooltip:
  css: .c7n-tooltip:not(.c7n-tooltip-hidden)
  note: 旧版 Tooltip 打开态；与 Pro tooltipPopup 区分
legacyTooltipInner:
  css: .c7n-tooltip:not(.c7n-tooltip-hidden) .c7n-tooltip-inner
  note: 文案容器，断言用 textContains
legacyTooltipTriggerOpen:
  css: .c7n-tooltip-open
  note: 触发元素带此类表示浮层已打开
```

---

## Dropdown

前缀 `getPrefixCls('dropdown')` → `c7n-dropdown`（`dropdown/dropdown.tsx:84`）；`Dropdown` 给子元素追加 `c7n-dropdown-trigger`（`:89`）。按钮形态见 `dropdown/dropdown-button.tsx:59` 的 `c7n-dropdown-button`。

| 旧版组件 | 区别 |
|----------|------|
| **Dropdown**（本节） | 包裹任意单一触发元素，弹层为 `Menu` |
| DropdownButton | 左侧主按钮 + 右侧下拉箭头，外层 `.c7n-dropdown-button` |
| 旧版 Select | 弹层为 `.c7n-select-dropdown`，见 [choerodon-legacy-select.md](./choerodon-legacy-select.md)，勿混用 |
| Pro 行内更多 | 见 [choerodon-row-dropdown.md](./choerodon-row-dropdown.md)，其菜单类名同为 `c7n-dropdown-menu`（是否同一 DOM <<待核实>>） |

### DOM

```
.c7n-dropdown-trigger[.c7n-dropdown-link]                          # 子元素，dropdown.tsx:89；link 见 dropdown/style/index.less:219
.c7n-dropdown[.c7n-dropdown-hidden][.c7n-dropdown-placement-*]      # 弹层根，挂 body（prefixCls=c7n-dropdown，dropdown.tsx:82-86）
  └── .c7n-dropdown-menu[.c7n-dropdown-menu-hidden]                 # Menu 根（dropdown/style/index.less:33）
        ├── li.c7n-dropdown-menu-item[.-selected|-disabled|-divider] # less :56-116；kit dropdownMenuItem 已用此类
        └── .c7n-dropdown-menu-submenu-title                        # 子菜单（less :149）
.c7n-dropdown-button                                                 # DropdownButton 外层（dropdown-button.tsx:59）
```

### 源码识别

1. JSX：`<Dropdown overlay={<Menu>…</Menu>} trigger={['click']}><a /></Dropdown>`（`dropdown/index.zh-CN.md`；demo：`dropdown/demo/basic.md`）。
2. `overlay` 必须是 `Menu`；`mode` 仅支持 vertical（`dropdown.tsx:renderOverlay` 警告）。
3. Menu 在 Dropdown 下默认不可选中，需 `<Menu selectable>`（`dropdown/index.zh-CN.md`）。
4. 无 DataSet。

### 分析产物

```yaml
field_rules:
  - name: rowMore
    control: legacy_dropdown     # 区别 Pro row_dropdown（choerodon-row-dropdown.md）
```

### 自动化步骤

1. `click` `legacyDropdownTrigger`（限定到目标行或表单）；默认 `trigger` 为 `['hover']`（`dropdown/index.zh-CN.md`），若页面未声明 click，改用 Playwright 原生 `hover()`。
2. `waitFor` `legacyDropdownPopup` 可见。
3. `click` `dropdownMenuItem`（复用已有键）hasText 指定文案；`-disabled` 项不可点。
4. 选中后弹层关闭；若菜单项触发接口，用 `clickExpectApi` 绑定。
5. DropdownButton：主按钮与箭头是两个点击区，先确认箭头结构 <<待核实>>。

### 建议新增 kit 键

```yaml
legacyDropdownPopup:
  css: .c7n-dropdown:not(.c7n-dropdown-hidden)
  note: 旧版下拉弹层打开态；菜单项复用 dropdownMenuItem
legacyDropdownTrigger:
  css: .c7n-dropdown-trigger
  note: 被 Dropdown 包裹的元素；多个时 within 行或表单
legacyDropdownButton:
  css: .c7n-dropdown-button
  note: DropdownButton 外层，区别于 Pro 行内更多（rowMoreTrigger）
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 旧版弹层用 `.c7n-pro-*` 选择器 | 旧版前缀为 `c7n-` |
| Popconfirm 找 `.c7n-popconfirm` | 前缀是 `c7n-popover`，用 `-buttons` 区分 |
| 把 Modal.confirm 当 Popconfirm | Modal.confirm 是居中 `.c7n-confirm`，Popconfirm 是 `.c7n-popover` 气泡 |
| Dropdown 直接 click 就展开 | 默认 trigger 是 hover，需要 click 须显式声明 |
| Tooltip 用 `tooltipPopup`（Pro）选择器 | 旧版用 `.c7n-tooltip` |
| 旧版 Modal 用 `.c7n-pro-modal-active` 判断打开 | 旧版用 `.c7n-modal-wrap` 可见 |

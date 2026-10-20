# Choerodon 旧版导航类（Tabs / Menu / Steps / Breadcrumb / Anchor，choerodon-ui 非 Pro）

源码：[components/tabs](https://github.com/open-hand/choerodon-ui/tree/master/components/tabs)、[menu](https://github.com/open-hand/choerodon-ui/tree/master/components/menu)、[steps](https://github.com/open-hand/choerodon-ui/tree/master/components/steps)、[breadcrumb](https://github.com/open-hand/choerodon-ui/tree/master/components/breadcrumb)、[anchor](https://github.com/open-hand/choerodon-ui/tree/master/components/anchor)。  
旧版全局前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`；Pro 前缀为 `c7n-pro-`。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro（`choerodon-ui/pro`） |
|------|--------------|---------------------------|
| JSX 导入路径 | `import { Tabs, Menu, Steps, Breadcrumb, Anchor } from 'choerodon-ui'`（`components/index.tsx:18/34/86/118/132`） | Tabs：`components-pro/tabs/index.tsx` 直接 `import Tabs from 'choerodon-ui/lib/tabs'` 再导出，**同一实现**；Menu / Steps / Breadcrumb / Anchor 本仓库未见同名 Pro playbook |
| 类名前缀 | `c7n-tabs*`、`c7n-menu*`、`c7n-steps*`、`c7n-breadcrumb*`、`c7n-anchor*` | Tabs 仍为 `c7n-tabs`（见 [choerodon-tabs.md](./choerodon-tabs.md)）；其它导航若出现 `c7n-pro-*` 以实际 DOM 为准 |
| 是否绑定 DataSet | 否，`value` / `selectedKeys` / `current` 等受控属性 | 否（导航类不绑定 Field） |

易混组件：行内「更多」下拉用 Dropdown + Menu，见 [choerodon-row-dropdown.md](./choerodon-row-dropdown.md)；页签详细 DOM 与 `Tabs.TabPane` 识别见 [choerodon-tabs.md](./choerodon-tabs.md)，本文只写旧版增量。

---

## Tabs

源码：[components/tabs](https://github.com/open-hand/choerodon-ui/tree/master/components/tabs)

与 [choerodon-tabs.md](./choerodon-tabs.md) 为同一实现，基础 DOM（`.c7n-tabs-bar` / `-tab` / `-tab-active` / `-tabpane`）与 kit 键 `tabsRoot`、`tabsTab`、`tabsTabActive`、`tabPaneActive` 直接复用。

### DOM 增量（源码证实）

```
.c7n-tabs-nav-add                      # type=editable-card 的新增按钮（TabsAddBtn.tsx:27）
.c7n-tabs-more-tab                     # 页签过多时的「更多」触发器（TabBar.tsx:339）
.c7n-tabs-more-dropdown-popup          # 「更多」弹层，挂 body（TabBar.tsx:345）
.c7n-tabs-tab-prev / -tab-next         # 滚动箭头；-tab-btn-disabled 表示到头（TabBar.tsx:612-629）
.c7n-tabs-second-nav / -second-tab     # type=second-level（TabBar.tsx:233,636）
```

### 源码识别

- JSX：`<Tabs type="line|card|editable-card|second-level" tabPosition onChange onEdit>`，`type` 决定样式（`index.zh-CN.md` API 表）。
- `editable-card` 时 `onEdit(targetKey, action)` 处理增删，`hideAdd` 可隐藏加号。

### 分析产物

```yaml
field_rules:
  - name: attachments
    control: legacy_tabs          # 仅在字段位于某 Tab 内时标注；Tabs 本身不是字段
```

### 自动化步骤

1. `within` 目标功能根，`click` `tabsTab` 且 `hasText` 页签文案。
2. 页签过多：`click` `legacyTabsMoreTab` → `waitFor` `legacyTabsMoreDropdownPopup` 可见 → `click` 对应文案。
3. `editable-card` 新增：`click` `legacyTabsNavAdd`，之后由 `onEdit` 业务逻辑决定结果。
4. 切换后 `waitFor` `tabPaneActive` 可见，再 fill / 断言。

### 建议新增 kit 键

```yaml
legacyTabsNavAdd:
  css: .c7n-tabs-nav-add
legacyTabsMoreTab:
  css: .c7n-tabs-more-tab
legacyTabsMoreDropdownPopup:
  css: .c7n-tabs-more-dropdown-popup
legacyTabsTabNext:
  css: .c7n-tabs-tab-next
```

---

## Menu

源码：[components/menu](https://github.com/open-hand/choerodon-ui/tree/master/components/menu)

### DOM

```
.c7n-menu.c7n-menu-root.c7n-menu-{vertical|vertical-right|horizontal|inline}.c7n-menu-{light|dark}[.c7n-menu-inline-collapsed]
  │                                      # index.tsx:253-258；-root 由 rc-components/menu/Menu.jsx:230 追加
  ├── .c7n-menu-item[.c7n-menu-item-selected|-active|-disabled]        # rc MenuItem.jsx:119-141
  ├── .c7n-menu-submenu[.c7n-menu-submenu-open]                        # rc SubMenu.jsx:256-260
  │     ├── .c7n-menu-submenu-title                                    # 标题，点击展开（less）
  │     │     └── .c7n-menu-submenu-arrow                              # 箭头（less）
  │     └── .c7n-menu-sub                                              # 子列表（rc SubPopupMenu.jsx:323）
  └── .c7n-menu-item-group > .c7n-menu-item-group-title               # Menu.ItemGroup（less）

# vertical/horizontal 子菜单弹层：popupClassName = c7n-menu-{light|dark}（SubMenu.tsx:32）
# 弹层最外层 DOM 类 <<待核实>>
```

### 源码识别

- JSX：`<Menu mode theme selectedKeys openKeys onClick onOpenChange>` + `Menu.Item key`（`menu/index.zh-CN.md` API 表；demo `inline.md` 中 `MenuItemGroup` 与 `Menu.Item`）。
- `Menu.SubMenu` 挂载名 <<待核实>>（`menu/SubMenu.tsx` 存在，demo 未直接核对）。
- 不绑定 DataSet。

### 分析产物

```yaml
field_rules:
  - name: menuSection
    control: legacy_menu          # 导航菜单通常不对应字段，仅在需要标注页面入口时使用
```

### 自动化步骤

1. `within` `legacyMenuRoot`（侧栏 / 顶栏按业务收窄，避免多个 Menu 同时命中）。
2. 展开子菜单：`click` `legacyMenuSubmenuTitle` 且 `hasText` 标题；`mode=vertical|horizontal` 的子菜单在弹层中，需等待弹层出现（hover 触发 <<待核实>>）。
3. 选叶子：`click` `legacyMenuItem` 且 `hasText` 文案。
4. 断言：`assertVisible` `legacyMenuItemSelected` 且 `hasText` 文案。
5. 禁用项（`legacyMenuItemDisabled`）不点，改为断言不可点击。

### 建议新增 kit 键

```yaml
legacyMenuRoot:
  css: .c7n-menu-root
legacyMenuItem:
  css: .c7n-menu-item
legacyMenuItemSelected:
  css: .c7n-menu-item-selected
legacyMenuItemDisabled:
  css: .c7n-menu-item-disabled
legacyMenuSubmenuTitle:
  css: .c7n-menu-submenu-title
legacyMenuSubmenuOpen:
  css: .c7n-menu-submenu-open
legacyMenuItemGroupTitle:
  css: .c7n-menu-item-group-title
```

---

## Steps

源码：[components/steps](https://github.com/open-hand/choerodon-ui/tree/master/components/steps)

### DOM

```
.c7n-steps[.c7n-steps-navigation]              # steps/index.tsx:42；type=navigation 见 rc-components/steps
  └── .c7n-steps-item.c7n-steps-item-{wait|process|finish|error}   # rc Step.jsx:36
        ├── .c7n-steps-item-tail                 # 连接线（Step.jsx:51）
        ├── .c7n-steps-item-icon                 # 序号 / 图标（Step.jsx:52）
        └── .c7n-steps-item-content              # Step.jsx:53
              ├── .c7n-steps-item-title          # 标题（Step.jsx:54）
              │     └── .c7n-steps-item-title-icon  # navigation 时的箭头
              └── .c7n-steps-item-description

# 自定义图标：.c7n-steps-item-custom（Step.jsx:37）
# vertical 方向的根类 <<待核实>>（style/vertical.less 为 mixin，未核对最终选择器）
```

### 源码识别

- JSX：`<Steps current direction type="navigation" onChange>` 内为 `<Step title description status icon />`（`steps/index.zh-CN.md` API 表；demo `simple.md` / `navigation.md`）。
- `Step` 挂载名与导入方式 <<待核实>>（demo 直接以 `Step` 书写）。
- `status` 不传时由 `current` 推导；`type=navigation` 仅横向支持。
- 不绑定 DataSet。

### 分析产物

```yaml
field_rules:
  - name: approvalStep
    control: legacy_steps         # 步骤条非输入控件，仅标注当前步骤与可否点击
```

### 自动化步骤

1. 断言当前步：`assertVisible` `legacyStepsItemProcess` 且 `hasText` 步骤标题。
2. 已完成步：`legacyStepsItemFinish`；异常：`legacyStepsItemError`。
3. 点击切换：仅 `type=navigation` 可用，`click` `legacyStepsItem` 且 `hasText` 标题，并 `waitFor` 业务内容变化。非 navigation 步骤条不可点击。
4. 「下一步」「提交」等由业务 Button 完成，不属于步骤条本身。

### 建议新增 kit 键

```yaml
legacyStepsRoot:
  css: .c7n-steps
legacyStepsItem:
  css: .c7n-steps-item
legacyStepsItemProcess:
  css: .c7n-steps-item-process
legacyStepsItemFinish:
  css: .c7n-steps-item-finish
legacyStepsItemError:
  css: .c7n-steps-item-error
legacyStepsItemTitle:
  css: .c7n-steps-item-title
```

---

## Breadcrumb

源码：[components/breadcrumb](https://github.com/open-hand/choerodon-ui/tree/master/components/breadcrumb)

### DOM

```
.c7n-breadcrumb                                 # Breadcrumb.tsx:118
  ├── span                                      # 每个 Breadcrumb.Item 外层（BreadcrumbItem.tsx:138）
  │     ├── a.c7n-breadcrumb-link[href]         # 有 href 为 <a>（BreadcrumbItem.tsx:57-62）
  │     │   或 span.c7n-breadcrumb-link          # 无 href 为 <span>（:66）
  │     └── span.c7n-breadcrumb-separator       # 分隔符；末项隐藏（less: & > span:last-child .separator）
  └── …

# overlay 下拉（BreadcrumbItem.tsx:109-126）
span.c7n-breadcrumb-overlay-link[.c7n-breadcrumb-overlay-border|-overlay-menu]
  └── i.c7n-breadcrumb-overlay-cover[.c7n-breadcrumb-overlay-cover-active]
弹层 overlayClassName = c7n-breadcrumb-overlay-popup（挂 DropDown）
```

### 源码识别

- JSX：`<Breadcrumb separator>` + `<Breadcrumb.Item href overlay={menu}>`（`breadcrumb/index.zh-CN.md`；demo `basic.md` / `overlay.md`）。
- 路由模式：`<Breadcrumb routes params itemRender>`（`router.md`）。
- overlay 内容为 `Menu`（demo `overlay.md` 中 `<Menu>` + `<Menu.Item>`）。
- 不绑定 DataSet。

### 分析产物

```yaml
field_rules:
  - name: breadcrumbPath
    control: legacy_breadcrumb    # 面包屑非字段，仅用于标注页面路径断言
```

### 自动化步骤

1. `within` 页面头部区域，`click` `legacyBreadcrumbLink` 且 `hasText` 上级名称 → 等待路由 / 页面标题变化。
2. 末级为当前页，不一定可点，`assertVisible` 末级 `span` 文案即可（`.c7n-breadcrumb > span:last-child`）。
3. overlay 下拉：`click` `legacyBreadcrumbOverlayLink` 打开，再 `click` 弹层内 `Menu.Item` 文案（打开方式 hover / click <<待核实>>）。
4. 分隔符断言：`assertVisible` `legacyBreadcrumbSeparator`（仅非末项可见）。

### 建议新增 kit 键

```yaml
legacyBreadcrumbRoot:
  css: .c7n-breadcrumb
legacyBreadcrumbLink:
  css: .c7n-breadcrumb-link
legacyBreadcrumbSeparator:
  css: .c7n-breadcrumb-separator
legacyBreadcrumbOverlayLink:
  css: .c7n-breadcrumb-overlay-link
```

---

## Anchor

源码：[components/anchor](https://github.com/open-hand/choerodon-ui/tree/master/components/anchor)

### DOM

```
div.c7n-anchor-wrapper                           # Anchor.tsx:290（可带 className / maxHeight）
  └── div.c7n-anchor[.fixed]                      # Anchor.tsx:292-294；fixed = 非 affix 且非 showInkInFixed
        ├── div.c7n-anchor-ink
        │     └── span.c7n-anchor-ink-ball[.visible]   # Anchor.tsx:286-287
        └── div.c7n-anchor-link[.c7n-anchor-link-active]   # AnchorLink.tsx:70-71
              ├── a.c7n-anchor-link-title[.c7n-anchor-link-title-active][href]   # AnchorLink.tsx:73-86
              └── div.c7n-anchor-link                       # 子锚点嵌套
```

### 源码识别

- JSX：`<Anchor offsetTop bounds getContainer targetOffset onClick>` 内为锚点项（`anchor/index.zh-CN.md` API 表；demo `basic.md`、`targetOffset.md`）。
- 锚点项子组件 `AnchorLink`（`anchor/AnchorLink.tsx`）；业务 JSX 挂载名 `Anchor.Link` <<待核实>>。
- `href` 为页面内 `#id`，目标需存在于页面 DOM。
- 不绑定 DataSet。

### 分析产物

```yaml
field_rules:
  - name: sectionAnchor
    control: legacy_anchor        # 锚点非字段，仅标注页面分区导航
```

### 自动化步骤

1. `within` `legacyAnchorWrapper`，`click` `legacyAnchorLinkTitle` 且 `hasText` 标题。
2. 等待滚动结束后，`assertVisible` `legacyAnchorLinkTitleActive` 且 `hasText` 标题（高亮依据滚动位置）。
3. 目标分区用其 `id` 断言可见，例如 `assertVisible` 目标区域根元素。
4. 若设置了 `getContainer`，滚动容器需 `within` 该容器；否则以 `window` 为准。

### 建议新增 kit 键

```yaml
legacyAnchorWrapper:
  css: .c7n-anchor-wrapper
legacyAnchorLink:
  css: .c7n-anchor-link
legacyAnchorLinkTitle:
  css: a.c7n-anchor-link-title
legacyAnchorLinkTitleActive:
  css: .c7n-anchor-link-title-active
legacyAnchorInkBall:
  css: .c7n-anchor-ink-ball.visible
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 旧版 Tabs 用 `.c7n-pro-tabs` | 旧版为 `.c7n-tabs`（与 Pro 入口同实现） |
| 把 Menu 当 Pro 下拉 Select 操作 | 旧版 Menu 为 `.c7n-menu-*` 列表，无 `pickSelect` 语义 |
| Steps 点击「下一步」就期望步骤条自动前进 | 步骤条本身不含按钮；前进由业务 Button 与 `current` 控制 |
| Breadcrumb 末项当链接点 | 末项常无 `href`，是 `span.c7n-breadcrumb-link` 或纯文本 |
| Anchor 点击后立即断言高亮 | 需等待滚动动画结束后再断言 |

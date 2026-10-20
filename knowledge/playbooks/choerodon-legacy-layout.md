# Choerodon 旧版布局 / 栅格 / 卡片 / 折叠面板 / 分割线

旧版（非 Pro，`choerodon-ui` 的 `lib`）组件，前缀 **`c7n`**（`components/configure/default.tsx:96` 的 `prefixCls: c7n`）。`getPrefixCls(suffixCls)` 拼成 `c7n-<suffix>`。Pro 版前缀为 `c7n-pro-`，见 [choerodon-form.md](./choerodon-form.md)。

涵盖：Layout（layout/Sider）、Row / Col（grid）、Card、Collapse、Divider。本册均为**纯展示 / 容器**，无 DataSet 绑定，自动化以定位与可见性断言为主。

## 旧版 vs Pro 区分（Row / Col）

Pro 侧 Row / Col 在 [choerodon-form.md](./choerodon-form.md)（`layout="none"` 时常配 Row / Col）。Layout / Card / Collapse / Divider 无同名 Pro playbook，本表只列栅格。

| 维度 | 旧版（本册） | Pro（choerodon-form.md） |
|------|--------------|--------------------------|
| JSX 导入 | `import { Row, Col } from 'choerodon-ui'`（`components/grid/demo` 证实） | <<待核实:Pro 是否从 `choerodon-ui/pro` 导出 Row/Col>> |
| 类名前缀 | `c7n-row` / `c7n-col`（`grid/row.tsx:42`、`grid/col.tsx:41`） | 同为 `c7n-row` / `c7n-col`（Form 文档称「基础栅格，前缀 c7n」） |
| 是否绑定 DataSet | 否 | 否（DataSet 绑在 Form / Table 上，不绑 Row/Col） |

结论：栅格 DOM 与 Pro 共用，区分靠**外层容器**（旧版页面 vs `c7n-pro-form`）。断言前用 `within` 收窄到业务容器。

---

## 1. Layout（布局容器）

源码：[components/layout](https://github.com/open-hand/choerodon-ui/tree/master/components/layout)

### DOM

```
div.c7n-layout[.c7n-layout-has-sider]          # Layout；有 Sider 时带 has-sider（layout.tsx:92-93）
  ├── div.c7n-layout-header                     # Layout.Header（suffix layout-header）
  ├── div.c7n-layout-sider[.-collapsed][.-has-trigger][.-zero-width][.-below][.-<theme>]   # Sider（Sider.tsx:246-250）
  │     ├── div.c7n-layout-sider-children       # 业务内容（Sider.tsx:255）
  │     ├── div.c7n-layout-sider-trigger        # 底部收放按钮（collapsible 时）
  │     └── span.c7n-layout-sider-zero-width-trigger   # 零宽度时的触发器
  ├── div.c7n-layout-content                    # Layout.Content
  └── div.c7n-layout-footer                     # Layout.Footer
```

- `Layout` / `Header` / `Content` / `Footer` 经 `generator`（`layout.tsx:111-126`）渲染为 `div`。
- Sider 根标签：`<<待核实:Sider 根元素是 div 还是 aside>>`（`Sider.tsx:246` 后未核对标签）。
- `-<theme>` 的默认取值 `<<待核实:Sider theme 默认值>>`。

### 源码识别

1. `import { Layout } from 'choerodon-ui'`；子组件 `Layout.Header` / `Layout.Sider` / `Layout.Content` / `Layout.Footer`（`layout/index.tsx`）。
2. Sider 带 `collapsible` / `collapsed` / `trigger` / `zeroWidthTrigger` 属性时，会出现收放按钮。
3. 页面骨架型布局通常 `Layout` 直接包 `Sider` + `Content`，因此根上有 `c7n-layout-has-sider`。

### 分析产物

```yaml
layout_rules:
  - name: pageShell
    control: legacy_layout        # 区别 Pro 表单 / 表格容器
    has_sider: true
    sider_collapsible: true
```

### 自动化步骤

1. 进入页面后等待骨架出现：`assertVisible` 根 `legacyLayoutRoot`（可 `within` 业务容器）。
2. 侧栏收放：`click` `legacyLayoutSiderTrigger`；收起后断言 `.c7n-layout-sider-collapsed` 存在（`assertVisible` 目标 `legacyLayoutSiderCollapsed`）。
3. 零宽触发器：`click` `legacyLayoutSiderZeroTrigger`。

```yaml
- action: assertVisible
  args: { target: legacyLayoutSider }
- action: click
  args: { target: legacyLayoutSiderTrigger }
- action: assertVisible
  args: { target: legacyLayoutSiderCollapsed }
```

侧栏菜单项不属于 Layout 本身，按对应菜单组件处理（不在本册范围）。

### 建议 kit 键

见文件末 `kit-choerodon-legacy-layout.yaml`：`legacyLayoutRoot`、`legacyLayoutSider`、`legacyLayoutSiderTrigger`、`legacyLayoutSiderZeroTrigger`、`legacyLayoutSiderCollapsed`、`legacyLayoutContent`、`legacyLayoutHeader`、`legacyLayoutFooter`。

---

## 2. Row / Col（栅格）

源码：[components/row](https://github.com/open-hand/choerodon-ui/tree/master/components/row)、[components/col](https://github.com/open-hand/choerodon-ui/tree/master/components/col)（实际实现在 `components/grid/row.tsx`、`grid/col.tsx`，`row/index.tsx`、`col/index.tsx` 为转发）。

### DOM

```
div.c7n-row[.c7n-row-flex][.c7n-row-flex-<justify>][.c7n-row-flex-<align>]   # grid/row.tsx:42-48
  └── div.c7n-col[.c7n-col-<span>][.c7n-col-<size>-<span>][.c7n-col-offset-<n>][.c7n-col-order-<n>]  # grid/col.tsx:55-67
```

- `type="flex"` 时 Row 增加 `c7n-row-flex`，`justify` / `align` 追加到 `c7n-row-flex-<值>`。
- Col 的 `span` 无 size 时为 `c7n-col-<span>`；`xs/sm/md/lg/xl` 时为 `c7n-col-<size>-<span>`（`grid/col.tsx:55`）。
- `push` / `pull` / `offset` 同样有 `-<size>-` 变体（`grid/col.tsx:57-60`），less 中为 `.c7n-col<size>-push-N` 形式（`grid/style/mixin.less:62-66`）。

### 源码识别

1. `import { Row, Col } from 'choerodon-ui'`。
2. 没有 DataSet / 没有交互，只能靠类名 `c7n-row` / `c7n-col` 识别；**同名类也出现在旧版 Form 的 label/control 列**（`choerodon-legacy-form-button.md` 中的 `c7n-col.c7n-form-item-label`），定位时必须限定容器（如 `.c7n-form-item`）。

### 分析产物

```yaml
layout_rules:
  - name: formGrid
    control: legacy_row         # Row；Col 子项用 legacy_col
    flex: true
```

### 自动化步骤

栅格无交互，只做定位与可见性断言：

1. 业务容器内断言：`within` 表单/卡片根，`assertVisible` `rowRoot`（已有 `c7n-row`）。
2. 按列定位字段：`:has(input[name=字段])` 唯一化 `colRoot`（已有键）。
3. 列宽 / 换行：无专用关键字，需用 `getBoundingClientRect` 比较，`<<待核实:是否有 assertBox 类关键字>>`；无则不写列宽断言。

```yaml
- action: assertVisible
  args: { target: rowRoot }
- action: assertVisible
  args: { target: colRoot }
```

### 建议 kit 键

`rowRoot`、`rowFlex`、`colRoot` 在 `platform/choerodon/kit.yaml`（~886-895）中已存在，**本册不重复新增**，直接复用（它们的 css 即旧版 `.c7n-row` / `.c7n-col`）。

---

## 3. Card（卡片）

源码：[components/card](https://github.com/open-hand/choerodon-ui/tree/master/components/card)

### DOM

```
div.c7n-card[.c7n-card-bordered][.c7n-card-hoverable][.c7n-card-loading][.c7n-card-only-title|-only-body][.c7n-card-type-inner][.c7n-card-contain-tabs][.c7n-card-contain-grid]  # card/index.tsx:206-217
  ├── div.c7n-card-head                         # 有 title / extra 或 tabList
  │     ├── div.c7n-card-head-wrapper
  │     │     ├── div.c7n-card-head-title       # title
  │     │     └── div.c7n-card-extra            # extra（右上角）
  │     └── .c7n-card-head-tabs                 # tabList 时包裹 Tabs（card/index.tsx:256）
  ├── div.c7n-card-cover                        # cover
  ├── div.c7n-card-body                         # 内容
  └── ul.c7n-card-actions > li                  # actions
```

- 选中态根上 `c7n-card-selected c7n-card-selected-<cornerPlacement> c7n-card-selected-<size>`（`card/index.tsx:215`）。
- `Card.Grid`：`div.c7n-card-grid`，选中 `c7n-card-grid-selected`（`card/Grid.tsx:27`）。
- `Card.Meta`：`div.c7n-card-meta` > `-avatar` / `-detail` > `-title` / `-description`（`card/Meta.tsx:18-24`）。
- Loading 骨架：`.c7n-card-loading-content` > `.c7n-card-loading-block`（`card/index.tsx:221-238`）。
- 页签 Tabs 的导航类名 `<<待核实:Card tabList 内部 Tabs 的导航类名（旧版 c7n-tabs-*）>>`。

### 源码识别

1. `import { Card } from 'choerodon-ui'`；`Card.Grid` / `Card.Meta` 为子组件。
2. 有 `title` / `extra` 时必有 `c7n-card-head`；无 `title` 时为 `c7n-card-only-body`。
3. 不绑 DataSet，不做表单控件映射。

### 分析产物

```yaml
layout_rules:
  - name: overviewCard
    control: legacy_card
    selectable: false
```

### 自动化步骤

1. 定位卡片：按标题文案过滤，`.c7n-card:has(.c7n-card-head-title:has-text("标题"))`，文案由业务数据决定（不要写死）。
2. 卡片内断言：`assertVisible` `legacyCardBody`（限定在卡片内）。
3. 点击卡片头额外操作：`click` 卡片内 `legacyCardExtra` 下的按钮。
4. 选中卡片（`selected` 态 / Card.Grid）：`click` 卡片内容区域，再 `assertVisible` `legacyCardSelected`（`onSelectChange` 触发点击内容区）。
5. 等待加载完成：`waitFor` 无 `legacyCardLoading`（`.c7n-card-loading-content` 消失）。

```yaml
- action: click
  args: { target: legacyCardExtra }     # within 卡片
- action: waitFor
  args: { hidden: legacyCardLoading }
```

### 建议 kit 键

见 `kit-choerodon-legacy-layout.yaml`：`legacyCardRoot`、`legacyCardHead`、`legacyCardHeadTitle`、`legacyCardExtra`、`legacyCardBody`、`legacyCardCover`、`legacyCardActions`、`legacyCardGrid`、`legacyCardMeta`、`legacyCardLoading`、`legacyCardSelected`、`legacyCardGridSelected`。

---

## 4. Collapse（折叠面板）

源码：[components/collapse](https://github.com/open-hand/choerodon-ui/tree/master/components/collapse)。底层为 `rc-collapse`（`Collapse.tsx` 以 `RcCollapse` 渲染）。

### DOM

```
div.c7n-collapse[.c7n-collapse-borderless][.c7n-collapse-ghost][.c7n-collapse-trigger][.c7n-collapse-icon-position-left|right|text-right][.c7n-collapse-text-action]   # Collapse.tsx:134-140
  └── 面板（rc-collapse 渲染）
        ├── 面板头 .c7n-collapse-header                  # <<待核实:rc-collapse 运行时类名，本仓库无 node_modules>>
        │     ├── span.c7n-collapse-expand-icon[.c7n-collapse-expanded|-collapsed]   # Collapse.tsx:75-77
        │     └── span.c7n-collapse-expand-text          # expandIcon="text" 时（Collapse.tsx:85-86）
        └── .c7n-collapse-content                        # 面板体，可隐藏
```

- `CollapsePanel` 无箭头时根带 `c7n-collapse-no-arrow`（`CollapsePanel.tsx:29`）。
- 面板节点类名（`c7n-collapse-item` / `-item-active`）由 `less` 推断（`collapse/style/index.less:142` 的 `&-item`），运行时类名 `<<待核实:rc-collapse 的 item / item-active>>`。

### 源码识别

1. `import { Collapse } from 'choerodon-ui'`，`Collapse.Panel` 为面板（demo `collapse/demo/basic.md`）。
2. Panel 上的 `dataSet` 属性：数据集校验失败时自动展开（`collapse/index.zh-CN.md`），这是旧版与 Pro 最大差异。
3. `accordion` 为手风琴，只允许单个展开。

### 分析产物

```yaml
layout_rules:
  - name: detailPanel
    control: legacy_collapse
    accordion: false
    expand_icon: left
```

### 自动化步骤

1. 展开面板：`click` 目标面板头（用 `has-text` 过滤标题，标题由业务数据决定）。
2. 断言内容可见：`assertVisible` 内容区（`legacyCollapseContent`，限定在该面板）。
3. 收起：再次 `click` 同一面板头。
4. 带 `dataSet` 的面板校验失败会自动展开，不需要手动点击；断言面板 `legacyCollapseExpandIcon.c7n-collapse-expanded` 即可。

```yaml
- action: click
  args: { target: legacyCollapseHeader }      # within 目标面板
- action: assertVisible
  args: { target: legacyCollapseContent }
```

### 建议 kit 键

`legacyCollapseRoot`、`legacyCollapseHeader`、`legacyCollapseContent`、`legacyCollapseExpandIcon`、`legacyCollapseExpandText`、`legacyCollapseNoArrow`（详见 yaml）。

---

## 5. Divider（分割线）

源码：[components/divider](https://github.com/open-hand/choerodon-ui/tree/master/components/divider)

### DOM

```
div.c7n-divider.c7n-divider-horizontal|c7n-divider-vertical
      [.c7n-divider-with-text|-with-text-left|-with-text-right][.c7n-divider-dashed]   # divider/index.tsx:27-29
  └── span.c7n-divider-inner-text                  # 有 children 时（divider/index.tsx:33）
```

- `orientation` 为 `left` / `right` 时为 `-with-text-left` / `-with-text-right`，默认（空）为 `-with-text`。
- `type="vertical"` 用于行内分隔（如表格操作列）。

### 源码识别

1. `import { Divider } from 'choerodon-ui'`（demo `divider/demo/horizontal.md` 证实）。
2. 无 DataSet、无交互，只做展示。
3. 行内分隔时位于 `td` / `span` 之间，`type="vertical"`。

### 分析产物

```yaml
layout_rules:
  - name: sectionSplit
    control: legacy_divider
    orientation: none       # none | left | right | vertical
```

### 自动化步骤

分割线本身不可交互，只做存在与文案断言：

1. 章节断言：`assertVisible` `legacyDividerInnerText`（文案用 `has-text` 过滤）。
2. 竖分割线：`assertVisible` `legacyDividerVertical`。

```yaml
- action: assertVisible
  args: { target: legacyDividerWithText }
```

### 建议 kit 键

`legacyDividerRoot`、`legacyDividerHorizontal`、`legacyDividerVertical`、`legacyDividerWithText`、`legacyDividerInnerText`、`legacyDividerDashed`（详见 yaml）。

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 用 `c7n-pro-card` / `c7n-pro-collapse` 定位旧版 | 旧版前缀为 `c7n-card` / `c7n-collapse` |
| Row/Col 与 Form label 列混淆 | 限定 `.c7n-form-item` 或业务容器后再用 `c7n-col` |
| Collapse 面板用 `pickSelect` / `pickLov` | 面板是展开收起，用 `click` 面板头 |
| Card Grid 的选中当作 Card 本身 | 选中类分别为 `c7n-card-selected` 与 `c7n-card-grid-selected` |
| 把 `expandIcon="text"` 文案写死 | 文案随语言变化（`Collapse.tsx:85`），用 `c7n-collapse-expand-text` 定位 |

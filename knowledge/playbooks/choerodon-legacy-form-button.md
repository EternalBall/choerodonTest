# Choerodon 旧版表单 / 按钮 / 图标选择（choerodon-ui/lib）

旧版（非 Pro）覆盖 Form、Button、IconSelect、Icon。全局类名前缀 `c7n`（`components/configure/default.tsx:96` 的 `prefixCls: 'c7n'`），组件经 `getPrefixCls(suffix)` 拼成 `c7n-<suffix>`。建议新增的定位键汇总于 `kit-choerodon-legacy-form-button.yaml`（待合并进 `kit.yaml`）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本册） | Pro（[choerodon-form.md](./choerodon-form.md)、[choerodon-picker-misc.md](./choerodon-picker-misc.md)、[choerodon-select.md](./choerodon-select.md)） |
|------|--------------|------|
| JSX 导入路径 | `choerodon-ui`（如 `import { Form, Button, Icon } from 'choerodon-ui'`） | `choerodon-ui/pro` |
| 类名前缀 | `c7n-form` / `c7n-btn` / `c7n-icon-select` / `c7nicon` | `c7n-pro-form` / `c7n-pro-btn` / `c7n-pro-*` |
| 是否绑定 DataSet | 否，字段用 `getFieldDecorator` 注册 | 是，Form 绑定 `dataSet`，字段 `name` 即 DataSet 字段 |
| 按钮颜色 / 类型 | `type="primary"` 等 | `color="primary"` |
| 按钮默认 funcType | 文档默认 `flat`（`button/index.zh-CN.md`） | `raised`（`configure/default.js:169`） |
| 图标选择 | `<IconSelect>`（Select 形态） | Pro `IconPicker`（面板形态，见 picker-misc） |

## Form

源码：[components/form](https://github.com/open-hand/choerodon-ui/tree/master/components/form)

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **旧版 Form** | `<Form>`，`getFieldDecorator` / `Form.create()` | 默认 `layout=horizontal` |
| **Form.Item** | `<Form.Item label>` | 标签 + 控件单元，生成 `c7n-form-item-*` |
| **Pro Form** | `c7n-pro-form`，`dataSet` | 见 [choerodon-form.md](./choerodon-form.md)，勿混用 |

### DOM

```
form.c7n-form[.c7n-form-horizontal|.c7n-form-vertical|.c7n-form-inline][.c7n-form-hide-required-mark]
  └── div.c7n-form-item[.c7n-form-item-with-help][.c7n-form-item-no-colon]
        ├── div.c7n-col.c7n-form-item-label                       # labelCol；horizontal 时
        │     └── label[for=控件id][.c7n-form-item-required]
        └── div.c7n-col.c7n-form-item-control-wrapper              # wrapperCol；horizontal 时
              └── div.c7n-form-item-control[.has-error|.has-success|.has-warning|.is-validating][.c7n-form-item-required]
                    ├── span.c7n-form-item-children               # 控件本体
                    ├── div.c7n-form-item-explain                # help / 校验文案
                    └── div.c7n-form-item-extra                  # extra
```

推导依据：`getPrefixCls('form')`（`form/Form.tsx:188`）→ `c7n-form`；`layout` / `hideRequiredMark` 修饰类见 `Form.tsx:189-194`；FormItem 同样用 `getPrefixCls('form')`（`form/FormItem.tsx:141`），子类名见 `FormItem.tsx:208-247`（control / wrapper / children）、`:304-321`（label）、`:156` 与 `:179`（explain / extra）。`c7n-col` 为 Col 的前缀 <<待核实:Col 默认类名>>。

### 源码识别

1. `import { Form } from 'choerodon-ui'`；`this.props.form.getFieldDecorator('字段名', { rules })` 包住控件，字段名只存在于业务代码，不是 DOM `name`。
2. `layout`（horizontal / vertical / inline）决定根的修饰类。
3. 必填：`rules` 含 `required: true` 或 Form.Item 的 `required` 时 label 带 `.c7n-form-item-required`。

### 分析产物

```yaml
field_rules:
  - name: username
    control: input         # 旧版无 DataSet；默认 css 回落为 input.c7n-pro-input（platformKit.ts:159），需功能层给出 css
form_layout:               # 假设：容器元信息字段名，待分析器确认
  layout: horizontal
```

### 自动化步骤

1. 根：`legacyFormRoot`；多个表单时用功能层 css 收窄。
2. 单字段：`.c7n-form-item` 按 label 文案唯一化，再填控件。
   ```yaml
   - action: fill
     args:
       target: legacyFormItemInput
       value: "<样本值>"
   ```
   多字段时功能层补充 css：`.c7n-form-item:has(label:text-is("用户名")) .c7n-form-item-control input`。
3. 批量 `fillForm` 依赖 `input[name]`；旧版控件 `name` 是否写入 DOM <<待核实>>，未确认前逐字段 `fill`。
4. 校验文案：`assertVisible` 目标 `legacyFormExplain`（需 within 对应字段，避免多匹配）。
5. 提交按钮走 Button 节（`click` role=button, name=…）。

### kit 建议

```yaml
legacyFormRoot:
  css: form.c7n-form
  note: 旧版表单根；多表单 within 收窄；勿与 Pro 的 c7n-pro-form 混用
legacyFormItem:
  css: .c7n-form-item
legacyFormItemLabel:
  css: .c7n-form-item-label label
legacyFormItemRequired:
  css: .c7n-form-item-required
legacyFormItemInput:
  css: .c7n-form-item-control input
  note: 多字段需功能层 :has(label:text-is("…")) 唯一化
legacyFormExplain:
  css: .c7n-form-item-explain
```

## Button

源码：[components/button](https://github.com/open-hand/choerodon-ui/tree/master/components/button)

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **旧版 Button** | `<Button>`，根 `.c7n-btn` | 页头 / 表单操作按钮 |
| **Button.Group** | `<Button.Group>`，`.c7n-btn-group` | 子元素仍是 `.c7n-btn` |
| **Popconfirm 内按钮** | `.c7n-popover .c7n-btn`（kit `tableDeleteConfirm`） | 与页面按钮同为 `c7n-btn`，需限定范围 |
| **Pro Button** | `c7n-pro-btn` | 见 [choerodon-form.md](./choerodon-form.md) |

### DOM

```
button.c7n-btn[.c7n-btn-primary|.c7n-btn-dashed|.c7n-btn-danger]     # type
              [.c7n-btn-circle]                                       # shape
              [.c7n-btn-lg|.c7n-btn-sm]                               # size
              [.c7n-btn-icon-only][.c7n-btn-loading][.c7n-btn-background-ghost]
              [.c7n-btn-two-chinese-chars][.c7n-btn-raised|.c7n-btn-flat]   # funcType
  ├── （loading）进度元素 <<待核实:loading 进度类名>>
  ├── i.icon.icon-<type>                                              # icon 属性
  └── span（children 文字；两个汉字自动插空格）

a.c7n-btn                                  # 设置 href 时根为 a
span.c7n-btn.c7n-btn-disabled-wrapper > button    # disabled 且绑定 onMouseEnter/Leave 时；类名在外层 span 上
div.c7n-btn-group[.c7n-btn-group-lg|.c7n-btn-group-sm]
```

推导依据：`getPrefixCls('btn')`（`button/Button.tsx:257`）；`lg` / `sm` 映射见 `Button.tsx:267-274`；修饰类见 `Button.tsx:280-289`；disabled 包裹见 `Button.tsx:326`；`ButtonGroup` 用 `getPrefixCls('btn-group')`（`ButtonGroup.tsx:17`）与 size 类（`:35`）；icon 默认渲染为 `<Icon type>`（`Button.tsx:54-56`），前缀 `iconfontPrefix: 'icon'`（`configure/default.tsx:98`）。

### 源码识别

1. `import { Button } from 'choerodon-ui'`；属性 `type` / `shape` / `size` / `loading` / `icon` / `href` / `funcType`。
2. `loading` 为真时 `onClick` 被置空（`Button.tsx`：`onClick={loading ? undefined : …}`），点击无效。
3. `href` 存在时渲染为 `a`，应使用 `role: link` 定位。

### 分析产物

```yaml
# Button 非字段控件，不进入 field_rules
actions:                   # 假设：按钮动作字段名，待分析器确认
  - name: save
    control: button
    type: primary
```

### 自动化步骤

1. 文案唯一时：`click`，`args: { role: button, name: 保存 }`。
2. 多按钮时：`click`，`args: { target: legacyButtonPrimary, hasText: 保存, first: true }`。
3. 等待 loading 结束：`waitFor`，`hidden: legacyButtonLoading`（多按钮需限定范围）。
4. 断言禁用：`assertVisible` 目标 `legacyButtonDisabled`（或外层 `legacyButtonRoot.c7n-btn-disabled-wrapper`）。
5. 旧版无专用关键字，不要使用 Pro 的 `pickSelect` 等操作旧版 Popup。

### kit 建议

```yaml
legacyButtonRoot:
  css: .c7n-btn
  note: 旧版按钮根（button 或 a）；多按钮用 role+name 或 hasText
legacyButtonPrimary:
  css: .c7n-btn-primary
legacyButtonLoading:
  css: .c7n-btn-loading
legacyButtonDisabled:
  css: .c7n-btn[disabled]
legacyButtonGroup:
  css: .c7n-btn-group
```

## IconSelect

源码：[components/icon-select](https://github.com/open-hand/choerodon-ui/tree/master/components/icon-select)

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **IconSelect** | `<IconSelect>`，前缀 `icon-select` | 下拉选图标名（字符串值） |
| **Icon** | `<Icon type>` | 只展示，不交互（见下文 Icon 节） |
| **Pro IconPicker** | Pro 面板形态 | 见 [choerodon-picker-misc.md](./choerodon-picker-misc.md)，kit `iconPicker*` |
| **Pro Select** | `c7n-pro-select-popup` | `pickSelect` 只适用于 Pro，不能用于 IconSelect |

### DOM

```
.c7n-icon-select                                 # className 与 prefixCls 合并到 Select 根（IconSelect.tsx:157）
  ├── .c7n-select-selection                      # 触发器 <<待核实:rc-select 生成>>
  │     └── span > i.icon.icon-<name> + 文本      # choiceRender（IconSelect.tsx handleRender）
  └── （showArrow 默认 false，默认无箭头）

.c7n-icon-select-dropdown                        # dropdownClassName 合并（IconSelect.tsx:158-159）
  ├── .c7n-select-dropdown-filter > input        # filter=true <<待核实>>
  ├── ul.c7n-select-dropdown-menu > li            # Option
  │     └── Tooltip > i.icon.icon-<name> + span.text（文字即图标名）
  └── .c7n-select-dropdown-footer > .c7n-pagination    # 每页 20/40/80
```

推导依据：`getPrefixCls('icon-select')`（`IconSelect.tsx:156`）；`icon-select/style/index.less:7-9` 定义 `.c7n-icon-select` 与 `-dropdown`；`.text`、`i.icon` 结构见 `renderOption`；`-dropdown-menu` / `-dropdown-filter` / `-dropdown-footer` 仅由 `icon-select/style/index.less` 引用，实际 DOM 由 rc-select 依赖生成，<<待核实>>。

### 源码识别

1. `import { IconSelect } from 'choerodon-ui'`，常与 `getFieldDecorator` 搭配，业务值为图标 type 字符串。
2. `showAll` 为 `true` 时数据源是全量 `icons.default`，否则是 `icons.favorite`（默认 false）。
3. 图标数据来自 `choerodon-ui-font`（`IconSelect.tsx:4`），业务代码中不会出现列表。

### 分析产物

```yaml
field_rules:
  - name: icon
    control: icon_select   # 旧版无 DataSet；需功能层 css（默认回落为 input.c7n-pro-input）
```

### 自动化步骤

1. 打开下拉：`click`，目标 `legacyIconSelectTrigger`。
2. 搜索（选项多时）：`fill`，目标 `legacyIconSelectFilter`，`value: "<关键词>"`。
3. 选第一项：`click`，目标 `legacyIconSelectOption`，`first: true`。
4. 指定图标：`click`，目标 `legacyIconSelectOption`，`hasText: "<图标名>"`。
5. 翻页：`click` `.c7n-icon-select-dropdown .c7n-pagination-next` <<待核实>>。
6. 断言已选：`assertVisible` 目标 `legacyIconSelectValue`。
7. 下拉挂 body，断言前用 `legacyIconSelectDropdown` 限定范围。

### kit 建议

```yaml
legacyIconSelectRoot:
  css: .c7n-icon-select
legacyIconSelectTrigger:
  css: .c7n-icon-select .c7n-select-selection
  note: 触发器 <<待核实>>
legacyIconSelectDropdown:
  css: .c7n-icon-select-dropdown
legacyIconSelectOption:
  css: .c7n-icon-select-dropdown .c7n-select-dropdown-menu li
legacyIconSelectFilter:
  css: .c7n-icon-select-dropdown .c7n-select-dropdown-filter input
legacyIconSelectPagination:
  css: .c7n-icon-select-dropdown .c7n-select-dropdown-footer .c7n-pagination
legacyIconSelectValue:
  css: .c7n-icon-select .c7n-select-selection-selected-value i.icon
```

## Icon

源码：[components/icon](https://github.com/open-hand/choerodon-ui/tree/master/components/icon)

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **字体 Icon（默认）** | `<Icon type="…">` | 渲染 `<i class="icon icon-<type>">` |
| **SVG Icon** | 传 `scriptUrl`，或 `Icon.createFromIconfontCN` | 渲染 `span.c7nicon[role=img]` + svg |
| **Button 内 icon** | `<Button icon="…">` | 同样是 `i.icon`，定位需限定在按钮内 |

### DOM

```
# 字体图标（默认）
i.icon[.<customFontName>].icon-<type>[.自定义 className]

# 传 scriptUrl 时（SVG）
span.c7nicon[role="img"][tabindex=-1 当有 onClick]
  └── svg.c7nicon-spin?（spin 时）
        └── use[xlink:href="#<type>"]
```

推导依据：`icon/index.tsx:28` 的 `classNames(iconfontPrefix, customFontName, \`${iconfontPrefix}-${type}\`, className)`，`iconfontPrefix` 默认 `icon`（`configure/default.tsx:98`）；SVG 分支见 `icon/index.tsx` 的 `scriptUrl` 判断与 `icon/Icon.tsx` 的 `c7nicon` / `c7nicon-spin`（`classNames('c7nicon', …)`、`svgClassString`）；`use` 见 `icon/IconFont.tsx` 的 `<use xlinkHref={`#${type}`} />`。

### 源码识别

1. `import { Icon } from 'choerodon-ui'`；`type` 为字体图标名，文档示例如 `add_location`（`icon/index.zh-CN.md`）。
2. 样式通过 `style` / `className` 设置，如 `fontSize`、`color`（文档约定）。
3. 带 `onClick` 的 SVG 图标会被设置 `tabindex=-1`，可点击但不可 Tab。

### 分析产物

```yaml
field_rules: []           # 展示元素，不进入 field_rules
icon_refs:                # 假设：功能层记录页面引用的图标类型，待分析器确认
  - type: "<图标名>"
```

### 自动化步骤

1. 断言图标存在：`assertVisible`，目标 `legacyIconFont`，需限定在容器内；指定 type 时功能层补 css `i.icon.icon-<type>`。
2. 点击图标（需带 onClick）：`click`，目标 `legacyIconFont`，同样限定容器。
3. SVG 形态：`assertVisible` 目标 `legacyIconSvg`。
4. 图标无文本，不做文案断言；不要用 `.icon` 全局匹配（会与 Button 内图标冲突）。

### kit 建议

```yaml
legacyIconFont:
  css: i.icon
  note: 字体图标；指定类型需 .icon-<type>，并限定容器（Button 内同样为 i.icon）
legacyIconSvg:
  css: span.c7nicon[role="img"]
  note: 传 scriptUrl / createFromIconfontCN 时的 SVG 形态
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 用 `c7n-pro-btn` 或 `c7n-pro-form` 定位旧版 | 旧版为 `c7n-btn` / `c7n-form` |
| 对 IconSelect 使用 `pickSelect` | 旧版下拉为 `.c7n-icon-select-dropdown`，无 Pro popup |
| 旧版字段用 `input[name]` 直接定位 | 旧版字段需经 Form.Item 的 label 唯一化 |
| 对 Icon 做文字断言 | 图标无文本，用 `i.icon.icon-<type>` 或 `span.c7nicon` |
| 全局 `.c7n-btn` 点击 | Popconfirm / 表格行内按钮同名，需限定范围 |

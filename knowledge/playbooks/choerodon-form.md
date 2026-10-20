# Choerodon Pro 表单容器与布局（Form / Output / Button / Row·Col）

Pro 组件样式前缀为 **`c7n-pro`**（`proPrefixCls` 默认值）；Row / Col 为基础栅格，前缀 **`c7n`**。建议新增的定位键见各节末尾，汇总于 `kit-choerodon-form.yaml`（待合并进 `kit.yaml`）。

## Form

源码：[components-pro/form](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/form)。静态子组件：`Form.Item`、`Form.ItemGroup`、`Form.FormVirtualGroup`。

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **Form（table 布局）** | 默认 `layout="table"` | 根下 `<table>`，字段按 `columns` 排成「标签 td + 字段 td」 |
| **Form `layout="none"`** | `<Form layout="none">` | children 原样渲染，常配 Row/Col（见 form/demo/grid.md） |
| **Form.ItemGroup** | `<Form.ItemGroup>` | 一组控件共用标签，根 `.c7n-pro-form-item-group` |
| **FormVirtualGroup** | `<Form.FormVirtualGroup>` | **不产生 DOM**，只向子控件注入 props |

### DOM

```
form.c7n-pro-form.c7n-pro-form-{labelLayout}.c7n-pro-form-{single|multi}
  ├── div.c7n-pro-form-header                     # header 属性
  └── table[.auto-width]                           # layout=table；labelWidth 含 'auto'
        └── tbody > tr
              ├── td.c7n-pro-field-label.c7n-pro-field-label-{left|center|right}[.c7n-pro-field-required]
              │     └── label > span（文案）
              └── td > div.c7n-pro-field-wrapper > 控件（控件根追加 c7n-pro-field）
```

推导依据：`suffixCls = 'form'` → `c7n-pro-form`；字段前缀 `FIELD_SUFFIX = 'field'`（form/utils.tsx:19）→ `c7n-pro-field`；类名见 Form.tsx 的 `getClassName`、`labelClassName`、`wrapperClassName`。嵌在其它 `<form>` 内时不渲染根（Form.tsx 渲染末尾分支）。

### 源码识别

1. `<Form record|dataSet>`（`choerodon-ui/pro`）；`layout="none"` 时布局交给 Row/Col。
2. `columns`、`labelLayout`、`labelWidth`、`labelAlign` 直接对应上表类名；需自定义标签或跨列时用 `<Form.Item name label>`。
3. 控件 `name` 即 DataSet 字段名，对应 `input[name="字段名"]`。

### 分析产物

```yaml
field_rules:
  - name: birth
    control: date           # input[name]，fill 格式化字符串
  - name: status
    control: select         # fillForm control: select → pickSelect
form_layout:                # 假设：容器元信息字段名，待分析器确认
  label_layout: horizontal
  columns: 2
```

`field_rules` 生成的 css 固定为 `.page-content input.c7n-pro-input[name=…]`（platformKit.ts:148-160），仅 switch / lov / number 有专用分支。

### 自动化步骤

1. 根：`formRoot`；多表单、弹层内表单由功能层覆盖收窄。
2. 单字段：`fill`，target 用 field_rules 生成的字段键：`args: { target: phone, value: "<样本值>" }`。
3. 批量：`fillForm` 数组，文本项用 `name`（直接走 `input[name]`）：
   ```yaml
   - action: fillForm
     args:
       fields:
         - name: phone
           value: "<样本值>"
         - name: status
           control: select
           first: true            # 不写死文案，取第一项
         - name: birth
           value: "<YYYY-MM-DD>"  # date 无专用 control，走 text 分支
   ```
4. 必填：`formFieldRequiredLabel` 只说明页面存在必填标签；定位具体字段需功能层覆盖（示例：`phoneRequiredLabel` = `td.c7n-pro-field-label.c7n-pro-field-required:has-text("手机号")`）。
5. `labelLayout="none"` 无标签 td，只用 `name` 定位；`FormVirtualGroup` 无 DOM，断言组内字段即可。

### kit 建议

```yaml
formRoot:
  css: .c7n-pro-form
  note: 多表单时 within 收窄；嵌在其它 form 内时不渲染根
formItemGroup:
  css: .c7n-pro-form-item-group
formFieldLabel:
  css: td.c7n-pro-field-label
formFieldRequiredLabel:
  css: td.c7n-pro-field-label.c7n-pro-field-required
formFieldWrapper:
  css: .c7n-pro-field-wrapper
```

## Output

源码：[components-pro/output](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/output)。`Output extends FormField`，静态标记 `__PRO_OUTPUT`，Form 据此切换标签样式。

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **Output** | `<Output>`，`suffixCls='output'` | 只展示，不 fill / click，断言文本 |
| **可编辑字段** | Field 控件（`input[name]` 等） | 有输入框，走 fill / pickSelect |
| **Form 内 Output 样式** | `.c7n-pro-field-label-output`、`.c7n-pro-field-output` | 由 Form 按 `__PRO_OUTPUT` 追加，不是 Output 自身类 |

### DOM

```
.c7n-pro-field-wrapper.c7n-pro-field-output[.c7n-pro-field-output-mix]   # Form 内包裹层
  └── .c7n-pro-output[.c7n-pro-output-highlight][.c7n-pro-output-invalid][.c7n-pro-output-multiple-block]
        └── 文本（processValue 结果；空值由 :empty::before 占位）
# multiLine（DataSet 字段 multiLine 为真）
.c7n-pro-output-multi
  ├── .c7n-pro-output-multi-label[.c7n-pro-output-multi-label-required]
  └── .c7n-pro-output-multi-value[.c7n-pro-output-multi-value-invalid]
```

推导依据：`suffixCls = 'output'` → `c7n-pro-output`；多行的 `prefixCls` 由 Output 传入 `renderMultiLine`，MultiLine.tsx 拼出 `-multi-*`；包裹类 `-output`、`-output-mix` 见 Form.tsx 的 `wrapperClassName`。`-highlight`、`-invalid`、`-multiple-block` 仅在 output/style/index.less 出现，**挂载条件 <<待核实>>**。

### 源码识别

1. JSX `<Output value="…"/>` 或 `<Output name="…"/>`（`choerodon-ui/pro`）。
2. Form 内组件 `__PRO_OUTPUT` 为真时，标签追加 `-label-output`，且不加必填星号（Form.tsx `required && !isOutput`）。
3. `IntlField` 的 `displayOutput` 同样走 Output 样式（Form.tsx 判断）。
4. DataSet 字段 `multiLine` 为真时走多行结构（Output.tsx `field.get('multiLine', record)`）。

### 分析产物

```yaml
field_rules:
  - name: status
    control: output         # 只读展示，不应生成 input 选择器
```

`cssForFieldRule` 对未知 control 回落为 `input.c7n-pro-input`（platformKit.ts:159），因此 `output` 必须由功能层为该键提供 css；已有 css 的键不会被 field_rules 覆盖（platformKit.ts:78）。

### 自动化步骤

1. 不 fill、不 click；断言文本用功能层键（示例，非通用键）：
   ```yaml
   - action: assertVisible
     args: { target: statusOutput }   # td.c7n-pro-field-label:has-text("状态") + td .c7n-pro-output:text-is("<期望文案>")
   ```
2. 多行值：`outputMultiValue` 配合 `within` 限定到具体字段行。
3. 多匹配时 `assertVisible` 会因 strict mode 失败，先用 `within` 收窄。

### kit 建议

```yaml
outputRoot:
  css: .c7n-pro-output
  note: 只读展示；不要 fill
outputMultiLabel:
  css: .c7n-pro-output-multi-label
outputMultiValue:
  css: .c7n-pro-output-multi-value
```

## Button

源码：[components-pro/button](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/button)。

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **Pro Button** | `<Button>`，`suffixCls='btn'` | 根 `.c7n-pro-btn`，页头 / 表单操作按钮 |
| **Popconfirm 内按钮** | `.c7n-popover .c7n-btn`（kit `tableDeleteConfirm`） | 基础 `c7n-btn`，不是 Pro Button |
| **Dropdown 触发按钮** | `<Dropdown overlay>` 包住 `<Button funcType="flat">` | 点按钮打开 `.c7n-dropdown-menu`（kit `dropdownMenu`） |

### DOM

```
button.c7n-pro-btn.c7n-pro-btn-{funcType}.c7n-pro-btn-{color}   # 默认 raised + default
  ├── .icon.icon-{type}                     # icon 属性（iconfont 前缀默认 icon）
  ├── span                                  # 文案为字符串时包一层
  └── loading 时追加 .c7n-pro-btn-loading；进度元素 <<待核实:loading 进度元素类名>>
a.c7n-pro-btn                               # 设置 href 时根为 a
span.c7n-pro-btn-disabled-wrapper > button.c7n-pro-btn-disabled   # disabled 且有 mouseenter/leave 包装
修饰类：-block  -icon-only  -icon-end  -two-chinese-chars
```

推导依据：`@btn-prefix-cls: ~'@{c7n-pro-prefix}-btn'`（button/style/index.less:3）；类名由 Button.tsx `getClassName` 拼出；`buttonFuncType: raised`、`buttonColor: default`（configure/default.js:169-170）；`-disabled` 由 core/ViewComponent.tsx 追加。

### 源码识别

1. JSX `<Button color funcType icon href loading>`（`choerodon-ui/pro`）。
2. `color="primary"` → `.c7n-pro-btn-primary`；`funcType="flat"|"link"` → `-flat` / `-link`。
3. `onClick` 返回 Promise 时自动进入 loading（button/index.zh-CN.md 的 loading 说明）。

### 分析产物

```yaml
# Button 不是字段控件，不进入 field_rules（field_rules 会生成 input 选择器）
actions:                    # 假设：按钮动作的字段名，待分析器确认
  - name: save
    control: button
    color: primary
```

### 自动化步骤

1. 优先角色 + 文案点击（与 kit `saveBtn` 一致）：
   ```yaml
   - action: click
     args: { role: button, name: 保存 }
   ```
2. 指定颜色的按钮用键 + `hasText`：
   ```yaml
   - action: click
     args: { target: buttonPrimary, hasText: 保存, first: true }
   ```
3. `href` 按钮渲染为 `a`，有 href 时 `role: link`：`click` 用 `role: link, name: …`。
4. 等待 loading 结束：`waitFor` 的 `hidden: buttonLoading`（多按钮时须 within 收窄，否则 strict mode 失败）。
5. 断言禁用：`assertVisible` 目标 `buttonDisabled`（配合功能层 `within` 限定到具体按钮）。

### kit 建议

```yaml
buttonRoot:
  css: .c7n-pro-btn
  note: 含 button 与 a；页面多按钮时用 role+name
buttonPrimary:
  css: .c7n-pro-btn-primary
buttonFlat:
  css: .c7n-pro-btn-flat
buttonLoading:
  css: .c7n-pro-btn-loading
buttonDisabled:
  css: .c7n-pro-btn-disabled
buttonDisabledWrapper:
  css: .c7n-pro-btn-disabled-wrapper
```

## Row / Col

源码：[components-pro/row](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/row)、[components-pro/col](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/col)。两者只是 `choerodon-ui/lib/grid` 的再导出（`import { Row } from '../grid'`），**类名是基础 `c7n-row` / `c7n-col`，不是 `c7n-pro-*`**。无 `demo/` 与 `index.zh-CN.md`，依据为 grid 源码与 form/demo/grid.md。

| 易混 | 源码线索 | 说明 |
|------|----------|------|
| **Row / Col（基础栅格）** | `.c7n-row` / `.c7n-col-{span}` | 全站共用，断言必须限定到表单内 |
| **Form `columns`（表格栅格）** | `table > tbody > tr > td`，`c7n-pro-form-single/multi` | 与 Row/Col 不是同一套；Form 默认 layout=table |
| **Form.Item 内部布局** | `Item.tsx` 用 Row/Col 并追加 `c7n-pro-field-row` / `-col` | 内部结构，业务代码不直接写 |

### DOM

```
div.c7n-row[.c7n-row-flex][.c7n-row-flex-{justify}][.c7n-row-flex-{align}]   # 仅 type="flex" 时带 -flex 类
  └── div.c7n-col[.c7n-col-{span}][.c7n-col-{xs|sm|md|lg|xl}-{span}][.c7n-col-order-N][.c7n-col-offset-N]
```

推导依据：`getPrefixCls('row')` / `getPrefixCls('col')`，默认前缀 `c7n`（configure/default.js:109）；类名拼接见 grid `row.js`、`col.js`。依据来自 `/data/aisikai/hmes-front-PM-33216/node_modules/choerodon-ui`（1.6.7-alpha.27），仓库 package.json 为 1.6.8 且仓库内无 grid 源码，**版本差异 <<待核实>>**。

### 源码识别

1. JSX `<Row gutter>`、`<Col span>`（`choerodon-ui/pro` 导出）。
2. `<Form layout="none">` 中 Row/Col 包裹 `<Form.Item>`：form/demo/grid.md 即此结构。
3. Row 无 `type` 时只有 `.c7n-row`，无 flex 类。

### 分析产物

```yaml
field_rules: []             # Row/Col 不是字段控件，不产生 field_rules
layout_rules:               # 假设：容器字段名，待分析器确认
  - container: row
    type: flex              # 有 type 才会有 .c7n-row-flex
    span: 6                 # Col span → .c7n-col-6
```

### 自动化步骤

1. Row/Col 本身不交互，不写 click。
2. 定位表单内某列：`colRoot` within `formRoot`，并用 `:has(input[name="…"])` 唯一化：
   ```yaml
   - action: assertVisible
     args: { target: phoneColumn }   # 功能层键：.c7n-pro-form .c7n-col:has(input[name="phone"])
   ```
3. `xs ~ xl` 响应式类随视口宽度变化，用例固定 viewport，或只断言字段可见。
4. 不对全站 `.c7n-col` 做 click / assert，会因多匹配失败。

### kit 建议

```yaml
rowRoot:
  css: .c7n-row
  note: 基础栅格，全站共用；断言前 within formRoot 收窄
rowFlex:
  css: .c7n-row-flex
colRoot:
  css: .c7n-col
  note: 基础栅格；多匹配时用 :has(input[name=…]) 唯一化
```

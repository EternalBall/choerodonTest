# Choerodon 旧版输入框（Input / InputNumber / AutoComplete）

旧版（`choerodon-ui`，非 Pro）组件，全局前缀 `c7n`。推导：`components/configure/default.tsx:96` `prefixCls: 'c7n'`；`getPrefixCls(suffix, custom)` 在无自定义前缀时返回 `c7n-${suffix}`（`components/configure/utils.tsx:14-19`）。  
Pro 版见下表；机器可读：`kit.yaml` 中 `legacyInput*` / `legacyInputNumber*` / `legacyAutoComplete*`（草案见各节末尾，未并入 `kit.yaml`）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro（`choerodon-ui/pro`） |
|------|--------------|---------------------------|
| JSX 导入 | `import { Input, InputNumber, AutoComplete } from 'choerodon-ui'` | `import { TextField, NumberField, AutoComplete } from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-input` / `c7n-input-number` / `c7n-select-auto-complete` | `c7n-pro-input` / `c7n-pro-input-number` / `c7n-pro-auto-complete` |
| 绑定 DataSet | 否，值走 `value` / `onChange`（可配合 `Form.Item`） | 是，`name` 对应 DataSet Field |
| 对应 Pro 手册 | — | [choerodon-text-input.md](./choerodon-text-input.md)（TextField、AutoComplete）；[choerodon-number-input.md](./choerodon-number-input.md)（NumberField） |

同名组件不要混用定位键：旧版 `input.c7n-input` 与 Pro `input.c7n-pro-input` 类名 token 不同，kit 中不得互相替代。

## Input

源码：[components/input](https://github.com/open-hand/choerodon-ui/tree/master/components/input)（`Input.tsx`、`Group.tsx`、`Search.tsx`、`TextArea.tsx`）。Pro 对应见 [choerodon-text-input.md](./choerodon-text-input.md)（TextField）。

| 控件 | 源码线索 | DOM 关键类 |
|------|----------|------------|
| **Input** | `<Input>` | `span.c7n-input-wrapper > input.c7n-input` |
| Group / Search / TextArea | `<Input.Group>` / `<Input.Search>` / `<Input.TextArea>` | `c7n-input-group`；`c7n-input-search-button`（`Search.tsx:89`）；`textarea.c7n-input-textarea-element`（`TextArea.tsx:154`） |

### DOM

```
span.c7n-input-wrapper[.c7n-input-focused|-disabled|-has-value]
  └── input.c7n-input[.c7n-input-lg|-sm][name=字段]     # placeholder/name/disabled 原生透传
# addonBefore/After → span.c7n-input-group-wrapper > span.c7n-input-wrapper.c7n-input-group > [span.c7n-input-group-addon] input [span.c7n-input-group-addon]
# prefix/suffix    → span.c7n-input-affix-wrapper > span.c7n-input-prefix + input + span.c7n-input-suffix
# showPasswordEye/copy → span.c7n-input-icon[.c7n-input-icon-eye] 内含 .c7n-input-icon-copy
# label            → div.c7n-input-label-wrapper > div.c7n-input-label
```

类名依据：`Input.tsx:414-427`（input 类）、`524-532`（prefix/suffix）、`454-475`（copy/eye）、`492-497`（label）、`657-666`（wrapper 状态）。

### 源码识别

1. JSX `<Input>` 及子组件，来自 `choerodon-ui`；无 DataSet。
2. 在 `Form.Item` 内且设置 `id` 与 `options` 时，`value` / `defaultValue` / `id` 自动注入（`index.zh-CN.md`）。
3. `addonBefore/After`、`prefix/suffix`、`copy`、`showPasswordEye`、`label` 决定包裹层结构。

### 分析产物

```yaml
field_rules:
  - name: remark
    control: legacy_input      # 与 Pro 的 text 取值区分
```

### 自动化步骤

1. 定位：`legacyInputElement`，功能层用 `within` 限定到表单项。
2. 单字段：`- action: fill` + `args: { target: legacyInputElement, value: 备注示例 }`。
3. 多字段（文本回退为 `input[name]`）：`- action: fillForm` + `args: { fields: [{ name: remark, value: 备注示例 }] }`。
4. 失焦：`- action: press` + `args: { target: legacyInputElement, key: Tab }`。
5. 复制 / 显示密码：`click` `legacyInputCopyIcon` / `legacyInputEyeIcon`（需对应属性）。
6. 清空：源码无内置清除按钮，不要 `fill` 空串；`press` `Backspace` 按当前长度重复。
7. 禁用态：断言 `input.c7n-input-disabled` 存在。

### 建议新增 kit

```yaml
legacyInputElement:
  css: input.c7n-input
  note: 旧版 Input 原生框；Pro 为 input.c7n-pro-input，勿混用
legacyInputWrapper:
  css: .c7n-input-wrapper
  note: 无 addon 时的包裹层
legacyInputGroup:
  css: .c7n-input-group-wrapper
  note: 仅 addonBefore/addonAfter 时存在
legacyInputAffixWrapper:
  css: .c7n-input-affix-wrapper
  note: 仅 prefix/suffix 时存在
legacyInputCopyIcon:
  css: .c7n-input-icon-copy
  note: copy 属性开启时
legacyInputEyeIcon:
  css: .c7n-input-icon-eye
  note: showPasswordEye 且 type=password 时
```

## InputNumber

源码：[components/input-number](https://github.com/open-hand/choerodon-ui/tree/master/components/input-number)；内核 `components/rc-components/input-number`，`prefixCls` 由 `getPrefixCls('input-number')` 注入为 `c7n-input-number`（`input-number/index.tsx` render）。  
Pro 对应：NumberField，见 [choerodon-number-input.md](./choerodon-number-input.md)。

| 控件 | 源码线索 | DOM 关键类 |
|------|----------|------------|
| **InputNumber（旧）** | `<InputNumber>`，`choerodon-ui` | `div.c7n-input-number`，`input[role="spinbutton"]` |
| Pro NumberField | DataSet `type: number`，`choerodon-ui/pro` | `input.c7n-pro-input-number`（非本组件） |

### DOM

```
div.c7n-input-number[.c7n-input-number-lg|-sm][.c7n-input-number-focused][.c7n-input-number-disabled]
  ├── div.c7n-input-number-handler-wrap
  │     ├── span.c7n-input-number-handler.c7n-input-number-handler-up[.c7n-input-number-handler-up-disabled]
  │     │     └── span.c7n-input-number-handler-up-inner
  │     └── span.c7n-input-number-handler.c7n-input-number-handler-down[.c7n-input-number-handler-down-disabled]
  │           └── span.c7n-input-number-handler-down-inner
  └── div.c7n-input-number-input-wrap
        └── span.c7n-input-wrapper > input.c7n-input[role="spinbutton"]
```

类名依据：`rc-components/input-number/index.jsx:690-739`（handler、input-wrap、focused/disabled）；内部输入经 `renderInput` 渲染为 `Input`（`input-number/index.tsx`），故外包一层 `c7n-input-wrapper`。

### 源码识别

1. JSX `<InputNumber min max step precision formatter parser>`，来自 `choerodon-ui`；无 DataSet。
2. `allowThousandth` 开启千分位显示；解析时去掉逗号（`parseNumber`），填入纯数字即可。
3. `formatter` / `parser` 自定义展示（demo `formatter.md`）；`label` 透传为内部 Input 的浮动标签。

### 分析产物

```yaml
field_rules:
  - name: quantity
    control: legacy_input_number
```

### 自动化步骤

1. 定位：`legacyInputNumberInput`（功能层 `within` 表单项）。
2. 输入：`- action: fill` + `args: { target: legacyInputNumberInput, value: "1000" }`。
3. 失焦：`- action: press` + `args: { target: legacyInputNumberInput, key: Tab }`。
4. 步进：`click` `legacyInputNumberUp` / `legacyInputNumberDown`（只单击）；或聚焦后 `press` `ArrowUp` / `ArrowDown`（`rc-components/input-number/index.jsx:205-209`，按 `KeyCode.UP/DOWN` 处理）。
5. 超出 min/max 是截断还是保留非法值：<<待核实:超界行为>>。
6. 值断言以 `input[role="spinbutton"]` 的 value 为准；具体断言关键字 <<待核实:value 断言关键字>>。

### 建议新增 kit

```yaml
legacyInputNumberWrapper:
  css: .c7n-input-number
  note: 旧版 InputNumber 根；Pro 为 .c7n-pro-input-number-wrapper
legacyInputNumberInput:
  css: 'input[role="spinbutton"]'
  note: 旧版数值输入框；功能层用 within 限定表单项
legacyInputNumberUp:
  css: .c7n-input-number-handler-up
  note: 上步进按钮
legacyInputNumberDown:
  css: .c7n-input-number-handler-down
  note: 下步进按钮
```

## AutoComplete

源码：[components/auto-complete](https://github.com/open-hand/choerodon-ui/tree/master/components/auto-complete)。内部复用 `components/select`（固定 `mode=combobox`，`auto-complete/index.tsx`），输入框为 `Input`（`border={false}`，`InputElement.tsx`）。  
Pro 对应：AutoComplete，见 [choerodon-text-input.md](./choerodon-text-input.md) 的 AutoComplete 节。

| 控件 | 源码线索 | DOM 关键类 |
|------|----------|------------|
| **AutoComplete（旧）** | `<AutoComplete dataSource>`，`choerodon-ui` | `.c7n-select.c7n-select-auto-complete`（combobox） |
| 旧版 Select | `<Select>` | `.c7n-select` 无 `-auto-complete`，只能选项，无自由输入 |
| Pro AutoComplete | `choerodon-ui/pro` | `.c7n-pro-auto-complete`（非本组件） |

### DOM

```
div.c7n-select.c7n-select-show-search.c7n-select-auto-complete[.c7n-select-open][.c7n-select-focused][.c7n-select-combobox][.c7n-select-allow-clear]
  └── div.c7n-select-selection.c7n-select-selection--single[role="combobox"]
        ├── div.c7n-select-selection__rendered
        │     ├── div.c7n-select-selection-selected-value           # 有值时
        │     └── div.c7n-select-search.c7n-select-search--inline   # 未展开时 display:none
        │           └── span.c7n-input-wrapper > input.c7n-input
        ├── div.c7n-select-selection__clear                         # allowClear 且有值
        └── span.c7n-select-arrow > i.c7n-select-arrow-icon         # showArrow 默认 true

# 弹层（挂 body）
div.c7n-select-dropdown
  └── <<待核实:菜单根节点标签>>.c7n-select-dropdown-menu
        └── li.c7n-select-dropdown-menu-item[.c7n-select-dropdown-menu-item-selected]
```

类名依据：`auto-complete/index.tsx`（根类）；`rc-components/select/Select.jsx:1254,1290-1305,1473,1560-1575,1632-1651`；`rc-components/select/SelectTrigger.jsx:125`（`-dropdown`）；`select/style/index.less:614-713`（菜单项类）。

### 源码识别

1. JSX `<AutoComplete dataSource={[...]}>`，或 `children` 为 `AutoComplete.Option` / `OptGroup`。
2. `children` 为自定义输入（如 `<TextArea>`）时替换内部 Input（demo `custom.md`）。
3. `onSearch` 驱动数据源过滤（demo `basic.md`）；无 DataSet。
4. 与 Select 的区别：类名含 `c7n-select-auto-complete`，且 `mode=combobox` 允许自由输入。

### 分析产物

```yaml
field_rules:
  - name: keyword
    control: legacy_auto_complete   # 可输入 + 建议下拉；区别于 legacy select（只能选项）
```

### 自动化步骤

1. 定位：`legacyAutoCompleteSelection`（功能层 `within` 表单项）。
2. 打开并输入：先 `click` `legacyAutoCompleteSelection`（展开后搜索输入才可见），再 `- action: fill` + `args: { target: legacyAutoCompleteInput, value: "关键词" }`。
3. 等弹层：`- action: waitFor` + `args: { visible: legacyAutoCompletePopup }`。
4. 选中：`click` `target: legacyAutoCompleteMenuItem` + `exactText: "<选项文案>"`。
5. 清空：`click` `legacyAutoCompleteClear`（需 `allowClear` 且有值）。
6. 自由文本（不在选项中）是否回写 value：<<待核实:combobox 自由输入回写>>。
7. 不要用 `pickSelect`：其默认弹层为 `.c7n-pro-select-popup`，与本控件不同。

### 建议新增 kit

```yaml
legacyAutoCompleteSelection:
  css: .c7n-select-auto-complete .c7n-select-selection
  note: 点击展开；展开前搜索输入不可见
legacyAutoCompleteInput:
  css: .c7n-select-auto-complete .c7n-select-search--inline input.c7n-input
  note: 展开后的搜索输入；功能层 within 限定
legacyAutoCompleteClear:
  css: .c7n-select-auto-complete .c7n-select-selection__clear
  note: allowClear 且有值时
legacyAutoCompletePopup:
  css: .c7n-select-dropdown
  note: 旧版 Select 共用的弹层类；与 Pro 的 .c7n-pro-select-popup 不同
legacyAutoCompleteMenuItem:
  css: .c7n-select-dropdown-menu-item
  note: 菜单项；配合 exactText 选中
```

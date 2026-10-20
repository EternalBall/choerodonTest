# Choerodon Pro 勾选 / 单选 / 开关 / 分段

覆盖 CheckBox、Radio、Switch、SelectBox、Segmented。类名前缀统一 `c7n-pro-`。  
建议新增的定位键汇总见 `/tmp/pb/kit-choerodon-check-radio-switch.yaml`（未合入 `kit.yaml`）。

## 易混对照

| 组件 | suffixCls | 源码线索（JSX / DataSet） | 交互形态 | 原生 input |
|------|-----------|---------------------------|----------|-----------|
| **CheckBox** | `checkbox` | `<CheckBox>`；Field `type: boolean` 或 `multiple` | 方框，点击切换 | `input[type=checkbox]` |
| **Radio** | `radio` | `<Radio>`；同 name 多个，字段为 string | 圆点，同组单选，不可再点取消 | `input[type=radio]` |
| **Switch** | `switch` | `<Switch>`；Field `type: boolean` | 滑轨开关，无 `-inner` | `input[type=checkbox]` |
| **SelectBox** | `select-box` | `<SelectBox>` + `<SelectBox.Option>` | 平铺选项，无下拉 popup | 每项一个 radio / checkbox |
| **Segmented** | `segmented` | `<Segmented>` + `<Segmented.Option>` | 分段按钮，单选，滑动高亮 | 每项一个 radio（mode 固定 button） |

- 勾选态以 **`input:checked`** 为准，不要依赖 wrapper 的 `-checked` 类（见 Switch 节）。
- SelectBox / Segmented 不是 Select：没有 `.c7n-pro-select-popup`，**不用 `pickSelect`**（对比 [choerodon-select.md](./choerodon-select.md)）。
- 表格行编辑中的 Switch 见 [choerodon-table-row-edit.md](./choerodon-table-row-edit.md)；只读页行内 Radio/Switch 直调接口见 [row-action.md](./row-action.md)。
- 前缀推导：`getContextProPrefixCls(suffixCls)` 得到 `c7n-pro-<suffix>`（`components-pro/core/ViewComponent.tsx:295`），wrapper 为 `<prefix>-wrapper`（`:442`）。`c7n-pro-prefix` 变量在本仓库未定义，前缀依据为 kit.yaml 与 `__tests__` 快照。
- 挂在 wrapper 上的通用修饰类：`-sm` / `-lg`（`size` 为 small / large）、`-disabled`、`-focused`（`ViewComponent.tsx:436-450`）；表单字段另有 `-readonly`、`-invalid`、`-required`（`field/FormField.tsx:687-706`）。

## CheckBox

源码：[components-pro/check-box](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/check-box)（`CheckBox extends Radio`，`suffixCls: 'checkbox'`，`CheckBox.tsx:43`）

### DOM

```
label.c7n-pro-checkbox-wrapper                    # 附加 -indeterminate / -disabled / -readonly / -button
  ├── input.c7n-pro-checkbox[type=checkbox][name][value]   # 原生输入，absolute 全覆盖、opacity:0
  ├── i.c7n-pro-checkbox-inner                    # 方框；对勾为 ::after
  └── span.c7n-pro-checkbox-label                 # 文案；无 children 时用 label
```

推导依据：`CheckBox.renderInner` 返回 `<i class="${prefixCls}-inner">`（`CheckBox.tsx:139-141`）；`renderWrapper` 继承自 `Radio.tsx:115-130`；输入覆盖样式见 `radio/style/mixin.less:3-15`。`-button` 仅 `mode="button"` 时出现（快照 `c7n-pro-checkbox-button`）。

### 源码识别

- JSX：`<CheckBox name="base" value="A">A</CheckBox>`（`demo/basic.md`）。
- DataSet：Field `type: 'boolean'`（可配 `trueValue` / `falseValue`）绑定单个勾选；Field `multiple: true` + 多个同 `name` 的 CheckBox（`value` 为选项值）绑定多选数组（`demo/dataset.md`）。
- `indeterminate` 为真时 `isChecked()` 返回 false，wrapper 加 `-indeterminate`（`CheckBox.tsx:161-165`）。

### 分析产物

```yaml
field_rules:
  - name: enableFlag
    control: checkbox       # checkbox | radio | switch | select_box | segmented
```

### 自动化步骤

1. 定位：单个勾选用 kit `checkBoxWrapper`；同名多个时功能层收窄为 `.c7n-pro-checkbox-wrapper:has(input[name="x"][value="A"])`。
2. 切换：`click`，`target: checkBoxWrapper`，`hasText: "文案"`。点 wrapper（label）与点 input 等效，因为 input 覆盖整个 label。
3. 断言勾选：无选中态关键字。用 step 的 `assert: [{type: visible, target: checkBoxChecked}]`，即 `input.c7n-pro-checkbox:checked` 存在即视为通过（Playwright 视 opacity:0 为可见）。属于间接断言，功能层须收窄，否则同页其他勾选框会误命中。
4. 不要用 `fillForm`：其 control 只分支 select / lov，其余按 text 调 `fill`，对 checkbox 无效。

```yaml
- name: 勾选“启用”
  action: click
  args:
    target: checkBoxWrapper
    hasText: 启用
```

### kit 建议键

```yaml
checkBoxWrapper:
  css: .c7n-pro-checkbox-wrapper
  note: 功能层用 :has(input[name=字段][value=…]) 收窄；hasText 选文案
checkBoxChecked:
  css: input.c7n-pro-checkbox:checked
  note: 仅配合 assert visible（间接断言）；须收窄
checkBoxIndeterminate:
  css: .c7n-pro-checkbox-wrapper.c7n-pro-checkbox-indeterminate
```

## Radio

源码：[components-pro/radio](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/radio)（`suffixCls: 'radio'`，`Radio.tsx:38`；`mode` 为 `box` / `button`，见 `index.zh-CN.md`）

### DOM

```
label.c7n-pro-radio-wrapper                       # mode="button" 时附加 .c7n-pro-radio-button
  ├── input.c7n-pro-radio[type=radio][name][value]
  ├── span.c7n-pro-radio-inner
  └── span.c7n-pro-radio-label
```

推导依据：`Radio.renderWrapper`（`Radio.tsx:115-130`）、`renderInner`（`:132-134`）；快照 `radio/__tests__` 与此一致。`Radio.getWrapperClassNames` 中有 `-checked` 逻辑（`Radio.tsx:179`），但快照中未出现：<<待核实:c7n-pro-radio-checked>>，断言改用 `:checked`。

### 源码识别

- JSX：`<Radio name="base" value="A">A</Radio>`；`mode="button"` 为按钮样式（`demo/button.md`）。
- DataSet：普通 string 字段（如 `{ name: 'bind' }`）+ 同 name 的多个 Radio，`value` 为选项值（`demo/dataset.md`）。
- 单选不可取消：`setChecked(false)` 不会设值（`Radio.tsx:211-216`）。

### 分析产物

```yaml
field_rules:
  - name: defaultFlag
    control: radio          # 按钮样式时可补 mode: button 说明
```

### 自动化步骤

1. 定位：`radioWrapper`；按钮样式用 `radioButtonWrapper`；功能层用 `:has(input[name="字段"])` 限定同组。
2. 选择：`click`，`target: radioWrapper`，`hasText: "B"`。
3. 重复点击已选项不会取消；要切回原值须点另一项。
4. 断言选中：`assert` 的 `visible` 指向 `radioChecked`，功能层收窄到同组 name。
5. 同 CheckBox，不用 `fillForm`。

### kit 建议键

```yaml
radioWrapper:
  css: .c7n-pro-radio-wrapper
  note: 功能层用 :has(input[name=字段][value=…]) 收窄；hasText 选文案
radioButtonWrapper:
  css: .c7n-pro-radio-wrapper.c7n-pro-radio-button
radioChecked:
  css: input.c7n-pro-radio:checked
  note: 仅配合 assert visible（间接断言）；须收窄
```

## Switch

源码：[components-pro/switch](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/switch)（`Switch extends CheckBox`，`suffixCls: 'switch'`，`Switch.tsx:34`）

### DOM

```
label.c7n-pro-switch-wrapper[.c7n-pro-switch-sm|-lg][.c7n-pro-switch-disabled][.c7n-pro-switch-loading][.c7n-pro-switch-readonly]
  ├── input.c7n-pro-switch[type=checkbox]         # 原生输入，覆盖 label；onKeyDown 处理 ←/→
  ├── <<待核实:.c7n-progress-loading>>             # 仅 loading=true 时渲染（Switch.tsx:119-127）
  └── span.c7n-pro-switch-label                   # 轨道；滑块是其 ::after（switch/style/index.less:81-100）
        └── span.c7n-pro-switch-label-content     # 有开/关文案时（Switch.tsx:81-92）
```

Switch 没有 `-inner`：`renderInner` 非 loading 时返回 null（`Switch.tsx:119-131`）。`size="small"` 对应 `-sm`（快照 `c7n-pro-switch-sm`）。快照显示 `defaultChecked` 时 input 为 `checked`，而 wrapper 不带 `-checked`。

### 源码识别

- JSX：`<Switch defaultChecked onChange={fn} />`（`demo/basic.md`）。
- DataSet：Field `type: 'boolean'`（`demo/dataset.md`）。
- `loading` 为真时 `isDisabled()` 返回 true（`Switch.tsx:69-75`），此时不可交互。

### 分析产物

```yaml
field_rules:
  - name: enableFlag
    control: switch
```

### 自动化步骤

1. 定位：`switchWrapper`；同表单多个开关用 `:has(input[name="x"])` 收窄。
2. 切换：`click`，`target: switchWrapper`（点 `span.c7n-pro-switch-label` 也可）。
3. 键盘切换：`press`，`target: switchInput`，`key: ArrowRight`（开）或 `ArrowLeft`（关），对应 `Switch.tsx:37-45` 的 `handleKeyDown`。
4. loading：先用 step 的 `ready: {hidden: switchLoadingIndicator}` 等加载指示消失，再点击。
5. 断言开启：`assert` 的 `visible` 指向 `switchChecked`。

```yaml
- name: 打开“启用”
  action: click
  args:
    target: switchWrapper
```

### kit 建议键

```yaml
switchWrapper:
  css: .c7n-pro-switch-wrapper
  note: 功能层用 :has(input[name=字段]) 收窄
switchInput:
  css: input.c7n-pro-switch
  note: press ArrowLeft / ArrowRight 切换
switchChecked:
  css: input.c7n-pro-switch:checked
  note: 仅配合 assert visible（间接断言）；须收窄
switchLoadingIndicator:
  css: .c7n-pro-switch-wrapper .c7n-progress-loading
  note: <<待核实>> 选择器前缀未在本仓库样式中确认
```

## SelectBox

源码：[components-pro/select-box](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/select-box)（`SelectBox extends Select`，`suffixCls: 'select-box'`，`SelectBox.tsx:34`；`vertical` 默认 false）

### DOM

```
span.c7n-pro-select-box-wrapper[.c7n-pro-select-box-disabled][.c7n-pro-select-box-multiple]
  └── form.c7n-pro-select-box[.c7n-pro-select-box-vertical]     # Form 内为 div（SelectBox.tsx:184）
        ├── label.c7n-pro-radio-wrapper[.c7n-pro-radio-disabled]   # 单选：每个选项一个 Radio
        │     ├── input.c7n-pro-radio[name=字段][value=选项值]
        │     ├── span.c7n-pro-radio-inner
        │     └── span.c7n-pro-radio-label                          # 选项文案
        └── label.c7n-pro-checkbox-wrapper                          # multiple：每项为 CheckBox（SelectBox.tsx:226-231）
```

推导依据：`SelectBox.renderWrapper`（`SelectBox.tsx:115-179`）；选项类型由 `renderItem` 决定（`:226-231`）。`-suffix-button`、`-not-editable` 来自 TextField / TriggerField 基类，不作定位依据。所有选项 input 的 `name` 相同，必须用 `value` 区分。

### 源码识别

- JSX：`<SelectBox><SelectBox.Option value="jack">Jack</SelectBox.Option></SelectBox>`（`demo/basic.md`）；`mode="button"`（`demo/button.md`）；`multiple`。
- DataSet：`lookupCode` / `options` 与 Select 相同（`demo/lookupCode.md`）。
- 无 popup：页面上不会出现 `.c7n-pro-select-popup`。

### 分析产物

```yaml
field_rules:
  - name: sex
    control: select_box     # 选项少、平铺展示；下拉用 select
```

### 自动化步骤

1. 不用 `pickSelect`。定位：功能层 `selectBoxWrapper:has(input[name="sex"])`。
2. 单选：`click`，`target: selectBoxRadioOption`，`hasText: "女"`。
3. 多选（multiple）：`click`，`target: selectBoxCheckOption`，`hasText: "…"`；再次点击同一项即取消。
4. 禁用项带 `-disabled`，点击无效；不要对其写「可选」断言。
5. 断言已选：`assert` 的 `visible` 指向功能层 `input[name="sex"][value="F"]:checked`（或收窄后的 `radioChecked`）。

### kit 建议键

```yaml
selectBoxWrapper:
  css: .c7n-pro-select-box-wrapper
  note: 功能层用 :has(input[name=字段]) 收窄
selectBoxRadioOption:
  css: .c7n-pro-select-box .c7n-pro-radio-wrapper
  note: 单选；hasText 选文案
selectBoxCheckOption:
  css: .c7n-pro-select-box .c7n-pro-checkbox-wrapper
  note: multiple；hasText 选文案
```

## Segmented

源码：[components-pro/segmented](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/segmented)（`Segmented extends SelectBox`，`suffixCls: 'segmented'`，`Segmented.tsx:30`；mode 固定为 button，`Segmented.tsx:56-58`；无 `multiple`、无 `searchable`）

### DOM

```
span.c7n-pro-segmented-wrapper[.c7n-pro-segmented-wrapper-vertical][.c7n-pro-segmented-wrapper-fullwidth]
  └── form.c7n-pro-segmented[.c7n-pro-segmented-vertical][.c7n-pro-segmented-fullwidth]
        ├── div.c7n-pro-segmented-active-show           # 滑动高亮块，位置随选中项（Segmented.tsx:126-153）
        ├── label.c7n-pro-radio-wrapper.c7n-pro-radio-button
        │     ├── input.c7n-pro-radio[name][value]
        │     ├── span.c7n-pro-radio-inner
        │     └── span.c7n-pro-radio-label
        └── …（其余选项同上）
```

推导依据：`-vertical` 由 `SelectBox.getClassName` 的 `${prefixCls}-vertical` 得到（`SelectBox.tsx:86`），Segmented 实例的 prefixCls 为 `segmented`。本仓库 segmented 无 `__tests__` 快照，本节 DOM 仅由源码推导。

### 源码识别

- JSX：`<Segmented><Segmented.Option value="react">React</Segmented.Option></Segmented>`（`demo/basic.md`），`vertical`、`fullWidth` 为布局属性。
- DataSet：`options` 指向 DataSet，配 `textField` / `valueField`（`demo/dataset.md`）。
- 自动选中：无值时会设为第一个未禁用项（`Segmented.tsx:77-88`），初始态不会是「未选中」，不要写此类断言。

### 分析产物

```yaml
field_rules:
  - name: viewType
    control: segmented
```

### 自动化步骤

1. 定位：`segmentedWrapper`；功能层 `:has(input[name="viewType"])` 收窄。
2. 切换：`click`，`target: segmentedOption`，`hasText: "Vue"`。
3. 禁用项（`onOption` 或记录 `disabled`，`Segmented.tsx:20-22`、`:82-85`）不可点击。
4. 断言选中：`assert` 的 `visible` 指向 `segmentedChecked`。

### kit 建议键

```yaml
segmentedWrapper:
  css: .c7n-pro-segmented-wrapper
  note: 功能层用 :has(input[name=字段]) 收窄
segmentedOption:
  css: .c7n-pro-segmented .c7n-pro-radio-wrapper
  note: hasText 选文案
segmentedChecked:
  css: .c7n-pro-segmented input.c7n-pro-radio:checked
  note: 仅配合 assert visible（间接断言）
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 用 `fillForm` 填 checkbox / radio / switch | 用 `click`（`fillForm` 仅分支 select / lov / text） |
| 用 wrapper `-checked` 判断勾选 | 用 `input:checked` |
| SelectBox / Segmented 用 `pickSelect` | 无 popup，直接点选项 |
| 对 Switch 找 `.c7n-pro-switch-inner` | Switch 无 `-inner`，点 wrapper 或 label |
| 用 `input[name=字段]` 定位 SelectBox 单个选项 | 同名多项，必须加 `[value=…]` 或 `hasText` |
| 对 Radio 再点已选项期待取消 | Radio 不可取消，切到其他项 |
| 把 Segmented 的初始态当作「未选」 | 无值时自动选中第一个未禁用项 |

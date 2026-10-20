# Choerodon Pro 数值类输入（NumberField / Currency / PercentField / Range）

继承链：Currency、PercentField → NumberField → TextField；Range 继承 NumberField 只为复用数据绑定，渲染为 Slider。  
前缀：NumberField / Currency / PercentField 为 **`c7n-pro-input-number`**；Range 为 **`c7n-pro-range`**。  
建议新增的 kit 键汇总见 `kit-choerodon-number-input.yaml`（未并入 `kit.yaml`）。

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **NumberField** | `<NumberField>`；DataSet `type: 'number'` | `input.c7n-pro-input-number`；设 `step` 才出现 ↑↓ 按钮 |
| **Currency** | `<Currency currency="USD">`；DataSet `type: 'currency'`，或 number 字段带 `currency` | DOM 与 NumberField 相同，仅格式化（货币符号）不同 |
| **PercentField** | `<PercentField>`；DataSet `type: 'percentage'` | 外层多 `-percentage` 类，后缀 `%`，值以小数存储 |
| **Range** | `<Range>`；DataSet 字段 `name` 绑定 | 滑块，**无 `<input>`**；与 NumberField 的 DataSet `range: true`（起止两框）不是一回事 |

## NumberField

源码：[components-pro/number-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/number-field)

DOM 推导：`defaultProps.suffixCls = 'input-number'`（NumberField.tsx）；TextField 的 `suffixCls: 'input'`（TextField.tsx:177）对应 kit 中的 `c7n-pro-input`，故前缀 = `c7n-pro-` + suffixCls。wrapper 类 `${prefixCls}-wrapper`（ViewComponent.getWrapperClassNames）；按钮类 `-inner-button` / `-plus` / `-minus` / `-clear-button`（NumberField.getInnerSpanButton）。

```
span.c7n-pro-input-number-wrapper[.c7n-pro-input-number-step-suffix][.c7n-pro-input-number-invalid]
  ├── .c7n-pro-input-number-placeholder          # 仅空值时渲染
  └── label
        ├── input.c7n-pro-input-number[name=字段]  # 输入框
        ├── .c7n-pro-input-number-suffix          # 后缀，如 % 或单位
        └── .c7n-pro-input-number-inner-button    # 有 step：含 plus / minus
              ├── div.c7n-pro-input-number-plus
              └── div.c7n-pro-input-number-minus
        # 无 step 且可清空：同一节点改带 .c7n-pro-input-number-clear-button
```

`-invalid` 来自 FormField 校验态；`-disabled` / `-readonly` 来自 ViewComponent。

## 源码识别

1. JSX `<NumberField />`；DataSet Field `type: 'number'`（且无 `currency` / `percentage`）。
2. 设置 `step` → 出现 ↑↓ 按钮；键盘 ↑↓ 也步进（`keyboard` 默认 true）。
3. `precision: 0` → 不允许小数（allowDecimal）；`precision` 决定失焦后的舍入位数。
4. DataSet `range: true` → 起止两个输入（`-range-start` / `-range-end`）；`multiple: true` → 外层加 `-multiple`。
5. `numberGrouping` 默认 true：显示千分位，输入以纯数字为准。

## 分析产物

```yaml
field_rules:
  - name: quantity
    control: number          # number | currency | percent | range | number_range
    editable_when: [detail_edit]
```

`number_range` 对应 DataSet `range: true`（与 date_range 同构）。

## 自动化步骤

1. 定位：`.c7n-pro-input-number-wrapper:has(input[name="quantity"])`；功能层用 kit 键 `numberFieldWrapper` 再收窄。
2. 填值（推荐 `fillForm`，`fields` 用 `name` / `value` 形式，同 choerodon-table-queryBar.md 现有示例）：
   ```yaml
   - action: fillForm
     args:
       fields:
         - { name: quantity, value: "1000" }   # 纯数字，不带千分位
   ```
3. 失焦：`press Tab`，触发 blur 归一化（按 precision 舍入；以 `.` 结尾的中间态不会被提交）。
4. 步进（已设 `step`）：聚焦 input 后 `press ArrowUp` / `ArrowDown`；或 click `numberFieldPlus` / `numberFieldMinus`，只单击，不要长按。
5. 清空（无 step 时）：click `numberFieldClearButton`。
6. 断言：`input[name]` 的值；校验失败时包裹层带 `.c7n-pro-input-number-invalid`。超出 min/max 是截断还是报错 <<待核实：parseNumber 位于依赖包 dataset，本仓库未包含>>。

```yaml
# kit 草案（见 kit-choerodon-number-input.yaml）
numberFieldWrapper:
  css: '.c7n-pro-input-number-wrapper'
numberFieldInput:
  css: 'input.c7n-pro-input-number'
numberFieldSuffix:
  css: '.c7n-pro-input-number-suffix'
numberFieldPlus:
  css: '.c7n-pro-input-number-inner-button .c7n-pro-input-number-plus'
numberFieldMinus:
  css: '.c7n-pro-input-number-inner-button .c7n-pro-input-number-minus'
numberFieldClearButton:
  css: '.c7n-pro-input-number-clear-button'
```

## Currency

源码：[components-pro/currency](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/currency)

DOM 推导：`class Currency extends NumberField`，未覆盖 suffixCls，因此 DOM 与 NumberField **完全相同**，前缀仍是 `c7n-pro-input-number`，不存在 `c7n-pro-currency`。差异只在 `getFieldType()` 返回 `FieldType.currency` 以及 `getCurrencyFormatter`（Currency.tsx）。

```
span.c7n-pro-input-number-wrapper          # 与 NumberField 相同
  └── label
        └── input.c7n-pro-input-number[name=字段]
```

## 源码识别

1. JSX `<Currency currency="USD" dataSet={ds} name="money" />`；`currency` 为 ISO 货币代码（index.zh-CN.md）。
2. DataSet Field `type: 'currency'`（currency/demo/big-number.md），或 `type: 'number'` + `currency: 'USD'`（currency/demo/dataset.md；field/utils.tsx:190 `currency || type === currency` 走货币格式化）。
3. DOM 上无法区分 Currency 与 NumberField，只能靠源码 / DataSet 定义识别。

## 分析产物

```yaml
field_rules:
  - name: money
    control: currency
```

## 自动化步骤

1. 定位同 NumberField：`.c7n-pro-input-number-wrapper:has(input[name="money"])`。
2. 填值同 NumberField：`fillForm` 填纯数字，不带货币符号与千分位。
3. 断言优先看 DataSet 值或接口 payload；带货币符号 / 千分位的显示文本 <<待核实：获焦与失焦后 input.value 是否包含货币符号>>。

kit：不新增键，复用 `numberFieldWrapper` / `numberFieldInput`（DOM 相同）。

## PercentField

源码：[components-pro/percent-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/percent-field)

DOM 推导：`class PercentField extends NumberField`，`defaultProps.suffix = '%'`，`getWrapperClassNames` 追加 `${prefixCls}-percentage`（PercentField.tsx）。

```
span.c7n-pro-input-number-wrapper.c7n-pro-input-number-percentage
  └── label
        ├── input.c7n-pro-input-number[name=字段]
        └── .c7n-pro-input-number-suffix        # 文本 "%"
```

## 源码识别

1. JSX `<PercentField />`；DataSet Field `type: 'percentage'`（percent-field/demo/dataset.md）。
2. `precision`：值以小数存储，最小 2；显示小数位 = precision − 2（index.zh-CN.md）。
3. 显示单位是百分数：输入 `1.26` 显示 `1.26%`，DataSet 存 `0.0126`（processValue 乘 100，processPercentValue 除 100）。

## 分析产物

```yaml
field_rules:
  - name: discountRate
    control: percent
```

## 自动化步骤

1. 定位：`.c7n-pro-input-number-wrapper.c7n-pro-input-number-percentage:has(input[name="discountRate"])`。
2. 填值：`fillForm`，`value: "1.26"`（百分数单位，**不带 %**，不要填 `0.0126`）。
3. `press Tab` 失焦；断言 DataSet / 接口值为 `0.0126`。
4. `step` 按存储值（小数）计算，demo 中 `step: 0.0002` 对应显示 0.02%。

```yaml
percentFieldWrapper:
  css: '.c7n-pro-input-number-wrapper.c7n-pro-input-number-percentage'
```

## Range

源码：[components-pro/range](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/range)

DOM 推导：`suffixCls: 'range'`（Range.tsx）→ 前缀 `c7n-pro-range`。wrapper 由 `Range.renderWrapper` 输出 `<label>`，类 `${prefixCls}-wrapper`（纵向追加 `-wrapper-vertical`）；轨道、句柄、刻度类来自 range/style/index.less（`.@{range-prefix-cls}-rail` 等）。Slider 本体来自 `choerodon-ui/lib/slider`，不在本仓库。

```
label.c7n-pro-range-wrapper[.c7n-pro-range-wrapper-vertical]
  └── div.c7n-pro-range                              # Slider 根 <<待核实：挂载层级>>
        ├── .c7n-pro-range-rail                      # 底轨
        ├── .c7n-pro-range-track                     # 已选段
        ├── .c7n-pro-range-step
        ├── .c7n-pro-range-dot                       # dots 刻度点
        ├── .c7n-pro-range-mark > .c7n-pro-range-mark-text   # marks
        └── .c7n-pro-range-handle[.c7n-tooltip-open] # 句柄；双滑块为 2 个 <<待核实：tooltip 类名>>
```

易混：Range 的 `range` 属性是**双滑块**（值为 `[number, number]`）；DataSet `range: true` 是 NumberField 的起止输入框，二者不同。

## 源码识别

1. JSX `<Range dataSet={ds} name="score" min={0} max={100} step={5} marks={...} tipFormatter={...} />`。
2. DataSet 字段无 `type` 约束（range/demo/dataset.md 只设 defaultValue / min / max / step）。
3. **DOM 中没有 `<input>`**，不能用 `input[name]` 定位。

## 分析产物

```yaml
field_rules:
  - name: score
    control: range
```

## 自动化步骤

无专用关键字，用 click 与 press 组合：

1. 定位：`.c7n-pro-range-wrapper`；多个时限定到所在表单项或行内（within）。`name` 是否进入 DOM <<待核实：label 或 Slider 根是否带 name 属性>>。
2. 断言值：句柄 tooltip（`tooltipVisible` 默认 true，文本为 `tipFormatter(value)`）或 DataSet / 接口值。
3. 调整：click 句柄获得焦点后 `press ArrowRight` / `ArrowLeft`，每次一个 step <<待核实：Slider 键盘支持>>；精确值不依赖拖拽。
4. 禁用态：断言 `.c7n-pro-range-disabled`（less 定义），不再点击。

```yaml
rangeWrapper:
  css: '.c7n-pro-range-wrapper'
rangeHandle:
  css: '.c7n-pro-range-handle'
rangeTrack:
  css: '.c7n-pro-range-track'
rangeMarkText:
  css: '.c7n-pro-range-mark-text'
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 用 `input[name]` 定位 Range | Range 无 input，用 `.c7n-pro-range-wrapper` |
| 把 Range 的 `range` 当成 DataSet `range: true` | 前者双滑块，后者起止输入框（`number_range`） |
| PercentField 填 `0.0126` | 输入百分数单位 `1.26`，DataSet 存 `0.0126` |
| 找 `.c7n-pro-currency` | 无此前缀，DOM 同 NumberField |
| fill 带千分位的 `1,000` | 填纯数字，千分位仅用于显示 |
| fill 以 `.` 结尾的中间态 | 失焦后才归一化，断言前先 `press Tab` |

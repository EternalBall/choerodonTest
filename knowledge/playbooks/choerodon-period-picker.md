# Choerodon Pro 周期选择器（Month / Quarter / Week / Year）

四个组件均继承 [DatePicker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/date-picker)，仅在 `static defaultProps` 中设置 `mode`（`month` / `quarter` / `week` / `year`）；样式复用 `date-picker/style`。因此 DOM 前缀与 DatePicker 一致，均为 **`c7n-pro-calendar`**。

## 对照表

| 组件 | 源码目录 | mode | wrapper 附加类 | 可否直接 fill 输入 |
|------|----------|------|----------------|--------------------|
| MonthPicker | components-pro/month-picker | `month` | `-month-picker-wrapper` | 可（须按业务 format） |
| QuarterPicker | components-pro/quarter-picker | `quarter` | `-quarter-picker-wrapper` | 可 |
| WeekPicker | components-pro/week-picker | `week` | `-week-picker-wrapper` | **否**，只能点选（DatePicker.tsx:334） |
| YearPicker | components-pro/year-picker | `year` | `-year-picker-wrapper` | 可 |

| 易混 | 正确 |
|------|------|
| `<DatePicker mode="month" />` 与 `<MonthPicker />` | DOM 结构相同，但子类才会附加 `-month-picker-wrapper` |
| 找 `.c7n-pro-month-picker` | 前缀是 `c7n-pro-calendar-picker-*` |
| 周选择器 `fill` 日期字符串 | `isEditable()` 对 week 返回 false，改用点选 |
| 季度/年用 date 的 `-cell` 思路 | 面板类随 mode 变化（`-quarter-panel` / `-year-panel`） |

## 共用 DOM

```
.c7n-pro-calendar-picker-wrapper.c7n-pro-calendar-picker-<mode>-picker-wrapper
  └── .c7n-pro-calendar-picker                 # TriggerField 根
        ├── input.c7n-pro-input[name=字段]
        └── .c7n-pro-calendar-picker-suffix     # 日历图标，点开面板

# 弹出层（挂 body）
.c7n-pro-calendar-picker-popup.c7n-pro-calendar-picker-popup-<mode>
  ├── .c7n-pro-calendar-header                  # 翻页 / 视图切换
  ├── .c7n-pro-calendar-<mode>-panel            # 面板
  │     └── .c7n-pro-calendar-cell[-selected|-disabled|-in-range|-range-start|-range-end]
  │           └── .c7n-pro-calendar-cell-inner  # <<待核实:cell 内层结构>>
  └── .c7n-pro-calendar-footer                  # <<待核实:四者是否都渲染 footer>>
```

推导依据：`suffixCls: 'calendar-picker'`（date-picker/DatePicker.tsx:188）；wrapper = `${prefixCls}-wrapper` + 子类附加参数（core/ViewComponent.tsx:436-452 的 `...args`）；popup = `${prefixCls}-popup-${mode}`（DatePicker.tsx:408-413）；视图前缀 `c7n-pro-calendar`（date-picker/style/index.less 的 `@date-picker-prefix`）。

---

## MonthPicker

源码：[components-pro/month-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/month-picker)

### 源码识别

- JSX：`<MonthPicker />`；或 `<DatePicker mode="month" />`（无 `-month-picker-wrapper` 附加类）。
- DataSet Field：`type: month`（视图 `MonthsView` 的 `static type = FieldType.month`，MonthsView.tsx:13）。

### DOM 增量

```
wrapper 附加：.c7n-pro-calendar-picker-month-picker-wrapper
popup：.c7n-pro-calendar-picker-popup-month
面板：.c7n-pro-calendar-month-panel              # MonthsView.tsx:188
  header：.c7n-pro-calendar-prev-year / .c7n-pro-calendar-view-select / .c7n-pro-calendar-next-year   # MonthsView.tsx:111-118
  cell ：.c7n-pro-calendar-cell[-selected|-disabled|-in-range|...]   # MonthsView.tsx:149-155
```

### 分析产物

```yaml
field_rules:
  - name: statMonth
    control: month           # month | quarter | week | year
```

### 自动化步骤

1. **优先**：`fill` `input[name="statMonth"]` 为业务 format 字符串，再 Tab 失焦。默认 format 由 FormField.tsx:1064 `getDateFormat` → `getDateFormatByField` 决定，本次未展开 <<待核实:month 默认 format>>，用例中须显式给出。
2. **点选**：`click` `.c7n-pro-calendar-picker-suffix`，`waitFor` `.c7n-pro-calendar-picker-popup-month`。
3. 换年：在 popup 内 `click` `.c7n-pro-calendar-prev-year` / `.c7n-pro-calendar-next-year`。
4. 选月：在 popup 内 `click` 目标 `.c7n-pro-calendar-cell`，按文案过滤（月份文案格式 <<待核实>>），排除 `-disabled`。
5. 选中后 popup 关闭；`assertVisible` 输入框（值断言 <<待核实:是否有 assertValue 类关键字>>）。

```yaml
monthPickerWrapper:
  css: .c7n-pro-calendar-picker-month-picker-wrapper
monthPickerPopup:
  css: .c7n-pro-calendar-picker-popup-month
monthPickerCell:
  css: .c7n-pro-calendar-picker-popup-month .c7n-pro-calendar-cell:not(.c7n-pro-calendar-disabled)
```

---

## QuarterPicker

源码：[components-pro/quarter-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/quarter-picker)

### 源码识别

- JSX：`<QuarterPicker />`；或 `<DatePicker mode="quarter" />`。
- DataSet Field：`type: quarter`（QuartersView.tsx:13 `static type = FieldType.quarter`）。

### DOM 增量

```
wrapper 附加：.c7n-pro-calendar-picker-quarter-picker-wrapper
popup：.c7n-pro-calendar-picker-popup-quarter
面板：.c7n-pro-calendar-quarter-panel           # <<待核实:面板类名由 QuartersView 输出>>（less:227 存在 -quarter-panel）
  header：.c7n-pro-calendar-prev-year / -view-select / -next-year   # QuartersView.tsx:111-118
  cell ：.c7n-pro-calendar-cell[-selected|-disabled|-in-range|...]   # QuartersView.tsx:149-155
```

### 分析产物

```yaml
field_rules:
  - name: statQuarter
    control: quarter         # month | quarter | week | year
```

### 自动化步骤

1. **优先**：`fill` `input[name="statQuarter"]`（format 同 MonthPicker，须显式给出，不猜默认值）。
2. **点选**：`click` `.c7n-pro-calendar-picker-suffix`，`waitFor` `.c7n-pro-calendar-picker-popup-quarter`。
3. 换年：popup 内 `click` `.c7n-pro-calendar-prev-year` / `.c7n-pro-calendar-next-year`。
4. 选季：popup 内 `click` `.c7n-pro-calendar-cell`，按季度文案过滤（文案格式 <<待核实>>），排除 `-disabled`。

```yaml
quarterPickerWrapper:
  css: .c7n-pro-calendar-picker-quarter-picker-wrapper
quarterPickerPopup:
  css: .c7n-pro-calendar-picker-popup-quarter
quarterPickerCell:
  css: .c7n-pro-calendar-picker-popup-quarter .c7n-pro-calendar-cell:not(.c7n-pro-calendar-disabled)
```

---

## WeekPicker

源码：[components-pro/week-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/week-picker)

### 源码识别

- JSX：`<WeekPicker />`；或 `<DatePicker mode="week" />`。
- DataSet Field：`type: week`（WeeksView.tsx:15 `static type = FieldType.week`）。

### DOM 增量

```
wrapper 附加：.c7n-pro-calendar-picker-week-picker-wrapper
popup：.c7n-pro-calendar-picker-popup-week
面板：.c7n-pro-calendar-week-panel              # WeeksView.tsx:127
  header：.c7n-pro-calendar-prev-year / .c7n-pro-calendar-prev-month / -view-select / -next-month / -next-year   # 继承 DaysView.tsx:272-287
  cell ：.c7n-pro-calendar-cell + .c7n-pro-calendar-week-cell   # WeeksView.tsx:72-93
          状态：-selected / -old / -new / -in-range / -range-start / -range-end
  周序号：.c7n-pro-calendar-cell-inner 文本 `W{n}`（WeeksView.tsx:150） <<待核实:层级>>
footer：.c7n-pro-calendar-footer > .c7n-pro-calendar-footer-now-btn   # WeeksView.tsx:133-140，-now-disabled / -now-selected
```

### 分析产物

```yaml
field_rules:
  - name: statWeek
    control: week            # month | quarter | week | year
    editable: false          # 不可键入，仅点选
```

### 自动化步骤

1. **不要 `fill`**：周模式 `isEditable()` 返回 false（DatePicker.tsx:334），输入框不接受键入。
2. `click` `.c7n-pro-calendar-picker-suffix`，`waitFor` `.c7n-pro-calendar-picker-popup-week`。
3. 用例指定周：在 popup 内 `click` 目标周的日格 `.c7n-pro-calendar-cell`（排除 `-disabled`）。选择后整周生效（handleSelect 对 week 不做 format 归一化，DatePicker.tsx:824-833；具体写入值 <<待核实>>）。
4. 用例未指定周：`click` `.c7n-pro-calendar-footer-now-btn` 选当前周（`-now-disabled` 时不可点）。
5. 换周/换月：`click` `.c7n-pro-calendar-prev-month` / `.c7n-pro-calendar-next-month`。

```yaml
weekPickerWrapper:
  css: .c7n-pro-calendar-picker-week-picker-wrapper
weekPickerPopup:
  css: .c7n-pro-calendar-picker-popup-week
weekPickerCell:
  css: .c7n-pro-calendar-picker-popup-week .c7n-pro-calendar-cell:not(.c7n-pro-calendar-disabled)
weekPickerNowBtn:
  css: .c7n-pro-calendar-picker-popup-week .c7n-pro-calendar-footer-now-btn
```

---

## YearPicker

源码：[components-pro/year-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/year-picker)

### 源码识别

- JSX：`<YearPicker />`；或 `<DatePicker mode="year" />`。
- DataSet Field：`type: year`（YearsView.tsx:14 `static type = FieldType.year`）。

### DOM 增量

```
wrapper 附加：.c7n-pro-calendar-picker-year-picker-wrapper
popup：.c7n-pro-calendar-picker-popup-year
面板：.c7n-pro-calendar-year-panel              # YearsView.tsx:220
  header：.c7n-pro-calendar-prev-year / .c7n-pro-calendar-view-select / .c7n-pro-calendar-next-year   # YearsView.tsx:132-139
  cell ：.c7n-pro-calendar-cell[-old|-new|-selected|-disabled|-in-range|...]   # YearsView.tsx:177-185
```

`-old` / `-new` 为相邻年份（非当前十年内），勿当作可选年（除非业务允许）。

### 分析产物

```yaml
field_rules:
  - name: statYear
    control: year            # month | quarter | week | year
```

### 自动化步骤

1. **优先**：`fill` `input[name="statYear"]`（format 须显式给出 <<待核实:year 默认 format>>）。
2. **点选**：`click` `.c7n-pro-calendar-picker-suffix`，`waitFor` `.c7n-pro-calendar-picker-popup-year`。
3. 换十年：popup 内 `click` `.c7n-pro-calendar-prev-year` / `.c7n-pro-calendar-next-year`。
4. 选年：popup 内 `click` `.c7n-pro-calendar-cell`，按年份文案过滤（文案格式 <<待核实>>），排除 `-disabled` / `-old` / `-new`。

```yaml
yearPickerWrapper:
  css: .c7n-pro-calendar-picker-year-picker-wrapper
yearPickerPopup:
  css: .c7n-pro-calendar-picker-popup-year
yearPickerCell:
  css: .c7n-pro-calendar-picker-popup-year .c7n-pro-calendar-cell:not(.c7n-pro-calendar-disabled):not(.c7n-pro-calendar-old):not(.c7n-pro-calendar-new)
```

---

## 通用注意

- 四者的 wrapper 都含 `.c7n-pro-calendar-picker-wrapper`，因此 kit 中已有的 `datePickerWrapper` / `datePickerSuffix` / `datePickerPopup` 也能匹配到周期选择器；需要区分 mode 时用本文的 `*PickerWrapper` / `*PickerPopup`。
- 弹出层挂在 body，选择时用 popup 限定作用域，避免与页面其他日历冲突。
- 不要把 Field `type` 与 `control` 混为一谈：`control` 是分析产物字段，`type` 是 DataSet 源码字段。

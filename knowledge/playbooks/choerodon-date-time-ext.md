# Choerodon Pro DateTimePicker / TimePicker（日期时间、时间选择）

源码：[components-pro/date-time-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/date-time-picker)、[components-pro/time-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/time-picker)。  
二者均为 [DatePicker](./choerodon-date-picker.md) 的子类（`extends DatePicker`），只覆盖 `defaultProps.mode` 与 wrapper 类名，DOM 与交互沿用 DatePicker。样式复用 `date-picker/style`（两目录的 `style/index.tsx` 仅 import 它，无自有 less）。  
建议新增的 kit 键汇总见 `kit-choerodon-date-time-ext.yaml`（未并入 `kit.yaml`）。

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **DatePicker** | `<DatePicker>`，mode 默认 `date` | 日历面板（DaysView）；见 [choerodon-date-picker.md](./choerodon-date-picker.md) |
| **DateTimePicker** | `<DateTimePicker>`；DataSet `type: dateTime` | 日历 + 时间，面板类 `-popup-datetime`；wrapper 多 `-date-time-picker-wrapper` |
| **TimePicker** | `<TimePicker>`；DataSet `type: time` | 仅时/分/秒列，面板类 `-popup-time`；wrapper 多 `-time-picker-wrapper` |
| 原生 `input[type=time/datetime-local]` | — | Pro 使用自绘面板 + text input，勿用原生选择器 |

## DateTimePicker

源码：`date-time-picker/DateTimePicker.tsx`。`defaultProps = { ...DatePicker.defaultProps, mode: ViewMode.dateTime }`。

### DOM 推导

- 前缀：DatePicker `suffixCls: 'calendar-picker'`（DatePicker.tsx:188）+ `c7n-pro-` → `c7n-pro-calendar-picker`。
- wrapper：`getWrapperClassNames` 传入 `${prefixCls}-date-time-picker-wrapper`（ViewComponent 基类拼接 `${prefixCls}-wrapper`）。
- 弹层：`getPopupClassName` 追加 `${prefixCls}-popup-${mode 小写}`（DatePicker.tsx:408-416）。
- 面板视图：`DateTimesView.getViewClassName()` = `${calendar}-datetime`（DateTimesView.tsx:23-25）；视图 `suffixCls: 'calendar'`（DaysView.tsx:52）→ 前缀 `c7n-pro-calendar`。

```
.c7n-pro-calendar-picker-wrapper.c7n-pro-calendar-picker-date-time-picker-wrapper
  └── .c7n-pro-calendar-picker
        ├── input.c7n-pro-input[name=字段]
        └── .c7n-pro-calendar-picker-suffix          # 点开面板

# 弹出层（挂 body）
.c7n-pro-calendar-picker-popup.c7n-pro-calendar-picker-popup-datetime
  └── .c7n-pro-calendar-datetime-wrapper
        └── .c7n-pro-calendar-datetime                # DateTimesView 根
              ├── .c7n-pro-calendar-body
              │     └── .c7n-pro-calendar-cell > .c7n-pro-calendar-cell-inner   # 点选日
              ├── <<待核实：DateTimesView 时间列类名>>
              └── .c7n-pro-calendar-footer
                    └── .c7n-pro-calendar-footer-now-btn   # 此刻 / 今天（DateTimesView.tsx:71）
```

选中/禁用/区间沿用 DatePicker：`.c7n-pro-calendar-selected`、`.c7n-pro-calendar-disabled`。

### 源码识别

1. JSX `<DateTimePicker />`（index.tsx default export）；DataSet Field `type: dateTime`（DateTimesView.tsx:17 `static type = FieldType.dateTime`）。
2. 与 DatePicker 的差异：`mode` 固定为 dateTime；`getLimitWithType` 原样返回 limit，min/max 不做日粒度收缩，断言禁用态时勿套用 DatePicker 规则。
3. `format` 决定可直接 `fill` 的字符串形态（业务配置；默认 format <<待核实>>）。

### 分析产物

```yaml
field_rules:
  - name: publishTime
    control: dateTime        # date | dateTime | time | date_range
    editable_when: [detail_edit]
```

### 自动化步骤

1. 定位：`.c7n-pro-calendar-picker-date-time-picker-wrapper:has(input[name="publishTime"])`；功能层优先用 kit 键 `dateTimePickerWrapper`。
2. **优先直接填值**：`fill` 输入框，字符串需符合 format（假设 `YYYY-MM-DD HH:mm:ss`，需与业务 format 一致），再 `press` Tab 失焦触发校验。
3. **面板点选**（需测面板 UI 时）：
   - `click` `dateTimePickerSuffix` → `waitFor` `dateTimePickerPopup`；
   - `click` 日期格 `dateTimePickerCell`（避开 `-disabled`）；
   - 在时间列点目标时/分/秒 `cell-inner`（按文本过滤，如 "10"）；
   - 点 `dateTimePickerNowBtn` 或业务确定按钮结束。
4. 结果校验：`assertVisible` 断言弹层已关闭或输入框值可见；需要精确值时读取 input value 再比对。

```yaml
# kit（建议新增，见 kit-choerodon-date-time-ext.yaml）
dateTimePickerWrapper:
  css: .c7n-pro-calendar-picker-date-time-picker-wrapper
dateTimePickerPopup:
  css: .c7n-pro-calendar-picker-popup-datetime
```

## TimePicker

源码：`time-picker/TimePicker.tsx`。`defaultProps = { ...DatePicker.defaultProps, mode: ViewMode.time }`。

### DOM 推导

- 前缀与 DateTimePicker 相同：`c7n-pro-calendar-picker`。
- wrapper：`${prefixCls}-time-picker-wrapper`（TimePicker.tsx:15）。
- 弹层：`-popup-time`（DatePicker.tsx:412，`String(mode).toLowerCase()`）。
- 面板视图：`TimesView.getViewClassName()` = `${calendar}-time`（TimesView.tsx:46-49），面板 `getPanelClass()` = `${calendar}-time-panel`（TimesView.tsx:458-460）。

```
.c7n-pro-calendar-picker-wrapper.c7n-pro-calendar-picker-time-picker-wrapper
  └── .c7n-pro-calendar-picker
        ├── input.c7n-pro-input[name=字段]
        └── .c7n-pro-calendar-picker-suffix

# 弹出层（挂 body）
.c7n-pro-calendar-picker-popup.c7n-pro-calendar-picker-popup-time
  └── .c7n-pro-calendar-time                         # TimesView 根
        ├── .c7n-pro-calendar-time-panel
        │     └── .c7n-pro-calendar-time-panel-inner  # TimesView.tsx:379
        │           └── .c7n-pro-calendar-time-list    # 每一列（时 / 分 / 秒）
        │                 ├── ul > li.c7n-pro-calendar-cell[.c7n-pro-calendar-selected][.c7n-pro-calendar-disabled]
        │                 │         └── .c7n-pro-calendar-cell-inner
        │                 └── .c7n-pro-calendar-time-focus       # 高亮条
        └── .c7n-pro-calendar-footer
              └── .c7n-pro-calendar-footer-now-btn               # TimesView.tsx:344
```

列嵌套与 `-time-focus-active` 的挂载位置以 `renderPanelBody` 为准（<<待核实>>）。

### 源码识别

1. JSX `<TimePicker />`（index.tsx default export）；DataSet Field `type: time`（TimesView.tsx:37 `static type = FieldType.time`）。
2. `getLimitWithType` 同样原样返回 limit；面板只渲染时间列，不出现日历格。
3. 默认 format（如 `HH:mm:ss`）<<待核实>>，以业务配置为准。

### 分析产物

```yaml
field_rules:
  - name: startTime
    control: time            # date | dateTime | time | date_range
```

### 自动化步骤

1. 定位：`.c7n-pro-calendar-picker-time-picker-wrapper:has(input[name="startTime"])`；功能层用 kit 键 `timePickerWrapper`。
2. **优先直接填值**：`fill` 输入框（假设 format `HH:mm:ss`，填 `10:30:00`），`press` Tab 失焦。
3. **面板点选**：
   - `click` `timePickerSuffix` 或 input → `waitFor` `timePickerPopup`；
   - 依次在各列点目标 `timePickerCell`（按文本过滤，如 "10"、"30"）；
   - 如有 now / 确认按钮，`click` `timePickerNowBtn`。
4. 校验：`assertVisible` 断言弹层关闭；精确值读取 input value 比对。

```yaml
# kit（建议新增，见 kit-choerodon-date-time-ext.yaml）
timePickerWrapper:
  css: .c7n-pro-calendar-picker-time-picker-wrapper
timePickerPopup:
  css: .c7n-pro-calendar-picker-popup-time
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 用 DatePicker 的 `.c7n-pro-calendar-picker-wrapper` 直接选 DateTimePicker | 两者 wrapper 都有该类，需加 `-date-time-picker-wrapper` / `-time-picker-wrapper` 区分 |
| 把 `.c7n-pro-date-time-picker` 当前缀 | 前缀是 `c7n-pro-calendar-picker`，子类名只出现在 wrapper 扩展类中 |
| TimePicker 去点日历格 | 面板只有时间列，点 `-time-list` 内的 `cell-inner` |
| 忽略 `-disabled` 格 | 时间与日期格都可能禁用，点击前检查 `.c7n-pro-calendar-disabled` |
| 把 `fill` 的字符串与 format 不一致 | 先确认 format，再 `fill`，否则校验失败 |

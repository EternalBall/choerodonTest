# Choerodon 旧版日期 / 时间 / 日历（choerodon-ui，非 Pro）

## 旧版 vs Pro 区分

| 维度 | 旧版（本册，`choerodon-ui`） | Pro（`choerodon-ui/pro`，见下方交叉链接） |
|------|------|------|
| JSX 导入 | `import { DatePicker, TimePicker, Calendar } from 'choerodon-ui'`（demo 证实：`date-picker/demo/time.md`、`time-picker/demo/basic.md`、`calendar/demo/basic.md`） | `choerodon-ui/pro`（<<待核实:Pro 入口路径>>） |
| 类名前缀 | `c7n-`（`getPrefixCls(suffix)` → `c7n-<suffix>`） | `c7n-pro-`（如 `c7n-pro-calendar-picker-wrapper`） |
| 日期选择器 DOM | `c7n-calendar-picker` | `c7n-pro-calendar-picker-wrapper` |
| 时间选择器 DOM | 独立 `c7n-time-picker`；DatePicker 的 showTime 为 `c7n-calendar-time-picker` | `c7n-pro-calendar-picker-time-picker-wrapper` |
| 日历面板 | `c7n-fullcalendar`（不是 `c7n-calendar`） | 无 Calendar 手册 |
| 是否绑定 DataSet | **否**（三个源码目录无 `dataSet` 用法） | 是（Field `type` / `format`） |

类名推导依据：`components/configure/default.tsx:96` `prefixCls: 'c7n'`，`:97` `proPrefixCls: 'c7n-pro'`；`components/configure/utils.tsx:14-18` `getPrefixCls(suffixCls)` 返回 `` `${getConfig('prefixCls')}-${suffixCls}` ``。因此本册所有类名都是 `c7n-` 开头，**不带 `pro-`**。

Pro 版交叉链接：[choerodon-date-picker.md](./choerodon-date-picker.md)（DatePicker）、[choerodon-date-time-ext.md](./choerodon-date-time-ext.md)（Pro DateTimePicker / TimePicker）、[choerodon-period-picker.md](./choerodon-period-picker.md)（Pro Month/Week/Quarter/Year）。

## DatePicker（DatePicker / RangePicker / MonthPicker / WeekPicker）

源码：[components/date-picker](https://github.com/open-hand/choerodon-ui/tree/master/components/date-picker)

入口 `date-picker/index.tsx:10-18` 导出四种形态；底层面板统一 `getPrefixCls('calendar')`（`createPicker.tsx:137`、`RangePicker.tsx:244`、`wrapPicker.tsx:108`）→ `c7n-calendar`。

| 形态 | JSX | DOM 差异 |
|------|-----|---------|
| 单日 | `<DatePicker>` | 单个 `input.c7n-calendar-picker-input` |
| 区间 | `<DatePicker.RangePicker>` | `span.c7n-calendar-range-picker` 内两个 `input.c7n-calendar-range-picker-input`，中间 `.c7n-calendar-range-picker-separator`（RangePicker.tsx:344-365） |
| 月 | `<DatePicker.MonthPicker>` | 面板根追加 `.c7n-calendar-month`（createPicker.tsx:151） |
| 周 | `<DatePicker.WeekPicker>` | 选中周格 `.c7n-calendar-selected-day`（WeekPicker.tsx:63） |

```
span.c7n-calendar-picker[.c7n-calendar-picker-large|-small]      # wrapPicker.tsx:109-110
  ├── span.c7n-input-wrapper                                      # wrapPicker.tsx:117
  │     └── input.c7n-calendar-picker-input.c7n-input             # wrapPicker.tsx:112；name 透传 <<待核实:name 属性>>
  ├── span.c7n-calendar-picker-clear                              # allowClear，createPicker.tsx:203
  └── span.c7n-calendar-picker-icon-wrapper                       # 点击开面板，createPicker.tsx:212
        └── i.icon.icon-date_range.c7n-calendar-picker-icon       # Icon 渲染，components/icon/index.tsx:28

# 弹层（挂 body，getPopupContainer 可改）
.c7n-calendar-picker-container                                    # createPicker.tsx:250
  └── .c7n-calendar[.c7n-calendar-time][.c7n-calendar-month]      # createPicker.tsx:149-152
        ├── .c7n-calendar-panel > .c7n-calendar-date-panel
        │     └── table.c7n-calendar-table > td.c7n-calendar-cell  # rc-components/calendar/date/DateTBody.jsx:50
        │           ├── .c7n-calendar-today                       # DateTBody.jsx:53
        │           ├── .c7n-calendar-selected-day                 # DateTBody.jsx:54
        │           ├── .c7n-calendar-last-month-cell              # DateTBody.jsx:59
        │           └── .c7n-calendar-disabled-cell                # DateTBody.jsx:61，不可点
        ├── .c7n-calendar-time-picker                             # showTime，rc-components/calendar/Calendar.jsx:249
        └── .c7n-calendar-footer / .c7n-calendar-footer-extra      # RangeCalendar.jsx:603；createPicker.tsx:67
```

源码识别：
- JSX 标签 `DatePicker` / `DatePicker.RangePicker` / `.MonthPicker` / `.WeekPicker`，import 来自 `choerodon-ui`。
- 无 DataSet 绑定，字段归属只能靠 JSX 与表单绑定；`name` 属性是否透传 <<待核实:name 属性>>。
- `showTime` 为真 → 面板含时间列（`createPicker.tsx:150`；`wrapPicker.tsx:129` 追加 `c7n-calendar-time-picker-column-N`）。
- `format` 决定 `fill` 的字符串形态；文档默认 `YYYY-MM-DD`，区间默认 `YYYY-MM-DD HH:mm:ss`（`date-picker/index.zh-CN.md`）。
- `disabledDate` 命中的格带 `.c7n-calendar-disabled-cell`，不可点。

分析产物（`control` 取值为本册新约定，<<待核实:分析器是否接受 legacy_ 前缀>>）：

```yaml
field_rules:
  - name: startDate
    control: legacy_date_picker      # legacy_date_picker | legacy_range_picker | legacy_month_picker | legacy_week_picker
    format: YYYY-MM-DD
    show_time: false
```

自动化步骤：
1. 定位：`.c7n-calendar-picker:has(input.c7n-calendar-picker-input)`，限定到表单项（within）；同页多个时按表单项 label 收窄。
2. 直接输入（优先）：`fill` 为 `format` 字符串，再 `press` `Tab` 使值生效（<<待核实:解析触发键>>）。
3. 面板点选：`click` `.c7n-calendar-picker-icon-wrapper` → `assertVisible` `.c7n-calendar-picker-container` → `click` `td.c7n-calendar-cell:not(.c7n-calendar-disabled-cell):not(.c7n-calendar-last-month-cell)`，用 `exactText` 选日号。
4. showTime：点时间列选项，再点确定按钮（<<待核实:确定按钮类名>>）。
5. RangePicker：`click` 第一个 input → 点开始日 → `click` 第二个 input → 点结束日。
6. 关键字：无日期专用关键字，全部用 `fill` / `click` / `press` 组合；**不用** `pickSelect`（其 `selectPopup` 指向 Pro 的 `.c7n-pro-select-popup`，与旧版 DatePicker 无关）。

建议新增 kit：

```yaml
legacyDatePickerWrapper:
  css: .c7n-calendar-picker
  note: '旧版日期选择器外层；Pro 为 c7n-pro-calendar-picker-wrapper'

legacyDatePickerInput:
  css: input.c7n-calendar-picker-input
  note: '单日输入框；功能层 within 表单项收窄'

legacyDatePickerIcon:
  css: .c7n-calendar-picker-icon-wrapper
  note: '点击打开面板'

legacyDatePickerPopup:
  css: .c7n-calendar-picker-container
  note: '打开态挂 body'

legacyDatePickerCell:
  css: .c7n-calendar-picker-container td.c7n-calendar-cell:not(.c7n-calendar-disabled-cell)
  note: '点日期前排除禁用格；用 exactText 选日号'

legacyRangePickerWrapper:
  css: .c7n-calendar-range-picker
  note: '区间选择器外层'

legacyRangePickerInput:
  css: input.c7n-calendar-range-picker-input
  note: '两个输入框：nth=0 开始，nth=1 结束'
```

## TimePicker

源码：[components/time-picker](https://github.com/open-hand/choerodon-ui/tree/master/components/time-picker)

前缀 `getPrefixCls('time-picker', props.prefixCls)`（`time-picker/index.tsx:145`）→ `c7n-time-picker`；底层为 `rc-components/time-picker`（`TimePicker.jsx:17` 默认 `rc-time-picker`，被覆盖）。DatePicker 的 showTime 不走此前缀，而用 `c7n-calendar-time-picker`（`wrapPicker.tsx:134`）。

| 场景 | 根类 | 面板类 |
|------|------|--------|
| 独立 `<TimePicker>` | `span.c7n-time-picker`（`TimePicker.jsx:248`） | 弹层 `.c7n-time-picker-panel`（`TimePicker.jsx:136`） |
| DatePicker `showTime` | `.c7n-calendar-picker`（见上节） | `.c7n-calendar-time-picker` |

```
span.c7n-time-picker[.c7n-time-picker-small|-large]              # index.tsx:148；TimePicker.jsx:248
  ├── .c7n-time-picker-input                                      # TimePicker.jsx:250
  └── .c7n-time-picker-icon                                       # av_timer 图标，TimePicker.jsx:262/269

# 弹层（挂 body）
.c7n-time-picker-panel[.c7n-time-picker-panel-narrow][.c7n-time-picker-panel-column-N]   # TimePicker.jsx:171,186
  └── .c7n-time-picker-panel-inner                                # rc-components/time-picker/Panel.jsx:106
        ├── .c7n-time-picker-panel-select                         # 时/分/秒列，index.less:82
        │     └── li.c7n-time-picker-panel-select-option[-selected|-disabled]   # index.less:135,143
        └── .c7n-time-picker-panel-addon                          # addon 插槽，index.tsx:152
```

源码识别：
- JSX 标签 `TimePicker`，import 自 `choerodon-ui`（`time-picker/demo/basic.md`）。
- `value` / `defaultValue` 必须是 moment，否则构造时抛错（`index.tsx:84-85`）。
- `format` 默认 `HH:mm:ss`；`use12Hours` 为真时默认 `h:mm:ss a`（`index.tsx:127-135`）。
- `hourStep` / `minuteStep` / `secondStep` 决定选项粒度；`disabledHours` 等命中的项带 `-option-disabled`。

分析产物（同上，`control` 为本册新约定）：

```yaml
field_rules:
  - name: startTime
    control: legacy_time_picker      # 与 Pro 的 time 区分
    format: HH:mm:ss
```

自动化步骤：
1. 定位：`.c7n-time-picker:has(input.c7n-time-picker-input)`，within 表单项。
2. 直接输入：`fill` 为 `format` 字符串（`inputReadOnly` 默认 false，`TimePicker.jsx:19`，可输入）；再 `press` `Enter`（<<待核实:解析触发键>>）。
3. 面板选择：`click` `.c7n-time-picker-input` → `assertVisible` `.c7n-time-picker-panel` → 按列 `nth` 点 `.c7n-time-picker-panel-select li`，文案用 `exactText`（如 `09`）→ 点面板外空白关闭。
4. 跳过 `-option-disabled` 的选项。
5. 关键字：无时间专用关键字；`pickSelect` 不适用（同上）。

建议新增 kit：

```yaml
legacyTimePickerRoot:
  css: .c7n-time-picker
  note: '旧版独立时间选择器外层；DatePicker showTime 不用此类'

legacyTimePickerInput:
  css: .c7n-time-picker-input
  note: '输入框；功能层 within 表单项收窄'

legacyTimePickerPanel:
  css: .c7n-time-picker-panel
  note: '打开态弹层，挂 body'

legacyTimePickerColumn:
  css: .c7n-time-picker-panel-select
  note: '时/分/秒列，多列时用 nth 区分'

legacyTimePickerOption:
  css: .c7n-time-picker-panel-select li
  note: '选项；用 exactText 选值；-option-disabled 不可点'
```

## Calendar（展示型日历）

源码：[components/calendar](https://github.com/open-hand/choerodon-ui/tree/master/components/calendar)

这是**展示型**日历，不是表单控件，也不是 DatePicker 的弹层。前缀 `getPrefixCls('fullcalendar')`（`calendar/index.tsx:104`）→ `c7n-fullcalendar`。

| 组件 | 类前缀 | 用途 |
|------|--------|------|
| Calendar | `c7n-fullcalendar` | 全屏/非全屏日历，格内可渲染业务内容 |
| DatePicker 弹层 | `c7n-calendar` | 选择器面板（上节） |

```
div.c7n-fullcalendar-fullscreen[.{className}]                     # calendar/index.tsx:197-199，fullscreen 默认 true
  ├── .c7n-fullcalendar-header                                    # Header.tsx:176；headerRender 时整体替换
  │     ├── .c7n-fullcalendar-year-select                          # Header.tsx:59
  │     ├── .c7n-fullcalendar-month-select                         # Header.tsx:103
  │     └── .c7n-radio-group                                       # 年/月类型切换，<<待核实:radio DOM>>
  └── .c7n-fullcalendar-full[.c7n-fullcalendar-fullscreen]        # rc-components/calendar/FullCalendar.jsx:115-118
        ├── .c7n-fullcalendar-calendar-body                        # FullCalendar.jsx:109
        ├── .c7n-fullcalendar-date                                 # 日视图格，calendar/index.tsx:122
        │     ├── .c7n-fullcalendar-value                          # 日期号（zerofixed）
        │     └── .c7n-fullcalendar-content                        # dateCellRender 返回内容
        └── .c7n-fullcalendar-month                                # 月视图格，calendar/index.tsx:111-113
```

源码识别：
- JSX 标签 `Calendar`，import 自 `choerodon-ui`（`calendar/demo/basic.md`）。
- 无 Field 绑定，视为**只读展示**，不 `fill`。
- `dateCellRender`（追加）/ `dateFullCellRender`（覆盖）/ `monthCellRender` 决定格内内容；按 render 返回的业务节点识别。
- `headerRender` 存在时，`.c7n-fullcalendar-header` 不渲染（`calendar/index.tsx:212-219`）。
- `validRange` 之外的日期被置为禁用（`index.tsx:206-208`）。

分析产物：

```yaml
field_rules:
  - name: scheduleCalendar
    control: legacy_calendar         # 展示型，不作为表单输入
    editable: false
```

自动化步骤：
1. 根：页面内唯一时用 `.c7n-fullcalendar-fullscreen`；多个时 within 卡片或 Tab 面板。
2. `waitFor` `.c7n-fullcalendar-header` 可见后再操作。
3. 切年/月：`click` `.c7n-fullcalendar-month-select`，再 `click` 选项文案（下拉类名 <<待核实:旧版下拉弹层类名>>；不用 `pickSelect`）。
4. 点日期格：`click` `.c7n-fullcalendar-date:has(.c7n-fullcalendar-value:text-is("15"))`（日号用 `text-is` 精确匹配）。
5. 断言格内内容：`assertVisible` 限定在 `.c7n-fullcalendar-content` 内的业务文本。
6. 关键字：无日历专用关键字；日历内含 `table`，但**不用** `assertTableHasRows`。

建议新增 kit：

```yaml
legacyCalendarRoot:
  css: .c7n-fullcalendar-fullscreen
  note: '全屏日历根（fullscreen 默认 true）；非全屏类名 <<待核实>>'

legacyCalendarHeader:
  css: .c7n-fullcalendar-header
  note: '头部；headerRender 时不存在'

legacyCalendarYearSelect:
  css: .c7n-fullcalendar-year-select
  note: '年份切换'

legacyCalendarMonthSelect:
  css: .c7n-fullcalendar-month-select
  note: '月份切换'

legacyCalendarDateCell:
  css: .c7n-fullcalendar-date
  note: '日视图格；用 .c7n-fullcalendar-value 文案定位日号'

legacyCalendarMonthCell:
  css: .c7n-fullcalendar-month
  note: '月视图格'
```

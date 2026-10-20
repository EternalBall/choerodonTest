# Choerodon Pro DatePicker

源码：[components-pro/date-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/date-picker)。  
样式前缀为 **`c7n-pro-calendar`**（不是 `date-picker`）；wrapper 为 `.c7n-pro-calendar-picker-wrapper`。

## mode

| mode | 用途 |
|------|------|
| `date`（默认） | 年月日 |
| `dateTime` | 日期+时间 |
| `time` | 仅时间 |
| `year` / `month` / `week` / `quarter` | 粗粒度 |

`range`（TriggerField）：起止日期；面板可有 `comboRangeMode` 双月并列。

## DOM

```
.c7n-pro-calendar-picker-wrapper
  └── .c7n-pro-calendar-picker
        ├── input.c7n-pro-input[name=字段]     # 也可直接填格式化字符串
        └── .c7n-pro-calendar-picker-suffix     # 日历图标，点开面板

# 弹出
.c7n-pro-calendar-picker-popup[.c7n-pro-calendar-picker-popup-datetime]
  ├── .c7n-pro-calendar-header                 # 年月翻页
  ├── .c7n-pro-calendar-body
  │     └── td.c7n-pro-calendar-cell
  │           └── .c7n-pro-calendar-cell-inner  # 点选日
  ├── .c7n-pro-calendar-time                   # dateTime / time
  └── .c7n-pro-calendar-footer
        ├── .c7n-pro-calendar-footer-now-btn   # 此刻/今天
        └── .c7n-pro-calendar-footer … 确定    # 部分 mode 需点确认
```

选中格：`.c7n-pro-calendar-selected`。区间：`-range-start` / `-range-end` / `-in-range`。

## 源码识别

- `<DatePicker mode="dateTime" />` 或 Field `type: date|dateTime|time|week|month|year`  
- `format`（如 `YYYY-MM-DD`）决定可直接 `fill` 的字符串形态  
- `min` / `max` / `filter` → 禁用格 `.c7n-pro-calendar-disabled`，勿点  

## 分析产物

```yaml
field_rules:
  - name: creationDate
    control: date           # date | dateTime | time | date_range
```

## 自动化步骤（推荐）

**优先**：对 `input[name=字段]` **直接 `fill` 合法格式字符串**（快、稳），再 Tab/失焦触发校验。

**面板点选**（须测日历 UI 时）：

1. `click` `.c7n-pro-calendar-picker-suffix` 或 input  
2. 等待 `.c7n-pro-calendar-picker-popup`  
3. 点目标 `.c7n-pro-calendar-cell-inner`（避开 `-disabled` / `-old` / `-new` 若业务要求当月）  
4. `dateTime`：再选 time 列；必要时点 footer 确定  

区间：依次点开始日、结束日（或两个 input）。

```yaml
datePickerPopup:
  css: .c7n-pro-calendar-picker-popup
datePickerSuffix:
  css: .c7n-pro-calendar-picker-wrapper .c7n-pro-calendar-picker-suffix
```

## 常见误判

| 错误 | 正确 |
|------|------|
| 找 `.c7n-pro-date-picker` | 前缀是 **`calendar-picker`** |
| 把禁用日当可选 | 看 `-disabled` |
| 与原生 `input[type=date]` 混用 | Pro 用自绘面板 + text input |

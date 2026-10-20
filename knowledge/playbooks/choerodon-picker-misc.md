# Choerodon Pro 颜色 / 图标 / 评分选择（ColorPicker · IconPicker · Rate）

本册覆盖三个 Pro 表单控件：颜色选择、图标选择、评分。ColorPicker、IconPicker 继承 [TriggerField](https://github.com/open-hand/choerodon-ui/blob/master/components-pro/trigger-field)（点击弹层）；Rate 继承 FormField（点星直接改值，无弹层）。机器可读定位：`kit.yaml`（`colorPicker*` / `iconPicker*` / `rate*`，建议新增键见 `/tmp/pb/kit-choerodon-picker-misc.yaml`）。

类名前缀约定：Pro 全局前缀 `c7n-pro-`，`suffixCls` 拼接为 `c7n-pro-<suffixCls>`；wrapper 为 `${prefixCls}-wrapper`（`core/ViewComponent.tsx`）。<<待核实:Trigger 默认弹层根类名的基础实现在 choerodon-ui/lib 中，本仓库不可见，以下 popup 类名由 less 嵌套推导>>

## 1. ColorPicker（颜色选择器）

源码：[components-pro/color-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/color-picker)

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **ColorPicker**（default） | `<ColorPicker>`；DataSet `type: 'color'` | 点触发器（调色盘图标）→ 色板弹层；值为色值字符串 |
| **ColorPicker**（button） | `mode="button"` | 无图标，触发器本身是色块；可用 `renderer` 自定义 |
| **Select** | `lookupCode` | 下拉菜单，无色板，勿与颜色混用 |

DOM 结构（`suffixCls: 'color-picker'`，`ColorPicker.tsx` 第 61 行推导）：

```
.c7n-pro-color-picker-wrapper[.c7n-pro-color-picker-button]   # mode=button 时加修饰类（ColorPicker.tsx getWrapperClassNames）
  └── .c7n-pro-color-picker
        ├── .c7n-pro-color-picker-prefix > span.c7n-pro-color-picker-color   # 色块；button 模式为 -button-color
        ├── input.c7n-pro-input[name=字段]
        └── .c7n-pro-color-picker-trigger   # palette 图标，button 模式不渲染

# 弹层（popup 挂 body）
.c7n-pro-color-picker-popup
  ├── .c7n-pro-color-picker-no-fill                    # 「无填充」按钮（preset 开启时）
  ├── .c7n-pro-color-picker-popup-view-palettes
  │     └── .c7n-pro-color-picker-popup-view-palettes-block[-active]   # 备选色块
  ├── .c7n-pro-color-picker-mode-tabs                  # 单色 / 渐变切换（gradientMode 为数组时）
  ├── .c7n-pro-color-picker-popup-footer               # 色相/透明度滑块 + RGBA 输入
  └── .c7n-pro-color-picker-gradient-editor            # 渐变编辑：色标轨道、色标行、方向、CSS 文本
        ├── button[aria-label="Add color stop"].c7n-pro-color-picker-stop-add
        ├── input[aria-label="Color stop N color"]     # 色标颜色
        └── textarea[aria-label="Gradient CSS"].c7n-pro-color-picker-gradient-text
```

### 源码识别

1. JSX：`<ColorPicker />`；DataSet 字段 `{ name: 'color', type: 'color' }`（`components-pro/table/utils.tsx` 第 124 行 `FieldType.color` 映射到 ColorPicker；demo `dataset.md`）。
2. 取值：`defaultValue="#ff0000"`（默认值）；渐变模式下值为 `linear-gradient(...)` CSS 字符串。
3. 多选无效：`multiple` 对 ColorPicker 与 DataSet 字段均无效（`index.zh-CN.md` 注意事项）。

### 分析产物

```yaml
field_rules:
  - name: themeColor
    control: color_picker    # 命名同 select_box 风格；按项目分析器约定确认
    editable_when: [detail_edit]
```

### 自动化步骤

1. 定位：`.c7n-pro-color-picker-wrapper:has(input[name="themeColor"])`（或功能层 key `colorPickerWrapper`）。
2. 打开：`click` `colorPickerTrigger`（button 模式点色块 `.c7n-pro-color-picker-prefix`）→ `waitFor` `colorPickerPopup`。
3. 选备选色：`click` `.c7n-pro-color-picker-popup-view-palettes-block` 中目标块（通常用 `nth` 或 `title` 限定，取第一块即可）。
4. 无填充：`click` `.c7n-pro-color-picker-no-fill`。
5. 精确色值：源码未证实 hex 输入框的稳定选择器（footer 输入在 `.c7n-pro-color-picker-popup-footer-input-color` 内，input 标签 <<待核实:hex 输入框的 input 选择器>>）；若必须输入，优先在弹层内 `fill` 该输入框，再 `press` `Enter`。
6. 渐变：`click` `button[aria-label="Add color stop"]` 增加色标；或 `fill` `textarea[aria-label="Gradient CSS"]` 输入 CSS 渐变串后 `press` `Tab` 失焦提交（`handleGradientTextBlur`）。
7. 关闭：`press` `Escape`，或点击弹层外空白处。

```yaml
# kit（建议新增，见 /tmp/pb/kit-choerodon-picker-misc.yaml）
colorPickerWrapper:
  css: .c7n-pro-color-picker-wrapper
colorPickerTrigger:
  css: .c7n-pro-color-picker-wrapper .c7n-pro-color-picker-trigger
colorPickerPopup:
  css: .c7n-pro-color-picker-popup
colorPickerPaletteBlock:
  css: .c7n-pro-color-picker-popup-view-palettes-block
colorPickerNoFill:
  css: .c7n-pro-color-picker-no-fill
colorPickerStopAdd:
  css: button.c7n-pro-color-picker-stop-add
colorPickerGradientText:
  css: textarea.c7n-pro-color-picker-gradient-text
```

## 2. IconPicker（图标选择框）

源码：[components-pro/icon-picker](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/icon-picker)

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **IconPicker** | `<IconPicker>`；`icons` / `customFontName` 属性 | 文本框输入 + 弹层图标网格，点图标选中 |
| **Select** | `lookupCode` | 下拉文字选项；不展示图标 |
| **Lov** | `lovCode` | Modal 表格选行 |

DOM 结构（`suffixCls: 'icon-picker'`，`IconPicker.tsx` 第 30 行推导）：

```
.c7n-pro-icon-picker-wrapper
  └── .c7n-pro-icon-picker
        ├── input.c7n-pro-input[name=字段]     # 输入文字可过滤图标（filteredIcons 按 text 前缀匹配）
        └── .c7n-pro-icon-picker-trigger

# 弹层（popup 挂 body，宽度 7rem，icon-picker/style/index.less）
.c7n-pro-icon-picker-popup
  ├── .c7n-pro-icon-picker-single-tab                # 只有一个分类时
  │     或 .c7n-pro-icon-picker-tab                  # 多分类：Tabs，每个分类一个 TabPane
  ├── .c7n-pro-icon-picker-category
  │     └── ul
  │           └── li[.c7n-pro-icon-picker-item-selected]
  │                 └── div                           # 点击选中
  │                       ├── i.icon-<名称>          # Icon 字体图标
  │                       └── p                      # 图标名称文本
  └── .c7n-pro-icon-picker-pagination                 # 分页（每页 pageSize，默认 100）
```

### 源码识别

1. JSX：`<IconPicker />`；`icons={['clubs']}` 或 `{ 分类: [...] }`；`customFontName="xxx"` 使用自定义字体库（`index.zh-CN.md`）。
2. DataSet 字段：<<待核实:IconPicker 对应的 DataSet FieldType，本仓库未见映射，表单值为图标名字符串>>。
3. 取值：值即图标 type 名（`getPrefix` 以 value 渲染 `Icon type={value}`）。

### 分析产物

```yaml
field_rules:
  - name: menuIcon
    control: icon_picker     # 命名约定待与分析器对齐
    editable_when: [detail_edit]
```

### 自动化步骤

1. 定位：`.c7n-pro-icon-picker-wrapper:has(input[name="menuIcon"])`（或 `iconPickerWrapper`）。
2. 打开：`click` `iconPickerWrapper` 内的 input（或触发器）→ `waitFor` `iconPickerPopup`。
3. 多分类：先 `click` 目标分类 Tab（`.c7n-pro-icon-picker-tab` 下的 `.c7n-tabs-tab`，文案为分类名）。
4. 按名称过滤：`fill` input 为图标名前缀（如 `"clubs"`），弹层只保留以该前缀开头的图标。
5. 选中：`click` `.c7n-pro-icon-picker-popup li:has(p:text-is("clubs")) > div`。
6. 断言：`assertVisible` 触发器内 `.icon-clubs`（或 `iconPickerWrapper` 中图标）。
7. 翻页：`click` `.c7n-pro-icon-picker-pagination` 下翻页按钮（分页组件类名未在本册核实，沿用 table 分页键思路，<<待核实:分页按钮类名>>）。

```yaml
# kit（建议新增）
iconPickerWrapper:
  css: .c7n-pro-icon-picker-wrapper
iconPickerPopup:
  css: .c7n-pro-icon-picker-popup
iconPickerItem:
  css: .c7n-pro-icon-picker-popup li
iconPickerItemSelected:
  css: .c7n-pro-icon-picker-popup .c7n-pro-icon-picker-item-selected
iconPickerTab:
  css: .c7n-pro-icon-picker-tab
```

## 3. Rate（评分）

源码：[components-pro/rate](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/rate)

| 控件 | 源码线索 | DOM / 交互 |
|------|----------|------------|
| **Rate** | `<Rate name="...">`；DataSet `type: number` | 点击星星直接设值，无弹层 |
| **IconPicker** | `<IconPicker>` | 弹层选图标，非评分 |

Rate 继承 FormField、渲染 `C7NRate`（`choerodon-ui/lib/rate`）。Pro 层样式见 `rate/style/index.less`：根类 `c7n-pro-rate`，包裹类 `c7n-pro-rate-wrapper`，并带 `c7n-pro-field` 类（第 10 行 `&-wrapper.@{field-prefix-cls}`）。

DOM 结构：

```
.c7n-pro-field[.c7n-pro-rate-wrapper]        # 表单字段包裹；less 定义 inline-flex 纵向
  ├── .c7n-pro-field-label                    # labelLayout 为 float / horizontal 等时（<<待核实:FIELD_SUFFIX 实际值为 field>>）
  └── .c7n-rate                               # <<待核实:C7NRate 根类名>>（choerodon-ui/lib，本仓库不可见）
        └── li.c7n-rate-star[.c7n-rate-star-full|.c7n-rate-star-half]   # <<待核实:基础星星类名>>

.c7n-pro-rate-readonly / .c7n-pro-rate-disabled   # 只读 / 禁用态（FormField 与 rate-basic mixin）
```

### 源码识别

1. JSX：`<Rate name="rate" allowHalf allowClear />`（demo `dataset.md`）。
2. DataSet：`{ name: 'rate', type: 'number' }`（demo 中为 `type: "number"`，`required: true`）。
3. 属性：`allowHalf`、`allowClear` 来自 C7NRate；`onChange(value, oldValue, form)`（`index.zh-CN.md`）。

### 分析产物

```yaml
field_rules:
  - name: rate
    control: rate            # 数值评分
    editable_when: [detail_edit]
```

### 自动化步骤

1. 定位：`.c7n-pro-rate-wrapper:has(input[name="rate"])`（当前 Rate 渲染时是否有 input 未核实，建议以 `formField` 的 `name` 对应的 wrapper 为根，<<待核实:Rate 是否输出 input[name]>>）。
2. 点星：`click` 第 N 颗星（推荐 `.c7n-rate-star:nth-child(N)`，类名待核实后替换），`N` 取 1~5。
3. 半星：`allowHalf` 时点击星星左半边（按 `boundingBox` 计算偏移，与 `click` 的 `position` 参数配合）。
4. 清除：`allowClear` 时再次点击当前星级即清空（demo 行为，源码未在本册核实交互细节）。
5. 断言：`assertVisible` 根容器；只读态以 `.c7n-pro-rate-readonly` 断言，不可点击。
6. 不要用 `fill`，Rate 没有文本输入。

```yaml
# kit（建议新增）
rateWrapper:
  css: .c7n-pro-rate-wrapper
rateReadonly:
  css: .c7n-pro-rate-wrapper.c7n-pro-rate-readonly
```

## 常见误判

| 错误 | 正确 |
|------|------|
| ColorPicker 当 Select 点下拉项 | 点触发器 → 色板弹层，不是 `pickSelect` |
| 用 `fill` 给 Rate 赋值 | Rate 无文本框，点星 |
| IconPicker 当 Lov 用 `pickLov` | 弹层为图标网格，无表格，直接 `click` 图标项 |
| 写 `.c7n-pro-color-picker-popup-view` 当弹层根 | 根是 `.c7n-pro-color-picker-popup`，`-view` 是内层 |
| 用 `.icon-palette` 当 ColorPicker 图标 | 图标仅作 trigger 展示，点击区域是 `-trigger` |

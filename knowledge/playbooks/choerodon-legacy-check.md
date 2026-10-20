# Choerodon 旧版 Checkbox / Radio / Switch / Rate / Slider（choerodon-ui）

覆盖 `choerodon-ui`（非 Pro）的勾选、单选、开关、评分、滑块。前缀统一 `c7n-`（不是 `c7n-pro-`）。  
Pro 版：[choerodon-check-radio-switch.md](./choerodon-check-radio-switch.md)（CheckBox / Radio / Switch）、[choerodon-picker-misc.md](./choerodon-picker-misc.md)（Rate）；Pro 滑块即 Range，见 [choerodon-number-input.md](./choerodon-number-input.md)。  
建议新增的定位键汇总见 `/tmp/pb/kit-choerodon-legacy-check.yaml`（未合入 `platform/choerodon/kit.yaml`）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本册） | Pro（`components-pro`） |
|------|--------------|-------------------------|
| JSX 导入 | `import { Checkbox } from 'choerodon-ui'`（demo 写法；也可 `choerodon-ui/lib/checkbox`） | `import { CheckBox } from 'choerodon-ui/pro'`（组件名大小写不同） |
| 类名前缀 | `c7n-` + suffix（`components/configure/default.tsx:96` 的 `prefixCls: 'c7n'`，经 `configure/utils.ts:18` 拼成 `c7n-<suffix>`） | `c7n-pro-<suffix>`；例外：Pro Rate 内层渲染 `choerodon-ui/lib/rate`，星星是旧版 `c7n-rate-*`（`components-pro/rate/Rate.tsx:7`） |
| DataSet 绑定 | 无，仅受控 `checked` / `value` / `onChange` | 有，Field `type: boolean` / `multiple` 等 |
| Switch 交互元素 | 根节点 `span.c7n-switch`，无 `input` | `input.c7n-pro-switch` |
| 滑块 | 本册唯一的 `Slider` | 无 Pro Slider；Pro Range 内部渲染 `choerodon-ui/lib/slider`（`components-pro/range/Range.tsx:7`） |

判断：出现 `c7n-pro-*` 类或 DataSet Field 绑定走 Pro 册；`c7n-checkbox-*` 等旧版类且无 DataSet 走本册。

## Checkbox

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/checkbox

| 组件 | 区分点 |
|------|--------|
| Checkbox | 方框 `span.c7n-checkbox`，单项勾选或多项勾选 |
| Checkbox.Group | `div.c7n-checkbox-group`，选项为数组值（`Group.tsx:127`） |
| Radio / Switch | 见下文，分别是圆点和滑轨 |

### DOM

```
label.c7n-checkbox-wrapper[.外部 className，如 c7n-checkbox-group-item]
  ├── span.c7n-checkbox[.c7n-checkbox-checked][.c7n-checkbox-disabled][.c7n-checkbox-indeterminate]
  │     ├── input.c7n-checkbox-input[type=checkbox]   # 原生输入，name/value 透传
  │     └── span.c7n-checkbox-inner                   # 方框；对勾由 less 绘制
  └── span                                            # 仅传 children 时存在，内含文案
```

推导依据：`Checkbox.tsx:96` 取 `getPrefixCls('checkbox')`；`Checkbox.tsx` 给 label 加 `${prefixCls}-wrapper`；`rc-components/checkbox/Checkbox.jsx` 中外层 span 为 `prefixCls` + `-checked` / `-disabled`，input 为 `${prefixCls}-input`，内层为 `${prefixCls}-inner`；`-indeterminate` 由 `Checkbox.tsx` 作为 className 传入 span。样式见 `checkbox/style/mixin.less:4-7`。

### 源码识别

1. JSX：`<Checkbox onChange={fn}>文案</Checkbox>`，demo 为 `checkbox/demo/basic.md`。
2. 受控：`checked` + `onChange(e)`，`e.target.checked` 为布尔值。无 DataSet，业务代码中不会出现 Field `type`。
3. Group：`<Checkbox.Group options={[...]} value={[...]} onChange={arr => …} />`（`checkbox/index.zh-CN.md`）。
4. 同页 Pro 的 `<CheckBox>`（`choerodon-ui/pro` 导入）属于 Pro，勿套本册。

### 分析产物

```yaml
field_rules:
  - name: enableFlag
    control: checkbox       # 旧版受控单项；多项用 checkbox_group
```

### 自动化步骤

1. 定位：单个勾选用 `legacyCheckboxWrapper` + `hasText` 文案；同页多个时功能层加 `:has(input.c7n-checkbox-input[value="…"])` 收窄。
2. 切换：点 label 与点 input 等效（input 覆盖整个 label），直接 `click`。

```yaml
- action: click
  args:
    target: legacyCheckboxWrapper
    hasText: 启用
```

3. 断言勾选：无专用关键字，用 `assertVisible` 指向 `legacyCheckboxChecked`（`input.c7n-checkbox-input:checked`）。须限定到所在表单项，否则同页其他勾选框会误命中。
4. 半选：`legacyCheckboxIndeterminate` 存在即为半选，`indeterminate` 态 `isChecked` 不为真。
5. 不要用 `fillForm`，其非 select/lov 分支会对 checkbox 调 `fill`，无效。

### kit 建议键

```yaml
legacyCheckboxWrapper:
  css: .c7n-checkbox-wrapper
  note: 功能层用 :has(input.c7n-checkbox-input[value=…]) 收窄；hasText 选文案
legacyCheckboxChecked:
  css: input.c7n-checkbox-input:checked
  note: 仅配合 assertVisible；须收窄
legacyCheckboxIndeterminate:
  css: .c7n-checkbox-wrapper .c7n-checkbox-indeterminate
legacyCheckboxGroup:
  css: .c7n-checkbox-group
  note: Checkbox.Group 根；多组时 within 表单项
```

## Radio

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/radio

| 组件 | 区分点 |
|------|--------|
| Radio | 圆点，同组互斥（`span.c7n-radio`） |
| Radio.Group | `div.c7n-radio-group-*`，负责 `value` / `name` / `options` |
| Radio.Button | 按钮样式，类名 `c7n-radio-button-*`，见 `radio/radioButton.tsx:17` |

### DOM

```
label.c7n-radio-wrapper[.c7n-radio-wrapper-checked][.c7n-radio-wrapper-disabled]
  ├── span.c7n-radio[.c7n-radio-checked][.c7n-radio-disabled]
  │     ├── input.c7n-radio-input[type=radio][name]   # name 由 RadioGroup 注入
  │     └── span.c7n-radio-inner
  └── span                                            # children 文案

div.c7n-radio-group.c7n-radio-group-outline           # buttonStyle 默认 outline；另有 solid
  └── label.c7n-radio-button-wrapper                  # Radio.Button
        └── span.c7n-radio-button
              ├── input.c7n-radio-button-input
              └── span.c7n-radio-button-inner

# 带 label 时外层包一层
div.c7n-radio-group-wrapper.c7n-radio-group-has-label
  ├── span.c7n-radio-group-label
  └── div.c7n-radio-group …
```

推导依据：`radio.tsx:62-63` 得到 `c7n-radio`；`radio.tsx` 的 wrapper 类含 `-wrapper-checked` / `-wrapper-disabled`；`group.tsx:102-106` 得到 `${prefixCls}-group` 加 `-${buttonStyle}` 与 `-${size}`；`group.tsx` 的 label 结构为 `-wrapper` / `-has-label` / `-label`；`radioButton.tsx:17` 把 `c7n-radio-button` 传给 Radio，故 wrapper 为 `c7n-radio-button-wrapper`。样式见 `radio/style/index.less:134`。

### 源码识别

1. JSX：`<Radio value={1}>A</Radio>`，`<Radio.Group value onChange options>` 或 `<Radio.Button>`（`radio/index.zh-CN.md`）。
2. 受控：`RadioGroup` 的 `value` + `onChange(e)`，`e.target.value` 为选中值。无 DataSet。
3. `options` 可传字符串数组或 `{label, value, disabled}` 数组（`group.tsx` 的 render）。

### 分析产物

```yaml
field_rules:
  - name: defaultFlag
    control: radio          # 按钮样式可在功能层注明 buttonStyle
```

### 自动化步骤

1. 定位：选项用 `legacyRadioWrapper` + `hasText`；按钮样式用 `legacyRadioButtonWrapper`；功能层用 `:has(input.c7n-radio-input[name="…"])` 限定同组。
2. 选中：`click`。

```yaml
- action: click
  args:
    target: legacyRadioWrapper
    hasText: 选项A
```

3. 同组单选不会因再次点击而取消：`RadioGroup` 的 `onRadioChange` 仅在值变化时回调（`group.tsx` 的 `onRadioChange`）。
4. 断言选中：`assertVisible` 指向 `legacyRadioChecked`（`input.c7n-radio-input:checked`）。
5. 禁用：`.c7n-radio-wrapper-disabled` 存在时不可点。

### kit 建议键

```yaml
legacyRadioWrapper:
  css: .c7n-radio-wrapper
  note: 功能层用 :has(input.c7n-radio-input[name=…]) 收窄；hasText 选文案
legacyRadioChecked:
  css: input.c7n-radio-input:checked
  note: 仅配合 assertVisible；须收窄
legacyRadioButtonWrapper:
  css: .c7n-radio-button-wrapper
legacyRadioGroup:
  css: .c7n-radio-group
  note: 同组根；带 label 时外层为 .c7n-radio-group-wrapper
```

## Switch

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/switch

与 Pro Switch 的主要差异：**旧版没有 `input`**，交互元素就是 `span.c7n-switch`。

### DOM

```
span.c7n-switch[tabindex=0][.c7n-switch-checked][.c7n-switch-disabled][.c7n-switch-small][.c7n-switch-loading]
  └── span.c7n-switch-inner                # checkedChildren / unCheckedChildren 文案
```

推导依据：`switch/index.tsx:51` 得到 `c7n-switch`；`switch/index.tsx` 加 `-small` 与 `-loading`；`rc-components/switch/Switch.jsx` 的 render 加 `-checked` / `-disabled`，内层为 `${prefixCls}-inner`；禁用时 `tabIndex=-1`。`loading` 不向下传（`omit(this.props, ['loading'])`），加载态只有 `-loading` 类，无独立图标节点，动画由 `switch/style/index.less:61-70` 的 `::before` 实现。

### 源码识别

1. JSX：`<Switch checked={v} onChange={fn} />`（`switch/index.zh-CN.md`）。
2. 受控回调参数为 `checked: boolean`，不是事件对象。
3. 无 DataSet；Pro 的 `<Switch>` 来自 `choerodon-ui/pro`，勿套本册。

### 分析产物

```yaml
field_rules:
  - name: status
    control: switch        # 旧版受控开关；Pro 版走 choerodon-check-radio-switch.md
```

### 自动化步骤

1. 定位：开关无文案，同页多个时以所在表单项或行为根，用 `legacySwitch` 在其内收窄。
2. 切换：`click` 根节点。

```yaml
- action: click
  args:
    target: legacySwitch
```

3. 键盘：根为可聚焦 span，`press` `ArrowRight` 置为开，`ArrowLeft` 置为关；`Space` / `Enter` 切换（`rc-components/switch/Switch.jsx` 的 `handleKeyDown`，keyCode 37/39/32/13）。

```yaml
- action: press
  args:
    target: legacySwitch
    key: ArrowRight
```

4. 断言：开启用 `assertVisible` 指向 `legacySwitchChecked`；加载中用 `legacySwitchLoading`。
5. 禁用时 `setChecked` 直接返回，点击无效（`Switch.jsx` 的 `setChecked`）。

### kit 建议键

```yaml
legacySwitch:
  css: span.c7n-switch
  note: 根节点即交互元素；同页多个时功能层收窄
legacySwitchChecked:
  css: span.c7n-switch.c7n-switch-checked
legacySwitchLoading:
  css: span.c7n-switch.c7n-switch-loading
  note: 加载中仅有类名，无图标节点
legacySwitchDisabled:
  css: span.c7n-switch.c7n-switch-disabled
```

## Rate

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/rate

Pro Rate（`components-pro/rate`）内层直接渲染本组件，DOM 相同，仅外层为 `c7n-pro-rate-wrapper`（见 [choerodon-picker-misc.md](./choerodon-picker-misc.md)）。

### DOM

```
ul.c7n-rate[.c7n-rate-disabled][role=radiogroup][tabindex]
  └── li.c7n-rate-star[.c7n-rate-star-full | .c7n-rate-star-zero][.c7n-rate-star-half][.c7n-rate-star-active][.c7n-rate-star-focused]
        │                                              # role=radio；aria-checked 随值变化；count 个
        ├── div.c7n-rate-star-first                    # character，默认 Icon star
        └── div.c7n-rate-star-second
```

推导依据：`rate/index.tsx:52` 取 `getPrefixCls('rate')`；`rc-components/rate/Rate.jsx` 的根为 `ul`，类名为 `prefixCls` + `-disabled` + `className`；星星 `prefixCls` 为 `${prefixCls}-star`（`Rate.jsx` render）；`Star.jsx` 的 `getClassName` 生成 `-full` / `-zero` / `-half` / `-active` / `-focused`；`-first` / `-second` 来自 `Star.jsx` 的 render。`.c7n-rate-text` 只出现在 `rate/demo/text.md` 的示例中，不是组件内部节点。

### 源码识别

1. JSX：`<Rate />`、`<Rate value={n} onChange={fn} allowHalf allowClear count disabled />`（`rate/index.zh-CN.md`）。
2. 受控回调参数为 `value: number`。
3. 无 DataSet；Pro 的 `<Rate name=…>` 来自 `choerodon-ui/pro`，见 choerodon-picker-misc.md。

### 分析产物

```yaml
field_rules:
  - name: score
    control: rate           # 旧版受控评分
```

### 自动化步骤

1. 定位：`legacyRate` 为根，同页多个时在表单项内收窄。
2. 点第 N 颗：`click` 星星，功能层追加 `:nth-child(N)`，N 取 1~count。

```yaml
- action: click
  args:
    target: legacyRateStar    # 功能层追加 :nth-child(3)
```

3. 半星：需 `allowHalf`，点击星星左半区（`Rate.jsx` 的 `getStarValue` 按 `x - leftDis < width / 2` 判定）；`click` 的坐标参数 <<待核实：关键字是否支持 position>>。
4. 清除：`allowClear` 时再次点当前值，结果为 0（`Rate.jsx` 的 `onClick`）。
5. 键盘：根可聚焦，`ArrowRight` / `ArrowLeft` 按 1 或 0.5（`allowHalf`）增减（`Rate.jsx` 的 `onKeyDown`）。
6. 断言：`legacyRateStarFull` 数量即为当前整星数；`aria-checked="true"` 对应已点亮星。
7. 禁用：`.c7n-rate-disabled` 时星星 `onClick` 为 null，点击无效。不要用 `fill`，Rate 无文本输入。

### kit 建议键

```yaml
legacyRate:
  css: ul.c7n-rate
  note: 功能层用字段所在表单项收窄；无 input[name]
legacyRateStar:
  css: ul.c7n-rate li.c7n-rate-star
  note: 点击用 :nth-child(N)；数量由 count 决定
legacyRateStarFull:
  css: ul.c7n-rate li.c7n-rate-star-full
legacyRateDisabled:
  css: ul.c7n-rate.c7n-rate-disabled
```

## Slider

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/slider

旧版唯一的滑块。Pro 无同名组件，Pro Range（`components-pro/range`）内部渲染本组件（`components-pro/range/Range.tsx:7`），DOM 结构相同，外层为 `c7n-pro-range-wrapper`。

### DOM

```
div.c7n-slider[.c7n-slider-with-marks][.c7n-slider-disabled][.c7n-slider-vertical]
  ├── div.c7n-slider-rail                            # 底轨
  ├── div.c7n-slider-track                           # 已选段；range 时为 c7n-slider-track-0 / -1
  ├── div.c7n-slider-step                            # 仅 dots / marks 时
  │     └── span.c7n-slider-dot[.c7n-slider-dot-active]
  ├── div.c7n-slider-handle[.c7n-tooltip-open]       # range 时为 -handle-1 / -handle-2
  └── div.c7n-slider-mark                            # 仅 marks 时
        └── span.c7n-slider-mark-text[.c7n-slider-mark-text-active]   # <<待核实：刻度文案节点标签>>
```

推导依据：`slider/index.tsx:122` 取 `getPrefixCls('slider')`；`rc-components/slider/common/createSlider.jsx:261-265` 加根类 `-with-marks` / `-disabled` / `-vertical`；`createSlider.jsx:280` 为 rail；`Slider.jsx:166` 为 track；`Range.jsx:329-337` 为 handle 与 `-handle-${i+1}`；`Handle.jsx:88` 的 handle 为 `div`；`Steps.jsx:33-41` 为 dot 与 step；`createSlider.jsx:303` 为 mark。`.c7n-tooltip-open` 与 mark-text 样式见 `slider/style/index.less:55,67,80`。

### 源码识别

1. JSX：`<Slider defaultValue={30} />`、`<Slider range defaultValue={[20, 50]} />`，demo 为 `slider/demo/basic.md`。
2. 常用属性：`range` / `min` / `max` / `step` / `marks` / `dots` / `disabled` / `tipFormatter` / `onChange(value)` / `onAfterChange`（`slider/index.tsx` 的 `SliderProps`）。
3. `value` 为 `number` 或 `[number, number]`。无 DataSet；若在 Pro 的 Range 中，见 choerodon-number-input.md。

### 分析产物

```yaml
field_rules:
  - name: threshold
    control: slider         # 旧版滑块；Pro Range 同名字段走 choerodon-number-input.md
```

### 自动化步骤

1. 定位：`legacySlider` 为根，句柄为 `legacySliderHandle`；双滑块用 `.c7n-slider-handle-1` / `-2`。
2. 调值：无拖拽关键字。推荐先 `click` 句柄获得焦点，再 `press` 方向键；键码映射在 `createSlider.jsx:173` 的 `onKeyDown` 中，具体步进 <<待核实>>。

```yaml
- action: click
  args:
    target: legacySliderHandle
- action: press
  args:
    target: legacySliderHandle
    key: ArrowRight
```

3. 刻度跳值：`marks` 存在时点刻度文案即可跳到该值（`createSlider.jsx` 的 `onClickMarkLabel`），目标用 `legacySliderMarkText` + `hasText`。
4. 数值断言：界面上以 tooltip 显示值（`tipFormatter` 返回值）。悬停句柄后 tooltip 类名 <<待核实：Tooltip 弹层类名>>；不要用 `.c7n-slider-*` 去断言数值。
5. 禁用：`legacySliderDisabled` 存在时句柄与刻度不可交互。

### kit 建议键

```yaml
legacySlider:
  css: div.c7n-slider
  note: 根；同页多个时功能层用 :has(…) 或 within 收窄
legacySliderHandle:
  css: div.c7n-slider-handle
  note: range 时 2 个，用 .c7n-slider-handle-1 / -2 区分
legacySliderMarkText:
  css: .c7n-slider-mark-text
  note: 仅 marks 时存在
legacySliderDisabled:
  css: .c7n-slider.c7n-slider-disabled
```

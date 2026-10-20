# Choerodon 旧版展示类组件：Timeline / Statistic / Carousel / BarCode / WaterMark（choerodon-ui，非 Pro）

旧版前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`（`components/configure/utils.tsx:14-19`）。  
JSX 导入：`import { Timeline, Statistic, Carousel, BarCode, WaterMark } from 'choerodon-ui'`（`components/index.ts`）。  
本组件族在 `components-pro` 下无同名实现，`playbooks/` 下也无同名 Pro 手册，故不设「旧版 vs Pro」对照表。

以下五者均**只读展示**，不绑定 DataSet；`field_rules` 仅用于标识展示块。

---

## Timeline（时间轴）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/timeline

```
ul.c7n-timeline[.c7n-timeline-pending][.c7n-timeline-reverse]     # Timeline.tsx
  ├── li.c7n-timeline-item[.c7n-timeline-item-last]               # TimelineItem.tsx；last 由 Timeline.tsx 追加
  │     ├── div.c7n-timeline-item-tail                           # 竖线；末项隐藏
  │     ├── div.c7n-timeline-item-head.c7n-timeline-item-head-blue  # color 默认 blue；red/green 同理
  │     │     [.c7n-timeline-item-head-custom]                    # 传了 dot 时追加
  │     └── div.c7n-timeline-item-content
  └── li.c7n-timeline-item.c7n-timeline-item-pending              # pending 为真时末尾追加；head 内为 Spin
```

- `color` 为 `blue|red|green` 时走预设类；其它字符串（如 `#f5222d`）仍会追加 `c7n-timeline-item-head-<color>`，并以 inline style 设边框/文字色。
- `reverse` 时 pending 项置顶，children 倒序。

## 源码识别

1. JSX：`<Timeline>` 的子节点为 `<Timeline.Item>`（`Timeline.Item` 即 `TimelineItem`，`Timeline.tsx` 静态属性）。
2. Timeline 属性：`pending`（真值/ReactNode）、`pendingDot`、`reverse`；Item 属性：`color`、`dot`、`pending`。
3. 无 `field` / DataSet 绑定；内容通常来自业务列表 `map` 渲染。

## 分析产物

```yaml
field_rules:
  - name: auditTimeline          # 非 DS 字段，仅作展示块标识
    control: timeline            # timeline | statistic | carousel | bar_code | water_mark
    editable_when: []
```

## 自动化步骤

1. 定位：`.c7n-timeline` 限定到所在区块（`within`）；同页多个时按区块标题收窄。
2. 断言整体可见：`assertVisible`，`args: { target: timelineRoot }`。
3. 断言某条内容：用 `timelineItem` + `hasText` 收窄后再 `assertVisible`（`assertVisible` 是否支持 `hasText` <<待核实>>）。
4. 无交互：不需要 `click` / `fill`。
5. 等 pending 态：`waitFor`，`args: { visible: timelinePendingItem }`；结束用 `hidden`（由业务控制）。

```yaml
- action: assertVisible
  args:
    target: timelineRoot
```

## 建议新增 kit

```yaml
timelineRoot:
  css: .c7n-timeline
timelineItem:
  css: .c7n-timeline-item
timelinePendingItem:
  css: .c7n-timeline-item-pending
```

---

## Statistic（统计数值）与 Statistic.Countdown

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/statistic

| 组件 | 源码线索 | DOM 差异 |
|------|----------|----------|
| **Statistic** | `<Statistic value={数值} />` | 无 `formatter` 时数值拆为 `-int` / `-decimal` 两段（`Number.tsx`） |
| **Statistic.Countdown** | `<Statistic.Countdown value={时间} format="HH:mm:ss" />` | 同一结构；`formatter` 为函数，值是单段文本；按 `format` 定时刷新，到点触发 `onFinish` |

```
div.c7n-statistic[.className]                           # Statistic.tsx
  ├── div.c7n-statistic-title                           # 有 title 才渲染
  └── div.c7n-statistic-content                         # valueStyle 挂此节点
        ├── span.c7n-statistic-content-prefix           # 有 prefix 才渲染
        ├── span.c7n-statistic-content-value            # Number.tsx
        │     ├── span.c7n-statistic-content-value-int      # 仅内部格式化
        │     └── span.c7n-statistic-content-value-decimal  # 仅有小数位
        └── span.c7n-statistic-content-suffix           # 有 suffix 才渲染
```

## 源码识别

1. JSX：`<Statistic>` 或 `<Statistic.Countdown>`（`statistic/index.tsx` 挂载 `Countdown`）。
2. 属性：`value`、`title`、`prefix`、`suffix`、`precision`、`formatter`、`groupSeparator`、`decimalSeparator`。
3. Countdown 默认 `format='HH:mm:ss'`（`Countdown.tsx` defaultProps）。

## 分析产物

```yaml
field_rules:
  - name: ticketCount
    control: statistic           # 只读展示
```

## 自动化步骤

1. 定位：`.c7n-statistic` 限定到卡片区块；同页多个时用 `:has(.c7n-statistic-title:text-is("标题"))` 收窄。
2. 断言数值存在：`assertVisible`，`args: { target: statisticValue }`（限定在上述卡片内）。
3. 文案/数值精确比对：用步骤级 `textContains`（写法同 `choerodon-feedback.md`）。
4. Countdown 数字每秒变化，只断言「可见」，不断言具体秒数。到点后显示是否为 `00:00:00` <<待核实>>。
5. 无交互，不需要 `click` / `fill`。

```yaml
- action: assertVisible
  args:
    target: statisticValue
```

## 建议新增 kit

```yaml
statisticRoot:
  css: .c7n-statistic
statisticTitle:
  css: .c7n-statistic-title
statisticValue:
  css: .c7n-statistic-content-value
```

---

## Carousel（走马灯）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/carousel

底层为 `react-slick`（`carousel/index.tsx`）。**`slick-*` 类名不带 c7n 前缀**，样式在 `carousel/style/index.less` 中直接写 `.slick-*`。

```
div.c7n-carousel[.c7n-carousel-vertical][.c7n-carousel-theme-dark]   # index.tsx render()
  └── div.slick-slider                                               # react-slick 根
        ├── div.slick-list > div.slick-track
        │     └── div.slick-slide[.slick-active]    # 每个子节点一页 <<待核实:slick-active 是否在 slide 上>>
        ├── .slick-prev / .slick-next                # 仅 arrows=true；标签名 <<待核实>>
        └── ul.slick-dots > li[.slick-active] > button   # dots 默认 true；less 中为 .slick-dots li.slick-active button
```

- `theme="dark"` 追加 `-theme-dark`；`vertical` 追加 `-vertical`。
- `effect="fade"` 等价于 `fade`。
- 默认 `arrows=false`、`dots=true`（`defaultProps`）。

## 源码识别

1. JSX：`<Carousel>`，每个直接子节点为一页。
2. 属性：`autoplay`、`autoplaySpeed`、`dots`、`arrows`、`effect`、`theme`、`vertical`、`afterChange(current)`。
3. 无 DataSet 绑定。

## 分析产物

```yaml
field_rules:
  - name: bannerList
    control: carousel            # 只读展示
```

## 自动化步骤

1. 定位：`.c7n-carousel` 限定到区块（`within`）。
2. 下一页：`click`，`args: { target: carouselNext }`（需开启 `arrows`）。
3. 指定页：点圆点，用 CSS 位置选择 `.c7n-carousel .slick-dots li:nth-child(N) button`（圆点无文案，不用 `hasText`）。
4. 当前页断言：`assertVisible`，`args: { target: carouselDotActive }`。
5. 自动轮播：`autoplay` 时序不做断言；切换后用 `waitFor` `visible: carouselDotActive` 等待动画结束。
6. 悬停暂停（`pauseOnHover` / `pauseOnDotsHover`）需鼠标 hover，关键字列表中无 hover <<待核实>>。

```yaml
- action: click
  args:
    target: carouselNext
- action: assertVisible
  args:
    target: carouselDotActive
```

## 建议新增 kit

```yaml
carouselRoot:
  css: .c7n-carousel
carouselNext:
  css: .c7n-carousel .slick-next
carouselPrev:
  css: .c7n-carousel .slick-prev
carouselDotActive:
  css: .c7n-carousel .slick-dots li.slick-active
```

---

## BarCode（条形码 / 二维码）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/bar-code

入口 `index.tsx` 导出为 `BarCode`（`components/index.ts`）；`type` 默认 `qr`，分派到 `QRCode.tsx`（qrcode.react）或 `BarCode.tsx`（jsbarcode）。

| 形态 | 源码 | DOM |
|------|------|-----|
| `type="qr"`（默认） | `QRCode.tsx`，`renderAs` 默认 `canvas` | `<canvas>`；`renderAs="svg"` 时为 `<svg>` <<待核实>> |
| `type="bar"` | `BarCode.tsx`（jsbarcode） | `<canvas>`（`BarCode.tsx`）；`renderAs="svg"` 为 `<svg>` |

**无 c7n 类名**：`bar-code/` 目录不调用 `getPrefixCls`，`BarCode.tsx` 直接返回 `<canvas ref=…/>`，不透传 `className`。只能用标签 + 业务容器定位。

```
<业务容器>
  └── canvas   # 无 c7n-* 类；type="bar" 或 type="qr" 默认
        或 svg  # renderAs="svg"
```

- 编码失败只 `console.warn`，不抛错（`BarCode.tsx`），`value` 非法时画布可能空白。

## 源码识别

1. JSX：`<BarCode type="bar" value={…} />`（`type` 可取 `CodeType.QR`/`CodeType.BAR`，`enum.tsx`）。
2. 属性：`value`（必填）、`type`、`renderAs`、`bgColor`、`fgColor`、`option`（jsbarcode 参数）。
3. 无 DataSet 绑定；`value` 通常来自业务字段。

## 分析产物

```yaml
field_rules:
  - name: barCodeValue
    control: bar_code            # 只读展示
```

## 自动化步骤

1. 定位：`canvas` 必须在业务容器内（`within`），页面可能有其它 canvas。
2. 断言可见：`assertVisible`，`args: { target: barCodeCanvas }`。
3. 内容校验：canvas 像素不可直接读取 `value`；若需校验，断言 `value` 来源的输入框（`fill` 后 `input` 值）<<待核实:截图对比关键字>>。
4. 无交互（展示型）时不需要 `click`。

```yaml
- action: assertVisible
  args:
    target: barCodeCanvas
```

## 建议新增 kit

```yaml
barCodeCanvas:
  css: canvas
  note: 无 c7n 类；必须 within 业务容器收窄
```

---

## WaterMark（水印）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/water-mark

入口 `WaterMark.tsx`（导出名 `WaterMark`，`components/index.ts`）。水印以 canvas 绘制后转 dataURL，作为 `background-image` 挂到覆盖层。

```
div.c7n-watermark-wrapper[.className]           # WaterMark.tsx wrapperCls
  ├── {children}                                # 业务内容
  └── div.c7n-watermark[.markClassName]          # enable=true 时渲染
        inline: position:absolute; width/height:100%; pointer-events:none;
                z-index:zIndex(默认 9); background-image:url('data:image/png;base64,…')
```

- `getContainer` 返回 DOM 元素时，水印通过 `createPortal` 挂到该容器，不在 wrapper 下。
- `removeable` 默认 `false`：水印被删除会被 `DOMNodeRemoved` 监听重新挂回，测试不宜通过删节点验证。

## 源码识别

1. JSX：`<WaterMark content="…">包裹业务内容</WaterMark>`。
2. 文字水印用 `content`（`\n` 可换行）；图片水印用 `image`（`image` 优先于 `content`）。
3. 其它属性：`enable`、`gapX`、`gapY`、`width`、`height`、`rotate`、`zIndex`、`markStyle`、`getContainer`。
4. 无 DataSet 绑定。

## 分析产物

```yaml
field_rules:
  - name: confidentialMark
    control: water_mark          # 只读展示
```

## 自动化步骤

1. 定位：包裹层 `.c7n-watermark-wrapper`；水印层 `.c7n-watermark` 限定在包裹层内。
2. 断言水印存在：`assertVisible`，`args: { target: waterMark }`。
3. 断言未启用（`enable=false`）：业务切换后 `waitFor`，`args: { hidden: waterMark }`。
4. 背景图由 canvas 异步生成，先 `waitFor` `visible` 再断言，不需额外等待。
5. 水印 `pointer-events:none`，不阻挡操作，无需点击。
6. 断言 `background-image` 的 style 值需专用关键字 <<待核实>>；不要用 OCR/像素断言。

```yaml
- action: assertVisible
  args:
    target: waterMark
```

## 建议新增 kit

```yaml
waterMarkWrapper:
  css: .c7n-watermark-wrapper
waterMark:
  css: .c7n-watermark
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 找 `.c7n-pro-timeline` / `.c7n-pro-statistic` | 旧版前缀是 `c7n-`，无 `pro` |
| Carousel 里找 `.c7n-carousel-dot` | 圆点是 react-slick 的 `.slick-dots li` |
| 对 BarCode 找 `.c7n-barcode` | 无 c7n 类，用 `canvas` + 业务容器 |
| 断言 Countdown 具体秒数 | 只断言可见，秒数每秒变化 |
| 用删节点测试水印 | `removeable=false` 会被复原 |

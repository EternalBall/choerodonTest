# Choerodon Pro 反馈与提示（message / notification / spin / progress / skeleton / tooltip）

源码：`components-pro/` 下六个目录。message、notification 只有 `index.tsx`（无 `index.zh-CN.md`、无 demo）。  
类名依据：Pro 包装层在 `components-pro`；message / notification / spin / progress / skeleton 的 DOM 来自 `choerodon-ui/lib`。本仓库不含 lib，以 `/data/aisikai/hmes-front-PM-33216/node_modules/choerodon-ui`（1.6.7-alpha.27）核实，与仓库 package.json 的 1.6.8 不一致，**类名以目标环境实测为准**。  
机器可读：`kit.yaml`（建议新增键见各节，待合并）。

## 易混对照

| 组件 | 呈现 | 触发 | 类名前缀 |
|------|------|------|----------|
| message | 顶部居中短提示，自动消失，无关闭按钮 | 全局 `message.success(...)` | `c7n-message` |
| notification | 角落卡片：标题 + 描述 + 关闭 | 全局 `notification.open({...})` | `c7n-notification` |
| tooltip | 悬停气泡，挂 body | 包裹子元素 `<Tooltip title>` 或 `Tooltip.show` | `c7n-pro-tooltip` |
| spin | 区域遮罩 + 转圈 | `<Spin dataSet>` 或 `spinning` | `c7n-spin` |
| skeleton | 占位骨架块 | `<Skeleton dataSet>` 或 `loading` | `c7n-skeleton` |
| progress | 线形 / 环形进度（只读） | `<Progress value>` 或绑定数值字段 | `c7n-progress` |

**前缀陷阱**：除 tooltip 外，本册组件都是 `c7n-*`，**不是** `c7n-pro-*`。写选择器前先对本表。

## message

源码：[components-pro/message](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/message)。  
Pro 层仅 `export default message`（`message/index.tsx`），实现来自 `choerodon-ui/lib/message`；导出名见 `components-pro/index.tsx:109`。

### DOM

```
.c7n-message                                         # 全局容器，挂 body（默认前缀 c7n）
  └── .c7n-message-notice                            # 单条提示
        └── .c7n-message-notice-content.c7n-message-content-{type}
              └── .c7n-message-custom-content.c7n-message-{type}
                    ├── 图标（loading 时为 .c7n-progress-loading）
                    └── span                         # 文案
# type: info | success | error | warning | loading（lib message/index.js:83-85）
```

### 源码识别

1. 无组件标签：业务代码中 `import { message } from 'choerodon-ui/pro'`，调用 `message.info / success / error / warning / loading(content, duration?, onClose?, placement?)`。
2. 无 DataSet 字段绑定，不走 Field 识别，按调用点识别。
3. 全局挂在 body，不在表单 wrapper 内；定位不要 `within` 表单。

### 分析产物

```yaml
# 非字段控件，不产生 field_rules 项
feedback_hints:
  - control: message      # message | notification（<<待核实:分析器是否接受非字段 control 值>>）
    level: success        # info | success | error | warning | loading
    text: 保存成功
```

### 自动化步骤

1. 等提示出现：`- action: waitFor` + `args: { visible: messageNotice }`。
2. 文案断言：`assertVisible` 只校验 target 可见，不校验文案。文案用步骤级 `textContains`（见 `src/keywords/index.ts` 的 `runAsserts`），挂载位置 <<待核实:asserts 在步骤中的写法>>：
   ```yaml
   asserts:
     - type: textContains
       target: messageSuccess
       value: 保存成功
   ```
3. 等自动消失：`- action: waitFor` + `args: { hidden: messageNotice }`。时长由 `message.config({ duration })` 决定，默认值本次未核实。
4. 多条并存时用 `messageSuccess` 收窄；`toBeVisible` / `toBeHidden` 遇多匹配会 strict mode 报错，勿用 `nth` 猜顺序。

### 建议新增 kit

```yaml
messageNotice:
  css: .c7n-message-notice
  note: 全局挂 body；多条并存时用 messageSuccess 收窄
messageSuccess:
  css: .c7n-message-custom-content.c7n-message-success
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-pro-message` | 前缀是 `c7n-message` |
| `assertVisible` 校验文案 | 用 `textContains` 步骤断言 |
| 在表单 wrapper 内找 message | 挂 body，用全局 kit 键 |

## notification

源码：[components-pro/notification](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/notification)。  
Pro 层仅 `export default Notification`（`notification/index.tsx`），实现来自 `choerodon-ui/lib/notification`；导出名见 `components-pro/index.tsx:111`。API 为 `notification.open` / `close(key)` / `destroy`（lib notification/index.js:151-156）。

### DOM

```
.c7n-notification[.c7n-notification-topLeft | -bottomLeft]   # 容器，挂 body（lib 默认 prefixCls=c7n-notification）
  └── .c7n-notification-notice[.c7n-notification-notice-closable]
        ├── .c7n-notification-notice-content
        │     ├── .c7n-notification-notice-icon.c7n-notification-notice-icon-{type}   # 传 type 时
        │     ├── .c7n-notification-notice-message        # 标题
        │     └── .c7n-notification-notice-description    # 描述
        └── a.c7n-notification-notice-close               # closable 时；是 <a> 不是 <button>
              └── span.c7n-notification-notice-close-x
```

### 源码识别

1. 调用：`notification.open({ message, description, type })`；关闭 `notification.close(key)`；清空 `notification.destroy()`。
2. 无 DataSet 字段绑定，按调用点识别。
3. 关闭按钮无 `role=button`，勿用 `getByRole('button')` 定位。

### 分析产物

```yaml
feedback_hints:
  - control: notification   # 同 message，非字段（<<待核实:同上>>）
    level: error
    title: 导入失败
```

### 自动化步骤

1. 等出现：`waitFor` + `args: { visible: notificationNotice }`。
2. 标题断言：同 message，步骤级 `textContains`，target 用 `notificationTitle`。
3. 手动关闭：`click` + `args: { target: notificationClose }`。多条并存时功能层覆盖为带标题的写法（`:text-is` 与 kit 中 `copyDrawer` 同源）：
   `.c7n-notification-notice:has(.c7n-notification-notice-message:text-is("标题")) .c7n-notification-notice-close`
4. 等消失：`waitFor` + `args: { hidden: notificationNotice }`。

### 建议新增 kit

```yaml
notificationNotice:
  css: .c7n-notification-notice
  note: 多条并存时功能层覆盖为带标题的 :has 写法
notificationClose:
  css: .c7n-notification-notice-close
notificationTitle:
  css: .c7n-notification-notice-message
notificationDescription:
  css: .c7n-notification-notice-description
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-pro-notification` | 前缀是 `c7n-notification` |
| 关闭用 `role=button` | 关闭是 `<a>`，用 class |
| 与 message 混用 | notification 有标题与关闭；message 无 |

## spin

源码：[components-pro/spin](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/spin)。  
Pro `Spin` 继承 `DataSetComponent`：绑定 `dataSet` 时 `spinning = dataSet.status !== DataSetStatus.ready`（`spin/index.tsx:23-25`），其余属性透传 lib。DOM 前缀 `c7n-spin`（lib `getPrefixCls('spin')`；与 kit 中 `tableSpin` 的 `.c7n-spin-spinning` 一致）。

### DOM

```
独立（无 children）
.c7n-spin[.c7n-spin-spinning][.c7n-spin-sm | .c7n-spin-lg][.c7n-spin-show-text]
  ├── .c7n-progress.c7n-progress-loading.c7n-spin-dot    # 默认指示器（lib 用 Progress type=loading）
  └── .c7n-spin-text                                      # 仅传 tip 时

包裹（有 children）
.c7n-spin-nested-loading
  ├── .c7n-spin.c7n-spin-spinning                         # 仅 spinning 时渲染
  └── .c7n-spin-container[.c7n-spin-blur]                 # spinning 时加 blur
        └── children（Form / Table 等）
```

### 源码识别

1. JSX：`<Spin dataSet={ds}>…</Spin>`（`spin/demo/dataset.md`）。
2. 包裹的 children 通常是 Form / Table；spinning 由 DataSet 状态驱动，不是字段属性。
3. 也可直接传 `spinning`（lib 属性透传）。

### 分析产物

```yaml
# 区域级等待，不绑定字段，不进 field_rules
loading_regions:
  - name: userForm
    control: spin          # 包裹式；绑定 DS 时等 status=ready
```

### 自动化步骤

1. 触发：点查询或 `ds.query()` 后出现 spinning（可能很快，不必强等出现）。
2. 等加载完成：`waitReady` 或 `waitFor` + `args: { hidden: spinSpinning }`（与 `choerodon-table.md` 中 `hidden: tableSpin` 同模式）。
3. 不用固定 sleep；等待结束后再做区域内断言。

### 建议新增 kit

```yaml
spinSpinning:
  css: .c7n-spin.c7n-spin-spinning
  note: 独立与包裹式均可；多个 Spin 时功能层用 :has 或 within 收窄
spinBlur:
  css: .c7n-spin-container.c7n-spin-blur
spinText:
  css: .c7n-spin-text
  note: 仅传 tip 时存在
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-pro-spin` | 前缀是 `c7n-spin` |
| 把 spin 当骨架 | 骨架用 skeleton（占位块） |
| 与 progress 的 `c7n-progress-loading` 混淆 | 那是 spin 的默认指示器，见上方 DOM |

## progress

源码：[components-pro/progress](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/progress)。  
Pro `Progress` 是 `FormField`（`progress/Progress.tsx:16-17`）：`getValue()` 优先取数值字段，否则取 `percent`（Progress.tsx:20-26）。`value` 与 `percent` 同义（见 `index.zh-CN.md`）。DOM 来自 lib，前缀 `c7n-progress`。

### DOM

```
.c7n-progress.c7n-progress-line.c7n-progress-status-{normal|active|success|exception}[.c7n-progress-show-info][.c7n-progress-small]
  ├── div                                       # 包裹层
  │     ├── .c7n-progress-outer
  │     │     └── .c7n-progress-inner
  │     │           ├── .c7n-progress-bg         # 宽度 = 百分比
  │     │           └── .c7n-progress-success-bg # 仅传 successPercent
  └── span.c7n-progress-text                     # showInfo 时，文案如 "40%"

# 环形：.c7n-progress-circle（dashboard 也用 circle 类）；内部 .c7n-progress-inner + .c7n-progress-text
# 百分比 ≥100 且未传 status 时 status 自动为 success（lib progress.js:26）
```

### 源码识别

1. JSX：`<Progress value={40} />`（`progress/demo/basic.md`）；绑定 `<Progress dataSet={ds} name="rate" />`（`index.zh-CN.md` 属性表）。
2. DataSet 字段类型中未找到 progress 映射（`data-set/`、`field/` 无结果），只能按组件与 `name` 识别。
3. 内部亦复用，如 `upload/UploadList.tsx`（上传进度）。

### 分析产物

```yaml
field_rules:
  - name: completionRate
    control: progress      # 数值字段，只读展示；不 fill
```

### 自动化步骤

1. 只读：不要 `fill`。
2. 若同页有 spin，先 `waitReady` `hidden: spinSpinning`。
3. 断言百分比：步骤级 `textContains`，target `progressText`，value `40%`（写法同 message，<<待核实:asserts 挂载位置>>）。
4. 异常态：`progressStatusException` 可见即为 `status="exception"`。

### 建议新增 kit

```yaml
progressRoot:
  css: .c7n-progress
  note: 功能层用 :has(…) 收窄到字段或区域
progressText:
  css: .c7n-progress-text
progressBg:
  css: .c7n-progress-bg
progressStatusException:
  css: .c7n-progress.c7n-progress-status-exception
progressStatusSuccess:
  css: .c7n-progress.c7n-progress-status-success
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-pro-progress` | 前缀是 `c7n-progress` |
| 对进度做 `fill` | 只读展示 |
| 把 spin 指示器当业务进度 | 那是 spin，见 spin 节 |

## skeleton

源码：[components-pro/skeleton](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/skeleton)。  
Pro `Skeleton` = lib Skeleton + DataSet：绑定 `dataSet` 时 `loading = dataSet.status !== ready`；`skeletonTitle`（默认 true）映射为 lib `title`（`skeleton/Skeleton.tsx:25-46`）。静态子组件 `Skeleton.Button / Input / Avatar`（`skeleton/index.tsx:8-10`）。

**源码推导（未实测，<<待核实>>）**：lib 在 `loading` 为 true **或未传 `loading`** 时渲染骨架（`lib/skeleton/Skeleton.js:90`）。Pro 只在有 dataSet 时传 `loading`，因此无 dataSet 且未传 `loading` 时骨架会常驻。

### DOM

```
.c7n-skeleton[.c7n-skeleton-active][.c7n-skeleton-with-avatar]   # active = 动画
  ├── .c7n-skeleton-header
  │     └── .c7n-skeleton-avatar                                  # avatar 时
  └── .c7n-skeleton-content
        ├── h3.c7n-skeleton-title                                 # skeletonTitle=true
        └── ul.c7n-skeleton-paragraph > li                        # paragraph 行数

# 占位块（Skeleton.Button / Input / Avatar）
.c7n-skeleton.c7n-skeleton-element[.c7n-skeleton-active]
  └── 内层 span（<<待核实:内层标签与子类名>>）
```

### 源码识别

1. JSX：`<Skeleton dataSet={ds} skeletonTitle={false} paragraph={{ rows: 10 }} active>…</Skeleton>`（`skeleton/demo/active.md`）。
2. 与 spin 区分：skeleton 包裹真实内容，加载中显示占位、完成后显示 children；spin 是遮罩转圈。
3. 占位块：`<Skeleton.Button>`、`<Skeleton.Input>`、`<Skeleton.Avatar>`。

### 分析产物

```yaml
loading_regions:
  - name: detailCard
    control: skeleton      # 首屏占位；绑定 DS 时等 status=ready
```

### 自动化步骤

1. 等占位消失：`waitReady` 或 `waitFor` + `args: { hidden: skeletonRoot }`，并限定在目标区域内（避免其他区域骨架误判）。
2. 再做内容断言：`assertVisible` 功能层内容键。
3. `skeletonActive` 只表示动画，不作完成判据。
4. 无 dataSet 时要显示 children，需显式 `loading={false}`（源码推导，见上）。

### 建议新增 kit

```yaml
skeletonRoot:
  css: .c7n-skeleton
  note: 也匹配占位块；限定到目标区域
skeletonActive:
  css: .c7n-skeleton.c7n-skeleton-active
skeletonTitle:
  css: .c7n-skeleton-title
skeletonParagraph:
  css: .c7n-skeleton-paragraph
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-pro-skeleton` | 前缀是 `c7n-skeleton` |
| 等骨架用 `spinSpinning` | 骨架用 `skeletonRoot` |
| 用 `.c7n-skeleton-active` 判完成 | 它只是动画类 |

## tooltip

源码：[components-pro/tooltip](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/tooltip)。  
Pro `Tooltip` 基于 lib `Trigger` 自实现（`tooltip/Tooltip.tsx`）。`suffixCls: 'tooltip'` 经 `getProPrefixCls` 得到 `c7n-pro-tooltip`（`lib/configure/default.js:110` 的 `proPrefixCls: 'c7n-pro'`）。静态方法 `Tooltip.show(target, props, duration)` / `Tooltip.hide(duration)`（`tooltip/index.tsx:4-5`）。

默认值：`placement: top`、`trigger: hover`、`mouseEnterDelay: 100`；theme 非 validation 时为 `dark`（`lib/configure/default.js:42-44`）。

### DOM

```
触发元素（原样渲染；disabled 的 button 会被 span 包裹）

弹层：挂 body；仅打开时存在（lib Popup hidden 时不渲染，除非 forceRender）
div.c7n-pro-tooltip-popup.c7n-pro-tooltip-popup-placement-{top | bottomLeft | …}
  └── div
        ├── div.c7n-pro-tooltip-popup-arrow.c7n-pro-tooltip-popup-arrow-{dark | light}
        └── div.c7n-pro-tooltip-popup-inner.c7n-pro-tooltip-popup-inner-{dark | light}
              └── title 文案

Tooltip.show 单例：div.c7n-pro-singleton-tooltip-container（body 下），内含同上弹层
```

### 源码识别

1. JSX：`<Tooltip title="…" theme="light"><span>…</span></Tooltip>`（`tooltip/demo/basic.md`）。title 可为函数。
2. 代码调用：`Tooltip.show(domNode, { title }, duration)` / `Tooltip.hide()`，真实用例见 `components-pro/pagination/Pagination.tsx:392-397`。
3. 子元素需能接收 mouseenter / mouseleave / focus / click（`index.zh-CN.md` 注意事项）。

### 分析产物

```yaml
# 装饰性提示，不绑字段，不进 field_rules
hints:
  - target: <功能层键>
    control: tooltip       # 悬停显示 title 文案
```

### 自动化步骤

1. 悬停触发：`src/keywords/index.ts` 的关键字表**没有 hover**。<<待核实:悬停动作，需补关键字或用 Playwright 原生 locator.hover()>>，不要发明关键字名。
2. 等弹层：`waitFor` + `args: { visible: tooltipPopup }`。
3. 文案断言：步骤级 `textContains`，target `tooltipInner`（写法同 message，<<待核实:asserts 挂载位置>>）。
4. 收起：鼠标移开（mouseLeaveDelay 100ms）后 `waitFor` + `args: { hidden: tooltipPopup }`。
5. 弹层挂 body，不要 `within` 表单 wrapper，用全局 kit 键。

### 建议新增 kit

```yaml
tooltipPopup:
  css: .c7n-pro-tooltip-popup
  note: 挂 body；Tooltip.show 单例也匹配；多条同时打开时收窄
tooltipInner:
  css: .c7n-pro-tooltip-popup-inner
singletonTooltipContainer:
  css: .c7n-pro-singleton-tooltip-container
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 写 `.c7n-tooltip` | 前缀是 `c7n-pro-tooltip` |
| 用 `title` 属性找提示文案 | 弹层是 DOM 节点，用 `tooltipInner` |
| 与 message 混淆 | tooltip 是悬停，message 是全局提示 |

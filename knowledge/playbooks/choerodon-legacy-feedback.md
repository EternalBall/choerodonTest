# Choerodon 旧版 Message / Notification / Alert / Result / Spin（choerodon-ui，非 Pro）

旧版前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`；图标前缀 `icon`（`configure/default.tsx:98`）。  
Pro 版（message / notification / spin）见 [choerodon-feedback.md](./choerodon-feedback.md)；同级旧版册见 [choerodon-legacy-select.md](./choerodon-legacy-select.md)。

## 旧版 vs Pro 区分

| 组件 | 旧版（本文） | Pro（`components-pro`） | 类名前缀 | 绑定 DataSet |
|------|--------------|-------------------------|----------|--------------|
| message | `import { message } from 'choerodon-ui'`（`components/index.tsx:84`） | `choerodon-ui/pro` 同名导出；`components-pro/message/index.tsx:1` 直接转发 `choerodon-ui/lib/message` | 两侧都是 `c7n-message*`，**没有** `c7n-pro-` 前缀 | 否 |
| notification | `import { notification } from 'choerodon-ui'`（`:90`） | 同上，转发 `choerodon-ui/lib/notification`（`components-pro/notification/index.tsx:1`） | 两侧都是 `c7n-notification*` | 否 |
| spin | `import { Spin } from 'choerodon-ui'`（`:114`） | `components-pro/spin/index.tsx:4` 包裹 `choerodon-ui/lib/spin`，继承 DataSetComponent | 两侧都是 `c7n-spin*` | Pro 是（`dataSet.status` 驱动 spinning）；旧版否 |
| alert | `import { Alert } from 'choerodon-ui'`（`:24`） | 无（`components-pro` 下无 alert） | `c7n-alert*` | — |
| result | `import { Result } from 'choerodon-ui'`（`:106`） | 无（`components-pro` 下无 result） | `c7n-result*` | — |

结论：message / notification / spin 的 DOM 与 Pro 一致，区别只在导入路径与 spin 是否绑 DataSet；alert / result 为旧版独有。

---

## Message

源码：[components/message](https://github.com/open-hand/choerodon-ui/tree/master/components/message)

静态 API：`message.success|error|info|warning|warn|loading(content, [duration], [onClose], [placement])`，返回值可 `.then()`；另有 `message.config` / `message.destroy`（`index.zh-CN.md`）。

### DOM

```
.c7n-message                                        # 全局容器，挂 body（index.tsx:25 getPrefixCls('message')）
  └── .c7n-message-notice                           # 单条（Notice: `${prefixCls}-notice`）
        └── .c7n-message-notice-content.c7n-message-content-{type}
              └── .c7n-message-custom-content.c7n-message-{type}
                    ├── i.icon / .c7n-progress.c7n-progress-loading   # loading 时为 Progress
                    └── span                            # 文案
# type: info | success | error | warning | loading（index.tsx:18）
# 不渲染关闭按钮（notice() 未传 closable）
```

### 源码识别

1. 无 JSX 标签，静态调用 `message.success('…')`，import 自 `choerodon-ui`（非 `/pro`）。
2. `message.loading(content, 0)` 返回的函数用于手动关闭（`message/demo/loading.md`）。
3. 不绑定 DataSet 字段。

### 分析产物

```yaml
# 非字段控件：不产生 field_rules 项；反馈由操作步骤的等待/断言表达
```

### 自动化步骤

1. 触发：点击业务按钮（优先 `role=button` + `name`）。
2. 等出现：`- action: waitFor` + `args: { visible: messageSuccess }`；info / error / warning / loading 分别用下方新增键。
3. 文案断言：用步骤级 `textContains`（写法同 choerodon-feedback.md 的 message 节，挂载位置 <<待核实>>）；`assertVisible` 只校验可见。
4. 等自动消失：`- action: waitFor` + `args: { hidden: messageSuccess }`；默认 duration 3 秒（`index.zh-CN.md:30`），以 `message.config` 为准。
5. loading（`duration=0`）不会自动消失，须由业务代码调用 hide；测试侧等待 `hidden` 即可。

```yaml
# 建议新增 kit（messageSuccess 已存在于 platform/choerodon/kit.yaml）
messageInfo:
  css: .c7n-message-custom-content.c7n-message-info
messageError:
  css: .c7n-message-custom-content.c7n-message-error
messageWarning:
  css: .c7n-message-custom-content.c7n-message-warning
messageLoading:
  css: .c7n-message-custom-content.c7n-message-loading
```

---

## Notification

源码：[components/notification](https://github.com/open-hand/choerodon-ui/tree/master/components/notification)

静态 API：`notification.success|error|info|warning|warn(args)`、`notification.open(args)`、`notification.close(key)`、`notification.config(options)`、`notification.destroy()`。`args` 含 `message`、`description`、`btn`、`key`、`duration`（默认 4.5 秒，`null` 不自动关）、`placement`（默认 `topRight`）。

### DOM

```
.c7n-notification[.c7n-notification-topLeft | -bottomLeft]   # 容器，挂 body（Notification.tsx:234）
  └── .c7n-notification-notice                              # 单条（Notice: `${prefixCls}-notice`）
        ├── .c7n-notification-notice-content
        │     └── div[.c7n-notification-notice-with-icon]     # 有 icon 或 type 时
        │           ├── i.icon.c7n-notification-notice-icon.c7n-notification-notice-icon-{type}
        │           ├── .c7n-notification-notice-message       # 标题
        │           ├── .c7n-notification-notice-description   # 描述（可选）
        │           └── span.c7n-notification-notice-btn       # btn（可选）
        └── a.c7n-notification-notice-close                    # closable 恒为 true；<a> 非 <button>
              └── i.icon.icon-close.c7n-notification-close-icon  # 默认 closeIcon（Notice.tsx:48）
```

注意：`choerodon-feedback.md` 写的关闭内层为 `span.c7n-notification-notice-close-x`，但按旧版源码默认值，`closeIcon` 未传时渲染的是上面的 `c7n-notification-close-icon`（`Notice.tsx:48`，`close-x` 仅在显式传入 falsy 时出现，`Notice.tsx:115`）。以本节为准。

### 源码识别

1. 静态调用 `notification.open({ message, description })` 或 `notification.success(...)`，import 自 `choerodon-ui`。
2. 带 `btn` / 带 `key` 的调用常用于交互式通知（`notification/demo/with-btn.md`）。
3. 不绑定 DataSet 字段。

### 分析产物

```yaml
# 非字段控件：不产生 field_rules 项
```

### 自动化步骤

1. 触发：点击业务按钮。
2. 等出现：`- action: waitFor` + `args: { visible: notificationNotice }`。
3. 多条并存时按标题收窄：`.c7n-notification-notice:has(.c7n-notification-notice-message:text-is("标题"))`（与 choerodon-feedback.md 一致）。
4. 关闭：点该条内的 `.c7n-notification-notice-close`（是 `<a>`，不是 button）。
5. 等消失：`waitFor` + `args: { hidden: notificationNotice }`；`duration: null` 时不会自动消失，只能手动关闭。
6. 带 btn：点 `.c7n-notification-notice-btn` 内的按钮（`click`，限定到该条通知）。

```yaml
# 建议新增 kit（notificationNotice / notificationClose / notificationTitle / notificationDescription 已存在）
notificationWithIcon:
  css: .c7n-notification-notice-with-icon
notificationIcon:
  css: .c7n-notification-notice-icon
notificationBtn:
  css: .c7n-notification-notice-btn
notificationCloseIcon:
  css: .c7n-notification-close-icon
  note: 默认关闭图标；点击目标用 notificationClose（外层 a）
```

---

## Alert

源码：[components/alert](https://github.com/open-hand/choerodon-ui/tree/master/components/alert)

Props：`type`（`success|info|warning|error`）、`message`、`description`、`closable`、`closeText`、`showIcon`、`iconType`、`banner`、`iconOutline`、`onClose`、`afterClose`（`index.zh-CN.md`）。默认 `type=info`，`banner` 模式默认 `warning` 且显示图标。

### DOM

```
div.c7n-alert.c7n-alert-{type}[.c7n-alert-with-description][.c7n-alert-no-icon][.c7n-alert-banner][.c7n-alert-closable]
  ├── i.icon.c7n-alert-icon                           # showIcon 时（alert/index.tsx:175）
  ├── div.c7n-alert-content
  │     ├── span.c7n-alert-message                    # message
  │     └── span.c7n-alert-description                # description（无内容也渲染空 span）
  └── button.c7n-alert-close-wrapper                  # closable 或 closeText 时
        └── a.c7n-alert-close-icon                    # 点击关闭；内容为 closeText 或 icon-close
# 关闭动画中带 .c7n-alert-close；动画结束后整节点被移除（closed → null）
```

### 源码识别

1. JSX `<Alert message="…" type="…" />`，import 自 `choerodon-ui`；Pro 无同名组件，`choerodon-ui/pro` 下不存在 Alert。
2. `banner` 属性 → 顶部公告样式 `.c7n-alert-banner`（`alert/demo/banner.md`）。
3. 不绑定 DataSet，不是表单字段。

### 分析产物

```yaml
# 非字段控件：静态展示，不产生 field_rules 项
```

### 自动化步骤

1. 断言可见：`assertVisible` 目标为 `alertRoot` 并以文案收窄，即 `.c7n-alert:has(.c7n-alert-message:text-is("…"))`。
2. 类型断言：在上述选择器上追加 `.c7n-alert-error`（或 `-warning` 等），不单独发明关键字。
3. 关闭：`click` 该 alert 内的 `alertCloseIcon`（`closable` 且无 closeText 时点 `a`）。
4. 等移除：`waitFor` + `args: { hidden: <该 alert 的收窄选择器> }`（DOM 在动画后移除，不是 display:none）。
5. `closeText` 也会使 Alert 可关闭（`alert/index.tsx:153-155`）。

```yaml
# 建议新增 kit
alertRoot:
  css: .c7n-alert
  note: 功能层用 :has(.c7n-alert-message:text-is("…")) 收窄
alertBanner:
  css: .c7n-alert.c7n-alert-banner
alertMessage:
  css: .c7n-alert-message
alertDescription:
  css: .c7n-alert-description
alertIcon:
  css: .c7n-alert-icon
alertCloseIcon:
  css: .c7n-alert-close-icon
  note: 为 <a>（无 href）；勿用 role=link
```

---

## Result

源码：[components/result](https://github.com/open-hand/choerodon-ui/tree/master/components/result)

Props：`status`（`success|error|info|warning|403|404|500`，默认 `info`）、`title`、`subTitle`、`icon`、`extra`、`statusRenderer`（`index.zh-CN.md`）。

### DOM

```
div.c7n-result.c7n-result-{status}                    # result/index.tsx:92
  ├── div.c7n-result-icon                             # success/error/info/warning：内含 i.icon（check_circle / error / info / warning）
  │   或
  │   div.c7n-result-icon.c7n-result-image            # 403 / 404 / 500：内含无类名 svg（宽 800，500 为 400）
  ├── div.c7n-result-title                            # title
  ├── div.c7n-result-subtitle                         # subTitle（有值时）
  ├── div.c7n-result-content                          # children（有值时）
  └── div.c7n-result-extra                            # extra（有值时，内放按钮）
```

### 源码识别

1. JSX `<Result status="…" title="…" />`，import 自 `choerodon-ui`，无 Pro 版本。
2. `status` 为 `403` / `404` / `500` → 整页错误页（图片型，`c7n-result-image`）；其余为图标型。
3. `extra` 内通常放 `Button`（见 `result/demo/404.md`、`success.md`）。
4. 不绑定 DataSet。

### 分析产物

```yaml
# 整页结果态，非字段控件：不进 field_rules
# 就绪标记建议用 kit 键 resultRoot；状态以 class c7n-result-<status> 区分
```

### 自动化步骤

1. 等结果页出现：`waitFor` + `args: { visible: resultRoot }`。
2. 标题断言：`assertVisible` 目标 `resultTitle`（用 `hasText` 或 `:text-is` 收窄文案）。
3. 状态断言：`resultRoot` 追加 `.c7n-result-404`（或 `-success` / `-error` 等）；`403/404/500` 无文字图标，只能靠类名。
4. 操作区：在 `resultExtra` 内 `click` 按钮（`role=button` + `name`）。

```yaml
# 建议新增 kit
resultRoot:
  css: .c7n-result
  note: 结果页根；状态用 .c7n-result-<status> 收窄
resultIcon:
  css: .c7n-result-icon
resultImage:
  css: .c7n-result-icon.c7n-result-image
  note: 403/404/500 错误页图片（svg 无类名，靠父级）
resultTitle:
  css: .c7n-result-title
resultSubtitle:
  css: .c7n-result-subtitle
resultExtra:
  css: .c7n-result-extra
```

---

## Spin

源码：[components/spin](https://github.com/open-hand/choerodon-ui/tree/master/components/spin)

Props：`spinning`（默认 true）、`tip`、`size`（`small|default|large`）、`delay`（毫秒，防闪烁）、`indicator`、`wrapperClassName`（`index.zh-CN.md`）。DOM 与 Pro 版一致，Pro 额外由 `dataSet` 驱动（见 choerodon-feedback.md）。

### DOM

```
独立 Spin（无 children）
div.c7n-spin.c7n-spin-spinning[.c7n-spin-sm | .c7n-spin-lg][.c7n-spin-show-text]
  ├── .c7n-progress.c7n-progress-loading.c7n-spin-dot    # 默认指示器（Progress type=loading）
  └── div.c7n-spin-text                                  # 仅传 tip

包裹式 Spin（有 children）
div.c7n-spin-nested-loading[.wrapperClassName]
  ├── div.c7n-spin.c7n-spin-spinning                     # 仅 spinning 为 true 时渲染（spin/index.tsx:180）
  └── div.c7n-spin-container[.c7n-spin-blur]             # 子内容；spinning 时加 blur
```

### 源码识别

1. JSX `<Spin spinning={…} tip="…" />` 或 `<Spin spinning>…</Spin>`，import 自 `choerodon-ui`。
2. 无 `dataSet` 属性即旧版；带 `dataSet` 的是 Pro 版。
3. 带 `delay` 时，spinning 在延迟内结束则不渲染（`spin/index.tsx:57-59`，`spin/demo/delayAndDebounce.md`）。

### 分析产物

```yaml
# 区域级等待，不绑定字段，不进 field_rules
```

### 自动化步骤

1. 等加载结束（推荐）：`waitReady` 或 `- action: waitFor` + `args: { hidden: spinSpinning }`（与 choerodon-table.md 的 `hidden: tableSpin` 同模式）。
2. 等加载开始：`waitFor` + `args: { visible: spinSpinning }`；若设置了 `delay`，需先超过延时，否则可能不出现。
3. 包裹式不要用 `spinBlur` 作为 hidden 判据：container 始终存在，只是去掉 blur 类，`hidden` 会一直不通过。
4. 同页多个 Spin：用 `:has(…)` 或 within 收窄，避免误判。

```yaml
# 建议新增 kit（spinSpinning / spinBlur / spinText 已存在）
spinDot:
  css: .c7n-spin-dot
spinNestedLoading:
  css: .c7n-spin-nested-loading
spinContainer:
  css: .c7n-spin-container
  note: 子内容容器；加载中带 .c7n-spin-blur
```

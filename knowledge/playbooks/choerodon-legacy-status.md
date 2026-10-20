# Choerodon 旧版 Progress / Skeleton / Badge / Tag / Avatar（choerodon-ui，非 Pro）

源码：[progress](https://github.com/open-hand/choerodon-ui/tree/master/components/progress)、[skeleton](https://github.com/open-hand/choerodon-ui/tree/master/components/skeleton)、[badge](https://github.com/open-hand/choerodon-ui/tree/master/components/badge)、[tag](https://github.com/open-hand/choerodon-ui/tree/master/components/tag)、[avatar](https://github.com/open-hand/choerodon-ui/tree/master/components/avatar)。  
前缀推导：`components/configure/default.tsx:96` `prefixCls: 'c7n'`，`getPrefixCls(suffix)` 拼成 `c7n-<suffix>`；less 变量 `@c7n-prefix: c7n`（`components/style/themes/variables.less:12`）。  
Pro 版 Progress / Skeleton 见 [choerodon-feedback.md](./choerodon-feedback.md)。机器可读：建议新增键见各节，汇总在 `/tmp/pb/kit-choerodon-legacy-status.yaml`（待合并入 `kit.yaml`）。

## 旧版 vs Pro 区分

| 维度 | 旧版（本文） | Pro（choerodon-feedback.md） |
|------|--------------|------------------------------|
| JSX 导入路径 | `import { Progress, Skeleton } from 'choerodon-ui'` | `import { Progress, Skeleton } from 'choerodon-ui/pro'` |
| 类名前缀 | `c7n-progress*`、`c7n-skeleton*` | 同为 `c7n-progress*` / `c7n-skeleton*`（Pro 层复用 lib 的 DOM，据 choerodon-feedback.md 前言）；**无 `c7n-pro-` 前缀** |
| 是否绑定 DataSet | 否，由 `percent` / `loading` 等属性直接控制 | 是（数值字段绑定；Skeleton 可挂 `dataSet`） |

Badge / Tag / Avatar：`components-pro/` 下无同名目录，无 Pro 对照，本册只写旧版。

---

## Progress

源码：[components/progress](https://github.com/open-hand/choerodon-ui/tree/master/components/progress)

### 易混对照

| 组件 | 呈现 | 区分点 |
|------|------|--------|
| **Progress**（本节） | 线形 / 圆形 / 仪表盘 / loading 圈，只读 | 根类 `c7n-progress` + `-line` / `-circle` / `-loading` |
| Skeleton | 内容占位块，无数值 | 根类 `c7n-skeleton` |
| Spin | 区域遮罩 + 转圈；默认指示器复用 loading 型 Progress | 类 `c7n-spin`，见 [choerodon-legacy-feedback.md](./choerodon-legacy-feedback.md) |

### DOM

```
.c7n-progress.c7n-progress-{line|circle|loading}.c7n-progress-status-{normal|active|success|exception}
    [.c7n-progress-show-info][.c7n-progress-{size}]     # progress.tsx:236-242；dashboard 也输出 -circle
  ├── line：div                                          # progress.tsx:183-197
  │     ├── .c7n-progress-outer > .c7n-progress-inner
  │     │     ├── .c7n-progress-bg                       # 宽度 = percent%
  │     │     └── .c7n-progress-success-bg               # 传 successPercent 时
  │     └── span.c7n-progress-text                       # showInfo；文案或状态图标（progress.tsx:163）
  ├── circle / dashboard：.c7n-progress-inner            # progress.tsx:213
  │     ├── <<待核实:rc Circle 根元素标签>>.c7n-progress-circle
  │     │     ├── .c7n-progress-circle-trail             # rc-components/progress/Circle.jsx:85
  │     │     └── .c7n-progress-circle-path              # Circle.jsx:93
  │     ├── .c7n-progress-pointer                        # showPointer（progress.tsx:166）
  │     └── span.c7n-progress-text
  └── loading：.c7n-progress-inner                       # progress.tsx:230，内部为 Loading 组件 <<待核实:Loading 内部标签>>
```

注意：`.c7n-progress-circle` 既是根修饰类（progress.tsx:239）又是 rc Circle 的元素类（Circle.jsx:79），选择器必须写成 `.c7n-progress.c7n-progress-circle` 限定根。

### 源码识别

1. JSX：`<Progress percent={75} />`，`type="circle" | "dashboard" | "loading"`，`status`，`format`，`showInfo`（progress.tsx props）。
2. 无 DataSet，无 `lookupCode` / `type` 字段映射；定位只能靠所在区域的标题或表格行。
3. `percent >= 100` 且未传 `status` 时自动 `status-success`（progress.tsx 渲染逻辑）。

### 分析产物

```yaml
field_rules:
  - name: completionRate
    control: legacy_progress     # 只读展示；Pro 为 progress（见 choerodon-feedback.md）
    type: circle                  # line | circle | dashboard | loading
```

无 DataSet 字段时改挂 `display_hints`（同 choerodon-feedback.md 的做法）。

### 自动化步骤

1. 定位：`legacyProgressRoot` within 目标区域（卡片 / 表格行）；多个进度条时用 `legacyProgressLine` 或 `legacyProgressCircle` 收窄。
2. 等待渲染：`- action: waitFor` + `args: { visible: legacyProgressRoot }`。
3. 断言数值：`assertVisible` 的 target 为 `legacyProgressText`；文案比对沿用 choerodon-feedback.md 的 `textContains` 写法（<<待核实:asserts 写法>>）。
4. 异常态：`assertVisible` target `legacyProgressStatusException`。
5. 只读，不要 `click` 进度条。

### 建议新增 kit 键

```yaml
legacyProgressRoot:
  css: .c7n-progress
  note: 与 progressRoot 同 DOM；功能层 within 收窄到目标区域
legacyProgressLine:
  css: .c7n-progress.c7n-progress-line
legacyProgressCircle:
  css: .c7n-progress.c7n-progress-circle
  note: 含 dashboard
legacyProgressText:
  css: .c7n-progress-text
  note: showInfo 时的百分比或图标
legacyProgressBg:
  css: .c7n-progress-bg
  note: 宽度即百分比
legacyProgressStatusException:
  css: .c7n-progress.c7n-progress-status-exception
```

---

## Skeleton

源码：[components/skeleton](https://github.com/open-hand/choerodon-ui/tree/master/components/skeleton)

### 易混对照

| 组件 | 呈现 | 区分点 |
|------|------|--------|
| **Skeleton**（本节） | 标题 / 段落 / 头像占位块，`loading` 切换真实内容 | 根类 `c7n-skeleton` |
| Progress | 进度数值 | 类 `c7n-progress` |
| Spin | 遮罩 + 转圈 | 类 `c7n-spin` |

### DOM

```
.c7n-skeleton[.c7n-skeleton-with-avatar][.c7n-skeleton-active]     # Skeleton.tsx:176-179
  ├── .c7n-skeleton-header                                          # 有 avatar 时（Skeleton.tsx:124）
  │     └── .c7n-skeleton-avatar[.c7n-skeleton-avatar-lg|-sm][.c7n-skeleton-avatar-circle|-square]
  │                                                                  # Element.tsx:18-39，prefixCls 为 `skeleton-avatar`
  └── .c7n-skeleton-content                                         # Skeleton.tsx:168
        ├── h3.c7n-skeleton-title                                   # Title.tsx:13
        └── ul.c7n-skeleton-paragraph > li                          # Paragraph.tsx:34

# 独立占位块（Skeleton.Avatar / Skeleton.Input 等）
.c7n-skeleton.c7n-skeleton-element[.c7n-skeleton-active]           # Avatar.tsx:14-20、Input.tsx:14-16
  └── .c7n-skeleton-avatar（Avatar）或 .c7n-skeleton-input（Input）  # <<待核实:Input 子类名后缀>>
```

### 源码识别

1. JSX：`<Skeleton loading={…} active avatar title paragraph>{children}</Skeleton>`（`skeleton/index.zh-CN.md` API）。
2. `loading` 为 `false` 时直接渲染 children；**未传 `loading` 时始终显示占位**（Skeleton.tsx 渲染分支 `loading || !('loading' in props)`）。
3. 无 DataSet，无 Field 映射。

### 分析产物

```yaml
display_hints:
  - control: legacy_skeleton
    loading: true
    active: true
```

### 自动化步骤

1. 等占位消失（内容就绪）：`- action: waitFor` + `args: { hidden: legacySkeletonRoot }`，限定在目标区域内。
2. 占位仍在时：`waitFor` `args: { visible: legacySkeletonRoot }`。
3. `active` 只是动画，不作为完成判据。
4. 不要把 `legacySkeletonRoot` 当成"页面已加载"的唯一判据；同页多个 Skeleton 时用 within 收窄。

### 建议新增 kit 键

```yaml
legacySkeletonRoot:
  css: .c7n-skeleton
  note: 也匹配 Skeleton.Avatar / Input 等独立占位块；限定到目标区域
legacySkeletonActive:
  css: .c7n-skeleton.c7n-skeleton-active
  note: 仅表示动画，不作完成判据
legacySkeletonTitle:
  css: .c7n-skeleton-title
  note: h3 标题占位
legacySkeletonParagraph:
  css: .c7n-skeleton-paragraph
  note: ul 段落占位
legacySkeletonAvatar:
  css: .c7n-skeleton-avatar
  note: 头像占位块
```

---

## Badge

源码：[components/badge](https://github.com/open-hand/choerodon-ui/tree/master/components/badge)

### 易混对照

| 组件 | 呈现 | 区分点 |
|------|------|--------|
| **Badge**（本节） | 角标数字 / 小红点包在子元素右上角；或 `status` 状态点 | 根类 `c7n-badge` |
| Tag | 标签胶囊 | 根类 `c7n-tag`（见下节） |
| Avatar | 头像 | 根类 `c7n-avatar` |
| Select 多选已选项 | 看似标签 | `c7n-select-selection__choice`，见 [choerodon-legacy-select.md](./choerodon-legacy-select.md) |

### DOM

```
span.c7n-badge[.c7n-badge-status][.c7n-badge-not-a-wrapper]          # badge/index.tsx:151-156；无 children 时 not-a-wrapper
  ├── {children}                                                      # 被包裹元素（如 Icon、a）
  ├── sup.c7n-scroll-number.c7n-badge-count[.c7n-badge-count-sm][.c7n-badge-multiple-words][.c7n-badge-status-{color}]
  │     └── span.c7n-scroll-number-only > span.c7n-scroll-number-only-unit   # 逐位滚动（SingleNumber.tsx:25,120）
  ├── sup.c7n-scroll-number.c7n-badge-dot                             # dot 模式（badge/index.tsx:143）
  └── span.c7n-badge-status-text                                      # status / text 时
# ScrollNumber 默认 sup（ScrollNumber.tsx:30），className 由 badge 注入（ScrollNumber.tsx:42）
# isHidden（count 为 0 且未 showZero）时不渲染 sup

# 无 children 的状态点形态
span.c7n-badge.c7n-badge-status.c7n-badge-not-a-wrapper
  ├── span.c7n-badge-status-dot.c7n-badge-status-{success|processing|default|error|warning}   # badge/index.tsx:136-139
  └── span.c7n-badge-status-text
```

### 源码识别

1. JSX：`<Badge count={5}>…</Badge>`、`<Badge dot>`、`<Badge status="success" text="…" />`（`badge/demo/basic.md`、`dot.md`）。
2. `count` 为 0 默认不渲染，`showZero` 时显示；超过 `overflowCount`（默认 99）显示 `99+`（`badge/index.zh-CN.md` API 表）。
3. 无 children 且有 `status` → 状态点形态。无 DataSet。

### 分析产物

```yaml
display_hints:
  - control: legacy_badge
    count: 5
    dot: false
    status: ''
```

### 自动化步骤

1. 定位包裹元素：`legacyBadgeRoot:has(legacyBadgeCount)` within 目标区域（如工具栏、菜单项）。
2. 读数字：`assertVisible` target `legacyBadgeCount`，文案比对沿用 `textContains` 写法（<<待核实:asserts 写法>>）。
3. count 为 0（未 showZero）：`waitFor` `args: { hidden: legacyBadgeCount }`。
4. dot：`assertVisible` target `legacyBadgeDot`。
5. 状态点文案：`assertVisible` target `legacyBadgeStatusText`。
6. Badge 本身不可交互；要点击角标所在元素，用 `click` 作用于 children 的定位（如 Icon）。

### 建议新增 kit 键

```yaml
legacyBadgeRoot:
  css: .c7n-badge
  note: 包裹元素根；与 Tag / Avatar 区分靠 within 收窄
legacyBadgeCount:
  css: .c7n-badge .c7n-badge-count
  note: 数字角标；count 为 0 且未 showZero 时不存在
legacyBadgeDot:
  css: .c7n-badge .c7n-badge-dot
  note: dot 模式小红点
legacyBadgeStatusDot:
  css: .c7n-badge-status-dot
  note: status 状态点
legacyBadgeStatusText:
  css: .c7n-badge-status-text
  note: status / text 时的文案
```

---

## Tag

源码：[components/tag](https://github.com/open-hand/choerodon-ui/tree/master/components/tag)

### 易混对照

| 组件 | 呈现 | 区分点 |
|------|------|--------|
| **Tag**（本节） | 静态标签，可 `closable` 关闭 | 根类 `c7n-tag` |
| CheckableTag | 点击切换选中 | 同根类 + `c7n-tag-checkable` |
| Select 多选已选项 | 下拉多选的 chip | `c7n-select-selection__choice`（非 `c7n-tag`） |
| Badge | 数字角标 | `c7n-badge` |

### DOM

```
div.c7n-tag[.c7n-tag-has-color][.c7n-tag-{presetColor}][.c7n-tag-hover-show-pointer][.c7n-tag-close]
    # tag/index.tsx:144-150,167；-close 仅在关闭动画过程中（closing 状态）
  ├── {children}
  └── i.icon.icon-close                # closable 时；Icon 类由 icon/index.tsx:28 拼为 `icon icon-<type>`（iconfontPrefix 默认 'icon'，configure/default.tsx）

# CheckableTag（tag/CheckableTag.tsx:32-42）
div.c7n-tag.c7n-tag-checkable[.c7n-tag-checkable-checked]     # onClick 绑在根上，点击切换
```

`closed` 后节点被移除（tag/index.tsx 渲染分支 `closed ? null : …`），关闭后用"节点消失"断言。

### 源码识别

1. JSX：`<Tag color="green" closable onClose={fn}>文本</Tag>`；`<Tag.CheckableTag checked onChange>`（`tag/demo/checkable.md`）。
2. `color` 为预设色名 → `c7n-tag-{color}`；自定义色 → `c7n-tag-has-color` + 内联 style（tag/index.tsx:147-148）。
3. 无 DataSet。

### 分析产物

```yaml
display_hints:
  - control: legacy_tag
    closable: true
    checkable: false
```

### 自动化步骤

1. 定位：`legacyTagRoot` 按文案收窄（hasText），限定在目标区域内。
2. 断言文案：`assertVisible` target `legacyTagRoot` hasText 文案（写法 <<待核实:hasText 参数>>）。
3. 关闭：`click` `legacyTagClose` within 目标标签；随后 `waitFor` `args: { hidden: legacyTagRoot }`（需 hasText 指定该标签）。
4. CheckableTag：`click` `legacyTagCheckable` hasText；断言选中用 `assertVisible` target `legacyTagCheckableChecked`。

### 建议新增 kit 键

```yaml
legacyTagRoot:
  css: .c7n-tag
  note: 静态 / 可关闭标签；按 hasText 收窄
legacyTagClose:
  css: .c7n-tag .icon-close
  note: closable 时的关闭图标；需 within 目标标签
legacyTagCheckable:
  css: .c7n-tag.c7n-tag-checkable
  note: CheckableTag
legacyTagCheckableChecked:
  css: .c7n-tag.c7n-tag-checkable-checked
  note: 已选中的 CheckableTag
```

---

## Avatar

源码：[components/avatar](https://github.com/open-hand/choerodon-ui/tree/master/components/avatar)

### 易混对照

| 组件 | 呈现 | 区分点 |
|------|------|--------|
| **Avatar**（本节） | 图片 / 图标 / 文字头像 | 根类 `c7n-avatar` |
| Avatar.Group | 一组头像，超出 `maxCount` 收为 `+N` | 根类 `c7n-avatar-group` |
| Badge | 角标，常包裹头像 | `c7n-badge` |
| Skeleton 头像占位 | 非真实头像 | `c7n-skeleton-avatar` |

### DOM

```
span.c7n-avatar[.c7n-avatar-lg|.c7n-avatar-sm][.c7n-avatar-{shape}][.c7n-avatar-image][.c7n-avatar-icon]
    # avatar/index.tsx:127-135,184；{shape} 取 circle | square（index.zh-CN.md 默认 circle）
  ├── img                              # src 加载成功时（image 类）<<待核实:img 是否直接在 span 内>>
  ├── i.icon.icon-<icon>               # icon 属性，经 renderIcon 生成 Icon（avatar/index.tsx 渲染分支）
  └── span.c7n-avatar-string           # 字符串 children（avatar/index.tsx:168,177）

# Avatar.Group（avatar/Group.tsx:42-52）
div.c7n-avatar-group
  ├── span.c7n-avatar …
  └── 超过 maxCount 时：Popover 触发元素
        ├── span.c7n-avatar-popover-mask > span.c7n-avatar-popover-number   # 文案 "+N"（Group.tsx:71-73）
        └── 弹层 .c7n-avatar-popover（挂 body，Group.tsx:69）
```

### 源码识别

1. JSX：`<Avatar src="…" />`、`<Avatar icon="person" />`、`<Avatar>K</Avatar>`；组合用 `<Avatar.Group maxCount={n}>`（`avatar/demo/basic.md`、`group.md`）。
2. 渲染分支：`src` 加载成功 → 图片；失败或无 src → `icon` → children（avatar/index.tsx 渲染逻辑）。
3. 无 DataSet。

### 分析产物

```yaml
display_hints:
  - control: legacy_avatar
    icon: person
    shape: circle
    size: default
```

### 自动化步骤

1. 定位：`legacyAvatarRoot` within 目标区域（如用户信息卡、表头）。
2. 图片头像：`assertVisible` target `legacyAvatarImage`；字母头像：`assertVisible` target `legacyAvatarString`，文案按 hasText 比对。
3. 超出数量：默认 `maxPopoverTrigger` 为 hover（index.zh-CN.md），需先 hover `legacyAvatarPopoverNumber`，再 `waitFor` `args: { visible: legacyAvatarPopover }`（hover 关键字 <<待核实:是否存在 hover 关键字，否则用 Playwright hover 原语>>）。
4. 不要对 `Avatar.Group` 整体 click；点击的是其中某个头像时用该头像的定位。

### 建议新增 kit 键

```yaml
legacyAvatarRoot:
  css: .c7n-avatar
  note: 头像根（span）；功能层 within 收窄
legacyAvatarImage:
  css: .c7n-avatar.c7n-avatar-image
  note: 图片头像（src 加载成功）
legacyAvatarString:
  css: .c7n-avatar-string
  note: 文字头像
legacyAvatarGroup:
  css: .c7n-avatar-group
  note: Avatar.Group 外壳
legacyAvatarPopoverNumber:
  css: .c7n-avatar-popover-number
  note: 超出数量的 +N，hover 触发
legacyAvatarPopover:
  css: .c7n-avatar-popover
  note: 超出头像弹层，挂 body
```

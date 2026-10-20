# Choerodon 旧版 Affix / BackTop / Trigger（choerodon-ui，非 Pro）

源码以 `components/` 为准（发布产物 `lib/` 由其编译，仓库内无 lib 目录）。  
旧版前缀 `c7n`（`components/configure/default.tsx:96`），`getPrefixCls(suffix, customizePrefixCls?)` 拼成 `c7n-<suffix>`（`components/configure/utils.tsx:14-20`）。  
Pro 版对照见下表；Pro 版 TriggerField 见 [choerodon-select.md](./choerodon-select.md)，旧版 Popover / Tooltip 底层 rc-trigger 见 [choerodon-legacy-overlay.md](./choerodon-legacy-overlay.md)。

## 旧版 vs Pro 区分

| 组件 | 旧版 JSX 导入 | 旧版类名前缀 | Pro 版 | 是否绑定 DataSet |
|------|---------------|--------------|--------|------------------|
| Affix | `import { Affix } from 'choerodon-ui'`（`components/index.tsx:16`） | `c7n-affix` | 无（`components-pro` 下无 affix 目录，已核实） | 否 |
| BackTop | `import { BackTop } from 'choerodon-ui'`（`components/index.tsx:28`） | `c7n-back-top` | 无（`components-pro` 下无 back-top 目录，已核实） | 否 |
| Trigger | 未从 `choerodon-ui` 导出（`components/index.tsx` 无 Trigger），仅内部引用 `../trigger/Trigger` | 由消费方 `prefixCls` 决定（Upload 为 `c7n-upload-popup`） | `components-pro/trigger`，无独立 playbook | 否 |

同名 Pro playbook：无（已 grep `affix` / `back-top` / `trigger`，仅 TriggerField 相关内容见 choerodon-select.md）。

---

## Affix（固钉）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/affix

与易混组件：**Anchor 固定态**（`div.c7n-anchor.fixed`，见 [choerodon-legacy-nav.md](./choerodon-legacy-nav.md)）不是 Affix，二者不要混用断言。

### DOM

```
div（外层：透传 className / style / 其他属性；固定时带占位宽高 inline style）
  └── div.c7n-affix                 # 仅 affixStyle 非空（已固定）时存在
        style: position:fixed; top|bottom; left; width   # affix/index.tsx setAffixStyle
        └── {children}
```

- 类名推导：`getPrefixCls('affix', prefixCls)` → `c7n-affix`（`affix/index.tsx` render；前缀 `c7n` 见 `configure/default.tsx:96`）。
- 样式：`affix/style/index.less:3-6`，`.c7n-affix { position: fixed; z-index: @zindex-affix }`。
- 传入 `prefixCls` 时类名整体替换为该值，不是追加后缀。
- 未固定时 `.c7n-affix` 不存在，**存在即固定态**。

### 源码识别

1. JSX：`<Affix offsetTop={n} offsetBottom={n} target={() => el}>`（`affix/index.zh-CN.md` API 表）。
2. 无 DataSet / Field 绑定，业务中多用于侧边栏、操作按钮组。
3. `offsetTop` 与 `offsetBottom` 均未传时默认 `offsetTop=0`（`affix/index.tsx` `updatePosition`）。

### 分析产物

```yaml
field_rules:
  - name: <<待核实:无字段绑定时 name 的约定>>
    control: legacy_affix          # 区别 legacy_back_top / legacy_trigger
```

### 自动化步骤

1. Affix 监听 `target`（默认 `window`）的 `scroll`，因此需先让页面滚动。
2. 滚动：无专用关键字，焦点在 body 时用 `press` `PageDown` 逐屏下滚；若 `target` 指向某个容器，需先在该容器内点击聚焦，再 `press` `PageDown`。
3. `waitFor` `legacyAffixFixed` 可见，再 `assertVisible` `legacyAffixFixed`。
4. 取消固定：`press` `Home` 回顶，`waitFor` `legacyAffixFixed` 隐藏。
5. 固定态变化是节流（requestAnimationFrame）后的异步更新，`waitFor` 必须，不要直接断言。

### 建议新增 kit 键

```yaml
legacyAffixFixed:
  css: .c7n-affix
  note: '旧版 Affix 固定态；存在即 position:fixed，不存在为未固定'
```

---

## BackTop（回到顶部）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/back-top

与易混组件：Affix 包裹任意内容并钉住；BackTop 是独立悬浮按钮，不包裹业务内容。

### DOM

```
div.c7n-back-top                    # position:fixed; right:1rem; bottom:.5rem; z-index:10（back-top/style/index.less:6-12）
  └── div.c7n-back-top-content      # 圆形底，默认 0.4rem（index.less）
        └── div.c7n-back-top-icon   # 箭头背景图（index.less）
```

- 类名推导：`getPrefixCls('back-top', customizePrefixCls)` → `c7n-back-top`（`back-top/index.tsx` render）；子类名 `-content` / `-icon` 来自 `back-top/index.tsx` render 的模板字符串。
- `children` 存在时整体替换 `-content` 与 `-icon`（`children || defaultElement`）。`demo/custom.md` 中的 `c7n-back-top-inner` 是示例自定义类名，不是内置类。
- 挂载条件：`scrollTop > visibilityHeight`（默认 400，`defaultProps`）。未达到阈值时**节点不存在**（`render` 返回 `null`），不是 `display:none`。
- 响应式：`back-top/style/responsive.less` 在 `@screen-md` / `@screen-xs` 下改 `right`。
- 进出场：`<Animate transitionName="fade">`，动画类名 <<待核实:fade-enter / fade-leave 具体类名>>。

### 源码识别

1. JSX：`<BackTop visibilityHeight={n} target={() => el} onClick={fn} />`，`import { BackTop } from 'choerodon-ui'`。
2. 无 DataSet；页面中仅出现一个悬浮圆按钮，且位于右下角。

### 分析产物

```yaml
field_rules:
  - name: <<待核实:同 Affix>>
    control: legacy_back_top
```

### 自动化步骤

1. 页面需超过 400px 才会出现按钮；先 `press` `PageDown` 一到两次（焦点在 body）。
2. `waitFor` `legacyBackTop` 可见。页面不足 400px 时按钮不出现，属正常，不判失败。
3. `click` `legacyBackTop`（点整个容器，内部 `scrollTo(0)` 平滑回顶）。
4. 断言回顶：`waitFor` `legacyBackTop` 隐藏（回到阈值以内即卸载）。
5. 若要断言 `onClick` 回调，业务侧需用可观测副作用（如接口请求），本组件本身无 DOM 变化。

### 建议新增 kit 键

```yaml
legacyBackTop:
  css: .c7n-back-top
  note: '旧版回到顶部按钮；仅滚动超过 visibilityHeight 时挂载'
legacyBackTopContent:
  css: .c7n-back-top .c7n-back-top-content
  note: '默认样式圆底；自定义 children 时不存在'
legacyBackTopIcon:
  css: .c7n-back-top .c7n-back-top-icon
  note: '默认箭头图标；自定义 children 时不存在'
```

---

## Trigger（触发器，内部组件）

源码：https://github.com/open-hand/choerodon-ui/tree/master/components/trigger

本组件无 `index.zh-CN.md`、未从 `choerodon-ui` 导出，**业务代码不直接使用**。仓内唯一消费方为 Upload（`upload/Upload.tsx:15` 引入，`:495` 渲染），下面以 Upload 的悬停附件列表为识别依据。

与易混组件：

| 组件 | 源码 | 区别 |
|------|------|------|
| **Trigger**（本节） | `components/trigger` | popup 类名 `${prefixCls}-popup`，由消费方传入 `prefixCls` |
| rc-trigger | `components/rc-components/trigger` | Popover / Tooltip 底层，根为 `.c7n-popover`（见 choerodon-legacy-overlay.md） |
| Pro TriggerField | `components-pro/trigger-field` | 表单下拉基类（见 choerodon-select.md） |

### DOM

```
.c7n-pro-popup-container                              # 挂 body 的容器（trigger/Popup.tsx:39，getProPrefixCls）
  └── div.{prefixCls}-popup[.{prefixCls}-popup-placement-{对齐结果}]   # Trigger.tsx:658 / :44
        └── div.{prefixCls}-popup-inner                # Upload renderPopupContent（upload/Upload.tsx:483）
```

- Upload 中 `prefixCls = getPrefixCls('upload')` → `c7n-upload`（`upload/Upload.tsx:377-380,418,448`），故弹层为 `c7n-upload-popup`。
- 容器类 `c7n-pro-popup-container` 使用 Pro 前缀，与 Pro 版共用，**不要单独作为断言依据**。
- 对齐后缀 `{对齐结果}` 由 `builtinPlacements` 匹配得出，Upload 传 `popupPlacement="bottomLeft"`（`Upload.tsx:500`），实际取值 <<待核实:placement 后缀是否为 bottomLeft>>。
- 动画：`transitionName` 默认 `slide-up`（`Trigger.tsx` `defaultProps`）。

### 源码识别

1. 业务侧识别：Upload 上悬停或聚焦（`action={[Action.hover, Action.focus]}`，`Upload.tsx:498`）弹出附件列表即为 Trigger。
2. 无 DataSet 绑定。

### 分析产物

```yaml
field_rules:
  - name: <<待核实:同 Affix>>
    control: legacy_trigger        # 宜并入 upload 条目，避免单独建 control
```

### 自动化步骤

1. 触发：对 Upload 的触发元素做原生 `hover()`（无专用关键字）；触发元素选择器 <<待核实:Upload 触发元素 class>>。
2. `waitFor` `legacyTriggerUploadPopup` 可见，再 `assertVisible` `legacyTriggerUploadPopupInner`。
3. 收起：鼠标移出（hover 触发）；若为 focus 触发，`press` `Tab` 移走焦点。`waitFor` `legacyTriggerUploadPopup` 隐藏。
4. 页面存在多个 Upload 时，popup 挂 body，需以触发元素为锚收窄，不能只用全局类名。

### 建议新增 kit 键

```yaml
legacyTriggerUploadPopup:
  css: .c7n-upload-popup
  note: '旧版 Trigger 承载的 Upload 弹层（prefixCls=c7n-upload）；挂 body，多实例需收窄'
legacyTriggerUploadPopupInner:
  css: .c7n-upload-popup .c7n-upload-popup-inner
  note: '弹层内容区'
legacyTriggerPopupContainer:
  css: .c7n-pro-popup-container
  note: '挂 body 的弹层容器，与 Pro 共用类名，勿单独作断言'
```

---

## 常见误判

| 错误 | 正确 |
|------|------|
| 把 Anchor 的 `.fixed` 当 Affix 固定态 | Affix 固定态是 `.c7n-affix` |
| BackTop 不出现即判失败 | 页面高度不足 `visibilityHeight`（400px）时不出现，属正常 |
| 找 `c7n-pro-back-top` / `c7n-pro-affix` | 旧版前缀是 `c7n-`，且 Pro 无此组件 |
| 用 `c7n-pro-popup-container` 断言旧版 Trigger 弹层 | 断言 `c7n-upload-popup`（或 `legacyTriggerUploadPopup`） |
| 直接 `import { Trigger } from 'choerodon-ui'` | 未导出，Trigger 仅为内部组件 |

## 建议新增 kit 键汇总

全部建议键见 `/tmp/pb/kit-choerodon-legacy-misc.yaml`，合并前请与 `platform/choerodon/kit.yaml` 复核无重名。

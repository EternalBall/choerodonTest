# Choerodon Pro 富内容与展示（RichText / CodeArea / Picture / Typography / OverflowTip）

覆盖五类组件。类名前缀统一 `c7n-pro-`，后缀由各组件 `static defaultProps.suffixCls`（或 `getProPrefixCls`）推导，依据见各节。建议键见 `/tmp/pb/kit-choerodon-rich-content.yaml`（未并入 `platform/choerodon/kit.yaml`）。

## RichText（富文本）

源码：[components-pro/rich-text](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/rich-text)。  
前缀 `c7n-pro-rich-text`（`RichText.tsx:52` `suffixCls: 'rich-text'`）；编辑器为 react-quill，值为 Quill Delta（DataSet `type: object`，见 `demo/dataset.md`）。

| 控件 | 源码线索 | 交互 |
|------|----------|------|
| **RichText** | `<RichText>` / `type: object` | 工具栏 + 可编辑区 |
| **CodeArea** | `<CodeArea>` / `type: string` | 代码高亮编辑（见下节） |
| **RichText mode=preview** | `mode="preview"` | 只读渲染；点图片进 LightBox |

### DOM

```
.c7n-pro-rich-text-wrapper[.c7n-pro-rich-text-border][.c7n-pro-rich-text-focused]
  └── div.c7n-pro-rich-text                       # BaseEditor 根
        ├── div#<随机 id>.c7n-pro-rich-text-toolbar   # mode=editor；toolbar="normal"
        │     ├── button.ql-bold / .ql-italic / .ql-underline / .ql-strike / .ql-blockquote
        │     ├── button.ql-list[value=ordered|bullet] / button.ql-image / button.ql-link
        │     ├── select.ql-color
        │     └── select.ql-font                    # 仅 fontFamilies 配置时
        └── .c7n-pro-rich-text-quill                # react-quill 根
              └── .ql-container.ql-snow > .ql-editor[contenteditable]

# mode="preview"（RichTextViewer）
div.quill > .ql-container.ql-snow > .ql-editor
```

依据：`-wrapper` 来自 `ViewComponent.tsx:442`（`${prefixCls}-wrapper`）与 `rich-text/style/index.less`；`-toolbar` / `-quill` 来自 `BaseEditor.tsx:184-187`；按钮类来自 `toolbar/index.tsx:18-30`。toolbar id 为随机串（`RichText.tsx:63`），勿用 id 定位。

### 源码识别

1. JSX：`<RichText name="..." dataSet={ds} />`。
2. `toolbar="none"` 时无 `.c7n-pro-rich-text-toolbar`。
3. `mode="preview"` 时渲染 `RichText.RichTextViewer`，是 `div.quill`，不可编辑。
4. Quill 编辑区无 `<input>`，**不要写 `input[name=...]`**。

### 分析产物

```yaml
field_rules:
  - name: content
    control: rich_text          # rich_text | rich_text_preview
    editable_when: [detail_edit]
```

### 自动化步骤

1. 定位编辑区：kit 键 `richTextEditor`；同页多个富文本时，用字段 label 所在表单项收窄。
2. 输入：`- action: fill` + `args: { target: richTextEditor, value: 文本 }`（<<待核实：ata 运行时对 contenteditable 的 fill 支持>>）。
3. 加粗等：`- action: click` + `args: { target: richTextBoldBtn }`，再输入。
4. 只读态断言：`- action: assertVisible` + `args: { target: richTextViewer }`。
5. `disabled` / `readOnly` 时 `rtOptions.readOnly` 置 true（`RichText.tsx:180`），编辑区不可写。

```yaml
richTextWrapper:
  css: .c7n-pro-rich-text-wrapper
richTextEditor:
  css: .c7n-pro-rich-text-quill .ql-editor
```

### 常见误判

| 错误 | 正确 |
|------|------|
| `input[name=content]` 填富文本 | 无 input，用 `.ql-editor` |
| 用 `#toolbar` 定位工具栏 | id 随机，用 `.c7n-pro-rich-text-toolbar` |
| 样式前缀写 `rich-text` | 前缀为 `c7n-pro-rich-text` |
| 把 CodeArea 当富文本 | CodeArea 值为 string，DOM 为 `.CodeMirror` |

## CodeArea（代码域）

源码：[components-pro/code-area](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/code-area)。  
前缀 `c7n-pro-code-area`（`CodeArea.tsx:86` `suffixCls: 'code-area'`）；编辑器为 react-codemirror2（`.CodeMirror`），值为 `string`（`demo/dataset.md:52`）。

| 控件 | 源码线索 | 说明 |
|------|----------|------|
| **CodeArea** | `<CodeArea>` / `type: string` | 语法高亮代码编辑，支持格式化 |
| **TextArea** | 见 [choerodon-text-input.md](./choerodon-text-input.md) | 普通多行文本，无高亮 |
| **RichText** | 见上节 | Quill 富文本，值为 Delta |

### DOM

```
div.c7n-pro-code-area-wrapper
  ├── .c7n-pro-code-area-header[.c7n-pro-code-area-header-light|-dark]   # 仅 title 或 themeSwitch 时渲染
  │     ├── .c7n-pro-code-area-header-title
  │     └── .c7n-pro-code-area-header-switch > .c7n-pro-switch           # 主题开关
  └── label > span > div.c7n-pro-code-area[.c7n-pro-code-area-dark][.c7n-pro-code-area-disabled]  # react-codemirror2 外层；<<待核实：是否透传 className>>
        └── .CodeMirror[.CodeMirror-focused]
              ├── .CodeMirror-scroll
              └── pre.CodeMirror-placeholder          # 空值占位
```

依据：`-wrapper`（`code-area/style/index.less` `&-wrapper`）；`-header*` 来自 `CodeArea.tsx:312-326`；`-dark` / `-disabled` 来自 `getOtherClassName`（`CodeArea.tsx:276-281`）；`.CodeMirror` 与 `-focused` 见 less。

### 源码识别

1. JSX：`<CodeArea name="..." dataSet={ds} />`。
2. `options.theme` 已设置时不显示主题开关（`CodeArea.tsx:313`）。
3. `disabled` 或 `readOnly` 时 `cmOptions.readOnly = true`（`CodeArea.tsx:382`）。

### 分析产物

```yaml
field_rules:
  - name: content
    control: code_area          # code_area；只读态不纳入 editable_when
```

### 自动化步骤

1. 写入：优先 `- action: fill` + `args: { target: codeAreaTextarea, value: 文本 }`（<<待核实：隐藏 textarea 的 Playwright 可见性>>）；不通时改为 `click` `codeAreaEditor` → `press` `Control+A` → 输入。
2. 格式化：`- action: press` + `args: { target: codeAreaEditor, key: Alt+F }`（默认 `formatHotKey`，见 `index.zh-CN.md`）。
3. 清除格式化：同上，`key: Alt+R`（默认 `unFormatHotKey`）。
4. 切换主题：`- action: click` + `args: { target: codeAreaThemeSwitch }`。
5. 禁用断言：`- action: assertVisible` + `args: { target: codeAreaDisabled }`。

```yaml
codeAreaWrapper:
  css: .c7n-pro-code-area-wrapper
codeAreaEditor:
  css: .c7n-pro-code-area-wrapper .CodeMirror
codeAreaTextarea:
  css: .c7n-pro-code-area-wrapper .CodeMirror textarea
codeAreaDisabled:
  css: .c7n-pro-code-area-disabled
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 用 `input[name=...]` 找代码域 | CodeMirror 无 name，用 `.CodeMirror` 并按 label 收窄 |
| 把 `.c7n-pro-code-area-header` 当必有元素 | 仅 title 或 themeSwitch 时渲染 |
| 对 `.CodeMirror` 直接 `fill` | 写入落在 textarea 上，见自动化步骤 1 |

## Picture（图片）

源码：[components-pro/picture](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/picture)。  
前缀 `c7n-pro-picture`（`Picture.tsx:88` `getProPrefixCls('picture', prefixCls)`）；预览弹窗前缀 `c7n-pro-picture-viewer`（`PictureViewer.tsx:89`）。

| 控件 | 源码线索 | 交互 |
|------|----------|------|
| **Picture** | `<Picture src>` | `status=loaded` 且 `preview=true` 时点击预览 |
| **Picture.Provider** | `<Picture.Provider>` + `index`（见 `index.zh-CN.md`） | 组预览，弹窗内左右切换 |
| **原生 img** | 无 Pro 包装 | 无预览 |

### DOM

```
picture.c7n-pro-picture[.c7n-pro-picture-block][.c7n-pro-picture-border][.c7n-pro-picture-preview]
  ├── img.c7n-pro-picture-img.c7n-pro-picture-loaded          # status=loaded
  ├── div.c7n-pro-picture-icon.c7n-pro-picture-empty|-error   # 占位/失败图标
  └── div.c7n-pro-picture-icon.c7n-pro-picture-loading > .c7n-pro-picture-spin

# 预览（preview.tsx：Modal + className=c7n-pro-picture-viewer-modal）
.c7n-pro-picture-viewer-modal[.c7n-pro-picture-viewer-modal-mask]   # mask 挂 maskClassName
  └── .c7n-pro-picture-viewer
        ├── .c7n-pro-picture-viewer-picture > .c7n-pro-picture-viewer-picture-main
        ├── .c7n-pro-picture-viewer-toolbar > .c7n-pro-picture-viewer-btn.c7n-pro-picture-viewer-btn-tool
        ├── .c7n-pro-picture-viewer-btn.c7n-pro-picture-viewer-btn-nav     # 上一张 / 下一张（多图）
        ├── .c7n-pro-picture-viewer-btn.c7n-pro-picture-viewer-btn-close
        └── .c7n-pro-picture-viewer-navbar > .c7n-pro-picture-viewer-navbar-item[.c7n-pro-picture-viewer-navbar-current]
```

依据：`Picture.tsx:204-236`（类名拼接）；`picture-viewer.less` 中 `&-toolbar`、`&-navbar`、`&-btn`；`Navbar.tsx:36` 与 `:119`（子项前缀为 `…-navbar`）。`picture` 标签仅在浏览器支持 `HTMLPictureElement` 时使用，否则为 `div`。

### 源码识别

1. JSX：`<Picture src="..." />`，多图组预览用 `Picture.Provider` 包裹并传 `index`。
2. `preview` 为 true 且 `previewTarget` 有值时渲染 `<a target href>`，不弹窗（`Picture.tsx`）。
3. `lazy` 时外包 `ReactIntersectionObserver`，无额外类名。
4. 无 DataSet 绑定示例，按展示型控件处理。

### 分析产物

```yaml
field_rules:
  - name: avatarUrl
    control: picture            # 展示型；无输入
```

### 自动化步骤

1. 等待加载：`- action: waitReady` + `args: { hidden: pictureSpin }`，再 `assertVisible` `pictureImg`。
2. 打开预览：`- action: click` + `args: { target: pictureRoot }`（须已 loaded），再 `assertVisible` `pictureViewerModal`。
3. 组预览切换：`click` `pictureViewerNavBtn`；左右两个按钮同类，取序号（<<待核实：前一张在前、后一张在后，见 PictureViewer.tsx:233、285>>）。
4. 关闭：`- action: click` + `args: { target: pictureViewerClose }`。

```yaml
pictureRoot:
  css: .c7n-pro-picture
pictureImg:
  css: img.c7n-pro-picture-img.c7n-pro-picture-loaded
pictureSpin:
  css: .c7n-pro-picture-spin
pictureViewerModal:
  css: .c7n-pro-picture-viewer-modal
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 找 `.c7n-pro-img` | 前缀是 `c7n-pro-picture` |
| `status` 非 loaded 时点击期待预览 | 只有 `loaded` 才弹窗 |
| 用 `.c7n-pro-modal-wrapper` 通配找图片预览 | 用 `pictureViewerModal`，避免与业务弹窗混淆 |

## Typography（排版）

源码：[components-pro/typography](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/typography)。  
根前缀 `c7n-pro-typography`（`Typography.tsx:42`）；子类后缀由各文件决定：`Text` → `text`、`Title` → `title`、`Paragraph` → `paragraph`、`Link` → `link`（`suffixCls`）。

| 组件 | 元素 | 类 | 说明 |
|------|------|-----|------|
| **Typography.Text** | `span` | `c7n-pro-typography-text` | 行内文本 |
| **Typography.Title** | `h1`–`h5`（`level`） | `c7n-pro-typography-title` | 标题 |
| **Typography.Paragraph** | `div` | `c7n-pro-typography-paragraph` | 段落 |
| **Typography.Link** | `a` | `c7n-pro-typography-link` | 链接；`target=_blank` 自动加 rel |

### DOM

```
span | h1..h5 | div | a   .c7n-pro-typography.c7n-pro-typography-<text|title|paragraph|link>
  [-secondary|-success|-warning|-danger]        # type
  [-disabled] [-ellipsis] [-single-line] [-ellipsis-single-line] [-ellipsis-multiple-line]
  ├── strong / u / del / code / mark            # strong、underline、delete、code、mark 对应标签
  ├── a.c7n-pro-typography-expand               # ellipsis 可展开
  └── .c7n-pro-typography-copy[.c7n-pro-typography-copy-success]   # copyable（TransButton）
```

依据：`Base/index.tsx:352-358`（修饰类）、`:288`（expand）、`:315`（copy）、`:62-72`（wrap 标签）；`Title.tsx:32-33`（`h${level}`）；`Paragraph.tsx`、`Link.tsx`（`component="div"` / `"a"`）。

### 源码识别

1. JSX：`<Typography.Text>`、`<Typography.Title level={2}>`、`<Typography.Paragraph>`、`<Typography.Link>`。
2. `ellipsis` 对象的 `expandable`、`rows` 仅 Title/Paragraph 生效；Text 会 warning（`Text.tsx:33-37`）。
3. `copyable` 对象：`text`、`onCopy`、`icon`、`tooltips`（见 `index.zh-CN.md`）。
4. 绑定 DataSet：`name` + `dataSet` 时取 `getValue()` 作为内容（`Text.tsx` renderWrapper）。

### 分析产物

```yaml
field_rules:
  - name: title
    control: typography         # 只读展示；remark: text | title | paragraph | link
```

### 自动化步骤

1. 文本断言：功能层键加文案，如 `css: '.c7n-pro-typography-text:text-is("…")'`，再 `assertVisible`。
2. 展开：`- action: click` + `args: { target: typographyExpand }`。
3. 复制：`- action: click` + `args: { target: typographyCopy }`，再 `assertVisible` `typographyCopySuccess`。
4. 省略提示：悬停后断言 `overflowTipPopup`（见下节；hover 关键字 <<待核实>>）。

```yaml
typographyText:
  css: .c7n-pro-typography-text
typographyEllipsis:
  css: .c7n-pro-typography-ellipsis
typographyExpand:
  css: .c7n-pro-typography-expand
typographyCopy:
  css: .c7n-pro-typography-copy
typographyCopySuccess:
  css: .c7n-pro-typography-copy-success
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 找 `.c7n-pro-text` 或 `.c7n-pro-title` | 统一以 `c7n-pro-typography` 为根，再加后缀类 |
| 认为 Title 是 `div` | `level` 1–5 渲染为 `h1`–`h5` |
| Text 上设 `ellipsis.expandable` | Text 不支持，改用 Paragraph |

## OverflowTip（溢出提示）

源码：[components-pro/overflow-tip](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/overflow-tip)。  
本体为 Tooltip 包装，无自有 DOM 与样式（`style/index.tsx` 仅引入 choerodon-ui 样式）；无 demo 与 `index.zh-CN.md`。子元素仅在内容溢出时显示 tooltip（`util.tsx` 的 `isOverflow`：`scrollWidth > clientWidth` 或文本宽度超出）。

| 组件 | 区别 |
|------|------|
| **OverflowTip** | 包裹任意子元素，溢出时才弹 tooltip |
| **Tooltip** | 无溢出判断，始终弹出 |
| **Typography ellipsis** | CSS 截断 + `EllipsisTooltip`（`typography/Base/EllipsisTooltip.tsx`） |

### DOM

```
<子元素>                                       # 原样保留，ref 注入
.c7n-pro-tooltip-popup                        # 挂 body；仅溢出时出现
  └── .c7n-pro-tooltip-popup-inner            # title 内容
        （.c7n-pro-tooltip-popup-arrow）
```

依据：`tooltip/Tooltip.tsx:120` `suffixCls: 'tooltip'`；`Tooltip.tsx:99-100` `${prefixCls}-popup-arrow` / `-popup-inner`；`CodeArea.tsx:347` 的 `-tooltip-popup-help` 写法证实根为 `c7n-pro-tooltip-popup`。

### 源码识别

1. JSX：`<OverflowTip title="...">子元素</OverflowTip>`，由 `index.tsx:107` 导出。
2. 框架内用法：Select 提示（`select/Select.tsx:1233`）、Rate 帮助（`rate/Rate.tsx:154`）、FormField 帮助图标（`field/FormField.tsx:721`）。
3. 表单标签 `LabelTooltip.overflow` 时，`form/FormItemLabel.tsx` 调用 `isOverflow`。
4. 无 DataSet 字段类型对应。

### 分析产物

不生成 `field_rules` 条目（非字段控件）；在断言计划中记录为「溢出时出现 tooltip」即可。

### 自动化步骤

1. 构造溢出：用长文本数据撑满子元素；未溢出时无 popup，属正常。
2. 悬停：`hover` 关键字 <<待核实：ata 是否有 hover 关键字>>；无则在功能层说明只能人工复核。
3. 断言：`- action: assertVisible` + `args: { target: overflowTipPopup }`；文案用 `overflowTipPopupInner`。

```yaml
overflowTipPopup:
  css: .c7n-pro-tooltip-popup
overflowTipPopupInner:
  css: .c7n-pro-tooltip-popup-inner
```

### 常见误判

| 错误 | 正确 |
|------|------|
| 期待所有 OverflowTip 都弹 tooltip | 只有溢出时弹出 |
| 用 `.c7n-pro-typography-ellipsis` 判断 tooltip | 那是 Typography 截断，popup 仍是 `c7n-pro-tooltip-popup` |
| 找 `.c7n-pro-overflow-tip` | 该前缀不存在，DOM 来自 Tooltip |

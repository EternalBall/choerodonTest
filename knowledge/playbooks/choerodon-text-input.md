# Choerodon Pro 文本类输入（TextField 家族）

源码根：[components-pro](https://github.com/open-hand/choerodon-ui/tree/master/components-pro)（各节给出具体目录）。  
继承链：`TextField` ← `TextArea` ← `IntlField` / `Mentions`；`TextField` ← `Password` / `EmailField` / `UrlField` / `SecretField`；`Select` ← `AutoComplete`。  
机器可读：`kit.yaml`（`textField*` / `textArea*` / `password*` / `emailField*` / `urlField*` / `intlField*` / `secretField*` / `autoComplete*` / `mentions*`）。各节末尾为**建议新增**键，尚未合入 kit.yaml。

## 总览与对照

| 控件 | 基类 | JSX 标签 | 类名前缀 | 与易混组件的区别 |
|------|------|----------|----------|------------------|
| TextField | Field | `TextField` | `c7n-pro-input` | 单行 input，无下拉 |
| TextArea | TextField | `TextArea` | `c7n-pro-textarea` | 多行 `<textarea>` |
| Password | TextField | `Password` | `c7n-pro-password` | 眼睛按钮切换明文 |
| EmailField / UrlField | TextField | `EmailField` / `UrlField` | `c7n-pro-input` + `input[type]` | 仅 `type` 与校验文案不同 |
| IntlField | TextArea | `IntlField` | `c7n-pro-input` / `c7n-pro-textarea` | 语言图标 → 多语言弹窗 |
| SecretField | TextField | `SecretField` | `c7n-pro-input-secret` | 编辑/查看需二次验证弹窗 |
| AutoComplete | Select | `AutoComplete` | `c7n-pro-auto-complete` | 输入即过滤建议；区别于 `c7n-pro-select` |
| Mentions | TextArea | `Mentions` | `c7n-pro-mentions` | 输入触发字符（默认 `@`）弹候选 |

## TextField（text-field）

源码：[components-pro/text-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/text-field)。  
其余文本控件共用本节 DOM 骨架。

### DOM

```
.c7n-pro-input-wrapper[.c7n-pro-input-empty][.c7n-pro-input-required]
  ├── .c7n-pro-input-prefix                          # prefix 图标
  ├── .c7n-pro-input-placeholder > .c7n-pro-input-placeholder-inner
  ├── input.c7n-pro-input[name=字段]                 # 单行输入
  ├── .c7n-pro-input-suffix[.c7n-pro-input-allow-clear]
  │     └── .c7n-pro-input-inner-button.c7n-pro-input-clear-button > .icon-close
  └── .c7n-pro-input-length-info                     # showLengthInfo 时
# addonBefore / addonAfter：.c7n-pro-input-group-wrapper > .c7n-pro-input-group > .c7n-pro-input-group-before|after
```

推导：`TextField.defaultProps.suffixCls = 'input'`（text-field/TextField.tsx:177）→ `c7n-pro-input`，与 less `.@{c7n-pro-prefix}-input`（text-field/style/index.less:5）一致。`-wrapper` / `-empty` / `-required` / `-suffix` 与 intl-field 测试快照一致；clear-button 结构与 auto-complete 快照同构。

### 源码识别

- JSX：`<TextField name="…" />`；`range` / `multiple` 会替换为 `-range-start` / `-range-end` / `-multiple-input` 结构（TextField.tsx:1058-1100、1265）。
- DataSet Field：未配 `lookupCode` / `lovCode` 的字符串字段在 Form 中渲染为 TextField（默认渲染器映射不在本仓库，<<待核实:默认渲染器映射>>）。

### 分析产物

```yaml
field_rules:
  - name: remark
    control: input          # 普通单行文本；email/url/password/secret 等见各节
    editable_when: [create, detail_edit]
```

### 自动化步骤

1. 定位：功能层键 `textFieldInput` 加 `within` 表单项；或 `.c7n-pro-input-wrapper:has(input[name="remark"])`。
2. 输入（推荐 `fillForm`，文本回退为 `input[name]`）：

```yaml
- action: fillForm
  args:
    fields:
      - name: remark
        value: 备注示例
```

3. 单字段直接 `fill`：`- action: fill` + `args: { target: remarkInput, value: 备注示例 }`（`remarkInput` 为功能层键）。
4. 清空：**不要**用 `fill` 空串（keyword 的 `str()` 会拒绝空值，`src/keywords/index.ts`）；改为 `click` `textFieldClearBtn`（需 `clearButton` 且有值，限定在字段 wrapper 内）。
5. 失焦校验：`- action: press` + `args: { target: remarkInput, key: Tab }`，再 `assertVisible` `textFieldValidationTip`。

### 建议新增 kit

```yaml
textFieldInput:
  css: input.c7n-pro-input
  note: 与 Select / Lov / Intl / AutoComplete 同类，功能层必须 within 字段或加 [name=]
textFieldClearBtn:
  css: .c7n-pro-input-clear-button
  note: 需 clearButton 且有值；within 字段 wrapper
textFieldValidationTip:
  css: .c7n-pro-validation-message
  note: 字段校验提示（field/utils.tsx:560，getProPrefixCls('validation-message')）；文案需在功能层用 within 收窄
```

## TextArea（text-area）

源码：[components-pro/text-area](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/text-area)。  
继承 TextField，DOM 骨架同上，但 `suffixCls = 'textarea'`（text-area/TextArea.tsx:43）→ 前缀 `c7n-pro-textarea`。

### DOM

```
.c7n-pro-textarea-wrapper[.c7n-pro-textarea-empty][.c7n-pro-textarea-required]   # 快照确认
  └── textarea.c7n-pro-textarea[name=字段]        # TextArea.tsx:283；快照确认 class
```

`resize` / `autoSize` 只影响样式高度，不改变选择器。`clearButton` 结构由 TextField 继承推导（`.c7n-pro-textarea-clear-button`）。

### 源码识别

- JSX：`<TextArea rows cols autoSize />`（index.zh-CN.md）。
- `IntlField` 在 `type="multipleLine"` 时同样渲染 textarea（intl-field/IntlField.tsx:60）。

### 分析产物

```yaml
field_rules:
  - name: description
    control: textarea       # 多行；与 input（单行）区分
    editable_when: [create, detail_edit]
```

### 自动化步骤

1. 定位：功能层键 `textAreaInput` within 字段 wrapper。
2. 输入：`- action: fill` + `args: { target: descriptionInput, value: 多行文本 }`，换行直接写在 value 中。
3. **注意**：`fillForm` 的 name 回退写的是 `input[name="…"]`（keyword `fillForm` 分支），对 textarea **无效**；必须用 `fill` + target 键。
4. 断言：`assertVisible` `textAreaInput`。

### 建议新增 kit

```yaml
textAreaInput:
  css: textarea.c7n-pro-textarea
  note: 与 Mentions 的 textarea.c7n-pro-mentions 区分；功能层加 [name=] 或 within
textAreaWrapper:
  css: .c7n-pro-textarea-wrapper
  note: 作为 within 根
```

## Password（password）

源码：[components-pro/password](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/password)。  
继承 TextField，`suffixCls = 'password'`（password/Password.tsx:26）→ 前缀 `c7n-pro-password`。

### DOM

```
.c7n-pro-password-wrapper[.c7n-pro-password-empty]                # 快照确认
  ├── input.c7n-pro-password[name=字段][type=password|text]       # 快照确认；type 随显隐切换
  ├── input.c7n-pro-password-fix-autofill[tabindex=-1]            # 屏蔽浏览器自动填充（Password.tsx:52）
  └── .c7n-pro-password-inner-button > .icon-visibility_off|.icon-visibility   # 眼睛（快照确认）
```

- 初始：`type=password`，图标 `visibility_off`（快照）。
- 点击眼睛（`onClick=handleToggleReveal`，Password.tsx:61）→ `doReveal` 置 `type=text`，图标切为 `visibility`（Password.tsx:105-113）。
- `reveal={false}` 或禁用时不渲染眼睛按钮（Password.tsx:52-62 `getInnerSpanButton`）。

### 源码识别

- JSX：`<Password />`；`reveal` 属性（默认 true，index.zh-CN.md）。
- 源码未给出 password 专用 DataSet FieldType，以 JSX 标签为准。

### 分析产物

```yaml
field_rules:
  - name: password
    control: password       # 带显隐按钮，不要当普通 input 处理
```

### 自动化步骤

1. 输入：`- action: fill` + `args: { target: passwordInput, value: "…" }`。值由变量或环境注入，不写死明文。
2. 显示明文：`click` `passwordRevealBtn`。
3. 核对明文态：`assertVisible` `passwordRevealOn`。无 `type` 断言关键字，以图标切换作为可观测结果。
4. `fillForm` 的 name 回退可用于 password（目标为 input 元素）。

### 建议新增 kit

```yaml
passwordInput:
  css: input.c7n-pro-password
  note: 不含 -fix-autofill（类名不同）；功能层加 [name=]
passwordRevealBtn:
  css: .c7n-pro-password-inner-button
  note: reveal=false 时不存在
passwordRevealOn:
  css: .c7n-pro-password-inner-button .icon-visibility
  note: 明文显示态；visibility_off 为隐藏态
```

## EmailField / UrlField（email-field, url-field）

源码：[components-pro/email-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/email-field)、[components-pro/url-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/url-field)。  
两者继承 TextField，只覆写 `type`（`'email'` / `'url'`）、`getFieldType()` 与校验文案。DOM 同 TextField，未见独立前缀类名。

### DOM

```
.c7n-pro-input-wrapper
  └── input.c7n-pro-input[type="email"|"url"][name=字段]   # TextField.tsx:611 otherProps.type = this.type
```

### 源码识别

- JSX：`<EmailField />` / `<UrlField />`。
- DataSet Field：`FieldType.email` / `FieldType.url`（table/utils.tsx:118-158 引用；字面量值在外部包 choerodon-ui/dataset 中，<<待核实:FieldType 字面量>>）。
- 校验文案（zh_CN，locale-context/zh_CN.tsx:242-246、305-309）：邮箱 `请输入有效的邮箱地址。`，网址 `请输入有效的网址。`，必填 `请输入{label}。`。

### 分析产物

```yaml
field_rules:
  - name: contactEmail
    control: email          # 网址字段用 control: url
```

### 自动化步骤

1. 输入：`fillForm`，`fields: [{ name: contactEmail, value: user@example.com }]`（name 回退 `input[name]` 有效）。
2. 非法值：`fill` 为 `not-an-email` → `press` `Tab` → `assertVisible` `textFieldValidationTip`，文案见上述 zh_CN 校验文案。
3. 切换语言环境时校验文案会变化，断言前确认 locale。

### 建议新增 kit

```yaml
emailFieldInput:
  css: input.c7n-pro-input[type="email"]
  note: 功能层加 [name=] 收窄
urlFieldInput:
  css: input.c7n-pro-input[type="url"]
  note: 功能层加 [name=] 收窄
```

## IntlField（intl-field）

源码：[components-pro/intl-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/intl-field)。  
继承 TextArea。单行（默认 `type=singleLine`）走 TextField 的 input；多行（`multipleLine`）走 textarea；`displayOutput` 时前缀为 `output`（IntlField.tsx:58-60）。

### DOM

```
.c7n-pro-input-wrapper[.c7n-pro-input-intl]           # getWrapperClassNames 追加 -intl；快照未见，<<待核实:-intl 类>>
  ├── input.c7n-pro-input[name=字段]                  # singleLine；multipleLine 为 textarea.c7n-pro-textarea
  └── .c7n-pro-input-suffix > .icon-language           # 点击 → 多语言弹窗（IntlField.tsx:299-312）
弹窗（Modal.open，居中；标题「输入多语言信息」，只读态「多语言信息」）
  └── 每个语言一行：input.c7n-pro-input[name="<tlsKey>.字段.语言"]   # 当前语言在首行并 autoFocus（IntlList.tsx）
```

`tlsKey` 为外部配置项，默认值不在本仓库（<<待核实:tlsKey 默认值>>）。

### 源码识别

- JSX：`<IntlField name="…" />`；静态标记 `__PRO_INTLFIELD`（IntlField.tsx）。
- DataSet Field：`FieldType.intl`（output/utils.tsx:54 引用）。
- `displayOutput` 为只读展示，DOM 无 input。

### 分析产物

```yaml
field_rules:
  - name: itemName
    control: intl           # type: singleLine | multipleLine（index.zh-CN.md）
    editable_when: [create, detail_edit]
```

### 自动化步骤

1. 主语言：功能层键（如 `itemNameInput`，= `textFieldInput` within 字段 wrapper）→ `fill`。
2. 打开弹窗：`click` `intlFieldIcon`（within 字段 wrapper）→ `waitFor` `visible: modal`。  
   打开前会先加载多语言数据，加载期间后缀图标会替换为 loading，需等其消失再操作。
3. 逐语言填写：`fill` 目标为 `intlFieldLangInput`，多语言行的 name 不同，功能层需按语言收窄（`tlsKey` 与语言码需确认，<<待核实:tlsKey 与语言码>>）。
4. 确定：`click` `modalConfirm`（确定按钮仅在可编辑态出现，IntlField.tsx `okButton`），再 `waitFor` `hidden: modal`。
5. 只读态（`displayOutput`）：无 input，改为断言前缀 `c7n-pro-output` 的展示元素。

### 建议新增 kit

```yaml
intlFieldIcon:
  css: .c7n-pro-input-suffix .icon-language
  note: 多语言入口；须 within 字段 wrapper
intlFieldLangInput:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active .c7n-pro-modal-body input.c7n-pro-input
  note: 弹窗内语言行；多行时为 textarea.c7n-pro-textarea；功能层按 name 收窄
```

## SecretField（secret-field）

源码：[components-pro/secret-field](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/secret-field)。  
继承 TextField，前缀仍为 `c7n-pro-input`，脱敏态追加 `-secret`；弹窗样式前缀为 `c7n-pro-secret-field`（SecretFieldView.tsx:54-56）。  
全局配置 `secretFieldEnable` 决定是否启用脱敏（SecretField.tsx:59-66）；未启用时行为等同 TextField。

### DOM

```
.c7n-pro-input-wrapper.c7n-pro-input-secret             # SecretField.tsx:164-170
  ├── input.c7n-pro-input[name=字段]                    # 脱敏态不可直接编辑
  ├── .c7n-pro-input-suffix > .icon-edit-o              # 可编辑态：编辑弹窗
  ├── .c7n-pro-input-suffix > .icon-visibility-o        # 只读未查看：查看弹窗
  └── span.c7n-pro-input-secret-empty                   # 只读且空值显示 '-'（SecretField.tsx:200-207）
弹窗（Modal.open，title=字段 label，footer=null，destroyOnClose）
  └── .c7n-pro-secret-field-modal > form.c7n-pro-secret-field-modal-form
        ├── verifyType（SelectBox 选项）/ verifyNumber（只读）/ verifyCode
        ├── button.c7n-pro-secret-field-modal-verify-btn   # 获取验证码 → 滑块（CountDownButton.tsx:23）
        ├── .c7n-pro-secret-field-simple-verify-bar         # 滑块（VerifySlider.tsx）
        └── td.c7n-pro-secret-field-modal-btns > button.c7n-pro-secret-field-modal-raised-btn
```

### 源码识别

- JSX：`<SecretField modalProps={…} />`（index.zh-CN.md）。
- 图标：编辑 `edit-o`，查看 `visibility-o`（SecretField.tsx:getSuffix）。
- 脱敏态下清除按钮不渲染（SecretField.tsx `getInnerSpanButton`）。

### 分析产物

```yaml
field_rules:
  - name: accessKey
    control: secret         # 编辑与查看都经二次验证
    editable_when: [detail_edit]
```

### 自动化步骤（分阶段）

1. 进入编辑：`click` `secretFieldEditBtn`（within 字段 wrapper）→ `waitFor` `visible: secretFieldModal`。
2. 选验证方式：verifyType 是 SelectBox，**不要用** `pickSelect`；`click` 选项文案（文案来自业务 `secretFieldTypes` 配置，<<待核实:验证方式文案>>）。
3. 获取验证码：`click` `secretFieldVerifyBtn`，会请求后端；接口由 `secretFieldFetchVerifyCode` 配置决定，源码未写死，用 `clickExpectApi` 绑定（<<待核实:接口地址>>）。
4. 滑块：`VerifySlider` 需拖拽，当前关键字不支持；需测试环境配置跳过验证（<<待核实:测试环境跳过方式>>）。
5. 验证通过后：`fill` 验证码（功能层键），`click` `secretFieldNextBtn`。编辑时该按钮为「下一步」（SecretFieldView.tsx:399，`handleGoToEdit`）；查看时为「确定」（:390，`handleQuery`）。
6. 进入编辑阶段：`fill` 字段值（`name` 对应 input），`click` `secretFieldConfirmBtn`（编辑阶段「确定」，SecretFieldView.tsx:414）。
7. 查看：`click` `secretFieldViewBtn` 后同样走验证流程，在「确定」处完成查看。

### 建议新增 kit

```yaml
secretFieldWrapper:
  css: .c7n-pro-input-wrapper.c7n-pro-input-secret
  note: 脱敏字段外层，within 表单项
secretFieldEditBtn:
  css: .c7n-pro-input-suffix .icon-edit-o
  note: 可编辑态入口；within 字段 wrapper
secretFieldViewBtn:
  css: .c7n-pro-input-suffix .icon-visibility-o
  note: 只读未查看入口；within 字段 wrapper
secretFieldModal:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active:has(.c7n-pro-secret-field-modal)
  note: 脱敏验证/编辑弹窗；无 footer
secretFieldVerifyBtn:
  css: .c7n-pro-secret-field-modal-verify-btn
  note: 获取验证码（触发后端请求）
secretFieldNextBtn:
  css: .c7n-pro-secret-field-modal-raised-btn
  note: 验证阶段唯一主按钮：编辑时为「下一步」，查看时为「确定」（SecretFieldView.tsx:390/399）
secretFieldConfirmBtn:
  css: .c7n-pro-secret-field-modal-edit-btns button:last-child
  note: 编辑阶段「确定」（SecretFieldView.tsx:414）；按位置定位，class 未在源码中确认
```

## AutoComplete（auto-complete）

源码：[components-pro/auto-complete](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/auto-complete)。  
继承 Select（auto-complete/AutoComplete.tsx:20），前缀 `c7n-pro-auto-complete`（`suffixCls: 'auto-complete'`，AutoComplete.tsx:33）。  
默认 `matcher`：`value.indexOf(inputText) !== -1`（index.zh-CN.md）。

### DOM

```
.c7n-pro-auto-complete-wrapper[.c7n-pro-auto-complete-empty][.c7n-pro-auto-complete-suffix-button]   # 快照
  ├── input.c7n-pro-auto-complete[name=字段]                                # 快照
  └── .c7n-pro-auto-complete-suffix                                         # 快照
        ├── .c7n-pro-auto-complete-trigger                                  # 快照（箭头图标）
        └── .c7n-pro-auto-complete-inner-button.c7n-pro-auto-complete-clear-button > .icon-close   # 快照
# 弹层（挂 body）
.c7n-pro-auto-complete-popup-single                  # Select.tsx:1100 getPopupClassName（多选为 -popup-multiple）
  └── .c7n-pro-auto-complete-dropdown-menu           # Select.tsx:791 getMenuPrefixCls
        └── 选项（rc-menu Item；类名 <<待核实:选项 class>>，以文案定位）
```

### 源码识别

- JSX：`<AutoComplete options={[…]} />`；`options` 可为数组或 DataSet（index.zh-CN.md）。
- `optionRenderer` 会改变选项文本，文案定位时以渲染后的文本为准。
- 源码未给出 AutoComplete 专用 DataSet FieldType，以 JSX 为准。

### 分析产物

```yaml
field_rules:
  - name: keyword
    control: auto_complete   # 可输入 + 建议下拉；与 select（只能选项）区分
    editable_when: [create, detail_edit]
```

### 自动化步骤

1. 输入：`fill` `autoCompleteInput`（within 字段 wrapper），输入后下拉按 matcher 过滤。  
   也可用 `fillForm`（默认 text，name 回退 `input[name]` 对该 input 有效）。
2. 等弹层：`waitFor` `visible: autoCompletePopup`。
3. 选中：`click` `target: autoCompleteMenu` + `exactText: "<选项文案>"`（click 支持 exactText 过滤）。
4. 不要用 `pickSelect`：其默认弹层为 `.c7n-pro-select-popup`，与本控件不同。
5. 清空：`click` `autoCompleteClearBtn`（有值时，within 字段 wrapper）。
6. 自由文本（不在选项中）能否提交，源码未确认（<<待核实:自由文本提交>>）。

### 建议新增 kit

```yaml
autoCompleteInput:
  css: input.c7n-pro-auto-complete
  note: 功能层加 [name=] 或 within 字段
autoCompleteClearBtn:
  css: .c7n-pro-auto-complete-clear-button
  note: 需有值；within 字段 wrapper
autoCompletePopup:
  css: .c7n-pro-auto-complete-popup-single
  note: 单选弹层；多选为 -popup-multiple（Select.tsx:1099）
autoCompleteMenu:
  css: .c7n-pro-auto-complete-dropdown-menu
  note: 选项容器；选项用 exactText 收窄
```

## Mentions（mentions）

源码：[components-pro/mentions](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/mentions)。  
继承 TextArea（mentions/Mentions.tsx:51），`suffixCls: 'mentions'`（Mentions.tsx:60）→ 前缀 `c7n-pro-mentions`。

### DOM

```
.c7n-pro-mentions-wrapper                    # less &-wrapper（mentions/style/index.less）
  ├── textarea.c7n-pro-mentions[name=字段]   # TextArea 基类渲染（TextArea.tsx:283），类名取 Mentions 前缀
  └── .c7n-pro-mentions-measure              # 光标位置测量层（Mentions.tsx:375）
# 候选弹层：KeywordTrigger → Trigger（choerodon-ui/lib/trigger，不在本仓库）
#   弹层 class：<<待核实:Trigger popupClassName>>
#   └── DropdownMenu → Menu（choerodon-ui/lib/menu）；选项 class：<<待核实:选项 class>>
```

### 源码识别

- JSX：`<Mentions onChange={…}>` + `<Mentions.Option value="sample">Sample</Mentions.Option>`（index.zh-CN.md）。
- `mentionsKey` 设触发字符，默认 `@`，可为数组；`split` 为选中项前后分隔符，默认空格。
- `getMentions(value, config)` 可从值中解析提及人，可用于断言数据而不必依赖 UI。

### 分析产物

```yaml
field_rules:
  - name: content
    control: mentions        # 文本内 @提及；值仍是普通字符串
```

### 自动化步骤

1. 输入：`fill` `mentionsInput`（within 字段），value 末尾写触发字符，例如 `请 @`。`press` 只能单键，不能用来逐字触发候选。
2. 等候选：`waitFor` `visible: <<待核实:候选弹层键>>`（本仓库未定义，需补充 kit）。
3. 选中：`click` `target: <<待核实:候选弹层键>>` + `exactText: "<选项文案>"`。
4. 数据断言：优先对 `getMentions` 的结果核对，而非依赖候选文案。

### 建议新增 kit

```yaml
mentionsInput:
  css: textarea.c7n-pro-mentions
  note: 与 TextArea 的 textarea.c7n-pro-textarea 区分；功能层加 [name=] 或 within
mentionsWrapper:
  css: .c7n-pro-mentions-wrapper
  note: 作为 within 根
```

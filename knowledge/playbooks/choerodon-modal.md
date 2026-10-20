# Choerodon Pro Modal / Drawer

源码：[choerodon-ui/components-pro/modal](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/modal)、[modal-container](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/modal-container)。  
机器可读定位：`knowledge/platform/choerodon/kit.yaml`（`modal*` / `drawer*` / `lovDialog`）。

**同一组件**：`drawer: false`（默认）为居中模态框；`drawer: true` 为抽屉。业务里「复制抽屉」「编辑弹窗」「Lov 选表」都走这套 DOM，不要当成三个无关控件。

与下列模式区分：

| 模式 | 特征 | 定位 / keyword |
|------|------|----------------|
| **居中 Modal** | 无 `-drawer`；页头/工具栏打开填表或确认 | `modal` + `opens: modal` |
| **Drawer** | 有 `-drawer`（常 `-drawer-slide-right`） | `drawer` + `opens: drawer` |
| **Lov 弹层** | 也是 Modal；点 `.icon-search` 打开选表 | `lovDialog` + `pickLov`（见 create-detail / row-edit） |
| **Modal.confirm** | `Modal.confirm/info/success/error/warning` | `.c7n-pro-confirm-wrapper-*` |
| **Popconfirm** | 行内气泡「是否删除…」 | `.c7n-popover`（见 row-edit；**不是** Modal） |

## DOM 结构（源码约定）

`ViewComponent` 外层为 `${prefixCls}-wrapper`；`prefixCls = c7n-pro-modal`。

```
body
  └── .c7n-pro-modal-container          # ModalContainer 根，常驻
        ├── .c7n-pro-mask               # 蒙层；无打开弹层时 hidden
        └── .c7n-pro-modal-wrapper      # 每个 Modal 一层；关闭时 hidden 或销毁
              ├── .c7n-pro-modal-active     # 当前栈顶 / 打开态（必用）
              ├── .c7n-pro-modal-drawer     # 仅 drawer:true
              │     └── .c7n-pro-modal-drawer-slide-right|left|up|down
              ├── .c7n-pro-modal-center / -auto-center / -fullscreen
              └── 内部
                    ├── .c7n-pro-modal-header
                    │     ├── .c7n-pro-modal-title
                    │     └── .c7n-pro-modal-header-button   # closable 关闭钮
                    ├── .c7n-pro-modal-body
                    └── .c7n-pro-modal-footer
                          ├── button.c7n-pro-btn-primary     # 确定（okText，默认「确定」）
                          └── button.c7n-pro-btn-default     # 取消（cancelText，默认「取消」）
```

Confirm 另挂 class（见 `confirm.tsx`）：

```
.c7n-pro-modal-wrapper.c7n-pro-confirm-wrapper.c7n-pro-confirm-wrapper-confirm|info|success|error|warning
  └── .c7n-pro-confirm-title / .c7n-pro-confirm-content
```

## 打开态判定（硬规则）

1. **禁止**用 `role=dialog` 当主定位（Pro Modal 常挂不上可靠 dialog role）。
2. **禁止**只写 `.c7n-pro-modal-wrapper`：`destroyOnClose: false` 时关闭后节点仍在，带 `hidden`；容器与 mask 常驻。
3. **打开** = 带 `.c7n-pro-modal-active`（可再加标题 `:has(.c7n-pro-modal-title:text-is("…"))`）。
4. 多层 Drawer：栈顶才有 `-active`；点确定/取消必须限定在 **active** 层 footer 内。
5. 未打开时 mask 多为 `[hidden]`；不要对 mask 做「可见即失败」的误断言。

## 源码识别（分析）

从 UI 触发往下追（与 [api-binding.md](./api-binding.md) 一致）：

| 线索 | 含义 |
|------|------|
| `Modal.open({…})` / `useModal().open` | 命令式打开；看 `drawer`、`title`、`onOk` |
| `<Modal visible/…>` 或业务封装抽屉组件 | 声明式；仍是同一套 class |
| `drawer: true` / `drawerTransitionName` | → `opens: drawer` |
| 无 drawer 或 `drawer: false` | → `opens: modal` |
| `Modal.confirm` / `.info` / `.success` / `.error` / `.warning` | Confirm 族；勿标成业务表单 Modal |
| `onOk` / `modal.handleOk` 内 `request` / `ds.submit` | 确定时的 API，绑到本 op |
| `okText` / `cancelText` / `footer={null}` | 按钮文案或无 footer（仅关叉） |

`onOk` / `onCancel` 返回 `false` / `Promise.resolve(false)` / `reject` 时**不关闭**（校验失败常见）——用例须等关闭或断言错误提示，勿假定一点确定就立刻 `hidden`。

## 分析产物约定

```yaml
operations:
  - id: material_copy
    type: create          # 或 update；按业务语义
    opens: drawer         # modal | drawer | page
    entry_control:
      kind: header_button
      name: 复制
      element: copyBtn
    fields: […抽屉内字段…]
    api: /v1/.../copy/... # 点确定真正发出的字面量
    execution_chain: [list, detail, open_copy_drawer, fill, confirm_drawer]
```

- `opens: drawer` / `modal`：生成时选 `drawer*` / `modal*` 元素，勿混用。
- Lov：`opens` 可省略；步骤用 `pickLov`，dialog 用 `lovDialog`。
- Confirm：可单独 op 或嵌在删除链；元素用 `confirmModal` + footer 确定。

## 自动化步骤

### 业务 Modal / Drawer（填表 → 确定）

1. `click` 入口（页头按钮 / 行链接）  
2. `waitReady`：`visible` = `modal` 或 `drawer`（或带标题的功能层 key，如 `copyDrawer`）  
3. 在 **active** 层内 `fill` / `fillForm` / `pickLov`（字段 `input[name=…]` 限定在 modal/drawer body）  
4. `clickExpectApi`（或 `click`）点 `modalConfirm` / `drawerConfirm`  
5. 断言 wrapper **不再**带 active / 变为 hidden；可选 `successToast`

```yaml
# 平台（居中）
modal:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active:not(.c7n-pro-modal-drawer)
modalConfirm:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active:not(.c7n-pro-modal-drawer) .c7n-pro-modal-footer button.c7n-pro-btn-primary
modalCancel:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active:not(.c7n-pro-modal-drawer) .c7n-pro-modal-footer button.c7n-pro-btn-default

# 平台（抽屉；已有）
drawer:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-drawer.c7n-pro-modal-active
drawerConfirm:
  css: .c7n-pro-modal-wrapper.c7n-pro-modal-active .c7n-pro-modal-footer button.c7n-pro-btn-primary

# 功能层（按标题收窄，避免多弹层）
copyDrawer:
  css: '.c7n-pro-modal-wrapper.c7n-pro-modal-drawer.c7n-pro-modal-active:has(.c7n-pro-modal-title:text-is("复制"))'
```

### Modal.confirm

1. 触发删除/提交等动作  
2. 等待 `.c7n-pro-confirm-wrapper.c7n-pro-modal-active`（或 `confirmModal`）  
3. 点 footer 主按钮（文案可能是「确定」/「确认」）  
4. 监听 `operation.api`（若 confirm 的 onOk 才发请求）

### 关闭方式

| 动作 | 选择器 / 行为 |
|------|----------------|
| 确定 | footer `button.c7n-pro-btn-primary` |
| 取消 | footer `button.c7n-pro-btn-default` |
| 右上角关闭 | `.c7n-pro-modal-header-button`（需 `closable: true`） |
| Esc | 默认 `keyboardClosable: true` |
| 点蒙层 | 默认 `maskClosable: false`，**不要**默认依赖点 mask 关闭 |

## 常见误判

| 错误 | 正确 |
|------|------|
| `getByRole('dialog')` | `.c7n-pro-modal-wrapper.c7n-pro-modal-active` |
| 未加 `-active` 就填表 | 会点到隐藏残留节点 |
| Drawer 用无 `-drawer` 的 `modal` key | `opens: drawer` → `drawer` / 标题收窄 |
| Lov 写成普通业务 Modal op | 用 `pickLov` + `lovDialog` |
| 行内 Popconfirm 写成 Modal | `.c7n-popover`（row-edit） |
| 确定后不调 API 仍写 `clickExpectApi` | 无字面量则勿编造；见 api-binding |

## within / 截图

- 弹层字段的 `within` 指向 **功能层 modal/drawer 元素**，不要 within 到页面 table。  
- 截图：fixed 弹层易被整页长图裁切；优先 `screenshot.target` 指向 drawer/modal 元素（见 [docs/screenshot.md](../../docs/screenshot.md)）。

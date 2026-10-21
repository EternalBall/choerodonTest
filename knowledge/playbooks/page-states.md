# 页面状态机分析（自动化必读）

分析产物 `feature.yaml` 除 operations 外，应包含：

## page_states
- `mode`: view | edit | create | copy
- `form_disabled`: 表单是否整体不可编辑
- `header_buttons`: 该态页头**实际可见**按钮（以本页 JSX / PermissionButton 为准）
- `ready_hint`: 自动化就绪元素——与 `header_buttons` 一致：
  - 有「编辑」且需先点编辑 → 可用 `editBtn`
  - 无「编辑」、直接「保存」→ 用 `saveBtn`（或页头真实主按钮），**不要**写 `editBtn`
- `enter_via` / `exit_via`: 仅当源码确有对应切换动作时填写

## field_rules
- `required` / `control`（input|lov|switch|…）
- `editable_when` / `readonly_when`：绑定 page_state.id

## validations
- `type`: required | unique | format | biz | api
- `when` / `api` / `message_hint`

## operations 扩展
- `initial_mode` / `unlock` / `preconditions` / `from_state` / `to_state`
- `unlock` / `click:editBtn`：**仅当页头源码存在「编辑」类按钮时**；`canEdit` 状态变量 ≠ 存在编辑按钮

## 常见两种详情交互（择一，勿混套）

| 模式 | 页头特征 | update 写法 |
|------|----------|-------------|
| 先解锁再改 | 有「编辑」，点后变「保存/取消」 | `unlock: click:editBtn`，ready 可用 editBtn→saveBtn |
| 状态直接可改 | 无「编辑」，「保存」由 canEdit/业务状态 `disabled` | **不写** unlock；ready_hint=`saveBtn`；preconditions 写状态/权限条件 |

用例生成：按本功能 `page_states` / steps 编排，禁止默认「进详情→必点编辑」。

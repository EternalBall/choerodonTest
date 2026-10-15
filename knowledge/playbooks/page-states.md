# 页面状态机分析（自动化必读）

分析产物 `feature.yaml` 除 operations 外，应包含：

## page_states
- `mode`: view | edit | create | copy
- `form_disabled`: 表单是否整体不可编辑
- `header_buttons`: 该态页头可见按钮
- `ready_hint`: 自动化就绪元素（view→editBtn，edit/create→saveBtn）
- `enter_via` / `exit_via`: 状态切换动作

## field_rules
- `required` / `control`（input|lov|switch|…）
- `editable_when` / `readonly_when`：绑定 page_state.id

## validations
- `type`: required | unique | format | biz | api
- `when` / `api` / `message_hint`

## operations 扩展
- `initial_mode` / `unlock` / `preconditions` / `from_state` / `to_state`

## 物料维护实测（MaterialDetail canEdit）

| 路由 | 初始 | 页头 | 表单 |
|------|------|------|------|
| dist/:id | view | 编辑… | disabled |
| 点编辑后 | edit | 保存/取消 | 可写 |
| dist/create | create | 保存/取消 | 可写 |

用例生成：有 update 时合并「筛选→进详情→点编辑→改字段→clickExpectApi 保存」。

# 行内「更多」Dropdown / Menu

源码：[components/dropdown](https://github.com/open-hand/choerodon-ui/tree/master/components/dropdown)、[components/menu](https://github.com/open-hand/choerodon-ui/tree/master/components/menu)。  
业务常在 Table 操作列：`Dropdown` + `Menu` / `Menu.Item`，触发器文案「更多」或 `Icon type="more_horiz"`。

与下列区分：

| 模式 | 特征 | 手册 |
|------|------|------|
| **裸操作链接** | `.action-link a` 无 href | [row-edit](./choerodon-table-row-edit.md) `tableActionLink` |
| **行内 Radio/Switch** | 直调 API，不点页头保存 | [row-action](./row-action.md) |
| **Dropdown 菜单项** | 先点「更多」再点菜单项 | **本手册** |
| **Popconfirm** | 气泡确认 | row-edit / Modal 区分 |

## DOM

```
# 触发（行内）
button / a / span「更多」 或 button:has(.icon-more_horiz)

# 弹出（挂 body；关闭时带 -hidden）
.c7n-dropdown:not(.c7n-dropdown-hidden)
  └── .c7n-dropdown-menu:not(.c7n-dropdown-menu-hidden)
        ├── .c7n-dropdown-menu-item           # 可点
        ├── .c7n-dropdown-menu-item-disabled
        └── .c7n-dropdown-menu-item-divider

# Pro 表格筛选等也会用
.c7n-pro-dropdown-popup
```

子菜单：`.c7n-dropdown-menu-submenu` / `-submenu-popup`（少见）。

## 源码识别

```tsx
<Dropdown overlay={
  <Menu onClick={…}>
    <Menu.Item key="edit">编辑</Menu.Item>
    <Menu.Item key="delete">删除</Menu.Item>
  </Menu>
}>
  <a>更多</a>
</Dropdown>
```

`onClick` / `Menu.Item.onClick` → 追 API（[api-binding](./api-binding.md)）。删除常再套 `Modal.confirm` 或 Popconfirm。

## 分析产物

```yaml
operations:
  - id: list_row_delete
    type: delete            # 或 row_action
    entry: row_dropdown
    entry_control:
      kind: menu_item
      name: 删除
      element: rowMoreDelete
    row_target:
      area: listTable
      control: dropdown_menu
      element: rowMoreTrigger
    api: /v1/.../remove
    execution_chain: [list, open_row_more, click_menu_delete, confirm]
```

多个菜单项 = 多条 op，共用 trigger，换 menu item / api。  
禁止把「更多」本身标成业务动作（它只是入口）。

## 自动化步骤

1. 定位目标行（筛选/首行）  
2. `click` 行内 `rowMoreTrigger`（「更多」）  
3. 等待 `.c7n-dropdown-menu:not(.c7n-dropdown-menu-hidden)`  
4. `click` 菜单项文案（精确匹配，避免点到其它行残留）  
5. 若有 Confirm / Popconfirm → 再点确定；`clickExpectApi` 绑 api  

```yaml
dropdownMenu:
  css: .c7n-dropdown-menu:not(.c7n-dropdown-menu-hidden)
rowMoreTrigger:
  role: button
  name: 更多
  note: 功能层建议 within 行；文案可能是「操作」
```

## 常见误判

| 错误 | 正确 |
|------|------|
| `getByRole('link')` 点菜单 | item 常是 `li`/div，用 text / css |
| 不展开直接点「删除」文案 | 菜单未打开时可能命中隐藏节点 |
| 与 filterBar 的 dropdown-popup 混淆 | 行菜单用 `.c7n-dropdown-menu`；筛选用 `.c7n-pro-table-filter-list` |
| 无 href 的「更多」当 navigation link | 只负责打开 Menu |

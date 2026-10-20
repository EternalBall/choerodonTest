# Choerodon Tree / TreeSelect / Cascader

源码：

- Tree（展示）：[components/tree](https://github.com/open-hand/choerodon-ui/tree/master/components/tree) → `.c7n-tree`  
- TreeSelect（表单）：[components-pro/tree-select](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/tree-select) → `.c7n-pro-tree-select`  
- Cascader：[components-pro/cascader](https://github.com/open-hand/choerodon-ui/tree/master/components-pro/cascader) → `.c7n-pro-cascader`  

| 控件 | 场景 | 交互 |
|------|------|------|
| **Tree** | 左侧组织树、权限树；常配 Table | 展开 switcher → 点节点标题 |
| **TreeSelect** | 表单选树节点（部门等） | 如下拉 Select，popup 内是 Tree |
| **Cascader** | 省市区、多级分类 | 多列 menu，逐级点选 |

## Tree DOM

```
.c7n-tree
  └── .c7n-tree-treenode
        ├── .c7n-tree-switcher           # 展开/折叠；叶子为 -noop
        ├── .c7n-tree-checkbox           # checkable 时
        └── .c7n-tree-node-content-wrapper[.c7n-tree-node-selected]
```

异步：`loadData` / `async` → 展开时出现 loading；勿在未展开时点未加载子节点。

## TreeSelect DOM

```
.c7n-pro-tree-select-wrapper
  └── input + trigger（同 Select）

.c7n-pro-tree-select-popup
  └── .c7n-tree …（节点选中带 treenode-selected）
```

`treeCheckable` → 多选勾选；`showCheckedStrategy` 影响回填。`searchable` 时匹配节点会展开祖先。

## Cascader DOM

```
.c7n-pro-cascader-wrapper
  └── .c7n-pro-cascader + trigger

# 弹出
.c7n-pro-cascader-menus / .c7n-pro-cascader-popup
  └── ul.c7n-pro-cascader-menu
        └── li.c7n-pro-cascader-menu-item[-expand|-active|-selected]
```

`expandTrigger`: `click`（默认）| `hover`。`changeOnSelect`：点即选（可只选到中间级）。  
单选回填 value 常为路径数组 `[a,b,c]`；多选为数组的数组。

## 源码识别

- 布局左侧 `<Tree treeData={…} onSelect={…}>` → 选中后常 `dataSet.setQueryParameter` + query  
- Field + `<TreeSelect>` / `lookup` 树形  
- `<Cascader options={…} />` 或 DS 级联字段  

## 分析产物

```yaml
field_rules:
  - name: deptId
    control: tree_select    # tree | tree_select | cascader
operations:
  - id: list_filter_by_org_tree
    type: query
    entry: tree_select
    description: 左侧组织树点节点后刷新列表
```

## 自动化步骤

### Tree（侧栏）

1. 若需深层级：点 `.c7n-tree-switcher` 展开（非 `-noop`）  
2. `click` 目标 `.c7n-tree-node-content-wrapper`（按文案 filter）  
3. 等列表 spin 结束 / 表格刷新  

### TreeSelect

1. `click` `.c7n-pro-tree-select-wrapper:has(input[name=…])`  
2. 等 popup；必要时搜索  
3. 展开路径上的 switcher → 点叶节点 content-wrapper  
4. 多选 checkable：点 checkbox，再点外部关闭或按组件确认行为  

### Cascader

1. 打开 `.c7n-pro-cascader-wrapper`  
2. 在第 1 列点 item → 第 2 列…直到叶（或 `changeOnSelect` 中途结束）  
3. 断言输入框展示路径文案  

```yaml
treeRoot:
  css: .c7n-tree
treeNodeSelected:
  css: .c7n-tree-node-content-wrapper.c7n-tree-node-selected
treeSelectPopup:
  css: .c7n-pro-tree-select-popup
cascaderMenu:
  css: .c7n-pro-cascader-menu
cascaderMenuItem:
  css: .c7n-pro-cascader-menu-item
```

## 常见误判

| 错误 | 正确 |
|------|------|
| TreeSelect 用 `pickLov` | 无 Modal 表；popup 内 Tree |
| Cascader 当普通 Select 一点即完 | 多列逐级；注意 `changeOnSelect` |
| 未展开就点子节点文案 | 先 switcher；async 等加载 |
| 与 Menu 导航树混淆 | 业务数据树在 `.c7n-tree`；侧栏导航可能是 `.c7n-menu` |

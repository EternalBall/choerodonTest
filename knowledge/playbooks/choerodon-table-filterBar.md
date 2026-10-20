# Choerodon Table + filterBar 结构（物料维护实测）
# 机器可读定位见：knowledge/platform/choerodon/kit.yaml
# 整表壳 / 分页 / 勾选 / 工具栏总册：[choerodon-table.md](./choerodon-table.md)

## 整体结构

```
.c7n-pro-table-wrapper
  ├── .c7n-pro-table-dynamic-filter-bar          # 动态筛选条
  │     ├── .c7n-pro-table-filter-wrapper
  │     │     ├── .c7n-pro-table-filter-content  # 已选筛选项（label + input[name]）
  │     │     └── .c7n-pro-table-add-fields      # 「添加筛选」
  │     └── .c7n-pro-table-dynamic-filter-bar-single-action
  │           ├── .c7n-pro-table-filter-buttons → button「重置」
  │           └── .c7n-pro-table-filter-menu-query → icon-refresh（真正的查询）
  ├── .c7n-spin-nested-loading
  │     └── div.c7n-pro-table.c7n-pro-table-bordered   # 断言用这个（唯一）
  │           └── table.c7n-pro-table-last-row-bordered # 勿与上面并集定位
  │                 ├── thead / tbody.c7n-pro-table-tbody
  │                 └── tr.c7n-pro-table-row
  └── nav.c7n-pro-table-pagination              # 翻页细节见 choerodon-table.md
```

## 注意

- **不要**用 `.c7n-pro-table, table`：会同时命中外层 div 与内层 table → Playwright strict mode 失败（总册硬规则）。
- 默认已展示字段（物料页）：`materialCode` / `materialName` / `materialIdentifyCode` / `materialDesignCode`，可直接 `input[name=...]` 填写，不必每次「添加筛选」。
- 额外字段：点「添加筛选」→ 弹层勾选 checkbox[value=DS名] → 再填 input。

## 关键字

`tableFilterQuery`（mode: filterBar | professionalBar）

professionalBar / advancedBar 的 DOM 与按钮文案见 [choerodon-table-queryBar.md](./choerodon-table-queryBar.md)（勿在本形态下找 button「查询」——filterBar 查询是 refresh 图标）。

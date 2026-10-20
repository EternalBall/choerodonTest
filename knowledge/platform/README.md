# 平台组件 DOM 沉淀（机器可读）

真相源：`knowledge/platform/choerodon/kit.yaml`

- 同组件在本系统 DOM 一致（Table / QueryBar / Form / LOV / Select / DatePicker / Modal / Upload / Tabs / Tree / **表格行编辑**）
- **禁止**逗号并集选择器（如 `.hmes-style, .c7n-pro-table-wrapper`）→ Playwright strict mode
- Modal / Drawer：同一 Pro Modal；用 `.c7n-pro-modal-active`；见 [playbooks/choerodon-modal.md](../playbooks/choerodon-modal.md)
- QueryBar：filterBar 用 refresh 图标；professionalBar 用按钮「查询」；见 [playbooks/choerodon-table-queryBar.md](../playbooks/choerodon-table-queryBar.md)
- Select ≠ Lov；DatePicker 前缀是 `calendar-picker`；Tabs 是 `c7n-tabs`（非 pro）；见对应 playbooks
- 表格行编辑：表头 `icon-add`、行首 `icon-remove`+Popconfirm；**行内 Lov** 先点格再 `.icon-search`；无 href 的 a 用 `tableActionLink`；「更多」菜单见 [playbooks/choerodon-row-dropdown.md](../playbooks/choerodon-row-dropdown.md)
- 引擎合并定位顺序：平台 kit → **功能产物目录**下的 `elements.yaml`（非本仓 Git）→ field_rules 推导 → elements_hints（仅补缺，不覆盖已有 css）

## DOM 探针 + 人工审核

```bash
pnpm exec tsx src/cli/index.ts probe-dom -f "<功能名>" -i artifacts/<slug>/feature.yaml
# 在功能产物目录编辑 review.yaml：候选 status → approved / rejected
pnpm exec tsx src/cli/index.ts confirm -f "<功能名>" --apply-dom
```

- 探针写 `artifacts/dom/` + 功能侧 `REVIEW.md` / `review.yaml`，**默认不写 kit**
- `confirm --apply-dom` 仅合并 `approved` 进 `kit.yaml`，默认不覆盖已有 key（`--force-dom` 才覆盖）

业务字段定位写在**功能产物**的 `elements.yaml`，不要只改 `elements/<slug>/generated.yaml`（下次 gen 会重建）。

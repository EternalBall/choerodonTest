# 平台组件 DOM 沉淀（机器可读）

真相源：`knowledge/platform/choerodon/kit.yaml`

- 同组件在本系统 DOM 一致（Table / filterBar / Page Header / Form / LOV / **Modal Drawer** / **表格行编辑**）
- **禁止**逗号并集选择器（如 `.hmes-style, .c7n-pro-table-wrapper`）→ Playwright strict mode
- Drawer：容器常驻；用 `.c7n-pro-modal-active`（+ 标题）判断打开，未打开时仅 `mask[hidden]`
- 表格行编辑：表头 `icon-add`、行首 `icon-remove`+Popconfirm；**行内 Lov** 先点可编辑格再点浮层 `.icon-search`；**行内无 href 的 a** 用 text/css（`tableActionLink`），勿 `role=link`；见 [playbooks/choerodon-table-row-edit.md](../playbooks/choerodon-table-row-edit.md)
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

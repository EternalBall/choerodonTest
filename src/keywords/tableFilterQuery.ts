import { expect, type Page } from '@playwright/test';
import type { ActionContext } from './index.js';
import { pickSelect } from './pickSelect.js';

export type FilterField = {
  /** DS 字段名，对应 input[name] 与 checkbox value */
  name: string;
  /** 中文标签，用于弹层搜索 */
  label?: string;
  /** 文本值；Select/Lov 用 first 时可省略 */
  value?: string;
  /** text | select | lov；缺省：有 value 当 text，否则当 select 选第一条 */
  control?: 'text' | 'select' | 'lov';
  /** Select/Lov：选界面第一条（推荐默认） */
  first?: boolean;
};

/**
 * Choerodon Table 查询条：
 * - filterBar：添加筛选 → 勾选 → 填写/点选 → 点 refresh 图标查询
 * - professionalBar：直接填表单项 / 点选 → 点「查询」按钮
 *
 * 样本数据约定：Select/Lov 优先 `control` + `first: true`（界面第一条）；
 * 自由文本才写 `value`。
 */
export async function tableFilterQuery(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const mode = String(args.mode || 'filterBar');
  const fields = normalizeFields(args.fields);
  if (!fields.length) throw new Error('tableFilterQuery 需要 fields');

  if (mode === 'professionalBar') {
    await queryProfessionalBar(ctx, fields, args);
    return;
  }

  await queryFilterBar(ctx, fields, args);
}

function normalizeFields(raw: unknown): FilterField[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item, i) => {
      if (!item || typeof item !== 'object') throw new Error(`fields[${i}] 无效`);
      const o = item as Record<string, unknown>;
      const name = String(o.name || '');
      if (!name) throw new Error(`fields[${i}] 缺少 name`);
      const controlRaw = o.control != null ? String(o.control) : undefined;
      const control =
        controlRaw === 'select' || controlRaw === 'lov' || controlRaw === 'text'
          ? controlRaw
          : undefined;
      const value = o.value != null && String(o.value) !== '' ? String(o.value) : undefined;
      const first = o.first === true || o.first === 'true';
      return {
        name,
        label: o.label != null ? String(o.label) : undefined,
        value,
        control,
        first,
      };
    });
  }
  // 兼容 { materialCode: '测试', materialName: 'xx' }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, string>).map(([name, value]) => ({
      name,
      value: String(value),
      control: 'text' as const,
    }));
  }
  return [];
}

function resolveControl(field: FilterField): 'text' | 'select' | 'lov' {
  if (field.control) return field.control;
  if (field.first && !field.value) return 'select';
  if (field.value) return 'text';
  return 'select';
}

async function ensureFilterFieldVisible(
  page: Page,
  field: FilterField,
  args: Record<string, unknown>,
): Promise<void> {
  const addFilterSel = String(args.addFilterCss || '.c7n-pro-table-add-fields');
  const popupSel = String(args.filterPopupCss || '.c7n-pro-dropdown-popup .c7n-pro-table-filter-list');
  const filterSearchSel = String(
    args.filterSearchCss ||
      '.c7n-pro-table-filter-list input.c7n-pro-input[placeholder="搜索过滤条件"]',
  );

  // 页面刚进入时筛选栏可能还没渲染完：先等筛选栏出现，避免把“还没渲染”误判成“字段不在筛选栏”而去翻添加筛选菜单
  await page
    .locator('.c7n-pro-table-dynamic-filter-bar, .c7n-pro-table-filter-menu')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => undefined);
  const input = page.locator(`input.c7n-pro-input[name="${field.name}"]`).first();
  const already = await input.isVisible().catch(() => false);
  if (already) return;

  await page.locator(addFilterSel).first().click();
  const popup = page.locator(popupSel).first();
  await expect(popup).toBeVisible({ timeout: 10_000 });

  const searchLabel = field.label || field.name;
  const searchInput = page.locator(filterSearchSel).first();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill('');
    await searchInput.fill(searchLabel);
    await page.waitForTimeout(300);
  }

  const item = page
    .locator('.c7n-pro-table-filter-list-item')
    .filter({ has: page.locator(`input.c7n-pro-checkbox[value="${field.name}"]`) })
    .first();
  const label = item.locator('.c7n-pro-checkbox-label');
  const checkbox = item.locator('input.c7n-pro-checkbox');

  const checked = await item.locator('.c7n-pro-checkbox-checked').count();
  if (checked === 0) {
    if (await label.isVisible().catch(() => false)) {
      await label.click();
    } else {
      await checkbox.click({ force: true });
    }
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
  }

  if (await popup.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200);
  }

  await expect(input).toBeVisible({ timeout: 10_000 });
}

async function fillOrPickField(ctx: ActionContext, field: FilterField): Promise<void> {
  const control = resolveControl(field);
  if (control === 'select') {
    await pickSelect(ctx, {
      name: field.name,
      first: field.first !== false,
      option: field.value,
    });
    return;
  }
  if (control === 'lov') {
    const openCss = `.c7n-pro-select-wrapper:has(input[name="${field.name}"]) .icon-search`;
    await ctx.page.locator(openCss).first().click();
    const dialog = ctx.page
      .locator(
        '.c7n-pro-modal-wrapper:visible, .c7n-modal-wrap:visible, .c7n-pro-lov-popup:visible, [role="dialog"]:visible',
      )
      .last();
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const tbody = dialog.locator('.c7n-pro-table-tbody, tbody').first();
    const withIndex = tbody.locator('tr.c7n-pro-table-row[data-index]').first();
    const rowLoc = field.value
      ? dialog.getByRole('row', { name: new RegExp(field.value) }).first()
      : (await withIndex.count()) > 0
        ? withIndex
        : tbody.locator('tr.c7n-pro-table-row, tr').first();
    await expect(rowLoc).toBeVisible({ timeout: 15_000 });
    await rowLoc.click();
    const ok = dialog.getByRole('button', { name: /确定|确认/ }).first();
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 }).catch(async () => {
      await ctx.page.keyboard.press('Escape').catch(() => undefined);
    });
    return;
  }

  if (!field.value) {
    throw new Error(`tableFilterQuery 文本字段 ${field.name} 需要 value`);
  }
  const input = ctx.page.locator(`input.c7n-pro-input[name="${field.name}"]`).first();
  await input.fill(field.value);
}

async function queryFilterBar(
  ctx: ActionContext,
  fields: FilterField[],
  args: Record<string, unknown>,
): Promise<void> {
  const page = ctx.page;
  const queryBtnSel = String(args.queryCss || '.c7n-pro-table-filter-menu-query');
  const resetBtnSel = String(args.resetCss || '.c7n-pro-table-filter-buttons button');

  if (args.resetFirst) {
    const reset = page.locator(resetBtnSel).filter({ hasText: '重置' }).first();
    if (await reset.isVisible().catch(() => false)) {
      await reset.click();
      await page.waitForTimeout(400);
    }
  }

  for (const field of fields) {
    await ensureFilterFieldVisible(page, field, args);
    await fillOrPickField(ctx, field);
  }

  await page.locator(queryBtnSel).first().click();

  const spin = page.locator('.c7n-spin-spinning, .ant-spin-spinning, .c7n-pro-spin-container-loading');
  if ((await spin.count()) > 0) {
    await expect(spin).toHaveCount(0, { timeout: 30_000 });
  }
}

async function queryProfessionalBar(
  ctx: ActionContext,
  fields: FilterField[],
  args: Record<string, unknown>,
): Promise<void> {
  const page = ctx.page;
  for (const field of fields) {
    const control = resolveControl(field);
    if (control === 'select' || control === 'lov') {
      await fillOrPickField(ctx, field);
      continue;
    }
    if (!field.value) {
      throw new Error(`professionalBar 文本字段 ${field.name} 需要 value`);
    }
    const byName = page
      .locator(`input[name="${field.name}"], .c7n-pro-input[name="${field.name}"]`)
      .first();
    if (await byName.isVisible().catch(() => false)) {
      await byName.fill(field.value);
      continue;
    }
    if (field.label) {
      await page.getByLabel(field.label).fill(field.value);
      continue;
    }
    throw new Error(`professionalBar 未找到字段: ${field.name}`);
  }

  const queryName = String(args.queryButtonName || '查询');
  await page.getByRole('button', { name: queryName }).click();

  const spin = page.locator('.c7n-spin-spinning, .ant-spin-spinning');
  if ((await spin.count()) > 0) {
    await expect(spin).toHaveCount(0, { timeout: 30_000 });
  }
}

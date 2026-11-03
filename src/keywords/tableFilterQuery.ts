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
  // fields 为空 = 不带条件直接查询（只点查询 / 刷新）
  const fields = normalizeFields(args.fields);

  // mode 只作提示：同一页面不同版本/账号下查询条形态可能不同（filterBar 动态筛选条，
  // 或 queryBar 自定义表单 + 「查询」按钮），以运行时实际 DOM 为准
  const kind = await detectQueryBar(ctx.page, mode);
  if (kind !== (mode === 'professionalBar' ? 'form' : 'filterBar')) {
    console.log(`[tableFilterQuery] 用例写的是 ${mode}，页面实际是 ${kind === 'form' ? '表单查询条' : 'filterBar'}，按实际执行`);
  }
  if (kind === 'form') {
    await queryProfessionalBar(ctx, fields, args);
    return;
  }

  await queryFilterBar(ctx, fields, args);
}

const DYNAMIC_FILTER_BAR = '.c7n-pro-table-dynamic-filter-bar, .c7n-pro-table-filter-menu';
const QUERY_BUTTON_NAME = /^查\s*询$/;

async function detectQueryBar(page: Page, mode: string): Promise<'filterBar' | 'form'> {
  const dyn = page.locator(DYNAMIC_FILTER_BAR).first();
  const form = page.getByRole('button', { name: QUERY_BUTTON_NAME }).first();
  await dyn.or(form).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  if (await dyn.isVisible().catch(() => false)) return 'filterBar';
  if (await form.isVisible().catch(() => false)) return 'form';
  return mode === 'professionalBar' ? 'form' : 'filterBar';
}

/** 字段是否已在界面上：文本框看 input 本身，Select/Lov 的 input 是隐藏的，要看外层 wrapper */
function fieldControl(page: Page, name: string) {
  return page
    .locator(
      `input.c7n-pro-input[name="${name}"], .c7n-pro-select-wrapper:has(input[name="${name}"]), .c7n-pro-input-number-wrapper:has(input[name="${name}"])`,
    )
    .first();
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
  const input = fieldControl(page, field.name);
  const already = await input.isVisible().catch(() => false);
  if (already) return;
  if (!(await page.locator(addFilterSel).first().isVisible().catch(() => false))) {
    throw new Error(`tableFilterQuery: 筛选条里没有字段 ${field.name}，也没有「添加筛选」入口`);
  }

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
  if (args.resetFirst) {
    const reset = page.getByRole('button', { name: /^重\s*置$/ }).first();
    if (await reset.isVisible().catch(() => false)) {
      await reset.click();
      await page.waitForTimeout(400);
    }
  }
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

  const queryName = args.queryButtonName ? new RegExp(String(args.queryButtonName)) : QUERY_BUTTON_NAME;
  await page.getByRole('button', { name: queryName }).first().click();

  const spin = page.locator('.c7n-spin-spinning, .ant-spin-spinning');
  if ((await spin.count()) > 0) {
    await expect(spin).toHaveCount(0, { timeout: 30_000 });
  }
}

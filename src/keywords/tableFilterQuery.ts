import { expect, type Page } from '@playwright/test';
import type { ActionContext } from './index.js';

export type FilterField = {
  /** DS 字段名，对应 input[name] 与 checkbox value */
  name: string;
  /** 中文标签，用于弹层搜索 */
  label?: string;
  value: string;
};

/**
 * Choerodon Table 查询条：
 * - filterBar：添加筛选 → 勾选 → 填写 → 点 refresh 图标查询
 * - professionalBar：直接填表单项 → 点「查询」按钮
 */
export async function tableFilterQuery(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const mode = String(args.mode || 'filterBar');
  const fields = normalizeFields(args.fields);
  if (!fields.length) throw new Error('tableFilterQuery 需要 fields');

  if (mode === 'professionalBar') {
    await queryProfessionalBar(ctx.page, fields, args);
    return;
  }

  await queryFilterBar(ctx.page, fields, args);
}

function normalizeFields(raw: unknown): FilterField[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item, i) => {
      if (!item || typeof item !== 'object') throw new Error(`fields[${i}] 无效`);
      const o = item as Record<string, unknown>;
      const name = String(o.name || '');
      const value = String(o.value ?? '');
      if (!name) throw new Error(`fields[${i}] 缺少 name`);
      return {
        name,
        label: o.label != null ? String(o.label) : undefined,
        value,
      };
    });
  }
  // 兼容 { materialCode: '测试', materialName: 'xx' }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, string>).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  }
  return [];
}

async function queryFilterBar(
  page: Page,
  fields: FilterField[],
  args: Record<string, unknown>,
): Promise<void> {
  const addFilterSel = String(args.addFilterCss || '.c7n-pro-table-add-fields');
  const popupSel = String(args.filterPopupCss || '.c7n-pro-dropdown-popup .c7n-pro-table-filter-list');
  const filterSearchSel = String(
    args.filterSearchCss ||
      '.c7n-pro-table-filter-list input.c7n-pro-input[placeholder="搜索过滤条件"]',
  );
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
    const input = page.locator(`input.c7n-pro-input[name="${field.name}"]`).first();
    const already = await input.isVisible().catch(() => false);

    if (!already) {
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

      // 优先点 label，避免 checkbox 被挡住
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
        // 已勾选：点一下弹层外或再点添加关闭；先按 Escape / 再点一次添加区域外
        await page.keyboard.press('Escape').catch(() => undefined);
      }

      // 若弹层仍在且已勾选，点页面其它处关闭
      if (await popup.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(200);
      }

      await expect(input).toBeVisible({ timeout: 10_000 });
    }

    await input.fill(field.value);
  }

  await page.locator(queryBtnSel).first().click();

  const spin = page.locator('.c7n-spin-spinning, .ant-spin-spinning, .c7n-pro-spin-container-loading');
  if ((await spin.count()) > 0) {
    await expect(spin).toHaveCount(0, { timeout: 30_000 });
  }
}

async function queryProfessionalBar(
  page: Page,
  fields: FilterField[],
  args: Record<string, unknown>,
): Promise<void> {
  for (const field of fields) {
    const byName = page.locator(`input[name="${field.name}"], .c7n-pro-input[name="${field.name}"]`).first();
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

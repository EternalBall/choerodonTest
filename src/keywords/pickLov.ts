import { expect, type Locator, type Page } from '@playwright/test';
import type { ActionContext } from './index.js';
import { waitReady } from './waitReady.js';

/**
 * Choerodon LOV：点搜索图标 → 弹层 → 搜/选行 → 确定（或点行即选）
 */
export async function pickLov(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const openRef = String(args.open || '');
  if (!openRef) throw new Error('pickLov 需要 open（LOV 搜索图标/触发器）');
  await ctx.el(openRef).click();

  const dialog = resolveDialog(ctx, args);
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  if (args.dialogSpin) {
    await waitReady(ctx.page, ctx.el, { hidden: String(args.dialogSpin) });
  }

  const search = args.search as { target?: string; value?: string; css?: string } | undefined;
  if (search?.value) {
    const searchBox = search.target
      ? ctx.el(search.target)
      : dialog
          .locator(
            search.css ||
              'input.c7n-pro-input, input[placeholder*="搜索"], input[placeholder*="查询"]',
          )
          .first();
    await searchBox.fill(search.value);
    await searchBox.press('Enter');
    await ctx.page.waitForTimeout(500);
  }

  const row = args.row as { by?: string; value?: string; first?: boolean } | undefined;
  const tbody = dialog.locator('.c7n-pro-table-tbody, tbody').first();
  let rowLoc: Locator;

  if (row?.first || (!row?.value && args.first !== false)) {
    rowLoc = tbody.locator('tr.c7n-pro-table-row, tr').filter({ hasNot: dialog.locator('.c7n-pro-table-empty-row') }).first();
    // 空态行排除：优先 data-index 行
    const withIndex = tbody.locator('tr.c7n-pro-table-row[data-index]').first();
    if ((await withIndex.count()) > 0) rowLoc = withIndex;
  } else if (row?.value) {
    rowLoc = dialog.getByRole('row', { name: new RegExp(row.value) }).first();
  } else {
    throw new Error('pickLov 需要 row.value 或 row.first / first');
  }

  await expect(rowLoc).toBeVisible({ timeout: 15_000 });
  await rowLoc.click();

  if (args.confirm) {
    await ctx.el(String(args.confirm)).click();
  } else {
    // 常见：弹层内「确定」
    const ok = dialog.getByRole('button', { name: /确定|确认/ }).first();
    if (await ok.isVisible().catch(() => false)) {
      await ok.click();
    }
  }

  await expect(dialog).toBeHidden({ timeout: 15_000 }).catch(async () => {
    // 部分 LOV 点行即关
    await ctx.page.keyboard.press('Escape').catch(() => undefined);
  });
}

function resolveDialog(ctx: ActionContext, args: Record<string, unknown>): Locator {
  if (args.dialog) return ctx.el(String(args.dialog));
  const page = ctx.page;
  // Choerodon LOV 弹层常见容器
  return page
    .locator(
      '.c7n-pro-modal-wrapper:visible, .c7n-modal-wrap:visible, .c7n-pro-lov-popup:visible, [role="dialog"]:visible',
    )
    .last();
}

/** 供测试/调试：从 Page 找可见 dialog */
export function visibleLovDialog(page: Page): Locator {
  return page
    .locator(
      '.c7n-pro-modal-wrapper:visible, .c7n-modal-wrap:visible, .c7n-pro-lov-popup:visible, [role="dialog"]:visible',
    )
    .last();
}

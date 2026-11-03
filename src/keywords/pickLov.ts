import { expect, type Locator, type Page } from '@playwright/test';
import type { ActionContext } from './index.js';
import { waitReady } from './waitReady.js';
import { activeScope, clickWithDiagnosis, detectEnvConfigError, EnvNotReadyError } from './scope.js';

/**
 * Choerodon LOV：点搜索图标 → 弹层 → 搜/选行 → 确定（或点行即选）
 */
export async function pickLov(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const openRef = String(args.open || '');
  if (!openRef) throw new Error('pickLov 需要 open（LOV 搜索图标/触发器）');
  const openLoc = ctx.el(openRef);
  await activateCellEditor(ctx, openLoc);
  await clickWithDiagnosis(openLoc, openRef);

  let dialog = resolveDialog(ctx, args);
  // 表格内 LOV 在候选仅 1 条时会直接回填、不弹层：5s 内未出现弹层则视为已自动选中
  const shown = await dialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    if (args.autoSelect === false) await expect(dialog).toBeVisible({ timeout: 25_000 });
    else {
      // 视为「仅 1 条候选已自动回填」前先核实字段确实有值，否则是弹层没打开（不能静默通过）
      const input = ctx.el(openRef).first().locator('xpath=ancestor::*[contains(@class,"-wrapper")][1]//input[@name]').first();
      const val = (await input.count()) ? await input.inputValue().catch(() => '') : 'unknown';
      if (!val) throw new Error(`pickLov: 点击 ${openRef} 后 5s 内未出现选择弹层，字段仍为空`);
      return;
    }
  }

  // 钉住本次打开的选择弹层：resolveDialog 是「最后一个可见弹层」，LOV 点行即关后会漂移到下面的抽屉，
  // 再点「确定」就把抽屉关了（DEV 实测新增数据项抽屉被误关）
  if (!args.dialog) {
    const mark = `lov-${Date.now()}`;
    await dialog.evaluate((el: any, m: string) => el.setAttribute('data-ata-lov', m), mark).catch(() => undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
    dialog = ctx.page.locator(`[data-ata-lov="${mark}"]`);
  }
  const envErr = await detectEnvConfigError(dialog);
  if (envErr) {
    await ctx.page.keyboard.press('Escape').catch(() => undefined);
    throw new EnvNotReadyError(`环境不具备：${openRef} 的选择弹层提示「${envErr}」，需在当前环境维护该配置`);
  }

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
      '.c7n-pro-modal-wrapper:visible, .c7n-modal-wrap:visible, .c7n-pro-select-lov-popup:visible, .c7n-pro-lov-popup:visible, [role="dialog"]:visible',
    )
    .last();
}

/** 供测试/调试：从 Page 找可见 dialog */
export function visibleLovDialog(page: Page): Locator {
  return page
    .locator(
      '.c7n-pro-modal-wrapper:visible, .c7n-modal-wrap:visible, .c7n-pro-select-lov-popup:visible, .c7n-pro-lov-popup:visible, [role="dialog"]:visible',
    )
    .last();
}

/**
 * c7n-pro Table 行内编辑：编辑器（含 LOV 放大镜）只在单元格被激活后才渲染。
 * 打开图标 3s 内没出现时，在最上层弹层/页面里找 data-index=字段名 的单元格点一下激活编辑器。
 * 字段名取自定位里的 input[name="…"]（元素库字段定位统一这样生成）。
 */
async function activateCellEditor(ctx: ActionContext, openLoc: Locator): Promise<void> {
  const shown = await openLoc.first().waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
  if (shown) return;
  const m = /input\[name=\\?"([A-Za-z_]\w*)\\?"\]/.exec(String(openLoc));
  if (!m) return;
  const scope = await activeScope(ctx.page);
  const cell = scope.locator(`.c7n-pro-table-tbody td[data-index="${m[1]}"]`).first();
  if (await cell.isVisible().catch(() => false)) {
    console.log(`[pickLov] ${m[1]} 是表格行内编辑字段，先点击单元格激活编辑器`);
    await cell.click();
  }
}

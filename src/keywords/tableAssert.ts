import { expect, type Locator } from '@playwright/test';
import type { ActionContext } from './index.js';

/** 表格无数据：停止后续步骤（保留已执行步骤与截图，以明确错误结束用例） */
export class TableNoDataError extends Error {
  readonly code = 'TABLE_NO_DATA';
  constructor(message: string) {
    super(message);
    this.name = 'TableNoDataError';
  }
}

/**
 * 断言表格至少有 min 行。
 * 空表时抛 TableNoDataError，runner 截图后结束，不再执行后续步骤。
 */
export async function assertTableHasRows(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const min = Number(args.min ?? 1);
  const label = String(args.label || args.name || '表格');
  const table = resolveTable(ctx, args);

  const visible = await table.isVisible().catch(() => false);
  if (!visible) {
    try {
      await expect(table).toBeVisible({ timeout: Number(args.timeout ?? 8_000) });
    } catch {
      throw new TableNoDataError(
        `没数据，没办法继续执行（未找到「${label}」）`,
      );
    }
  }

  const { rowCount, emptyVisible } = await inspectTable(table);

  if (emptyVisible || rowCount < min) {
    throw new TableNoDataError(
      `没数据，没办法继续执行（${label}需要 >= ${min} 行，实际 ${rowCount}）`,
    );
  }
}

/** 断言表格为空（合法空态） */
export async function assertTableEmpty(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const table = resolveTable(ctx, args);
  const { rowCount, emptyVisible } = await inspectTable(table);
  if (!emptyVisible && rowCount > 0) {
    throw new Error(`assertTableEmpty 失败: 期望空表，实际 ${rowCount} 行`);
  }
}

function resolveTable(ctx: ActionContext, args: Record<string, unknown>) {
  if (args.table) return ctx.el(String(args.table));
  return ctx.page.locator('.c7n-pro-table.c7n-pro-table-bordered').first();
}

async function inspectTable(table: Locator) {
  const empty = table.locator(
    '.c7n-pro-empty, .c7n-empty, .c7n-pro-table-empty-row, [class*="empty"]',
  );
  const emptyText = table.getByText('暂无数据', { exact: false });
  const emptyVisible =
    (await empty.first().isVisible().catch(() => false)) ||
    (await emptyText.first().isVisible().catch(() => false));

  const rows = table.locator('tbody tr.c7n-pro-table-row');
  let rowCount = await rows.count();
  if (rowCount === 0) {
    rowCount = await table.locator('tbody tr').filter({ hasNotText: '暂无数据' }).count();
  }
  if (emptyVisible) rowCount = 0;
  return { rowCount, emptyVisible };
}

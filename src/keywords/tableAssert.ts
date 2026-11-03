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
  // 用例里常写 target（与其他关键字一致），旧写法 table 兼容
  const ref = args.table ?? args.target;
  if (ref) return ctx.el(String(ref)).first();
  return ctx.page.locator('.c7n-pro-table').first();
}

async function inspectTable(table: Locator) {
  // 只认表体里的空态：不能用 [class*="empty"]——表头行内筛选输入框带 c7n-pro-input-empty（DEV 实测误判 0 行）
  const empty = table.locator(
    '.c7n-pro-table-tbody .c7n-pro-table-empty-row, .c7n-pro-table-tbody .c7n-pro-empty, .c7n-pro-table-tbody .c7n-empty, tbody .c7n-pro-table-empty-row',
  );
  const emptyText = table.locator('.c7n-pro-table-tbody, tbody').getByText('暂无数据', { exact: false });
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

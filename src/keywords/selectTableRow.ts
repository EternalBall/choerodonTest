import type { ActionContext } from './index.js';
import { DataNotReadyError } from './scope.js';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 勾选列表行（批量操作前）：ownPrefix 时只勾测试自有数据（行内文案含该前缀），count 默认 1。
 * c7n-pro 勾选框点 input 本体（它覆盖在 .c7n-pro-checkbox-inner 上，DEV 实测）；
 * 左固定列时行会在固定表里重复渲染，取第一个可见的勾选框。
 */
export async function selectTableRow(ctx: ActionContext, args: Record<string, unknown>): Promise<void> {
  const table = typeof args.table === 'string' && args.table ? ctx.el(args.table).first() : ctx.page.locator('.c7n-pro-table').first();
  const ownPrefix = args.ownPrefix != null && String(args.ownPrefix) !== '' ? String(args.ownPrefix) : undefined;
  let rows = table.locator('.c7n-pro-table-tbody tr.c7n-pro-table-row');
  if (ownPrefix) rows = rows.filter({ hasText: new RegExp(escapeRe(ownPrefix)) });
  await rows.first().waitFor({ state: 'visible', timeout: Number(args.timeout ?? 15_000) }).catch(() => undefined);
  const n = await rows.count();
  const want = Number(args.count ?? 1);
  if (n === 0) {
    throw new DataNotReadyError(
      ownPrefix ? `数据不具备：列表当前页没有测试自有数据（行内含「${ownPrefix}」），需先运行新建用例造数` : '数据不具备：列表没有数据行',
    );
  }
  for (let i = 0; i < Math.min(n, want); i++) {
    const box = rows.nth(i).locator('input.c7n-pro-checkbox').first();
    await box.click({ timeout: 15_000 });
  }
}

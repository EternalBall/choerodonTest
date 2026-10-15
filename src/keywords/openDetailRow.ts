import type { ActionContext } from './index.js';

/**
 * 列表进详情：
 * - 有 match/exactText：按精确文案过滤
 * - 0 行 → 失败
 * - 多行 → whenMultiple=first（默认）点第一条；=fail 则报错
 */
export async function openDetailRow(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const target = String(args.target || args.link || '');
  if (!target) throw new Error('openDetailRow 需要 target（如 detailLink）');

  let loc = ctx.el(target);
  const match = args.match ?? args.exactText;
  if (match != null && String(match) !== '') {
    const s = String(match).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    loc = loc.filter({ hasText: new RegExp(`^${s}$`) });
  }

  const count = await loc.count();
  if (count === 0) {
    throw new Error(
      `openDetailRow: 未找到匹配行（target=${target}, match=${match ?? '(any)'}）。请确认筛选条件或先 create 造数`,
    );
  }

  const whenMultiple = String(args.whenMultiple || 'first');
  if (count > 1 && whenMultiple === 'fail') {
    throw new Error(`openDetailRow: 匹配到 ${count} 行，whenMultiple=fail`);
  }

  await loc.first().click();
}

import type { Locator } from '@playwright/test';
import type { ActionContext } from './index.js';
import { DataNotReadyError } from './scope.js';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 列表进详情：
 * - match/exactText：按精确文案过滤
 * - ownPrefix：只进测试自有数据（链接文案以该前缀开头），写操作用例不碰业务数据
 * - requireEnabled：进详情后该元素须可用（如「编辑」），否则返回列表试下一条，最多 maxTries 条
 * - 找不到满足条件的行：抛 DataNotReadyError（执行器标为「数据不具备」跳过）
 * - whenMultiple=fail：匹配多行即报错
 */
export async function openDetailRow(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const target = String(args.target || args.link || '');
  if (!target) throw new Error('openDetailRow 需要 target（如 detailLink）');

  let loc: Locator = ctx.el(target);
  const match = args.match ?? args.exactText;
  if (match != null && String(match) !== '') {
    loc = loc.filter({ hasText: new RegExp(`^${escapeRe(String(match))}$`) });
  }
  const ownPrefix = args.ownPrefix != null && String(args.ownPrefix) !== '' ? String(args.ownPrefix) : undefined;
  if (ownPrefix) loc = loc.filter({ hasText: new RegExp(`^\\s*${escapeRe(ownPrefix)}`) });

  // 表格数据常为异步渲染：先等目标出现再计数（args.timeout 覆盖，毫秒）
  await loc
    .first()
    .waitFor({ state: 'visible', timeout: Number(args.timeout ?? 15_000) })
    .catch(() => undefined);
  const count = await loc.count();
  if (count === 0) {
    if (ownPrefix) {
      throw new DataNotReadyError(`数据不具备：列表当前页没有测试自有数据（${target} 文案以「${ownPrefix}」开头），需先运行新建用例造数`);
    }
    throw new Error(
      `openDetailRow: 未找到匹配行（target=${target}, match=${match ?? '(any)'}）。请确认筛选条件或先 create 造数`,
    );
  }

  const whenMultiple = String(args.whenMultiple || 'first');
  if (count > 1 && whenMultiple === 'fail') {
    throw new Error(`openDetailRow: 匹配到 ${count} 行，whenMultiple=fail`);
  }

  const requireRef = typeof args.requireEnabled === 'string' && args.requireEnabled ? args.requireEnabled : undefined;
  if (!requireRef) {
    await loc.first().click();
    return;
  }

  const maxTries = Math.min(count, Number(args.maxTries ?? 5));
  const listUrl = ctx.page.url();
  const tried: string[] = [];
  for (let i = 0; i < maxTries; i++) {
    const link = loc.nth(i);
    const text = ((await link.textContent().catch(() => '')) ?? '').trim();
    await link.click();
    // 详情按钮先按默认态渲染（如「编辑」可用），数据回来后才按状态置灰：等请求落定再判断
    await ctx.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    const need = ctx.el(requireRef).first();
    const visible = await need
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    // DEV 实测：networkidle 后「编辑」仍可能先可用、约 2~4s 后才按状态置灰；稳定窗口内任一次禁用即视为禁用
    let enabled = visible;
    for (let k = 0; enabled && k < 4; k++) {
      if (await need.isDisabled().catch(() => true)) enabled = false;
      else if (k < 3) await ctx.page.waitForTimeout(1_000);
    }
    if (enabled) {
      if (i > 0) console.log(`[openDetailRow] 前 ${i} 条记录的 ${requireRef} 不可用，改用第 ${i + 1} 条「${text}」`);
      return;
    }
    tried.push(`${text}${visible ? '（禁用）' : '（未出现）'}`);
    // 回到列表再试下一条：优先浏览器后退，失败则重新打开列表地址
    await ctx.page.goBack().catch(() => undefined);
    if (ctx.page.url() !== listUrl) await ctx.page.goto(listUrl);
    await loc.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  }
  throw new DataNotReadyError(
    `数据不具备：前 ${tried.length} 条${ownPrefix ? '测试自有' : ''}记录进详情后 ${requireRef} 都不可用（${tried.join('、')}），多为单据状态不允许此操作`,
  );
}

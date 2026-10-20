import { expect, type Locator } from '@playwright/test';
import type { ActionContext } from './index.js';

/**
 * Choerodon Pro Select / Lookup：点开下拉，选 option（默认第一条）。
 * 与 Lov（弹表）不同，见 playbooks/choerodon-select.md。
 *
 * args:
 * - name: DS 字段名 → `.c7n-pro-select-wrapper:has(input[name=…])`
 * - target / open: 元素库引用（wrapper 或 trigger）
 * - first: 默认 true（无 option 文案时）
 * - option: 按文案点选（优先于 first）
 */
export async function pickSelect(
  ctx: ActionContext,
  args: Record<string, unknown>,
): Promise<void> {
  const page = ctx.page;
  const wrapper = resolveWrapper(ctx, args);
  const trigger = wrapper.locator(
    '.c7n-pro-select-trigger, .c7n-pro-select, input.c7n-pro-input',
  ).first();
  await expect(wrapper).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  const popup = page.locator('.c7n-pro-select-popup:visible').last();
  await expect(popup).toBeVisible({ timeout: 10_000 });

  const optionText = args.option != null ? String(args.option) : undefined;
  const useFirst = args.first !== false && !optionText;

  let item: Locator;
  if (optionText) {
    item = popup
      .locator(
        '.c7n-pro-select-dropdown-menu-item, .c7n-pro-menu-item, li[role="option"], li',
      )
      .filter({ hasText: optionText })
      .first();
  } else if (useFirst) {
    item = firstEnabledOption(popup);
  } else {
    throw new Error('pickSelect 需要 option 文案，或 first: true');
  }

  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();

  await expect(popup)
    .toBeHidden({ timeout: 10_000 })
    .catch(async () => {
      await page.keyboard.press('Escape').catch(() => undefined);
    });
}

function resolveWrapper(ctx: ActionContext, args: Record<string, unknown>): Locator {
  if (args.target) return ctx.el(String(args.target));
  if (args.open) return ctx.el(String(args.open));
  const name = args.name != null ? String(args.name) : '';
  if (!name) throw new Error('pickSelect 需要 name 或 target/open');
  return ctx.page
    .locator(`.c7n-pro-select-wrapper:has(input[name="${cssEscape(name)}"])`)
    .first();
}

function firstEnabledOption(popup: Locator): Locator {
  const candidates = popup.locator(
    [
      '.c7n-pro-select-dropdown-menu-item:not(.c7n-pro-select-dropdown-menu-item-disabled)',
      '.c7n-pro-menu-item:not(.c7n-pro-menu-item-disabled)',
      'li[role="option"]:not([aria-disabled="true"])',
      '.c7n-pro-select-dropdown-menu li:not([disabled])',
    ].join(', '),
  );
  return candidates.first();
}

function cssEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

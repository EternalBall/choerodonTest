import type { Locator, Page } from '@playwright/test';

/**
 * c7n-pro Modal 通过 Portal 渲染在页面主体之外（DEV 实测类名 `c7n-pro-modal`）。
 * 弹窗打开时，页面上常有同名字段（如详情页的 tagGroupCode 与复制弹窗的 tagGroupCode），
 * 按字段名定位必须先限定在最上层可见弹窗内，否则会命中页面里被禁用的同名输入框。
 */
export const MODAL_SELECTOR = '.c7n-pro-modal';

/** 最上层可见弹窗；没有弹窗时返回 page */
export async function activeScope(page: Page): Promise<Page | Locator> {
  const modals = page.locator(`${MODAL_SELECTOR}:visible`);
  return (await modals.count()) > 0 ? modals.last() : page;
}

/**
 * 主框架「验证提示」弹窗（hzero BasicLayout：邮箱/手机未验证或初始密码时弹出，
 * 标记存在 sessionStorage，Playwright 每条用例都会重新弹出），会拦截整页点击。
 * 来源：sh-front/packages/key-base-front/src/layouts/BasicLayout.js（self-modal）。
 */
export const GLOBAL_PROMPT_MODAL = '.c7n-modal-wrap[class*="self-modal"]';

export async function dismissGlobalPrompt(page: Page, waitMs = 1_500): Promise<boolean> {
  const modal = page.locator(GLOBAL_PROMPT_MODAL).first();
  const shown = await modal
    .waitFor({ state: 'visible', timeout: waitMs })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  const close = modal.locator('.c7n-modal-close').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  else await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  return true;
}

/** 控件不可编辑（disabled / readonly 且无弹出能力）时返回其当前值；可编辑返回 null */
export async function readonlyValue(input: Locator): Promise<string | null> {
  const disabled = await input.isDisabled().catch(() => false);
  if (!disabled) return null;
  return (await input.inputValue().catch(() => '')) ?? '';
}

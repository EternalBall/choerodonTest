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

/**
 * 带诊断的点击：目标不出现 / 处于禁用状态时在限定时间内给出明确原因，
 * 而不是让 Playwright 一直等到整条用例超时（禁用按钮多因当前数据状态不允许，如单据已关闭时「编辑」置灰）。
 */
export async function clickWithDiagnosis(loc: Locator, target: string, timeout = 20_000): Promise<void> {
  try {
    await loc.waitFor({ state: 'visible', timeout });
  } catch (e) {
    throw new Error(`点击目标失败（${target}）：${timeout / 1000}s 内未出现。${String((e as Error).message).split('\n')[0]}`);
  }
  if (await loc.isDisabled().catch(() => false)) {
    throw new Error(`点击目标失败（${target}）：目标处于禁用状态，多为当前数据状态不允许此操作（数据问题，非定位问题）`);
  }
  try {
    await loc.click({ timeout });
  } catch (e) {
    throw new Error(`点击目标失败（${target}）：${String((e as Error).message).split('\n')[0]}`);
  }
}

/**
 * 数据不具备：页面与定位都正常，但当前环境里没有满足前置条件的数据（如没有本测试自己造的、
 * 状态允许编辑的记录）。执行器据此把用例标为跳过并写明原因，不算失败。
 */
export class DataNotReadyError extends Error {
  readonly code = 'DATA_NOT_READY';
  constructor(message: string) {
    super(message);
    this.name = 'DataNotReadyError';
  }
}

/** 测试自有数据的前缀（造数统一用 ${ENV.TEST_DATA_PREFIX}${ENV.ATA_RUN_ID}） */
export function testDataPrefix(): string {
  return process.env.TEST_DATA_PREFIX || 'autotest';
}

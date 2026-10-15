import { expect, type Page } from '@playwright/test';
import type { createElResolver } from './resolveElement.js';

type El = ReturnType<typeof createElResolver>;

export type ReadySpec = {
  visible?: string;
  hidden?: string;
  response?: string;
};

/**
 * 检测页面/区域可交互：业务元素可见 + loading 消失 + 可选等接口
 */
export async function waitReady(
  page: Page,
  el: El,
  ready?: ReadySpec,
  timeout = 30_000,
): Promise<void> {
  if (!ready) return;

  if (ready.response) {
    await page.waitForResponse(
      (r) => r.url().includes(ready.response!) && r.ok(),
      { timeout },
    );
  }

  if (ready.visible) {
    await expect(el(ready.visible)).toBeVisible({ timeout });
  }

  if (ready.hidden) {
    // 元素可能仍在 DOM，只是不可见（如 class="hidden"）
    await expect(el(ready.hidden)).toBeHidden({ timeout });
  }

  // 常见 UI 库 loading（无对应元素库时的兜底）
  const spinning = page.locator('.ant-spin-spinning, .el-loading-mask');
  if ((await spinning.count()) > 0) {
    await expect(spinning).toHaveCount(0, { timeout });
  }
}

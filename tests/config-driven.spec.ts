import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { loadElementLibrary, loadSuite } from '../src/core/config.js';
import { actions, runAsserts, type ActionContext } from '../src/keywords/index.js';
import { createElResolver } from '../src/keywords/resolveElement.js';
import { waitReady } from '../src/keywords/waitReady.js';
import { interpolateDeep } from '../src/keywords/vars.js';
import { TableNoDataError } from '../src/keywords/tableAssert.js';

// 用例 YAML 中可用 ${ENV.ATA_RUN_ID} / ${vars.xxx}
// 自动化落库数据统一前缀（便于识别与人工清理）；可用 .env 的 TEST_DATA_PREFIX 覆盖
if (!process.env.TEST_DATA_PREFIX) process.env.TEST_DATA_PREFIX = 'autotest';
if (!process.env.ATA_RUN_ID) {
  process.env.ATA_RUN_ID = String(Date.now());
}

const caseFile = process.env.ATA_CASE_FILE;

if (!caseFile || !fs.existsSync(caseFile)) {
  test('缺少 ATA_CASE_FILE', async () => {
    throw new Error(
      '请通过 CLI 设置用例文件，例如: pnpm ata test -c cases/example-smoke.yaml',
    );
  });
} else {
  const suite = await loadSuite(caseFile);
  const elements = await loadElementLibrary();

  test.describe(suite.suite, () => {
    for (const c of suite.cases) {
      test(`${c.id} ${c.title}`, async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        if (suite.baseURL) {
          expect(suite.baseURL).toBeTruthy();
        }

        const ctx: ActionContext = {
          page,
          el: createElResolver(page, elements),
          baseURL: suite.baseURL,
          vars: {},
        };

        for (const step of c.steps) {
          await test.step(step.name, async () => {
            const handler = actions[step.action];
            if (!handler) {
              throw new Error(`未知 action: ${step.action}，可用: ${Object.keys(actions).join(', ')}`);
            }

            const args = interpolateDeep({ ...step.args }, ctx.vars) as Record<string, unknown>;
            if (step.action === 'goto' && step.ready) {
              args.ready = step.ready;
            }

            let stepError: unknown;
            try {
              await handler(ctx, args);

              if (step.action !== 'goto' && step.ready) {
                await waitReady(page, ctx.el, step.ready);
              }

              if (step.assert?.length) {
                await runAsserts(ctx, step.assert);
              }
            } catch (e) {
              stepError = e;
            } finally {
              await attachStepScreenshot(page, ctx, testInfo, step, stepError);
            }

            if (stepError) throw stepError;
          });
        }
      });
    }
  });
}

type ShotOpt = false | { fullPage: boolean; target?: string };

/** 默认视口截图；抽屉/弹层可 screenshot.target；慎用 fullPage（fixed/flex 易歪） */
function normalizeScreenshot(raw: unknown): ShotOpt {
  if (raw === false) return false;
  if (raw === true || raw == null) return { fullPage: false };
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as { fullPage?: boolean; target?: string };
    return {
      fullPage: o.fullPage === true,
      target: typeof o.target === 'string' && o.target ? o.target : undefined,
    };
  }
  return { fullPage: false };
}

async function attachStepScreenshot(
  page: import('@playwright/test').Page,
  ctx: ActionContext,
  testInfo: import('@playwright/test').TestInfo,
  step: { name: string; screenshot?: unknown },
  stepError: unknown,
): Promise<void> {
  const opt = normalizeScreenshot(step.screenshot);
  if (opt === false) return;

  try {
    const noData = stepError instanceof TableNoDataError;
    const suffix = stepError ? '_FAILED' : '';
    const file = testInfo.outputPath(`${sanitize(step.name)}${suffix}.png`);

    if (opt.target) {
      await ctx.el(opt.target).screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: opt.fullPage });
    }

    const attachName = noData
      ? `${step.name}（没数据，没办法继续执行）`
      : stepError
        ? `${step.name}（失败）`
        : step.name;
    await testInfo.attach(attachName, {
      path: file,
      contentType: 'image/png',
    });
  } catch {
    /* ignore */
  }
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 80);
}

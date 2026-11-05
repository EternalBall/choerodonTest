import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * 回归脚本独立配置：不依赖 LLM / setup project / webServer，直连升辉 MES DEV。
 * 账号密码只从环境变量 REG_USER / REG_PASS 读取（见 tests/regression/*.spec.ts）。
 */

const require = createRequire(import.meta.url);

/** 本地 playwright-core 期望的 chromium revision（找不到时退回最新）。 */
function expectedRevision(): string | undefined {
  try {
    const browsersJson = require('playwright-core/browsers.json') as {
      browsers: { name: string; revision: string }[];
    };
    return browsersJson.browsers.find((b) => b.name === 'chromium')?.revision;
  } catch {
    return undefined;
  }
}

/** Linux：在 ms-playwright 缓存里找 chromium-N/chrome-linux64/chrome。 */
function resolveLinuxChromium(): string | undefined {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  // 容器里 HOME 可能被改写，补扫 /home/*/.cache/ms-playwright
  if (fs.existsSync('/home')) {
    for (const u of fs.readdirSync('/home')) roots.push(path.join('/home', u, '.cache', 'ms-playwright'));
  }
  const want = expectedRevision();
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^chromium-\d+$/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => {
        if (want && a === `chromium-${want}`) return -1;
        if (want && b === `chromium-${want}`) return 1;
        return Number(b.split('-')[1]) - Number(a.split('-')[1]);
      });
    for (const dir of dirs) {
      const exe = path.join(root, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const chromePath = resolveLinuxChromium();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

export default defineConfig({
  testDir: './tests/regression',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: `reports/regression/results-${stamp}.json` }],
  ],
  outputDir: 'reports/regression/test-output',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 900 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  projects: [{ name: 'chromium' }],
});

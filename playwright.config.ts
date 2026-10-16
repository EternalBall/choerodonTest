import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(root, 'playwright/.auth/user.json');
const baseURL = process.env.BASE_URL || 'https://example.com';

/** Resolve Chromium: CHROME_PATH first, else newest chromium-N under ms-playwright. */
function resolveChromePath(): string | undefined {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const browsersRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(browsersRoot)) return undefined;
  const dirs = fs
    .readdirSync(browsersRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^chromium-\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of dirs) {
    const exe = path.join(browsersRoot, dir, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const chromePath = resolveChromePath();

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'reports/html' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(chromePath ? { executablePath: chromePath } : {}),
      slowMo: 300,
    },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: process.env.SKIP_AUTH === '1' ? [] : ['setup'],
      testIgnore: /auth\.setup\.ts/,
      use: {
        storageState: process.env.SKIP_AUTH === '1' ? undefined : authFile,
      },
    },
  ],
  outputDir: 'reports/test-output',
  timeout: 120_000,
  webServer: {
    command: 'npx --yes serve demo -l 4173',
    url: 'http://127.0.0.1:4173/order.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

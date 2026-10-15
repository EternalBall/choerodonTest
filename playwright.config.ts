import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(root, 'playwright/.auth/user.json');
const baseURL = process.env.BASE_URL || 'https://example.com';
const chromePath =
  process.env.CHROME_PATH ||
  path.join(
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
      path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    'chromium-1243',
    'chrome-win64',
    'chrome.exe',
  );

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
      executablePath: chromePath,
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

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  projects: [
    { name: 'api', testMatch: '**/api/*.spec.ts' },
    { name: 'ui', testMatch: '**/ui/*.spec.ts', use: { browserName: 'chromium', headless: true } },
  ],
  fullyParallel: true,
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [['./tests/safe-reporter.ts']],
  preserveOutput: 'never',
  use: { trace: 'off', screenshot: 'off', video: 'off', launchOptions: { args: ['--disable-background-networking'] } },
});

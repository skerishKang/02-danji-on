import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-top-level-v3',
  testMatch: 'canonical-dialog-regression.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8766',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'python -m http.server 8766 --bind 127.0.0.1 --directory ../../../frontend',
    url: 'http://127.0.0.1:8766/01_이웃가게_발견.html',
    reuseExistingServer: true,
    timeout: 30_000
  }
});

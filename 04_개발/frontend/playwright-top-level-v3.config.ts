import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-top-level-v3',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory ../../frontend',
    url: 'http://127.0.0.1:4174/index.html',
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [{
    name: 'canonical-v3-chromium',
    use: { ...devices['Desktop Chrome'] }
  }]
});

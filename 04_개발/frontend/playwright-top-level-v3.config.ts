import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.DANJION_E2E_PORT || '4174';
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e-top-level-v3',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ../../frontend`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [{
    name: 'canonical-v3-chromium',
    use: { ...devices['Desktop Chrome'] }
  }]
});

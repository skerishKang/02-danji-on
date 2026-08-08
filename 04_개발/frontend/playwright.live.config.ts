import { defineConfig } from '@playwright/test';

const baseURL = process.env.DANJION_FRONTEND_PREVIEW_URL?.replace(/\/$/, '');

if (!baseURL) {
  throw new Error('BLOCKED_TRACK_B: DANJION_FRONTEND_PREVIEW_URL is required for live preview browser checks.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /live-release\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 1000 } }
    },
    {
      name: 'mobile-390',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'mobile-320',
      use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true }
    }
  ]
});

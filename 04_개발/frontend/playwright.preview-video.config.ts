import { defineConfig } from '@playwright/test';

const baseURL = process.env.PREVIEW_VIDEO_BASE_URL;
if (!baseURL) throw new Error('PREVIEW_VIDEO_BASE_URL is required');

export default defineConfig({
  testDir: './e2e-video',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'preview-video-results',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 }
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  }
});

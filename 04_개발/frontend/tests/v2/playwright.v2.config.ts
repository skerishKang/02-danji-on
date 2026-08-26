import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.DANJION_V2_TARGET_VARIANT || 'v2';
const ports: Record<string, number> = { v1: 4181, v2: 4182, gateway: 4183, invalid: 4184 };
const port = ports[target] || 4182;
const externalBase = target === 'v2'
  ? process.env.DANJION_V2_BASE_URL
  : target === 'gateway'
    ? process.env.DANJION_GATEWAY_BASE_URL
    : target === 'v1'
      ? process.env.DANJION_V1_BASE_URL
      : undefined;
const baseURL = externalBase?.replace(/\/$/, '') || `http://127.0.0.1:${port}`;

const testMatch = target === 'v2'
  ? /v2-(fidelity|product-flow|responsive-accessibility|visual-contrast|current-product-shell|react-completion)\.spec\.ts/
  : target === 'gateway'
    ? /v2-gateway-safety\.spec\.ts/
    : /v2-v1-safety\.spec\.ts/;

const allProjects = [
  { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
  { name: 'tablet-1024', use: { viewport: { width: 1024, height: 900 } } },
  { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: 'mobile-320', use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } }
];

export default defineConfig({
  testDir: path.resolve(configDir, '..'),
  testMatch,
  timeout: 40_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: path.resolve(configDir, `../../playwright-report/v2-${target}`) }]]
    : 'list',
  outputDir: path.resolve(configDir, `../../test-results/v2-${target}`),
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: target === 'v2' ? allProjects : [allProjects[0], allProjects[2]],
  ...(externalBase
    ? {}
    : {
        webServer: {
          command: `node "${path.resolve(configDir, '../../../scripts/v2-preview-server.mjs')}" --variant ${target} --port ${port}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 90_000
        }
      })
});
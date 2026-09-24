import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const maliciousNames = [
  '<img src=x onerror="window.__shopModalXss=true">',
  '<svg onload="window.__shopModalXss=true"></svg>',
  '" autofocus onfocus="window.__shopModalXss=true',
  '&lt;img src=x onerror="window.__shopModalXss=true"&gt;',
  '&amp;lt;svg onload="window.__shopModalXss=true"&amp;gt;',
];

const staticRoot = resolve(fileURLToPath(new URL('../../../frontend/', import.meta.url)));
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

test('neighbor shop detail modal XSS boundary renders business names as text without executable descendants', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const resourceErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) resourceErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.route('http://127.0.0.1:4173/**', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.startsWith('/api/')) return route.continue();
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = resolve(staticRoot, relativePath);
      if (!filePath.startsWith(staticRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
      }
      return route.fulfill({
        status: 200,
        contentType: contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
        body: readFileSync(filePath),
      });
    });
    await page.route('**/api/auth/get-session', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    }));

    // The canonical page is the top-level frontend static surface, not the
    // separate Vite app root used by the default e2e web server.
    const detailUrl = 'http://127.0.0.1:4173/02_이웃가게_상세.html';
    await page.goto(`${detailUrl}?shop=florist#reviews`);
    await expect(page.locator('[data-tab="reviews"]')).toBeVisible();
    await page.locator('[data-tab="reviews"]').click();
    await expect(page.locator('[data-shop-form="review"]')).toBeVisible();
    await expect(page.locator('[data-shop-form="inquiry"]')).toBeVisible();

    const safeName = '정상적인 이웃가게';
    for (const kind of ['review', 'inquiry'] as const) {
      await page.locator('.hero-copy h1').evaluate((node, value) => {
        node.textContent = value;
      }, safeName);
      await page.locator(`[data-shop-form="${kind}"]`).click();
      const safeHeading = page.locator('#shopFormBody [data-shop-name]');
      await expect(safeHeading).toHaveText(
        kind === 'review' ? `${safeName} 후기를 남겨주세요.` : `${safeName}에 문의하세요.`,
      );
      await expect(safeHeading.locator('*')).toHaveCount(0);
      await page.locator('#shopFormBody [data-sheet-close]').click();
    }

    for (const kind of ['review', 'inquiry'] as const) {
      for (const maliciousName of maliciousNames) {
        await page.locator('.hero-copy h1').evaluate((node, value) => {
          node.textContent = value;
        }, maliciousName);
        await page.locator(`[data-shop-form="${kind}"]`).click();

        const modalBody = page.locator('#shopFormBody');
        const nameNode = modalBody.locator('[data-shop-name]');
        await expect(nameNode).toHaveText(
          kind === 'review'
            ? `${maliciousName} 후기를 남겨주세요.`
            : `${maliciousName}에 문의하세요.`,
        );
        await expect(nameNode.locator('*')).toHaveCount(0);
        await expect(page.locator(kind === 'review' ? '#shopReviewForm' : '#shopInquiryForm')).toBeVisible();
        expect(await page.evaluate(() => Boolean((window as Window & { __shopModalXss?: boolean }).__shopModalXss))).toBe(false);

        await modalBody.locator('[data-sheet-close]').click();
        await expect(page.locator('#shopFormLayer')).not.toHaveClass(/open/);
      }
    }

    expect(pageErrors).toEqual([]);
    expect(resourceErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});

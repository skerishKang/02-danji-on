import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('resident news stays separate from public news and supports list, detail, submission, and status', async ({ page }) => {
  const publicEntry = page.locator('[data-v2-complex-news-entry]');
  const residentEntry = page.locator('[data-v2-resident-news-entry]');
  await expect(publicEntry).toBeVisible();
  await expect(publicEntry).toContainText('단지 공식소식');
  await expect(residentEntry).toBeVisible();
  await expect(residentEntry).toContainText('주민소식 · 주민 전용');

  await residentEntry.getByRole('button', { name: '주민소식 보기' }).click();
  const dialog = page.locator('[data-v2-resident-news-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('주민확인 완료 계정에만 표시됩니다.');

  const first = dialog.locator('[data-v2-resident-news-item]').first();
  await expect(first).toContainText('우리 단지 산책길 정비 소식');
  await first.getByRole('button', { name: '내용 보기' }).click();

  const detail = dialog.locator('[data-v2-resident-news-detail]');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('주민 제보를 운영 확인한 뒤 게시한 주민소식 예시입니다.');
  await expect(detail).not.toContainText(/동\s*·?\s*호|호수|세대코드|object[_-]?key|provider/i);

  await dialog.getByRole('button', { name: '제보하기' }).click();
  const form = dialog.locator('[data-v2-resident-news-form]');
  await expect(form).toBeVisible();

  const title = `QA 주민소식 ${Date.now()}`;
  await form.getByLabel('제목').fill(title);
  await form.getByLabel('내용').fill('주민소식 제보와 운영 확인 전 비공개 상태를 검증합니다.');
  await form.getByRole('button', { name: '제보 접수' }).click();

  const submissions = dialog.locator('[data-v2-resident-news-submissions]');
  await expect(submissions).toBeVisible();
  const created = submissions.locator('[data-v2-resident-news-submission]').filter({ hasText: title });
  await expect(created).toContainText('접수됨');
  await expect(created).not.toContainText('주민소식 제보와 운영 확인 전 비공개 상태를 검증합니다.');
  await expect(dialog.locator('[data-v2-resident-news-status]')).toContainText('제보가 접수되었습니다. 운영 확인 후 게시될 수 있습니다.');
});

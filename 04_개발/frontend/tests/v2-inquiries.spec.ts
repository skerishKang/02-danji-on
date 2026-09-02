import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn inquiry center creates an inquiry and closes an answered inquiry', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.getByRole('dialog');
  const panel = profile.locator('[data-v2-inquiries-panel]');
  await expect(panel).toBeVisible();

  const answered = panel.locator('[data-v2-inquiry-item]').filter({ hasText: '공용시설 이용 문의' });
  await answered.getByRole('button', { name: '내용 보기' }).click();
  let dialog = page.locator('[data-v2-inquiry-dialog]');
  await expect(dialog).toContainText('관리사무소 안내시간을 확인해 주세요.');
  await dialog.getByRole('button', { name: '답변 확인 후 종료' }).click();
  await expect(dialog).toContainText('종료');
  await dialog.getByRole('button', { name: '닫기' }).click();

  const title = `QA 문의 ${Date.now()}`;
  await panel.getByLabel('문의 유형').fill('생활문의');
  await panel.getByLabel('제목').fill(title);
  await panel.getByLabel('내용').fill('QA 문의센터 연결 확인입니다.');
  await panel.getByRole('button', { name: '문의 접수' }).click();

  dialog = page.locator('[data-v2-inquiry-dialog]');
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  await expect(dialog).toContainText('QA 문의센터 연결 확인입니다.');
  await expect(dialog).toContainText('아직 등록된 답변이 없습니다.');
});

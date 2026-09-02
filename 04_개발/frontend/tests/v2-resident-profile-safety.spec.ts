import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn edits the safe self public profile without residence identifiers', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.getByRole('dialog');
  const selfPanel = profile.locator('[data-v2-self-profile-panel]');

  await expect(selfPanel).toBeVisible();
  await expect(selfPanel.getByRole('heading', { name: '공개프로필' })).toBeVisible();
  const nickname = selfPanel.getByLabel('닉네임');
  const bio = selfPanel.getByLabel('공개 소개');
  await nickname.fill('단지온 QA 주민');
  await bio.fill('이웃과 생활정보를 나눕니다.');
  await selfPanel.getByRole('button', { name: '프로필 저장' }).click();
  await expect(selfPanel).toContainText('공개프로필을 저장했습니다.');
  await expect(selfPanel).not.toContainText(/동\s*·?\s*호|호수|세대코드/);
});

test('known message participant opens safe resident profile, reports and reuses canonical conversation', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const myDialog = page.getByRole('dialog');
  const inbox = myDialog.locator('[data-v2-messages-panel]');
  const conversation = inbox.locator('[data-v2-conversation-item]').filter({ hasText: '이웃 주민' });

  await conversation.getByRole('button', { name: '프로필 보기' }).click();
  const resident = page.locator('[data-v2-resident-profile-dialog]');
  await expect(resident).toBeVisible();
  await expect(resident.getByRole('heading', { name: '이웃 주민' })).toBeVisible();
  await expect(resident).toContainText('인증 주민');
  await expect(resident).not.toContainText(/동\s*·?\s*호|호수|세대코드/);

  await resident.getByLabel('신고 사유').selectOption('spam');
  await resident.getByLabel('설명(선택)').fill('QA 신고 경로 확인');
  await resident.getByRole('button', { name: '신고 접수' }).click();
  await expect(resident).toContainText('신고가 접수되었습니다.');

  await resident.getByRole('button', { name: '메시지 보내기' }).click();
  const messageDialog = page.locator('[data-v2-conversation-dialog]');
  await expect(messageDialog).toBeVisible();
  await expect(messageDialog.getByRole('heading', { name: '이웃 주민님과의 대화' })).toBeVisible();
});

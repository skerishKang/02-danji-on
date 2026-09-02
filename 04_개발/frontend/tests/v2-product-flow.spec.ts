import { expect, test } from '@playwright/test';
import { V2_REFERENCE } from './v2/reference-contract';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('search, relation/category filtering and detail preserve the reference discovery contract', async ({ page }) => {
  const search = page.getByPlaceholder(new RegExp(V2_REFERENCE.copy.heroSearchPlaceholder));
  await search.fill('에어컨');
  await page.getByRole('button', { name: /^(찾기|검색하기)$/ }).first().click();

  const serviceName = page.getByText('온케어 홈서비스', { exact: true }).first();
  await expect(serviceName).toBeVisible();
  const card = page.locator('article').filter({ hasText: '온케어 홈서비스' }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^(상세보기|보기)$/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '온케어 홈서비스' })).toBeVisible();
  await expect(dialog).toContainText('현재 단지 주민 가족 운영');
  await expect(dialog).toContainText('에어컨 1대 7만원부터');
  await expect(dialog).toContainText('방림명지로드힐 출장비 면제');
  await expect(dialog.getByRole('button', { name: '문의 방법 보기' })).toBeVisible();
  await dialog.getByRole('button', { name: '닫기' }).click();

  const category = page.getByRole('button', { name: '집을 돌보는 일', exact: true });
  await category.click();
  await expect(category).toHaveAttribute('aria-pressed', 'true');

  const relation = page.getByRole('button', { name: '주민 가족', exact: true });
  await relation.click();
  await expect(relation).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('온케어 홈서비스', { exact: true }).first()).toBeVisible();
});

test('resident benefit moves from claim to stored code to used state', async ({ page }) => {
  const benefits = page.locator('[data-v2-section="benefits"]').first();
  const benefitHeading = benefits.getByRole('heading', { name: V2_REFERENCE.copy.benefitHeading });
  await benefitHeading.scrollIntoViewIfNeeded();
  await expect(benefitHeading).toBeVisible();

  const claim = benefits.getByRole('button', { name: '주민혜택 받기' }).first();
  await expect(claim).toBeVisible();
  await claim.click();

  await expect(page.getByText(/DANJION-[A-Z0-9]{4,8}/).first()).toBeVisible();
  await expect(page.getByText(/보관 중/).first()).toBeVisible();

  await page.getByRole('button', { name: '내정보' }).first().click();
  const myDialog = page.getByRole('dialog');
  await expect(myDialog).toBeVisible();
  await expect(myDialog.getByText(/DANJION-[A-Z0-9]{4,8}/).first()).toBeVisible();
  const use = myDialog.getByRole('button', { name: '사용 완료 처리' }).first();
  await use.click();
  await expect(myDialog.getByText('사용 완료', { exact: true }).first()).toBeVisible();
});

test('My DanjiOn lazy-loads resident Activity without replacing existing benefits', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const myDialog = page.getByRole('dialog');
  await expect(myDialog).toBeVisible();
  await expect(myDialog.getByRole('heading', { name: '내 주민혜택' })).toBeVisible();
  await expect(myDialog.getByRole('heading', { name: '나의 활동' })).toBeVisible();

  const activity = myDialog.locator('[data-v2-profile-activity]');
  await expect(activity).toBeVisible();
  await expect(activity.locator('article')).toHaveCount(5);
  await expect(activity).toContainText('후기');
  await expect(activity).toContainText('오늘의 반찬');
  await expect(activity).toContainText('공감');
  await expect(activity).toContainText('댓글');
  await expect(activity).toContainText('답글');
  await expect(activity).toContainText('게시글');
});

test('resident-owned registration -> promo -> operator approval -> rediscovery closes the V2 reference loop', async ({ page }) => {
  const uniqueName = `QA 한결수학 ${Date.now()}`;
  await page.getByRole('button', { name: V2_REFERENCE.registration.ownerTrigger, exact: true }).first().click();
  const registration = page.getByRole('dialog');
  await expect(registration).toBeVisible();
  await expect(registration.getByText('STEP 1 / 4')).toBeVisible();
  await expect(registration.getByRole('heading', { name: V2_REFERENCE.registration.steps[0] })).toBeVisible();

  await registration.getByText(V2_REFERENCE.registration.ownerRelation, { exact: true }).click();
  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByText('STEP 2 / 4')).toBeVisible();
  await registration.getByLabel('이름 또는 가게명').fill(uniqueName);
  await registration.getByLabel('무슨 일을 하나요?').fill('중·고등학생 수학 과외');
  await registration.getByLabel('가격 또는 상담 기준').fill('중학생 월 32만원 · 고등학생 상담');
  await registration.getByLabel('이용 지역과 방식').fill('방림명지로드힐 생활권 · 방문/비대면 가능');
  await registration.getByLabel('문의 방식').fill('문자 문의 · QA 시연용');

  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByText('STEP 3 / 4')).toBeVisible();
  await registration.getByLabel('입주민 혜택').fill('방림명지로드힐 학생 첫 수업 무료');

  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByText('STEP 4 / 4')).toBeVisible();
  await expect(registration.getByText(uniqueName, { exact: true }).first()).toBeVisible();
  await registration.getByRole('button', { name: /^(등록 검토 요청|등록 신청 완료)$/ }).click();

  await page.getByRole('heading', { name: V2_REFERENCE.copy.promoHeading }).scrollIntoViewIfNeeded();
  const createPromo = page.getByRole('button', { name: '홍보물 만들기' });
  await expect(createPromo).toBeEnabled();
  await createPromo.click();
  for (const label of V2_REFERENCE.registration.promoOutputs) await expect(page.getByText(label, { exact: true })).toBeVisible();

  const operatorButton = page.getByRole('button', { name: '운영확인으로 이동' });
  await expect(operatorButton).toBeEnabled();
  await operatorButton.click();
  const operator = page.getByRole('dialog');
  await expect(operator.getByText(V2_REFERENCE.registration.operatorPublic, { exact: true })).toBeVisible();
  await expect(operator.getByText(V2_REFERENCE.registration.operatorPrivate, { exact: true })).toBeVisible();
  await expect(operator).toContainText(uniqueName);
  await operator.getByRole('button', { name: '승인하여 공개' }).click();

  const rediscovered = page.getByText(uniqueName, { exact: true }).first();
  await expect(rediscovered).toBeVisible();
});

test('non-owner recommendation never enters owner-only price/contact/image/promo flow', async ({ page }) => {
  const uniqueName = `QA 추천가게 ${Date.now()}`;
  await page.getByRole('button', { name: V2_REFERENCE.registration.ownerTrigger, exact: true }).first().click();
  const registration = page.getByRole('dialog');
  await expect(registration).toBeVisible();

  await registration.getByText(V2_REFERENCE.registration.recommendationRelation, { exact: true }).click();
  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByRole('heading', { name: '추천할 가게 정보를 알려주세요' })).toBeVisible();
  await registration.getByLabel('이름 또는 가게명').fill(uniqueName);
  await registration.getByLabel('무슨 일을 하나요?').fill('동네 자전거 수리');
  await registration.getByLabel('이용 지역과 방식').fill('방림동 방문 가능');
  await expect(registration.getByLabel('가격 또는 상담 기준')).toHaveCount(0);
  await expect(registration.getByLabel('문의 방식')).toHaveCount(0);

  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByRole('heading', { name: '추천 범위를 확인하세요' })).toBeVisible();
  await expect(registration.getByLabel('대표 이미지')).toHaveCount(0);
  await expect(registration.getByLabel('입주민 혜택')).toHaveCount(0);
  await expect(registration).toContainText('추천은 소유자 등록이 아닙니다.');

  await registration.getByRole('button', { name: /^다음(?: 단계)?$/ }).click();
  await expect(registration.getByRole('heading', { name: '이웃가게 추천을 확인하세요' })).toBeVisible();
  await expect(registration).toContainText('추천자는 가게 운영자나 소유자로 등록되지 않습니다.');
  await registration.getByRole('button', { name: V2_REFERENCE.registration.recommendationSubmit }).click();

  await expect(page.getByText('이웃가게 추천이 접수되었습니다. 운영 확인 후 공개 목록에 반영됩니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '홍보물 만들기' })).toBeDisabled();
});

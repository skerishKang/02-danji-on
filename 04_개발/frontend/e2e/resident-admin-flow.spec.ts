import { expect, test } from '@playwright/test';

const APPLICATION_STORE_KEY = 'danjion.mock.business-applications.v1';
const AUDIT_STORE_KEY = 'danjion.mock.application-review-events.v1';
const POSTS_STORE_KEY = 'danjion.mock.posts.v1';
const BENEFITS_STORE_KEY = 'danjion.mock.benefits.v1';

async function resetMockStore(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(([applications, audit, posts, benefits]) => {
    window.localStorage.removeItem(applications);
    window.localStorage.removeItem(audit);
    window.localStorage.removeItem(posts);
    window.localStorage.removeItem(benefits);
  }, [APPLICATION_STORE_KEY, AUDIT_STORE_KEY, POSTS_STORE_KEY, BENEFITS_STORE_KEY]);
  await page.reload();
}

async function advanceRegistration(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '다음 단계' }).click();
}

test('resident can search, bookmark and reveal verified contact', async ({ page }) => {
  await resetMockStore(page);

  await page.locator('#home-search').fill('에어컨');
  await page.getByRole('button', { name: '검색하기' }).click();

  const card = page.locator('.service-card').filter({ hasText: '온케어 에어컨 청소' });
  await expect(card).toBeVisible();
  await card.locator('.service-copy').click();

  await expect(page.getByRole('heading', { name: '온케어 에어컨 청소' })).toBeVisible();
  await page.getByRole('button', { name: '♡ 찜하기' }).click();
  await expect(page.getByRole('button', { name: '♥ 찜한 가게' })).toBeVisible();

  await page.getByRole('button', { name: '문의 방법 보기' }).click();
  await expect(page.getByText('010-0000-1003')).toBeVisible();
});

test('resident can edit and resubmit a changes-requested application with audit history', async ({ page }) => {
  await resetMockStore(page);
  await page.getByRole('button', { name: '내정보' }).first().click();

  const item = page.locator('.application-item').filter({ hasText: '맑은창 방충망 수리' });
  await expect(item.locator('.application-status.changes_requested')).toHaveText('보완 요청');
  await item.getByRole('button', { name: '보완하기' }).click();

  await expect(page.getByRole('heading', { name: '요청된 내용을 보완해 주세요' })).toBeVisible();
  await expect(page.getByText('서비스 가능 지역을 구체적으로 적어주세요.')).toBeVisible();

  await advanceRegistration(page);
  await expect(page.getByLabel('가게·서비스명 *')).toHaveValue('맑은창 방충망 수리');
  await page.getByLabel('이용 지역').fill('광주 남구 및 동구 방문 가능');

  await advanceRegistration(page);
  await advanceRegistration(page);
  await expect(page.getByText('광주 남구 및 동구 방문 가능')).toBeVisible();
  await page.getByRole('button', { name: '보완 내용 재제출' }).click();

  const resubmitted = page.locator('.application-item').filter({ hasText: '맑은창 방충망 수리' });
  await expect(resubmitted.locator('.application-status.pending')).toHaveText('확인 대기');

  await page.goto('/admin.html');
  const adminCard = page.locator('.admin-application-card').filter({ hasText: '맑은창 방충망 수리' });
  await expect(adminCard.locator('.admin-status.pending')).toHaveText('확인 대기');
  await expect(adminCard).toContainText('광주 남구 및 동구 방문 가능');

  await page.getByRole('button', { name: '검토 이력' }).click();
  const auditEvents = page.locator('.audit-event').filter({ hasText: '맑은창 방충망 수리' });
  await expect(auditEvents).toHaveCount(2);
  await expect(auditEvents.first()).toContainText('신청자');
  await expect(auditEvents.first()).toContainText('보완 요청');
  await expect(auditEvents.first()).toContainText('확인 대기');
});

test('resident submission with image becomes public after admin approval', async ({ page }) => {
  await resetMockStore(page);
  const businessName = `E2E 홈케어 ${Date.now()}`;

  await page.getByRole('button', { name: /내 일 알리기/ }).click();
  await expect(page.getByText('STEP 1 / 4')).toBeVisible();
  await advanceRegistration(page);

  await page.getByLabel('가게·서비스명 *').fill(businessName);
  await page.getByLabel('분야 *').fill('청소·수리·에어컨 서비스');
  await page.getByLabel('한 줄 소개 *').fill('E2E에서 생성한 방문형 생활 수리 서비스입니다.');
  await page.getByLabel('가격').fill('기본 출장 30,000원');
  await advanceRegistration(page);

  await page.getByLabel('입주민 혜택').fill('첫 방문 5,000원 할인');
  await page.locator('.image-picker input[type="file"]').setInputFiles({
    name: 'e2e-representative.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.locator('.image-preview img')).toBeVisible();
  await expect(page.getByText(/e2e-representative\.png/)).toBeVisible();
  await advanceRegistration(page);

  await expect(page.getByText('주민에게 공개')).toBeVisible();
  await expect(page.getByText('운영 확인 · 일반 공개 안 함')).toBeVisible();
  await expect(page.getByRole('heading', { name: businessName })).toBeVisible();
  await page.getByRole('button', { name: '등록 신청 완료' }).click();

  const residentItem = page.locator('.application-item').filter({ hasText: businessName });
  await expect(residentItem).toBeVisible();
  await expect(residentItem.locator('.application-status.pending')).toHaveText('확인 대기');

  await page.goto('/admin.html');
  const adminCard = page.locator('.admin-application-card').filter({ hasText: businessName });
  await expect(adminCard).toBeVisible();
  await adminCard.getByRole('button', { name: '승인' }).click();
  await expect(adminCard.locator('.admin-status.approved')).toHaveText('승인');

  await page.getByRole('button', { name: '검토 이력' }).click();
  const approvalEvent = page.locator('.audit-event').filter({ hasText: businessName }).first();
  await expect(approvalEvent).toContainText('관리자');
  await expect(approvalEvent).toContainText('확인 대기');
  await expect(approvalEvent).toContainText('승인');

  await page.goto('/');
  await page.getByRole('button', { name: '내정보' }).first().click();
  const approvedItem = page.locator('.application-item').filter({ hasText: businessName });
  await expect(approvedItem).toBeVisible();
  await expect(approvedItem.locator('.application-status.approved')).toHaveText('승인 완료');

  await page.goto('/');
  await page.locator('#home-search').fill(businessName);
  await page.getByRole('button', { name: '검색하기' }).click();
  const publicCard = page.locator('.service-card').filter({ hasText: businessName });
  await expect(publicCard).toBeVisible();
  await expect(publicCard).toContainText('첫 방문 5,000원 할인');
});

test('operations-created news and benefit are visible in resident app', async ({ page }) => {
  await resetMockStore(page);
  await page.goto('/admin.html');

  await page.getByRole('button', { name: '단지소식' }).click();
  await page.getByLabel('제목').fill('E2E 단지소식');
  await page.getByLabel('내용').fill('인프라 연결 전 운영화면 검증을 위한 테스트 소식입니다.');
  await page.getByRole('button', { name: '단지소식 게시' }).click();
  await expect(page.getByText('단지소식을 게시했습니다.')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: '단지소식' }).first().click();
  await expect(page.getByRole('heading', { name: 'E2E 단지소식' })).toBeVisible();
  await expect(page.getByText('인프라 연결 전 운영화면 검증을 위한 테스트 소식입니다.')).toBeVisible();

  await page.goto('/admin.html');
  await page.getByRole('button', { name: '주민혜택' }).click();
  await page.getByLabel('대상 가게·서비스').selectOption('v5-1');
  await page.getByLabel('혜택 제목').fill('E2E 주민혜택');
  await page.getByLabel('설명').fill('통합 검증용 혜택입니다.');
  await page.getByRole('button', { name: '주민혜택 등록' }).click();
  await expect(page.getByText('주민혜택을 등록했습니다.')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: '주민혜택' }).first().click();
  await expect(page.getByText('E2E 주민혜택')).toBeVisible();
  await expect(page.getByText('통합 검증용 혜택입니다.')).toBeVisible();
});

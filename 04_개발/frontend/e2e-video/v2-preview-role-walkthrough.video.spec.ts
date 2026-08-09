import { expect, test, type Locator, type Page } from '@playwright/test';

const businessName = process.env.PREVIEW_VIDEO_BUSINESS_NAME || '해봄 독서교실';

async function pause(page: Page, ms = 1800) {
  await page.waitForTimeout(ms);
}

async function centerAndClick(locator: Locator) {
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await locator.click();
}

async function showCaption(page: Page, title: string, detail: string) {
  await page.evaluate(({ title, detail }) => {
    document.getElementById('danjion-video-caption')?.remove();
    const caption = document.createElement('div');
    caption.id = 'danjion-video-caption';
    caption.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
    Object.assign(caption.style, {
      position: 'fixed',
      left: '28px',
      top: '24px',
      zIndex: '2147483647',
      maxWidth: '620px',
      padding: '18px 22px',
      borderRadius: '16px',
      background: 'rgba(8, 8, 10, 0.93)',
      color: '#fff',
      boxShadow: '0 14px 40px rgba(0,0,0,.3)',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none'
    });
    const strong = caption.querySelector('strong') as HTMLElement;
    const span = caption.querySelector('span') as HTMLElement;
    Object.assign(strong.style, { display: 'block', fontSize: '23px', marginBottom: '7px' });
    Object.assign(span.style, { display: 'block', fontSize: '15px', lineHeight: '1.65', opacity: '.9', whiteSpace: 'pre-line' });
    document.body.appendChild(caption);
  }, { title, detail });
}

async function clearCaption(page: Page) {
  await page.evaluate(() => document.getElementById('danjion-video-caption')?.remove());
}

function roleSelector(page: Page) {
  return page.getByRole('combobox', { name: '시연 역할' });
}

function roleTrigger(page: Page) {
  return page.getByRole('button', { name: /권한 보기|권한표 닫기/ });
}

function registrationButton(page: Page) {
  return page.locator('#v2-registration').getByRole('button', { name: '내 일 알리기' });
}

async function switchRole(page: Page, role: 'anonymous' | 'unverified' | 'resident' | 'manager') {
  if (!(await roleSelector(page).isVisible().catch(() => false))) {
    await roleTrigger(page).click();
  }
  await roleSelector(page).selectOption(role);
  await expect(roleSelector(page)).toHaveValue(role);
  if (await page.getByRole('button', { name: '권한표 닫기' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '권한표 닫기' }).click();
  }
  await pause(page, role === 'anonymous' || role === 'unverified' ? 2100 : 1200);
}

async function openFirstShop(page: Page) {
  await page.locator('#v2-discovery').scrollIntoViewIfNeeded();
  await pause(page, 1000);
  const firstCard = page.locator('.v2-integrated-shop-card').first();
  await expect(firstCard).toBeVisible();
  await centerAndClick(firstCard.getByRole('button', { name: '상세보기' }));
  await expect(page.getByRole('dialog')).toBeVisible();
  await pause(page, 900);
}

async function closeDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await centerAndClick(dialog.getByRole('button', { name: '닫기' }));
    await expect(dialog).toBeHidden();
  }
}

async function dismissToast(page: Page) {
  const toast = page.locator('.v2-integration-toast');
  if (await toast.isVisible().catch(() => false)) {
    await pause(page, 1500);
    await centerAndClick(toast);
  }
}

test('권한이 적은 순서로 실제 기능을 클릭해 본다', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('click', (event) => {
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        position: 'fixed',
        left: `${event.clientX - 18}px`,
        top: `${event.clientY - 18}px`,
        width: '36px',
        height: '36px',
        border: '4px solid #ff5b45',
        borderRadius: '999px',
        zIndex: '2147483646',
        pointerEvents: 'none',
        opacity: '1',
        transform: 'scale(.45)',
        transition: 'transform .45s ease, opacity .45s ease'
      });
      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = 'scale(1.45)';
        ring.style.opacity = '0';
      });
      setTimeout(() => ring.remove(), 550);
    }, true);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(roleTrigger(page)).toBeVisible();

  await showCaption(page, '단지온 사용자 권한 살펴보기', '일반 방문자 → 미인증 주민 → 인증 입주민 → 운영자 순서로, 권한이 늘어날 때 실제 화면에서 무엇이 달라지는지 확인합니다.');
  await pause(page, 4800);
  await clearCaption(page);

  await switchRole(page, 'anonymous');
  await showCaption(page, '1 / 4 · 일반 방문자', '✓ 이웃가게와 서비스 탐색\n✕ 주민 전용 문의처 · 주민혜택 · 내 일 등록 · 운영 승인');
  await pause(page, 3800);
  await clearCaption(page);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-integration-toast')).toBeVisible();
  await showCaption(page, '문의처는 아직 볼 수 없습니다', '일반 방문자는 공개 정보까지만 볼 수 있습니다. 주민 전용 연락처는 입주민 인증 뒤에 열립니다.');
  await pause(page, 3200);
  await clearCaption(page);
  await dismissToast(page);
  await closeDialog(page);

  await switchRole(page, 'unverified');
  await showCaption(page, '2 / 4 · 미인증 주민', '✓ 공개 탐색 · 내 일 알리기\n✕ 주민 전용 문의처 · 주민혜택 · 운영 승인');
  await pause(page, 3800);
  await clearCaption(page);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-integration-toast')).toBeVisible();
  await showCaption(page, '주민이지만 인증 전입니다', '내 일을 등록할 수는 있지만, 주민 전용 연락처와 혜택은 입주민 인증을 마쳐야 이용할 수 있습니다.');
  await pause(page, 3400);
  await clearCaption(page);
  await dismissToast(page);
  await closeDialog(page);

  await page.locator('#v2-benefits').scrollIntoViewIfNeeded();
  await pause(page, 900);
  const unverifiedBenefit = page.getByRole('button', { name: '주민혜택 받기' });
  if (await unverifiedBenefit.isVisible().catch(() => false)) {
    await centerAndClick(unverifiedBenefit);
    await expect(page.locator('.v2-integration-toast')).toBeVisible();
    await pause(page, 2200);
    await dismissToast(page);
  }

  await page.locator('#v2-registration').scrollIntoViewIfNeeded();
  await pause(page, 800);
  await centerAndClick(registrationButton(page));
  await expect(page.getByRole('dialog')).toContainText('등록 1 / 4');
  await showCaption(page, '달라진 권한 · 내 일 알리기 가능', '미인증 주민도 자신의 가게나 서비스를 등록 신청할 수 있습니다. 주민혜택과 문의처 공개 권한은 별도로 관리됩니다.');
  await pause(page, 3400);
  await clearCaption(page);
  await closeDialog(page);

  await switchRole(page, 'resident');
  await showCaption(page, '3 / 4 · 인증 입주민', '✓ 공개 탐색 · 문의처 · 주민혜택 · 내 일 알리기\n✕ 운영 승인');
  await pause(page, 4000);
  await clearCaption(page);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-contact-list')).toBeVisible();
  await showCaption(page, '인증 후 문의처가 열립니다', '이제 주민 전용 문의 방법을 확인할 수 있습니다. 공개 정보와 주민 전용 정보가 분리되어 있습니다.');
  await pause(page, 3200);
  await clearCaption(page);
  await closeDialog(page);

  await page.locator('#v2-benefits').scrollIntoViewIfNeeded();
  await pause(page, 900);
  const claimButton = page.getByRole('button', { name: '주민혜택 받기' });
  const profileButton = page.getByRole('button', { name: '내정보에서 확인' });
  if (await claimButton.isVisible().catch(() => false)) {
    await centerAndClick(claimButton);
    await showCaption(page, '주민혜택도 사용할 수 있습니다', '받은 혜택은 내정보에서 다시 확인하고, 실제 이용 뒤 사용 완료 상태로 관리할 수 있습니다.');
    await pause(page, 3200);
    await clearCaption(page);
  } else if (await profileButton.isVisible().catch(() => false)) {
    await centerAndClick(profileButton);
    await expect(page.getByRole('dialog')).toContainText('내 주민혜택');
    await pause(page, 2200);
    await closeDialog(page);
  }

  await page.locator('#v2-registration').scrollIntoViewIfNeeded();
  await centerAndClick(registrationButton(page));
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('등록 1 / 4');
  await pause(page, 900);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await dialog.getByLabel('이름 또는 가게명').fill(businessName);
  await dialog.getByLabel('무슨 일을 하나요?').fill('초등학생이 책을 즐겁게 읽고 생각을 글로 표현하도록 돕는 소규모 독서 수업');
  await dialog.getByLabel('가격 또는 상담 기준').fill('주 1회 월 12만원');
  await dialog.getByLabel('이용 지역과 방식').fill('방림명지로드힐 커뮤니티 공간 · 소그룹 수업');
  await dialog.getByLabel('문의 방식').fill('카카오톡 상담');
  await pause(page, 1000);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await dialog.getByLabel('입주민 혜택').fill('입주민 첫 수업 무료');
  await pause(page, 900);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await pause(page, 1400);
  await centerAndClick(dialog.getByRole('button', { name: '등록 검토 요청' }));
  await expect(dialog).toBeHidden();
  await page.locator('#v2-promo').scrollIntoViewIfNeeded();
  await expect(page.getByText(businessName, { exact: true }).first()).toBeVisible();
  await centerAndClick(page.getByRole('button', { name: '홍보물 만들기' }));
  await showCaption(page, '입력한 정보가 바로 홍보물로', '가게소개 카드, 공유 이미지, 게시판 포스터 형태로 정리됩니다. 이제 운영자가 내용을 확인합니다.');
  await pause(page, 3600);
  await clearCaption(page);

  await switchRole(page, 'manager');
  await showCaption(page, '4 / 4 · 운영자', '✓ 공개 탐색 · 문의처 · 주민혜택 · 내 일 등록 · 운영 승인\n입주민이 올린 신청을 확인하고 공개 여부를 결정합니다.');
  await pause(page, 4300);
  await clearCaption(page);
  await centerAndClick(page.getByRole('button', { name: '운영확인으로 이동' }));
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('운영확인');
  await pause(page, 2200);
  await centerAndClick(dialog.getByRole('button', { name: '승인하여 공개' }));
  await expect(dialog).toBeHidden();
  await expect(page.locator('.v2-integration-toast')).toContainText('승인 완료');
  await showCaption(page, '운영자 승인 완료', '승인된 가게와 서비스는 공개 탐색 목록에 반영됩니다. 신청부터 공개까지 한 흐름으로 이어집니다.');
  await pause(page, 3400);
  await clearCaption(page);
  await dismissToast(page);

  await page.locator('#v2-discovery').scrollIntoViewIfNeeded();
  const search = page.getByPlaceholder('가게 이름이나 필요한 일로 다시 검색');
  await search.fill(businessName);
  await expect(page.locator('.v2-integrated-shop-card')).toHaveCount(1);
  await expect(page.getByText(businessName, { exact: true }).first()).toBeVisible();
  await showCaption(page, '완료 · 다시 이웃에게 발견됩니다', '인증 입주민의 등록 → 홍보물 구성 → 운영자 승인 → 공개 탐색 노출까지 단지온의 전체 흐름을 확인했습니다.');
  await pause(page, 5200);
});

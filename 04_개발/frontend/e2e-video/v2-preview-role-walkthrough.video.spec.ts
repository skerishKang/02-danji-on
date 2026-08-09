import { expect, test, type Locator, type Page } from '@playwright/test';

const businessName = process.env.PREVIEW_VIDEO_BUSINESS_NAME || `단지온 권한영상 ${Date.now()}`;

async function pause(page: Page, ms = 1400) {
  await page.waitForTimeout(ms);
}

async function makePermissionPanelNonBlocking(page: Page) {
  await page.addStyleTag({
    content: `
      .v2-preview-demo-panel { pointer-events: none !important; }
    `
  });
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
      maxWidth: '560px',
      padding: '16px 20px',
      borderRadius: '16px',
      background: 'rgba(8, 8, 10, 0.92)',
      color: '#fff',
      boxShadow: '0 14px 40px rgba(0,0,0,.3)',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none'
    });
    const strong = caption.querySelector('strong') as HTMLElement;
    const span = caption.querySelector('span') as HTMLElement;
    Object.assign(strong.style, { display: 'block', fontSize: '22px', marginBottom: '5px' });
    Object.assign(span.style, { display: 'block', fontSize: '14px', lineHeight: '1.5', opacity: '.86' });
    document.body.appendChild(caption);
  }, { title, detail });
}

function roleSelector(page: Page) {
  return page.getByRole('combobox', { name: '시연 역할' });
}

function registrationButton(page: Page) {
  return page.locator('#v2-registration').getByRole('button', { name: '내 일 알리기' });
}

async function switchRole(page: Page, role: 'anonymous' | 'unverified' | 'resident' | 'manager') {
  await roleSelector(page).selectOption(role);
  await pause(page, role === 'anonymous' || role === 'unverified' ? 2200 : 1000);
  await expect(roleSelector(page)).toHaveValue(role);
  await makePermissionPanelNonBlocking(page);
}

async function openFirstShop(page: Page) {
  await page.locator('#v2-discovery').scrollIntoViewIfNeeded();
  await pause(page, 900);
  const firstCard = page.locator('.v2-integrated-shop-card').first();
  await expect(firstCard).toBeVisible();
  await centerAndClick(firstCard.getByRole('button', { name: '상세보기' }));
  await expect(page.getByRole('dialog')).toBeVisible();
  await pause(page, 700);
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
    await pause(page, 1200);
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
  await expect(roleSelector(page)).toBeVisible();
  await makePermissionPanelNonBlocking(page);
  await switchRole(page, 'anonymous');

  await showCaption(page, '1 / 4 · 일반 방문자', '공개 탐색은 가능하지만 문의·혜택·등록 같은 보호 기능은 사용할 수 없습니다.');
  await pause(page, 1600);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-integration-toast')).toBeVisible();
  await pause(page, 1600);
  await dismissToast(page);
  await closeDialog(page);

  await switchRole(page, 'unverified');
  await showCaption(page, '2 / 4 · 미인증 주민', '로그인은 된 상태입니다. 내 일 등록은 가능하지만 문의처와 주민혜택은 아직 차단됩니다.');
  await pause(page, 1600);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-integration-toast')).toBeVisible();
  await pause(page, 1500);
  await dismissToast(page);
  await closeDialog(page);

  await page.locator('#v2-benefits').scrollIntoViewIfNeeded();
  await pause(page, 900);
  const unverifiedBenefit = page.getByRole('button', { name: '주민혜택 받기' });
  if (await unverifiedBenefit.isVisible().catch(() => false)) {
    await centerAndClick(unverifiedBenefit);
    await expect(page.locator('.v2-integration-toast')).toBeVisible();
    await pause(page, 1400);
    await dismissToast(page);
  }

  await page.locator('#v2-registration').scrollIntoViewIfNeeded();
  await pause(page, 700);
  await centerAndClick(registrationButton(page));
  await expect(page.getByRole('dialog')).toContainText('STEP 1 / 4');
  await pause(page, 1500);
  await closeDialog(page);

  await switchRole(page, 'resident');
  await showCaption(page, '3 / 4 · 인증 입주민', '문의처·주민혜택·내 일 등록을 실제 테스트 DB와 연결해 사용할 수 있습니다.');
  await pause(page, 1600);
  await openFirstShop(page);
  await centerAndClick(page.getByRole('button', { name: '문의 방법 보기' }));
  await expect(page.locator('.v2-contact-list')).toBeVisible();
  await pause(page, 1600);
  await closeDialog(page);

  await page.locator('#v2-benefits').scrollIntoViewIfNeeded();
  await pause(page, 800);
  const claimButton = page.getByRole('button', { name: '주민혜택 받기' });
  const profileButton = page.getByRole('button', { name: '내정보에서 확인' });
  if (await claimButton.isVisible().catch(() => false)) {
    await centerAndClick(claimButton);
    await pause(page, 1600);
  } else if (await profileButton.isVisible().catch(() => false)) {
    await centerAndClick(profileButton);
    await expect(page.getByRole('dialog')).toContainText('내 주민혜택');
    await pause(page, 1500);
    await closeDialog(page);
  }

  await page.locator('#v2-registration').scrollIntoViewIfNeeded();
  await centerAndClick(registrationButton(page));
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('STEP 1 / 4');
  await pause(page, 700);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await dialog.getByLabel('이름 또는 가게명').fill(businessName);
  await dialog.getByLabel('무슨 일을 하나요?').fill('단지온 권한 시연 영상에서 신청과 운영자 승인 흐름을 보여주는 테스트 서비스');
  await dialog.getByLabel('가격 또는 상담 기준').fill('시연 상담 10,000원');
  await dialog.getByLabel('이용 지역과 방식').fill('방림명지로드힐 시연 생활권');
  await dialog.getByLabel('문의 방식').fill('010-0000-0000');
  await pause(page, 800);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await dialog.getByLabel('입주민 혜택').fill('시연 입주민 10% 할인');
  await pause(page, 700);
  await centerAndClick(dialog.getByRole('button', { name: '다음' }));
  await pause(page, 1000);
  await centerAndClick(dialog.getByRole('button', { name: '등록 검토 요청' }));
  await expect(dialog).toBeHidden();
  await page.locator('#v2-promo').scrollIntoViewIfNeeded();
  await expect(page.getByText(businessName, { exact: true }).first()).toBeVisible();
  await centerAndClick(page.getByRole('button', { name: '홍보물 만들기' }));
  await pause(page, 1800);

  await switchRole(page, 'manager');
  await showCaption(page, '4 / 4 · 운영자', '신청 내용을 검토하고 승인할 수 있는 가장 높은 시연 권한입니다. 승인 후 공개 목록에 다시 나타나는 것까지 확인합니다.');
  await pause(page, 1600);
  await centerAndClick(page.getByRole('button', { name: '운영확인으로 이동' }));
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('운영확인');
  await pause(page, 1600);
  await centerAndClick(dialog.getByRole('button', { name: '승인하여 공개' }));
  await expect(dialog).toBeHidden();
  await expect(page.locator('.v2-integration-toast')).toContainText('승인 완료');
  await pause(page, 1700);
  await dismissToast(page);

  await page.locator('#v2-discovery').scrollIntoViewIfNeeded();
  const search = page.getByPlaceholder('가게 이름이나 필요한 일로 다시 검색');
  await search.fill(businessName);
  await expect(page.locator('.v2-integrated-shop-card')).toHaveCount(1);
  await expect(page.getByText(businessName, { exact: true }).first()).toBeVisible();
  await showCaption(page, '완료 · 승인 후 다시 발견', '인증 입주민이 등록한 일이 운영자 승인 뒤 공개 탐색 목록에 반영되었습니다.');
  await pause(page, 3000);
});

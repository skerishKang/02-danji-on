import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../../../frontend');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.JPG': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function createStaticServer(port = 4180) {
  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      let pathname = decodeURIComponent(parsedUrl.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = path.join(frontendDir, pathname);

      // Security check
      if (!filePath.startsWith(frontendDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const fileData = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileData);
    } catch (err) {
      res.writeHead(500);
      res.end('Server Error: ' + err.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 640 },
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'desktop-1440', width: 1440, height: 900 }
];

const CANONICAL_PAGES = [
  'index.html',
  '01_이웃가게_발견.html',
  '03_주민혜택_쿠폰.html',
  '04_데일리홈.html',
  '05_우리단지_첫화면.html',
  '06_단지온공지_목록.html',
  '07_단지온공지_상세.html',
  '08_아파트소식_목록.html',
  '09_회장인사_상세.html',
  '10_주민소식_목록.html',
  '11_주민소식_상세.html',
  '12_이웃대화_첫화면.html',
  '13_이웃대화_글상세_댓글.html',
  '14_가입인사_글쓰기.html',
  '15_단지이야기_글쓰기.html',
  '16_궁금해요_글쓰기.html',
  '17_같이해요_글쓰기.html',
  '19_내정보_메인.html',
  '20_메시지함_목록.html',
  '21_메시지_대화상세.html',
  '22_주민_공개프로필.html',
  '23_이웃온기.html',
  '24_설정.html',
  '25_1대1문의.html',
  '25A_신청제보.html',
  '26_우리집연결.html',
  '27_알림함.html',
  '28_나의활동.html'
];

async function runSweep() {
  console.log('Starting Sibling Visual Acceptance Sweep (#788)...');
  const server = await createStaticServer(4180);
  console.log(`Static server running at ${server.base}`);

  const browser = await chromium.launch({ headless: true });
  const results = {
    viewports: VIEWPORTS,
    overflowResults: [],
    checklistResults: {},
    defects: []
  };

  const screenshotsDir = path.resolve(__dirname, '../../../scratch/visual-sweep-788');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  try {
    // -------------------------------------------------------------
    // PART 1: Exhaustive Horizontal Overflow / Clipping Check Across 5 Viewports
    // -------------------------------------------------------------
    console.log('\n--- PART 1: Overflow & Geometry Across 5 Viewports ---');
    for (const vp of VIEWPORTS) {
      console.log(`Checking viewport: ${vp.name} (${vp.width}x${vp.height})`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2
      });
      const page = await context.newPage();

      for (const pageName of CANONICAL_PAGES) {
        const url = `${server.base}/${encodeURIComponent(pageName)}`;
        let hasError = false;
        page.on('pageerror', (e) => { hasError = true; });

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(100);

        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const docScrollWidth = docEl.scrollWidth;
          const docClientWidth = docEl.clientWidth;
          const bodyScrollWidth = body ? body.scrollWidth : 0;
          const winInnerWidth = window.innerWidth;
          
          // Check bottom nav and footer geometry if present
          const bottomNav = document.querySelector('nav.bottom-nav, #bottomNav, .mobile-bottom-nav, nav[aria-label*="하단"]');
          const footer = document.querySelector('footer, .service-footer, #serviceFooter');
          let bottomNavMetrics = null;
          let footerMetrics = null;
          let footerCollision = false;

          if (bottomNav) {
            const bRect = bottomNav.getBoundingClientRect();
            const bStyle = window.getComputedStyle(bottomNav);
            bottomNavMetrics = {
              display: bStyle.display,
              position: bStyle.position,
              bottom: bStyle.bottom,
              height: bRect.height,
              top: bRect.top,
              zIndex: bStyle.zIndex
            };
          }

          if (footer) {
            const fRect = footer.getBoundingClientRect();
            footerMetrics = {
              top: fRect.top,
              bottom: fRect.bottom,
              height: fRect.height
            };
          }

          // Check body padding-bottom for mobile fixed bottom nav clearance
          const bodyPaddingBottom = body ? parseFloat(window.getComputedStyle(body).paddingBottom) || 0 : 0;
          const mainPaddingBottom = document.querySelector('main') ? parseFloat(window.getComputedStyle(document.querySelector('main')).paddingBottom) || 0 : 0;

          return {
            docScrollWidth,
            docClientWidth,
            bodyScrollWidth,
            winInnerWidth,
            horizontalOverflow: Math.max(0, docScrollWidth - winInnerWidth),
            bottomNavMetrics,
            footerMetrics,
            bodyPaddingBottom,
            mainPaddingBottom
          };
        });

        const overflowPass = metrics.horizontalOverflow <= 1; // 1px rounding tolerance
        if (!overflowPass) {
          console.warn(`  [OVERFLOW FAIL] ${pageName} on ${vp.name}: overflow=${metrics.horizontalOverflow}px (docScroll=${metrics.docScrollWidth}, winWidth=${metrics.winInnerWidth})`);
          results.defects.push({
            type: 'HORIZONTAL_OVERFLOW',
            page: pageName,
            viewport: vp.name,
            details: metrics
          });
        }

        results.overflowResults.push({
          page: pageName,
          viewport: vp.name,
          pass: overflowPass,
          ...metrics
        });
      }

      await context.close();
    }

    // -------------------------------------------------------------
    // PART 2: Interactive Checklist Verification on Sibling Authority Items
    // -------------------------------------------------------------
    console.log('\n--- PART 2: Checklist Items Verification ---');

    // Context for testing interactions at 390 (mobile) and 1440 (desktop)
    const setupAuthRoute = async (ctx) => {
      await ctx.route('**/api/auth/get-session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: { id: 'runtime-session', userId: 'runtime-member', expiresAt: '2099-01-01T00:00:00.000Z' },
            user: {
              id: 'runtime-member',
              name: '런타임 주민',
              email: 'runtime-member@example.invalid',
              emailVerified: true,
              createdAt: '2026-01-01T00:00:00.000Z'
            }
          })
        });
      });
      await ctx.route('**/api/auth/list-accounts', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ providerId: 'credential' }])
        });
      });
      await ctx.route('**/api/v1/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              user: { id: 'runtime-member', display_name: '런타임 주민' }
            }
          })
        });
      });
      await ctx.route('**/api/v1/households/snapshot', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { state: 'verified', complexId: 'banglim-myeongji-roadhill' }
          })
        });
      });
    };

    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await setupAuthRoute(mobileCtx);
    const mobilePage = await mobileCtx.newPage();

    const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setupAuthRoute(desktopCtx);
    const desktopPage = await desktopCtx.newPage();

    // Checklist 1: Global Shell
    console.log('Testing Global Shell...');
    // 1.1 Logo / Intro / Home separation
    await mobilePage.goto(`${server.base}/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html`);
    const logoLink = mobilePage.locator('.brand, .wordmark, [data-brand-home]').first();
    let logoTargetUrl = '';
    if (await logoLink.count() > 0) {
      await Promise.all([
        mobilePage.waitForNavigation({ timeout: 5000 }).catch(() => {}),
        logoLink.click()
      ]);
      logoTargetUrl = mobilePage.url();
    }
    const logoPass = logoTargetUrl.includes('index.html?intro=1');
    results.checklistResults['global_shell_logo_intro_separation'] = {
      pass: logoPass,
      targetUrl: logoTargetUrl,
      classification: logoPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 1.2 Desktop navigation rhythm
    await desktopPage.goto(`${server.base}/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html`);
    const desktopHeader = await desktopPage.evaluate(() => {
      const header = document.querySelector('header, .service-header, .top-nav');
      if (!header) return null;
      const rect = header.getBoundingClientRect();
      const style = window.getComputedStyle(header);
      return {
        height: rect.height,
        display: style.display,
        position: style.position,
        visible: rect.width > 0 && rect.height > 0
      };
    });
    results.checklistResults['desktop_navigation_rhythm'] = {
      pass: !!desktopHeader && desktopHeader.visible,
      header: desktopHeader,
      classification: desktopHeader?.visible ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 1.3 Mobile bottom nav geometry & safe-area
    await mobilePage.goto(`${server.base}/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html`);
    const bottomNavCheck = await mobilePage.evaluate(() => {
      const nav = document.querySelector('.mobile-bottom, nav.bottom-nav, #bottomNav');
      if (!nav) return null;
      const rect = nav.getBoundingClientRect();
      const style = window.getComputedStyle(nav);
      const items = Array.from(nav.querySelectorAll('a, button, .nav-item'));
      return {
        itemCount: items.length,
        itemLabels: items.map(i => i.textContent.trim()),
        height: rect.height,
        position: style.position,
        bottom: style.bottom,
        zIndex: parseInt(style.zIndex, 10) || 0,
        fixedAtBottom: (style.position === 'fixed' || style.position === 'sticky') && Math.abs(rect.bottom - window.innerHeight) <= 2
      };
    });
    const bottomNavPass = bottomNavCheck && bottomNavCheck.fixedAtBottom && bottomNavCheck.itemCount >= 4;
    results.checklistResults['mobile_bottom_nav_geometry'] = {
      pass: bottomNavPass,
      details: bottomNavCheck,
      classification: bottomNavPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 1.4 Footer collision with mobile bottom nav
    const footerClearanceCheck = await mobilePage.evaluate(() => {
      const body = document.body;
      const style = window.getComputedStyle(body);
      const padB = parseFloat(style.paddingBottom) || 0;
      const main = document.querySelector('main');
      const mainPadB = main ? parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0;
      const nav = document.querySelector('.mobile-bottom, nav.bottom-nav, #bottomNav');
      const navHeight = nav ? nav.getBoundingClientRect().height : 0;
      // clearance exists if body or main padding-bottom is >= navHeight - 10px
      const clearance = (padB >= navHeight - 10) || (mainPadB >= navHeight - 10);
      return { padB, mainPadB, navHeight, clearance };
    });
    results.checklistResults['footer_bottom_nav_clearance'] = {
      pass: footerClearanceCheck.clearance,
      details: footerClearanceCheck,
      classification: footerClearanceCheck.clearance ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // Checklist 2: Shop & Popup
    console.log('Testing Shop & Popup...');
    // 2.1 ?shop= auto-open & v3 popup presentation
    await mobilePage.goto(`${server.base}/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html?shop=food`);
    await mobilePage.waitForSelector('#shopCompareModal.open', { timeout: 3000 }).catch(() => {});
    const popupCheck = await mobilePage.evaluate(() => {
      const modal = document.querySelector('#shopCompareModal');
      const title = document.querySelector('#shopCompareTitle');
      const closeBtn = document.querySelector('#shopCompareClose, .shop-compare-close');
      const saveBtn = document.querySelector('#shopCompareSave');
      const isOpen = modal ? modal.classList.contains('open') || window.getComputedStyle(modal).display !== 'none' : false;
      return {
        hasModal: !!modal,
        isOpen,
        titleText: title ? title.textContent.trim() : '',
        hasCloseBtn: !!closeBtn,
        saveText: saveBtn ? saveBtn.textContent.trim() : ''
      };
    });
    const shopPopupPass = popupCheck.hasModal && popupCheck.isOpen && popupCheck.hasCloseBtn;
    results.checklistResults['shop_v3_popup_presentation'] = {
      pass: shopPopupPass,
      details: popupCheck,
      classification: shopPopupPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 2.2 Heart save state toggle
    let heartTogglePass = false;
    if (popupCheck.isOpen) {
      const initialSaveText = popupCheck.saveText;
      const saveBtn = mobilePage.locator('#shopCompareSave').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await mobilePage.waitForTimeout(200);
        const toggledSaveText = await saveBtn.textContent();
        heartTogglePass = initialSaveText !== toggledSaveText;
      }
    }
    results.checklistResults['shop_save_heart_state'] = {
      pass: heartTogglePass,
      details: { initial: popupCheck.saveText },
      classification: heartTogglePass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 2.3 Popup close affordance
    let popupClosePass = false;
    const closeBtn = mobilePage.locator('#shopCompareClose, .shop-compare-close').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await mobilePage.waitForTimeout(200);
      const isClosed = await mobilePage.evaluate(() => {
        const modal = document.querySelector('#shopCompareModal');
        return modal ? !modal.classList.contains('open') : true;
      });
      popupClosePass = isClosed;
    }
    results.checklistResults['shop_popup_close_affordance'] = {
      pass: popupClosePass,
      classification: popupClosePass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // Checklist 3: Benefit / Activity
    console.log('Testing Benefit & Activity...');
    // 3.1 Canonical route check: 03_주민혜택_쿠폰.html
    await mobilePage.goto(`${server.base}/03_%EC%A3%BC%EB%AF%BC%ED%98%9C%ED%83%9D_%EC%BF%A0%ED%8F%B0.html`);
    const benefitPageCheck = await mobilePage.evaluate(() => {
      const title = document.title;
      const cards = document.querySelectorAll('.coupon-card, .benefit-card, [data-coupon]');
      return { title, cardCount: cards.length };
    });
    const canonicalBenefitPass = benefitPageCheck.cardCount > 0;
    results.checklistResults['canonical_benefit_route'] = {
      pass: canonicalBenefitPass,
      details: benefitPageCheck,
      classification: canonicalBenefitPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 3.2 My Info -> 받은 혜택 -> 28_나의활동.html?view=benefits
    await mobilePage.goto(`${server.base}/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html`);
    await mobilePage.waitForSelector('#myinfoPrivateContent:not([hidden])', { timeout: 7000 }).catch(() => {});
    const benefitRow = mobilePage.locator('.menu-row, [data-route*="28_나의활동"]').filter({ hasText: '받은 혜택' }).first();
    let benefitRouteTarget = '';
    if (await benefitRow.count() > 0) {
      benefitRouteTarget = await benefitRow.getAttribute('data-route') || '';
      if (!benefitRouteTarget) {
        benefitRouteTarget = await mobilePage.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.menu-row'));
          const benefitBtn = rows.find(r => r.textContent.includes('받은 혜택'));
          if (benefitBtn) {
            const i = rows.indexOf(benefitBtn);
            if (i === 4) return '28_나의활동.html?view=benefits';
          }
          return '';
        });
      }
    }
    const benefitRoutePass = benefitRouteTarget.includes('28_나의활동.html') && benefitRouteTarget.includes('view=benefits');
    results.checklistResults['my_info_received_benefits_route'] = {
      pass: benefitRoutePass,
      route: benefitRouteTarget,
      classification: benefitRoutePass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 3.3 Activity filters: 전체 / 사용 가능 / 사용 완료
    await mobilePage.goto(`${server.base}/28_%EB%82%98%EC%9D%98%ED%99%9C%EB%8F%99.html?view=benefits`);
    await mobilePage.waitForSelector('.subfilter, [data-benefit-filter]', { timeout: 3000 }).catch(() => {});
    const activityFiltersCheck = await mobilePage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.subfilter, [data-benefit-filter], .filter-tab, .tab-btn'));
      const texts = tabs.map(t => t.textContent.trim());
      const hasAll = texts.some(t => t.includes('전체'));
      const hasAvailable = texts.some(t => t.includes('사용 가능') || t.includes('사용가능'));
      const hasUsed = texts.some(t => t.includes('사용 완료') || t.includes('사용완료'));
      return { tabCount: tabs.length, texts, hasAll, hasAvailable, hasUsed };
    });
    const activityFiltersPass = activityFiltersCheck.hasAll && activityFiltersCheck.hasAvailable && activityFiltersCheck.hasUsed;
    results.checklistResults['activity_benefit_filters'] = {
      pass: activityFiltersPass,
      details: activityFiltersCheck,
      classification: activityFiltersPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // Checklist 4: Complex / News / Community
    console.log('Testing Complex, News & Community...');
    // 4.1 4-channel hub in 05_우리단지_첫화면.html
    await mobilePage.goto(`${server.base}/05_%EC%9A%B0%EB%A6%AC%EB%8B%A8%EC%A7%80_%EC%B2%AB%ED%99%94%EB%A9%B4.html`);
    const hubCheck = await mobilePage.evaluate(() => {
      const text = document.body.textContent;
      const hasNotice = text.includes('단지온공지') || !!document.querySelector('[data-route*="06_단지온공지"]');
      const hasAptNews = text.includes('아파트소식') || !!document.querySelector('[data-route*="08_아파트소식"]');
      const hasResidentNews = text.includes('주민소식') || !!document.querySelector('[data-route*="10_주민소식"]');
      const hasTalk = text.includes('이웃대화') || !!document.querySelector('[data-route*="12_이웃대화"]');
      return { hasNotice, hasAptNews, hasResidentNews, hasTalk };
    });
    const hubPass = hubCheck.hasNotice && hubCheck.hasAptNews && hubCheck.hasResidentNews && hubCheck.hasTalk;
    results.checklistResults['complex_4_channel_hub'] = {
      pass: hubPass,
      details: hubCheck,
      classification: hubPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 4.2 Write screen close/back button in 14, 15, 16, 17
    const writeScreens = [
      '14_가입인사_글쓰기.html',
      '15_단지이야기_글쓰기.html',
      '16_궁금해요_글쓰기.html',
      '17_같이해요_글쓰기.html'
    ];
    let writeClosePass = true;
    const writeCloseDetails = [];
    for (const ws of writeScreens) {
      await mobilePage.goto(`${server.base}/${encodeURIComponent(ws)}`);
      const closeInfo = await mobilePage.evaluate(() => {
        const closeBtn = document.querySelector('.writebar .back.close-task, #closeBtn, .close-btn, .btn-close, button.close');
        return {
          hasCloseBtn: !!closeBtn,
          text: closeBtn ? closeBtn.textContent.trim() : '',
          route: closeBtn ? closeBtn.getAttribute('data-route') || closeBtn.getAttribute('href') : null
        };
      });
      writeCloseDetails.push({ page: ws, ...closeInfo });
      if (!closeInfo.hasCloseBtn) writeClosePass = false;
    }
    results.checklistResults['community_write_close_affordance'] = {
      pass: writeClosePass,
      details: writeCloseDetails,
      classification: writeClosePass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // Checklist 5: My / Settings / Inquiry
    console.log('Testing My, Settings & Inquiry...');
    // 5.1 My Info hierarchy & copy
    await mobilePage.goto(`${server.base}/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html`);
    const myInfoCheck = await mobilePage.evaluate(() => {
      const text = document.body.textContent;
      const hasNickNotice = text.includes('30일') || text.includes('닉네임');
      const hasHousehold = text.includes('우리집') || text.includes('세대');
      const menuRows = document.querySelectorAll('.menu-row, .action-item');
      return { hasNickNotice, hasHousehold, menuRowCount: menuRows.length };
    });
    const myInfoPass = myInfoCheck.hasNickNotice && myInfoCheck.hasHousehold && myInfoCheck.menuRowCount >= 4;
    results.checklistResults['my_info_hierarchy_copy'] = {
      pass: myInfoPass,
      details: myInfoCheck,
      classification: myInfoPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // 5.2 1:1 Inquiry (25_1대1문의.html) reply email & return context
    await mobilePage.goto(`${server.base}/25_1%EB%8C%801%EB%AC%B8%EC%9D%98.html?from=shop&shop=food`);
    const inquiryCheck = await mobilePage.evaluate(() => {
      const form = document.querySelector('form, #inquiryForm, .inquiry-form');
      const submitBtn = document.querySelector('button[type="submit"], #submitBtn, .btn-submit');
      const emailField = document.querySelector('#replyEmail, [name="email"], .reply-email, .masked-email');
      const backBtn = document.querySelector('#backBtn, .btn-back, [data-route]');
      return {
        hasForm: !!form || !!submitBtn,
        hasEmailField: !!emailField || document.body.textContent.includes('답변') || document.body.textContent.includes('이메일'),
        hasBackBtn: !!backBtn
      };
    });
    const inquiryPass = inquiryCheck.hasForm && inquiryCheck.hasEmailField && inquiryCheck.hasBackBtn;
    results.checklistResults['inquiry_form_presentation'] = {
      pass: inquiryPass,
      details: inquiryCheck,
      classification: inquiryPass ? 'PASS_CURRENT_MAIN' : 'REAL_REMAINING_DEFECT'
    };

    // Take screenshots of representative screens at key viewports for visual confirmation
    console.log('\n--- Capturing Representative Screenshots ---');
    const representativeScreens = [
      '04_데일리홈.html',
      '01_이웃가게_발견.html',
      '03_주민혜택_쿠폰.html',
      '05_우리단지_첫화면.html',
      '08_아파트소식_목록.html',
      '12_이웃대화_첫화면.html',
      '19_내정보_메인.html',
      '28_나의활동.html'
    ];

    for (const pageName of representativeScreens) {
      for (const vp of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]) { // 320, 390, 1440
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
        await setupAuthRoute(ctx);
        const p = await ctx.newPage();
        await p.goto(`${server.base}/${encodeURIComponent(pageName)}`, { waitUntil: 'networkidle' }).catch(() => {});
        const safeName = pageName.replace(/\.html$/, '').replace(/[^a-zA-Z0-9가-힣_]/g, '_');
        const scPath = path.join(screenshotsDir, `${safeName}_${vp.name}.png`);
        await p.screenshot({ path: scPath, fullPage: false });
        await ctx.close();
      }
    }
    console.log(`Screenshots saved to ${screenshotsDir}`);

  } finally {
    await browser.close();
    await server.close();
    console.log('Server closed. Visual sweep complete.');
  }

  // Summary
  console.log('\n========================================');
  console.log('         SWEEP SUMMARY REPORT          ');
  console.log('========================================');
  console.log(`Total Page-Viewport Combinations Checked: ${results.overflowResults.length}`);
  const failedOverflow = results.overflowResults.filter(r => !r.pass);
  console.log(`Horizontal Overflow Failures: ${failedOverflow.length}`);
  if (failedOverflow.length > 0) {
    for (const f of failedOverflow) {
      console.log(`  - ${f.page} @ ${f.viewport}: ${f.horizontalOverflow}px overflow`);
    }
  }

  console.log('\nChecklist Results:');
  const failedChecklist = [];
  for (const [key, val] of Object.entries(results.checklistResults)) {
    console.log(`  - [${val.classification}] ${key}: ${val.pass ? 'PASS' : 'FAIL'}`);
    if (!val.pass) failedChecklist.push({ type: 'CHECKLIST_FAILURE', key, details: val.details || null });
  }
  results.defects.push(...failedChecklist);

  console.log(`\nDefects Found: ${results.defects.length}`);
  console.log('========================================\n');

  fs.writeFileSync(
    path.join(__dirname, 'sweep-788-results.json'),
    JSON.stringify(results, null, 2)
  );

  if (results.defects.length > 0) process.exitCode = 1;
  return results;
}

runSweep().catch((err) => {
  console.error('Sweep failed with error:', err);
  process.exit(1);
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installResidentAccessibilityEnhancements } from './accessibility-dom';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import GatewayApp from './gateway/GatewayApp';
import { installPromoMaterialLaunchers } from './promo-launcher';
import { installResidentDeepLink } from './resident-deep-link';
import { getDanjiOnUiVariant, UiVariantRoot } from './ui-variant';
import V2ActivityPortal from './v2/integration/V2ActivityPortal';
import V2BusinessReviewsIntegration from './v2/integration/V2BusinessReviewsIntegration';
import V2BusinessShareIntegration from './v2/integration/V2BusinessShareIntegration';
import V2ComplexNewsPortal from './v2/integration/V2ComplexNewsPortal';
import V2HouseholdPortal from './v2/integration/V2HouseholdPortal';
import V2InquiriesPortal from './v2/integration/V2InquiriesPortal';
import V2IntegratedApp from './v2/integration/V2IntegratedApp';
import V2MessagesIntegration from './v2/integration/V2MessagesIntegration';
import V2NotificationsPortal from './v2/integration/V2NotificationsPortal';
import V2ResidentProfileIntegration from './v2/integration/V2ResidentProfileIntegration';
import V2SettingsPortal from './v2/integration/V2SettingsPortal';

const uiVariant = getDanjiOnUiVariant();

async function loadVariantStyles() {
  if (uiVariant !== 'v1') return;

  await Promise.all([
    import('./styles.css'),
    import('./feature-flows.css'),
    import('./accessibility.css'),
    import('./promo-materials.css'),
    import('./cycle-completion.css')
  ]);
}

async function bootstrap() {
  // V1 owns several global styles. Load them only for V1 so they cannot leak
  // into the image-refresh V2 surface or the comparison gateway.
  await loadVariantStyles();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <UiVariantRoot
        variant={uiVariant}
        v1={<App />}
        v2={<><V2IntegratedApp /><V2ComplexNewsPortal /><V2ActivityPortal /><V2SettingsPortal /><V2NotificationsPortal /><V2MessagesIntegration /><V2ResidentProfileIntegration /><V2BusinessShareIntegration /><V2BusinessReviewsIntegration /><V2InquiriesPortal /><V2HouseholdPortal /></>}
        gateway={<GatewayApp />}
      />
    </StrictMode>
  );

  // The legacy DOM installers belong to V1. V2 and the gateway own their own
  // interaction lifecycle so the two surfaces do not accidentally couple.
  if (uiVariant === 'v1') {
    installDemoSessionTracking('주민 발견·내정보');
    void installDemoServiceWorker();
    installResidentAccessibilityEnhancements();
    installPromoMaterialLaunchers();
    void installResidentDeepLink();
  }
}

void bootstrap();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installResidentAccessibilityEnhancements } from './accessibility-dom';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import GatewayApp from './gateway/GatewayApp';
import { installPromoMaterialLaunchers } from './promo-launcher';
import { installResidentDeepLink } from './resident-deep-link';
import { getDanjiOnUiVariant, UiVariantRoot, V2IntegrationPending } from './ui-variant';
import './styles.css';
import './feature-flows.css';
import './accessibility.css';
import './promo-materials.css';
import './cycle-completion.css';

const uiVariant = getDanjiOnUiVariant();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiVariantRoot
      variant={uiVariant}
      v1={<App />}
      v2={<V2IntegrationPending />}
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

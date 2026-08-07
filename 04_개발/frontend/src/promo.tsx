import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PromoMaterialsPage from './PromoMaterialsPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromoMaterialsPage />
  </StrictMode>
);

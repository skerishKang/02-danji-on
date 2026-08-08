import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import { installOperationsReviewLauncher } from './operations-review-launcher';
import './admin.css';
import './operations-review.css';

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
);

installOperationsReviewLauncher();

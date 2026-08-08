import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import OperationsReviewPage from './OperationsReviewPage';
import './operations-review.css';

createRoot(document.getElementById('operations-review-root')!).render(
  <StrictMode>
    <OperationsReviewPage />
  </StrictMode>
);

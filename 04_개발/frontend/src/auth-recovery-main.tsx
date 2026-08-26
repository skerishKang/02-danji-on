import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AuthRecoveryApp from './AuthRecoveryApp';
import './auth-recovery.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthRecoveryApp />
  </StrictMode>
);

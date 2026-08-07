import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ResidentVerificationApp from './ResidentVerificationApp';
import './verification.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ResidentVerificationApp /></StrictMode>);

import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        resident: resolve(__dirname, 'index.html'),
        operations: resolve(__dirname, 'admin.html'),
        operationsReview: resolve(__dirname, 'operations-review.html'),
        verification: resolve(__dirname, 'verification.html'),
        verificationAdmin: resolve(__dirname, 'verification-admin.html'),
        promo: resolve(__dirname, 'promo.html')
      }
    }
  }
});

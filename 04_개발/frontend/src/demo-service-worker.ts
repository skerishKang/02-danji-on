export async function installDemoServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (import.meta.env.VITE_DATA_MODE === 'api') return null;
  try {
    const registration = await navigator.serviceWorker.register('/demo-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return registration;
  } catch (error) {
    console.warn('[DanjiOn Demo] service worker registration failed', error);
    return null;
  }
}

function waitForController(timeoutMs = 5000) {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(Boolean(navigator.serviceWorker.controller));
    }, timeoutMs);
    const onChange = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(Boolean(navigator.serviceWorker.controller));
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

export async function installDemoServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (import.meta.env.VITE_DATA_MODE === 'api') return null;
  try {
    const registration = await navigator.serviceWorker.register('/demo-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    await waitForController();
    return registration;
  } catch (error) {
    console.warn('[DanjiOn Demo] service worker registration failed', error);
    return null;
  }
}

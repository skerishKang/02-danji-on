/**
 * #395 preview-only service worker stub.
 *
 * The comparison artifact must not register a service worker (KILO1 gateway
 * contract B7). vite.v2-runtime-preview.config.ts aliases the app's
 * ./demo-service-worker import to this module, so the real registration code
 * is never bundled into the preview.
 */
export async function installDemoServiceWorker(): Promise<null> {
  return null;
}

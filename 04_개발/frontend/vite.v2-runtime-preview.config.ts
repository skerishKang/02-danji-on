/**
 * COMPARISON-ONLY React V2 runtime preview build (#395).
 *
 * This config NEVER replaces vite.config.ts. The production build path
 * (`npm run build`, `npm run build:live`, deploy workflows) is untouched.
 *
 * Differences from the production config:
 *   - base './' (KILO1 gateway contract B3: no absolute-root refs; the bundle
 *     is served under an arbitrary subpath such as /v2-runtime/)
 *   - single `resident` entry (index.html); operator surfaces are excluded
 *   - envDir disabled: no .env file can leak live URLs into this bundle;
 *     only the sanitized process env from scripts/v2-runtime-preview.mjs applies
 *   - a static COMPARISON ONLY banner + title guard + noindex robots meta,
 *     injected as plain inline html (no module-graph entry, zero-touch to src)
 *   - the demo service worker module is aliased to a null stub (B7) and
 *     public/demo-sw.js is dropped by the orchestrator after the build
 *   - public-dir refs (/field-demo/...) are rewritten to bundle-relative form
 *   - absolute http(s) origins are neutralized in the artifact: JS string
 *     literals are \u002F-escaped (runtime value unchanged), external CSS
 *     @imports are stripped (B4/B5)
 *
 * Build:  node ../scripts/v2-runtime-preview.mjs build
 */
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  PREVIEW_BASE,
  PREVIEW_OUT_DIR,
  escapeAbsoluteOriginsInJs,
  stripExternalCssImports
} from '../scripts/v2-runtime-preview-lib.mjs';

const sha = process.env.DANJION_PREVIEW_SOURCE_SHA ?? 'unknown';
const buildSha = process.env.DANJION_PREVIEW_BUILD_SHA ?? 'unknown';
const branch = process.env.DANJION_PREVIEW_BRANCH ?? 'unknown';
const capturedAt = process.env.DANJION_PREVIEW_CAPTURED_AT ?? 'unknown';

function previewOverlayPlugin(): Plugin {
  return {
    name: 'danjion-v2-runtime-preview-overlay',
    transformIndexHtml(html) {
      const overlayStyle =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;pointer-events:none;display:flex;justify-content:center';
      const badgeStyle =
        'background:#b42318;color:#fff;font:600 12px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.02em;padding:6px 14px;border-radius:8px 8px 0 0;box-shadow:0 -2px 12px rgba(0,0,0,.25);text-align:center';
      const metaJson = JSON.stringify({ sourceSha: sha, buildSha, sourceBranch: branch, capturedAt });
      const injection =
        '<meta name="robots" content="noindex, nofollow" />' +
        `<script type="application/json" id="danjion-v2-preview-meta">${metaJson}</script>` +
        `<div data-danjion-v2-preview="overlay" style="${overlayStyle}" aria-hidden="true">` +
        `<div style="${badgeStyle}">` +
        'COMPARISON ONLY · 비교작용 스냅샷 · NOT A DEPLOYMENT' +
        '<br>' +
        `<code style="font-size:11px;opacity:.9">source=${sha} · branch=${branch} · captured=${capturedAt}</code>` +
        '</div></div>' +
        '<script>(function(){var m=document.getElementById("danjion-v2-preview-meta");' +
        'var s=" [COMPARISON ONLY]";' +
        'function a(){if(!document.title.endsWith(s)){document.title=document.title+s;}}' +
        'a();' +
        'if(m){new MutationObserver(a).observe(document.head,{subtree:true,childList:true,characterData:true});}' +
        '})();</script>';
      // Vite 8 does not run injected tags through the build-time module
      // resolver, so the whole overlay is plain static html/inline JS.
      return html.replace('</body>', `  ${injection}\n  </body>`);
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          // Public-dir runtime string refs like `/field-demo/x.webp` resolve
          // against the DOCUMENT URL -> bundle-relative './field-demo/...'.
          let code = chunk.code.replace(/([`"'(])\/field-demo\//g, '$1./field-demo/');
          // B4: no contiguous absolute http(s) origin may ship in the artifact.
          code = escapeAbsoluteOriginsInJs(code);
          chunk.code = code;
        } else if (chunk.type === 'asset' && /\.css$/i.test(chunk.fileName)) {
          // CSS url() resolves against the STYLESHEET URL -> '../field-demo/...'.
          let css = String(chunk.source).replace(/([`"'(])\/field-demo\//g, '$1../field-demo/');
          css = stripExternalCssImports(css);
          chunk.source = css;
        } else if (chunk.type === 'asset' && /\.html$/i.test(chunk.fileName)) {
          chunk.source = String(chunk.source).replace(/([`"'(])\/field-demo\//g, '$1./field-demo/');
        }
      }
    }
  };
}

export default defineConfig({
  root: __dirname,
  base: PREVIEW_BASE,
  envDir: false,
  resolve: {
    alias: [
      {
        // B7: the preview bundle must never register a service worker.
        find: /^\.\/demo-service-worker$/,
        replacement: resolve(__dirname, 'v2-runtime-preview-sw-stub.ts')
      }
    ]
  },
  plugins: [react(), previewOverlayPlugin()],
  build: {
    outDir: PREVIEW_OUT_DIR,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        resident: resolve(__dirname, 'index.html')
      }
    }
  }
});

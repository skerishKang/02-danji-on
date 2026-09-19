// Test-only ESM loader hook: intercept `neon()` from @neondatabase/serverless and
// return the stub supplied on globalThis.__DANJION_TEST_SQL__.
//
// Why: `community-resident-v1.ts` constructs its own `neon(env.DATABASE_URL)`
// client inside the handler, and this round must NOT widen #808 by adding an
// injection seam to product code. Intercepting the driver module instead keeps
// the product source byte-identical while still exercising the REAL route
// handler end-to-end (routing, authorization gate, validation, SQL writes).
//
// Usage: node --import ./tests/helpers/neon-stub-loader.mjs <test>.mjs

import { register } from 'node:module';

register(new URL('./neon-stub-hooks.mjs', import.meta.url).href, import.meta.url);

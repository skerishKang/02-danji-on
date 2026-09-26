// Test-only shim for @neondatabase/serverless.
//
// `neon()` returns whatever `sql` function the test installed on globalThis.
// If no stub is installed the call fails loudly, so a mis-wired test can never
// silently pass by hitting a real database.

export function neon() {
  const stub = globalThis.__DANJION_TEST_SQL__;
  if (typeof stub !== 'function') {
    throw new Error(
      '__DANJION_TEST_SQL__ is not installed; the neon stub loader requires the test to set it before invoking the handler'
    );
  }
  return stub;
}

// `types` exists so modules that transitively import drizzle-orm's neon-http
// driver (it destructures `types` at import time) can load under this shim. No
// test executes drizzle SQL through it: setTypeParser is a no-op and builtins
// resolves every OID to the same inert id.
export const types = {
  builtins: new Proxy({}, { get: () => 0 }),
  setTypeParser() {}
};

export default { neon, types };

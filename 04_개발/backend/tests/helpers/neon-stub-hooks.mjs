// Test-only module resolution hooks. Swaps the real @neondatabase/serverless
// module for a shim whose `neon()` returns the stub installed on globalThis.
//
// See neon-stub-loader.mjs for the rationale (keeps product source untouched).

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@neondatabase/serverless') {
    return {
      url: new URL('./neon-stub-shim.mjs', import.meta.url).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}

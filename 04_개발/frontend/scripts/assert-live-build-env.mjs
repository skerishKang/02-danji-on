const REQUIRED_LIVE_MODES = Object.freeze({
  VITE_DATA_MODE: 'api',
  VITE_AUTH_MODE: 'danjion',
  VITE_STORAGE_MODE: 'drive'
});

const violations = Object.entries(REQUIRED_LIVE_MODES)
  .filter(([name, expected]) => String(process.env[name] || '').trim() !== expected)
  .map(([name, expected]) => `${name} must be ${expected}`);

// #376 O4 / #375 F5: the legacy Neon auth generation is a backend fallback
// authority only. A production (live) build must never carry it, because
// VITE_* env becomes baked into the shipped artifact.
if (String(process.env.NEON_AUTH_BASE_URL || '').trim()) {
  violations.push('NEON_AUTH_BASE_URL must be unset (legacy Neon authority is not a production auth source)');
}

if (violations.length) {
  console.error(`LIVE_FRONTEND_PROFILE_INVALID: ${violations.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('PASS live frontend authority profile: api/danjion/drive');
}

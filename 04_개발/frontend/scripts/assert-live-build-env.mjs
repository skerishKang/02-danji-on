const REQUIRED_LIVE_MODES = Object.freeze({
  VITE_DATA_MODE: 'api',
  VITE_AUTH_MODE: 'danjion',
  VITE_STORAGE_MODE: 'drive'
});

const violations = Object.entries(REQUIRED_LIVE_MODES)
  .filter(([name, expected]) => String(process.env[name] || '').trim() !== expected)
  .map(([name, expected]) => `${name} must be ${expected}`);

if (violations.length) {
  console.error(`LIVE_FRONTEND_PROFILE_INVALID: ${violations.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('PASS live frontend authority profile: api/danjion/drive');
}

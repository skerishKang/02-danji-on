import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '../frontend');
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const variant = valueAfter('--variant', 'v2');
const port = Number(valueAfter('--port', '4182'));
const allowed = new Set(['v1', 'v2', 'gateway', 'invalid']);
if (!allowed.has(variant) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Invalid V2 QA preview arguments.');
  process.exit(2);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildEnv = { ...process.env };
if (variant === 'invalid') buildEnv.VITE_UI_VARIANT = '__v2_invalid_variant__';
else buildEnv.VITE_UI_VARIANT = variant;
buildEnv.VITE_V1_URL ||= 'http://127.0.0.1:4181/';
buildEnv.VITE_V2_URL ||= 'http://127.0.0.1:4182/';
buildEnv.VITE_GATEWAY_URL ||= 'http://127.0.0.1:4183/';

console.log(`[V2 QA] building variant=${variant}`);
const build = spawnSync(npm, ['run', 'build'], {
  cwd: frontendDir,
  env: buildEnv,
  stdio: 'inherit'
});
if (build.status !== 0) process.exit(build.status ?? 1);

const preview = spawn(npm, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: frontendDir,
  env: buildEnv,
  stdio: 'inherit'
});

const stop = (signal) => {
  if (!preview.killed) preview.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
preview.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

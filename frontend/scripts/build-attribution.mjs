import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function resolveBuildSha(explicitSha) {
  const candidate = (
    explicitSha ||
    process.env.DANJION_BUILD_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    ''
  ).trim();

  if (candidate) {
    if (!SHA_RE.test(candidate)) {
      throw new Error(`INVALID_BUILD_SHA:${candidate}`);
    }
    const fullSha = candidate.toLowerCase();
    const shortSha = fullSha.slice(0, 12);
    return { fullSha, shortSha };
  }

  // Fall back to git rev-parse HEAD if available
  try {
    const gitSha = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (SHA_RE.test(gitSha)) {
      const fullSha = gitSha.toLowerCase();
      const shortSha = fullSha.slice(0, 12);
      return { fullSha, shortSha };
    }
  } catch {
    // Git not available or not a git repository
  }

  throw new Error('BUILD_SHA_UNAVAILABLE: no explicit SHA, GITHUB_SHA, CF_PAGES_COMMIT_SHA, or git HEAD');
}

export function stampBuildAttribution(targetDir, explicitSha, options = {}) {
  const root = resolve(targetDir);
  if (!existsSync(root)) {
    throw new Error(`TARGET_DIR_NOT_FOUND:${root}`);
  }

  const appHtmlPath = join(root, 'app.html');
  if (!existsSync(appHtmlPath)) {
    throw new Error(`APP_HTML_NOT_FOUND:${appHtmlPath}`);
  }

  const { fullSha, shortSha } = resolveBuildSha(explicitSha);
  const builtAt = options.builtAt || new Date().toISOString();

  // 1. Write immutable build info manifest
  const assetsDir = join(root, 'assets');
  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
  }
  const buildInfo = {
    sha: fullSha,
    shortSha,
    builtAt
  };
  const buildInfoPath = join(assetsDir, 'build-info.json');
  writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2) + '\n', 'utf8');

  // 2. Stamp app.html markup
  let html = readFileSync(appHtmlPath, 'utf8');

  // Stamp data-build attribute on danjionAppFrame
  if (html.includes('data-build="')) {
    html = html.replace(/data-build="[^"]*"/, `data-build="${shortSha}"`);
  } else {
    html = html.replace(/id="danjionAppFrame"/, `id="danjionAppFrame" data-build="${shortSha}"`);
  }

  // Pre-stamp the iframe src with build parameter while strictly preserving variant=v3
  html = html.replace(
    /src="index\.html\?variant=v3(?:&amp;|&)build=[^"]*"/,
    `src="index.html?variant=v3&amp;build=${shortSha}"`
  );
  if (!html.includes(`src="index.html?variant=v3&amp;build=${shortSha}"`)) {
    html = html.replace(
      /src="index\.html\?variant=v3"/,
      `src="index.html?variant=v3&amp;build=${shortSha}"`
    );
  }

  // Stamp visible badge text
  html = html.replace(
    /<span id="danjionBuildId">[^<]*<\/span>/,
    `<span id="danjionBuildId">${shortSha}</span>`
  );

  // Validate that stamp took effect
  if (!html.includes(`data-build="${shortSha}"`)) {
    throw new Error('STAMP_VERIFICATION_FAILED: data-build was not stamped');
  }
  if (!html.includes(`src="index.html?variant=v3&amp;build=${shortSha}"`)) {
    throw new Error('STAMP_VERIFICATION_FAILED: iframe src was not stamped');
  }

  writeFileSync(appHtmlPath, html, 'utf8');

  return {
    fullSha,
    shortSha,
    builtAt,
    appHtmlPath,
    buildInfoPath
  };
}

async function main() {
  const args = process.argv.slice(2);
  const targetDir = args[0];
  const explicitSha = args[1];

  if (!targetDir) {
    console.error('Usage: node build-attribution.mjs <targetDir> [commitSha]');
    process.exit(1);
  }

  try {
    const result = stampBuildAttribution(targetDir, explicitSha);
    console.log(`BUILD_ATTRIBUTION_PASS: shortSha=${result.shortSha} fullSha=${result.fullSha}`);
  } catch (err) {
    console.error(`BUILD_ATTRIBUTION_FAIL: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}

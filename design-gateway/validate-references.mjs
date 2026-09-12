import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const versionsRoot = join(root, 'versions');

async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

function extractReferences(text, css) {
  const references = [];
  if (css) {
    for (const match of text.matchAll(/url\(\s*["']?([^'")]+)["']?\s*\)/gi)) references.push(match[1]);
    for (const match of text.matchAll(/@import\s+["']([^"']+)["']/gi)) references.push(match[1]);
    return references;
  }

  const markup = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const match of markup.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) references.push(match[1]);
  for (const match of markup.matchAll(/\bsrcset\s*=\s*["']([^"']*)["']/gi)) {
    for (const part of match[1].split(',')) {
      const reference = part.trim().split(/\s+/)[0];
      if (reference) references.push(reference);
    }
  }
  return references;
}

function isLocalStaticReference(reference) {
  return reference &&
    !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference) &&
    !reference.includes('${') &&
    !reference.includes('`') &&
    !reference.includes('(') &&
    !/^blob(?:$|:)/i.test(reference);
}

function normalizeReference(reference) {
  const withoutQuery = reference.split('?')[0].split('#')[0];
  if (!withoutQuery) return '';
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

const files = await walk(versionsRoot);
const fileSet = new Set(files);
const allowedMissing = new Map([
  [
    'versions/pr378/site/app.html|index3.html?variant=v3&amp;build=20260907',
    'PR #378 frozen historical navigation; preserve the source limitation byte-for-byte.',
  ],
]);
const missing = [];
const allowed = [];
let checked = 0;

for (const file of files) {
  const css = /\.css$/i.test(file);
  const html = /\.html?$/i.test(file);
  if (!css && !html) continue;

  const text = await readFile(file, 'utf8');
  for (const rawReference of extractReferences(text, css)) {
    const reference = rawReference.trim();
    if (!isLocalStaticReference(reference)) continue;
    const normalized = normalizeReference(reference);
    if (!normalized || !/\.(?:html?|css|js|png|jpe?g|webp|gif|svg|txt|json|woff2?|ico|mp4|webm)$/i.test(normalized)) continue;
    checked += 1;

    let decoded = normalized;
    const relativeFile = relative(root, file).replaceAll('\\', '/');
    const versionId = relativeFile.split('/')[1];
    try {
      decoded = decodeURIComponent(normalized);
    } catch {
      // Keep the undecoded path when a malformed escape is present.
    }
    const target = decoded.startsWith('/')
      ? join(versionsRoot, versionId, decoded.replace(/^\/+/, ''))
      : resolve(dirname(file), decoded);
    if (fileSet.has(target)) continue;

    const key = `${relativeFile}|${reference}`;
    const explanation = allowedMissing.get(key);
    if (explanation) allowed.push({ key, explanation });
    else missing.push({ file: relativeFile, reference, target: relative(root, target).replaceAll('\\', '/') });
  }
}

assert.deepEqual(missing, [], `Unexpected missing local references: ${JSON.stringify(missing, null, 2)}`);
console.log(`static design references: PASS checked=${checked} missing=${missing.length} allowed=${allowed.length}`);
for (const item of allowed) console.log(`  ALLOWED ${item.key}: ${item.explanation}`);

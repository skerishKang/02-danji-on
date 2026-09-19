import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');

const htmlFiles = readdirSync(frontend).filter(f => f.endsWith('.html'));

assert.ok(htmlFiles.length >= 28, `expected at least 28 html files, found ${htmlFiles.length}`);

for (const file of htmlFiles) {
  const content = readFileSync(join(frontend, file), 'utf8');

  // Guard against literal backslash-n before head and body tags
  assert.ok(!content.includes('\\n</head>'), `${file}: must not contain literal '\\n</head>' artifact`);
  assert.ok(!content.includes('\\n</body>'), `${file}: must not contain literal '\\n</body>' artifact`);

  // Ensure no unescaped '\\n' string appears outside script and style blocks
  const matches = [...content.matchAll(/\\n/g)];
  for (const m of matches) {
    const before = content.slice(0, m.index);
    const lastScriptOpen = before.lastIndexOf('<script');
    const lastScriptClose = before.lastIndexOf('</script>');
    const lastStyleOpen = before.lastIndexOf('<style');
    const lastStyleClose = before.lastIndexOf('</style>');
    const inScript = lastScriptOpen > lastScriptClose;
    const inStyle = lastStyleOpen > lastStyleClose;
    assert.ok(inScript || inStyle, `${file}: contains unexpected raw '\\n' string at index ${m.index}`);
  }
}

console.log(`leaf-b788-visual-syntax-integrity-contract: PASS files=${htmlFiles.length}`);

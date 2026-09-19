import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apply = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');
const greeting = await readFile(new URL('../../../frontend/14_가입인사_글쓰기.html', import.meta.url), 'utf8');
const story = await readFile(new URL('../../../frontend/15_단지이야기_글쓰기.html', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../../../frontend/assets/application-report-bridge.js', import.meta.url), 'utf8');

assert.match(apply, /const UPLOAD_POLICIES=/);
assert.match(apply, /8\*1024\*1024/);
assert.match(apply, /10\*1024\*1024/);
assert.match(apply, /image\/jpeg.*image\/png.*image\/webp/);
assert.match(apply, /application\/pdf/);
assert.match(apply, /data-file-add="photos"/);
assert.match(apply, /file-remove/);
assert.match(apply, /선택한 파일은 보존되며 다시 시도할 수 있습니다/);
assert.match(apply, /idempotency-key/);
assert.match(apply, /entry\.key/);
assert.match(apply, /파일당 최대 8MB/);
assert.match(apply, /파일당 최대 10MB/);
assert.match(apply, /사진은 JPG, PNG, WebP만 첨부할 수 있습니다/);
assert.match(apply, /storage-unavailable/);
assert.match(apply, /STORAGE_NOT_CONFIGURED/);
assert.match(apply, /response\.status===503\|\|code==='STORAGE_NOT_CONFIGURED'\?'storage-unavailable'/);
assert.match(apply, /사진 저장 서버가 아직 준비되지 않았습니다/);
assert.match(apply, /서류 저장 서버가 아직 준비되지 않았습니다/);
assert.match(apply, /ceo@padiem\.net/);
assert.doesNotMatch(apply, /\.hwp|\.hwpx|accept="image\/\*"/);

assert.doesNotMatch(greeting, /id="photoBtn"|id="photos"|최대 3/);
assert.doesNotMatch(story, /id="photoBtn"|id="photos"|최대 3/);
assert.match(greeting, /서버 사진 첨부를 지원하지 않습니다/);
assert.match(story, /서버 사진 첨부를 지원하지 않습니다/);

assert.match(bridge, /file-too-large/);
assert.match(bridge, /file-type/);

console.log('leaf-b766-attachment-contract: PASS');

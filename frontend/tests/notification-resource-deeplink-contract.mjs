import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../27_알림함.html', import.meta.url), 'utf8');
const match = page.match(/<script id="danjion-notifications-live-wiring-330">([\s\S]*?)<\/script>/);
assert.ok(match, 'canonical notification wiring must exist');
const wiring = match[1];

assert.match(wiring, /RESOURCE_UUID=\/\^\[0-9a-f\]\{8\}-/, 'resource identifiers are UUID-validated');
assert.match(wiring, /conversation:\{file:'21_메시지_대화상세\.html',key:'conversation'\}/, 'conversation has a canonical internal route');
assert.match(wiring, /resident_news:\{file:'11_주민소식_상세\.html',key:'postId'\}/, 'resident_news has the current canonical detail route');
assert.match(wiring, /community_post:\{file:'13_이웃대화_글상세_댓글\.html',key:'post'\}/, 'community_post has the current canonical detail route');
assert.match(wiring, /data-resource-type=/, 'live rows preserve the allowlist input');
assert.match(wiring, /data-resource-id=/, 'live rows preserve the resource identifier');
assert.match(wiring, /const result=await bridge\.markNotificationRead\(item\.dataset\.notification\);[\s\S]*?const destination=resolveNotificationDestination/, 'mark-read is attempted before navigation');
assert.match(wiring, /if\(!destination\)\{[\s\S]*?이동할 수 있는 대상이 아닙니다/, 'unknown and malformed resources stay non-navigable');
assert.match(wiring, /location\.href=destination/, 'navigation uses only the bounded resolver destination');
assert.doesNotMatch(wiring, /https?:\/\//, 'notification resolver must not introduce external navigation');
assert.doesNotMatch(wiring, /new URL\([^)]*resource|decodeURIComponent\([^)]*resource/, 'resource values are not treated as arbitrary URLs');

console.log('notification resource deep-link contract: PASS');

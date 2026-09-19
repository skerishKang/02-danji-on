import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL('../' + relative, import.meta.url), 'utf8');
const readBackend = (relative) => readFile(new URL('../../04_개발/backend/src/' + relative, import.meta.url), 'utf8');

const [
  list,
  hello,
  story,
  question,
  together,
  detail,
  bridge,
  backend,
  auth
] = await Promise.all([
  read('12_이웃대화_첫화면.html'),
  read('14_가입인사_글쓰기.html'),
  read('15_단지이야기_글쓰기.html'),
  read('16_궁금해요_글쓰기.html'),
  read('17_같이해요_글쓰기.html'),
  read('13_이웃대화_글상세_댓글.html'),
  read('assets/community-bridge.js'),
  readBackend('community-resident-v1.ts'),
  readBackend('auth-v1.ts')
]);

// A resident-authored item must never be replaced by prototype/demo identities.
assert.doesNotMatch(list, /const\s+POSTS\s*=/);
assert.doesNotMatch(list, /연블리|초록문|길고양이|봄날/);
assert.match(list, /result\.posts/);
assert.match(list, /p\.author\.nickname/);

// The four write leaves may keep draft/local form state, but publication itself
// is server-only. No optimistic/demo "posted" success handler may coexist.
for (const [name, html] of Object.entries({ hello, story, question, together })) {
  assert.match(html, /bridge\.createPost\(/, name + ' must submit through community bridge');
  assert.match(html, /r\.ok&&r\.mode==='server'/, name + ' must require server success');
  assert.doesNotMatch(html, /addEventListener\('click',publish\)/, name + ' must not bind legacy local publish');
  assert.doesNotMatch(html, /setTimeout\(\(\)=>location\.href=COMMUNITY,650\)/, name + ' must not fake local success redirect');
}

// Community bridge only normalizes author identity supplied by the server.
assert.match(bridge, /nickname:\s*String\(author\.nickname\s*\?\?\s*''\)/);
assert.doesNotMatch(bridge, /연블리/);

// Detail, comments and replies render only server-provided author.nickname.
assert.match(detail, /post\.author\.nickname/);
assert.match(detail, /c\.author\.nickname/);
assert.match(detail, /r\.author\.nickname/);
assert.doesNotMatch(detail, /연블리/);

// Backend identity chain: authenticated subject -> app_users.display_name ->
// resident.displayName -> response author.nickname.
assert.match(auth, /select id, auth_user_id, display_name, account_status[\s\S]*from app_users[\s\S]*where auth_user_id = \$\{subject\}/);
assert.match(auth, /displayName:\s*String\(row\.display_name\)/);
assert.match(backend, /row\.author_nickname = resident\.displayName/);
assert.match(backend, /author:\s*\{ nickname: String\(row\.author_nickname \?\? ''\) \}/);

console.log('leaf-b803-community-author-identity-contract: PASS');

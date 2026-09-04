import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [view, api, css] = await Promise.all([
  readFile(new URL('src/v2/visual/V2CommunityView.tsx', root), 'utf8'),
  readFile(new URL('src/community-api.ts', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-community.css', root), 'utf8')
]);

// 2026-09-04 integrated 008 authority.
const authority = Object.freeze({
  first: { name: '12_이웃대화_첫화면.html', driveId: '1BX0uxy-cpEw53PQ4C69GiJwiAUYN4h5c' },
  detail: { name: '13_이웃대화_글상세_댓글.html', driveId: '17c0dtPK7p0wcKtHVZ9X9ViL4skzec_g4' },
  greeting: { name: '14_가입인사_글쓰기.html', driveId: '1cWewexlsmZW6c9l1fObpDcP0CQ0eV2ZK' },
  story: { name: '15_단지이야기_글쓰기.html', driveId: '1G8yTLJuLTSWi2iz0Uas4xCAWQmG8E5lY' },
  question: { name: '16_궁금해요_글쓰기.html', driveId: '19DfRnTUIvv5_zdBG1rbDRnn0ghx_impM' },
  together: { name: '17_같이해요_글쓰기.html', driveId: '1MYaTdG2k_wiJX4ZSiasfhl3TRskBVxkH' }
});
assert.equal(Object.keys(authority).length, 6);

// Screen 12 must be a resident neighbor-conversation surface, not a second
// official-news aggregator. Official/public complex_posts live on their own
// resident-news boundary (#257 remains separate from B3).
assert.match(view, /우리 단지 주민이 직접 쓰고 대화하는 공간/);
assert.match(view, />이웃대화</);
for (const label of ['가입인사', '단지이야기', '궁금해요', '같이해요']) {
  assert.match(view, new RegExp(label));
}
assert.match(view, /지금 올라온 이야기/);
assert.doesNotMatch(view, /dataAdapter\.listPosts\(\)/);
assert.doesNotMatch(view, /source: 'official'/);
assert.doesNotMatch(view, /'공식소식'/);
assert.doesNotMatch(view, /'우리 단지의 변화'/);
assert.doesNotMatch(view, /'함께하는 곳'/);

// Existing resident API is the only persistence authority for B3.
assert.match(view, /communityApi\.listPosts\(\)/);
assert.match(view, /communityApi\.createPost/);
assert.match(view, /communityApi\.listComments/);
assert.match(view, /communityApi\.createComment/);
assert.match(view, /communityApi\.createReply/);
assert.match(view, /communityApi\.setLike/);
assert.match(view, /communityApi\.report/);
assert.match(api, /kind:\s*CommunityPostKind/);
assert.match(api, /title:\s*string/);
assert.match(api, /body:\s*string/);

// Screen 13 keeps the real detail/comment/reply/reaction interaction; no HTML
// injection is allowed while rendering resident content.
assert.match(view, /댓글/);
assert.match(view, /답글/);
assert.match(view, /공감/);
assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
assert.doesNotMatch(view, /innerHTML\s*=/);

// Unsupported 12-17 design fields must not be silently encoded into title/body
// or browser-only persistence. Dedicated greeting kind, attachments, question
// subtypes and structured together fields require a backend contract before use.
assert.doesNotMatch(view, /localStorage/);
assert.doesNotMatch(view, /sessionStorage/);
assert.doesNotMatch(view, /JSON\.stringify\([^)]*(attachment|subtype|meeting|participant)/i);
assert.doesNotMatch(api, /attachment_ids|attachments|question_subtype|together_type/);

// Keep the dedicated visual boundary and responsive stylesheet in place.
assert.match(view, /\.\/v2-community\.css/);
assert.match(css, /@media \(max-width:560px\)/);

console.log('PASS V2 008 neighbor conversation authority contract');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [view, api, css, authorityCss] = await Promise.all([
  readFile(new URL('src/v2/visual/V2CommunityView.tsx', root), 'utf8'),
  readFile(new URL('src/community-api.ts', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-community.css', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-community-008.css', root), 'utf8')
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

// 2026-09-05 TRACK K: '우리 단지의 변화' belongs to the 회장인사 archive
// (handoff 09_회장인사_상세.html, impl V2Gate1ResidentHome), not to the 12-17
// community surface. The doesNotMatch below pins that relocation.
const RELOCATED_NEIGHBOR_CONVERSATION = [
  { anchor: '우리 단지의 변화', authority: '09_회장인사_상세.html', impl: 'V2Gate1ResidentHome.tsx (negative pin)' }
];
for (const reloc of RELOCATED_NEIGHBOR_CONVERSATION) {
  assert.ok(reloc.anchor.length > 0 && reloc.authority.length > 0 && reloc.impl.length > 0,
    `relocated neighbor-conversation anchor must name its new authority/impl: ${reloc.anchor}`);
}

// Screen 12 must be a resident neighbor-conversation surface, not a second
// official-news aggregator. Official/public complex_posts live on their own
// resident-news boundary (#257 remains separate from B3).
assert.match(view, /우리 단지 주민이 직접 쓰고 대화하는 공간/);
assert.match(view, />이웃대화</);
for (const label of ['가입인사', '단지이야기', '궁금해요', '같이해요']) {
  assert.match(view, new RegExp(label));
}
assert.match(view, /const \[tab, setTab\] = useState<Tab>\('가입인사'\)/,
  '12 authority must start on 가입인사 rather than an invented all-feed default');
assert.match(view, /const selectedWriteKind: ConversationKind = tab === '전체' \? '가입인사' : tab/);
assert.match(view, /onClick=\{\(\) => startWriting\(selectedWriteKind\)\}>\{selectedWriteKind\} 글쓰기/,
  'desktop write CTA must follow the selected 12 category');
assert.match(view, /aria-label="현재 카테고리 글쓰기"[\s\S]*startWriting\(selectedWriteKind\)/,
  'mobile write CTA must follow the same selected category');
assert.match(view, /지금 올라온 이야기/);
assert.match(view, /전체 보기/);
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
assert.match(view, /communityApi\.listReplies/);
assert.match(view, /communityApi\.createReply/);
assert.match(view, /communityApi\.setLike/);
assert.match(view, /communityApi\.report/);
assert.match(api, /kind:\s*CommunityPostKind/);
assert.match(api, /title:\s*string/);
assert.match(api, /body:\s*string/);
assert.match(view, /communityApi\.createPost\(\{ kind: WRITE_KIND_TO_API\[writeKind\], title, body \}\)/);

// Screen 13 keeps the real detail/comment/reply/reaction interaction; no HTML
// injection is allowed while rendering resident content.
assert.match(view, /← 이웃대화/);
assert.match(view, /\/ 글 상세/);
assert.match(view, /따뜻한 인사나 도움이 되는 답변을 남겨보세요/);
assert.match(view, /서로 존중하는 말로 이야기해 주세요/);
assert.match(view, /댓글 등록/);
assert.match(view, /답글/);
assert.match(view, /♡ 공감/);
assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
assert.doesNotMatch(view, /innerHTML\s*=/);

// Screen 14: there is no server greeting kind. Keep the user-facing entry but
// block persistence instead of disguising a greeting as resident_story.
assert.match(view, /가입인사 전용 글쓰기는 서버 카테고리 계약이 추가된 뒤 열립니다/);
assert.match(view, /다른 글 종류로 대신 저장하지 않습니다/);
assert.doesNotMatch(view, /가입인사:\s*'resident_story'/);

// Screen 15: the representable title/body editor follows the authority copy and
// persists through the existing resident_story contract only.
assert.match(view, /단지에서 나누고 싶은 이야기를 바로 적어보세요/);
assert.match(view, /종류는 이미 선택했습니다\. 바로 작성하면 됩니다/);
assert.match(view, /오늘 단지에서 있었던 일을 알려주세요/);
assert.match(view, /단지이야기 게시하기/);
assert.match(view, /단지이야기:\s*'resident_story'/);

// Screen 16: preserve the authority's visible subtype/answer-method vocabulary,
// but keep unsupported subtype/photo/per-post message settings non-persistent.
assert.match(view, /궁금한 종류를 고르고 바로 물어보세요/);
for (const label of ['생활·살림', '단지시설', '이웃추천', '기타']) assert.match(view, new RegExp(label));
assert.match(view, /댓글로 답변받기/);
assert.match(view, /기본 사용/);
assert.match(view, /1:1 메시지도 받기/);
assert.match(view, /질문 게시하기/);
assert.match(view, /궁금해요:\s*'question'/);
assert.doesNotMatch(view, /name="(?:questionSubtype|question_subtype|messageOptIn|message_opt_in)"/);

// Screen 17: preserve the four authority type labels and safety copy while only
// title/body are sent through the existing together contract.
assert.match(view, /함께할 일을 고르고 필요한 정보만 적어보세요/);
for (const label of ['산책·운동', '취미활동', '육아 같이해요', '공동구매']) assert.match(view, new RegExp(label));
assert.match(view, /공개 글에는 개인 연락처를 적지 마세요\. 필요한 연락은 단지온 메시지를 이용합니다/);
assert.match(view, /같이해요 게시하기/);
assert.match(view, /같이해요:\s*'together'/);
assert.doesNotMatch(view, /name="(?:togetherType|together_type|meeting|participant|dynamicFields)"/);

// Unsupported 12-17 design fields must not be silently encoded into title/body
// or browser-only persistence. Dedicated greeting kind, attachments, question
// subtypes and structured together fields require a backend contract before use.
assert.doesNotMatch(view, /localStorage/);
assert.doesNotMatch(view, /sessionStorage/);
assert.doesNotMatch(view, /JSON\.stringify\([^)]*(attachment|subtype|meeting|participant)/i);
assert.doesNotMatch(api, /attachment_ids|attachments|question_subtype|together_type/);
assert.match(view, /사진 첨부는 현재 Community create 계약에 없어/);
assert.match(view, /질문 유형·사진·게시글별 1:1 수신 설정은 저장하지 않습니다/);
assert.match(view, /같이해요 유형과 구조화 필드는 저장하지 않습니다/);

// Keep base safety/modal CSS first and current 008 authority CSS second so
// equal-specificity visual rules cannot be overwritten by the legacy base.
assert.match(view, /import '\.\/v2-community\.css';\s*import '\.\/v2-community-008\.css';/);
assert.doesNotMatch(css, /@import '\.\/v2-community-008\.css'/);
assert.match(authorityCss, /\.v2-community-write-type-tabs/);
assert.match(authorityCss, /@media \(max-width:560px\)/);

console.log('PASS V2 008 neighbor conversation authority contract');
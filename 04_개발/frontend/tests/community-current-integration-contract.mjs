import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, view, topbar, residentBackend] = await Promise.all([
  readFile(new URL('src/community-api.ts', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2CommunityView.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2Topbar.tsx', root), 'utf8'),
  readFile(new URL('../backend/src/community-resident-v1.ts', root), 'utf8')
]);

// The Product Shell adapter must use the same authenticated resident boundary as
// the rest of the live product. Local React state is not authoritative in API mode.
assert.match(api, /authenticatedFetch/);
assert.match(api, /VITE_DATA_MODE === 'api'/);
assert.match(api, /\/community\/posts/);
assert.match(api, /\/comments/);
assert.match(api, /\/reactions/);
assert.match(api, /\/community\/reports/);
assert.match(api, /method: active \? 'POST' : 'DELETE'/);

// Official complex_posts remain a separate public read boundary while resident
// Community content and mutations use the resident-only API.
assert.match(view, /dataAdapter\.listPosts\(\)/);
assert.match(view, /communityApi\.listPosts\(\)/);
assert.match(view, /communityApi\.createPost/);
assert.match(view, /communityApi\.listComments/);
assert.match(view, /communityApi\.createComment/);
assert.match(view, /communityApi\.setLike/);
assert.match(view, /communityApi\.report/);
assert.match(view, /source: 'official'/);
assert.match(view, /source: 'resident'/);

// Household-v2 authorization is server-authoritative. A successful resident feed
// can promote the UI badge; 401/403 must keep the Community surface locked.
assert.match(view, /CommunityApiError/);
assert.match(view, /error\.status === 401 \|\| error\.status === 403/);
assert.match(view, /onVerified\?\.\(\)/);
assert.match(topbar, /onVerified=\{\(\) => setResidentVerified\(true\)\}/);
assert.match(residentBackend, /requireVerifiedResident\(request, env, sql, requestId, complexSlug\)/);

// Client screening is UX assistance only; server response status determines whether
// a newly-created resident post/comment is published or pending review.
assert.match(view, /pending: post\.status !== 'published'/);
assert.match(view, /pending: comment\.status !== 'published'/);
assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
assert.doesNotMatch(view, /innerHTML\s*=/);

// The current Product Shell must not mutate official complex_posts through the
// resident Community mutation endpoints.
assert.match(view, /selected\.source === 'resident'/);
assert.match(view, /공식 단지 콘텐츠는 기존 public 게시물 경계에서 읽기 전용/);

console.log('PASS Community C5 current Product Shell API integration contract');

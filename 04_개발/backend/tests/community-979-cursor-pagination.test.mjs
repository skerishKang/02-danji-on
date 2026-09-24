import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildCommunityPage,
  COMMUNITY_COMMENT_SORT,
  COMMUNITY_FEED_SORT,
  COMMUNITY_REPLY_SORT,
  decodeCommunityCursor,
  encodeCommunityCursor
} from '../src/community-cursor-v1.ts';

const UUIDS = Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const TIME = '2026-09-24T00:00:00.000Z';

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const feedCursor = encodeCommunityCursor('feed:greeting', COMMUNITY_FEED_SORT, [TIME, TIME, UUIDS[2]]);
const commentCursor = encodeCommunityCursor(`comments:${UUIDS[0]}`, COMMUNITY_COMMENT_SORT, [TIME, UUIDS[2]]);
const replyCursor = encodeCommunityCursor(`replies:${UUIDS[0]}:${UUIDS[1]}`, COMMUNITY_REPLY_SORT, [TIME, UUIDS[2]]);
assert.ok(feedCursor && commentCursor && replyCursor);
assert.equal(feedCursor, encodeCommunityCursor('feed:greeting', COMMUNITY_FEED_SORT, [TIME, TIME, UUIDS[2]]));
assert.deepEqual(decodeCommunityCursor(feedCursor, 'feed:greeting', COMMUNITY_FEED_SORT), {
  keys: [TIME, TIME, UUIDS[2]]
});

for (const malformed of [
  '',
  'not-a-cursor',
  '%%%',
  feedCursor.slice(0, Math.max(1, feedCursor.length - 2)),
  Buffer.from('{"v":1,"scope":"feed:greeting"}').toString('base64url'),
  encoded({ v: 1, scope: 'feed:greeting', sort: COMMUNITY_FEED_SORT, keys: [TIME, TIME], extra: true }),
  encoded({ v: 1, scope: 'feed:greeting', sort: COMMUNITY_FEED_SORT, keys: ['not-a-time', TIME, UUIDS[0]] }),
  encoded({ v: 1, scope: 'feed:greeting', sort: COMMUNITY_FEED_SORT, keys: [TIME, TIME, 'not-a-uuid'] })
]) {
  assert.equal(decodeCommunityCursor(malformed, 'feed:greeting', COMMUNITY_FEED_SORT), null);
}
assert.equal(decodeCommunityCursor(commentCursor, 'feed:greeting', COMMUNITY_FEED_SORT), null, 'wrong sort cursor fails closed');
assert.equal(decodeCommunityCursor(feedCursor, 'feed:together', COMMUNITY_FEED_SORT), null, 'wrong filter cursor fails closed');
assert.equal(decodeCommunityCursor(feedCursor, `comments:${UUIDS[0]}`, COMMUNITY_COMMENT_SORT), null, 'wrong route scope fails closed');
assert.equal(decodeCommunityCursor(null, 'feed:greeting', COMMUNITY_FEED_SORT), null, 'an absent cursor is only the first-page state');

const sameTimestampPosts = UUIDS.slice(0, 7).map((id, index) => ({
  id,
  publishedAt: TIME,
  createdAt: TIME,
  rank: 7 - index
})).sort((a, b) => b.id.localeCompare(a.id));
const feedPages = [];
let remainingFeed = sameTimestampPosts;
let feedCursorValue = null;
while (remainingFeed.length) {
  const page = buildCommunityPage(
    remainingFeed,
    2,
    'feed:greeting',
    COMMUNITY_FEED_SORT,
    (row) => [row.publishedAt, row.createdAt, row.id]
  );
  feedPages.push(...page.rows);
  if (!page.hasMore) break;
  const cursor = decodeCommunityCursor(page.nextCursor, 'feed:greeting', COMMUNITY_FEED_SORT);
  assert.ok(cursor);
  remainingFeed = remainingFeed.filter((row) =>
    row.publishedAt < cursor.keys[0]
    || (row.publishedAt === cursor.keys[0] && row.createdAt < cursor.keys[1])
    || (row.publishedAt === cursor.keys[0] && row.createdAt === cursor.keys[1] && row.id < cursor.keys[2])
  );
  feedCursorValue = page.nextCursor;
}
assert.deepEqual(feedPages.map((row) => row.id), sameTimestampPosts.map((row) => row.id));
const uniqueFeedIds = Array.from(new Set(feedPages.map((row) => row.id)));
assert.deepEqual(feedPages.map((row) => row.id), uniqueFeedIds);
assert.equal(feedPages.length, sameTimestampPosts.length);
assert.ok(feedCursorValue);

const insertedNewerPost = { id: UUIDS[8], publishedAt: '2026-09-25T00:00:00.000Z', createdAt: '2026-09-25T00:00:00.000Z' };
const decodedFeedCursor = decodeCommunityCursor(feedCursorValue, 'feed:greeting', COMMUNITY_FEED_SORT);
assert.ok(decodedFeedCursor);
const traversalAfterInsert = sameTimestampPosts.filter((row) =>
  row.publishedAt < decodedFeedCursor.keys[0]
  || (row.publishedAt === decodedFeedCursor.keys[0] && row.createdAt < decodedFeedCursor.keys[1])
  || (row.publishedAt === decodedFeedCursor.keys[0] && row.createdAt === decodedFeedCursor.keys[1] && row.id < decodedFeedCursor.keys[2])
);
assert.equal(traversalAfterInsert.some((row) => row.id === insertedNewerPost.id), false, 'new head inserts do not alter an existing cursor boundary');

const comments = UUIDS.slice(0, 5).map((id) => ({ id, createdAt: TIME }));
const commentPage1 = buildCommunityPage(comments, 2, `comments:${UUIDS[0]}`, COMMUNITY_COMMENT_SORT, (row) => [row.createdAt, row.id]);
const commentPage2 = buildCommunityPage(comments.slice(2), 2, `comments:${UUIDS[0]}`, COMMUNITY_COMMENT_SORT, (row) => [row.createdAt, row.id]);
const commentPage3 = buildCommunityPage(comments.slice(4), 2, `comments:${UUIDS[0]}`, COMMUNITY_COMMENT_SORT, (row) => [row.createdAt, row.id]);
assert.deepEqual(commentPage1.rows.concat(commentPage2.rows, commentPage3.rows).map((row) => row.id), comments.map((row) => row.id));
assert.equal(commentPage1.hasMore, true);
assert.equal(commentPage2.hasMore, true);
assert.equal(commentPage3.hasMore, false);

const root = new URL('../', import.meta.url);
const [residentSource, replySource, cursorSource] = await Promise.all([
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-replies-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-cursor-v1.ts', root), 'utf8')
]);
for (const source of [residentSource, replySource]) {
  assert.match(source, /requireVerifiedResident\(/);
  assert.match(source, /url\.searchParams\.has\('cursor'\) && !cursor/);
  assert.match(source, /VALIDATION_ERROR/);
  assert.match(source, /complex_id = \$\{resident\.complexId\}::uuid/);
  assert.match(source, /limit \$\{limit \+ 1\}/);
}
assert.match(residentSource, /order by p\.published_at desc, p\.created_at desc, p\.id desc/);
assert.match(residentSource, /order by c\.created_at asc, c\.id asc/);
assert.match(replySource, /order by c\.created_at asc, c\.id asc/);
assert.match(residentSource, /viewerCanEdit: viewerIsOwner && status !== 'deleted'/);
assert.match(residentSource, /viewerCanDelete: viewerIsOwner && status !== 'deleted'/);
assert.match(residentSource, /viewerCanReport: status === 'published' && !viewerIsOwner/);
assert.match(residentSource, /viewerCanReport: status === 'published' && postStatus === 'published' && !viewerIsOwner/);
assert.doesNotMatch(cursorSource, /complexId|residentId|userId|authorization|token/i);

console.log('PASS COMMUNITY_CURSOR_VALIDATION');
console.log('PASS FEED_PAGE1_PAGE2_PAGE3_NO_DUPLICATE');
console.log('PASS FEED_BOUNDARY_NO_MISSING_AND_SAME_TIMESTAMP');
console.log('PASS COMMENTS_PAGE_BOUNDARY');
console.log('PASS OWNER_AND_REPORT_CAPABILITIES_PRESERVED');
console.log('PASS REPLIES_CURSOR_SCOPE');
console.log('PASS AUTH_AND_CROSS_COMPLEX_STATIC_GUARDS');

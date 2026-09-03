export type MockResidentNewsStatus = 'submitted' | 'reviewing' | 'approved' | 'rejected';

export type MockResidentNewsPost = {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  createdAt: string | null;
};

export type MockResidentNewsSubmission = {
  id: string;
  title: string;
  body: string;
  status: MockResidentNewsStatus;
  reviewNote: string | null;
  submitterNickname: string;
  publishedPostId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  ownedByCurrentResident: boolean;
};

export type MockResidentNewsReviewInput = {
  action: 'reviewing' | 'approve' | 'reject';
  reviewNote?: string;
  publishedTitle?: string;
  publishedBody?: string;
};

let posts: MockResidentNewsPost[] = [
  {
    id: '00000000-0000-4000-8000-000000000281',
    title: '우리 단지 산책길 정비 소식',
    body: '주민 제보를 운영 확인한 뒤 게시한 주민소식 예시입니다.',
    publishedAt: '2026-09-02T09:00:00.000Z',
    createdAt: '2026-09-02T09:00:00.000Z'
  }
];

let submissions: MockResidentNewsSubmission[] = [
  {
    id: '00000000-0000-4000-8000-000000000282',
    title: '공용 자전거 거치대 제보',
    body: '후문 쪽 자전거 거치대가 기울어져 있어 정비가 필요해 보입니다.',
    status: 'reviewing',
    reviewNote: null,
    submitterNickname: '입주민',
    publishedPostId: null,
    createdAt: '2026-09-02T08:00:00.000Z',
    updatedAt: '2026-09-02T08:30:00.000Z',
    ownedByCurrentResident: true
  },
  {
    id: '00000000-0000-4000-8000-000000000283',
    title: '어린이 놀이터 그늘막 점검 요청',
    body: '놀이터 그늘막 한쪽 고정 부분이 느슨해 보여 확인을 부탁드립니다.',
    status: 'submitted',
    reviewNote: null,
    submitterNickname: '놀이터지킴이',
    publishedPostId: null,
    createdAt: '2026-09-01T07:20:00.000Z',
    updatedAt: '2026-09-01T07:20:00.000Z',
    ownedByCurrentResident: false
  },
  {
    id: '00000000-0000-4000-8000-000000000284',
    title: '재활용 분리배출 안내 제안',
    body: '새로 이사 온 주민을 위해 분리배출 시간 안내를 주민소식에 올리면 좋겠습니다.',
    status: 'approved',
    reviewNote: '안내 문구를 간단히 다듬어 게시',
    submitterNickname: '초록이웃',
    publishedPostId: '00000000-0000-4000-8000-000000000285',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T11:00:00.000Z',
    ownedByCurrentResident: false
  },
  {
    id: '00000000-0000-4000-8000-000000000286',
    title: '주차장 개인 연락처 공유 요청',
    body: '주차 연락을 위해 주민 연락처를 모아서 올리면 좋겠습니다.',
    status: 'rejected',
    reviewNote: '개인정보가 포함될 수 있어 주민소식으로 게시하지 않음',
    submitterNickname: '주차도우미',
    publishedPostId: null,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:30:00.000Z',
    ownedByCurrentResident: false
  }
];

posts.push({
  id: '00000000-0000-4000-8000-000000000285',
  title: '재활용 분리배출 시간 안내',
  body: '재활용품은 지정된 요일과 시간에 분리배출해 주세요.',
  publishedAt: '2026-08-31T11:00:00.000Z',
  createdAt: '2026-08-31T11:00:00.000Z'
});

function copyPost(post: MockResidentNewsPost): MockResidentNewsPost {
  return { ...post };
}

function copySubmission(submission: MockResidentNewsSubmission): MockResidentNewsSubmission {
  return { ...submission };
}

export function listMockResidentNewsPosts(): MockResidentNewsPost[] {
  return posts.map(copyPost);
}

export function getMockResidentNewsPost(postId: string): MockResidentNewsPost | null {
  const found = posts.find((item) => item.id === postId);
  return found ? copyPost(found) : null;
}

export function createMockResidentNewsSubmission(
  input: { title: string; body: string },
  submitterNickname = '입주민'
): MockResidentNewsSubmission {
  const now = new Date().toISOString();
  const created: MockResidentNewsSubmission = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    status: 'submitted',
    reviewNote: null,
    submitterNickname,
    publishedPostId: null,
    createdAt: now,
    updatedAt: now,
    ownedByCurrentResident: true
  };
  submissions = [created, ...submissions];
  return copySubmission(created);
}

export function listMockOwnResidentNewsSubmissions(): MockResidentNewsSubmission[] {
  return submissions.filter((item) => item.ownedByCurrentResident).map(copySubmission);
}

export function listMockResidentNewsReviewQueue(status: MockResidentNewsStatus): MockResidentNewsSubmission[] {
  return submissions.filter((item) => item.status === status).map(copySubmission);
}

export function reviewMockResidentNewsSubmission(
  submissionId: string,
  input: MockResidentNewsReviewInput
): MockResidentNewsSubmission {
  const index = submissions.findIndex((item) => item.id === submissionId);
  if (index < 0) throw new Error('주민소식 제보를 찾을 수 없습니다.');

  const current = submissions[index];
  const reviewNote = input.reviewNote?.trim() || null;
  if ((reviewNote?.length || 0) > 1000) throw new Error('검토 메모는 1,000자 이하로 입력해 주세요.');
  const now = new Date().toISOString();

  if (input.action === 'reviewing') {
    if (current.status !== 'submitted') throw new Error('이 제보는 검토 시작 상태로 변경할 수 없습니다.');
    submissions[index] = { ...current, status: 'reviewing', reviewNote, updatedAt: now };
    return copySubmission(submissions[index]);
  }

  if (input.action === 'reject') {
    if (current.status !== 'submitted' && current.status !== 'reviewing') throw new Error('이 제보는 반려할 수 없습니다.');
    submissions[index] = { ...current, status: 'rejected', reviewNote, updatedAt: now };
    return copySubmission(submissions[index]);
  }

  if (current.status === 'approved' && current.publishedPostId) return copySubmission(current);
  if (current.status !== 'submitted' && current.status !== 'reviewing') throw new Error('이 제보는 승인할 수 없습니다.');

  const publishedTitle = input.publishedTitle?.trim() || current.title;
  const publishedBody = input.publishedBody?.trim() || current.body;
  if (!publishedTitle || publishedTitle.length > 160) throw new Error('게시 제목은 1~160자로 입력해 주세요.');
  if (!publishedBody || publishedBody.length > 10000) throw new Error('게시 내용은 1~10,000자로 입력해 주세요.');

  const postId = crypto.randomUUID();
  posts = [{
    id: postId,
    title: publishedTitle,
    body: publishedBody,
    publishedAt: now,
    createdAt: now
  }, ...posts];
  submissions[index] = {
    ...current,
    status: 'approved',
    reviewNote,
    publishedPostId: postId,
    updatedAt: now
  };
  return copySubmission(submissions[index]);
}

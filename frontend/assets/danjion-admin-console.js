(function (global) {
  'use strict';

  // Issue #460 [admin production]: the canonical V3 admin console surface.
  // Every section is a read-only GET against the existing production admin
  // endpoints; per-section access is decided by the SERVER (403 = scope not
  // granted, 503 = policy hold), never by client-side role inference. No write
  // verb exists in this module: mutation controls stay disabled until each
  // backend write path is separately implemented and reviewed. The privileged
  // (최고관리) area is placeholder-only because those write endpoints do not
  // exist yet.
  const COMPLEX_SLUG = 'banglim-myeongji-roadhill';

  const OPERATIONAL_SECTIONS = [
    {
      id: 'verifications',
      title: '입주민 인증 관리',
      description: '입주민 인증 요청과 확인 상태를 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/resident-verifications`
    },
    {
      id: 'applications',
      title: '등록 신청',
      description: '가게·서비스 등록 신청 원문과 검토 상태를 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/business-applications`
    },
    {
      id: 'reports',
      title: '가게 제보 심사',
      description: '주민 제보와 카테고리·관계 확정 상태를 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/shop-recommendations?status=pending`
    },
    {
      id: 'reviewHistory',
      title: '검토·감사 이력',
      description: '등록 신청의 상태 변경 이력을 시간순으로 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/application-review-events?limit=200`
    },
    {
      id: 'residentNews',
      title: '주민소식 검토',
      description: '게시 대기 중인 주민소식 원고를 조회합니다.',
      path: (slug) => `/api/v1/operator/complexes/${slug}/resident-news/submissions?status=pending`
    },
    {
      id: 'posts',
      title: '단지소식',
      description: '게시된 단지소식 목록을 조회합니다.',
      path: (slug) => `/api/v1/complexes/${slug}/posts?limit=20`
    },
    {
      id: 'benefits',
      title: '주민혜택',
      description: '운영 중인 주민혜택 목록을 조회합니다.',
      path: (slug) => `/api/v1/complexes/${slug}/benefits`
    }
  ];

  // #460: 최고관리 write endpoints do not exist yet — every control stays
  // disabled (mirrors the #412 view-only placeholder discipline).
  const PRIVILEGED_PLACEHOLDERS = [
    { id: 'users', title: '사용자 · 권한 관리', description: '관리자 계정과 운영 권한 부여를 관리합니다.' },
    { id: 'audit', title: '전체 감사 기록', description: '단지 전체의 운영 감사 이력을 조회합니다.' },
    { id: 'system', title: '민감정보 · 시스템 관리', description: '시스템 설정과 민감정보 접근을 관리합니다.' }
  ];

  function extractRows(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of ['applications', 'recommendations', 'submissions', 'posts', 'benefits', 'verifications', 'events', 'rows', 'items']) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  }

  // Sections are only ever rendered after the authority endpoint has already
  // granted an admin or operator surface (see DanjionAdminAuthority). The
  // privileged area additionally requires the server-resolved wildcard grant.
  function consoleSections(authority) {
    return {
      operational: OPERATIONAL_SECTIONS.slice(),
      privileged: global.DanjionAdminAuthority && global.DanjionAdminAuthority.isSuperAdminAuthority(authority)
        ? PRIVILEGED_PLACEHOLDERS.slice()
        : []
    };
  }

  async function loadSection(fetchImpl, apiBase, section, slug) {
    const session = global.DanjionSession;
    const result = await session.request(fetchImpl, session.joinUrl(String(apiBase || ''), section.path(slug || COMPLEX_SLUG)));
    if (result.ok) return { state: 'ready', rows: extractRows(result.data) };
    if (result.status === 401) return { state: 'signed-out' };
    if (result.status === 403) return { state: 'scope-denied' };
    if (result.status === 503) return { state: 'policy-hold', code: result.error && result.error.code ? String(result.error.code) : '' };
    return { state: 'error' };
  }

  function rowTitle(row) {
    if (!row || typeof row !== 'object') return '';
    const value = row.businessName ?? row.title ?? row.name ?? row.business_name ?? '';
    return String(value).slice(0, 80);
  }

  function rowStatus(row) {
    if (!row || typeof row !== 'object') return '';
    return String(row.status ?? '').slice(0, 40);
  }

  function rowMeta(row) {
    if (!row || typeof row !== 'object') return '';
    const parts = [];
    const applicant = row.applicantName || row.applicant_name || row.reporterNickname || row.submitterNickname || row.submitter_nickname;
    if (applicant) parts.push(String(applicant));
    const summary = row.serviceSummary || row.service_summary || row.body || row.description || '';
    if (summary) parts.push(String(summary).slice(0, 60));
    const createdAt = row.createdAt || row.created_at || '';
    if (createdAt) parts.push(String(createdAt).slice(0, 16));
    return parts.join(' · ');
  }

  global.DanjionAdminConsole = Object.freeze({
    COMPLEX_SLUG,
    OPERATIONAL_SECTIONS,
    PRIVILEGED_PLACEHOLDERS,
    extractRows,
    consoleSections,
    loadSection,
    rowTitle,
    rowStatus,
    rowMeta
  });
})(typeof window !== 'undefined' ? window : globalThis);

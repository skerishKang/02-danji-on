(function (global) {
  'use strict';

  // Issue #460 [admin production] + #607 [bounded review actions]: the canonical
  // V3 admin console surface. Per-section access is decided by the SERVER
  // (403 = scope not granted, 503 = policy hold), never by client-side role
  // inference. #607 activates exactly one pre-existing write authority:
  // PATCH /api/v1/admin/business-applications/:id. All other operational writes
  // and the privileged (최고관리) area remain disabled until separately reviewed.
  const COMPLEX_SLUG = 'banglim-myeongji-roadhill';

  const OPERATIONAL_SECTIONS = [
    {
      id: 'applications',
      requiredScope: 'business.review',
      title: '등록 신청',
      description: '가게·서비스 등록 신청을 검토하고 승인·수정요청·거절할 수 있습니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/business-applications`,
      reviewActions: true
    },
    {
      id: 'reports',
      requiredScope: 'business.review',
      title: '가게 제보 심사',
      description: '주민 제보와 카테고리·관계 확정 상태를 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/shop-recommendations?status=pending`
    },
    {
      id: 'reviewHistory',
      requiredScope: 'business.review',
      title: '검토·감사 이력',
      description: '등록 신청의 상태 변경 이력을 시간순으로 조회합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/application-review-events?limit=200`
    },
    {
      id: 'residentNews',
      requiredScope: 'resident_news.review',
      title: '주민소식 검토',
      description: '게시 대기 중인 주민소식 원고를 조회합니다.',
      path: (slug) => `/api/v1/operator/complexes/${slug}/resident-news/submissions?status=pending`
    },
    {
      id: 'posts',
      requiredScope: 'official-content.manage',
      title: '단지소식',
      description: '게시된 단지소식 목록을 조회합니다.',
      path: (slug) => `/api/v1/complexes/${slug}/posts?limit=20`
    },
    {
      id: 'benefits',
      requiredScope: 'benefit.manage',
      title: '주민혜택',
      description: '운영 중인 주민혜택 목록을 조회합니다.',
      path: (slug) => `/api/v1/complexes/${slug}/benefits`
    },
    {
      id: 'verifications',
      title: '입주민 인증 관리',
      description: '입주민 인증·개인정보 정책 승인 전까지 사용할 수 없습니다.',
      policyHold: true,
      path: (slug) => `/api/v1/admin/complexes/${slug}/resident-verifications`
    }
  ];

  const APPLICATION_REVIEW_STATUSES = Object.freeze(['approved', 'changes_requested', 'rejected']);
  const APPLICATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const isSuper = !!(global.DanjionAdminAuthority && global.DanjionAdminAuthority.isSuperAdminAuthority(authority));
    const scopes = new Set(Array.isArray(authority && authority.scopes) ? authority.scopes : []);
    return {
      operational: OPERATIONAL_SECTIONS.filter((section) => {
        if (section.policyHold) return false;
        return isSuper || !!(section.requiredScope && scopes.has(section.requiredScope));
      }),
      held: OPERATIONAL_SECTIONS.filter((section) => section.policyHold),
      privileged: isSuper ? PRIVILEGED_PLACEHOLDERS.slice() : []
    };
  }

  async function loadSection(fetchImpl, apiBase, section, slug) {
    if (section && section.policyHold) return { state: 'policy-hold', status: 503, code: 'RESIDENT_VERIFICATION_POLICY_HOLD' };
    const session = global.DanjionSession;
    const result = await session.request(fetchImpl, session.joinUrl(String(apiBase || ''), section.path(slug || COMPLEX_SLUG)));
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result.ok) return { state: 'ready', rows: extractRows(result.data), status: result.status };
    if (result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result.status === 503) return { state: 'policy-hold', status: 503, code };
    if (result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function reviewBusinessApplication(fetchImpl, apiBase, applicationId, status, reviewNote) {
    const id = String(applicationId || '').trim();
    const nextStatus = String(status || '').trim();
    if (!APPLICATION_ID_RE.test(id) || !APPLICATION_REVIEW_STATUSES.includes(nextStatus)) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_APPLICATION_REVIEW_REQUEST' };
    }

    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/business-applications/' + encodeURIComponent(id)),
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          reviewNote: String(reviewNote || '').trim() || null
        })
      }
    );
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result.status === 409) return { state: 'conflict', status: 409, code };
    if (result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
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
    APPLICATION_REVIEW_STATUSES,
    extractRows,
    consoleSections,
    loadSection,
    reviewBusinessApplication,
    rowTitle,
    rowStatus,
    rowMeta
  });
})(typeof window !== 'undefined' ? window : globalThis);

(function (global) {
  'use strict';

  // Issue #460 [admin production] + #607 [bounded review actions]: the canonical
  // V3 admin console surface. Per-section access is decided by the SERVER
  // (403 = scope not granted, 503 = policy hold), never by client-side role
  // inference. #607 activates business-application review PATCH, #609 activates
  // official-news POST/PATCH, #611 activates resident-benefit POST/PATCH, and
  // #613 activates SUPER-only administrator principal management and #615
  // activates privacy-bounded SUPER audit reads through separate reviewed
  // bridges. Sensitive/system SUPER capabilities remain disabled.
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
      description: '게시 대기 중인 주민소식 원고를 조회하고 검토·게시·거절할 수 있습니다.',
      path: (slug) => `/api/v1/operator/complexes/${slug}/resident-news/submissions?status=submitted`,
      residentNewsReviewActions: true
    },
    {
      id: 'posts',
      requiredScope: 'official-content.manage',
      title: '단지소식',
      description: '단지소식을 작성하고 초안·게시·보관 상태를 관리합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/posts?status=all`,
      postActions: true
    },
    {
      id: 'benefits',
      requiredScope: 'benefit.manage',
      title: '주민혜택',
      description: '주민혜택을 등록하고 초안·활성·중지·만료 상태를 관리합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/benefits?status=all`,
      benefitActions: true
    },
    {
      id: 'householdMessages',
      requiredScope: 'household.message.manage',
      title: '세대별 메시지',
      description: '특정 세대·여러 세대·동 전체·단지 전체의 in-app 메시지 대상을 서버에서 미리 확인합니다. 실제 발송은 별도 활성화 전까지 차단됩니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/household-messages/targets`,
      householdMessageActions: true
    },
    {
      id: 'unitMaster',
      requiredScope: 'resident.verification.manage',
      title: '세대 기준정보',
      description: '단지의 실 세대(동·호) 기준정보를 등록하고 활성·비활성 상태를 관리합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/unit-master?status=all`,
      unitMasterActions: true
    },
    {
      id: 'householdReviews',
      requiredScope: 'resident.verification.manage',
      title: '우리집 연결 승인',
      description: '같은 세대의 3번째 이후 pending 계정을 확인하고 승인 또는 거절합니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/household-memberships?status=pending`,
      householdReviewActions: true
    },
    {
      id: 'verifications',
      requiredScope: 'resident.verification.manage',
      title: '주민인증 코드',
      description: '세대별 주민인증 코드를 생성·재발급·폐기합니다. 코드는 생성 직후 한 번만 표시됩니다.',
      path: (slug) => `/api/v1/admin/complexes/${slug}/resident-verification/household-codes`,
      householdCodeActions: true
    }
  ];

  const APPLICATION_REVIEW_STATUSES = Object.freeze(['approved', 'changes_requested', 'rejected']);
  const POST_STATUSES = Object.freeze(['draft', 'published', 'archived']);
  const POST_DISPLAY_MODES = Object.freeze(['highlight', 'article']);
  const BENEFIT_STATUSES = Object.freeze(['draft', 'active', 'expired', 'suspended']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // #460/#613/#615: user/authority management and bounded global audit reads
  // are implemented by separate bridges. Sensitive/system remains placeholder-only.
  const PRIVILEGED_PLACEHOLDERS = [
    { id: 'users', title: '사용자 · 권한 관리', description: '관리자 계정과 운영 권한 부여를 관리합니다.' },
    { id: 'audit', title: '전체 감사 기록', description: '단지 전체의 운영 감사 이력을 조회합니다.' },
    { id: 'system', title: '민감정보 · 시스템 관리', description: '시스템 설정과 민감정보 접근을 관리합니다.' }
  ];

  function extractRows(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of ['applications', 'recommendations', 'submissions', 'posts', 'benefits', 'memberships', 'verifications', 'households', 'units', 'events', 'rows', 'items']) {
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
    if (!UUID_RE.test(id) || !APPLICATION_REVIEW_STATUSES.includes(nextStatus)) {
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

  async function reviewResidentNewsSubmission(fetchImpl, apiBase, submissionId, action, reviewNote, slug) {
    const id = String(submissionId || '').trim();
    const nextAction = String(action || '').trim();
    const note = String(reviewNote || '').trim();
    if (!UUID_RE.test(id) || !['reviewing', 'approve', 'reject'].includes(nextAction) || note.length > 1000) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_RESIDENT_NEWS_REVIEW_REQUEST' };
    }

    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/operator/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG)
          + '/resident-news/submissions/' + encodeURIComponent(id)
      ),
      {
        method: 'PATCH',
        body: JSON.stringify({
          action: nextAction,
          reviewNote: note || null
        })
      }
    );
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result.status === 404) return { state: 'not-found', status: 404, code };
    if (result.status === 409) return { state: 'conflict', status: 409, code };
    if (result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  function normalizePostInput(input) {
    const value = input && typeof input === 'object' ? input : {};
    const sourceName = String(value.sourceName || '').trim();
    const category = String(value.category || '').trim();
    const title = String(value.title || '').trim();
    const body = String(value.body || '').trim();
    const status = String(value.status || '').trim();
    const channel = String(value.channel || '').trim();
    const displayMode = String(value.displayMode || 'highlight').trim();
    const attachmentProvided = Object.prototype.hasOwnProperty.call(value, 'attachmentObjectKey');
    const attachmentObjectKey = value.attachmentObjectKey == null ? null : String(value.attachmentObjectKey).trim() || null;
    if (!sourceName || !category || !title || !body || !POST_STATUSES.includes(status) || !POST_DISPLAY_MODES.includes(displayMode)) return null;
    return {
      sourceName, category, title, body, status,
      ...(channel ? { channel } : {}),
      displayMode,
      ...(attachmentProvided ? { attachmentObjectKey } : {})
    };
  }

  const OFFICIAL_NEWS_IMAGE_KEY = /^gdrive\/public\/official-news-image\/[A-Za-z0-9_-]{10,200}$/;

  async function uploadOfficialNewsImage(fetchImpl, apiBase, file, idempotencyKey, slug) {
    if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') {
      return { state: 'invalid-request', status: 0, code: 'INVALID_FILE' };
    }
    if (file.size <= 0 || file.size > 8 * 1024 * 1024 ||
        !['image/jpeg','image/png','image/webp'].includes(file.type)) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_OFFICIAL_NEWS_IMAGE' };
    }
    const session = global.DanjionSession;
    const form = new FormData();
    form.append('kind', 'official-news-image');
    form.append('complexSlug', slug || COMPLEX_SLUG);
    form.append('file', file, file.name || 'official-news-image');
    const headers = {};
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
    try {
      const response = await fetchImpl(
        session.joinUrl(String(apiBase || ''), '/api/v1/storage/objects'),
        { method: 'POST', credentials: 'include', headers, body: form }
      );
      const payload = await response.json().catch(() => null);
      const code = payload && payload.error && payload.error.code ? String(payload.error.code) : '';
      if (response.status === 401) return { state: 'signed-out', status: 401, code };
      if (response.status === 403) return { state: 'scope-denied', status: 403, code };
      if (!response.ok) return { state: 'error', status: response.status, code };
      const objectKey = payload && payload.data && String(payload.data.objectKey || '');
      if (response.status !== 201 || !OFFICIAL_NEWS_IMAGE_KEY.test(objectKey)) {
        return { state: 'error', status: response.status, code: 'INVALID_OFFICIAL_NEWS_UPLOAD_RESPONSE' };
      }
      return { state: 'updated', status: response.status, data: payload.data, objectKey };
    } catch {
      return { state: 'network-error', status: 0, code: '' };
    }
  }

  async function deleteOfficialNewsImage(fetchImpl, apiBase, objectKey) {
    const key = String(objectKey || '').trim();
    if (!OFFICIAL_NEWS_IMAGE_KEY.test(key)) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_OFFICIAL_NEWS_IMAGE_KEY' };
    }
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/storage/objects?objectKey=' + encodeURIComponent(key)),
      { method: 'DELETE' }
    );
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', status: result.status, data: result.data, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  function classifyPostMutation(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function createOfficialPost(fetchImpl, apiBase, input, slug) {
    const payload = normalizePostInput(input);
    if (!payload) return { state: 'invalid-request', status: 0, code: 'INVALID_OFFICIAL_POST_REQUEST' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/posts'),
      { method: 'POST', body: JSON.stringify(payload) }
    );
    return classifyPostMutation(result);
  }

  async function updateOfficialPost(fetchImpl, apiBase, postId, input) {
    const id = String(postId || '').trim();
    const payload = normalizePostInput(input);
    if (!UUID_RE.test(id) || !payload) return { state: 'invalid-request', status: 0, code: 'INVALID_OFFICIAL_POST_REQUEST' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/posts/' + encodeURIComponent(id)),
      { method: 'PATCH', body: JSON.stringify(payload) }
    );
    return classifyPostMutation(result);
  }

  async function loadBenefitBusinesses(fetchImpl, apiBase, slug) {
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/businesses?limit=50')
    );
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result.ok) return { state: 'ready', rows: extractRows(result.data), status: result.status, code };
    if (result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  function normalizeBenefitInput(input, requireBusiness) {
    const value = input && typeof input === 'object' ? input : {};
    const businessId = String(value.businessId || '').trim();
    const title = String(value.title || '').trim();
    const description = String(value.description || '');
    const conditions = String(value.conditions || '').trim();
    const startsAt = String(value.startsAt || '').trim();
    const endsAt = String(value.endsAt || '').trim();
    const status = String(value.status || '').trim();
    if ((requireBusiness && !UUID_RE.test(businessId)) || !title || !BENEFIT_STATUSES.includes(status)) return null;
    return {
      ...(requireBusiness ? { businessId } : {}),
      title,
      description,
      conditions: conditions || null,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      status
    };
  }

  function classifyBenefitMutation(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function createResidentBenefit(fetchImpl, apiBase, input, slug) {
    const payload = normalizeBenefitInput(input, true);
    if (!payload) return { state: 'invalid-request', status: 0, code: 'INVALID_BENEFIT_REQUEST' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/benefits'),
      { method: 'POST', body: JSON.stringify(payload) }
    );
    return classifyBenefitMutation(result);
  }

  async function updateResidentBenefit(fetchImpl, apiBase, benefitId, input) {
    const id = String(benefitId || '').trim();
    const payload = normalizeBenefitInput(input, false);
    if (!UUID_RE.test(id) || !payload) return { state: 'invalid-request', status: 0, code: 'INVALID_BENEFIT_REQUEST' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/benefits/' + encodeURIComponent(id)),
      { method: 'PATCH', body: JSON.stringify(payload) }
    );
    return classifyBenefitMutation(result);
  }

  function classifyHouseholdMessagePreview(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'preview', data: result.data, status: result.status, code };
    if (result && result.status === 400) return { state: 'invalid-request', status: 400, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (result && result.status === 503) return { state: 'unavailable', status: 503, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  function normalizeHouseholdMessageTarget(input) {
    const value = input && typeof input === 'object' ? input : {};
    const targetType = String(value.targetType || '').trim();
    if (!['unit', 'units', 'building', 'all'].includes(targetType)) return null;
    const payload = { targetType };
    if (targetType === 'building') {
      const buildingCode = String(value.buildingCode || '').trim();
      if (!buildingCode || buildingCode.length > 20) return null;
      payload.buildingCode = buildingCode;
    }
    if (targetType === 'unit' || targetType === 'units') {
      if (!Array.isArray(value.units) || !value.units.length || value.units.length > 100) return null;
      const units = [];
      const seen = new Set();
      for (const raw of value.units) {
        const buildingCode = String(raw && raw.buildingCode || '').trim();
        const unitCode = String(raw && raw.unitCode || '').trim();
        if (!buildingCode || !unitCode || buildingCode.length > 20 || unitCode.length > 20) return null;
        const key = buildingCode + '\u0000' + unitCode;
        if (seen.has(key)) continue;
        seen.add(key);units.push({ buildingCode, unitCode });
      }
      if (targetType === 'unit' && units.length !== 1) return null;
      payload.units = units;
    }
    return payload;
  }

  async function previewHouseholdMessageTargets(fetchImpl, apiBase, input, slug) {
    const payload = normalizeHouseholdMessageTarget(input);
    if (!payload) return { state: 'invalid-request', status: 0, code: 'INVALID_HOUSEHOLD_MESSAGE_TARGET' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/household-messages/preview'
      ),
      { method: 'POST', body: JSON.stringify(payload) }
    );
    return classifyHouseholdMessagePreview(result);
  }

  function classifyHouseholdReviewMutation(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (result && result.status === 503) return { state: 'unavailable', status: 503, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function reviewHouseholdMembership(fetchImpl, apiBase, membershipId, decision) {
    const id = String(membershipId || '').trim();
    const nextDecision = String(decision || '').trim();
    if (!UUID_RE.test(id) || !['approve', 'reject'].includes(nextDecision)) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_HOUSEHOLD_REVIEW_REQUEST' };
    }
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), '/api/v1/admin/household-memberships/' + encodeURIComponent(id)),
      { method: 'PATCH', body: JSON.stringify({ decision: nextDecision }) }
    );
    return classifyHouseholdReviewMutation(result);
  }

  function classifyHouseholdCodeMutation(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (result && result.status === 503) return { state: 'unavailable', status: 503, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function provisionHouseholdCode(fetchImpl, apiBase, input, slug) {
    const value = input && typeof input === 'object' ? input : {};
    const buildingCode = String(value.buildingCode || '').trim();
    const unitCode = String(value.unitCode || '').trim();
    if (!buildingCode || !unitCode || buildingCode.length > 20 || unitCode.length > 20) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_HOUSEHOLD_UNIT' };
    }
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/resident-verification/household-codes'
      ),
      { method: 'POST', body: JSON.stringify({ buildingCode, unitCode }) }
    );
    return classifyHouseholdCodeMutation(result);
  }

  async function revokeHouseholdCode(fetchImpl, apiBase, householdId, slug) {
    const id = String(householdId || '').trim();
    if (!UUID_RE.test(id)) return { state: 'invalid-request', status: 0, code: 'INVALID_HOUSEHOLD_ID' };
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG)
          + '/resident-verification/household-codes/' + encodeURIComponent(id)
      ),
      { method: 'DELETE' }
    );
    return classifyHouseholdCodeMutation(result);
  }

  function classifyUnitMasterMutation(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'updated', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'scope-denied', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (result && result.status === 405) return { state: 'method-not-allowed', status: 405, code };
    if (result && result.status === 503) return { state: 'unavailable', status: 503, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  async function createUnitMaster(fetchImpl, apiBase, input, slug) {
    const value = input && typeof input === 'object' ? input : {};
    const buildingCode = String(value.buildingCode || '').trim();
    const unitCode = String(value.unitCode || '').trim();
    if (!buildingCode || !unitCode || buildingCode.length > 20 || unitCode.length > 20) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_UNIT_PARAMS' };
    }
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/admin/complexes/' + encodeURIComponent(slug || COMPLEX_SLUG) + '/unit-master'
      ),
      { method: 'POST', body: JSON.stringify({ buildingCode, unitCode }) }
    );
    return classifyUnitMasterMutation(result);
  }

  async function updateUnitMaster(fetchImpl, apiBase, unitId, input) {
    const id = String(unitId || '').trim();
    if (!UUID_RE.test(id)) return { state: 'invalid-request', status: 0, code: 'INVALID_UNIT_ID' };
    const value = input && typeof input === 'object' ? input : {};
    const payload = {};
    if (value.buildingCode !== undefined) {
      const b = String(value.buildingCode || '').trim();
      if (!b || b.length > 20) return { state: 'invalid-request', status: 0, code: 'INVALID_UNIT_PARAMS' };
      payload.buildingCode = b;
    }
    if (value.unitCode !== undefined) {
      const u = String(value.unitCode || '').trim();
      if (!u || u.length > 20) return { state: 'invalid-request', status: 0, code: 'INVALID_UNIT_PARAMS' };
      payload.unitCode = u;
    }
    if (value.status !== undefined) {
      const s = String(value.status || '').trim().toLowerCase();
      if (s !== 'active' && s !== 'inactive') return { state: 'invalid-request', status: 0, code: 'INVALID_STATUS' };
      payload.status = s;
    }
    if (Object.keys(payload).length === 0) {
      return { state: 'invalid-request', status: 0, code: 'NO_UPDATES' };
    }
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(
        String(apiBase || ''),
        '/api/v1/admin/complex-units/' + encodeURIComponent(id)
      ),
      { method: 'PATCH', body: JSON.stringify(payload) }
    );
    return classifyUnitMasterMutation(result);
  }

  function rowTitle(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.nickname || row.accountReference) {
      const nickname = String(row.nickname || '').trim();
      const accountReference = String(row.accountReference || '').trim();
      return nickname || (accountReference ? '계정 ' + accountReference : '');
    }
    if (row.buildingCode || row.building_code || row.unitCode || row.unit_code) {
      const building = String(row.buildingCode ?? row.building_code ?? '').trim();
      const unit = String(row.unitCode ?? row.unit_code ?? '').trim();
      return (building ? building + '동 ' : '') + (unit ? unit + '호' : '');
    }
    const value = row.businessName ?? row.title ?? row.name ?? row.business_name ?? '';
    return String(value).slice(0, 80);
  }

  function rowStatus(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.memberPosition !== undefined || row.member_position !== undefined) return '승인 대기';
    return String(row.codeStatus ?? row.code_status ?? row.status ?? '').slice(0, 40);
  }

  function rowMeta(row) {
    if (!row || typeof row !== 'object') return '';
    const parts = [];
    if (row.generation !== undefined && row.generation !== null) parts.push('코드 ' + Number(row.generation) + '세대');
    if (row.useCount !== undefined || row.use_count !== undefined) parts.push('인증 ' + Number(row.useCount ?? row.use_count ?? 0) + '회');
    if (row.verifiedMemberCount !== undefined || row.verified_member_count !== undefined) parts.push('인증 계정 ' + Number(row.verifiedMemberCount ?? row.verified_member_count ?? 0) + '명');
    const applicant = row.applicantName || row.applicant_name || row.reporterNickname || row.submitterNickname || row.submitter_nickname;
    if (applicant) parts.push(String(applicant));
    const summary = row.serviceSummary || row.service_summary || row.body || row.description || '';
    if (summary) parts.push(String(summary).slice(0, 60));
    if (Array.isArray(row.attachments) && row.attachments.length) parts.push('첨부 '+row.attachments.length+'개');
    const createdAt = row.createdAt || row.created_at || '';
    if (createdAt) parts.push(String(createdAt).slice(0, 16));
    const deactivatedAt = row.deactivatedAt || row.deactivated_at || '';
    if (deactivatedAt) parts.push('비활성 ' + String(deactivatedAt).slice(0, 10));
    return parts.join(' · ');
  }

  global.DanjionAdminConsole = Object.freeze({
    COMPLEX_SLUG,
    OPERATIONAL_SECTIONS,
    PRIVILEGED_PLACEHOLDERS,
    APPLICATION_REVIEW_STATUSES,
    POST_STATUSES,
    POST_DISPLAY_MODES,
    BENEFIT_STATUSES,
    extractRows,
    consoleSections,
    loadSection,
    reviewBusinessApplication,
    reviewResidentNewsSubmission,
    createOfficialPost,
    updateOfficialPost,
    uploadOfficialNewsImage,
    deleteOfficialNewsImage,
    loadBenefitBusinesses,
    createResidentBenefit,
    updateResidentBenefit,
    previewHouseholdMessageTargets,
    reviewHouseholdMembership,
    provisionHouseholdCode,
    revokeHouseholdCode,
    createUnitMaster,
    updateUnitMaster,
    rowTitle,
    rowStatus,
    rowMeta
  });
})(typeof window !== 'undefined' ? window : globalThis);

export const DANJION_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_RELATIONS = new Set(['resident', 'resident_family', 'neighbor', 'local']);
// #341: the canonical owner raw relation. The bridge forwards it verbatim —
// no frontend pre-resolution (self -> resident / family -> resident_family is
// server-side authority) and no co/etc inference.
const OWNER_RELATION_RAW = new Set(['self', 'co', 'family', 'etc']);

function joinUrl(base, path) {
  const root = String(base || '').replace(/\/+$/, '');
  return `${root}${path}`;
}

async function parseJson(response) {
  try { return await response.json(); } catch { return null; }
}

function failure(status, payload) {
  if (status === 401 || status === 403) return { ok: false, reason: 'auth-required', status, error: payload?.error || null };
  return { ok: false, reason: 'server-error', status, error: payload?.error || null };
}

async function request(fetchImpl, url, init = {}) {
  try {
    const response = await fetchImpl(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {})
      }
    });
    const payload = await parseJson(response);
    if (!response.ok) return failure(response.status, payload);
    return { ok: true, status: response.status, data: payload?.data ?? null, requestId: payload?.requestId ?? null };
  } catch (error) {
    return { ok: false, reason: 'network-error', status: 0, error };
  }
}

function clean(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function photoObjectKeysFrom(input) {
  const raw = input?.photoObjectKeys;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  return raw.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0);
}

function ownerPayload(input, complexSlug) {
  const relationRaw = clean(input?.relationRaw);
  const relationType = clean(input?.relationType);
  const businessName = clean(input?.businessName);
  const categoryName = clean(input?.categoryName);
  const serviceSummary = clean(input?.serviceSummary);
  if (!businessName || !categoryName || !serviceSummary) return null;
  if (relationRaw) {
    if (!OWNER_RELATION_RAW.has(relationRaw)) return null;
  } else if (!relationType || !OWNER_RELATIONS.has(relationType)) {
    return null;
  }
  const photoKeys = photoObjectKeysFrom(input);
  const representativeImageObjectKey = photoKeys !== null
    ? (photoKeys.length > 0 ? photoKeys[0] : null)
    : clean(input?.representativeImageObjectKey);
  return {
    complexSlug,
    ...(relationRaw ? { relationRaw } : { relationType }),
    businessName,
    categoryName,
    serviceSummary,
    priceText: clean(input?.priceText),
    contactMethod: clean(input?.contactMethod),
    serviceArea: clean(input?.serviceArea),
    benefitText: clean(input?.benefitText),
    availabilityText: clean(input?.availabilityText),
    representativeImageObjectKey,
    photoObjectKeys: photoKeys
  };
}

// Report R-B intake (backend #308 is authority). The raw relation text is
// always preserved verbatim: family / neighbor / nearby / etc pass through
// untouched — NO frontend mapping (nearby -> local is FORBIDDEN server-side),
// NO category synthesis (categoryName is sent only when the reporter supplied
// one; otherwise it stays absent and approval fails closed server-side), and
// NO legacy relation coercion (canonical field is relationRaw; relationType
// is accepted as a raw-text alias and never mapped).
function reportPayload(input, complexSlug) {
  const relationRaw = clean(input?.relationRaw ?? input?.relationType);
  const businessName = clean(input?.businessName);
  const serviceSummary = clean(input?.serviceSummary);
  if (!relationRaw || relationRaw.length > 120 || !businessName || !serviceSummary) return null;
  const body = {
    complexSlug,
    relationRaw,
    businessName,
    serviceSummary
  };
  const categoryName = clean(input?.categoryName);
  if (categoryName) body.categoryName = categoryName;
  const serviceArea = clean(input?.serviceArea);
  if (serviceArea) body.serviceArea = serviceArea;
  const reporterNote = clean(input?.reporterNote);
  if (reporterNote) body.reporterNote = reporterNote;
  const relationDetail = clean(input?.relationDetail);
  if (relationDetail) body.relationDetail = relationDetail;
  const reportPrice = clean(input?.reportPrice);
  if (reportPrice) body.reportPrice = reportPrice;
  const reportHours = clean(input?.reportHours);
  if (reportHours) body.reportHours = reportHours;
  return body;
}

export function normalizeOwnerApplication(row) {
  if (!row || typeof row !== 'object') return null;
  const docs = [];
  if (Array.isArray(row.documents)) {
    for (const doc of row.documents) {
      if (!doc || typeof doc !== 'object') continue;
      docs.push({
        objectKey: String(doc.objectKey ?? doc.object_key ?? ''),
        kind: String(doc.kind ?? doc.document_kind ?? ''),
        sortOrder: Number(doc.sortOrder ?? doc.sort_order ?? 0)
      });
    }
  }
  return {
    id: String(row.id || ''),
    relationType: String(row.relation_type ?? row.relationType ?? ''),
    relationRaw: row.relation_raw ?? row.relationRaw ?? null,
    resolvedRelationType: row.resolved_relation_type ?? row.resolvedRelationType ?? null,
    businessName: String(row.business_name ?? row.businessName ?? ''),
    categoryName: String(row.category_name ?? row.categoryName ?? ''),
    serviceSummary: String(row.service_summary ?? row.serviceSummary ?? ''),
    priceText: row.price_text ?? row.priceText ?? null,
    contactMethod: row.contact_method ?? row.contactMethod ?? null,
    serviceArea: row.service_area ?? row.serviceArea ?? null,
    benefitText: row.benefit_text ?? row.benefitText ?? null,
    availabilityText: row.availability_text ?? row.availabilityText ?? null,
    representativeImageObjectKey: row.representative_image_object_key ?? row.representativeImageObjectKey ?? null,
    photoObjectKeys: Array.isArray(row.photoObjectKeys)
      ? row.photoObjectKeys.map((k) => String(k ?? '')).filter((k) => k.length > 0)
      : [],
    documents: docs,
    status: String(row.status || ''),
    reviewNote: row.review_note ?? row.reviewNote ?? null,
    approvedBusinessId: row.approved_business_id ?? row.approvedBusinessId ?? null,
    submissionKey: row.submission_key ?? row.submissionKey ?? null,
    idempotencyReplayed: Boolean(row.idempotency_replayed ?? row.idempotencyReplayed ?? false),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function normalizeRecommendation(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    relationType: row.relation_type ?? row.relationType ?? null,
    reportedRelationRaw: row.reported_relation_raw ?? row.reportedRelationRaw ?? null,
    resolvedRelationType: row.resolved_relation_type ?? row.resolvedRelationType ?? null,
    relationDetail: row.relation_detail ?? row.relationDetail ?? null,
    businessName: String(row.business_name ?? row.businessName ?? ''),
    categoryName: row.category_name ?? row.categoryName ?? null,
    resolvedCategoryId: row.resolved_category_id ?? row.resolvedCategoryId ?? null,
    serviceSummary: String(row.service_summary ?? row.serviceSummary ?? ''),
    serviceArea: row.serviceArea ?? row.service_area ?? null,
    reporterNote: row.reporterNote ?? row.reporter_note ?? null,
    reportPrice: row.report_price ?? row.reportPrice ?? null,
    reportHours: row.report_hours ?? row.reportHours ?? null,
    status: String(row.status || ''),
    reviewNote: row.reviewNote ?? row.review_note ?? null,
    approvedBusinessId: row.approvedBusinessId ?? row.approved_business_id ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null
  };
}

export function createApplicationReportBridge({ apiBase = '', fetchImpl = globalThis.fetch, complexSlug = DANJION_COMPLEX_SLUG } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  return {
    async listOwnerApplications() {
      const result = await request(fetchImpl, joinUrl(apiBase, '/api/v1/me/business-applications'));
      if (!result.ok) return result;
      return { ...result, data: Array.isArray(result.data) ? result.data.map(normalizeOwnerApplication).filter(Boolean) : [] };
    },
    async createOwnerApplication(input, { idempotencyKey = null } = {}) {
      const body = ownerPayload(input, complexSlug);
      if (!body) return { ok: false, reason: 'validation-error', status: 0 };
      const headers = idempotencyKey ? { 'idempotency-key': String(idempotencyKey) } : {};
      const result = await request(fetchImpl, joinUrl(apiBase, '/api/v1/me/business-applications'), { method: 'POST', headers, body: JSON.stringify(body) });
      return result.ok ? { ...result, data: normalizeOwnerApplication(result.data) } : result;
    },
    async resubmitOwnerApplication(applicationId, input) {
      if (!UUID.test(String(applicationId || ''))) return { ok: false, reason: 'validation-error', status: 0 };
      const body = ownerPayload(input, complexSlug);
      if (!body) return { ok: false, reason: 'validation-error', status: 0 };
      const result = await request(fetchImpl, joinUrl(apiBase, `/api/v1/me/business-applications/${applicationId}`), { method: 'PATCH', body: JSON.stringify(body) });
      return result.ok ? { ...result, data: normalizeOwnerApplication(result.data) } : result;
    },
    async listRecommendations() {
      const path = `/api/v1/me/shop-recommendations?complexSlug=${encodeURIComponent(complexSlug)}`;
      const result = await request(fetchImpl, joinUrl(apiBase, path));
      if (!result.ok) return result;
      const rows = Array.isArray(result.data?.recommendations) ? result.data.recommendations : [];
      return { ...result, data: rows.map(normalizeRecommendation).filter(Boolean) };
    },
    async createRecommendation(input) {
      const body = reportPayload(input, complexSlug);
      if (!body) return { ok: false, reason: 'validation-error', status: 0 };
      const result = await request(fetchImpl, joinUrl(apiBase, '/api/v1/me/shop-recommendations'), { method: 'POST', body: JSON.stringify(body) });
      return result.ok ? { ...result, data: normalizeRecommendation(result.data) } : result;
    },
    async resubmitRecommendation(recommendationId, input) {
      if (!UUID.test(String(recommendationId || ''))) return { ok: false, reason: 'validation-error', status: 0 };
      const body = reportPayload(input, complexSlug);
      if (!body) return { ok: false, reason: 'validation-error', status: 0 };
      const result = await request(fetchImpl, joinUrl(apiBase, `/api/v1/me/shop-recommendations/${recommendationId}`), { method: 'PATCH', body: JSON.stringify(body) });
      return result.ok ? { ...result, data: normalizeRecommendation(result.data) } : result;
    }
  };
}

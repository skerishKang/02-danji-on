import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import { requireVerifiedResident } from './authorization-v2';
import { validateBusinessImageReference } from './storage-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type DocumentInput = {
  objectKey: string;
  kind: 'operation_proof' | 'other_evidence' | 'additional_reference';
  sortOrder: number;
};

type ApplicationInput = {
  complexSlug: string;
  relationType: string;
  // #341: canonical owner relation (self|co|family|etc) as submitted, and the
  // projection-enum resolution authority. co/etc resolve to null and block
  // approval fail-closed; legacy callers may omit relationRaw and send only a
  // projection-enum relationType, which resolves to itself.
  relationRaw: string;
  resolvedRelationType: string | null;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  priceText: string | null;
  contactMethod: string | null;
  serviceArea: string | null;
  benefitText: string | null;
  availabilityText: string | null;
  representativeImageObjectKey: string | null;
  // GAP-4: additive multi-photo contract. null = field omitted (preserve on
  // resubmit); [] = explicit empty (remove all); [k...] = 0..3 ordered keys.
  photoObjectKeys: string[] | null;
  // GAP-5: private application documents. undefined = field omitted (preserve
  // on resubmit); [] = rejected (operation_proof required); [d...] = associated.
  documents?: DocumentInput[];
};

const MAX_APPLICATION_PHOTOS = 3;
const BUSINESS_IMAGE_NAMESPACE = 'gdrive/public/business-image/';

// #341 owner relation resolution contract. Only self and family pre-resolve;
// co and etc stay unresolved (approval fails closed server-side). No
// co -> neighbor and no etc -> * inference exists anywhere in this lane.
const OWNER_RELATION_RAW_VALUES = ['self', 'co', 'family', 'etc'];
const OWNER_RELATION_PROJECTION_VALUES = ['resident', 'resident_family', 'neighbor', 'local'];
const OWNER_RELATION_PRE_RESOLVE_MAP: Record<string, string> = {
  self: 'resident',
  family: 'resident_family'
};

function isValidPhotoObjectKeyFormat(value: string): boolean {
  if (!value.startsWith(BUSINESS_IMAGE_NAMESPACE)) return false;
  const fileId = value.slice(BUSINESS_IMAGE_NAMESPACE.length);
  return /^[A-Za-z0-9_-]{10,200}$/.test(fileId);
}

type BusinessImageRegistryRow = {
  object_key?: string;
  uploader_user_id?: string;
  complex_id?: string;
  state?: string;
};

function ok(data: unknown, requestId: string, status = 200): Response {
  return Response.json({ data, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return payload as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

// GAP-4: parse optional photoObjectKeys. Returns null when the field is
// absent (preserve semantics on resubmit), [] when explicitly empty, or the
// trimmed ordered key list. Returns undefined-sentinel via { ok:false } on
// shape violations so callers can fail closed with a precise error code.
function parsePhotoObjectKeys(
  payload: Record<string, unknown>,
  requestId: string
): { ok: true; keys: string[] | null } | { ok: false; response: Response } {
  const raw = payload.photoObjectKeys;
  if (raw === undefined || raw === null) return { ok: true, keys: null };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      response: fail('VALIDATION_ERROR', 'photoObjectKeys must be an array of 0..3 object keys', 400, requestId)
    };
  }
  const keys = raw.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0);
  // An explicitly empty array stays empty (remove-all); a whitespace-only
  // array is also treated as explicit empty rather than omitted.
  if (keys.length > MAX_APPLICATION_PHOTOS) {
    return {
      ok: false,
      response: fail('PHOTO_LIMIT_EXCEEDED', 'Maximum 3 photos per application', 400, requestId)
    };
  }
  if (new Set(keys).size !== keys.length) {
    return {
      ok: false,
      response: fail('DUPLICATE_PHOTO_KEYS', 'Duplicate photo object keys are not allowed', 400, requestId)
    };
  }
  for (const key of keys) {
    if (!isValidPhotoObjectKeyFormat(key)) {
      return {
        ok: false,
        response: fail('INVALID_PHOTO_KEY', 'Each photo must reference a DanjiOn public business image', 400, requestId)
      };
    }
  }
  return { ok: true, keys };
}

function applicationInput(payload: Record<string, unknown>, photoKeys: string[] | null): ApplicationInput {
  const docsRaw = payload.documents;
  let documents: DocumentInput[] | undefined;
  if (Array.isArray(docsRaw)) {
    documents = docsRaw
      .filter((d) => typeof d === 'object' && d !== null)
      .map((d) => ({
        objectKey: String((d as Record<string, unknown>).objectKey ?? '').trim(),
        kind: String((d as Record<string, unknown>).kind ?? '').trim() as DocumentInput['kind'],
        sortOrder: Number((d as Record<string, unknown>).sortOrder ?? 0)
      }));
  }
  // GAP-4 backward compatibility:
  // - photoObjectKeys present (incl. []) => authoritative; representative mirrors keys[0] ?? null.
  // - photoObjectKeys omitted => legacy representativeImageObjectKey contract unchanged.
  const legacy = String(payload.representativeImageObjectKey ?? '').trim() || null;
  const representativeImageObjectKey = photoKeys !== null
    ? (photoKeys.length > 0 ? photoKeys[0] : null)
    : legacy;
  return {
    complexSlug: String(payload.complexSlug ?? '').trim(),
    relationType: String(payload.relationType ?? '').trim(),
    relationRaw: String(payload.relationRaw ?? '').trim(),
    resolvedRelationType: null,
    businessName: String(payload.businessName ?? '').trim(),
    categoryName: String(payload.categoryName ?? '').trim(),
    serviceSummary: String(payload.serviceSummary ?? '').trim(),
    priceText: String(payload.priceText ?? '').trim() || null,
    contactMethod: String(payload.contactMethod ?? '').trim() || null,
    serviceArea: String(payload.serviceArea ?? '').trim() || null,
    benefitText: String(payload.benefitText ?? '').trim() || null,
    availabilityText: String(payload.availabilityText ?? '').trim() || null,
    representativeImageObjectKey,
    photoObjectKeys: photoKeys,
    documents
  };
}

// When both contracts arrive together they must agree; silent disagreement
// between the legacy single key and the gallery first key is rejected.
function photoContractAgreement(
  payload: Record<string, unknown>,
  photoKeys: string[] | null,
  requestId: string
): Response | null {
  if (photoKeys === null) return null;
  if (!('representativeImageObjectKey' in payload)) return null;
  const legacy = String(payload.representativeImageObjectKey ?? '').trim() || null;
  const mirror = photoKeys.length > 0 ? photoKeys[0] : null;
  if (legacy !== mirror) {
    return fail(
      'PHOTO_CONTRACT_MISMATCH',
      'representativeImageObjectKey must equal photoObjectKeys[0] when both are provided',
      400,
      requestId
    );
  }
  return null;
}

function validateApplication(input: ApplicationInput, requestId: string): Response | null {
  if (!input.complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  if (input.relationRaw) {
    // #341 canonical raw lane: raw is authoritative; the legacy field may only
    // echo the pre-resolved projection value (or stay absent for unresolved
    // co/etc). A raw value is never mapped to a non-equivalent projection.
    if (!OWNER_RELATION_RAW_VALUES.includes(input.relationRaw)) {
      return fail('VALIDATION_ERROR', 'Invalid relationRaw', 400, requestId);
    }
    const projected = OWNER_RELATION_PRE_RESOLVE_MAP[input.relationRaw] ?? null;
    if (input.relationType && projected && input.relationType !== projected) {
      return fail('VALIDATION_ERROR', 'relationType must agree with relationRaw when both are provided', 400, requestId);
    }
    if (input.relationType && !projected) {
      return fail('VALIDATION_ERROR', 'relationType must be omitted until relationRaw is resolvable', 400, requestId);
    }
    input.relationType = projected ?? '';
    input.resolvedRelationType = projected;
  } else {
    if (!OWNER_RELATION_PROJECTION_VALUES.includes(input.relationType)) {
      return fail('VALIDATION_ERROR', 'Invalid relationType', 400, requestId);
    }
    // Legacy lane: an already-projection-valued relation_type is its own
    // resolution; relation_raw stays absent (no invented raw value).
    input.resolvedRelationType = input.relationType;
  }
  if (!input.businessName || !input.categoryName || !input.serviceSummary) {
    return fail('VALIDATION_ERROR', 'businessName, categoryName and serviceSummary are required', 400, requestId);
  }

  if (input.documents !== undefined) {
    if (input.documents.length < 1) {
      return fail('DOCUMENT_OPERATION_PROOF_REQUIRED', 'At least one operation_proof document is required when documents field is present', 400, requestId);
    }
    const operationProofs = input.documents.filter((d) => d.kind === 'operation_proof');
    const otherEvidences = input.documents.filter((d) => d.kind === 'other_evidence');
    const additionalReferences = input.documents.filter((d) => d.kind === 'additional_reference');

    if (operationProofs.length < 1) {
      return fail('DOCUMENT_OPERATION_PROOF_REQUIRED', 'At least one operation_proof document is required when documents field is present', 400, requestId);
    }

    if (otherEvidences.length > 3) {
      return fail('VALIDATION_ERROR', 'other_evidence documents cannot exceed 3', 400, requestId);
    }

    if (additionalReferences.length > 3) {
      return fail('VALIDATION_ERROR', 'additional_reference documents cannot exceed 3', 400, requestId);
    }

    const validKinds = ['operation_proof', 'other_evidence', 'additional_reference'];
    for (const doc of input.documents) {
      if (!validKinds.includes(doc.kind)) {
        return fail('DOCUMENT_KIND_INVALID', `Invalid document kind: ${doc.kind}`, 400, requestId);
      }
      if (!doc.objectKey || !doc.objectKey.startsWith('gdrive/private/application-document/')) {
        return fail('DOCUMENT_OBJECT_KEY_INVALID', 'Document object key must reference a private application-document namespace', 400, requestId);
      }
    }
  }

  return null;
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,80}$/.test(value);
}

async function fingerprint(input: ApplicationInput): Promise<string> {
  // The canonical form must stay byte-identical to the pre-#341 shape for
  // legacy payloads (no relationRaw), so stored fingerprints keep replaying.
  // relationRaw is part of the request body and is appended when present;
  // resolvedRelationType is derived and never fingerprinted.
  const canonicalPayload: Record<string, unknown> = {
    complexSlug: input.complexSlug,
    relationType: input.relationType,
    businessName: input.businessName,
    categoryName: input.categoryName,
    serviceSummary: input.serviceSummary,
    priceText: input.priceText,
    contactMethod: input.contactMethod,
    serviceArea: input.serviceArea,
    benefitText: input.benefitText,
    availabilityText: input.availabilityText,
    representativeImageObjectKey: input.representativeImageObjectKey,
    photoObjectKeys: input.photoObjectKeys,
    documents: input.documents
  };
  if (input.relationRaw) canonicalPayload.relationRaw = input.relationRaw;
  const canonical = JSON.stringify(canonicalPayload);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function existingBusinessApplication(sql: Sql, applicantUserId: string, submissionKey: string) {
  const rows = await sql`
    select id, relation_type, relation_raw, resolved_relation_type, business_name, category_name, service_summary,
           price_text, contact_method, service_area, benefit_text,
           availability_text, representative_image_object_key, status,
           review_note, approved_business_id, submission_key,
           submission_fingerprint, created_at, updated_at
    from business_applications
    where applicant_user_id = ${applicantUserId}::uuid
      and submission_key = ${submissionKey}
    limit 1
  `;
  return rows[0] ?? null;
}

// GAP-5 BLOCKER: a replayed create must return the same document set the
// original 201 response carried, alongside the GAP-4 stored gallery. Both
// reads run BEFORE any current registry/Drive revalidation, and either read
// failing closes with 503 rather than reporting a persisted set as empty.
async function idempotentReplayResponse(
  sql: Sql,
  existing: Record<string, unknown>,
  requestFingerprint: string,
  requestId: string
): Promise<Response> {
  if (String(existing.submission_fingerprint) !== requestFingerprint) {
    return fail('IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used with a different request body', 409, requestId);
  }
  let stored: string[];
  try {
    stored = await readApplicationPhotoKeys(sql, String(existing.id ?? ''));
  } catch {
    return fail('GALLERY_READ_UNAVAILABLE', 'Persisted application photo gallery could not be read', 503, requestId);
  }
  let docs;
  try {
    docs = await getApplicationDocuments(sql, String(existing.id));
  } catch {
    return fail(
      'DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document lifecycle registry is unavailable',
      503,
      requestId
    );
  }
  return ok(withGallery({ ...existing, documents: docs, idempotency_replayed: true }, stored), requestId);
}

function businessImageRegistryFailure(
  registry: BusinessImageRegistryRow | undefined,
  expectedUploaderUserId: string,
  expectedComplexId: string,
  requestId: string
): Response | null {
  if (!registry || String(registry.state ?? '') !== 'active') {
    return fail(
      'BUSINESS_IMAGE_NOT_ACTIVE',
      'Representative image is not active for new product references',
      409,
      requestId
    );
  }
  if (String(registry.uploader_user_id ?? '') !== expectedUploaderUserId ||
      String(registry.complex_id ?? '') !== expectedComplexId) {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_MISMATCH',
      'Representative image registry binding does not match this resident and complex',
      409,
      requestId
    );
  }
  return null;
}

// GAP-5: private application document persistence. Documents live in
// business_application_documents (migration 045) and are validated against the
// same lifecycle registry as images, but ONLY rows whose kind is
// 'application-document' may be attached (kind guard below).
type ApplicationDocumentRegistryRow = {
  object_key?: string;
  uploader_user_id?: string;
  complex_id?: string;
  state?: string;
  kind?: string;
};

type ApplicationDocumentResponse = {
  objectKey: string;
  kind: string;
  sortOrder: number;
};

async function getApplicationDocuments(
  sql: Sql,
  applicationId: string
): Promise<ApplicationDocumentResponse[]> {
  const rows = await sql`
    select object_key, document_kind, sort_order
    from business_application_documents
    where application_id = ${applicationId}::uuid
    order by sort_order
  `;
  return (rows as Array<{ object_key: string; document_kind: string; sort_order: number }>).map((row) => ({
    objectKey: row.object_key,
    kind: row.document_kind,
    sortOrder: row.sort_order
  }));
}

function applicationDocumentRegistryFailure(
  registry: ApplicationDocumentRegistryRow | undefined,
  expectedUploaderUserId: string,
  expectedComplexId: string,
  requestId: string
): Response | null {
  if (!registry || String(registry.state ?? '') !== 'active') {
    return fail(
      'DOCUMENT_NOT_ACTIVE',
      'Application document is not active',
      409,
      requestId
    );
  }
  if (String(registry.kind ?? '') !== 'application-document') {
    return fail(
      'DOCUMENT_KIND_INVALID',
      'Registry row is not an application-document',
      400,
      requestId
    );
  }
  if (String(registry.uploader_user_id ?? '') !== expectedUploaderUserId ||
      String(registry.complex_id ?? '') !== expectedComplexId) {
    return fail(
      'DOCUMENT_REGISTRY_MISMATCH',
      'Application document registry binding does not match this resident and complex',
      409,
      requestId
    );
  }
  return null;
}

async function validateApplicationDocuments(
  sql: Sql,
  documents: DocumentInput[],
  applicantUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  const objectKeys = documents.map((d) => d.objectKey);
  let rows;
  try {
    rows = await sql`
      select object_key, uploader_user_id::text, complex_id::text, state, kind
      from business_image_objects
      where object_key = any(${objectKeys})
    `;
  } catch {
    return fail(
      'DOCUMENT_REGISTRY_UNAVAILABLE',
      'Application document lifecycle registry is unavailable',
      503,
      requestId
    );
  }
  const registryMap = new Map<string, ApplicationDocumentRegistryRow>();
  for (const row of rows as ApplicationDocumentRegistryRow[]) {
    registryMap.set(String(row.object_key), row);
  }
  for (const doc of documents) {
    const registry = registryMap.get(doc.objectKey);
    const failure = applicationDocumentRegistryFailure(
      registry, applicantUserId, complexId, requestId
    );
    if (failure) return failure;
  }
  return null;
}

// GAP-4: fail-closed ownership/binding check for every gallery key.
// Each key must exist in business_image_objects, belong to the applicant +
// complex, and be in active state. Runs before any Drive call and before any
// DB mutation.
async function validateGalleryOwnership(
  sql: Sql,
  photoKeys: string[] | null,
  applicantUserId: string,
  complexId: string,
  requestId: string
): Promise<Response | null> {
  if (!photoKeys || photoKeys.length === 0) return null;
  let rows;
  try {
    if (photoKeys.length === 1) {
      rows = await sql`
        select object_key, uploader_user_id::text as uploader_user_id, complex_id::text as complex_id, state
        from business_image_objects
        where object_key = ${photoKeys[0]}
      `;
    } else if (photoKeys.length === 2) {
      rows = await sql`
        select object_key, uploader_user_id::text as uploader_user_id, complex_id::text as complex_id, state
        from business_image_objects
        where object_key = ${photoKeys[0]} or object_key = ${photoKeys[1]}
      `;
    } else {
      rows = await sql`
        select object_key, uploader_user_id::text as uploader_user_id, complex_id::text as complex_id, state
        from business_image_objects
        where object_key = ${photoKeys[0]} or object_key = ${photoKeys[1]} or object_key = ${photoKeys[2]}
      `;
    }
  } catch {
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable',
      503,
      requestId
    );
  }
  const byKey = new Map<string, { uploader_user_id?: string; complex_id?: string; state?: string }>();
  for (const row of rows as Array<{ object_key?: string; uploader_user_id?: string; complex_id?: string; state?: string }>) {
    if (row.object_key) byKey.set(String(row.object_key), row);
  }
  for (const key of photoKeys) {
    const row = byKey.get(key);
    if (!row) {
      return fail('INVALID_PHOTO_KEY', 'Photo object is not registered for product references', 400, requestId);
    }
    if (String(row.state ?? '') !== 'active') {
      return fail('PHOTO_NOT_ACTIVE', 'Photo object is not active for new product references', 409, requestId);
    }
    if (String(row.uploader_user_id ?? '') !== applicantUserId) {
      return fail('PHOTO_OWNER_MISMATCH', 'Photo object does not belong to this applicant', 403, requestId);
    }
    if (String(row.complex_id ?? '') !== complexId) {
      return fail('PHOTO_COMPLEX_MISMATCH', 'Photo object does not belong to this complex', 403, requestId);
    }
  }
  return null;
}

async function readApplicationPhotoKeys(sql: Sql, applicationId: string): Promise<string[]> {
  const rows = await sql`
    select object_key
    from business_application_photos
    where application_id = ${applicationId}::uuid
    order by sort_order asc
  `;
  return rows.map((row) => String((row as { object_key?: string }).object_key ?? '')).filter((key) => key.length > 0);
}

function withGallery(row: Record<string, unknown>, photoKeys: string[]): Record<string, unknown> {
  return { ...row, photoObjectKeys: [...photoKeys] };
}

// GAP-4: builds the gallery insert that runs INSIDE the same transaction as
// the application insert, so NEW APPLICATION + GALLERY ASSOCIATIONS commit or
// roll back together. The application id is pre-generated (applicationId) and
// the `where exists` guard makes the insert a no-op when the application row
// was not inserted (idempotent conflict), so it never writes orphan rows or
// aborts a legitimate replay. unique(object_key) still rejects an object that
// is already attached to a different application, which aborts the whole
// transaction (application row included) -> no representative-only application.
function galleryInsertForApplication(sql: Sql, applicationId: string, photoKeys: string[]) {
  if (photoKeys.length === 1) {
    return sql`
      insert into business_application_photos (application_id, object_key, sort_order)
      select ${applicationId}::uuid, k.object_key, k.sort_order
      from (values (${photoKeys[0]}::text, 0::int)) as k(object_key, sort_order)
      where exists (select 1 from business_applications a where a.id = ${applicationId}::uuid)
    `;
  }
  if (photoKeys.length === 2) {
    return sql`
      insert into business_application_photos (application_id, object_key, sort_order)
      select ${applicationId}::uuid, k.object_key, k.sort_order
      from (values (${photoKeys[0]}::text, 0::int), (${photoKeys[1]}::text, 1::int)) as k(object_key, sort_order)
      where exists (select 1 from business_applications a where a.id = ${applicationId}::uuid)
    `;
  }
  return sql`
    insert into business_application_photos (application_id, object_key, sort_order)
    select ${applicationId}::uuid, k.object_key, k.sort_order
    from (values (${photoKeys[0]}::text, 0::int), (${photoKeys[1]}::text, 1::int), (${photoKeys[2]}::text, 2::int)) as k(object_key, sort_order)
    where exists (select 1 from business_applications a where a.id = ${applicationId}::uuid)
  `;
}

// GAP-4 BLOCKER: a completed idempotent request must replay its stored result
// BEFORE any current object-lifecycle revalidation. A request that already
// succeeded must not fail later because a photo object was retired, and it must
// never report a persisted gallery as empty when the read fails (fail closed).
// `existing` is the row already looked up by the caller (null for a new request).
// Returns null only when there is no completed match to replay.
export async function resolveCreateReplay(
  sql: Sql,
  existing: Record<string, unknown> | null,
  requestFingerprint: string | null,
  requestId: string
): Promise<Response | null> {
  if (!existing || !requestFingerprint) return null;
  return idempotentReplayResponse(sql, existing, requestFingerprint, requestId);
}

async function createBusinessApplication(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const parsedPhotos = parsePhotoObjectKeys(payload, requestId);
  if (!parsedPhotos.ok) return parsedPhotos.response;
  const photoKeys = parsedPhotos.keys;
  const agreementError = photoContractAgreement(payload, photoKeys, requestId);
  if (agreementError) return agreementError;
  const input = applicationInput(payload, photoKeys);
  const invalid = validateApplication(input, requestId);
  if (invalid) return invalid;

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, input.complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  const rawKey = request.headers.get('idempotency-key')?.trim() || null;
  if (rawKey && !validIdempotencyKey(rawKey)) {
    return fail(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 8-80 characters using letters, numbers, dot, underscore, colon or dash',
      400,
      requestId
    );
  }
  const requestFingerprint = rawKey ? await fingerprint(input) : null;

  // GAP-4 BLOCKER: a completed idempotent request replays its stored result
  // first, before any ownership/Drive revalidation. A past success must not fail
  // later because a photo object was retired, and a replayed gallery read failure
  // must fail closed rather than report an empty gallery.
  if (rawKey && requestFingerprint) {
    const existing = await existingBusinessApplication(sql, resident.id, rawKey);
    if (existing) return await idempotentReplayResponse(sql, existing as Record<string, unknown>, requestFingerprint, requestId);
  }

  // Only a genuinely NEW request reaches ownership/Drive checks. Gallery
  // ownership is verified before any external Drive call so a foreign or
  // cross-complex key fails closed without leaking Drive state.
  const galleryKeys = photoKeys !== null
    ? photoKeys
    : (input.representativeImageObjectKey ? [input.representativeImageObjectKey] : []);
  const ownershipError = await validateGalleryOwnership(sql, galleryKeys.length > 0 ? galleryKeys : null, resident.id, resident.complexId, requestId);
  if (ownershipError) return ownershipError;

  // Only a new application may introduce a representative-image reference.
  // Keep PR #103 strict Drive validation before the DB reference-acquisition
  // critical section. The Drive call is never held inside a DB transaction.
  // GAP-4 validates every gallery key (not just the representative mirror).
  for (const key of galleryKeys) {
    const imageReferenceError = await validateBusinessImageReference(
      env,
      key,
      resident.id,
      resident.complexSlug,
      requestId
    );
    if (imageReferenceError) return imageReferenceError;
  }

  // GAP-5: validate document registry references before the DB mutation.
  // External object validation first, then DB mutation/association in transaction.
  if (input.documents && input.documents.length > 0) {
    const documentValidationError = await validateApplicationDocuments(
      sql, input.documents, resident.id, resident.complexId, requestId
    );
    if (documentValidationError) return documentValidationError;
  }

  // GAP-5: create the application row and associate its documents in a single
  // database transaction. The application id is generated client-side so the
  // document rows can reference it inside the same non-interactive transaction.
  // There is no compensation-delete: any failure rolls the whole transaction
  // back, so neither an orphaned application nor a partial document set can be
  // committed. External Drive validation already ran above, outside this block.
  const newApplicationId = crypto.randomUUID();
  let documentInsertQueries: ReturnType<Sql>[] = [];
  if (input.documents && input.documents.length > 0) {
    const objectKeys = input.documents.map((doc) => doc.objectKey);
    let associatedRows;
    try {
      associatedRows = await sql`
        select object_key from business_application_documents
        where object_key = any(${objectKeys})
      `;
    } catch {
      return fail(
        'DOCUMENT_REGISTRY_UNAVAILABLE',
        'Application document lifecycle registry is unavailable',
        503,
        requestId
      );
    }
    if ((associatedRows as { object_key: string }[]).length > 0) {
      return fail(
        'DOCUMENT_DUPLICATE_OBJECT_KEY',
        'Application document object key already associated',
        409,
        requestId
      );
    }
    documentInsertQueries = input.documents.map((doc) => sql`
      insert into business_application_documents (
        application_id, object_key, document_kind, sort_order
      ) values (
        ${newApplicationId}::uuid, ${doc.objectKey}, ${doc.kind}, ${doc.sortOrder}
      )
    `);
  }

  let inserted;
  if (input.representativeImageObjectKey) {
    // GAP-4 BLOCKER: the application row and its gallery associations must commit
    // or roll back in ONE transaction. The application id is pre-generated so the
    // gallery insert runs in the same critical section; the unique(object_key)
    // constraint aborts the whole transaction when a photo is already attached to
    // another application, so a multi-photo request can never persist as a
    // representative-only application (no best-effort compensation delete).
    let registryRows;
    try {
      [registryRows, inserted] = await sql.transaction([
        sql`
          select object_key, uploader_user_id, complex_id, state
          from business_image_objects
          where object_key = ${input.representativeImageObjectKey}
          for update
        `,
        sql`
          insert into business_applications (
            id, complex_id, applicant_user_id, relation_type, relation_raw,
            resolved_relation_type, business_name, category_name,
            service_summary, price_text, contact_method, service_area, benefit_text,
            availability_text, representative_image_object_key, submission_key,
            submission_fingerprint, status
          )
          select
            ${newApplicationId}::uuid,
            ${resident.complexId}::uuid,
            ${resident.id}::uuid,
            ${input.relationType || null},
            ${input.relationRaw || null},
            ${input.resolvedRelationType},
            ${input.businessName},
            ${input.categoryName},
            ${input.serviceSummary},
            ${input.priceText},
            ${input.contactMethod},
            ${input.serviceArea},
            ${input.benefitText},
            ${input.availabilityText},
            bio.object_key,
            ${rawKey},
            ${requestFingerprint},
            'pending'
          from business_image_objects bio
          where bio.object_key = ${input.representativeImageObjectKey}
            and bio.state = 'active'
            and bio.uploader_user_id = ${resident.id}::uuid
            and bio.complex_id = ${resident.complexId}::uuid
          on conflict (applicant_user_id, submission_key)
            where submission_key is not null
          do nothing
          returning id, relation_type, relation_raw, resolved_relation_type, business_name, category_name, service_summary,
                    price_text, contact_method, service_area, benefit_text,
                    availability_text, representative_image_object_key, status,
                    review_note, approved_business_id, submission_key, created_at, updated_at
        `,
        galleryInsertForApplication(sql, newApplicationId, galleryKeys),
        ...documentInsertQueries
      ]);
    } catch {
      return fail(
        'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
        'Business image lifecycle registry is unavailable',
        503,
        requestId
      );
    }

    const registryFailure = businessImageRegistryFailure(
      (registryRows as BusinessImageRegistryRow[])[0],
      resident.id,
      resident.complexId,
      requestId
    );
    if (registryFailure) return registryFailure;
  } else {
    try {
      [inserted] = await sql.transaction([
        sql`
          insert into business_applications (
            id, complex_id, applicant_user_id, relation_type, relation_raw,
            resolved_relation_type, business_name, category_name,
            service_summary, price_text, contact_method, service_area, benefit_text,
            availability_text, representative_image_object_key, submission_key,
            submission_fingerprint, status
          ) values (
            ${newApplicationId}::uuid,
            ${resident.complexId}::uuid,
            ${resident.id}::uuid,
            ${input.relationType || null},
            ${input.relationRaw || null},
            ${input.resolvedRelationType},
            ${input.businessName},
            ${input.categoryName},
            ${input.serviceSummary},
            ${input.priceText},
            ${input.contactMethod},
            ${input.serviceArea},
            ${input.benefitText},
            ${input.availabilityText},
            null,
            ${rawKey},
            ${requestFingerprint},
            'pending'
          )
          on conflict (applicant_user_id, submission_key)
            where submission_key is not null
          do nothing
          returning id, relation_type, relation_raw, resolved_relation_type, business_name, category_name, service_summary,
                    price_text, contact_method, service_area, benefit_text,
                    availability_text, representative_image_object_key, status,
                    review_note, approved_business_id, submission_key, created_at, updated_at
        `,
        ...documentInsertQueries
      ]);
    } catch {
      return fail(
        'DOCUMENT_REGISTRY_UNAVAILABLE',
        'Application document lifecycle registry is unavailable',
        503,
        requestId
      );
    }
  }

  if (inserted[0]) {
    const created = inserted[0] as Record<string, unknown>;
    const docs = await getApplicationDocuments(sql, String(created.id));
    // The gallery and the document set committed atomically with the
    // application row above, so a successful create can never be
    // representative-only or document-partial. Echo the request gallery (0..3)
    // so reads and promotion see a uniform model.
    return ok(withGallery({ ...created, documents: docs, idempotency_replayed: false }, galleryKeys), requestId, 201);
  }
  if (!rawKey || !requestFingerprint) return fail('CONFLICT', 'Application could not be created', 409, requestId);

  // A concurrent request may have won the unique-key race after the pre-read.
  // Resolve it through the same fail-closed replay contract: a matching
  // fingerprint returns the stored gallery, and a gallery read failure returns
  // 503 rather than reporting an empty gallery.
  const racedExisting = await existingBusinessApplication(sql, resident.id, rawKey);
  const racedReplay = await resolveCreateReplay(sql, racedExisting as Record<string, unknown> | null, requestFingerprint, requestId);
  if (racedReplay) return racedReplay;
  return fail('CONFLICT', 'Idempotent application could not be resolved', 409, requestId);
}

async function resubmitBusinessApplication(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  applicationId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const currentRows = await sql`
    select a.id, a.status, c.slug as complex_slug
    from business_applications a
    join complexes c on c.id = a.complex_id
    where a.id = ${applicationId}::uuid
      and a.applicant_user_id = ${actor.id}::uuid
    limit 1
  `;
  const current = currentRows[0];
  if (!current) return fail('NOT_FOUND', 'Business application not found', 404, requestId);
  if (String(current.status) !== 'changes_requested') {
    return fail('CONFLICT', 'Only changes_requested applications can be resubmitted', 409, requestId);
  }

  const complexSlug = String(current.complex_slug);
  const parsedPhotos = parsePhotoObjectKeys({ ...payload }, requestId);
  if (!parsedPhotos.ok) return parsedPhotos.response;
  const photoKeys = parsedPhotos.keys;
  const agreementError = photoContractAgreement({ ...payload }, photoKeys, requestId);
  if (agreementError) return agreementError;
  const input = applicationInput({ ...payload, complexSlug }, photoKeys);
  const invalid = validateApplication(input, requestId);
  if (invalid) return invalid;

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  // GAP-4: when the gallery field is present it is authoritative (REPLACE ALL
  // semantics, including explicit []). When omitted, the legacy single-key
  // contract applies and existing gallery rows are preserved.
  const galleryKeys = photoKeys !== null
    ? photoKeys
    : (input.representativeImageObjectKey ? [input.representativeImageObjectKey] : null);
  if (galleryKeys && galleryKeys.length > 0) {
    const ownershipError = await validateGalleryOwnership(sql, galleryKeys, resident.id, resident.complexId, requestId);
    if (ownershipError) return ownershipError;
    for (const key of galleryKeys) {
      const imageReferenceError = await validateBusinessImageReference(
        env,
        key,
        resident.id,
        resident.complexSlug,
        requestId
      );
      if (imageReferenceError) return imageReferenceError;
    }
  } else if (input.representativeImageObjectKey) {
    const imageReferenceError = await validateBusinessImageReference(
      env,
      input.representativeImageObjectKey,
      resident.id,
      resident.complexSlug,
      requestId
    );
    if (imageReferenceError) return imageReferenceError;
  }

  // GAP-5: when the documents field is present it is authoritative: the whole
  // document set is replaced atomically with the application update below
  // (no-op when the field is omitted, preserving existing rows).
  if (input.documents !== undefined) {
    const documentValidationError = await validateApplicationDocuments(
      sql, input.documents, resident.id, resident.complexId, requestId
    );
    if (documentValidationError) return documentValidationError;
  }
  let documentDeletes!: ReturnType<Sql>;
  let documentInserts: ReturnType<Sql>[] = [];
  if (input.documents !== undefined) {
    documentDeletes = sql`
      delete from business_application_documents
      where application_id = ${applicationId}::uuid
    `;
    documentInserts = input.documents.map((doc) => sql`
      insert into business_application_documents (
        application_id, object_key, document_kind, sort_order
      ) values (
        ${applicationId}::uuid, ${doc.objectKey}, ${doc.kind}, ${doc.sortOrder}
      )
      on conflict (object_key) do nothing
    `);
  }

  // GAP-4 REPLACE ALL: gallery present => application update + photo delete +
  // photo insert commit atomically in one transaction (application id is known).
  if (photoKeys !== null) {
    return resubmitWithGallery(request, env, sql, requestId, applicationId, resident, input, photoKeys, documentDeletes, documentInserts);
  }

  let rows;
  if (input.representativeImageObjectKey) {
    let registryRows;
    try {
      if (input.documents !== undefined) {
        [registryRows, rows] = await sql.transaction([
          sql`
            select object_key, uploader_user_id, complex_id, state
            from business_image_objects
            where object_key = ${input.representativeImageObjectKey}
            for update
          `,
          sql`
            update business_applications a
            set relation_type = ${input.relationType || null},
                relation_raw = ${input.relationRaw || null},
                resolved_relation_type = ${input.resolvedRelationType},
                business_name = ${input.businessName},
                category_name = ${input.categoryName},
                service_summary = ${input.serviceSummary},
                price_text = ${input.priceText},
                contact_method = ${input.contactMethod},
                service_area = ${input.serviceArea},
                benefit_text = ${input.benefitText},
                availability_text = ${input.availabilityText},
                representative_image_object_key = bio.object_key,
                status = 'pending',
                reviewed_by = null,
                reviewed_at = null
            from business_image_objects bio
            where a.id = ${applicationId}::uuid
              and a.applicant_user_id = ${resident.id}::uuid
              and a.status = 'changes_requested'
              and bio.object_key = ${input.representativeImageObjectKey}
              and bio.state = 'active'
              and bio.uploader_user_id = ${resident.id}::uuid
              and bio.complex_id = ${resident.complexId}::uuid
            returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                      a.service_summary, a.price_text, a.contact_method, a.service_area,
                      a.benefit_text, a.availability_text, a.representative_image_object_key,
                      a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
          `,
          documentDeletes,
          ...documentInserts
        ]);
      } else {
        [registryRows, rows] = await sql.transaction([
          sql`
            select object_key, uploader_user_id, complex_id, state
            from business_image_objects
            where object_key = ${input.representativeImageObjectKey}
            for update
          `,
          sql`
            update business_applications a
            set relation_type = ${input.relationType || null},
                relation_raw = ${input.relationRaw || null},
                resolved_relation_type = ${input.resolvedRelationType},
                business_name = ${input.businessName},
                category_name = ${input.categoryName},
                service_summary = ${input.serviceSummary},
                price_text = ${input.priceText},
                contact_method = ${input.contactMethod},
                service_area = ${input.serviceArea},
                benefit_text = ${input.benefitText},
                availability_text = ${input.availabilityText},
                representative_image_object_key = bio.object_key,
                status = 'pending',
                reviewed_by = null,
                reviewed_at = null
            from business_image_objects bio
            where a.id = ${applicationId}::uuid
              and a.applicant_user_id = ${resident.id}::uuid
              and a.status = 'changes_requested'
              and bio.object_key = ${input.representativeImageObjectKey}
              and bio.state = 'active'
              and bio.uploader_user_id = ${resident.id}::uuid
              and bio.complex_id = ${resident.complexId}::uuid
            returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                      a.service_summary, a.price_text, a.contact_method, a.service_area,
                      a.benefit_text, a.availability_text, a.representative_image_object_key,
                      a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
          `
        ]);
      }
    } catch {
      return fail(
        'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
        'Business image lifecycle registry is unavailable',
        503,
        requestId
      );
    }

    const registryFailure = businessImageRegistryFailure(
      (registryRows as BusinessImageRegistryRow[])[0],
      resident.id,
      resident.complexId,
      requestId
    );
    if (registryFailure) return registryFailure;
  } else if (input.documents !== undefined) {
    try {
      [rows] = await sql.transaction([
        sql`
          update business_applications a
          set relation_type = ${input.relationType || null},
              relation_raw = ${input.relationRaw || null},
              resolved_relation_type = ${input.resolvedRelationType},
              business_name = ${input.businessName},
              category_name = ${input.categoryName},
              service_summary = ${input.serviceSummary},
              price_text = ${input.priceText},
              contact_method = ${input.contactMethod},
              service_area = ${input.serviceArea},
              benefit_text = ${input.benefitText},
              availability_text = ${input.availabilityText},
              representative_image_object_key = null,
              status = 'pending',
              reviewed_by = null,
              reviewed_at = null
          where a.id = ${applicationId}::uuid
            and a.applicant_user_id = ${resident.id}::uuid
            and a.status = 'changes_requested'
          returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                    a.service_summary, a.price_text, a.contact_method, a.service_area,
                    a.benefit_text, a.availability_text, a.representative_image_object_key,
                    a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
        `,
        documentDeletes,
        ...documentInserts
      ]);
    } catch {
      return fail(
        'DOCUMENT_UPDATE_UNAVAILABLE',
        'Application document update failed',
        503,
        requestId
      );
    }
  } else {
    rows = await sql`
      update business_applications a
      set relation_type = ${input.relationType || null},
          relation_raw = ${input.relationRaw || null},
          resolved_relation_type = ${input.resolvedRelationType},
          business_name = ${input.businessName},
          category_name = ${input.categoryName},
          service_summary = ${input.serviceSummary},
          price_text = ${input.priceText},
          contact_method = ${input.contactMethod},
          service_area = ${input.serviceArea},
          benefit_text = ${input.benefitText},
          availability_text = ${input.availabilityText},
          representative_image_object_key = null,
          status = 'pending',
          reviewed_by = null,
          reviewed_at = null
      where a.id = ${applicationId}::uuid
        and a.applicant_user_id = ${resident.id}::uuid
        and a.status = 'changes_requested'
      returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                a.service_summary, a.price_text, a.contact_method, a.service_area,
                a.benefit_text, a.availability_text, a.representative_image_object_key,
                a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
    `;
  }

  // Legacy preserve path (photoObjectKeys omitted): existing gallery rows stay.
  if (rows[0]) {
    const updated = rows[0] as Record<string, unknown>;
    if (input.documents !== undefined) {
      // GAP-5: the replaced document set committed with the application update
      // above; the response must carry it.
      const docs = await getApplicationDocuments(sql, applicationId);
      try {
        const stored = await readApplicationPhotoKeys(sql, String(updated.id ?? applicationId));
        return ok(withGallery({ ...updated, documents: docs }, stored), requestId);
      } catch {
        return ok({ ...updated, documents: docs }, requestId);
      }
    }
    try {
      const stored = await readApplicationPhotoKeys(sql, String(updated.id ?? applicationId));
      return ok(withGallery(updated, stored), requestId);
    } catch {
      return ok(updated, requestId);
    }
  }
  return fail('CONFLICT', 'Application can no longer be resubmitted from its current state', 409, requestId);
}

// GAP-4: atomic resubmit with gallery replacement. The application row update,
// old-gallery delete, and new-gallery insert commit in one transaction so a
// failed gallery write never leaves the representative mirror disagreeing
// with the gallery rows.
async function resubmitWithGallery(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  applicationId: string,
  resident: { id: string; complexId: string; complexSlug: string },
  input: ApplicationInput,
  photoKeys: string[],
  documentDeletes?: ReturnType<Sql>,
  documentInserts?: ReturnType<Sql>[]
): Promise<Response> {
  const mirror = photoKeys.length > 0 ? photoKeys[0] : null;

  // Registry lock (FOR UPDATE) serializes concurrent resubmits/deletes.
  const lockQuery = photoKeys.length === 0
    ? null
    : photoKeys.length === 1
      ? sql`
          select object_key, uploader_user_id, complex_id, state
          from business_image_objects
          where object_key = ${photoKeys[0]}
          for update
        `
      : photoKeys.length === 2
        ? sql`
          select object_key, uploader_user_id, complex_id, state
          from business_image_objects
          where object_key = ${photoKeys[0]} or object_key = ${photoKeys[1]}
          for update
        `
        : sql`
          select object_key, uploader_user_id, complex_id, state
          from business_image_objects
          where object_key = ${photoKeys[0]} or object_key = ${photoKeys[1]} or object_key = ${photoKeys[2]}
          for update
        `;

  const updateQuery = mirror
    ? sql`
        update business_applications a
        set relation_type = ${input.relationType || null},
            relation_raw = ${input.relationRaw || null},
            resolved_relation_type = ${input.resolvedRelationType},
            business_name = ${input.businessName},
            category_name = ${input.categoryName},
            service_summary = ${input.serviceSummary},
            price_text = ${input.priceText},
            contact_method = ${input.contactMethod},
            service_area = ${input.serviceArea},
            benefit_text = ${input.benefitText},
            availability_text = ${input.availabilityText},
            representative_image_object_key = bio.object_key,
            status = 'pending',
            reviewed_by = null,
            reviewed_at = null
        from business_image_objects bio
        where a.id = ${applicationId}::uuid
          and a.applicant_user_id = ${resident.id}::uuid
          and a.status = 'changes_requested'
          and bio.object_key = ${mirror}
          and bio.state = 'active'
          and bio.uploader_user_id = ${resident.id}::uuid
          and bio.complex_id = ${resident.complexId}::uuid
        returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                  a.service_summary, a.price_text, a.contact_method, a.service_area,
                  a.benefit_text, a.availability_text, a.representative_image_object_key,
                  a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
      `
    : sql`
        update business_applications a
        set relation_type = ${input.relationType || null},
            relation_raw = ${input.relationRaw || null},
            resolved_relation_type = ${input.resolvedRelationType},
            business_name = ${input.businessName},
            category_name = ${input.categoryName},
            service_summary = ${input.serviceSummary},
            price_text = ${input.priceText},
            contact_method = ${input.contactMethod},
            service_area = ${input.serviceArea},
            benefit_text = ${input.benefitText},
            availability_text = ${input.availabilityText},
            representative_image_object_key = null,
            status = 'pending',
            reviewed_by = null,
            reviewed_at = null
        where a.id = ${applicationId}::uuid
          and a.applicant_user_id = ${resident.id}::uuid
          and a.status = 'changes_requested'
        returning a.id, a.relation_type, a.relation_raw, a.resolved_relation_type, a.business_name, a.category_name,
                  a.service_summary, a.price_text, a.contact_method, a.service_area,
                  a.benefit_text, a.availability_text, a.representative_image_object_key,
                  a.status, a.review_note, a.approved_business_id, a.created_at, a.updated_at
      `;

  const deleteQuery = sql`
    delete from business_application_photos
    where application_id = ${applicationId}::uuid
  `;

  const insertQuery = photoKeys.length === 0
    ? null
    : photoKeys.length === 1
      ? sql`
        insert into business_application_photos (application_id, object_key, sort_order)
        values (${applicationId}::uuid, ${photoKeys[0]}, 0)
      `
      : photoKeys.length === 2
        ? sql`
        insert into business_application_photos (application_id, object_key, sort_order)
        values (${applicationId}::uuid, ${photoKeys[0]}, 0), (${applicationId}::uuid, ${photoKeys[1]}, 1)
      `
        : sql`
        insert into business_application_photos (application_id, object_key, sort_order)
        values (${applicationId}::uuid, ${photoKeys[0]}, 0), (${applicationId}::uuid, ${photoKeys[1]}, 1), (${applicationId}::uuid, ${photoKeys[2]}, 2)
      `;

  let results;
  try {
    const queries = lockQuery
      ? (insertQuery ? [lockQuery, updateQuery, deleteQuery, insertQuery] : [lockQuery, updateQuery, deleteQuery])
      : (insertQuery ? [updateQuery, deleteQuery, insertQuery] : [updateQuery, deleteQuery]);
    // GAP-5: document replacement joins the same transaction when present.
    if (documentDeletes) queries.push(documentDeletes);
    if (documentInserts) queries.push(...documentInserts);
    results = await sql.transaction(queries);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/duplicate|unique|23505/i.test(message)) {
      return fail('PHOTO_ALREADY_USED', 'Photo object is already attached to another application', 409, requestId);
    }
    return fail(
      'BUSINESS_IMAGE_REGISTRY_UNAVAILABLE',
      'Business image lifecycle registry is unavailable',
      503,
      requestId
    );
  }

  const updatedRows = (lockQuery ? results[1] : results[0]) as Array<Record<string, unknown>>;
  if (!updatedRows[0]) {
    return fail('CONFLICT', 'Application can no longer be resubmitted from its current state', 409, requestId);
  }
  if (documentDeletes) {
    const docs = await getApplicationDocuments(sql, applicationId);
    return ok(withGallery({ ...updatedRows[0], documents: docs }, photoKeys), requestId);
  }
  return ok(withGallery(updatedRows[0], photoKeys), requestId);
}

async function claimBenefit(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  benefitId: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const complexSlug = String(payload.complexSlug ?? '').trim();
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);

  const residentOrResponse = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (residentOrResponse instanceof Response) return residentOrResponse;
  const resident = residentOrResponse;

  const benefitRows = await sql`
    select be.id, be.complex_id, be.business_id
    from benefits be
    join businesses b on b.id = be.business_id
    join complexes c on c.id = be.complex_id
    where be.id = ${benefitId}::uuid
      and c.id = ${resident.complexId}::uuid
      and be.status = 'active'
      and b.status = 'approved'
      and (be.starts_at is null or be.starts_at <= now())
      and (be.ends_at is null or be.ends_at >= now())
    limit 1
  `;
  if (!benefitRows[0]) return fail('NOT_FOUND', 'Active benefit not found for this complex', 404, requestId);

  const inserted = await sql`
    insert into benefit_claims (benefit_id, user_id, complex_id, claim_code, status)
    values (
      ${benefitId}::uuid,
      ${resident.id}::uuid,
      ${resident.complexId}::uuid,
      ('DANJION-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
      'stored'
    )
    on conflict (user_id, benefit_id) do nothing
    returning id, benefit_id, claim_code, status, claimed_at, used_at
  `;
  if (inserted[0]) return ok(inserted[0], requestId, 201);

  const existing = await sql`
    select id, benefit_id, claim_code, status, claimed_at, used_at
    from benefit_claims
    where user_id = ${resident.id}::uuid
      and benefit_id = ${benefitId}::uuid
    limit 1
  `;
  if (!existing[0]) return fail('CONFLICT', 'Benefit claim could not be resolved', 409, requestId);
  return ok(existing[0], requestId);
}

export async function handleResidentEconomyMutationRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const applicationCreate = request.method === 'POST' && path === '/api/v1/me/business-applications';
  const applicationResubmit = request.method === 'PATCH'
    ? path.match(/^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)$/)
    : null;
  const benefitClaim = request.method === 'POST'
    ? path.match(/^\/api\/v1\/me\/benefits\/([0-9a-fA-F-]+)\/claim$/)
    : null;
  if (!applicationCreate && !applicationResubmit && !benefitClaim) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;
  const sql: Sql = neon(env.DATABASE_URL);

  if (applicationCreate) return createBusinessApplication(request, env, sql, requestId, payload);
  if (applicationResubmit) {
    return resubmitBusinessApplication(request, env, sql, requestId, applicationResubmit[1], payload);
  }
  return claimBenefit(request, env, sql, requestId, benefitClaim![1], payload);
}
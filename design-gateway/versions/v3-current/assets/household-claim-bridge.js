export const DANJION_HOUSEHOLD_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

function validationError() {
  return { ok: false, reason: 'validation-error', status: 0 };
}

function row(value) {
  return value && typeof value === 'object' ? value : {};
}

function text(value) {
  return value == null ? '' : String(value);
}

export function normalizeUnit(value) {
  const raw = row(value);
  const id = text(raw.id);
  if (!UUID.test(id)) return null;
  return { id, buildingCode: text(raw.buildingCode), unitCode: text(raw.unitCode) };
}

export function normalizeMember(value) {
  const raw = row(value);
  return {
    membershipId: text(raw.membershipId),
    displayName: text(raw.displayName),
    membershipRole: text(raw.membershipRole) || 'member',
    status: text(raw.status) || 'pending',
    residentVerified: raw.residentVerified === true
  };
}

export function normalizeInvite(value) {
  const raw = row(value);
  return {
    inviteId: text(raw.inviteId),
    status: text(raw.status),
    createdAt: text(raw.createdAt),
    expiresAt: text(raw.expiresAt),
    acceptedAt: raw.acceptedAt == null ? null : text(raw.acceptedAt),
    revokedAt: raw.revokedAt == null ? null : text(raw.revokedAt)
  };
}

export function normalizeHouseholdSnapshot(value) {
  const raw = row(value);
  const unitRaw = row(raw.unit);
  const unit = raw.unit == null ? null : {
    buildingCode: text(unitRaw.buildingCode),
    unitCode: text(unitRaw.unitCode)
  };
  return {
    complexSlug: text(raw.complexSlug) || DANJION_HOUSEHOLD_COMPLEX_SLUG,
    unit,
    myMembership: normalizeMember(raw.myMembership),
    members: Array.isArray(raw.members) ? raw.members.map(normalizeMember) : [],
    invites: Array.isArray(raw.invites) ? raw.invites.map(normalizeInvite) : []
  };
}

export function normalizeClaimResult(value) {
  const raw = row(value);
  return {
    status: text(raw.status),
    membershipRole: text(raw.membershipRole),
    unitId: text(raw.unitId),
    alreadyVerified: raw.alreadyVerified === true
  };
}

export function normalizeRedemption(value) {
  const raw = row(value);
  return {
    membershipId: text(raw.membershipId),
    membershipRole: text(raw.membershipRole) || 'member',
    status: text(raw.status) || 'pending',
    complexSlug: text(raw.complexSlug),
    residentVerified: raw.residentVerified === true,
    verificationRequired: raw.verificationRequired !== false
  };
}

// Household lane bridge (#328). Transport and envelope semantics are delegated
// to the shared #324 DanjionSession runtime (credentials include, {data,requestId}
// envelope, 401/403 -> auth-required, fail-closed on 5xx/network). Nothing is
// persisted in the browser: the family invite token is returned once by the
// server and stays in memory only. Client-side guards mirror the backend
// fail-closed validators (claim: unitId UUID + opaque token; invite TTL 1..168;
// redeem: token only; member/invite routes: UUID).
export function createHouseholdClaimBridge({
  apiBase = '',
  fetchImpl = globalThis.fetch,
  Session = globalThis.DanjionSession,
  complexSlug = DANJION_HOUSEHOLD_COMPLEX_SLUG,
  headers = {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!Session || typeof Session.request !== 'function' || typeof Session.joinUrl !== 'function') {
    throw new TypeError('DanjionSession runtime is required');
  }
  const base = String(apiBase || '').replace(/\/+$/, '');
  const slug = encodeURIComponent(String(complexSlug || DANJION_HOUSEHOLD_COMPLEX_SLUG));
  const householdPath = `/api/v1/complexes/${slug}/household`;

  function call(path, init = {}) {
    return Session.request(fetchImpl, Session.joinUrl(base, path), {
      ...init,
      headers: { ...headers, ...(init.headers || {}) }
    });
  }

  return {
    async listUnits() {
      const result = await call(`${householdPath}/units`, { method: 'GET' });
      if (!result.ok) return result;
      const data = row(result.data);
      const complex = row(data.complex);
      const units = (Array.isArray(data.units) ? data.units.map(normalizeUnit) : []).filter(Boolean);
      return { ...result, data: { complex: { slug: text(complex.slug) || decodeURIComponent(slug), name: text(complex.name) }, units } };
    },
    async claim(input) {
      const unitId = text(input?.unitId);
      const token = text(input?.token);
      if (!UUID.test(unitId) || !OPAQUE_TOKEN.test(token)) return validationError();
      const result = await call(`${householdPath}/claim`, {
        method: 'POST',
        body: JSON.stringify({ unitId, token })
      });
      return result.ok ? { ...result, data: normalizeClaimResult(result.data) } : result;
    },
    async getSnapshot() {
      const result = await call(householdPath, { method: 'GET' });
      return result.ok ? { ...result, data: normalizeHouseholdSnapshot(result.data) } : result;
    },
    async createInvite(expiresInHours = 24) {
      if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) return validationError();
      const result = await call(`${householdPath}/family-invites`, {
        method: 'POST',
        body: JSON.stringify({ expiresInHours })
      });
      if (!result.ok) return result;
      const data = row(result.data);
      return { ...result, data: { inviteId: text(data.inviteId), token: text(data.token), createdAt: text(data.createdAt), expiresAt: text(data.expiresAt) } };
    },
    async revokeInvite(inviteId) {
      const id = text(inviteId);
      if (!UUID.test(id)) return validationError();
      return call(`${householdPath}/family-invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async redeemInvite(token) {
      const clean = text(token).trim();
      if (!OPAQUE_TOKEN.test(clean)) return validationError();
      const result = await call('/api/v1/household/family-invites/redeem', {
        method: 'POST',
        body: JSON.stringify({ token: clean })
      });
      return result.ok ? { ...result, data: normalizeRedemption(result.data) } : result;
    },
    async leave() {
      return call(`${householdPath}/members/me`, { method: 'DELETE' });
    },
    async revokeMember(membershipId) {
      const id = text(membershipId);
      if (!UUID.test(id)) return validationError();
      return call(`${householdPath}/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  };
}

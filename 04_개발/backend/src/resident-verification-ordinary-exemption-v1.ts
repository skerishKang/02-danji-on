import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Actor } from './auth-v1';

type Sql = NeonQueryFunction<false, false>;

/**
 * Ordinary test-resident verification exemption (#823).
 *
 * A single ordinary email test account is allowed to pass the
 * resident-verification gates WITHOUT any admin authority. This allowlist is
 * deliberately NOT part of `padiem_admin_identity_allowlist` /
 * `padiem_operator_grants`: any row in `padiem_operator_grants` (even one
 * bounded scope) flips `resolvePadiemAuthority().level` to 'operator' and
 * surfaces the account in the admin console (#411), which this account must
 * never reach.
 *
 * Contract:
 *   - exact normalized-address matching only; bare '*', wildcards, prefixes,
 *     suffixes, and domain patterns can never match;
 *   - consulted ONLY as a fallback after the explicit
 *     `resident.verification.exempt` grant check, never before it;
 *   - it bypasses resident verification exactly like the grant path:
 *     householdId/membershipId/membershipRole stay null, so household-scoped
 *     surfaces keep requiring a real membership;
 *   - the provider rule mirrors admin-bootstrap (#592): a credential login
 *     proves mailbox possession with the password, every other provider must
 *     carry the verified-email bit.
 */
export const ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS = Object.freeze([
  'skerish1@naver.com'
] as const);

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeOrdinaryExemptionEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email || email === '*' || !EMAIL_SHAPE.test(email)) return null;
  return email;
}

export function isOrdinaryTestResidentExemptEmail(value: unknown): boolean {
  const email = normalizeOrdinaryExemptionEmail(value);
  if (email === null) return false;
  return (ORDINARY_TEST_RESIDENT_EXEMPT_EMAILS as readonly string[]).includes(email);
}

export async function resolveOrdinaryTestResidentExemption(
  sql: Sql,
  actor: Actor
): Promise<boolean> {
  const rows = await sql`
    select
      lower(btrim(u.email)) as email,
      u.email_verified,
      exists (
        select 1
        from danjion_auth.account a
        where a.user_id = u.id
          and lower(a.provider_id) = 'credential'
      ) as credential_account
    from danjion_auth."user" u
    where u.id = ${actor.authUserId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return false;
  const providerAdmitted = row.email_verified === true || row.credential_account === true;
  return providerAdmitted && isOrdinaryTestResidentExemptEmail(row.email);
}

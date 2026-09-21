import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

/**
 * Temporary resident access mode (#868).
 *
 * OWNER DECISION: the authoritative Unit Master and household-code issuance are
 * not ready yet, so ordinary signed-in members are admitted to the GENERAL
 * resident surfaces for the time being.
 *
 * This is explicitly NOT "resident verification completed". When the canonical
 * Unit Master + household codes are ready, `TEMP_RESIDENT_ACCESS_MODE` is set to
 * `false` and the pre-existing strict resident-verification gates come back
 * exactly as they are — no migration, no data backfill, no cleanup step.
 *
 * Hard boundaries (never widened by this switch):
 *   - SIGNED_OUT is still denied: the switch is consulted strictly AFTER
 *     `requireActor()` has already resolved a signed-in actor, so an anonymous
 *     request never reaches it (401 AUTH_REQUIRED).
 *   - ADMIN authority is untouched: nothing here reads or grants a PADIEM
 *     operator/admin grant row or the wildcard scope, so the authority
 *     resolver's level stays 'none' for every temporary admission.
 *   - OPERATOR authority is untouched: `requirePadiemOperator()` /
 *     `requireComplexOperator()` never consult this module.
 *   - NO household is fabricated: the temporary admission keeps
 *     householdId/membershipId/membershipRole null, so every household-specific
 *     surface (household messaging, family, blocks, household-scoped profile)
 *     keeps requiring a real verified membership.
 *
 * Switch parsing is fail-closed: ONLY the exact string `true` (surrounding
 * whitespace and ASCII case ignored) turns the mode ON. `false`, an empty
 * string, `1`, `yes`, `on`, and an undefined/absent var all stay OFF.
 */
export const TEMP_RESIDENT_ACCESS_MODE_VAR = 'TEMP_RESIDENT_ACCESS_MODE';

export type TemporaryResidentAccessEnv = {
  TEMP_RESIDENT_ACCESS_MODE?: string;
};

export function parseTemporaryResidentAccessMode(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function isTemporaryResidentAccessEnabled(
  env: TemporaryResidentAccessEnv | null | undefined
): boolean {
  if (!env || typeof env !== 'object') return false;
  return parseTemporaryResidentAccessMode(env.TEMP_RESIDENT_ACCESS_MODE);
}

/**
 * Does this account already hold a REAL verified household membership?
 *
 * Only consulted while the temporary mode is ON, to keep an already-verified
 * resident on the ordinary resident path: such an account needs no exemption at
 * all, so it must never be reported (or labelled) as a temporary user. The
 * lookup is read-only and mirrors the exact predicate `requireVerifiedResident`
 * uses for the real resident path.
 */
export async function hasVerifiedResidentMembership(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql`
    select hm.id as membership_id
    from household_memberships hm
    join households h
      on h.id = hm.household_id
     and h.complex_id = hm.complex_id
    join complex_units cu
      on cu.id = h.complex_unit_id
     and cu.complex_id = h.complex_id
    where hm.user_id = ${userId}
      and hm.status = 'verified'
      and h.status = 'active'
      and cu.status = 'active'
    limit 1
  `;
  return rows.length > 0;
}

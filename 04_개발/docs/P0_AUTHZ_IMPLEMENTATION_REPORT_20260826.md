# DanjiOn P0 AuthZ Implementation Report — 2026-08-26

## Scope

Issue #48 / PR #49

Base:
`222e5186d02f7649a0be43ba50a274edd02623d1`

## Implemented

### Forward migrations

- 009 household foundation
- 010 household invite / family lifecycle
- 011 consent + authorization audit
- 012 PADIEM operator grants

Existing 001–008 are unchanged.

### Runtime guards

`src/authorization-v2.ts`

- `requireVerifiedResident(request, env, sql, requestId, complexSlug)`
- `requirePadiemOperator(request, env, sql, requestId, scope)`

Authorization derives from the authenticated `app_users` actor and server-side DB state only.

Legacy `complex_memberships manager|admin` is not consulted for PADIEM platform authority.

### Synthetic principal contract

- A/B: verified resident, complex 1 => resident PASS
- C: verified resident, complex 2 => complex 1 DENY
- D: authenticated but unverified => resident DENY
- O: PADIEM operator grant for `community.moderate` => operator PASS
- M: apartment resident/legacy manager without PADIEM grant => operator DENY
- forged client role/verified/complex headers => no privilege elevation
- operator allow/deny => audit event required

## Neon migration sandbox verification

Project:
`old-shape-61609481` / Danjion

Production parent:
`br-bold-sun-azurylwi`

Migration sandbox ID:
`9fb36df0-b475-4877-8180-a6693712b58f`

Temporary branch:
`mcp-migration-2026-08-25T23-27-19`
`br-flat-firefly-azt49495`

Result:

- 009–012 migration bundle applied successfully to temporary branch
- all 8 expected tables present
- composite household/complex foreign keys verified
- family invite token/inviter/accepted-membership household consistency constraints verified
- PADIEM operator grants table verified separate from apartment manager/admin role
- no production migration applied
- sandbox migration cancelled with `applyChanges=false`
- temporary branch deleted after verification

## Safety

```text
PRODUCTION_DB_MUTATION = NONE
PRODUCTION_DEPLOY = NONE
PRODUCTION_DRIVE_WRITE = NONE
COMMUNITY_TABLES = NONE
MIGRATIONS_001_008_CHANGED = NO
```

## Next gate

PR #49 exact-head CI must be green before Issue #48 can close.

After #48 is green, Community C2 may allocate migration 013 only after a fresh next-available migration check.

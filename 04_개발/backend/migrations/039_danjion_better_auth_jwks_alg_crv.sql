-- Better Auth 1.7.x jwt plugin persists the signing algorithm and curve per key.
-- Without alg/crv the /api/auth/jwks endpoint throws
-- 'The field "alg" does not exist in the "jwks" Drizzle schema' (500 in production).
alter table danjion_auth.jwks add column if not exists alg text;

alter table danjion_auth.jwks add column if not exists crv text;

comment on column danjion_auth.jwks.alg is
  'JWT signing algorithm stored by the Better Auth jwt plugin (nullable for pre-1.7 keys).';

comment on column danjion_auth.jwks.crv is
  'JWT elliptic curve identifier stored by the Better Auth jwt plugin (nullable for pre-1.7 keys).';

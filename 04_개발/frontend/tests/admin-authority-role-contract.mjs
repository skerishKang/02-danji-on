import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #412 KILO2: the admin console must resolve its role ONLY from the fixed
// GET /api/v1/admin/authority grant (#411), fail closed when that grant is
// missing, and never fabricate 최고관리 mutations. This contract pins the
// client-side shape of that boundary against the real source files.

const root = new URL('../', import.meta.url);
const [adminApi, adminApp] = await Promise.all([
  readFile(new URL('src/admin-api.ts', root), 'utf8'),
  readFile(new URL('src/AdminApp.tsx', root), 'utf8')
]);

// --- authority contract (admin-api.ts) ---
assert.match(adminApi, /export type AdminAuthorityLevel = 'admin' \| 'operator'/,
  'authority level must stay the fixed admin/operator union');
assert.match(adminApi, /export interface AdminAuthority/,
  'admin-api must declare the AdminAuthority type');
assert.match(adminApi, /label: '최고관리자' \| '일반관리자'/,
  'authority label must stay the fixed 최고관리자/일반관리자 union');
assert.match(adminApi, /scopes: string\[\][\s\S]*wildcard: boolean/,
  'authority must carry the scopes/wildcard grant shape');
assert.match(adminApi, /fetchAuthority[\s\S]*\/api\/v1\/admin\/authority/,
  'authority must be read from the fixed single backend endpoint');
assert.equal((adminApi.match(/async fetchAuthority\(/g) || []).length, 2,
  'both the mock and api admin adapters must expose fetchAuthority');
assert.match(adminApi, /export function normalizeAdminAuthority/,
  'authority responses must pass through fail-closed normalization');
assert.match(adminApi, /record\.level === 'admin' \? 'admin' : 'operator'/,
  'an unexpected authority level must fail closed to operator');
assert.match(adminApi, /record\.wildcard === true/,
  'wildcard must require a strict boolean true to widen capability');
assert.match(adminApi, /export function hasSuperAdminCapability/,
  'the super-admin capability check must be centralized');
assert.match(adminApi, /level: 'operator', label: OPERATOR_LABEL/,
  'the mock/preview adapter must stay at least privilege (operator)');
assert.doesNotMatch(adminApi, /localStorage|sessionStorage|indexedDB/i,
  'authority must never read or write browser persistence');

// --- role-aware UI (AdminApp.tsx) ---
assert.match(adminApp, /import \{[\s\S]*?hasSuperAdminCapability[\s\S]*?\} from '\.\/admin-api'/,
  'AdminApp must use the centralized capability check');
assert.match(adminApp, /type AdminAuthority/,
  'AdminApp must import the authority type');
assert.match(adminApp, /adminAdapter\.fetchAuthority\(\)/,
  'AdminApp must resolve authority from the adapter before rendering privileged UI');
assert.match(adminApp, /catch \{[\s\S]*?setAuthority\(null\)/,
  'a failed authority fetch must fail closed to no privileged view');
assert.match(adminApp, /hasSuperAdminCapability\(authority\)/,
  'the privileged view must be capability gated, never inferred');
assert.match(adminApp, /isSuperAdmin && \(\s*<button[\s\S]*?최고관리/,
  'the 최고관리 tab must render only for super admins');
assert.match(adminApp, /isSuperAdmin && tab === 'privileged'/,
  'the 최고관리 panel must render only for super admins');
assert.match(adminApp, /admin-role-badge/,
  'AdminApp must surface the current role label');
assert.match(adminApp, /aria-disabled="true"[\s\S]*?연동 대기/,
  '최고관리 capabilities must stay disabled/read-only placeholders until a real backend endpoint exists');
assert.match(adminApp, /\/verification-admin\.html/,
  'ordinary operator view must link to the separate resident verification admin surface');
assert.match(adminApp, /ResidentNewsReviewPanel/,
  'ordinary resident-news review operations must be preserved');
assert.doesNotMatch(adminApp, /localStorage|sessionStorage|location\.search|location\.hash|atob\(/,
  'AdminApp must never infer a role from client state, url params, or decoded tokens');

console.log('PASS #412 admin authority role-aware fail-closed contract');

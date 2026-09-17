import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/qa-persona-provision.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../../.github/workflows/qa-persona-provision.yml', import.meta.url), 'utf8');
const residentBranch = source.match(/if \(desired\.length === 0\) \{\s*await sql`([\s\S]*?)`;/);
assert.ok(residentBranch, 'resident grant revocation query must exist');
const query = residentBranch[1];
assert.equal((query.match(/::text/g) || []).length, 1, 'only the persona metadata parameter needs a text cast');
assert.ok(query.includes("jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)"));
assert.ok(query.includes("where user_id = ${actor.userId}::uuid and status = 'active'"));
assert.equal((query.match(/\$\{/g) || []).length, 2, 'persona and user ID must remain bound parameters');
const convergence = source.match(/async function convergePadiemGrants\(sql, actor\) \{([\s\S]*?)\nfunction reportAuthority/);
assert.ok(convergence, 'grant convergence function must exist');
const metadataQueries = [...convergence[1].matchAll(/await sql`([\s\S]*?)`;/g)]
  .map((match) => match[1])
  .filter((statement) => statement.includes('jsonb_build_object'));
assert.equal(metadataQueries.length, 4, 'all four grant metadata queries must be covered');
const parameterCounts = [2, 3, 3, 5];
for (const [index, statement] of metadataQueries.entries()) {
  assert.ok(statement.includes("jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)"), `metadata query ${index + 1} must type its persona parameter`);
  assert.equal((statement.match(/\$\{actor\.name\}::text/g) || []).length, 1);
  assert.equal((statement.match(/\$\{/g) || []).length, parameterCounts[index], 'query parameters must remain bound');
  assert.ok(statement.includes('${actor.userId}::uuid'), 'user ID must retain its UUID cast');
}
assert.ok(metadataQueries[1].includes('${desired}::text[]'), 'scope list must retain its array cast');
assert.match(source, /if \(required\('APP_ENV'\) !== 'qa'\) throw/);
assert.match(source, /if \(process\.env\.DATABASE_URL\) throw/);
assert.match(source, /if \(process\.env\.DANJION_PRODUCTION_DB_URL\) throw/);
assert.ok(source.includes("if (/production|prod\\b/i.test(url.hostname)) throw new Error('QA_PERSONA_PRODUCTION_DATABASE_FORBIDDEN')"));
assert.match(source, /const apiOrigin = exactHttpsOrigin\(required\('DANJION_QA_API_URL'\), 'API', QA_API_HOST\)/);
assert.match(source, /const frontendOrigin = exactHttpsOrigin\(required\('DANJION_QA_FRONTEND_URL'\), 'FRONTEND', QA_FRONTEND_HOST\)/);
assert.match(workflow, /environment:\s*qa/);
assert.match(workflow, /inputs\.confirm_qa_personas/);
assert.match(workflow, /test "\$remote" = "\$expected"/);
assert.match(workflow, /run: node 04_개발\/backend\/tests\/qa-persona-sql-type-contract\.mjs/);
console.log('qa-persona-sql-type-contract: PASS');

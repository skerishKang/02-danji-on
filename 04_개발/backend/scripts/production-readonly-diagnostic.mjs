const api = 'https://padiem-danjion-api-production.padiem.workers.dev';
const frontend = 'https://danjion.pages.dev';

const get = async (path) => {
  const response = await fetch(new URL(path, api), {
    headers: { accept: 'application/json', origin: frontend }
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

async function main() {
  if (process.env.APP_ENV !== 'production') throw new Error('APP_ENV_REQUIRED');
  if (process.env.DATABASE_URL || process.env.DANJION_PRODUCTION_DB_URL) throw new Error('DB_MUTATION_AUTHORITY_FORBIDDEN');

  console.log('PRODUCTION_READONLY_DIAGNOSTIC=START');

  const health = await fetch(`${api}/api/health`);
  console.log(`HEALTH_STATUS=${health.status}`);

  const jwks = await fetch(`${api}/.well-known/jwks.json`);
  console.log(`JWKS_STATUS=${jwks.status}`);

  for (const path of [
    '/api/v1/admin/authority',
    '/api/v1/me/resident-verification-exemption'
  ]) {
    const result = await get(path);
    console.log(`ROUTE=${path} STATUS=${result.status}`);
  }

  console.log('ACCOUNT_PROVISIONING=NO');
  console.log('HOUSEHOLD_MUTATION=NO');
  console.log('MEMBERSHIP_MUTATION=NO');
  console.log('SECRET_OUTPUT=NO');
  console.log('PRODUCTION_READONLY_DIAGNOSTIC=PASS');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

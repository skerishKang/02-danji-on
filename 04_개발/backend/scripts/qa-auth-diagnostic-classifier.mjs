export const ROOT_CLASS = Object.freeze({
  SUCCESS: 'SUCCESS',
  AUTH_CREDENTIAL_MISMATCH: 'AUTH_CREDENTIAL_MISMATCH',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_SERVER_FAILURE: 'AUTH_SERVER_FAILURE',
  DB_INFRA_FAILURE: 'DB_INFRA_FAILURE',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  SESSION_FAILURE: 'SESSION_FAILURE',
  AUTHORITY_FAILURE: 'AUTHORITY_FAILURE',
  SECRET_BINDING_FAILURE: 'SECRET_BINDING_FAILURE',
  RATE_LIMITED: 'RATE_LIMITED'
});

export const RETRYABLE_CLASSES = Object.freeze(new Set([
  ROOT_CLASS.AUTH_SERVER_FAILURE,
  ROOT_CLASS.NETWORK_TIMEOUT,
  ROOT_CLASS.DB_INFRA_FAILURE
]));

export const MAX_RETRY_ATTEMPTS = 2;

export const DB_FAILURE_SIGNATURES = Object.freeze([
  'error connecting to database',
  'econnrefused',
  'econnreset',
  'enotfound',
  'etimedout',
  'socket hang up'
]);

const MUTATION_PATH_PATTERN = /sign-up|password-reset|repair|converge|provision|insert\s+into|update\s+|delete\s+from/i;

export function isMutationPath(path) {
  return MUTATION_PATH_PATTERN.test(String(path || ''));
}

export function containsDbSignature(text) {
  const lowered = String(text || '').toLowerCase();
  return DB_FAILURE_SIGNATURES.some((signature) => lowered.includes(signature));
}

export function isTimeoutError(error) {
  if (!error) return false;
  const name = String(error.name || '');
  const message = String(error.message || '').toLowerCase();
  return name === 'TimeoutError'
    || name === 'AbortError'
    || message.includes('timeout')
    || message.includes('aborted')
    || message.includes('und_err_connect_timeout')
    || message.includes('network timeout');
}

export function safeBody(raw) {
  const text = String(raw || '').slice(0, 400);
  const trimmed = text.trim();
  const code = text.match(/"code"\s*:\s*"([A-Z0-9_]+)"/i);
  const shape = !trimmed ? 'empty' : (trimmed.startsWith('{') || trimmed.startsWith('[')) ? 'json' : 'text';
  return `${code ? `code=${code[1]}` : 'code=UNPARSED'} body=${shape}`;
}

export function redactSecrets(text, secretValues) {
  let out = String(text ?? '');
  for (const secret of secretValues || []) {
    if (typeof secret === 'string' && secret.length >= 4) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out;
}

export function classifyFailure({ stage, status, bodyText, error }) {
  const diagnosticText = [
    error ? String(error.message || error) : '',
    bodyText || ''
  ].join(' ');

  if (containsDbSignature(diagnosticText)) return ROOT_CLASS.DB_INFRA_FAILURE;

  if (error) {
    if (isTimeoutError(error)) return ROOT_CLASS.NETWORK_TIMEOUT;
    if (stage === 'signin') return ROOT_CLASS.NETWORK_TIMEOUT;
    if (stage === 'session') return ROOT_CLASS.SESSION_FAILURE;
    if (stage === 'authority') return ROOT_CLASS.AUTHORITY_FAILURE;
    return ROOT_CLASS.NETWORK_TIMEOUT;
  }

  if (status === 401) {
    if (stage === 'signin') return ROOT_CLASS.AUTH_CREDENTIAL_MISMATCH;
    if (stage === 'session') return ROOT_CLASS.SESSION_FAILURE;
    return ROOT_CLASS.AUTHORITY_FAILURE;
  }
  if (status === 403) return ROOT_CLASS.AUTH_FORBIDDEN;
  if (status === 429) return ROOT_CLASS.RATE_LIMITED;
  if (status >= 500) {
    if (stage === 'signin') return ROOT_CLASS.AUTH_SERVER_FAILURE;
    if (stage === 'session') return ROOT_CLASS.SESSION_FAILURE;
    if (stage === 'authority') return ROOT_CLASS.AUTHORITY_FAILURE;
    return ROOT_CLASS.AUTH_SERVER_FAILURE;
  }
  if (stage === 'signin') return ROOT_CLASS.AUTH_CREDENTIAL_MISMATCH;
  if (stage === 'session') return ROOT_CLASS.SESSION_FAILURE;
  return ROOT_CLASS.AUTHORITY_FAILURE;
}

export function shouldRetry(rootClass, attempt, maxAttempts = MAX_RETRY_ATTEMPTS) {
  if (!RETRYABLE_CLASSES.has(rootClass)) return false;
  return attempt < maxAttempts;
}

export function resolveRootClass(stageResults) {
  for (const result of stageResults) {
    if (result && result.rootClass && result.rootClass !== ROOT_CLASS.SUCCESS) {
      return result.rootClass;
    }
  }
  return ROOT_CLASS.SUCCESS;
}

export function checkCredentialBinding(name, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, rootClass: ROOT_CLASS.SECRET_BINDING_FAILURE, reason: `missing:${name}` };
  if (raw.length < 8) return { ok: false, rootClass: ROOT_CLASS.SECRET_BINDING_FAILURE, reason: `malformed:${name}` };
  return { ok: true, rootClass: null, reason: '' };
}

export async function withBoundedRetry(runAttempt, { maxAttempts = MAX_RETRY_ATTEMPTS, onAttempt } = {}) {
  const attempts = Math.max(1, maxAttempts);
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runAttempt(attempt);
    lastResult = result;
    if (onAttempt) onAttempt({ attempt, rootClass: result.rootClass, stage: result.stage });
    if (result.rootClass === ROOT_CLASS.SUCCESS) return { ...result, retries: attempt - 1 };
    if (!shouldRetry(result.rootClass, attempt, attempts)) {
      return { ...result, retries: attempt - 1 };
    }
  }
  return { ...lastResult, retries: attempts - 1 };
}

export function classifyInfraCorrelation(probeResults) {
  const health = probeResults.find((result) => result.label === 'health');
  const jwks = probeResults.find((result) => result.label === 'jwks');
  const infraCorrelated = [health, jwks].every((result) => result && RETRYABLE_CLASSES.has(result.rootClass));
  return {
    INFRA_CORRELATED: infraCorrelated ? 'YES' : 'NO',
    NEON_COLD_START_SUSPECTED: infraCorrelated ? 'YES' : 'NO'
  };
}

export function buildReport({ personas, probes, forbiddenMutationCount = 0, secretValues = [] }) {
  const probeRoots = Object.entries(probes || {}).map(([label, probe]) => ({ label, rootClass: probe.rootClass }));
  const correlation = classifyInfraCorrelation(probeRoots);

  const report = {
    timestamp: new Date().toISOString(),
    personas: personas || {},
    probes: probes || {},
    ...correlation,
    FORBIDDEN_MUTATION_COUNT: forbiddenMutationCount,
    SECRET_EXPOSURE: 'NO'
  };

  return JSON.parse(redactSecrets(JSON.stringify(report), secretValues));
}

const TRANSPORT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

const AVAILABILITY_SQLSTATE_CODES = new Set([
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  '58000',
  '58030'
]);

const TIMEOUT_ERROR_NAMES = new Set(['ABORTERROR', 'TIMEOUTERROR']);
const MAX_ERROR_CHAIN = 8;

export const DB_AVAILABILITY_CODE = 'DB_AVAILABILITY_UNAVAILABLE';
export const DB_AVAILABILITY_MESSAGE = 'Database is temporarily unavailable';

type ErrorField = 'cause' | 'code' | 'name' | 'sourceError';

function field(error: unknown, name: ErrorField): unknown {
  return typeof error === 'object' && error !== null && name in error
    ? (error as Record<ErrorField, unknown>)[name]
    : undefined;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function availabilityCode(value: unknown): boolean {
  const code = normalizedString(value);
  return code.startsWith('08')
    || TRANSPORT_ERROR_CODES.has(code)
    || AVAILABILITY_SQLSTATE_CODES.has(code);
}

function hasAvailabilityMarker(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;

  for (let depth = 0; depth < MAX_ERROR_CHAIN; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return false;
    seen.add(current);

    if (TIMEOUT_ERROR_NAMES.has(normalizedString(field(current, 'name')))) return true;
    if (availabilityCode(field(current, 'code'))) return true;

    const sourceError = field(current, 'sourceError');
    if (sourceError !== undefined) {
      current = sourceError;
      continue;
    }

    const cause = field(current, 'cause');
    if (cause !== undefined) {
      current = cause;
      continue;
    }

    return false;
  }

  return false;
}

export function isDbAvailabilityError(error: unknown): boolean {
  if (hasAvailabilityMarker(error)) return true;
  return normalizedString(field(error, 'name')) === 'NEONDBERROR'
    && normalizedString(field(error, 'code')) === '';
}

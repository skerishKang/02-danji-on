const HOUSEHOLD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOUSEHOLD_CODE_FORMAT = /^[A-Z0-9]{6,12}$/;

export function normalizeHouseholdCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '') : '';
}

export function isHouseholdCode(value: string): boolean {
  return HOUSEHOLD_CODE_FORMAT.test(value);
}

export function generateHouseholdCode(length = 8): string {
  if (!Number.isInteger(length) || length < 6 || length > 12) {
    throw new Error('household code length must be 6-12');
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += HOUSEHOLD_CODE_ALPHABET[byte % HOUSEHOLD_CODE_ALPHABET.length];
  return out;
}

export async function householdCodeVerifier(code: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

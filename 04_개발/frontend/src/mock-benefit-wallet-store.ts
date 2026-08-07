import type { Benefit, BenefitClaim, BenefitClaimStatus } from './types';

const STORAGE_KEY = 'danjion.mock.benefit-wallet.v1';

type StoredBenefitClaim = {
  id: string;
  subject: string;
  benefitId: string;
  code: string;
  status: BenefitClaimStatus;
  claimedAt: string;
  usedAt?: string | null;
};

function readClaims(): StoredBenefitClaim[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as StoredBenefitClaim[] : [];
  } catch {
    return [];
  }
}

function writeClaims(rows: StoredBenefitClaim[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function numericCode(value: string) {
  if (value === 'benefit-1') return '0248';
  let hash = 0;
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return String(hash % 10000).padStart(4, '0');
}

function toClaim(row: StoredBenefitClaim, benefit: Benefit): BenefitClaim {
  return {
    id: row.id,
    benefitId: row.benefitId,
    businessId: benefit.businessId,
    businessName: benefit.businessName,
    title: benefit.title,
    description: benefit.description,
    conditions: benefit.conditions,
    code: row.code,
    status: row.status,
    claimedAt: row.claimedAt,
    usedAt: row.usedAt ?? null
  };
}

export function listMockBenefitClaims(subject: string, benefits: Benefit[]): BenefitClaim[] {
  const byId = new Map(benefits.map((benefit) => [benefit.id, benefit]));
  return readClaims()
    .filter((row) => row.subject === subject && byId.has(row.benefitId))
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
    .map((row) => toClaim(row, byId.get(row.benefitId)!));
}

export function claimMockBenefit(subject: string, benefit: Benefit): BenefitClaim {
  const rows = readClaims();
  const existing = rows.find((row) => row.subject === subject && row.benefitId === benefit.id);
  if (existing) return toClaim(existing, benefit);

  const created: StoredBenefitClaim = {
    id: `mock-benefit-claim-${crypto.randomUUID()}`,
    subject,
    benefitId: benefit.id,
    code: `DANJION-${numericCode(benefit.id)}`,
    status: 'stored',
    claimedAt: new Date().toISOString(),
    usedAt: null
  };
  writeClaims([created, ...rows]);
  return toClaim(created, benefit);
}

export function useMockBenefit(subject: string, benefit: Benefit): BenefitClaim {
  const rows = readClaims();
  const index = rows.findIndex((row) => row.subject === subject && row.benefitId === benefit.id);
  if (index < 0) throw new Error('먼저 주민혜택을 받아 보관해 주세요.');

  const current = rows[index];
  if (current.status === 'used') return toClaim(current, benefit);
  const updated: StoredBenefitClaim = {
    ...current,
    status: 'used',
    usedAt: new Date().toISOString()
  };
  rows[index] = updated;
  writeClaims(rows);
  return toClaim(updated, benefit);
}

export function resetMockBenefitWallet() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
}

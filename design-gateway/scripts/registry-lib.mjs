#!/usr/bin/env node
/**
 * Shared registry loader/validator for the DanjiOn design gateway (#395).
 * Used by scripts/build.mjs and every tests/*-contract.mjs.
 * Node-only, zero dependencies, deterministic.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const GATEWAY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(GATEWAY_ROOT, '..');
export const REGISTRY_PATH = join(GATEWAY_ROOT, 'registry', 'versions.json');
export const DIST_DIR = join(GATEWAY_ROOT, 'dist');

export const SCHEMA_ID = 'danjion-design-registry-v1';
export const STATUSES = ['PRODUCTION', 'DESIGN_AUTHORITY', 'COMPARISON_ONLY', 'ARCHIVED'];
export const BUNDLE_MODES = ['mounted', 'assembled'];
export const BUNDLE_STATES = ['PENDING', 'READY'];
export const RESERVED_PATH_SEGMENTS = [
  'index.html', 'gateway.css', 'gateway.js', 'registry', '_headers', 'assets', 'favicon.ico'
];

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function loadRegistry() {
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  return JSON.parse(raw);
}

export function validateRegistry(registry) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  if (registry.$schema !== SCHEMA_ID) err(`$schema must be ${SCHEMA_ID}`);
  if (!registry.gateway || registry.gateway.environment !== 'NON_PRODUCTION') {
    err('gateway.environment must be NON_PRODUCTION');
  }
  if (!registry.gateway || !SHA_PATTERN.test(String(registry.gateway.capturedFromMain || ''))) {
    err('gateway.capturedFromMain must be a 40-char lowercase commit sha');
  }
  if (!Array.isArray(registry.versions) || registry.versions.length === 0) {
    err('versions must be a non-empty array');
    return errors;
  }

  const seenIds = new Set();
  for (const v of registry.versions) {
    const at = `version[${v?.id ?? '?'}]`;
    if (typeof v.id !== 'string' || !ID_PATTERN.test(v.id)) err(`${at}: id must be kebab-case`);
    if (seenIds.has(v.id)) err(`${at}: duplicate id`);
    seenIds.add(v.id);
    if (RESERVED_PATH_SEGMENTS.includes(v.id)) err(`${at}: id collides with reserved gateway path segment`);

    if (typeof v.name !== 'string' || v.name.trim() === '') err(`${at}: name required`);
    if (!STATUSES.includes(v.status)) err(`${at}: status must be one of ${STATUSES.join('|')}`);
    if (typeof v.runtime !== 'string' || v.runtime.trim() === '') err(`${at}: runtime required`);
    if (typeof v.frozen !== 'boolean') err(`${at}: frozen must be boolean`);
    if (typeof v.doNotMerge !== 'boolean') err(`${at}: doNotMerge must be boolean`);

    const s = v.source || {};
    if (typeof s.path !== 'string' || s.path.trim() === '') err(`${at}: source.path required`);
    if (typeof s.ref !== 'string' || s.ref.trim() === '') err(`${at}: source.ref required`);
    if (!SHA_PATTERN.test(String(s.sha || ''))) err(`${at}: source.sha must be a 40-char lowercase commit sha`);
    if (!DATE_PATTERN.test(String(s.capturedAt || ''))) err(`${at}: source.capturedAt must be YYYY-MM-DD`);

    const b = v.bundle || {};
    if (!BUNDLE_MODES.includes(b.mode)) err(`${at}: bundle.mode must be ${BUNDLE_MODES.join('|')}`);
    if (!BUNDLE_STATES.includes(b.state)) err(`${at}: bundle.state must be ${BUNDLE_STATES.join('|')}`);
    if (typeof b.entry !== 'string' || b.entry.trim() === '') err(`${at}: bundle.entry required`);
    if (b.mode === 'mounted') {
      if (b.mountPath !== `design-gateway/preview-bundles/${v.id}`) {
        err(`${at}: mounted bundle.mountPath must be design-gateway/preview-bundles/${v.id}`);
      }
    }
    if (b.mode === 'assembled' && (typeof b.sourceDir !== 'string' || b.sourceDir.trim() === '')) {
      err(`${at}: assembled bundle.sourceDir required`);
    }

    if (v.doNotMerge && !(v.frozen && (v.status === 'COMPARISON_ONLY' || v.status === 'ARCHIVED'))) {
      err(`${at}: doNotMerge requires frozen=true and status COMPARISON_ONLY|ARCHIVED`);
    }
    if (typeof v.notes !== 'string' || v.notes.trim() === '') err(`${at}: notes required`);
  }

  const production = registry.versions.filter((v) => v.status === 'PRODUCTION');
  const authority = registry.versions.filter((v) => v.status === 'DESIGN_AUTHORITY');
  if (production.length !== 1) err(`exactly one PRODUCTION entry required (found ${production.length})`);
  if (authority.length !== 1) err(`exactly one DESIGN_AUTHORITY entry required (found ${authority.length})`);
  if (production[0]?.doNotMerge) err('PRODUCTION entry must not be doNotMerge');

  return errors;
}

export function loadAndValidateRegistry() {
  const registry = loadRegistry();
  const errors = validateRegistry(registry);
  if (errors.length > 0) {
    throw new Error(`registry validation failed:\n  - ${errors.join('\n  - ')}`);
  }
  return registry;
}

export function repoPath(...segments) {
  return join(REPO_ROOT, ...segments);
}

export function existsDir(p) {
  return existsSync(p);
}

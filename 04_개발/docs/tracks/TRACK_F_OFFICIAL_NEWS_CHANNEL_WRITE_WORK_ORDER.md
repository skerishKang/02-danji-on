# TRACK F — OFFICIAL NEWS CHANNEL WRITE WORK ORDER

## 1. Mission

Fix the official-news channel write path so that `createPost`/`patchPost` no longer silently default every new post to `apartment_news`. Apply channel derivation on write with one shared constant rule, expose `channel` in write responses, and add a dedicated write contract test.

Repository: `skerishKang/02-danji-on`
Base: `origin/main` (= `a4021f0`, includes #257 official-news channel contract)
Issue: #246 (R1 slice) / policy boundary #139
Branch: `feat/track-f-official-news-channel-write` (Draft PR only, no merge)

## 2. Problem

- `admin-v1.ts` / `admin-operational-v2.ts` do not set `channel` on create/patch, so every new post lands in `apartment_news`.
- Backfill (`040`) and the write path must share the same channel constants to prevent drift.

## 3. Required implementation

### 3.1 Channel derivation rule

Single function `deriveChannel(sourceName, explicit?)`:

1. Explicit enum value wins when provided.
2. `SOURCE_CHANNEL = { '단지온 운영자': 'danjion_notice', '관리사무소': 'management_office' }` otherwise.
3. Unknown explicit values → `400 INVALID_CHANNEL`.
4. Default fallback for any other source: `apartment_news`.

### 3.2 Apply on write path

- `createPost` / `patchPost` in `admin-v1.ts` and `admin-operational-v2.ts` must set `channel` via `deriveChannel`.
- Add `returning ... channel` so write responses expose the channel.

### 3.3 Shared constant with backfill

- Backfill migration `040` and the write path must reference the same channel constants (drift prohibition).
- New mappings only via migration `041` if needed. `040` must not be modified.

## 4. HOLD

- `chair_greeting` (회장 인사말) source mapping must NOT be added arbitrarily. Leave it at the default for now; do not map until CTO approval.

## 5. Contract test

New test: `backend/tests/complex-news-channel-write-contract.mjs`
Register `test:complex-news-channel-write` in `package.json` in all applicable places.

Must cover all four:

1. Explicit enum wins.
2. Unknown enum → `400`.
3. Chain derivation (단지온 운영자 → `danjion_notice`, 관리사무소 → `management_office`, unspecified → `apartment_news`).
4. Shared constants with `040` (no drift).

## 6. Completion gates

- backend `npm run typecheck` green
- `test:complex-news-channel` green
- `test:complex-news-channel-write` green
- No changes to migrations 001–039, no edits to `040`.
- No production deploy / DB write / secret leakage.
- Draft PR only; report branch + commit hash.

## 7. Forbidden

- Modifying migrations 001–039, editing `040`.
- Production DB write/seed, production deploy, production Drive write.
- Adding `chair_greeting` source mapping.
- Secreting values in code/logs/issue/PR/chat.
- Merging PR or declaring `PRODUCTION_READY`.

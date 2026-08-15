# DanjiOn Stable Demo Deployment — 2026-08-16

## Purpose

Create a clean public DanjiOn address without changing or overwriting the existing V1/V2/Gateway comparison deployments.

Target public address:

- `https://danjion.pages.dev`

This deployment identity contains **no B05 / 05 portfolio numbering**.

## Source Authority

Deployment source branch baseline:

- `feat/v2-platform-20260808`
- source head at branch creation: `d9288a255d2eefe230b8602f7d92aa5f32cc2d60`

The V2 visual/product work is grounded in the canonical DanjiOn image-refresh field-demo source rather than the separate AI Revenue Lab B05 visual experiment.

Canonical design source recorded by V2:

- `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`
- Drive ID: `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB`
- SHA256: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`

Core product journey:

`발견 → 검색 → 상세 → 주민혜택 → 내 일 알리기 → 홍보물 → 운영확인/승인 → 다시 발견`

## Protected Existing Deployments

Do not overwrite or repurpose:

- `https://v1.padiem-danjion-web-preview.pages.dev`
- `https://v2.padiem-danjion-web-preview.pages.dev`
- `https://gateway.padiem-danjion-web-preview.pages.dev`
- Cloudflare Pages project `padiem-danjion-web-preview`

These remain comparison/preview evidence surfaces.

## New Deployment Isolation

New Cloudflare Pages project:

- project name: `danjion`
- production branch: `main`
- intended address: `https://danjion.pages.dev`

The workflow first checks whether a project named `danjion` already exists.

- If absent: create it and deploy.
- If already present: fail closed and do not overwrite it.

## Runtime Profile

This first clean-address deployment is a **stable public demo**, not a production-service readiness claim.

Build profile:

- `VITE_UI_VARIANT=v2`
- `VITE_DATA_MODE=mock`
- `VITE_AUTH_MODE=dev`
- `VITE_STORAGE_MODE=mock`

The current product still has separate live Auth/DB/Drive release gates. A clean URL does not convert a demo profile into production readiness.

## Branding Rule

Public DanjiOn surfaces must use:

- `단지온`
- `DanjiOn`

Forbidden public identity:

- `B05`
- `05`
- `Business 05`
- AI Revenue Lab numbering as product branding

## Relationship to AI Revenue Lab

AI Revenue Lab B05 is lineage/history only: `확장 → 단지온`.

The 2026-08-16 `B05_Resident_Marketplace_Identity_Refinement` output is reference-only and must not replace DanjiOn product authority.

## Owner Approval

`OWNER_UI_APPROVED=false` remains unchanged until the owner explicitly approves a specific DanjiOn surface/revision.

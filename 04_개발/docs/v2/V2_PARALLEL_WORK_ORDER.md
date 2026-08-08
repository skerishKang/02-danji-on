# DanjiOn V2 Parallel Work Order

Status: ACTIVE / DRAFT / DO NOT MERGE
Program issue: #25
Integration gate: #30
Governance lock: #32

## 1. Purpose

Build a parallel DanjiOn V2 React product surface from the approved Google Drive reference while preserving the current V1 as the default functional baseline.

V1 and V2 are two UI surfaces over the same product infrastructure. Do not fork the backend, database schema, Auth identity model, or storage model for V2.

## 2. Fixed V2 reference

Canonical reference file:

- name: `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`
- Google Drive file id: `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB`
- SHA256: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`
- sibling assets: `05_실행자산/scene-*.webp`, `05_실행자산/ui-icons.svg`
- image manifest: `이미지출처_및_교체내역.md`

The reference must be read from beginning to end before implementation. If its bytes change, do not silently follow the new version. Record a new source-lock decision first.

## 3. Base code

- repository: `skerishKang/02-danji-on`
- product integration source: `feat/live-stack-integration@60098fa8336f6d14a172238cf4f5ee2ebc67f1bc`
- V2 integration branch: `feat/v2-platform-20260808`

The current V1 remains the fallback/default UI.

## 4. Target React structure

Initial separation is intentionally conservative:

```text
04_개발/frontend/src/
├─ App.tsx                 # existing V1, protected
├─ main.tsx                # minimal variant entry switch only
├─ ui-variant.tsx          # V1 / V2 / gateway selector
├─ gateway/                # lightweight version chooser
├─ v2/
│  ├─ V2App.tsx
│  ├─ visual/
│  ├─ flows/
│  ├─ v2-visual.css
│  └─ v2-flow.css
└─ existing shared api/auth/data modules
```

Build contract:

- `VITE_UI_VARIANT=v1` -> existing V1 `App`
- `VITE_UI_VARIANT=v2` -> V2 app
- `VITE_UI_VARIANT=gateway` -> version chooser
- unset -> V1

V1 and V2 may be deployed as separate Cloudflare Pages preview projects using the same repository and shared Worker/API infrastructure. Gateway links may navigate between origins. Do not implement a giant conditional component tree that mixes V1 and V2 styling at runtime.

## 5. Parallel tracks

### V2-A — Visual fidelity
Issue #26
Branch `feat/v2-a-visual-fidelity`

Own:
- `04_개발/frontend/src/v2/visual/**`
- `04_개발/frontend/src/v2/v2-visual.css`
- `04_개발/docs/v2/V2_VISUAL_FIDELITY_REPORT.md`

Translate the reference hero, topbar, large Korean editorial typography, real-photo composition, cinematic sticky scenes, scene rail/tabs, category color transitions, visual explorer primitives, reduced-motion and responsive behavior.

Do not own data/API/auth/deploy logic.

### V2-B — Product flows
Issue #27
Branch `feat/v2-b-product-flows`

Own:
- `04_개발/frontend/src/v2/flows/**`
- `04_개발/frontend/src/v2/V2App.tsx`
- `04_개발/frontend/src/v2/v2-flow.css`
- `04_개발/docs/v2/V2_PRODUCT_FLOW_MAPPING.md`

Reuse the existing frontend adapters/types for the reference journey:
`발견 -> 검색 -> 상세 -> 주민혜택 -> 내 일 알리기 -> 홍보물 -> 운영확인/승인 -> 다시 발견`.

Do not create a second backend schema or pretend that unfinished live Auth/Drive work is complete.

### V2-C — Version router / gateway / preview topology
Issue #28
Branch `feat/v2-c-gateway-routing`

Own:
- `04_개발/frontend/src/gateway/**`
- `04_개발/frontend/src/ui-variant.tsx`
- minimal `04_개발/frontend/src/main.tsx`
- minimal `04_개발/frontend/.env.example`
- V2/gateway-specific preview workflow/config files
- `04_개발/docs/v2/V2_DEPLOYMENT_TOPOLOGY.md`

V1 must remain the default with no variant configured.

### V2-D — Fidelity / QA gate
Issue #29
Branch `feat/v2-d-fidelity-qa`

Own:
- `04_개발/frontend/tests/v2-*.spec.ts`
- `04_개발/frontend/tests/v2/**`
- `04_개발/docs/v2/V2_PARITY_MATRIX.md`
- `04_개발/docs/v2/V2_QA_GATE.md`
- optional `04_개발/scripts/v2-*`

Create source-grounded parity and automated gates. Do not declare fidelity PASS until integrated outputs are actually tested.

## 6. Hard boundaries

All tracks:

- no production deploy;
- no merge;
- Draft PR only;
- no force push to sibling branches;
- no migration `001` through `008` changes;
- no destructive DB write;
- no production Drive write;
- no secret values in code, logs, issues, PRs or chat;
- no new R2 dependency;
- no final login-provider implementation in this program;
- no silent visual redesign of V1;
- no deleting or replacing historical v1-v7/M1 artifacts.

The existing authentication architecture may be consumed through its current interfaces, but Google/email/Kakao/Naver policy remains a separate decision gate.

## 7. V2 source characteristics that must not be lost

The canonical reference is not just a recolor. Preserve its structural intent:

- fixed editorial topbar;
- first-screen search visible;
- large asymmetric hero with real photography;
- cinematic/sticky category storytelling section;
- strong scene/category color transitions;
- product UI landing after cinematic opening;
- readable search/filter/detail flows;
- resident benefit and business-registration cycle;
- motion that can be reduced without breaking the flow;
- desktop/tablet/mobile behavior.

Do not collapse V2 back into the current V1 icon-card presentation.

## 8. Integration gate

After A/B/C/D each publish a fixed commit and Draft PR, integration happens only on `feat/v2-platform-20260808` under #30.

Required sequence:

1. inspect fixed sibling heads;
2. integrate A visual primitives;
3. integrate B product-flow composition;
4. resolve A/B boundaries without copying backend logic;
5. integrate C variant/gateway/deploy topology;
6. integrate D tests/gates last;
7. prove unset variant still renders/builds V1;
8. prove separate V1/V2/gateway builds;
9. run V2 responsive/accessibility/flow gates;
10. only then create a combined V2 preview candidate.

## 9. Completion verdicts

Allowed intermediate verdicts:

- `V2_A_VISUAL_READY`
- `V2_B_FLOW_READY`
- `V2_C_ROUTING_READY`
- `V2_D_QA_CONTRACT_READY`
- `V2_INTEGRATION_GREEN`
- `V2_PREVIEW_READY`

Do not use `PRODUCTION_READY` in this program.

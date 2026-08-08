# DanjiOn V2 Product Flow Mapping

Status: `V2-B` implementation record / Draft / do not merge directly

Program: #25  
Track: #27  
Governance: #32  
Integration gate: #30  
Branch: `feat/v2-b-product-flows`

## 1. Source lock

Canonical V2 reference:

- `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`
- Google Drive file id: `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB`
- expected SHA256: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`
- verified SHA256 before implementation: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`

The reference was read end-to-end before implementation. Its source lock was unchanged.

Image manifest inspected:

- `이미지출처_및_교체내역.md`
- image-refresh preserves the reference layout/functions/motion/copy and replaces repeated imagery with job-specific scenes.

Track B does not copy those visual assets. It exposes `V2FlowVisualSlots` so Track V2-A can supply the fixed visual primitives at integration without changing the product contracts or V1.

## 2. Reference journey preserved

The canonical HTML implements a stateful cycle, not a static landing page:

```text
발견
→ 검색/필터
→ 상세
→ 주민혜택 받기/사용
→ 내 일 알리기 4단계 등록
→ 신청 데이터 기반 홍보물 미리보기
→ 운영확인/보완/승인
→ 승인된 가게가 목록에 다시 공개
→ 다시 발견
```

V2-B maps this journey to React while preserving current infrastructure ownership.

## 3. Existing contracts reused

### Discovery / search / detail

Existing `DataAdapter`:

- `listBusinesses(filters)`
- `getBusiness(id)`
- `getBookmarks()` / `addBookmark()` / `removeBookmark()`
- `getBusinessContacts(id)`

V2 uses `BusinessFilters` directly. No V2 search API or duplicated ranking rule is created.

The existing mock adapter and backend already order/filter by relation. V2 only renders the returned order.

### Resident benefit

Existing `DataAdapter`:

- `listBenefits()`
- `listBenefitClaims()`
- `claimBenefit(benefitId)`
- `useBenefit(benefitId)`

V2 displays the existing `BenefitClaim` code and `stored | used` status. It does not invent a V2-only benefit wallet state.

### Business application

Existing contracts:

- `BusinessApplicationInput`
- `createBusinessApplication(input)`
- `listMyBusinessApplications()`
- `getMyBusinessApplication(id)`
- `resubmitBusinessApplication(id, input)`
- existing `storageAdapter.upload('business-image', file)`

V2 registration retains the reference's four-step intent:

1. resident relation
2. business/service information
3. representative image and resident benefit
4. public vs private review boundary

No new business application schema is introduced.

### Promotion material

The fixed HTML derives three promo artifacts from the pending application before operator approval.

V2 keeps this as client-side presentation only:

- listing card preview
- messenger/share preview
- notice-board poster preview

No new promo table, API endpoint, Drive folder, or persistent object contract is added. This is intentionally a UI preview derived from `BusinessApplication`.

### Operator review / approval

Existing `adminAdapter`:

- `listApplications()`
- `reviewApplication(id, status, reviewNote)`
- existing server-side manager/admin authorization

V2 calls `adminAdapter.reviewApplication`. It does not implement approval in the browser.

For mock mode, existing `reviewMockApplication()` sets `approvedBusinessId`, and `listApprovedMockBusinesses()` materializes the approved application as an existing `Business`.

For API mode, existing backend approval already atomically:

- changes `business_applications.status` to `approved`
- creates/keeps the approved `businesses` row
- creates/updates the business-complex relation
- attaches representative media when present
- creates the resident benefit when present

V2 therefore refreshes existing `dataAdapter.listBusinesses()` after approval and highlights the newly discoverable business. No second approval pipeline exists.

## 4. Privacy and authorization mapping

The fixed reference clearly separates:

- public business information
- private resident relationship / verification material

V2 maintains that boundary.

### Contact information

`getBusinessContacts()` is called through the existing adapter. V2 does not expose a fallback contact value or bypass server authorization. If the current actor cannot access contact information, the existing API error is shown as a permission/authentication message.

### Resident verification

No new V2 resident-verification type, endpoint, or state machine is created.

Existing backend contracts remain authoritative:

- resident verification GET/POST under the current membership
- `resident_verifications` and `complex_memberships.verification_status`
- private evidence object key
- manager/admin review contract

V2 registration copy refers to this existing boundary but does not retrieve or display evidence originals.

### Operator authority

V2 operator review calls the existing admin adapter. API mode still requires the existing server-side manager/admin + verified membership checks. The V2 UI does not grant operator authority by rendering the operator component.

## 5. Auth and storage status are not overstated

V2 consumes the existing `authProvider` interface only.

- `dev` remains the current development interface where configured.
- unfinished Neon Auth adapter state remains unfinished.
- Google/email/Kakao/Naver provider policy is not selected here.
- no final login-provider decision is made.

Storage also remains the existing `mock | drive` adapter boundary. V2 does not claim Google Drive live integration is complete merely because the interface exists.

## 6. React ownership

Track B changes only its governance-locked surfaces:

```text
04_개발/frontend/src/v2/V2App.tsx
04_개발/frontend/src/v2/flows/V2ProductFlows.tsx
04_개발/frontend/src/v2/v2-flow.css
04_개발/docs/v2/V2_PRODUCT_FLOW_MAPPING.md
```

Not changed:

- V1 `App.tsx`
- V1 CSS
- `main.tsx`
- gateway/router files
- backend code
- migrations
- DB schema
- auth provider implementation
- Cloudflare workflows

## 7. V2-A integration boundary

`V2App` accepts optional `V2FlowVisualSlots`:

- `hero`
- `cinematic`
- `businessMedia(business, context)`
- `promotionMedia(application)`

These are presentation slots only. They do not own product state or adapter calls. Track A can replace Track B's explicit placeholders during #30 integration without reimplementing search, benefit, application, review, or authorization behavior.

## 8. Flow state and failure behavior

V2 never treats visual navigation as proof that infrastructure succeeded.

- failed search/detail calls keep API errors visible
- failed benefit claim/use keeps existing state
- failed application submission does not advance to promo
- failed admin review does not mark approval
- rediscovery happens only after approval succeeds and `listBusinesses()` returns the materialized result

The client does not fabricate a successful live Auth/Drive/backend state.

## 9. Verification gate

Track B verification target:

- TypeScript strict typecheck
- Vite build
- existing frontend/backend/pre-infra CI must remain green where triggered
- no V1 regression by file ownership
- changed-file audit must remain inside Track B ownership

Dedicated V2 fidelity/E2E specifications are owned by Track V2-D (#29), so Track B does not create or edit sibling-owned test files.

## 10. Track verdict rule

Use `V2_B_FLOW_READY` only after:

1. the branch contains only Track B-owned changes;
2. typecheck/build are green;
3. Draft PR targets `feat/v2-platform-20260808`;
4. PR remains unmerged.

This verdict is not `V2_INTEGRATION_GREEN`, `V2_PREVIEW_READY`, or `PRODUCTION_READY`. Those require later integration/preview gates.

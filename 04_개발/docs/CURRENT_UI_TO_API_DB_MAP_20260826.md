# Danjion CURRENT UI → Function → API → DB Map

Date: 2026-08-26  
Visual authority: sibling Gate1 final (`#52`)  
Parent backend baseline: AuthZ `edc4c0a...` + Community C2 `d264608...`

## 1. Rule

The visual source defines composition and resident-facing behavior. Production truth comes from current API/AuthZ/DB contracts, never from Gate1 localStorage/demo state.

## 2. Screen map

| CURRENT UI surface | Required production behavior | Existing backend/data | Gap / next action |
|---|---|---|---|
| Cinematic first entry | open complex-specific Danjion entry, no resident privilege yet | `complexes`, public business/news reads | keep public shell; do not infer verification from common link |
| Account start | provider adapter login | Neon Auth / `app_users`; provider boundary | Kakao candidate + Google fallback wiring remains provider task; SMS mandatory HOLD |
| Terms / privacy / optional notifications | versioned consent persistence | `consent_records` (011) | API endpoints for current consent + withdrawal |
| Dong/unit picker | choose only master units | `complex_units`, `households` (009) | unit list/read endpoint; never free-text production unit |
| Household confirmation | verify household invite/code; grant resident membership | `household_invite_tokens`, `household_memberships` | claim/redeem service + atomic membership transition |
| Join complete | show visual completion without overstating resident authority | AuthN + Household states | UI state machine: authenticated / selected / pending / verified |
| Home search | search resident-priority businesses/services | `businesses`, `business_complex_relations`, categories | reuse current business list/search API |
| Home real-work photography | approved media only | `business_media` + StorageAdapter | media provenance/consent gate, no demo image as product truth |
| Neighbor shops list/detail | relationship-first discovery, service detail | businesses, relations, contacts | mostly reusable; current UI presentation port |
| Save | resident saved shop | `bookmarks` | existing API reusable; verified/private gate as appropriate |
| Contact / inquiry method reveal | protected contact access | `business_contacts` | must consume `requireVerifiedResident`; no client `verified` trust |
| Resident benefits | list/claim/use | `benefits`, `benefit_claims` | existing benefit APIs reusable; AuthZ check alignment |
| My work / announce work | submit resident/family/local relationship application | `business_applications`, review events/media | existing application flow reusable; visual port only plus Household actor binding |
| MY / household | membership status and family invite | 009–010 household tables | new household summary + invite APIs |
| Family invitation | issue opaque invite, redeem into same household | `household_invite_tokens`, `family_invites` | create/redeem/revoke APIs; URL must not expose dong/unit |
| Official complex news | official/trusted content | `complex_posts` | preserve existing official domain and public/complex contract |
| Resident community | verified-resident-only feed/write | `community_*` (013) | C3 after this map; authorization must be Household v2 |
| Moderation | PADIEM operator review/audit | `community_moderation_events`, `community_reports`, `padiem_operator_grants`, `audit_events` | C4 operator API; apartment manager/admin does not imply operator |

## 3. Current DB disposition

### Keep / reuse

- `app_users`
- `complexes`
- `businesses`
- `business_categories`
- `business_complex_relations`
- `business_contacts`
- `business_media`
- `bookmarks`
- `benefits`
- `benefit_claims`
- `business_applications`
- review-event tables
- `complex_posts`
- 009–012 Household/AuthZ tables
- 013 Community tables

### Do not create yet

The sibling visual does **not** justify creating these before an explicit product/API gate:

- generic boards
- separate community user table
- new message database merely because the mock shows inquiry UX
- rating/review backend as P0
- SMS-specific identity table
- duplicated household/unit columns inside Community

## 4. Missing P0 API sequence before broad Community expansion

1. household master read
2. household invite claim/redeem
3. household summary / membership state
4. family invite create/redeem/revoke
5. consent current/write/withdraw
6. align protected business contacts/benefit actions to `requireVerifiedResident`
7. only then resident Community C3

## 5. Visual port acceptance

React port must preserve:

- dark cinematic mobile gateway grammar
- bright editorial desktop shell
- large real-life work imagery
- 5-view IA
- one-question-per-screen onboarding
- one dominant CTA per onboarding screen
- no persistent `미인증` warning as visual noise
- precise status copy that does not convert `household selected` into `verified resident`

## 6. Backup

Previous UI remains pinned at:

`backup/ui-before-sibling-final-20260826`

No source is deleted during the visual port.

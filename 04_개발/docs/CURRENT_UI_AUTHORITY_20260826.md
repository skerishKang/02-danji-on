# Danjion Current UI Authority — 2026-08-26

## Status

`CURRENT_VISUAL_AUTHORITY = SIBLING_GATE1_FINAL`

Product-owner explicit decision on 2026-08-26 supersedes the previous visual authority.

## Current visual source

Google Drive:

`00_CURRENT_UI_동생확정_Gate1_20260826`

Executable source:

`99_수정용_렌더원본/01_CURRENT_GATE1_RENDER.html`

Core visual grammar:

- dark cinematic mobile gateway / ROADHILL LIGHTS
- bright paper/editorial desktop shell
- large real-world work/life photography
- restrained card repetition
- one-question-per-screen onboarding
- one dominant bottom CTA
- bright editorial resident-life surface after entry

## Previous UI backup

Drive previous current:

`13_공식런칭_시네마틱모션통합_v1.3__BACKUP_PREVIOUS_CURRENT_20260826`

GitHub backup branch:

`backup/ui-before-sibling-final-20260826`

Pinned backup head:

`d264608e31b05b1c129aba0dc6e7fdeca2e0c91b`

The previous UI remains available as regression/history/function donor material but MUST NOT be treated as current visual source of truth.

## Functional authority remains newer than Gate1 demo logic

Visual adoption does not reactivate historical demo authentication or localStorage truth.

```text
Account Authentication
!= Household / Resident Verification
!= PADIEM Operator Authorization
```

Current functional rules:

- SMS OTP mandatory default: HOLD
- Kakao: primary candidate
- Google: secondary/fallback candidate
- common link/QR does not itself grant resident authority
- 192-unit master + household invite/code + family invite
- resident access is Household v2
- PADIEM operator authority is a separate grant

## Current IA

```text
홈 / 이웃가게 / 혜택 / 우리단지 / 내정보
```

## Product priority

```text
이웃의 일 발견
→ 저장·문의·혜택 이용
→ 내 일 알리기
→ 제한적 우리단지 소통
```

Community remains P2 and must not delay life-economy P0/P1.

## Implementation rule

All new frontend work must use the sibling Gate1 final visual as the visual authority while consuming the current Household/AuthZ/backend contracts.

Before C3/API expansion, perform a UI → function → API → DB inventory against this visual authority.

Do not port demo-only localStorage state, fake OTP, or `unit selected == verified resident` assumptions into production.

# HOLD BOUNDARY QUICK REFERENCE — 2026-09-08

## Never infer or implement without owner decision

### #263 — 23 이웃온기

Forbidden until owner decision:

- score formula
- event weights
- daily caps
- level thresholds
- penalty or abuse score adjustments
- resident ranking mechanics

Allowed:

- level-only neutral UI copy
- non-numeric explanation that the feature is under preparation
- links to future decision records

### #253/#139 — 03 주민혜택

Forbidden until owner decision:

- deriving `reserve`, `onsite`, or `coupon` mode from strings
- treating all benefits as coupons
- adding server enum/migration without policy approval
- defining received-benefit semantics without owner decision

Allowed:

- current mode-neutral benefits/list/claim/use/wallet contract
- tests that prevent accidental string inference

### #59 — privacy/resident verification/admin authority

Forbidden until legal/operational gate closes:

- whole resident registry import
- broad PII visibility for PADIEM/입대의/관리사무소
- final resident verification provider lock-in
- personal-data processing relationship assumptions

Allowed:

- account auth
- RBAC skeleton
- provider interface
- minimal audit structures

## Current application

PR #276 violated the #263 boundary by adding concrete warmth/onki scoring. It must remain Draft until fixed.
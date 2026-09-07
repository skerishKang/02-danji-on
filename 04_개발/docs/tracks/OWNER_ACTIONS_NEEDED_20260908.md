# OWNER ACTIONS NEEDED — 2026-09-08

Most current work can continue without owner input. Owner input is needed only for the following policy gates.

## 1. 23 이웃온기 formula

Current status: HOLD via #263.

Decision needed later:

- Whether DanjiOn should expose score values at all.
- Whether profiles show only a level label or also a numerical score.
- What events count toward warmth/onki.
- Whether daily caps, penalties, and abuse adjustments exist.
- Whether residents can lose levels.

Until decided: no implementation may define score values, thresholds, weights, or penalties.

## 2. 03 주민혜택 delivery-mode

Current status: HOLD via #253/#139.

Decision needed later:

- Whether benefit mode is server-authoritative.
- Whether modes are `reserve`, `onsite`, `coupon`, or a different set.
- Whether coupon issuance equals received benefit.
- Whether actual usage history is stored separately from claim/wallet state.

Until decided: frontend must not infer mode from strings.

## 3. Privacy / resident verification / admin authority

Current status: HOLD via #59.

Decision needed later:

- PADIEM / 입대의 / 관리사무소 data-controller/processor relationship.
- Resident verification provider and operating process.
- Admin access minimum scope and audit policy.
- Retention/deletion policy for account/resident/household data.

Until decided: do not import whole resident registry or grant broad personal-data visibility.

## No owner input needed now

- Keeping PR #276 as Draft until implementer fix.
- Merging docs-only rescue/status PR.
- Closing stale PR #273 after rescued report lands.
- Preserving PR #271 as read-only reference until artifact location is verified.
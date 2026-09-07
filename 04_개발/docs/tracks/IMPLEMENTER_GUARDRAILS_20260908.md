# IMPLEMENTER GUARDRAILS — 2026-09-08

## For any implementer touching DanjiOn frontend

Before changing a screen, identify whether it touches a HOLD topic.

### HOLD topics

- 온기 / 레벨 / 점수 / 공감 / 활동점수
- 주민혜택 / 쿠폰 / 예약 / 현장 / 받은 혜택
- 주민인증 / 세대코드 / 관리사무소 승인 / 개인정보 / 관리자 권한
- 카카오톡 인증번호 / OTP provider / AlimTalk delivery

If yes, do not infer product policy.

## Review checklist

- Is this a visual/routing fix only?
- Does it introduce a new business rule?
- Does it introduce a new number, threshold, cap, weight, or permission?
- Does it present a temporary prototype behavior as official product policy?
- Does it add copy that users would treat as a binding operating rule?

If any answer is yes, link an owner decision record before merging.
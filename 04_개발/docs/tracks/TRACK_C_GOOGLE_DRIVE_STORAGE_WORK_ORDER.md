# Track C — Google Drive Storage 작업지시서

GitHub Issue: #15
Branch: `feat/google-drive-storage`
Base: `feat/neon-live-foundation-20260808@64a204b567281447de681c52c7c58ac5a6e175f8`

## 임무

DanjiOn 초기 실서비스 파일 저장소를 R2 대신 Google Drive로 연결한다. 공개 비즈니스 이미지와 비공개 주민인증 증빙을 분리하고 기존 StorageAdapter 경계를 유지한다.

## 반드시 먼저 읽을 것

- `04_개발/frontend/src/storage.ts`
- `04_개발/docs/RESIDENT_VERIFICATION_v1.md`
- `04_개발/backend/docs/API_CONTRACT_v1.md`
- resident verification frontend/backend 관련 파일

## 고정 전제

- R2는 사용하지 않는다
- Google Drive 운영계정은 Padiem 회사 계정 기준
- 실제 주민 증빙은 public sharing 금지
- DB에는 file/object reference만 저장

## 권장 Drive 구조

```text
DanjiOn/
├─ public/
│  ├─ businesses/
│  └─ promo/
├─ private/
│  └─ resident-verification/
└─ backups/
```

## 구현 범위

1. `GoogleDriveStorageAdapter`
2. mock/drive mode 전환
3. upload/read/delete 최소 interface
4. public/private path + permission policy
5. file key/name policy
6. MIME/size/count validation
7. credentials/OAuth 운영방식 문서화
8. tests/test doubles

## 금지

- Neon Auth 구현: Track A 담당
- Cloudflare deployment: Track B 담당
- migration 001~008 변경
- R2 구현/활성화
- private evidence public URL 노출
- 실제 주민 개인정보 업로드
- PR merge

## 완료 Gate

- mock ↔ Drive adapter 교체 가능
- public/private storage policy 분리
- private evidence 직접 공개 불가
- upload validation 존재
- credentials commit 없음
- build/typecheck/E2E green
- 향후 R2 migration path documented

## 제출 형식

Draft PR을 유지하고 PR body에 다음을 기록한다.

- 실제 StorageAdapter 계약
- Google API 인증방식
- 수동으로 준비해야 할 Drive folder/OAuth 단계
- 테스트 결과
- 실제 Drive write 여부
- 남은 blocker

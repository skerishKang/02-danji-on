# DanjiOn Google Drive Storage v1

## 1. 결정

DanjiOn 초기 실서비스 파일 저장소는 Google Drive를 사용한다. 현재 실행 코드에 Cloudflare R2 adapter는 두지 않는다.

브라우저는 Google OAuth credential을 보유하지 않는다. 모든 Drive 읽기/쓰기/삭제는 backend storage route를 통과한다.

DB에는 파일 binary나 Google Drive 공유 URL이 아니라 `objectKey`만 저장한다.

## 2. StorageAdapter 계약

Frontend `StorageAdapter`:

```ts
upload(kind, file) -> StoredObject
read(objectKey) -> Blob | null
delete(objectKey) -> void
resolvePreview?(objectKey) -> URL | null
```

mode:

- `mock`: browser IndexedDB test double
- `drive`: backend Google Drive adapter

지원 kind:

| kind | app visibility | Drive folder | max | MIME | count |
| --- | --- | --- | ---: | --- | ---: |
| `business-image` | public | `DanjiOn/public/businesses` | 8MB | JPEG, PNG, WebP | 1/request |
| `resident-evidence` | private | `DanjiOn/private/resident-verification` | 10MB | JPEG, PNG, WebP, PDF | 1/request |

`public`은 **Drive ACL이 공개라는 뜻이 아니다.** Drive 파일은 비공개 상태를 유지하고, DanjiOn backend의 public media proxy만 익명 읽기를 허용한다.

## 3. object key와 파일명

DB/object reference:

```text
gdrive/public/business-image/<google-file-id>
gdrive/private/resident-evidence/<google-file-id>
```

Google file ID 외의 실제 Drive URL은 DB에 저장하지 않는다.

Drive 파일명:

- business image: `YYYY-MM-DD-<uuid>-<sanitized-original-name>`
- resident evidence: `YYYY-MM-DD-<uuid>.<mime-derived-extension>`

주민 증빙은 원본 파일명에 동/호수/성명 등이 포함될 수 있으므로 Drive 파일명과 object key에 원본 파일명을 넣지 않는다.

## 4. API

```text
POST   /api/v1/storage/objects
GET    /api/v1/storage/public?objectKey=...
GET    /api/v1/storage/private?objectKey=...
DELETE /api/v1/storage/objects?objectKey=...
```

Upload is `multipart/form-data`:

- `kind`
- `complexSlug`
- exactly one `file`

Upload/delete/private-read는 인증된 actor를 요구한다. 현재 auth 처리 방식은 기존 backend 경계를 그대로 사용하므로 Track A가 Neon Auth server adapter를 연결하기 전 production Bearer auth는 `AUTH_ADAPTER_PENDING`일 수 있다.

Private resident evidence read:

- uploader 본인, 또는
- 파일의 `danjionComplexSlug`에 대해 `verified` 상태인 `manager|admin`

만 허용한다.

Drive metadata `appProperties`에는 다음 scope metadata를 기록한다.

- `danjionKind`
- `danjionVisibility`
- `danjionUploaderUserId`
- `danjionComplexSlug`

서버는 object key의 file ID만 신뢰하지 않고 folder ID + appProperties를 다시 확인한다.

삭제는 즉시 영구삭제 대신 Drive `trashed=true`로 처리한다.

## 5. 공개/비공개 경계

### 사업자 이미지

Drive ACL은 private 유지.

```text
browser
  -> GET /api/v1/storage/public?objectKey=gdrive/public/business-image/...
  -> backend OAuth
  -> Drive media stream
```

이 endpoint는 `business-image` public key만 수락한다.

### 주민 인증 증빙

공개 URL, `webViewLink`, `webContentLink`, `permissions.create(type=anyone)`를 사용하지 않는다.

```text
authenticated browser/admin
  -> GET /api/v1/storage/private?objectKey=gdrive/private/resident-evidence/...
  -> actor + complex role authorization
  -> backend OAuth
  -> Drive media stream (Cache-Control: private, no-store)
```

## 6. Google OAuth 운영 방식

초기 운영계정은 Padiem 회사 Google 계정이다.

권장 scope는 최소권한인:

```text
https://www.googleapis.com/auth/drive.file
```

`drive.file`은 앱이 만들었거나 사용자가 앱에 명시적으로 공유한 파일/폴더에 대한 per-file access를 제공한다. 따라서 DanjiOn root/subfolder도 같은 OAuth client가 접근할 수 있는 상태로 준비해야 한다.

장기 운영에는 refresh token을 backend secret으로 저장한다. access token은 backend가 `https://oauth2.googleapis.com/token`에서 갱신한다.

주의: OAuth consent screen이 `Testing` 상태인 외부 앱은 refresh token이 7일 만료될 수 있다. 장기 운영 전에 OAuth publishing 상태와 Google 정책을 확인하고 운영 가능한 상태로 전환한다.

## 7. 사용자가 수동으로 준비할 것

1. Google Cloud project에서 **Google Drive API**를 활성화한다.
2. OAuth consent screen을 설정한다.
3. 최소권한 `drive.file` scope를 선언한다.
4. 서버용 OAuth client를 만든다.
5. 운영계정으로 offline access consent를 수행해 refresh token을 발급한다.
6. 같은 OAuth client가 접근 가능한 Drive에 아래 폴더를 준비한다.

```text
DanjiOn/
├─ public/
│  ├─ businesses/
│  └─ promo/                 # 예약 구조, 현재 adapter kind에는 미사용
├─ private/
│  └─ resident-verification/
└─ backups/                  # 예약 구조, 현재 adapter kind에는 미사용
```

7. 다음 두 folder ID를 확인한다.
   - `public/businesses`
   - `private/resident-verification`
8. backend secret/env를 설정한다.

```text
STORAGE_MODE=drive
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID=...
GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID=...
```

9. frontend에는 credential을 넣지 않고 `VITE_STORAGE_MODE=drive`만 설정한다.

실제 secret/token은 GitHub에 commit하지 않는다.

## 8. 실제 Drive write 상태

이 Track의 코드/계약 구현은 실제 production OAuth credential 없이 수행한다. 따라서 repository 작업 중 실제 Padiem Drive에 파일을 쓰지 않는다.

실제 write smoke test는 사용자가 위 OAuth/folder setup을 완료한 뒤 **테스트용 비개인정보 파일 1개**로 수행한다. 실제 주민 개인정보 파일은 smoke test에 사용하지 않는다.

## 9. 테스트

`npm run check`에 다음을 포함한다.

- TypeScript typecheck
- storage policy executable test
  - MIME allow/deny
  - 8MB / 10MB size boundary
  - exactly-one-file count
  - filename sanitization
- backend contract test
  - storage route ordering
  - Drive OAuth refresh flow 존재
  - public/private route 분리
  - resident evidence private authorization
  - public ACL 생성 코드 없음
  - frontend `mock|drive` mode 계약

## 10. 향후 다른 object storage로 이전할 때

현재 DB는 provider URL이 아니라 `objectKey`를 저장하므로 provider 교체 시 UI/domain schema를 바꾸지 않는 것을 목표로 한다.

이전 절차:

1. 새 provider adapter를 `StorageAdapter`와 backend object API 뒤에 구현한다.
2. Drive object를 batch copy하고 old key -> new key mapping을 만든다.
3. DB object key를 transaction/batch로 교체한다.
4. public/private authorization regression test를 통과한다.
5. dual-read 또는 검증 기간을 거친 뒤 Drive 원본을 보관정책에 따라 trash/archive한다.

Cloudflare R2를 향후 후보로 선택할 수 있지만 **현재 Track에서는 R2 adapter, binding, bucket, deploy 설정을 구현하거나 활성화하지 않는다.**

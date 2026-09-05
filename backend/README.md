# Danjion Backend Starter

단지온 백엔드팀 1기 독립개발용 첫 로컬 프로젝트입니다.

## 현재 기능

- `GET /` → `Danjion API Dev`
- `GET /api/hello` → API 상태 확인
- `GET /api/test-users` → Neon의 `test_users` 조회

## 중요

- 실제 Neon `DATABASE_URL`은 절대로 이 폴더의 코드 파일이나 GitHub에 적지 않습니다.
- Cloudflare Worker에는 이미 `DATABASE_URL` Secret을 설정한 상태를 전제로 합니다.
- 로컬에서 DB까지 테스트할 경우 `.dev.vars.example`을 `.dev.vars`로 복사한 뒤 실제 값을 넣되, `.dev.vars`는 Git에 커밋하지 않습니다.

## 처음 실행

PowerShell에서 이 폴더로 이동한 뒤:

```powershell
node -v
npm -v
npm install
npx wrangler login
npm run deploy
```

배포 후:

- `/api/hello`
- `/api/test-users`

를 확인합니다.

## 다음 리팩터링 연습

현재는 학습을 위해 `src/index.js` 한 파일에 라우팅과 DB 조회가 같이 있습니다.
DB 연결 성공 후 다음과 같이 역할별로 분리할 예정입니다.

```text
src/
├─ index.js
├─ routes/
│  ├─ hello.js
│  └─ test-users.js
└─ db/
   └─ client.js
```

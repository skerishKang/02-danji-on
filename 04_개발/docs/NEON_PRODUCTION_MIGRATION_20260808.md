# DanjiOn Neon production migration — 2026-08-08

## Scope

Padiem / Danjion Neon production database에 application schema migration `001`~`008`을 적용한 기록이다.

- Project: `Danjion`
- Region: AWS Asia Pacific 1 (Singapore)
- PostgreSQL: 18
- Production branch: `production`
- Neon Auth: enabled before application schema migration
- Dev seed (`900+`): not applied

## Safety sequence

1. Production이 Neon Auth schema만 포함하고 DanjiOn public application tables는 없는 상태임을 확인.
2. 검증용 child branch `migration-check-20260808`에서 `001`~`008`을 순차 실행.
3. 실 DB 상태전이 검증:
   - business application review audit
   - resident verification manager rejection / applicant resubmission audit
   - benefit wallet stored → used
4. 검증 과정에서 resident verification schema/runtime drift를 수정.
5. GitHub CI:
   - Backend CI PASS
   - Resident Verification CI PASS
   - Pre-Infra Integration CI PASS
6. Production 적용 직전 snapshot branch `pre-danjion-schema-20260808` 생성.
7. Production에 `001`~`008` 적용.
8. Validation branch와 production schema diff가 empty임을 확인.
9. Production application tables에 dev/test seed row가 0건임을 확인.
10. 검증용 branch 삭제. Pre-migration snapshot은 임시 보존.

## Production result

Production에는 다음 application domain이 생성되어 있다.

- complexes / memberships / resident verification
- businesses / relations / media / contacts
- benefits / benefit claims
- bookmarks
- complex posts
- business applications
- application review history
- resident verification review history
- idempotency and domain constraints

Neon Auth schema는 기존 provision 상태를 유지한다.

## Not done yet

- `900_dev_seed.sql` / `901_dev_contacts.sql` / `902_dev_unverified_resident.sql` 미적용
- 실제 운영 사용자/단지 데이터 미삽입
- Cloudflare Worker 배포 미실행
- production `DATABASE_URL` secret 연결 미실행
- Neon Auth server adapter 실제 연결 미실행
- Google Drive storage adapter 실계정 연결 미실행

## Rollback reference

Migration 직전 snapshot:

- Branch: `pre-danjion-schema-20260808`

이 branch는 다음 운영 연결 단계가 안정화될 때까지 보존한다.

# DevOps & Deployment Rules — 브랜치·CI·DB 패치·배포·롤백 규칙

> 대상: 이 저장소의 코드를 어떤 환경에든 내보내는 모든 작업 (사람·에이전트 공통).
> 각 규칙에는 그 규칙을 만든 사고(incident)나 실측 날짜가 붙어 있다. 사고가 없는 규칙은 선호이지 규칙이 아니므로 여기 두지 않는다.
> 저장소 밖(GitHub 브랜치 보호, Vercel 프로젝트 설정, Railway/Lightsail 환경 변수)에서만 확인 가능한 사실은 **[외부]**로 표시했다. 그 값은 코드만 봐서는 알 수 없으니 바꾸기 전에 반드시 실측한다.

**기준 문서 (canonical reference):**

| 주제 | 파일 |
|---|---|
| 릴리스 흐름 개요 | `README.md` → "Deployment and release flow" |
| 백엔드 CI·이미지 빌드·배포 잡 (Lightsail 잡은 미사용) | `.github/workflows/backend-ci.yml` |
| Lightsail 운영 계약 (OIDC, SSM, 롤백) — **미사용(2026-10-19), 역사** | `backend/deploy/lightsail/CI_AUTOMATION.md`, `backend/deploy/lightsail/README.md` |
| 수동 Lightsail 운영 — **미사용** | `.github/workflows/lightsail-operations.yml`, `backend/deploy/lightsail/lightsail-cli.sh` |
| DB 패치 | `.github/workflows/database-patches.yml`, `backend/prisma/migrations/`, `backend/prisma/scripts/` |
| 테넌트 격리 롤아웃 | `backend/README.md` → "TENANT_ISOLATION_MODE" |
| 런치 체크리스트 예시 | `docs/plans/2026-09-01-call-inbox-launch-checklist.md` |
| env 매니페스트 | `backend/env.tpl`, `frontend/env.local.tpl`, `~/.agents/bin/env-check` |

---

## 0. 한 줄 요약

**dev 병합이 곧 릴리스일 수 있다고 가정하고, 스키마는 코드보다 먼저, 플래그는 코드보다 나중에 내보낸다.**

---

## 1. 브랜치와 환경

| 브랜치 | 역할 | 프론트(Vercel) | 백엔드 | DB 패치 잡 |
|---|---|---|---|---|
| `dev` | 통합 대상. 모든 feature/fix PR의 목적지 | 빌드 안 함 (2026-08-06부터, [외부] Ignored Build Step) | 배포 없음. 로컬 `localhost:3001`로 테스트 | `apply-dev` (prisma 경로 push 시) |
| `preview` | 릴리스 후보 검증 | preview 빌드 | Google Cloud Run `babyjamjam-api-preview` (`*.run.app`, asia-northeast3, min 0 / max 1), push 시 `deploy-cloudrun` 잡이 자동(`apply-production` 뒤, BJJ-341부터). runbook: `docs/plans/2026-09-23-preview-cloud-run.md` | `apply-production` (운영 DB, BJJ-484) |
| `main` | 프로덕션 | production 빌드 (`admin.babyjamjam.com`, `m.admin.babyjamjam.com`) | **LightNode VPS Fallback Server** (`api.babyjamjam.com` DNS가 가리키는 대상), push 시 자동(같은 커밋의 `apply-production` 패치 성공 뒤). AWS Lightsail은 더 이상 쓰지 않는다(2026-10-19 사용자 확인) | `apply-production` |

규칙:

1. **`main`에 직접 커밋 금지.** 승격은 `dev → preview → main` PR로만. (`README.md`)
2. **preview/main 룰셋은 linear history + Vercel deploy 체크 필수** [외부]. squash 승격은 다음 승격에서 대량 add/add 충돌을 만든다 (2026-07 실측, 79건). 승격 PR은 merge commit으로.
3. **dev 호스팅은 없다.** dev Railway는 2026-07-16 삭제, dev Vercel 빌드는 2026-08-06 제거. `*-dev.up.railway.app`, `dev.m.admin.*` 같은 URL을 전제로 한 설정·안내는 전부 오류다.
4. **preview 백엔드는 프로덕션과 같은 Supabase DB를 본다** (2026-07-17 Railway env 실측: NODE_ENV 외 53개 값 동일). preview 승격 = prod 데이터에 적용이라고 전제한다. 진짜 격리가 필요하면 preview 전용 DB 분리가 선행 과제다.
5. **업데이트(2026-10-19 사용자 확인): AWS Lightsail은 더 이상 쓰지 않는다.** main 배포 대상은 `resolve-backend-deploy-target`(`backend/deploy/fallback-server/ci/resolve-deploy-target.mjs`)이 `api.babyjamjam.com` DNS로 고르며, 현재는 LightNode(`deploy-lightnode`)다. 아래는 2026-09-02 당시 기록이다. **(당시) 프로덕션 백엔드 = AWS Lightsail.** Railway는 더 이상 프로덕션 런타임이 아니다. 백업은 **LightNode VPS의 Fallback Server**(`backend/deploy/fallback-server/`): API-only warm standby로, 프로덕션 DB만 바라보며 스케줄러·자동완료·eformsign 잡·Aligo가 Compose에서 하드 비활성화돼 있다. 트래픽 전환은 Sentry Uptime 알림 → 컨트롤러 → Vercel DNS `api`/`A` 레코드 한 건의 **AWS → Fallback 일방향** 변경이며, 자동 failback은 없다. 상태와 절차는 `backend/deploy/fallback-server/README.md`, `CONTROLLER_OPERATIONS.md`, `LIGHTNODE_TEMPORARY_FALLBACK.md`, `VERCEL_DNS_FAILOVER.md`가 기준이다. **어떤 시점에도 `SCHEDULERS_ENABLED=true`인 런타임은 하나여야 한다** (중복 발송 위험, §5 참고).

---

## 2. PR 게이트 (CI)

PR을 `dev`에 열면 아래 워크플로가 돌고, 필수 체크는 GitHub 브랜치 보호에 있다 [외부].

| 워크플로 | 잡 | 무엇을 막나 |
|---|---|---|
| `backend-ci.yml` | `verify` | type-check, lint, **migrations drift guard** (`prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`), 단위 테스트, 배포 자동화 계약 테스트 (`backend/deploy/**/*.test.sh`) |
| `backend-ci.yml` | `auth-e2e` (matrix `tenant_isolation_mode: observe, enforce`) | 인증 e2e. `enforce` leg는 테넌트 격리 위반을 실패로 만든다 |
| `backend-full-flow-ci.yml` | `full-flow`, `call-inbox` | 전체 흐름 e2e, 워크플로 계약 |
| `frontend-ci.yml` / `mobile-ci.yml` | `verify` | type-check, lint, `lint:ui-architecture` **baseline 게이트**, e2e 문자열 drift, build |
| `shared-contracts-ci.yml` | `shared-contracts` | `@babyjamjam/shared` type-check·테스트 |
| `security.yml` | `osv` | lockfile 취약점 (fail-on-vuln) |
| `playwright.yml` | `test` | 수동/PR: 실제 백엔드 대상 인증 라이프사이클 e2e |

규칙:

1. **로컬 최소 검증은 README의 목록 그대로.** `pnpm lint`, `pnpm lint:ui-architecture`, 앱별 `type-check`, `pnpm test`, `pnpm build`. CI가 잡아줄 것을 기다리지 않는다.
2. **`lint:ui-architecture` baseline은 늘어날 수 없다.** 새 위반은 실패. 파일을 정리했으면 `docs/design-system/ui-debt-baseline.json`에서 제거한다.
3. **preview push의 `deploy Lightsail backend` 잡이 빨간 것은 코드 문제가 아닐 수 있다.** 2026-08-30부터 AWS OIDC trust policy 오류(`Not authorized to perform sts:AssumeRoleWithWebIdentity`, PreviewDeployRole)로 실패 중. `gh run list --workflow=backend-ci.yml --branch=preview`로 `pull_request` 런과 `push` 런을 나눠 보고, `pull_request`가 green이면 PR은 정상이다. 수리는 IAM 쪽 별도 작업. **업데이트(BJJ-341, 2026-09-23): preview는 더 이상 Lightsail에 배포하지 않는다(Cloud Run `deploy-cloudrun`으로 전환).** GCP 부트스트랩(`docs/plans/2026-09-23-preview-cloud-run.md` §3)이 끝난 뒤부터 이 OIDC 실패는 preview에 적용되지 않는다 — Lightsail은 2026-10-19부로 미사용이라 main에도 해당 없다.
4. **CI 상태 조회에 `gh run list --commit <sha>`를 쓰지 않는다.** 실행이 있어도 빈 결과를 돌려준다 (2026-08-06 오보 사고). 다음을 쓴다:
   ```
   gh run list --branch <branch> --limit 6 --json headSha,name,status,conclusion \
     --jq '.[] | select(.headSha|startswith("<sha>")) | "\(.status)/\(.conclusion // "-") \(.name)"'
   ```
   잡이 `runner_name: ""`·`steps: 0`이면 러너 미배정(플랫폼 장애)이지 테스트 실패가 아니다.
5. **테넌트 격리 `enforce` leg가 red인 PR은 병합하지 않는다.** BJJ-301(2026-09-01)에서 에이전트 런타임이 enforce에서 깨지는 것을 이 leg가 잡았다.

---

## 3. 데이터베이스 변경

### 3.1 원칙

- **`prisma migrate deploy`는 어떤 원격 DB에도 돌리지 않는다.** 원격 `_prisma_migrations` 히스토리가 로컬 `prisma/migrations`(0_init 재베이스라인)와 diverged라 이미 적용된 변경을 재실행하려 든다 (2026-07-08 확인). CI의 `db:migrate:deploy`는 **일회용 CI DB**에만 쓴다.
- 원격 적용 경로는 두 가지뿐: (a) `database-patches.yml`의 하드코딩 스텝, (b) 수동 `psql`/`prisma db execute --url` + `prisma migrate resolve --applied`.
- 마이그레이션 SQL은 **재실행 안전(idempotent)** 해야 한다. 워크플로가 push마다 전 스텝을 다시 돌린다. `IF NOT EXISTS`, `DO $$ … pg_constraint 조회 … $$` 가드 필수. `RENAME CONSTRAINT`에는 `IF EXISTS`가 없으니 DO 블록으로 감싼다.
- 테이블 RENAME 시 PK·모든 FK·unique index 제약 이름까지 `<newtable>_<col>_fkey` 형태로 같이 RENAME해야 drift guard를 통과한다 (2026-07-16).

### 3.2 새 마이그레이션 PR 체크리스트

1. `backend/prisma/migrations/<ts>_<name>/migration.sql` 추가 + 검증 SQL(`prisma/scripts/verify-*.sql`)이 있으면 함께.
2. **`database-patches.yml`의 세 잡(`apply-dev`, `apply-preview`, `apply-production`) 전부에 스텝 배선.** preview 잡만 `./scripts/run-prisma-db-execute.sh` 래퍼를 쓴다.
   — 사고: PR #503(2026-08-08)이 migrations만 추가하고 배선을 빠뜨린 채 dev에 병합됨. 그대로 승격됐으면 새 Prisma 스키마가 없는 컬럼을 읽어 런타임 파손.
   — 검사: `git log`상 신규 migrations 디렉터리 ↔ `grep migrations/ .github/workflows/database-patches.yml` 대조. 승격 PR을 열기 전 필수.
3. 로컬에서 drift guard 재현: 빈 shadow DB(localhost:5432 `postgres`)에 `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`.
4. 브랜치 스코프 모델을 건드렸으면 `pnpm run tenant:models:generate` 후 생성 파일 커밋 (`tenant-models.drift.spec.ts`가 실패한다).
5. 롤백 SQL을 `backend/prisma/scripts/`에 둔다 (예: `rollback-message-rename.sql`).

#### 3.2.1 BJJ-439 계약 무효화(void) 롤백 규칙 — 롤포워드만

`eformsign_doc.voided_at`/`voided_by`(마이그레이션 `20261014000000_add_eformsign_doc_voided`)를 읽지 않는 이전 릴리스는 컬럼이 남아 있어도 무효화된 계약(서명 완료 포함)을 다시 활성/완료로 취급한다(영수증 링크 재개, 서명 완료 계약 자동 finalize). 따라서:

- **첫 계약이 무효화된 뒤에는 앱을 BJJ-439 이전 릴리스로 롤백하지 않는다.** 문제는 롤포워드(수정 릴리스)로 푼다.
- BJJ-439을 가로지르는 앱 롤백 전에 반드시 `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f backend/prisma/scripts/preflight-app-rollback-voided.sql`을 실행한다. 무효화된 행이 하나라도 있으면 실패한다(컬럼이 없으면 notice와 함께 통과).
- LightNode Fallback의 수동 롤백(`babyjamjam-fallback-server rollback`, `backend/deploy/fallback-server/operator.sh` `rollback_release`)도 같다. 이 명령은 `previous-image-tag`로 한 단계 되돌리므로, BJJ-439이 들어간 첫 main 배포 직후에는 BJJ-439 이전 릴리스로 돌아간다 — 실행 전에 위 preflight를 먼저 돌린다. 배포 실패 시의 자동 복구(`deploy_release`/`replace_temporary_active_release`)는 직전 실행 중이던 릴리스로만 돌아가므로, BJJ-439을 가로지르는 경우는 첫 배포가 실패할 때뿐이다.
- `rollback-eformsign-doc-voided.sql`은 무효화가 한 번도 없던 DB 전용이며, 무효화된 행이 있으면 DROP을 거부한다.
- preflight는 **실행 시점의 확인일 뿐**이다. 실행 전에 같은 DB를 쓰는 계약 무효화 가능 백엔드(preview Cloud Run과 프로덕션 모두 — DB 공유)를 모두 중지하거나 드레인하고, BJJ-439 이전 런타임이 서빙되는 동안에는 무효화를 사용할 수 없게 유지한다. 그렇지 않으면 preflight와 앱 다운그레이드 사이에 새 무효화가 생길 수 있다.
- `rollback-eformsign-doc-voided.sql`은 카운트 전에 `eformsign_doc`에 ACCESS EXCLUSIVE 락을 잡아 카운트와 DROP 사이에 void가 커밋되지 못하게 한다. 대신 진행 중인 쓰기 뒤에서 대기하므로, 실행 전에 `SET lock_timeout = '5s'` 같은 값을 세션에 설정해 라이브 트래픽 뒤에서 큐잉되는 대신 실패하게 할 수 있다.
- preview 백엔드는 프로덕션과 같은 DB를 쓴다(§10 5번, `docs/plans/2026-09-23-preview-cloud-run.md:239`). preview에서 무효화한 계약은 main이 이 릴리스를 배포하기 전까지 프로덕션 앱에서 활성으로 보인다. main이 이 릴리스를 돌리기 전에는 preview에서 계약을 무효화하지 말고, 하게 되면 main 승격을 지체하지 않는다.
- 두 SQL은 수동 운영자 도구다. `database-patches.yml`에 배선하지 않는다(void 이후 매 패치 런이 실패한다).

### 3.3 적용 순서 — 스키마가 코드보다 먼저

- **마이그레이션이 있는 변경은 dev 병합 전에 preview/production DB를 먼저 패치한다.**
  ```
  gh workflow run database-patches.yml --ref dev -f target=production
  gh workflow run database-patches.yml --ref dev -f target=preview
  ```
  `--ref dev`가 핵심이다. preview/main의 워크플로 사본에는 새 스텝이 없다. `apply-production`은 `if: always()`라 skip된 preview 잡에 막히지 않는다. `-f target=preview`는 이제 어떤 백엔드도 쓰지 않는 preview 전용 DB(`PREVIEW_DATABASE_URL`)만 패치한다.
- push 트리거(`paths: backend/prisma/**`)는 브랜치 이름이 아니라 **백엔드가 실제로 쓰는 DB**를 패치한다 (BJJ-484):
  - preview push와 main push는 둘 다 **운영 DB**를 패치한다 (`apply-production`). preview 백엔드(Cloud Run)와 main 백엔드가 같은 운영 DB를 쓰기 때문이다.
  - dev push는 dev DB를 패치한다 (`apply-dev`).
  - preview 전용 DB(`PREVIEW_DATABASE_URL`)는 수동 `-f target=preview` dispatch로만 패치한다 (`apply-preview`는 push에서 실행되지 않는다).
  - 백엔드 배포 게이트(`wait for database patches`)는 같은 커밋의 `Database Patches` 런이 성공했을 뿐 아니라 그 안의 `apply production database patches` 잡이 `success`였는지까지 확인한다. 잡이 skipped이거나 없으면 게이트가 실패한다(런 단위 결론만 보면 skip된 잡도 `success`로 보인다).
  - Cloud Run 배포 잡은 마지막에 `/health/schema`로 Prisma 컬럼이 DB에 모두 있는지 확인한다. 이 확인은 트래픽이 새 리비전으로 넘어간 **뒤에** 실행되므로 드리프트를 배포 후에 감지할 뿐 막지는 못한다.
  - preview push, main push, `target=production` dispatch는 같은 concurrency 그룹(`database-patches-production`)을 쓴다. GitHub은 그룹당 실행 1개 + 대기 1개만 유지하므로 더 새로운 런이 대기에 들어오면 이전 대기 런이 취소된다. 게이트는 취소된 런을 실패로 처리하므로(fail closed) "취소된 push 런을 재실행한 뒤 Backend CI 실패 잡을 재실행한다".
- 사고: PR #830(2026-10-18) preview 승격 후 preview 마이그레이션 6개가 운영 DB에 없어 preview 고객 화면 500 (BJJ-484). 수동 `-f target=production` dispatch(run 39125064314)로 복구. 원인은 preview push가 `apply-preview`(다른 DB)만 실행하고 `apply-production`을 skip했는데도 런이 `success`로 끝나 게이트를 통과한 것이다.
- 사고: `eformsign_doc` 컬럼(PR #407, 2026-07-28). 앱은 배포됐는데 프로덕션 DB에 컬럼이 없던 하루 동안 호환 SELECT가 `templateId`를 null로 채워 **10분 중복 발송 가드가 조용히 무력화**됐다. 2026-07-29 11:52 수동 dispatch로 복구.
- 같은 유형: PR #616(2026-09-03). `backend-ci`가 `database-patches.yml`의 production 승인 대기와 무관하게 ~20분 만에 배포를 끝냈고, 새 코드가 아직 없던 `employee_schedule.terminated_at`/`scheduler_lease`를 조회해 데스크톱 목록이 500으로 빈 상태가 됐다.
- 승격 후 확인: `git show origin/main:.github/workflows/database-patches.yml | grep -c '<패치 이름>'`.
- **이 사고 이후 `backend-ci`는 `preview`/`main` push에서 같은 커밋의 `Database Patches` 런이 성공할 때까지 기다린다** (잡 `wait for database patches`, `backend/deploy/ci/wait-database-patches.sh`). `resolve-backend-deploy-target`(따라서 그 뒤의 배포 잡도 — preview는 BJJ-341부터 `deploy-cloudrun`, main은 DNS가 가리키는 대상 — 현재 `deploy-lightnode`, Lightsail은 미사용)이 이 잡 뒤에 걸린다. 2026-09-03 오너 결정으로 GitHub `Production` environment의 필수 리뷰어를 제거해 **production 패치도 preview와 같이 main push에서 자동 적용**된다. 따라서 정상 경로는 push → 패치 자동 적용 → (수 분 뒤) 배포 자동 이어짐이고, 패치가 실패하면 배포는 실행되지 않는다. 이 대기 잡은 `backend-deploy-wait-<ref>` concurrency 그룹(`cancel-in-progress: true`)으로 묶여 있어, 같은 브랜치에 더 새로운 커밋이 push되면 이전 커밋의 대기 잡이 취소되고(따라서 그 커밋의 배포도 실행되지 않고) 최신 커밋만 배포로 이어진다 — 오래된 커밋이 나중에 도착해 최신 커밋의 배포를 덮어쓰는 경합을 막는다. 패치 런 출현 대기는 최대 10분, 완료 대기는 최대 120분이며 초과 시 스크립트가 `::error::`로 실패한다(잡 자체의 `timeout-minutes: 150`은 상한일 뿐, 정상적으로 도달하는 종료 경로가 아니다). 실패 시 Database Patches 런을 고치거나 승인한 뒤 **먼저 Database Patches push 런의 실패한 잡을 재실행**하고, **그다음 Backend CI의 실패한 잡을 재실행**한다 — `workflow_dispatch`로 별도 실행한 복구 런은 게이트를 통과시키지 못한다(스크립트는 이 커밋의 push 트리거 런만 본다). 이 자동화의 전제는 §3.1의 멱등 SQL 원칙과 dev → preview → main 승격 열차에서 같은 패치가 먼저 두 번 실행된다는 점이다. `backend/prisma/**` 변경이 없는 push는 지연 없이 통과한다(패치 런이 없어도 됨을 diff로 판별).

### 3.4 프로덕션 수동 적용 함정 (2026-07-16 실측)

1. `DATABASE_URL="<prod>" pnpm exec prisma db execute --file …`는 **`backend/.env`의 DATABASE_URL(dev)에 덮여 dev에 적용된다.** 성공 메시지가 떠도 prod 미적용. 반드시 `--url "<prod>"` 또는 psql로 명시.
2. prod pooler(6543, transaction mode)로 DDL을 실행하면 hang/timeout. DDL은 **DIRECT_URL(5432, session mode)**로:
   ```
   { printf "SET lock_timeout='20s';\n"; cat migration.sql; } | psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q
   ```
3. prod 조회 검증은 PrismaClient에 URL 명시 + 4~6회 retry (pooler 간헐 끊김).
4. prod DB URL은 `backend/.env.orig-prod-shared`에 있다. 로컬 `backend/.env`는 2026-07-28부터 dev Supabase(`ebiughoiebblasxwgxbe`)를 가리킨다. 프로젝트 id를 눈으로 확인하고 실행한다.
5. dev/production db-patches 잡은 GitHub 시크릿 부재로 "Check database secrets"에서 실패할 수 있다 [외부]. 그 경우 수동 적용만 가능하며, 적용 후 `prisma migrate resolve --applied <name>`으로 기록한다.

---

## 4. 백엔드 배포 (이미지 빌드 · Lightsail은 미사용)

> **2026-10-19: Lightsail은 더 이상 쓰지 않는다.** 이미지 빌드(`build-lightsail-image` 잡, `backend/Dockerfile.lightsail` — 이름만 남음)는 Cloud Run preview와 LightNode main 배포가 계속 쓴다. 아래 표의 OIDC·SSM·`lightsail-operations.yml` 규칙은 역사다. main 운영·롤백은 §4.1 LightNode를 따른다.

`preview`/`main` push → `backend-ci.yml`이 `backend/Dockerfile.lightsail`로 **불변 커밋 이미지**(`ghcr.io/jaino-song/babyjamjam-admin-backend:<sha>`)를 빌드 → OIDC로 브랜치 스코프 역할을 얻어 **고정 SSM 문서**로 호스트에 그 이미지를 활성화. 호스트는 이미지를 빌드하지 않는다.
**preview는 BJJ-341(2026-09-23)부터 이 경로를 벗어난다:** 같은 GHCR 이미지를 `deploy-cloudrun` 잡이 Artifact Registry로 복사해 Cloud Run `babyjamjam-api-preview`에 배포하며, preview env는 호스트 `backend.env`가 아니라 **Secret Manager + 매니페스트**(`backend/deploy/cloudrun/service.preview.yaml`)에 산다. runbook: `docs/plans/2026-09-23-preview-cloud-run.md`. 아래 표의 Lightsail 규칙은 main에 적용된다.

| 항목 | 규칙 |
|---|---|
| 승인 | 수동 승인 없음(2026-09-03). `main`/`preview` 모두 CI 통과 후 자동이며, 같은 커밋의 `Database Patches` 런이 성공한 뒤에만 배포 잡이 실행된다(§3.3). 과거 문서의 `approve-lightsail-production` 잡은 존재하지 않는다 |
| 자격 | OIDC trust policy가 preview↔`refs/heads/preview`, production↔`refs/heads/main`으로 고정. feature 브랜치는 환경을 참조해도 권한이 없다 |
| 검증 | 배포 잡은 SSM 결과의 `environment`/`current_tag`/`current_digest`가 요청과 정확히 일치해야 성공 처리 |
| 수동 운영 | `lightsail-operations.yml` (`status` / `deploy` / `operator-upgrade`, environment 선택) 또는 `backend/deploy/lightsail/lightsail-cli.sh` (gh CLI 인증 사용, 로컬 AWS 자격 불필요) |
| 롤백 | 호스트의 설치된 CI operator가 `previous-image-tag`로 되돌린다. 저장소의 `rollback.sh`는 **retired** — 직접 실행하면 거부한다. 롤백도 `lightsail-operations.yml`을 통해서만 |
| 헬스 | `GET /health`(liveness, 항상 200), `GET /health/ready`(DB `SELECT 1` + revocation 플래그, 실패 시 503). 배포 후 두 엔드포인트를 확인한다 |
| preview 스케줄러 | preview는 BJJ-341부터 Cloud Run 매니페스트(`backend/deploy/cloudrun/service.preview.yaml`)에 스케줄러 플래그가 하드코딩된다 — `SCHEDULERS_ENABLED=false`(백엔드 기본값은 true, 매니페스트에서 누락 금지) 외 lease·reconcile 값은 runbook §1 참고. 과거 Lightsail preview에 적용되던 `backend.env` fail-closed 규칙(`SCHEDULERS_ENABLED=false`, `SERVICE_RECORD_AUTO_FINALIZE_ENABLED=false`)은 Lightsail deploy/rollback 스크립트에 그대로 남아 있다 |
| 시크릿 | 호스트 `/opt/babyjamjam/environments/<env>/backend.env`는 root 0600. 커밋 금지, 터미널에 전문 출력 금지 |

### 4.1 Fallback Server (LightNode VPS)

| 항목 | 규칙 |
|---|---|
| 역할 | API-only warm standby. 프론트 배포 아님. 호스트명 `api.babyjamjam.com`은 그대로 두고 DNS 소유권만 바뀐다 |
| 바인딩 | Fallback API `127.0.0.1:3101`, 컨트롤러 `127.0.0.1:3102` (`POST /sentry/uptime-alert`, `GET /health`만) |
| DB | 프로덕션 DB만. 활성화 전 **Production DB identity hash 게이트**(`approved-production-db-ref.sha256`) 통과 필수 |
| 비활성 기능 | 스케줄러, 자동완료, eformsign 문서 잡 intake/worker, unlocked reconcile, Aligo — Compose에서 하드 비활성화. 켜지 않는다 |
| 전환 | Sentry Uptime → Internal Integration webhook → 컨트롤러가 `VERIFYING` → `DNS_COMMITTING` 단계로 Vercel DNS `api`/`A` 레코드 1건을 AWS → Fallback 일방향 PATCH. 모호한 응답은 수동 reconcile |
| 복귀 | **자동 failback 없음.** AWS 복구 후 DNS 되돌리기는 수동 절차 (`VERCEL_DNS_FAILOVER.md`) |
| 사전 점검 | `lightnode-preflight.sh`, `NETWORK_PREFLIGHT.md`. 컨트롤러 arm/disarm은 `CONTROLLER_OPERATIONS.md` |
| 현재 상태 | **2026-09-03부터 프로덕션 DNS가 Fallback을 가리켜 프로덕션 트래픽을 서빙한다**(`public_routing=fallback`, `runtime_mode=temporary-active`, 스케줄러·문서 잡도 Fallback에서 활성). Lightsail은 2026-10-19 미사용 확인. 컨트롤러 설치·arm 여부는 README 기준. 바뀌면 README와 이 표를 같이 갱신 |

Railway 관련 (역사·잔존 — 프로덕션 런타임 아님):

- Railway 배포 브랜치는 `DeploymentTrigger` GraphQL로만 바꿀 수 있다 (CLI·MCP에 필드 없음). 2026-07-29까지 **네 환경 모두 `dev`에서 배포**되던 것을 main/preview/dev로 교정했다. 변경은 다음 push부터 적용된다.
- Railpack 빌더는 빌드/런타임 이미지가 분리된다. 런타임 apt 패키지(Chromium 라이브러리 등)는 `RAILPACK_DEPLOY_APT_PACKAGES` 변수로, 변수 변경만으로는 리빌드되지 않으니 빈 커밋으로 트리거.
- `backend/railway.json`은 아직 커밋돼 있고 README 본문도 "Railway for the API"라고 적혀 있다. 둘 다 stale이다 — 정리 시 이 문서 §1-5와 같은 커밋에서 갱신한다. Lightsail `backend.env` 값의 출처가 Railway 환경 변수였다는 점만 역사로 남긴다.

### 4.2 Valkey 복구 — 펜스 절차만 허용 (2026-10-30)

백엔드는 실시간 변경 힌트를 Valkey Stream으로 공유하고, 클라이언트는 커서로 이어받는다. 연속성은 **실행 중인 Valkey 프로세스의 신원**(`run_id`, `master_replid`)으로 증명하는데, 이 값은 Valkey가 재시작·승격될 때마다 바뀐다. 프로세스를 그대로 둔 채 데이터만 되돌리면(아래 금지 목록) 신원이 같아서 클라이언트가 "놓친 게 없다"고 믿고 갱신을 조용히 놓친다. 그래서 Valkey 데이터 복구는 아래 절차로만 한다.

| 항목 | 규칙 |
|---|---|
| 유일한 경로 | `babyjamjam-fallback-server valkey-restore <백업 절대경로> --confirm-fence` (백업은 RDB 파일 또는 `appendonly.aof.manifest`가 있는 `appendonlydir`). 확인은 플래그뿐이다 — operator는 root로 비대화식 실행되므로 프롬프트가 없고, 플래그가 없으면 컨테이너를 건드리기 전에 거부한다 |
| 단계 | ① 사전점검: 백업을 네트워크 없는 임시 컨테이너에 로드해 지문(DBSIZE, `realtime:entity-changes`의 `last-generated-id`, 영구 키 이름·타입 표본 해시) 기록 + 현재 `run_id` 기록 → ② 펜스: 마커 `state/valkey-restore-fence` 기록 후 API 컨테이너 정지·확인(백엔드의 Prisma extension이 힌트의 유일한 작성자이므로 백엔드 정지가 곧 작성자 펜스) → ③ Valkey를 **먼저** 정지하고 교체 전 데이터를 시각 표기 사본으로 보존한 뒤 복구, 새 프로세스로 기동 → ④ 검증: PING, master, 복구된 데이터 = 백업 지문, `run_id` 변경(둘째 조건) → ⑤ **별도 명령** `valkey-restore --reopen --confirm-reopen`으로 API 재기동·헬스 확인 |
| 중단·재실행 | 어느 단계에서 실패하거나 신호를 받아도 API는 정지 상태, 마커는 유지되고 재개/롤백 방법이 출력된다. 같은 백업으로 다시 실행하면 이어서 끝난다(멱등). 롤백은 보존된 사본을 같은 명령으로 복구한다. 마커만 지우려면 `--abort --confirm-fence`(API는 계속 정지) |
| 펜스가 프로세스보다 오래 간다 | 마커가 있는 동안 `deploy`, `temporary-active`, `replace-temporary-active`, `extend-temporary-active`, `adopt-persistent-active`, `rollback`, CI deployer(`main` push의 `deploy-lightnode`)는 모두 거부한다. `stop`, `guard-expiry`, 만료 유닛, `status`는 시작 경로가 아니므로 계속 동작한다. 마커는 재기동 성공 또는 `--abort`로만 지워진다 |
| 재기동 조건 | 실행 직전에 flock 아래에서 다시 확인한다: temporary-active는 만료가 *지금 + 준비 대기(150초)* 이후이고 만료 타이머가 살아 있을 것, persistent-active는 보호된 shutdown 정책과 마스크 유닛이 유효할 것, passive는 컨테이너 게이트가 passive일 것. 그 밖의 상태(승인 만료 등)는 복구 자체는 성공이므로 펜스만 풀고 API는 **시작하지 않으며**, 정상 `temporary-active` 승인 절차 또는 `adopt-persistent-active`를 안내한다. 승인을 우회하지 않는다 |
| 재기동 방식 | `compose up`이 아니라 기록된 컨테이너를 `docker start`한다(`up`은 컨테이너를 새 ID·재시작 정책으로 재생성해 `extend-temporary-active`의 컨테이너 ID 보존 불변식을 깨뜨릴 수 있다). 이후 정상 `status` 검증을 통과해야 한다. 스케줄러 lease(`scheduler_lease`)는 정지된 API가 SIGTERM에 반납하거나 TTL 90초에 만료되고, 재기동된 API(같은 holder id, 새 instance id)가 다시 잡는다 — `lease_held=true`가 보이기까지 최대 약 90초 |

**금지 — 실시간 Valkey 데이터를 아래 방법으로 되돌리지 않는다:** 실행 중인 서버에 대한 `RESTORE … REPLACE`나 키 복사, 실행 중인 컨테이너 아래의 볼륨 파일 교체, 기존 `appendonlydir`가 있는 상태에서 RDB만 복사(Valkey 8은 `appendonly yes`이면 `appendonlydir`만 읽고 `dump.rdb`를 무시하므로 **옛 데이터가 조용히 서빙된다**. `appendonlydir`를 지우면 빈 상태로 시작한다), 백엔드가 떠 있는 동안의 쓰기. `DEBUG RELOAD`는 Valkey 8에서 기본 비활성(`enable-debug-command no`)이라 지금은 실행되지 않지만, 켜더라도 같은 이유로 금지다. 실제 위험은 실행 중인 서버에 대한 `RESTORE`/키 복사와 펜스 없이 쓰기가 계속되는 구간이다.

**부수 효과를 알고 복구한다.** 이 Valkey에는 실시간 힌트 외에 rate limit, 락(`agent-action-sweep`, eformsign backfill/operation), eFormsign 스냅샷·상태 데이터도 있다. 복구는 이 전부를 백업 시점으로 되돌리며 **남아 있던 락도 함께** 되돌아온다. 실시간 데이터만 문제라면 복구가 필요 없다 — 비어 있는 새 Valkey는 실시간에 항상 안전하다(클라이언트가 한 번 새로 가져올 뿐).

**앱의 Valkey 사용자는 `INFO`(`@dangerous`) 권한을 유지해야 한다.** 막으면 연속성 증명이 fail-closed로 떨어져 모든 재연결이 전체 새로고침을 한다.

Lightsail은 미사용이다. 되살리면 같은 펜스 절차를 적용한다 (Lightsail is unused; if revived, the same fenced steps apply). 절차 상세와 테스트: `backend/deploy/fallback-server/README.md` → "Fenced Valkey restore", `operator.valkey-restore.behavior.test.sh`.

---

## 5. 스케줄러·기능 플래그 (플래그는 코드보다 나중에)

플래그가 필요한 기능은 **코드 배포 → DB 패치 → 플래그 ON** 순서로 내보낸다. 플래그가 먼저 켜지면 없는 컬럼을 읽는다.

| 플래그 | 위치 | 규칙 |
|---|---|---|
| `SCHEDULERS_ENABLED` | LightNode 호스트 env (main, Lightsail 미사용) · Cloud Run preview 매니페스트 하드코딩 (BJJ-341부터) | production 런타임 **하나**만 true. preview는 항상 false (백엔드 기본값 true — 매니페스트 누락 금지) |
| `CONTRACT_AUTO_FINALIZE_ENABLED`, `CONTRACT_AUTO_FINALIZE_SINCE` | 백엔드 env | 계약서 자동 검토완료 스케줄러(매일 17:00 KST). SINCE(YYYY-MM-DD)는 배포일 = 백로그 울타리, 없으면 에러 로그 후 no-op. 켜기 전 `eformsign_doc` 자동완료 컬럼 3개 패치(20260808000000) 선적용. 브랜치별 세부 설정은 DB(`system_setting`, `branch:<id>:contract_automation:auto_finalize`)이며 UI 계약서 → 자동화에서 편집 |
| `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED` | 백엔드 env | 문서 잡 큐 수락. 위 스케줄러의 전제 |
| `SERVICE_RECORD_AUTO_FINALIZE_ENABLED` | 백엔드 env | 제공기록지 자동 완료. 로컬 실기기 테스트에도 필요 |
| `TENANT_ISOLATION_MODE` | 백엔드 env (`off`/`observe`/`enforce`, 기본 observe) | `observe` → 7일 무위반 → staging `enforce` + auth-e2e/full-flow → production `enforce`. 전환·롤백 모두 env 변경만, 배포 불필요 (`backend/README.md`) |
| `VALKEY_URL` | 백엔드 env | 미설정이면 6시간 eformsign 리컨사일 스윕이 **조용히 스킵**된다 (2026-08-01까지 그랬음). Railway 내부망은 `?family=0` 필요 |
| `MOBILE_SERVICE_RECORD_BASE_URL` | 백엔드 env | 미설정 시 프로덕션 URL. 로컬은 `start:dev` 래퍼가 LAN IP를 주입 |

플래그를 켠 뒤에는 **첫 실행 로그를 본다.** 예: `[Contract Auto Finalize]` 첫 17:00 실행, `[eformsign reconcile]` 스윕 `fetched=` 로그.

---

## 6. 프론트·모바일 배포 (Vercel)

- 저장소에 `vercel.json`이 없다. 어떤 브랜치가 빌드되는지는 **Vercel 프로젝트의 Ignored Build Step** [외부]이 유일한 통제점:
  ```sh
  case "$VERCEL_GIT_COMMIT_REF" in preview|main|legacy-production) exit 1 ;; *) exit 0 ;; esac
  ```
  **`exit 1` = 빌드 진행, `exit 0` = 스킵** (직관과 반대).
- git-linked 프로젝트가 **3개**(`babyjamjam-admin` frontend, `babyjamjam-admin-mobile` mobile, `babyjamjam-admin-legacy`)이고 같은 문자열을 공유한다. 브랜치를 켜고 끌 때 **셋 다** 고친다. API: `PATCH /v9/projects/{name}?teamId=…`의 `commandForIgnoringBuildStep`.
- dev 스코프 preview env var(frontend 19개, mobile 15개)는 **지우지 않는다.** dev 빌드를 되살릴 때 그대로 쓴다.
- `main` 병합 = 프로덕션 자동 배포 (`target: "production"`, 2026-07-28 실측). "수동 promote 필요"는 틀린 기록이었다. 프로덕션이 뒤처져 보이면 배포 방식보다 **`git log origin/main..origin/preview`로 승격 지연부터** 본다.
- Vercel preview URL은 SSO 보호라 직원이 열 수 없다. 외부 공개 페이지는 프로덕션 배포가 유일한 경로.
- 공개돼야 할 페이지·정적 파일은 `mobile/src/middleware.ts`의 `PUBLIC_ROUTES`에 있어야 한다. 누락 시 307로 튕기며 인증 쿠키까지 지운다 (2026-07-28 `/pdf.worker.min.mjs`).
- 반영 확인: Vercel `list_deployments`의 production 타깃 `githubCommitSha`, 또는 `curl -sI https://m.admin.babyjamjam.com/<경로>`.

---

## 7. 환경 변수와 시크릿

- 소스 오브 트루스는 각 체크아웃의 git-ignored `.env*`. 커밋되는 것은 키 매니페스트 `env.tpl` / `env.local.tpl`(시크릿은 `KEY=` 빈 값).
- **변수를 추가·이름 변경·삭제하면 `.env`와 `env.tpl`을 같이 고치고** 사용자에게 `env-backup <file>` 실행을 요청한다. 작업 종료 전 `~/.agents/bin/env-check`가 0으로 끝나야 한다.
- 새 워크트리의 env는 `env-bootstrap`이 형제 워크트리에서 복사한다(1Password 접근 없음). 볼트 읽기는 fresh clone의 `env-restore --all` 한 번뿐.
- 값을 출력·로그·비교하지 않는다. 비교는 `shasum -a 256 | cut -c1-12`.
- 원격 env 조회(`railway variables --kv` 등)는 키와 `NODE_ENV`만 보고 나머지는 redact.
- 프로덕션 백엔드 필수 확인: `NODE_ENV=production`, `JWT_SECRET` SET, `ALLOW_DEV_JWT_SECRET` UNSET, `EFORMSIGN_WEBHOOK_SECRET` SET (2026-07-17 admin 서비스 54개 전부 SET 실측).

---

## 8. 승격(릴리스) 체크리스트

`dev → preview`, `preview → main` PR을 열기 전에 순서대로:

1. `dev` CI 전부 green (`enforce` leg 포함). 조회는 §2-4 방식으로.
2. 신규 migrations ↔ `database-patches.yml` 세 잡 배선 대조 (§3.2-2).
3. 마이그레이션이 있으면 **먼저** `gh workflow run database-patches.yml --ref dev -f target=<preview|production>` 실행·성공 확인 (§3.3).
4. 새 env 키가 있으면 `env.tpl` 갱신 + 원격 환경(LightNode 호스트 env, preview Cloud Run Secret Manager, Vercel env)에 값 추가. 플래그는 아직 OFF.
5. 승격 PR은 merge commit (linear history 룰셋).
6. 배포 완료 확인: 백엔드 `/health/ready` 200 + `deploy LightNode fallback backend` 잡의 tag/digest 일치(실패 표시라도 `current_tag`/`container_health`를 확인), 프론트 production 배포 sha.
7. 플래그 ON → 첫 실행 로그 확인 (§5).
8. Sentry release/source map 확인 (프로덕션 아티팩트가 바뀐 경우). 백엔드 Sentry는 **service-records 이벤트만** 통과시키므로 다른 도메인 오류는 로그로 본다.
9. 런치 체크리스트가 있는 기능은 그 문서(예: `docs/plans/2026-09-01-call-inbox-launch-checklist.md`)의 §0~§5를 닫는다.

핫픽스는 `main`에서 분기한 전용 워크트리에서 만들고 `main`으로 PR, 이후 `dev`로 back-merge. `cs` 런처(dev 기준)를 핫픽스에 쓰지 않는다.

---

## 9. 로컬 개발 환경

- 백엔드 `pnpm start:dev` = `backend/scripts/start-dev-lan.mjs` 래퍼. LAN IP를 감지해 `MOBILE_SERVICE_RECORD_BASE_URL`을 주입하고 `nest start --watch`. 포트 3001.
- 프론트 3000, 모바일 3002. 모바일은 무설정(backendBaseUrl 기본 localhost:3001).
- dev Supabase는 `ebiughoiebblasxwgxbe`. eformsign 계정은 환경 공용이라 **로컬 finalize도 실문서를 만든다.**
- 워크트리: 세션은 `dev` 형제 디렉터리의 태스크 워크트리에서 작업한다 (`cs <slug>`). 환경 브랜치(`main`/`preview`/`dev`) 체크아웃에서 직접 편집하지 않는다.

---

## 10. 자주 나는 실수 (리뷰 반려 기준)

1. migrations만 추가하고 `database-patches.yml` 세 잡 배선을 빠뜨림.
2. 코드 먼저 배포하고 DB 패치를 나중에 → 호환 폴백이 가드를 무력화하는 창이 열림.
3. `prisma migrate deploy`를 원격에 실행.
4. `DATABASE_URL=… prisma db execute`로 prod에 적용했다고 믿음 (실제로는 dev에 적용됨).
5. preview를 "격리된 스테이징"으로 전제 (prod DB 공유).
6. dev 호스팅 URL을 전제로 한 설정.
7. Vercel 빌드 브랜치를 프로젝트 하나에서만 변경.
8. `gh run list --commit`으로 "CI 대기중"이라고 보고.
9. preview push의 OIDC 배포 실패를 코드 문제로 재조사.
10. 플래그를 컬럼 패치 전에 ON.
11. 두 런타임(LightNode Fallback과 다른 런타임 — 잔존 Lightsail·Railway 포함)에 동시에 스케줄러 활성화.
14. Fallback Server에서 스케줄러·잡 워커·Aligo를 켬, 또는 DB identity 게이트를 우회.
15. Fallback 전환 후 자동으로 돌아올 것이라 가정 (failback은 수동).
12. env 키를 추가하고 `env.tpl`·`env-check`를 빠뜨림.
13. 저장소의 `rollback.sh`를 직접 실행 (retired, 거부됨).

---

## 11. 이 문서를 바꿔야 할 때

- 새 사고가 나면 §10에 항목을 추가하고, 해당 절에 날짜·PR/run 번호와 함께 규칙을 적는다.
- Fallback 컨트롤러가 설치·arm되면 §4.1 "현재 상태"를 갱신한다. `railway.json`·README의 Railway 문구를 정리하면 §4 Railway 절을 삭제한다.
- 워크플로 파일 이름·잡 이름이 바뀌면 §2 표를 같은 커밋에서 갱신한다.

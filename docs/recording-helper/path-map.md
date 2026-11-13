# Galaxy helper 실행 경로와 재개 지점

작성일: 2026-10-15 · [BJJ-354](https://linear.app/jaino-studio/issue/BJJ-354)
상태: **Phase 0 OPEN — 현행 소스 조사 완료, API fixture·GUI·실기기 검증 미완료**

## 로컬 재개 갱신 — 2026-10-15 KST

후속 로컬 빌드·에뮬레이터 관찰과 화면 수정은
[2026-10-16 검수 기록](evidence/local-emulator-2026-10-16.md)을 참조한다. 아래 SDK/GUI 상태는
로컬 재개 시점의 기록이며, 후속 결과를 제품 44개 테스트·실제 Galaxy 통과로 확대하지 않는다.

이 절이 아래의 이전 환경 사전 점검 기록보다 우선한다. 기존 제품/API/권한 계약은 변경하지 않는다.
조사한 경로를 새 구현의 승인된 allow-list나 테스트 실행 증거로 간주하지 않는다.

| 항목 | 현재 확인 |
|---|---|
| 소스 기준 | 원격 fetch 후 `dev` = `037ed2bdde6188869017bbb7173f54cace9739b2` |
| 문서 작업 | Execution: N/A · Documentation: MAIN · Audit: SOL; 관찰 사실·경로·명령만 갱신 |
| 문서 시작 | PR #826 `797f59fd0479c5d85f771235213c8008321a0374` |
| 로컬 문서 branch | `docs/BJJ-354-phase0-local` |
| 로컬 문서 worktree | `/Users/jaino/Development/babyjamjam-admin/bjj-354-phase0-local` |
| 진단 소스 | PR #827 `61b9b2c0418f12a793e0c8e89d4f974ac6479909` |
| 진단 로컬 checkout | `/Users/jaino/Documents/Codex/2026-10-15/new-chat/work/helper-saf-ui-review` |
| Studio 프로젝트 | 위 checkout의 `experiments/helper-saf-spike` |
| 지정 탐색기 | `explorer` / `opencode-go/deepseek-v4.1-flash` / high; 현재 요청의 소스 조사 성공 |
| main runtime | model / effort 미확인 (`unknown`) |

두 PR은 OPEN/Draft/미병합이다. 문서 worktree 생성 직후 `env-bootstrap`이 기존 dev의
backend/frontend env를 복사했다. 값은 출력·커밋하지 않았다. dev의 기존 미추적
`frontend/AGENTS.md`, `mobile/AGENTS.md`는 보존했다.

### 현행 수집·권한 경로

| 경계 | 현재 소스 근거 |
|---|---|
| 수집 흐름 | `docs/n8n/README.md`, `call-transcription-branch-template.json`: Drive Trigger → 다운로드 → Gemini 전사 → `POST /webhooks/call-transcripts` |
| webhook | `backend/interface/controllers/call-transcript-webhook.controller.ts`: CallIngestGuard, request.callIngestBranchId, 신규 202 / 중복 200 |
| 입력 | `backend/interface/dto/call-inbox.dto.ts`: CallTranscriptWebhookDto, driveFileId 최대 200자 |
| 지점 결정 | `backend/infrastructure/auth/call-ingest.guard.ts`: token lookup의 system scope 후 tenant branch 설정; payload branchId 사용 안 함 |
| 중복 | `backend/application/services/call-ingestion.service.ts`: 전역 driveFileId 조회, P2002 경합 처리 |
| DB | `backend/prisma/schema.prisma`: call_record.driveFileId @unique, call_ingest_token.tokenHash @unique |
| 수집 credential | `backend/application/services/call-ingest-token.service.ts`: 난수 발급·hash 저장·철회; helper 권한과 재사용하지 않는 것은 기존 계획 요구 |
| 조회 | `backend/application/services/call-inbox.service.ts`: getCallRecord(branchId, id); branch+driveFileId 전용 adapter는 아직 없음 |
| 등록 지점 | `backend/module/call-inbox.module.ts`, `backend/app.module.ts` |
| 웹 인증 | `backend/infrastructure/auth/jwt.guard.ts` |
| tenant | `backend/infrastructure/tenant/tenant.guard.ts`: 활성 지점, user_branch membership, tenant context |
| 지점 관리자 | `backend/infrastructure/auth/branch-manager.guard.ts`: global owner 또는 branch admin/manager |
| 관리 API 예시 | `backend/interface/controllers/call-ingest-token.controller.ts`: JwtGuard/TenantGuard/BranchManagerGuard와 route branch 대조 |
| 허용 지점 | `backend/interface/controllers/auth.controller.ts`의 /auth/branches → `backend/application/services/auth.service.ts`의 getUserBranches/filterSelectableUserBranches |
| 공개 지점 | /auth/branches/all은 공개 목록이며 승인 권한 증명으로 대체할 수 없음 |
| HTTP 경계 | `backend/main.ts`: 전역 prefix 없음, GlobalValidationPipe, PrismaExceptionFilter, ServiceRecordSentryExceptionFilter |
| 오류 본문 | `backend/application/utils/problem-bodies.ts`, `backend/infrastructure/filters/problem-response.ts`, `prisma-exception.filter.ts`, `backend/infrastructure/observability/service-record-sentry-exception.filter.ts` |
| return path | `frontend/src/lib/auth/safe-return-path.ts`와 `.test.ts`: 현재 /service-record-admin/<id>만 허용 |

전역 unique의 배포 DB 적용 상태와 실제 workflow 실행은 NOT_RUN이다. 계획의 “기존 웹 CSRF 방어”는
helper 승인 경로에 아직 binding되지 않았다. 브라우저 → BFF → backend의 credential 전달과 write
방어를 추적해야 하며, 이 미확인을 CSRF 취약점이 확인됐다는 뜻으로 해석하지 않는다.

### 화면·디자인 시스템·fixture

현행 통화 인박스는 `mobile/src/app/(shell)/calls/page.tsx`에 있다. frontend의 같은 inbox 화면은
확인하지 못했다. “admin 통화 인박스”를 새 desktop inbox 구현 지시로 넓히지 않는다.

* 인박스 BFF: `mobile/src/app/api/call-records/route.ts`, `mobile/src/app/api/call-records/[id]/route.ts`.
* UI tests: `mobile/src/app/(shell)/calls/__tests__/page.test.tsx`, `mobile/tests/calls-inbox.spec.ts`.
* 기존 운영 UI: `frontend/src/app/(protected)/settings/page.tsx`,
  `frontend/src/components/app/call-ingest-tokens/CallIngestTokenSection.tsx`.
* 기존 운영 API: `frontend/src/services/call-ingest-tokens.ts`,
  `frontend/src/app/api/branches/[branchId]/call-ingest-tokens/route.ts`,
  `frontend/src/app/api/call-ingest-tokens/[id]/revoke/route.ts`.
* 탐색기가 `docs/design-system/AGENT_UI_RULES.md`와 `component-manifest.json`을 읽었다.
  `@/components/app/v3`의 SplitLayout/ListPanel/DetailPanel/PageHeader/SearchFilterBar/InfoCard와
  `@/components/app/ui/status-badge`의 StatusBadge가 재사용 후보이며, 구현 시 다시 대조한다.
* migration 근거: `backend/prisma/README.md`, `backend/prisma/migrations/`.
  조사 시 최신은 `20261014120000_add_message_log_carrier_check`.
* tenant 모델 생성: `backend/scripts/tenant/generate-tenant-models.ts` →
  `backend/infrastructure/tenant/tenant-models.generated.ts`; 후속 schema scope에 생성·drift 검사를 포함해야 한다.
* controller fixture 예시: `backend/test/integration/call-transcript-webhook.controller.integration.spec.ts`,
  `backend/test/integration/call-ingest-token.controller.integration.spec.ts` (TestingModule/supertest).
  허용 지점 성공·타 지점 실패를 함께 보존한다.
* guard/service 예시: `backend/test/infrastructure/auth/call-ingest.guard.enforce.spec.ts`,
  `backend/test/services/call-inbox.service.spec.ts`.
* DB E2E: `backend/test/e2e/call-inbox.e2e.spec.ts`는 E2E_VENDOR_STUBS=1 없으면 skip한다.
  `backend/scripts/run-call-inbox-e2e.mjs`의 disposable DB 경로로 실행해야 한다.
* tenant E2E: `backend/test/auth-e2e/tenant-isolation.spec.ts`, `transitive-tenant-isolation.spec.ts`.

44개 제품 테스트의 helper fixture는 현행 소스에서 확인되지 않았다. 정본 Test Spec의
Branch A/B, Operator A, P1/P2, S1/C1/config1, G1/G2, F1/F2, R-old/test/new/growing/renamed/late,
J1/D1/X1은 문서용 별칭이다. 실행 fixture에서는 실제 타입 ID와 synthetic bytes를 고정해야 한다.

### 확인된 재실행 명령

아래 명령은 package scripts에서 확인했다. 이번 문서 변경에서 실행한 결과가 아니다.

| 대상 | 명령 |
|---|---|
| backend | `pnpm --filter ./backend type-check`, `pnpm --filter ./backend lint`, `pnpm --filter ./backend test` |
| 수집 집중 검사 | `pnpm --filter ./backend test test/integration/call-transcript-webhook.controller.integration.spec.ts` |
| DB E2E | `pnpm --filter ./backend e2e:call-inbox`, `pnpm --filter ./backend test:auth-e2e` — 각 격리 harness 전제 확인 |
| frontend | `pnpm --filter ./frontend type-check`, `pnpm --filter ./frontend lint`, `pnpm --filter ./frontend test` |
| return path | `pnpm --filter ./frontend test src/lib/auth/safe-return-path.test.ts` |
| mobile | `pnpm --filter ./mobile type-check`, `pnpm --filter ./mobile lint`, `pnpm --filter ./mobile test` |
| 별도 웹 E2E | `pnpm --filter ./frontend test:smoke`, `pnpm --filter ./mobile test:e2e` |
| 빌드/UI 구조 | `pnpm build:be`, `pnpm build:fe`, `pnpm lint:ui-architecture` |
| 진단 Android | 실험 프로젝트에서 `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon` |

root typecheck는 없다. backend type-check/pretest는 Prisma client를 생성한다.
frontend/mobile Jest는 tests/의 Playwright를 실행하지 않는다. db:migrate/db:migrate:deploy는
read-only 검증 명령이 아니며 이번에 실행하지 않았다. 앱 코드 변경이 없는 문서 검증과 구분한다.

### 로컬 상태와 아직 열린 항목

* 사용자는 실제 Galaxy를 지금 연결할 수 없어 로컬 준비·에뮬레이터 검수를 먼저 선택했다.
* `/Applications/Android Studio.app`의 실제 Setup Wizard 실행과 codesign strict 검증 exit 0을 확인했다.
  로컬 `android-studio-rabbit1-mac_arm.dmg` SHA-256은 공식 페이지와 같은
  `16d4a0f8a52413b51869fc18d5bdcdf9cecd38615cd7bb7cf14d51b99d2fef54`다.
* JDK 17: `/Users/jaino/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.20.1+1/Contents/Home`.
  진단 소스의 조합은 AGP 9.2.1 / Gradle 9.4.1 / compile-min-target SDK 37이다.
* 로컬 재개 시 SDK·AVD·APK는 확인되지 않았다. 이전 환경의 JVM 14 PASS/lint/APK 기록은 PR #827의
  증거이며 이번 Mac에서 재실행한 증거와 구분한다.
* Vault `/Users/jaino/Development/covenant-labs-vault` 검색은 stale-index 경고를 반환했다.
  BJJ-354의 직접 근거를 얻지 못해 최신 Linear/소스를 우선했고 Vault 파일은 수정하지 않았다.

Task 0.1은 소스 조사만으로 닫지 않는다. 남은 항목은 helper API별 정상 status·error code/envelope·
반복 철회 terminal 응답의 fixture 고정, 승인 write 경계, branch+driveFileId adapter,
운영 화면과 각 구현 task의 exact allow-list다. ADR는 조사 시 ADR-014가 다음 번호지만
새 작성 시 충돌을 다시 확인하며 실기기에서 아직 얻지 못한 완료 판별을 미리 결정하지 않는다.

Task 0.2의 로컬 GUI와 실제 Galaxy 검증도 아직 미완료다. Phase 0 공통 종료 조건과 실기기 증거가
확보되기 전 Phase 1을 시작하지 않는다. 실험 코드를 제품 dev로 병합하거나 Google/n8n 쓰기·
운영 배포를 수행하지 않는다.

## 이전 실행 환경 기록 (아래는 로컬 재개 전 관측)

## 실행 기준

| 항목 | 값 |
|---|---|
| 저장소 | `jaino-song/babyjamjam-admin` |
| 기준 브랜치 | `dev` |
| 기준 커밋 | `037ed2bdde6188869017bbb7173f54cace9739b2` |
| 계획 | implementation-plan-v1.2 |
| 문서 작업 | Task 0.1 / Execution: N/A / Documentation: MAIN / Audit: SOL |
| 문서 브랜치 | `codex/unit/helper-contract-preflight` |
| 문서 worktree | `/workspace/scratch/632338030b0b/implementation-worktrees/helper-contract-preflight` |
| 실험 브랜치 | `codex/unit/helper-saf-spike` |
| 실험 worktree | `/workspace/scratch/632338030b0b/implementation-worktrees/helper-saf-spike` |
| 실험 시작 상태 | 기준 커밋에서 시작. 2026-10-15 사용자 승인 후 지정 Luna에 코드 준비 배정 |

`git ls-remote`와 checkout에서 같은 기준 SHA를 확인했다. 기존 앱의 코드·스키마·의존성·실행 설정은 변경하지 않았다. integration worktree는 아직 만들지 않았으며 merge도 수행하지 않았다.

## 확인한 근거와 남은 binding

다음은 계획 수립/실행 preflight에서 이미 확인한 정확한 근거 경로다. 표에 경로가 있다고 해서 변경 allow-list나 해당 경로 전체 감사가 완료된 것은 아니다. 최신 전체 경로 탐색을 대신하는 용도로 사용하지 않는다.

| 근거 경로 | 확인한 사실 | 후속 확인 |
|---|---|---|
| `AGENTS.md` | 새 worktree의 env-bootstrap, UI 규칙 선행 읽기 | 해당 task 착수 시 추가 지침 적용 |
| `package.json` | pnpm 10.33.0, Node ≥20, root build/QA/UI 검사 script | backend/frontend package별 정확한 test/type-check/lint 선택 명령 |
| `backend/prisma/schema.prisma` | `call_record.driveFileId`의 전역 unique; 계획 검수에서 기준 SHA로 확인 | 신규 모델과 migration/test adapter 경로, 배포 DB 적용 상태 |
| `backend/application/services/auth-token-policy.ts` | 기존 웹 토큰 정책의 근거 경로 | helper와 분리되는 실제 경계, 변경 필요성 |
| `backend/application/services/auth-session.service.ts` | 기존 웹 session 서비스 근거 경로 | 새 helper credential이 웹 session을 재사용하지 않는지 |
| `backend/application/services/auth.service.ts` | 기존 인증 서비스 근거 경로 | enrollment 승인 시 사용자·지점 권한 adapter |
| `backend/interface/controllers/auth.controller.ts` | 기존 `/auth/token`은 웹 refresh session 교환 | 기존 prefix/CSRF/guard/error envelope 확인 |
| `frontend/src/lib/auth/safe-return-path.ts` | 제한된 return path allow-list | helper의 정확한 경로·쿼리와 회귀 테스트 경로 |
| `docs/n8n/README.md` | 토큰에서 지점 결정, driveFileId 중복 처리 | 실제 운영 folder/credential/token 연결 |
| `docs/n8n/call-transcription-branch-template.json` | 기존 지점별 workflow template | 실제 계정·workflow에서 한 파일의 수신 증거 |
| `docs/design-system/AGENT_UI_RULES.md` | root AGENTS가 요구하는 UI 규칙 경로 | UI 구현 전 전체 읽기 |
| `docs/design-system/component-manifest.json` | root AGENTS가 요구하는 DS manifest 경로 | 사용할 컴포넌트와 없을 때의 확장 소유권 |

아직 고정하지 않은 경로: helper controller/service/repository/guard, 지점 권한 decorator, call record 조회 adapter, DB migration/통합 fixture, frontend 승인·운영 화면과 테스트, 다음 ADR 번호. 이를 추측해 새 구현 계층을 만들지 않는다. ADR 파일은 실제 디렉터리/번호 확인 후 생성한다.

## 실행 환경 확인 결과

| 점검 | 관측 결과 | 영향 |
|---|---|---|
| GitHub dev 읽기/clone | 성공, 위 SHA 일치 | 독립 worktree 준비 가능 |
| Git worktree | 문서/실험 두 개 생성 | 환경 브랜치에 직접 쓰지 않음 |
| 구현 agent | `gpt-5.6-luna`, max로 검증용 APK 코드 준비 진행 | 실험 allow-list 내부만 변경 |
| Java | 공식 Temurin JDK 17.0.20.1+1 설치, SHA-256 확인, javac 실행 성공 | 독립 Android 빌드에 사용 |
| Gradle/adb | Gradle 9.4.1 공식 배포 SHA-256 확인, platform-tools 37.0.1 설치 | adb 기기 목록 비어 있음; 실기기 설치 NOT_RUN |
| Android SDK | `platforms;android-37.0`, build-tools 36.0.0/37.0.0 설치 성공 | 실험 프로젝트의 빌드 결과는 별도 evidence에서 기록 |
| `env-bootstrap`, `env-restore` | PATH에 없음 | env 복원 완료로 기록하지 않음; env 값 열람 없음 |
| Codex Router/scout | 로컬 실행기·scout validator·역할 binding 부재 | Task 0.1 다중 파일 탐색 BLOCKED |
| Vault resolver | 실행 경로/연결 도구 부재 | 검색·capture 미수행, 성공으로 기록하지 않음 |
| 실제 Galaxy | `adb devices -l` 실행 결과 연결 기기 없음 | SAF HW 테스트 NOT_RUN; gate BLOCKED |
| Android 공식 SDK 다운로드 | 기존 프록시를 통해 지정 패키지 설치 exit 0 | 다운로드/설치와 앱 빌드/기기 동작 검증을 구분 |

Android 17/API 37 설정 근거: [Android 공식 SDK 설정](https://developer.android.com/about/versions/17/setup-sdk). 실험 앱의 예정 조합은 AGP 9.2.1/Gradle 9.4.1/JDK 17과 API 37이다. 공식 AGP 9.2 호환표를 확인했으며 실제 빌드 결과는 실험 evidence에서 기록한다. 제품 Compose 조합은 후속 Phase에서 고정한다.

## 지정 탐색기 제약

공유 `agents-private/codex/AGENTS.md`는 다중 파일 탐색을 OS 수준 read-only `explorer`에 위임하고, 일반 write-capable agent로 대체하지 않도록 정한다. 원격 설정의 primary는 `opencode-go/deepseek-v4.1-flash`/high/Codex Router다. 현재 환경에는 해당 실행 경로가 없다.

따라서 auth/권한/DB/UI를 parent의 연속 grep/read나 일반 Luna로 대신 탐색하지 않았다. 실제 primary 요청 실패 증거가 없으므로 quota 소진 또는 fallback 실행 성공으로 기록하지도 않았다. 재개에는 설정된 탐색기와 validator가 있는 환경이 필요하다. 이 제약을 우회하기 위해 역할 설정이나 정책 파일을 수정하지 않는다.

## 검증 명령 상태

| 구분 | 명령 또는 작업 | 현재 상태 |
|---|---|---|
| 문서 | `git diff --check` | 커밋 전 실행 결과를 PR에 기록 |
| 문서 | 계약 본문이 계획 §2.2–2.6과 동일한지 대조 | 커밋 전 실행 결과를 PR에 기록 |
| frontend build | `pnpm build:fe` | NOT_RUN — 앱 코드 변경 없음, env/deps 미준비 |
| backend build | `pnpm build:be` | NOT_RUN — 앱 코드 변경 없음, env/deps 미준비 |
| UI 구조 | `pnpm lint:ui-architecture` | NOT_RUN — UI 변경 없음 |
| QA 실행 | `pnpm qa:fe`, `pnpm qa:mobile -- --port <지정 포트>` | NOT_RUN — 서비스 미기동 |
| package test/lint/type-check | 실제 package script에서 확정 필요 | BLOCKED — 지정 탐색기 필요 |
| Android | 독립 실험 Gradle의 testDebugUnitTest/lintDebug/assembleDebug | 작업 중 — 최종 실행 결과는 실험 evidence에서 기록 |
| PRD 수락/회귀 | 정본 Test Spec v1.0의 44개 ID | 전부 NOT_RUN |

root에 `typecheck`라는 script가 있다고 가정하지 않는다. 문서 체크 성공을 backend/frontend/Android 테스트 성공으로 대체하지 않는다.

## 현재 gate와 재개 순서

1. **Task 0.1 일부 진행:** 계약 이관, revision/이슈/worktree binding 완료. 정확한 구현/테스트 경로·API fixture·검증 명령·ADR는 지정 탐색기 복구 후 고정한다.
2. **Task 0.2 코드 준비 진행 / HW BLOCKED:** 2026-10-15 사용자가 검증용 APK 선제작을 명시적으로 승인했다. Implementation Plan v1.2에 순서 변경을 반영하고 독립 dispatch 검수 APPROVE 후 구현에 착수했다. 실제 폰 검증과 Phase 0 close 조건은 그대로 유지한다.
3. 대상 폰의 모델·Android/One UI/삼성 전화 버전, 사용자가 허용한 합성 시험 녹음, 설치/검증 방법을 준비한다. raw 녹음과 파일명은 작업 이슈에 올리지 않는다.
4. Task 0.2의 원래 allow-list는 `experiments/helper-saf-spike/**`와 `docs/recording-helper/evidence/saf-spike.md`다. 실제 작성은 지정 Luna worker가 담당하고 실험 코드는 제품 `dev`에 병합하지 않는다.
5. 실기기에서 폴더 선택/읽기, 영구 권한·재부팅, 권한 회수·복구, 녹음 중/종료 후 크기·시간·문서 ID 변화, rename/늦은 노출을 확인한다. 합성 fixture/에뮬레이터 결과는 Samsung 실기기 증거를 대신하지 않는다.
6. Phase 0 close의 실제 근거가 모이기 전에는 Phase 1의 Drive/n8n 시험과 제품 Android scaffold를 시작하지 않는다.

이 문서는 Phase 0 완료 보고가 아니다. 검증 앱의 실제 빌드·코드 검수 결과는 `docs/recording-helper/evidence/saf-spike.md`에 기록한다. 실기기 테스트, Drive 업로드, backend 변경, 배포는 아직 수행하지 않았다.

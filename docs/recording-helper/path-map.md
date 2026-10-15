# Galaxy helper 실행 경로와 재개 지점

작성일: 2026-10-15 · [BJJ-354](https://linear.app/jaino-studio/issue/BJJ-354)
상태: **Phase 0 OPEN — 사용자 승인으로 검증용 APK 선제작 진행**

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

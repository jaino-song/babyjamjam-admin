TL;DR: BJJ-319의 남은 작업은 현재 CI 실패 정리와 전체 오류 경로 목록 확정 → 기능별 서버·웹·모바일 오류 전환 → 복합 작업과 회복 검증 → 보안·전체 회귀 → 승인된 실제 연동 검증과 배포 순서로 진행한다. 이미 통과한 공통 계약과 고객·모바일 계약·문자 구현은 재사용하고, 미분류 경로나 검증 없는 예외를 남긴 채 전체 완료로 표시하지 않는다.

# BJJ-319 남은 오류 처리 실행 계획

작성 기준: 2026-09-10. 제품 기준 SHA `fc3b2633a5f0f346c5cc6d04cc2ecf256784551b`, 전용 통합 브랜치 `korean-error-messages`, [PR #657](https://github.com/jaino-song/babyjamjam-admin/pull/657). 추적 기준은 [BJJ-319](https://linear.app/jaino-studio/issue/BJJ-319)와 [Error Management v1.0](https://app.notion.com/p/3d60b049243480e388e3d2e409245e45)이다.

### 확인된 출발점

- 공통 오류 계약, 서버/프록시 경계, 웹·모바일 고객 폼, 모바일 등록·계약·문자 화면, 일부 조회 실패, SMS 재시도 안전장치와 Sentry 진단 연결은 구현했다. 단계별 독립 검토 지적도 해결했다.
- 최신 SHA의 backend/web/mobile 핵심 CI, 인증 enforce/observe/lifecycle, 공통·모바일 단위, backend full-flow/call-inbox는 통과했다. 배포 작업은 실행되지 않았다.
- [모바일 advisory 브라우저 검사](https://github.com/jaino-song/babyjamjam-admin/actions/runs/34367998946)는 `mobile/tests/phase3-integration.spec.ts:377`의 중복 연락처 오류 시나리오에서 실패했다. `submitAndReadToast:405`가 토스트를 기다린 것이 관찰 사실이다. 테스트만 오래된 것인지 제품 동작 문제인지는 재현 후 결정한다.
- [OSV 검사](https://github.com/jaino-song/babyjamjam-admin/actions/runs/34368000340)는 기존 의존성 취약점 17건으로 실패했다. 오류 처리 수정으로 해결됐다고 취급하지 않는다.
- 문자 발송의 수신자 해석 전 원시 업무 4xx는 확인된 전환 대상이다. 다른 업무 전체의 정확한 수량과 파일 목록은 아직 확정하지 않았다.
- SDK가 이미 검증하는 계약 완료 콜백을 미검증이라고 단정하지 않는다. 고객 등록 화면과 문자 화면이 분리돼 있다는 사실만으로 복합 작업 결함이나 새 트랜잭션 필요성을 주장하지 않는다.

### 목표·범위·결정

**목표:** 백엔드 HTTP/업무/외부 연동/비동기 작업 및 웹·모바일의 모든 적용 대상에 대해 규격 ID, 실제 실패 원인, 공개 코드, 처리 결과, 화면 동작, 검증 증거를 연결한다.

**비목표:** 전면 UI 재설계, 새로운 오류 처리 프레임워크, 근거 없는 DB 스키마 추가, 기존 인증 정책 교체, 실제 고객을 이용한 장애 재현, 승인 없는 발송·서명·병합·운영 배포. PostHog 기능 확장은 BJJ-318에 남긴다. Sentry 운영 항목은 BJJ-317과 연결해 증거를 재사용한다.

**사용자 선택 대기 항목:** 취약점 정비는 별도 조건부 작업으로 포함했다. 실제 연동 검증은 테스트 계정·지정 수신자를 사용하는 단계로 계획했지만 실행 권한은 부여되지 않았다. 사용자가 범위를 줄이면 해당 항목을 명시적 미완료로 기록하며 전체 완료를 주장하지 않는다.

**설계:** 기존 공유 공개 카탈로그 → 의미를 아는 backend 소유자 → 공통 예외/프록시 → 런타임 정규화 → 기존 디자인 시스템의 오류 요약/필드 연결을 유지한다. 알려진 원인을 영문 메시지 비교로 추측하지 않는다. 변경 전에 실패한 경우만 NOT_APPLIED, 결과가 불명확하면 UNKNOWN, 일부 완료가 확인되면 PARTIALLY_APPLIED로 둔다. 기존 job/idempotency/claim/reconciliation을 우선 재사용한다. 새 endpoint·스키마는 기본 계획에 없다. 기존 상태 모델로 필요한 사실을 표현하지 못함이 재현되면 별도 ADR·마이그레이션 task와 감사 gate를 추가한 뒤 진행한다.

### 실행 계약과 크기 제한

- 이 문서는 구현 착수 명령이 아니라 요청받은 실행 계획이다. 조사로 확정하지 못한 파일을 임의로 수정하지 않는다.
- 아래 Paths의 디렉터리/glob은 조사 범위의 상한이다. Task 1.1에서 `docs/error-management-inventory.json`에 실제 endpoint/화면/오류별 정확한 소유 파일과 테스트를 기록하고, 각 후속 task를 그 파일 목록으로 좁힌다. 경로 미확정 task는 dispatch하지 않는다.
- 기능별 항목은 전수 확인 슬롯이며 전체 도메인을 한 번에 변경하는 허가가 아니다. 하나의 실패 조건 또는 작은 연관 묶음의 M 이하 작업으로 나누고, 목표 400줄을 넘거나 공유 상태 결합이 추가되면 별도 명시적 subphase로 분리해 본 계획과 metadata를 갱신한다. 조사 결과 추가 도메인이 나오면 누락시키지 않고 후속 singleton phase로 추가한다. 이 구체화가 끝나지 않은 슬롯은 구현 준비 완료가 아니다.
- 각 phase는 단일 batch다. 공통 `problem-details.ts`나 공통 테스트를 수정하는 수직 작업들은 순차 진행한다. 병렬화는 소유 파일이 서로 겹치지 않는 것으로 확정된 경우만 허용한다.
- 첫 phase 제품 기준 SHA는 위 값이다. 이후 phase 시작 SHA는 앞선 close 이후 dispatch 직전에 실제 통합 commit으로 결속한다. 문서만 추가된 경우에도 실행 시 실제 기준을 검증한다.
- 구현은 `luna_implementer / gpt-5.6-luna / max / fast(priority)`를 사용한다. 외부 접근이 필요한 별도 허용 작업만 `luna_network_implementer`를 사용한다. 독립 감사는 `sol_reviewer / gpt-5.6-sol / high / priority`, read-only다. main은 현재 선택된 모델을 유지하며 모델·effort의 런타임 값을 확인 전 발명하지 않는다. main 운영 gate를 실행하기 전에 실제 값을 기록한다.
- **공통 phase close gate:** task-local 검증 → 완료된 unit만 통합 → 영향 범위 통합 검증 → 누적 위험 재판정 → SELF 증거 또는 정확한 SHA/base/범위의 SOL SHIP. 실패/미해결 지적이 있으면 다음 의존 phase로 넘어가지 않는다. clean unit은 병합 직후 삭제한다.
- 계획 변경도 기록하고 검토한다. 외부 메시지·실제 서명·환경 브랜치 병합·배포 승인은 phase 통과와 별개다.

## Phase 1 — 전체 경로 목록과 현재 실패의 원인 확정

TL;DR: 미분류 범위를 실제 파일과 실패 조건으로 바꾸고 현재 브라우저 검사 실패를 재현한다. 이 단계가 끝나야 후속 작업의 정확한 파일 범위를 확정할 수 있다.

**In parallel:**

- **Task 1.1: 전체 적용·예외·검증 목록 작성** (refactor, med)
  - HTTP/조회/변경/job/webhook와 웹·모바일 소비자를 연결하고 migrated / legacy / unverified / approved-exception으로 구분한다. endpoint·소비자·비HTTP 작업 및 각 source root의 소유자 수를 대조하고 미분류 0을 확인한다.
  - 각 행에 규격 ID·공개 코드·실제 outcome 근거·파일·기존/추가 테스트·작업 ID를 기록한다. domain·provider adapter·persistence·automation·module·Prisma·공유 runtime 패키지(service-record-ui 포함)까지 source root별 발견 수와 분류 수를 대조한다. dependency/build/generated 트리는 소유 코드 목록에서 제외하고 vendor는 원본 동일성만 확인한다. main이 산출물을 inventory JSON과 본 계획의 정확한 Paths에 반영한다.
  Dispatch metadata: `Phase: 1` · `Parallel group: phase-1-evidence` · `Execution: DELEGATE` · `Audit: SELF` · `Decision reason: 독립적인 전수 읽기 조사, 쓰기 없음` · `Tier: standard` · `Sandbox: local` · `Agent: explorer` · `Model: gpt-5.3-codex-spark` · `Effort: high` · `Phase starting integration commit: fc3b2633a5f0f346c5cc6d04cc2ecf256784551b` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: korean-error-messages (read-only)` · `Worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Service tier: priority` · `Paths: backend/application/**, backend/domain/**, backend/infrastructure/**, backend/interface/**, backend/module/**, backend/prisma/**, backend/test/**, backend/vendor/shared-agent/** [동일성 확인], packages/*/src/** [runtime owner], frontend/src/**, frontend/tests/**, mobile/src/**, mobile/tests/**, docs/error-management.md` · `Depends: none`

- **Task 1.2: 모바일 중복 연락처 오류 회귀 재현** (test, med)
  - 실패 trace와 실제 오류 요약을 대조해 테스트 drift와 제품 결함을 구분한다. 토스트를 억지로 되살리거나 timeout 증가/skip으로 통과시키지 않는다.
  - 기존 민감정보 비노출·한국어 안내 검증을 유지하고 입력 보존·요청 횟수·지속 오류 표시를 확인한다. 제품 결함이면 owning file을 확정해 다음 수정 subphase로 분리한다.
  Dispatch metadata: `Phase: 1` · `Parallel group: phase-1-evidence` · `Execution: DELEGATE` · `Audit: SELF` · `Decision reason: 테스트 재현의 독립성; 제품 변경 시 SOL 재판정` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: fc3b2633a5f0f346c5cc6d04cc2ecf256784551b` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-1-2` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-1-2` · `Service tier: fast` · `Paths: mobile/tests/phase3-integration.spec.ts, mobile/playwright.config.ts` · `Depends: none`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 조사 결과와 재현 증거를 main이 대조해 정확한 소유 파일·M 이하 수직 작업·모든 잔여 행의 작업 ID를 확정한다. 이후 단계의 분해가 불충분하면 dispatch하지 않고 계획을 수정·검토한다.

## Phase 2 — 발송 전 업무 거절 전환

TL;DR: 수신자·발신 승인 등 실제 발송 전에 거절된 이유를 코드로 전달해 사용자가 안전하게 수정할 수 있게 한다.

- **Task 2.1: 문자 사전 조건 오류를 서버부터 화면까지 연결** (feature, high)
  - 발송 전 수신자·템플릿·승인 조건을 개별 등록 코드와 NOT_APPLIED에 연결하고 이미 전환한 발송 이후 결과/재시도 정책을 유지한다.
  - 외부 호출 0회, 실제 지점 권한, 올바른 필드 연결과 수정 후 제출을 검증한다. 공개 응답으로 다른 지점 고객 존재나 provider 메시지를 노출하지 않는다.
  Dispatch metadata: `Phase: 2` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-2-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-2-1` · `Service tier: fast` · `Paths: backend/interface/controllers/message-delivery.controller.ts, backend/test/interface/controllers/message-delivery.controller.spec.ts, packages/shared/src/errors/problem-details.ts, packages/shared/src/errors/**test*, backend/vendor/shared-agent/**, mobile/src/app/(shell)/messages/new/**, frontend/src/** [inventory의 문자 소비자만]` · `Depends: Task 1.1, Task 1.2`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 3 — 고객 업무 오류 전환

TL;DR: 등록·수정·중복·삭제 제한의 남은 원인을 기존 고객 폼과 함께 정리한다.

- **Task 3.1: 고객의 남은 실패 조건과 화면 동작 완성** (feature, high)
  - 중복 연락처·필수 조건·수정 충돌·삭제 제한을 실제 owning code에서 구분한다. 두 입력 오류, 고객 저장 전/후 실패를 각각 확인한다.
  - 이미 적용된 고객 UI는 재작성하지 않고 누락된 필드·복구만 보완한다. 단일 실패 조건별 작은 subphase로 실행하며 각 회귀를 포함한다.
  Dispatch metadata: `Phase: 3` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-3-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-3-1` · `Service tier: fast` · `Paths: backend/application/usecases/** [고객 owner만], backend/interface/controllers/** [고객 owner만], frontend/src/components/app/clients/**, mobile/src/components/app/clients/**, mobile/src/app/(shell)/clients/**, packages/shared/src/errors/**, backend/vendor/shared-agent/**, 관련 owner tests` · `Depends: Task 2.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 4a — 직원 업무 오류 전환

TL;DR: 직원 생성·수정의 원인과 필드 오류를 웹·모바일에서 같은 의미로 처리한다.

- **Task 4.1: 직원 입력·중복·상태 제한 전환** (feature, high)
  - inventory에 있는 직원 실패만 작은 수직 단위로 전환하고 원래 권한/업무 조건을 유지한다.
  - 각 변경의 정상 성공, 다중 필드 오류, 다른 지점 요청, 값 보존을 검증한다.
  Dispatch metadata: `Phase: 4a` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-4-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-4-1` · `Service tier: fast` · `Paths: backend/application/** [직원 owner], backend/interface/** [직원 owner], frontend/src/** [직원 폼], mobile/src/** [직원 폼], packages/shared/src/errors/**, backend/vendor/shared-agent/**, 관련 owner tests` · `Depends: Task 3.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 4b — 배정 업무 오류 전환

TL;DR: 배정 충돌·불가 상태를 확인된 사실로 전달하고 재요청 중복을 방지한다.

- **Task 4.2: 배정 충돌과 동시 변경 처리** (feature, high)
  - 배정 충돌·상태 제한·동시 요청을 원인 코드와 연결한다. 무조건적인 상태코드→NOT_APPLIED 변환은 금지한다.
  - 동시 요청에서 최종 배정 수와 오류 outcome을 대조하고 입력/기존 목록을 유지한다.
  Dispatch metadata: `Phase: 4b` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-4-2` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-4-2` · `Service tier: fast` · `Paths: backend/application/** [배정 owner], backend/interface/** [배정 owner], frontend/src/** [배정 UI], mobile/src/** [배정 UI], packages/shared/src/errors/**, backend/vendor/shared-agent/**, 관련 owner tests` · `Depends: Task 4.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 4c — 일정 업무 오류 전환

TL;DR: 일정 변경의 검증 실패와 저장 후 결과 미확인을 구분한다.

- **Task 4.3: 일정·기간 변경 오류 전환** (feature, high)
  - 기간·중복·수정 충돌 등 inventory의 일정 실패를 실제 저장 경계에 맞춰 전환한다.
  - 날짜/시간대·기존 업무 기간 계산을 보존하고 통신 유실 뒤 자동 변경 재실행이 없는지 확인한다.
  Dispatch metadata: `Phase: 4c` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-4-3` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-4-3` · `Service tier: fast` · `Paths: backend/application/** [일정 owner], backend/interface/** [일정 owner], frontend/src/** [일정 UI], mobile/src/** [일정 UI], packages/shared/src/errors/**, backend/vendor/shared-agent/**, 관련 owner tests` · `Depends: Task 4.2`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 5 — 계약·문서의 남은 웹 및 서버 경로

TL;DR: 모바일에서 보완한 안전장치를 기준으로 웹과 서버의 남은 계약·문서 오류를 검증한다.

- **Task 5.1: 계약 생성·완료·문서 오류의 남은 차이 해소** (feature, high)
  - 서명된 계약 수정, 생성·완료·삭제·문서 조회 실패를 각 별도 작은 subphase로 전환한다. 기존 SDK 검증과 server-owned fallbackHint를 재사용한다.
  - 성공/불명확/부분 성공/낡은 callback을 검증한다. 사용자 창 닫기나 timeout만으로 삭제·롤백·iframe 재발송을 허용하지 않는다.
  Dispatch metadata: `Phase: 5` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-5-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-5-1` · `Service tier: fast` · `Paths: frontend/src/components/app/contracts/**, frontend/src/** [문서 소비자], backend/interface/controllers/eformsign-doc.controller.ts, backend/application/usecases/eformsign-doc/**, mobile/src/app/(shell)/contracts/** [확정 gap만], packages/shared/src/errors/**, backend/vendor/shared-agent/**, 관련 owner tests` · `Depends: Task 4.3`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 6 — 나머지 경로 전수 완료

TL;DR: 앞 단계에 속하지 않는 모든 목록 행을 처리해 대표 기능 밖의 누락을 없앤다.

- **Task 6.1: 설정·템플릿·파일·알림 등 잔여 슬롯 처리** (feature, med)
  - 설정·템플릿·파일·알림과 추가로 발견된 기능을 inventory 행별 subphase로 나눈다. 동일 공유 카탈로그 writer는 순차 실행한다.
  - 조회 실패를 빈 성공으로 바꾸는 처리, raw message 비교, 토스트만 있는 mutation 오류를 확인한다. 사용 중인 모든 소비자와 예외/webhook까지 빠짐없이 상태를 지정한다.
  Dispatch metadata: `Phase: 6` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-6-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-6-1` · `Service tier: fast` · `Paths: docs/error-management-inventory.json의 아직 완료되지 않은 실제 owner files와 tests, packages/shared/src/errors/**, backend/vendor/shared-agent/**` · `Depends: Task 5.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 7 — 복합 작업과 비동기 회복 검증

TL;DR: 등록 성공 뒤 발송 실패처럼 일부 단계만 끝난 상황에서 중복 생성·발송 없이 회복하도록 확인한다.

- **Task 7.1: 고객 등록·발송·문서 job의 상태 전이 검증** (feature, high)
  - 실제 backend 등록→trigger/job owner를 추적하고 고객 성공/발송 실패, provider 접수/로컬 저장 실패, 동시 claim, timeout, 재시도 소진을 재현한다. 별도 화면을 임의로 원자 작업으로 합치지 않는다.
  - 처리된 단계와 남은 단계를 표시하고 read-only 상태 확인을 우선한다. 기존 durable marker와 멱등성 키를 유지하며 실패 대상 식별이 안 되는 부분 접수는 전체 재발송을 금지한다.
  Dispatch metadata: `Phase: 7` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-7-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-7-1` · `Service tier: fast` · `Paths: backend/application/services/** [고객 trigger와 document job owner], backend/domain/entities/message-log.entity.ts, backend/infrastructure/database/** [확정 owner], backend/test/** [해당 integration tests], frontend/src/** 및 mobile/src/** [실제 상태 소비자]` · `Depends: Task 6.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 8 — 기존 의존성 취약점 별도 정비

TL;DR: 오류 처리와 구분된 변경으로 기존 취약점과 배포 가능 조건을 정리한다. 범위 선택에 따라 실행되는 조건부 단계다.

- **Task 8.1: 취약 패키지의 최소 안전 업데이트** (config, high)
  - 사용자가 별도 정비를 포함하는 경우 advisory별 직접/간접 의존성과 최소 수정 버전을 확인하고 별도 PR로 처리한다. 무차별 major 업데이트나 감사 우회/허위 예외는 하지 않는다.
  - OSV 재검사와 영향 앱의 인증·문서/PDF·빌드 회귀를 검증한다. 수정 불가 항목은 근거와 처리 주체를 기록하고 배포 gate에서 판단한다.
  Dispatch metadata: `Phase: 8` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: network` · `Agent: luna_network_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-8-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-8-1` · `Service tier: fast` · `Paths: pnpm-lock.yaml, package.json, frontend/package.json, mobile/package.json, backend/package.json, packages/**/package.json [실제 취약 owner만]` · `Depends: Task 7.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 9 — 전체 회귀와 규격별 증거 마감

TL;DR: 전수 목록과 동작·보안·호환성 증거가 연결되었는지 확인하고 누적 변경을 검토한다.

- **Task 9.1: 전체 실패 시나리오와 누락 방지 검사** (test, high)
  - 미분류 0, 이행 어댑터 사용처 전수 파악, 알려진 원인의 500/빈 성공 변환 0을 검증한다. 새 원시 오류 유입은 승인된 inventory 예외 없이 통과하지 못하게 검사한다.
  - 아래 필수 시나리오와 정상 경로를 실행한다. 최신 exact HEAD CI 실패를 제품/테스트/환경으로 구분하고 해결한다. advisory 실패도 전체 검증 완료에서 숨기지 않는다.
  Dispatch metadata: `Phase: 9` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-9-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-9-1` · `Service tier: fast` · `Paths: docs/error-management-inventory.json, docs/error-management.md, packages/shared/src/**test*, backend/test/**, frontend/tests/**, mobile/tests/**, 기존 CI 검사 파일 [필요한 좁은 항목만]` · `Depends: Task 7.1, Task 8.1 [포함 시]`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 변경된 공유 계약·상태·보안 영향에 대해 정확한 통합 SHA의 독립 SOL SHIP를 확보한다. 이미 검토한 불변 부분은 범위·계약·증거가 동일할 때만 재사용한다.

## Phase 10 — 실제 연동과 운영 관측 검증

TL;DR: 허용된 테스트 계정·수신자에서 외부 접수·실제 저장·진단 연결의 증거를 확인한다.

- **Task 10.1: 실행 가능한 검증 절차와 증거 기록 양식 준비** (test, high)
  - 대상 환경/계정/지점/수신자·작업 건수·비용·중지/정리 조건과 read-only 확인 순서를 문서화한다. 실제 실행은 main이 별도 승인 후 수행한다.
  - BJJ-317의 실제 Sentry 수신에서 공개 code/outcome/request 참조, 중복 보고 0, 민감정보 비노출을 확인할 절차를 연결한다. 증거가 없으면 운영 검증을 완료 표시하지 않는다.
  Dispatch metadata: `Phase: 10` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-10-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-10-1` · `Service tier: fast` · `Paths: docs/error-management-live-verification.md, docs/error-management-inventory.json` · `Depends: Task 9.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. 문서 감사 이후 main이 실제 실행 승인과 테스트 대상을 확인한다. 승인된 외부 검증의 실제 접수/저장/정리 증거까지 있어야 운영 검증 gate를 닫는다. 미승인/미실행 상태는 완료가 아니다.

## Phase 11 — 배포 준비와 종료 증거

TL;DR: 정확한 배포 후보와 되돌리기 절차를 준비하고 승인된 환경 반영을 검증한다.

- **Task 11.1: 배포·복구 절차와 완료 보고 준비** (infra, high)
  - 후보 SHA/CI/단계별 감사/운영 검증 결과를 고정하고 backend와 호환 클라이언트의 배포 순서·되돌릴 이미지/SHA를 기록한다. 계획 문서만 준비하며 실제 배포는 아래 승인 gate에 둔다.
  - 부분 접수 재발송 금지 상태가 롤백으로 사라지지 않게 한다. 기록된 전수 완료 조건이 충족될 때만 BJJ-319 종료를 제안한다.
  Dispatch metadata: `Phase: 11` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 기능 단위 구현·회귀 분량, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind after prior phase close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-11-1` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-11-1` · `Service tier: fast` · `Paths: docs/error-management-rollout.md, docs/error-management-inventory.json, docs/error-management.md` · `Depends: Task 10.1`

**Phase close gate (not a task):** 공통 close 절차를 적용한다. main이 정확한 후보를 제시해 dev 병합 승인을 받는다. 대상 환경 배포는 별도 승인 후 진행하고 smoke/관측/복구 가능성을 확인한다. clean task worktree는 실제 병합 확인 뒤 정리한다.

### 필수 검증 시나리오와 완료 조건

| 시나리오 | 확인할 결과 |
| --- | --- |
| 필수값 두 개 이상 누락, enum/literal/union 누락 | 모든 오류가 안전한 코드/필드에 연결되고 입력과 초점이 유지됨 |
| HTML·빈 본문·잘못된 JSON·미등록 type/code/action | 화면이 깨지지 않고 변경 결과를 임의로 성공/미처리로 판단하지 않음 |
| 고객 등록 성공·발송 실패 | 고객 1건 보존, 실패 단계 구분, 전체 재실행으로 고객/문자 중복 없음 |
| provider 접수 후 응답 유실·결과 저장 실패 | UNKNOWN과 상태 확인, 자동 재발송 없음 |
| 부분 발송 | 부분 접수 상태 영속 보존, 전체 수신자 재발송 금지 |
| 동시 수정·동시 job claim·같은 멱등성 키 | 단일 소유권/실행, 사실과 일치하는 충돌/상태 응답 |
| 서명된 계약 수정·iframe 종료·낡은 callback | 기존 문서 이력 유지, 불명확한 결과 재실행 금지 |
| 다른 지점/권한 없는 요청 | 부수 효과 0, 고객 존재·개인정보·provider 진단 비노출 |
| 취소·인증 갱신·만료·네트워크 복구 | 기존 인증 정상 동작, 중첩 재시도와 중복 알림 없음 |
| 구버전 클라이언트·웹훅·정상 빈 조회 | 명시한 호환 응답 유지, 실패를 빈 성공으로 바꾸지 않음 |
| Sentry | 같은 예외 중복 capture 없음, 실제 요청 참조 연결, 토큰/쿠키/연락처/본문 비노출 |

**완료 판정:** 모든 inventory 행이 적용·검증 완료이거나 범위/규격 ID/사유/대체 안전장치/담당 이슈가 있는 명시적 승인 예외여야 한다. 예외가 규격 전체 준수를 막으면 '구현 범위 완료'와 '전체 규격 준수'를 구분한다. 미분류·실행하지 않은 필수 검사·미해결 감사 지적·승인받지 않은 실환경 작업을 완료로 바꾸지 않는다. 이행 어댑터는 지원 소비자와 webhook 호환 검증이 끝나기 전 제거하지 않는다.

### 리스크와 완화

| 리스크 | 가능성 | 영향 | 완화 |
| --- | --- | --- | --- |
| 상태 코드만으로 미처리로 판단해 중복 발송 | 중 | 상 | 부수 효과 소유 경계의 증거, durable marker, 동시성/유실 테스트 |
| 공통 카탈로그를 동시에 수정해 의미 충돌 | 상 | 중 | 수직 작업의 순차 phase, 코드/params 계약 검사, backend vendor 동일 소스 생성 |
| 오류 응답 변경으로 구버전·웹훅 깨짐 | 중 | 상 | 소비자 목록, 호환 테스트, 단계적 배포와 이행 어댑터 제거 gate |
| UI 테스트를 새 문구에만 맞춰 실제 회귀를 숨김 | 중 | 상 | 요청 횟수·저장 결과·입력 보존·권한·실제 표시 동작을 함께 검증 |
| 취약점 정비가 인증·PDF 의존성을 깨뜨림 | 중 | 상 | 별도 PR/최소 수정, 영향 기능 회귀와 독립 보안 검토 |
| 실환경 검증이 실제 고객에게 발송/서명 | 중 | 상 | 테스트 계정·지정 수신자·건수/비용·중지 조건과 별도 실행 승인 |
| 롤백으로 부분 접수 재발송 방지 장치가 사라짐 | 중 | 상 | 안전 marker를 해석하는 최소 버전 유지, 위험 재시도 중단 후 복구 |

### 배포·롤백·관측

1. 구현 및 테스트는 현재 전용 task branch에서 진행하고 정확한 후보 SHA를 고정한다. 운영 브랜치에 직접 쓰지 않는다.
2. 소비자가 신구 계약을 모두 읽을 수 있는 호환 릴리스를 먼저 확보하고 서버 전환을 적용한다. 의존성을 Phase 1의 소비자 표와 실제 배포 topology로 확인한다.
3. dev 병합과 대상 환경 배포는 각각 명시적 승인을 받는다. 테스트 환경에서 정상 흐름과 실패 흐름을 검증한 뒤 운영 반영을 판단한다.
4. 배포 전에 이전 안전 이미지/SHA와 실행 가능한 복구 절차를 기록한다. DB 변경을 기본으로 가정하지 않으며 필요 시 호환 migration·별도 복구 계획을 승인받는다.
5. 롤백은 외부에 이미 접수된 작업을 되돌렸다고 간주하지 않는다. 부분 접수/UNKNOWN marker를 해석 못 하는 버전으로 무조건 되돌리지 않고 위험 job을 멈춘 뒤 안전 버전으로 복구한다.
6. 공개 코드별 발생량, 미등록 fallback 비율, UNKNOWN/PARTIALLY_APPLIED, retry exhausted, 중복 capture, 폼 실패율을 관측한다. 실제 기준선과 경보 임계값·담당자는 운영 검증 시 확정하며 임의 수치를 발명하지 않는다.

### 계획 검토와 착수 조건

- 제품 구현은 이 계획 작성에서 시작하지 않는다.
- 공유 계약/상태 경계/외부 행동이 포함되어 계획은 독립 `sol_reviewer`, `gpt-5.6-sol`, `high` PLAN 검토를 받는다.
- Phase 1 이후 파일 목록과 작은 작업 분해가 확정되지 않은 항목을 구현 준비 완료라고 부르지 않는다. 모든 잔여 행을 구체화하고 계획을 갱신한 뒤 해당 phase를 dispatch한다.
- 최종 누적 검수는 단계 간 새 결합과 미검토 변경을 포함한다. 좁은 수정 SHIP로 전체 이슈 승인을 대체하지 않는다.

### 계획 검토 결과

독립 Sol PLAN 검토: APPROVE / HIGH. 최초 지적은 Phase 1 조사 범위에서 domain·provider adapter·persistence·automation 등이 빠질 수 있다는 점이었고, 모든 관련 source root와 발견/분류 수 대조를 추가해 해소했다. 현재 즉시 구체화 가능한 실행 범위는 Phase 1이며, 이후 슬롯은 inventory를 바탕으로 정확한 파일·작은 수직 작업·metadata를 확정하고 검토한 뒤 실행한다. 이 계획 승인 결과는 실제 발송·서명·병합·배포 승인이 아니다.

## 실행 구체화 — 2026-09-10 Phase 1 조사 결과

TL;DR: 모바일 회귀 수정은 완료했지만 전수 의미 검토는 진행 중이다. 전체 목록을 완료로 가장하지 않고, 현재 브랜치에서 직접 확인한 웹 문자 재발송 위험만 먼저 독립 작업으로 처리하도록 실행 순서를 구체화한다.

- 사용자 `진행` 지시로 실행을 시작했다. Phase 1 실제 기준은 계획만 추가된 `09cfd40a60f244e5bc6d34dc7ab392af7cefa7d9`이며, 제품 기준 `fc3b2633a5f0f346c5cc6d04cc2ecf256784551b`와 제품 차이는 없다.
- Task 1.2는 `6f38ab956193e06cd870107744077181e2b6ab65`에서 완료했다. 기존 P2002/내부 오류 응답을 유지하며 지속 UNKNOWN 요약, 입력 보존, 수정/반복 클릭 뒤 POST 1회, 화면 전체 민감정보 비노출을 검증했다. unit 7개와 통합 브라우저 7개, 타입/대상 lint/문구 drift gate 통과. 제품 코드는 불변이며 main SELF로 확인했다.
- Task 1.1은 **미완료**다. `docs/error-management-inventory.json`에 추적 소스 3,111개와 정규식 후보 owner 797개를 기록했다. 모든 소스 파일은 root별 조사 task에 연결했으며 미확인 상태를 보존한다. 후보가 없는 module/Prisma/service-record-ui 파일도 검토 대기 목록에서 제외하지 않는다. 의미 검토, 규격 ID, 소비자와 검증 증거는 아직 채워지지 않았으므로 미분류 0이나 전수 완료를 주장하지 않는다.
- 일부 조사 보고서의 줄 번호가 dev checkout과 일치해 채택하지 않았다. 아래 근거는 task worktree의 실제 HEAD와 절대 경로로 다시 확인했다.
- 확인된 위험: `frontend/src/components/app/messages/forms/TemplateSendForm.tsx`의 `sendMessages`는 모든 reject/비정상 성공을 실패 목록으로 합쳐 재발송을 안내한다. `handleSubmit`과 중복 발송 확인도 React state만으로 같은 tick의 재진입을 막지 않는다. 공급자 접수 여부를 모르는 결과에 재실행을 안내하는 현재 흐름이 수정 대상이다. 제공기록지 링크 발송은 별도 흐름이며 이번 작은 작업에 포함하지 않는다.

**순서 변경의 범위:** 아래 Phase 2a만 Task 1.1 전체 완료를 기다리는 기존 gate의 명시적 예외로 제안한다. 근거/소유 파일/검증이 확정된 SMS 소비자의 안전장치 수정이며, 전수 조사·나머지 phase의 선행 조건·전체 종료 기준은 유지한다. 이 변경은 독립 PLAN 검토 통과 뒤에만 실행한다. Task 1.1 또는 Phase 1 전체를 완료로 바꾸지 않는다. Phase 2의 서버 사전 조건 전환 및 모든 후속 광범위 슬롯은 별도 exact Paths와 검토 없이 dispatch하지 않는다.

## Phase 2a — 웹 문자 결과 불명 시 재발송 차단

TL;DR: 웹 문자 작성 화면에서 공급자 접수 여부가 불명확한 요청을 실패로 단정하지 않고, 입력과 상태 확인 안내를 유지하며 같은 화면의 재발송을 막는다. 이미 확정된 성공 수신자에게도 재전송하지 않는다.

- **Task 2.0: 웹 직접 문자 발송의 결과 판정과 재진입 보호** (feature, high)
  - 기존 공통 `normalizeApiError`/공개 표시 계약과 현재 인라인 feedback UI를 재사용한다. 요청별 성공은 resultCode 1, 정수 successCount 1, errorCount 0인 경우만 인정한다. malformed/transport/UNKNOWN/PARTIALLY_APPLIED는 상태 확인과 지속 잠금, 검증된 NOT_APPLIED만 수정 후 사용자 재제출을 허용한다. 상태코드나 영문 문구로 미처리를 추측하지 않는다.
  - 동기 ref로 제출→이력 조회→확인→발송 경로의 중복 진입을 막는다. 다중 수신자 중 성공·미처리·불명확 결과를 구분하고 불명확 수신자나 성공 수신자를 재발송하지 않는다. 입력/템플릿 변경으로 불명확 잠금이 사라지지 않게 한다. 제공기록지 링크 발송, 공유 catalog와 provider/job/retry 정책은 변경하지 않는다. `frontend/src/services/api.ts`의 sendSms만 원본 Axios/Problem Details를 보존하도록 바꾸고, 실제 API 경계 테스트로 NOT_APPLIED/UNKNOWN/PARTIALLY_APPLIED 전달을 확인한다. 다른 API 메서드는 변경하지 않는다. 잠금은 같은 mounted 화면의 수명에 한정하며 새로고침·재접속 후 안전성은 inventory의 멱등성/상태 확인 후속 범위로 남긴다.
  - 실제 렌더 테스트로 정상/잘못된 성공 응답, 409 레거시와 안전한 NOT_APPLIED, timeout/부분 접수, 동시 제출·확인, 수정 뒤 잠금, 혼합 수신자 결과·민감정보 비노출을 검증한다. API 테스트에서 원본 오류 객체와 응답 전달을 확인하고, 컴포넌트 테스트도 실제 경계가 전달하는 오류 형태를 사용한다. plain Error rejection은 UNKNOWN으로 잠긴다. 기존 정상/제공기록지 테스트를 유지한다. 목표 diff 400줄 이내이며 초과 예상 시 분리안을 보고한다.
  Dispatch metadata: `Phase: 2a` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 독립된 웹 소비자 구현과 렌더 회귀 분량; 유료 발송의 중복 실행 위험` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bind reviewed plan commit before dispatch; product baseline 6f38ab956193e06cd870107744077181e2b6ab65` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-2-0` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-2-0` · `Service tier: fast` · `Paths: frontend/src/components/app/messages/forms/TemplateSendForm.tsx, frontend/src/components/app/messages/forms/__tests__/TemplateSendForm.component.test.tsx, frontend/src/services/api.ts [sendSms만], frontend/src/services/__tests__/api.test.ts [sendSms만]` · `Depends: Task 1.2`

**착수 gate (not a task):** 현재 task worktree의 정확한 source/test 경로와 sendSms API 오류 보존 누락을 확인하고, 수정된 계획의 독립 PLAN APPROVE를 받은 뒤 그 계획을 포함한 정확한 시작 SHA를 dispatch에 결속한다.

**Phase close gate (not a task):** local tests → clean unit integration/cleanup → targeted integrated regression/types/UI architecture → exact base/SHA independent Sol SHIP. Backend/shared/runtime contracts remain unchanged; frontend sendSms 오류 전달 변경은 선언된 범위로 함께 검증한다. Any further required expansion returns to plan refinement. Task 1.1 remains open after this phase and full issue cannot close with its unverified backlog.

**Phase 2a 계획 검토 결과:** Sol PLAN APPROVE / HIGH. 최초 HIGH 지적은 frontend sendSms가 원본 오류를 plain Error로 바꿔 outcome을 잃는 문제였으며, API 소유 메서드와 경계 테스트까지 정확한 네 파일로 범위를 확장해 해소했다. mounted 화면 수명 제한과 전수 조사 미완료 상태를 유지한다. 실행 SHA는 이 승인 기록이 포함된 실제 commit을 dispatch 직전에 확인해 결속한다.

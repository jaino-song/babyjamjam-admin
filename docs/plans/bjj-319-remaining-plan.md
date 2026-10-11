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
  - **상태: 완료 (2026-09-14)** — 분류(배치 A~E) + 테스트 매핑에 이어 EM v1.0 규격 매핑 마감. 아래 "Task 1.1 규격 매핑 마감 실행 결과" 참조. 준수 선언이 아니며(EM-GOV-04) 후속 phase와 잠정 코드 정렬은 열려 있다.

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

## Phase 2a-R — 확인된 웹 SMS 작업 크기 조정

TL;DR: 기존 Task 2.0의 코드와 회귀를 잘라 중간 안전성을 완료로 표시하지 않고, 정확한 네 파일의 동일 발송 경로를 한 번에 검증한다. 기존 unit/base를 유지하고 이 문서의 독립 PLAN 승인 후 작업을 재개한다.

- **Task 2.0: 웹 직접 문자 발송 결과·재진입 보호와 회귀 완성** (feature, high)
  - 소유 파일과 성공/NOT_APPLIED/UNKNOWN/PARTIALLY_APPLIED 계약은 원 계획과 동일하다. 현재 제품 diff 약373줄, API 경계 테스트56줄이며 렌더 회귀가 추가로 필요하다. 정상·실패·혼합 결과와 비동기 제출은 동일 상태를 공유하므로, 중간 단계의 부분 수정에 안전장치 완료 판정을 내리지 않는다. 이 task만 650 changed lines 목표, Tier heavy로 명시적으로 조정한다. 650줄 초과 또는 추가 파일/공유 계약 영향이 필요하면 다시 범위와 분리안을 검토한다.
  - main 중간 확인 지적도 회귀로 포함한다: await 뒤 최신 입력 비교는 낡은 render closure가 아니라 최신 ref로 수행; StrictMode effect 재실행 시 mounted 상태 복원; 제공기록지 경로에는 새 guard/reset을 적용하지 않음; 전체 잠금 중 NOT_APPLIED 수신자 재시도를 안내하지 않음. 범위를 넓히는 새 요구가 아니라 기존 계획의 입력 변경·수명·제외 범위를 정확히 구현한다.
  - 현재 unit에서 구현과 모든 경계/렌더 테스트를 완료한 뒤 main 통합 검사와 fresh Sol FINAL을 받는다. 테스트 축소·skip·timeout 증가·UI 데이터 구조 재설계·별도 API/shared/provider 변경은 허용하지 않는다. Task 1.1 전수 조사와 전체 이슈 완료 gate는 열린 상태로 유지한다.
  Dispatch metadata: `Phase: 2a-R` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 실제 diff로 확인한 동일 발송 상태의 결합과 회귀 분량; 정확한 네 파일 유지` · `Tier: heavy` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: bab6abaa45032fc8454bb1bb2336bfe05827aa2a` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-remain-2-0` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-remain-2-0` · `Service tier: fast` · `Paths: frontend/src/components/app/messages/forms/TemplateSendForm.tsx, frontend/src/components/app/messages/forms/__tests__/TemplateSendForm.component.test.tsx, frontend/src/services/api.ts [sendSms만], frontend/src/services/__tests__/api.test.ts [sendSms만]` · `Depends: Task 1.2`

**착수 gate:** 원 계획 승인 SHA에 결속된 기존 unit을 보존하고 이 명시적 크기 조정의 PLAN 승인 후 재개한다. 크기 조정의 Sol PLAN APPROVE/HIGH 후 재개했고, 정확한 네 파일 649 changed lines로 구현했다. 구현 commit 091e6a38753e27a54aa5783c06c00263f4395d4a를 통합하고 clean unit worktree와 branch를 정리했다. 통합 검사 3 suites/24 tests, 타입, 대상 lint(기존 경고 1개), UI gate가 통과했다. 독립 FINAL 결과는 별도로 기록한다.

**Phase close gate:** owned tests/types/lint/UI gate → main 통합/clean unit 정리 → 정확한 통합 SHA/base/diff의 Sol FINAL SHIP. mounted 화면 수명 밖의 재발송 안전성, provider/job 전체 규격 준수, dev 병합·배포·실제 발송 승인을 주장하지 않는다.

## Phase 2a-C — 발송 방식 변경 시 이전 문자 작업 격리

TL;DR: 같은 화면에서 발송 방식을 변경하면 이전 문자 확인은 무효화하고, 이미 진행 중인 문자 결과는 다른 발송 화면을 덮어쓰지 않게 한다. 문자 화면으로 돌아오면 불확실한 결과 잠금과 안내를 유지한다.

- **Task 2.0C: 진행 중 문자 작업의 발송 방식 연결** (feature, high)
  - Sol FINAL FIX_REQUIRED/HIGH at 091e6a38753e27a54aa5783c06c00263f4395d4a의 단일 지적을 수정한다. SMS snapshot/current continuation에 mode와 전환 세대를 연결해 SMS→다른 방식→SMS 전환에서도 오래된 lookup/confirm을 살리지 않는다. 발송 전 확인은 폐기하되 이미 보낸 요청은 취소되었다고 추측하지 않는다.
  - 늦은 SMS 결과는 현재 다른 방식의 feedback/input/sending 상태를 덮어쓰지 않는다. UNKNOWN/PARTIAL은 SMS 전용 보관 상태에 잠금과 안내를 기록하고 복귀 때 표시한다. 진행 중 SMS와 다른 방식의 loading 소유권을 분리하되 제공기록지 API/요청 정책은 변경하지 않는다. 수신자 성공 제거와 새 입력 보존 계약을 유지한다.
  - history pending / confirmation pending / send pending 중 같은 mounted mode 전환 세 가지 회귀를 추가한다. 같은 templateId/name/message를 유지해 mode 차이만 검증하고, 왕복 전환에도 stale lookup/confirmation 재실행이 없고 늦은 응답이 다른 화면 상태를 지우지 않는지 확인한다. 기존 24 tests, types, lint, UI gate, diff check 후 fresh Sol correction FINAL을 받는다.
  Dispatch metadata: `Phase: 2a-C` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 확인된 동일 컴포넌트 비동기 상태 결합과 세 렌더 회귀; 유료 발송 재진입 위험` · `Tier: standard` · `Sandbox: local` · `Agent: luna_implementer` · `Model: gpt-5.6-luna` · `Effort: max` · `Phase starting integration commit: 091e6a38753e27a54aa5783c06c00263f4395d4a` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: codex/unit/bjj319-sms-mode-correction` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-sms-mode-correction` · `Service tier: fast` · `Paths: frontend/src/components/app/messages/forms/TemplateSendForm.tsx, frontend/src/components/app/messages/forms/__tests__/TemplateSendForm.component.test.tsx` · `Depends: Task 1.2`

**크기와 착수 gate:** 원 Phase2a-R는 649줄 상태로 FIX_REQUIRED이며 완료가 아니다. 이 별도 correction은 350 changed lines 이내를 목표/상한으로 승인 요청한다. 전체 Phase2a 누적 950줄 이내, 원래 네 파일 경계 안의 두 파일만 변경한다. 순차 correction이며 Task2.0의 미해결 지적을 닫기 위한 것이고 완료되지 않은 Task2.0에 의존하는 후속 기능이 아니다. 추가 범위/상한 초과는 재검토한다. 독립 PLAN 승인 후 고정 SHA에서 unit 생성/착수한다.

**위험과 대응:** 오래된 lookup이 새 lookup을 해제하는 경쟁은 전환 세대/작업 소유권으로 차단한다. 이미 전송한 요청을 무시해 재발송하는 위험은 결과 분류/잠금 보관을 유지해 막는다. 다른 방식의 draft/feedback 손실은 pending-mode 회귀로 검증한다. 실제 발송·DB·환경·의존성·API 변경은 없다.

**Phase close gate:** local verification → clean unit integration/cleanup → integrated verification → fresh Sol FINAL. 기존 FINAL은 원래 네 파일의 불변 부분을 이미 검토했으므로 correction은 단일 지적과 상태 연결부를 재검토하되, 전수조사/전체 BJJ319 SHIP으로 확대하지 않는다. Task1.1은 계속 미완료다. 배포는 별도 승인 gate이며 필요시 correction commit을 되돌린다.

**실측 크기 보정:** 구현 중 두 파일에서 242 additions +44 deletions =286 changed lines, 원 Phase2a 누적883줄을 확인해 일시 중지했다. 별도 loading 소유권, 전환 세대, 오래된 lookup 해제 방지와 세 회귀가 같은 상태에 결합되어 있다. 상한을 correction350/누적950으로 명시적으로 조정하며 파일·동작·검사 범위는 그대로다. 읽기 어려운 압축이나 회귀 축소는 하지 않는다. 독립 PLAN 재검토 후 재개한다.

**실행 및 검토 결과 (2026-09-10):** Phase2a-R의 649줄 구현 `091e6a387`은 첫 FINAL에서 mode 전환 HIGH가 발견됐다. Phase2a-C의 크기 보정은 Sol PLAN APPROVE/HIGH를 받았으며 `d05e43c70`으로 통합했다. 재검토에서 이전 지적은 해소됐지만 서비스 응답 폐기 HIGH와 렌더 중 ref 변경 MEDIUM이 발견됐다. main이 정확한 두 파일에서 직접 수정했다(Execution DIRECT: 추가된 응답 폐기 guard를 복원하고 확인된 ref 갱신 위치를 commit effect로 옮기는 국소 수정; Audit SOL: 유료 발송과 동시성 영향). main runtime model/effort는 세션 메타데이터로 확인되지 않아 unknown으로 기록하며 선택된 main을 변경하지 않았다.

최종 제품 `8cc87adf33553f9cdb86e494391eb8da00a7b2db`: correction base `091e6a387` 대비327 changed lines, 원 Phase2a base `bab6abaa4` 대비916 changed lines로 승인된350/950 상한 내다. 통합29 tests/3 suites·타입·대상lint·UI gate·diff check 통과, 기존 unused-import warning1개 유지. 추가 두 회귀는 수정 전 `d05e43c70`에서 실제 실패했다. fresh Sol FINAL SHIP/HIGH(base `d05e43c70` → `8cc87adf3`)에서 두 지적 모두 해소됐다. 기존 검토의 불변 범위와 단계별 correction 증거를 함께 보존하며 전체 BJJ-319 SHIP으로 확대하지 않는다. 두 unit worktree와 branch는 통합 직후 clean 상태로 정리했다. Task2.0은 해당 mounted 웹 SMS 범위에서 완료, Task1.1과 전체 이슈는 미완료다.

## Phase 2b — 문자 수신자 조회 실패의 처리 결과 전달

TL;DR: 고객·제공인력·직접 입력 번호가 현재 지점에 없으면 기존 404 상태와 공개 RESOURCE_NOT_FOUND 코드를 전달하고, 발송 전 중단된 NOT_APPLIED임을 명확히 한다. 이 세 경로에서는 사용자가 수정해 다시 제출할 수 있다.

- **Task 2.1a: 지점 내 수신자 없음 404 경로 전환** (feature, high)
  - `resolveSmsRecipients`의 !client/!employee/자유 번호 양쪽 조회 없음 세 throw만 `NotFoundException` + 기존 `smsProblemBody("RESOURCE_NOT_FOUND", "NOT_APPLIED")`로 바꾼다. 지역 SmsProblemCode 허용 목록에 기존 코드를 추가하며 공유 catalog/vendor/API 상태는 변경하지 않는다. 지점/고객/번호/원본 메시지를 공개 params로 노출하지 않는다. 실제 권한 조회 조건과 결과는 그대로다.
  - 기존 고객·자유 번호 검사 기대값을 구조화하고 제공인력 없음 검사 및 세 오류의 공통 HTTP mapper→응답→공유 normalizer 검증을 추가한다. 404/안전한 동일 공개 code·문구/NOT_APPLIED/retry NEVER, 실제 요청 ID 보존을 확인한다. 승인 서비스·message_log create/update·provider 호출이 모두 0임을 검증하고 일반 DB 조회 예외와 다른400경로를 이 미처리 분류로 바꾸지 않는다.
  - controller suite와 기존 problem-response/problem-http integration suites, backend 타입·대상 lint·diff check를 실행한다. 목표/상한200 changed lines이며 exact two-file 범위를 넘으면 멈춰 재검토한다. main 직접 수정은 위치와 계약이 확정된 세 throw 및 대응 회귀이고 별도 writer 전달 이점이 없기 때문이다. 공유 응답/outcome 의미이므로 독립 Sol FINAL은 필수다.
  Dispatch metadata: `Phase: 2b` · `Parallel group: none` · `Execution: DIRECT` · `Audit: SOL` · `Decision reason: 세 explicit404 분기와 기존 helper 재사용이 확정된 국소 변경; API outcome 영향은 독립 검토` · `Tier: standard` · `Sandbox: local` · `Agent: main (/root)` · `Model: unknown (main runtime ID not exposed; selected model retained)` · `Effort: unknown (main runtime metadata not exposed; retained)` · `Phase starting integration commit: 035afa078cf15e89bdf57e68032fae322931f6ad` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: korean-error-messages` · `Worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Service tier: unknown (main runtime not exposed)` · `Paths: backend/interface/controllers/message-delivery.controller.ts [three recipient404 branches + local SmsProblemCode], backend/test/interface/controllers/message-delivery.controller.spec.ts [recipient404 regressions]` · `Depends: Task 2.0`

**조사 gate의 한정 예외:** Task1.1 전수 검토 완료를 기다리는 원 gate에서 이 확인된 세404 분기만 추가 예외로 실행한다. `sendSms`88의 recipient 조회는 승인94·pending log115·provider 호출보다 앞서며, 해당 lookup은 DB 읽기를 수행하지만 쓰지는 않는다. Task1.1과 Task2.1 전체는 계속 미완료다. 다른400 입력 오류·지점 누락·ensureApproved 권한 오류·예약 날짜·provider/job/retry·DB/환경/의존성/공유 카탈로그·다른 UI는 이 task에 포함하지 않는다. 독립 PLAN 승인 후만 착수한다.

**리스크와 대응:** 404만 보고 미처리를 추정하는 위험은 정확한 선행-effect 경계 세 분기에만 적용해 막는다. 다른 지점 존재 노출은 tenant query를 보존하고 동일 code/빈 params를 검사한다. mapper가 계약을 거부해 UNKNOWN으로 바뀌는 위험은 실제 mapper/serializer/normalizer 연결 회귀로 확인한다. 기존 RESOURCE_NOT_FOUND 한영 문구를 그대로 재사용하므로 새 문구/번역/코드 승인이 필요하지 않다.

**Phase close gate:** main 정확한 diff와 집중 검사 → exact SHA/base fresh Sol FINAL SHIP → 조사/계획/PR/Linear 기록. 본 기록은 제어 규정 변경이 아니라 위 한정 실행 예외의 승인 이력이다. 배포/병합/실제 발송은 별도 승인 gate이며 오류 시 task commit을 되돌린다. main runtime ID/effort는 추측하지 않고 unknown으로 표기하며 subagent dispatch는 없다. 감사의 effective runtime은 sol_reviewer/gpt-5.6-sol/high다.

**실행 및 검토 결과 (2026-09-10):** 착수 전 Sol PLAN APPROVE/HIGH. 제품 commit `78f6e3bddf53fa878fcd78c72b9bbe7730440e2b`, base `035afa078cf15e89bdf57e68032fae322931f6ad`, 정확한 두 파일 83 changed lines로 완료했다. 수정 전 회귀 5개 실패를 확인했고 수정 후 controller/mapper/HTTP 3 suites 45 tests, backend 타입, 대상 lint, diff 검사를 통과했다. 세 분기 모두 한영 공개 응답, 요청 ID, no-store, 빈 params, NOT_APPLIED와 승인·로그 쓰기·공급자 호출 0회를 검증했다. 예상하지 못한 DB 조회 예외는 그대로 전파한다. fresh Sol FINAL SHIP/HIGH에서 지적 없음. Task2.1a만 완료이며 Task1.1·나머지400/권한 경로·전체 Task2.1·실환경 검증·병합·배포는 미완료다. 이 결과 기록은 main DIRECT/SELF로 원 증거와 대조했다.

## Phase 0 — 통합 기준 갱신 (dev 동기화) 실행 결과 (2026-09-10, OpenCode 세션)

TL;DR: 최신 dev를 통합 브랜치에 병합해 충돌 5개를 해소하고, 유료 문자 안전장치와 dev의 영수증·다운로드 기능이 양쪽 모두 보존됐음을 검증·감사했다.

- 런타임 바인딩 적응: 이 세션부터 실행은 OpenCode 런타임을 사용한다. 구현 위임 `worker` = `opencode-go/glm-5.3-flash`(variant 없음 → default), 독립 감사 `auditor` = `opencode-go/deepseek-flash`(max), 조사 `scout` = `opencode-go/deepseek-flash`. 기존 계획의 "독립 Sol PLAN 검토"는 이 런타임에 PLAN 전용 검토자가 없어 사용자 승인이 대체하고, 변경 후 감사는 auditor가 정확한 SHA로 수행한다. main variant는 세션에 노출되지 않아 unknown으로 기록한다.
- Task 0.1 (DIRECT, Audit SOL): `dev` `41e5420e7`을 `korean-error-messages` `091e02df9`에 병합해 merge commit `5f96f4ba82a5d911ed0c1b52c9443f1cfe152e19`를 만들었다. 예상한 5개 충돌(`TemplateSendForm.tsx`·동 테스트, `receipt-link.ts`, `mobile/.../contracts/page.tsx`, UI debt baseline)을 해소했다. 추가로 세 번째 delivery mode(receipt-link) 결합에 필요한 통합 수정 3건을 적용했다: `isReceiptLinkSending` 분리와 `receiptSendIdRef` 가드(모드별 sending 소유권 유지), SMS 전용 조건 6곳의 `!isPreparedLinkDelivery` 일반화(잠금·가드·스냅샷·duplicate 후보·버튼 비활성), prepared-link validation toast에 `getUserErrorMessage` 유지. 테스트 기대 문구 2건은 의도된 해요체 전환에 맞춰 정렬했다(테스트 약화 아님).
- UI debt baseline은 `--update --accept-growth`로 재앵커링했고, 변경 전/후 839 records/94 file+rule 그룹의 파일·규칙별 수량이 동일함을 대조해 위치 이동만 있음을 확인했다. gate exit 0.
- 검증: frontend 전체 220 suites/1,429 tests, mobile 전체 230 suites/1,477 tests 통과. frontend·mobile·backend 타입 검사 통과. 대상 lint는 양쪽 부모에 있던 기존 `MAX_LMS_TITLE_BYTES` unused 경고 1건과 기존 baseline 경고만 남았다. push CI에서 Backend CI·Backend Full Flow·Frontend CI·Mobile CI·Mobile Unit·Shared Contracts·Frontend Playwright Auth Lifecycle가 모두 success였다(이전 실패는 Playwright 설치 mirror flake였음이 확인됨). Security Review/OSV는 기존 취약점으로 계속 실패하며 Phase 8 조건부 범위다.
- 감사: read-only `auditor` FINAL SHIP/HIGH at `5f96f4ba8`, bases `091e02df9`/`41e5420e7`. blocking 없음. nonblocking 관찰: (N1) 선언한 충돌 5개 외 테스트 문구 정렬 1건 추가 — 병합 제품 문자열과 일치 확인, (N2) `receipt-links/send` route test의 500 응답 단언이 기존 브랜치 내용대로 regex — 병합이 완화한 것 아님, (N3/N4) 링크 모드 동일 tick 중복 클릭과 늦은 link-mode feedback의 기존 저위험 패턴 — 모두 병합 도입 아님.
- Phase 0 완료. Phase 1(구 2b-2)의 시작 commit은 `5f96f4ba82a5d911ed0c1b52c9443f1cfe152e19`로 결속한다. Task 1.1, 나머지 400/승인/예약 경로, 실환경 검증, dev 병합, 배포는 계속 미완료다.

## Phase 1 — 문자 사전 거절 8분기 전환 (구 2b-2) 실행 결과 (2026-09-10)

TL;DR: 수신자 8개 원시 400 분기를 `REQUEST_INVALID`/`NOT_APPLIED`로 전환·검증·감사했고, 예약 일시·발신 승인 오류는 명시적으로 남겨 Task 2.1 전체는 계속 미완료다.

- Task 1.1 (DELEGATE, Audit SOL): unit branch `unit/bjj319-sms-presend-400`(worktree `unit-bjj319-sms-presend-400`)를 시작 commit `5f87f8a32`에서 분기해 `worker`(opencode-go/glm-5.3-flash)로 실행했다. unit commit `5c6632133f699061348249daa0e5ae1b4d511087`: controller의 8개 분기를 `BadRequestException(smsProblemBody("REQUEST_INVALID","NOT_APPLIED"))`로 바꾸고 로컬 `SmsProblemCode`에 `REQUEST_INVALID`를 추가했다. 정확한 두 파일, 146 insertions.
- 회귀: red-first 11 failures(8 rejection + 3 public-response) → 구현 후 46/46 통과. 승인·message_log create/update·공급자 호출 0회, 양 로케일 공개 응답(application/problem+json, request id, 빈 params, NONE/NEVER), normalizer verified/NOT_APPLIED, 민감정보 비노출을 검증했다. 공유 카탈로그·vendor·예약/승인 경로는 변경하지 않았다. worker는 worktree 환경 준비를 위해 `prisma generate`만 실행했다(저장소 파일 변경 없음).
- 통합: `git merge --no-ff`로 통합 worktree에 병합해 `f91fabdba6b38e376460da174aca4c0e697e163a`(base `5f87f8a3`). 통합 검증: controller + problem-response 2 suites/54 tests, backend 타입, 대상 lint, diff check 통과.
- 감사: read-only `auditor` FINAL SHIP/HIGH at `f91fabdba`, base `5f87f8a32`(second parent `5c6632133`). blocking 없음. nonblocking: (N1) spec의 `privateValues` fixture 필드는 선언만 되고 사용되지 않음(실제 누출 단언은 공개 응답 테스트에 있음), (N2) 8개 중 3개만 전체 공개 응답 경로를 타지만 모두 같은 helper를 호출, (N3) non-null assertion은 근거 주석 있음. 잔여 리스크로 예약 일시·`ensureApproved` 레거시 경로 유지가 기록됐다.
- 기록: `docs/error-management-inventory.json`의 `sms-recipient-presend-legacy`를 migrated로 갱신(규격 ID·테스트·감사 증거 포함)하고 `presend_review_evidence` 상태를 현행화했으며 `docs/error-management.md`에 전환 요약을 추가했다. clean unit worktree와 branch는 병합·감사 후 정리한다.
- Phase 1 완료(2.1b 범위). Task 2.1 전체(예약 일시·승인 오류, 템플릿 조건), Task 1.1 전수 인벤토리, 실환경 검증, dev 병합, 배포는 계속 미완료다. 다음 단계는 계획의 Phase 2(Task 1.1 배치 A)이다.

## Task 1.1 배치 A (서버 인터페이스·도메인·공유) 실행 결과 (2026-09-10)

TL;DR: backend/interface·domain·prisma·packages/shared·service-record-ui 후보 70개를 의미 검토해 분류를 완료했고(미분류 0), 대부분의 컨트롤러 4xx가 아직 raw 예외이며 `parse-integer`/`parse-boolean` 공용 helper가 다수 라우트의 raw 400 소유자임을 확인했다.

- Phase 2(배치 A)는 read-only scout 4회로 실행했다: backend/interface 41(2회), backend/domain+prisma 20(1회), packages/shared+service-record-ui 9(1회). basis `84f3d8fbf69d08edc192c9ae2c0bbda992d5b5b6`, 전부 쓰기 없음.
- 결과: migrated 2(`money.vo`는 consumer-boundary, `problem-details.ts`는 캐노니컬 계약), legacy 38, approved-exception 1(`eformsign-webhook.controller.ts`, docs/error-management.md L13·pipe exemption), no-direct-error-boundary 29, unverified 0. 루트 대조: interface 41/41, domain 16/16, prisma 4/4, shared 7/7, service-record-ui 수동 2/2.
- 주요 확인: `mapHttpProblem`은 미등록 4xx에 `null`을 반환해 raw Nest message가 그대로 나가고, ≥500만 등록 코드로 재매핑된다(`problem-response.ts:37-43`). `backend/interface/parse-integer.ts`·`parse-boolean.ts`가 여러 컨트롤러 raw 400의 공용 소유자다. `route-utils.ts`는 BFF 정규화 경로는 계약을 쓰지만 `upstreamJsonErrorResponse`(비등록 `UPSTREAM_ERROR`)·`unauthorizedResponse`(raw English `{error}`)는 레거시로 남아 있다. `message-delivery.controller.ts`는 예약·승인 경로 때문에 legacy로 유지된다(Task 2.1).
- 기록: inventory `owners` 68건 + root review 2건 + source_manifest 70건 상태 갱신, `review_batches` A 요약 추가, 리뷰한 5개 root `semantic_review_status: reviewed-batch-a`. 규격 ID는 EM 카탈로그 미제공으로 `spec_mapping_status: pending`을 유지한다.
- 배치 A만 완료다. Task 1.1 전체(배치 B~E: backend/application·infrastructure·web·mobile·backend test·마감)와 후속 전환은 계속 미완료다. 다음은 배치 B(backend/application 150 + backend/infrastructure 69)다.

## Task 1.1 배치 B (서버 애플리케이션·인프라) 실행 결과 (2026-09-10)

TL;DR: backend/application 150 + backend/infrastructure 69 후보를 의미 검토해 분류를 완료했다(미분류 0). 애플리케이션 서비스·유스케이스 다수가 raw 4xx를 소유하고, 인프라는 대부분 경계/내부 위임으로 no-direct이며 `problem-response.ts`·`global-validation.pipe.ts`가 계약 경계로 확인됐다.

- 배치 B는 read-only scout 8회로 실행했다: application 30개씩 5회, infrastructure 23개씩 3회. basis `15fa652022085214f148d4ebec493f805e851da8`.
- 결과: migrated 19(경계 정규화 또는 컨트롤러 변환으로 등록 코드에 도달), legacy 87(raw 4xx/비등록 코드/레거시 result shape 소유), no-direct-error-boundary 113(잡/내부 위임/리포지토리 등), unverified 0. 루트 대조: application 150/150, infrastructure 69/69.
- 주요 판단 기록: `webhook.guard.ts`는 가드 인증 예외를 명시적으로 면제하는 문서가 없어 legacy로 유지(approved-exception 아님). `prisma-exception.filter.ts`의 Prisma 4xx raw body는 legacy 유지(전환 대상). plain Error만 있고 요청 경로에서 ≥500 정규화로만 노출되는 파일은 migrated로 분류(경계 근거 명시). agent capability provider류는 coordinator가 action 상태로 기록하므로 no-direct.
- 기록: inventory `owners` 219건 + source_manifest 219건 갱신, `review_batches` B 요약 추가, application/infrastructure `semantic_review_status: reviewed-batch-b`. 규격 ID는 여전히 `spec_mapping_status: pending`이다.
- 배치 B 완료. 남은 Task 1.1 범위는 frontend/src 272 + mobile/src 238(배치 C·D)과 테스트 매핑·전수 대조(배치 E)다. 배치 C·D부터는 컨텍스트 절약을 위해 launcher 기반 scout 병렬 실행과 파일 기반 보고(`opencode-task.sh --agent scout --out`)를 사용하고, main은 스크립트로 inventory에 반영한 뒤 표본 검증한다(방법 변경 기록).

## Task 1.1 배치 C (웹) 실행 결과 (2026-09-10)

TL;DR: frontend/src 후보 272개를 scout 10청크(launcher 실행, 파일 보고)로 검토해 분류를 완료했다(미분류 0). BFF app/api 라우트 다수가 raw `{error}` 본문을 직접 작성하는 legacy로 확인됐다.

- 결과: legacy 184, no-direct-error-boundary 82, migrated 6. migrated는 `ClientFormDialog.tsx`(정식 계약 표시)와 공통 `errorResponse`만 사용하는 BFF 라우트 일부다. `TemplateSendForm.tsx`는 SMS 경로가 계약 위에 있으나 receipt-link 등 잔여 경로 때문에 legacy로 유지된다.
- 방법: 10개 brief(`fe01`~`fe10`)를 스크립트로 생성하고 `opencode-task.sh --agent scout`로 병렬 실행(2파), `<label>.final.txt`를 스크립트로 파싱해 inventory에 반영. scout 형식 오류 8건(JS `||` 스니펫 충돌)은 파서를 구조적 분할로 보강해 해결했다.
- 기록: `owners` 272건 + source_manifest 272건, frontend/src `semantic_review_status: reviewed-batch-c`, `review_batches` C 요약. 규격 ID는 계속 pending이다.
- 표본 검증: `ClientFormDialog` migrated, `services/api.ts` no-direct, `auth/login` route legacy를 코드와 대조 확인. 배치 D(모바일)와 배치 E(테스트 매핑·전수 대조)만 남았다.

## Task 1.1 배치 D (모바일) 실행 결과 (2026-09-10)

TL;DR: mobile/src 후보 238개를 scout 9청크로 검토해 분류를 완료했고, 이로써 `owners` 후보 797개 전부가 분류됐다(미분류 0).

- 결과: legacy 152, no-direct-error-boundary 67, migrated 18(고객 등록 마법사·메시지 작성·고객/템플릿 조회 훅 등 기존 전환분), approved-exception 1(`mobile/src/lib/api/receipt-auth.ts` — no-login 영수증 토큰 흐름의 문서화된 예외). `usePushNotification`은 raw English 문자열 노출로 legacy다.
- 방법: 배치 C와 동일한 launcher scout 9청크(2파) + 파일 기반 보고 + 스크립트 반영.
- 기록: `owners` 238건 + source_manifest 238건, mobile/src `semantic_review_status: reviewed-batch-d`. 이제 `owners` 797/797 = A 68 + B 219 + C 272 + D 238로 미분류 0이다.
- 남은 Task 1.1 범위는 배치 E(백엔드/웹/모바일 테스트 매핑, root 대조, 완료 기록)다.

## Task 1.1 배치 E (테스트 매핑·전수 대조) 실행 결과 (2026-09-10)

TL;DR: 후보 797개 전부의 분류가 끝났고(미분류 0), 테스트 788개 중 521개를 후보 owner에 매핑했으며(483/797 owner가 테스트 증거 확보), zero-regex 공유 후보 6개를 검토해 2 migrated·4 legacy로 마감했다.

- 전수 분류: migrated 45, legacy 460, no-direct-error-boundary 290, approved-exception 2. 루트별: application 150, domain 16, infrastructure 69, interface 41, prisma 4, frontend/src 272, mobile/src 238, shared 7. 배치 A 70 + B 219 + C 272 + D 238 + zero-regex 6 = 805 검토 항목(owner 797 + 비후보 6 + 수동 2).
- 테스트 매핑: backend/frontend/mobile 테스트 788개 중 521개를 owner 483곳에 연결했다. 나머지는 후보 밖 파일(application utils/domain 헬퍼 등)·e2e·공유 스위트이거나 모호한 basename이다. 각 owner 행의 `test_evidence`에 반영했고, 커버리지 공백은 그대로 기록했다.
- zero-regex: `problem-presentation.ts`·`safe-api-error-message.ts`는 migrated, `auth/register.ts`·`auth/reset-password-errors.ts`·`korean-error-messages.ts`·`file-storage/capabilities.ts`는 legacy로 분류해 `shared_source_review.reviewed_zero_regex_candidates`에 기록했다.
- 상태 갱신: `status: candidate-review-complete; spec-mapping-pending`, `semantic_inventory_complete: false`(EM 규격 ID 매핑 전), test root 3곳 `mapped-batch-e`, backend/module `reviewed-no-direct-error-boundary`, `review_batches` E 요약.
- Task 1.1 판정: 후보 의미 검토·분류·테스트 매핑은 완료했지만, 계획의 완료 조건에 포함된 규격 ID 매핑이 EM 카탈로그 미제공으로 남아 있어 **Task 1.1 전체를 완료로 표시하지 않는다**. 카탈로그가 제공되면 규격 매핑을 마감한다.
- 이 결과로 후속 규모가 확정됐다: legacy 460개 owner가 실제 전환 대상이고, 그중 BFF 라우트(웹 184·모바일 152 legacy 다수 포함)와 서버 컨트롤러/서비스가 주요 덩어리다. 이슈 계획의 Phase 3~7 분해는 이 분류를 근거로 정확한 Paths·task를 바인딩해야 한다.

## Phase 3a — 고객 생성/수정 사전 검증 오류의 구조화 (바인딩 수정, 2026-09-10)

TL;DR: 공개 계약은 detail/field-error 문구를 카탈로그 정적 문구로 정규화하므로, 구체 원인 문구 보존을 위해 CLIENT_* 공개 코드 6개를 잠정 추가(사용자 결정)하고 두 subphase로 나눠 실행한다. 3.1a-1은 공유 카탈로그·vendor·문서 앵커, 3.1a-2는 백엔드 검증 변환이다.

- **설계 수정 기록:** 최초 바인딩은 `VALIDATION_FAILED`+errors[]만 가정했으나, `parseProblemDetails`/`sanitizedFieldError`가 서버 detail을 카탈로그 문구로 대체함을 실행 중 확인했다. 사용자가 "CLIENT_* 신규 코드를 잠정 정의하고 진행"을 선택해 아래 6개 코드로 확정한다. EM 카탈로그 도착 시 이름·문구 재정렬이 필요할 수 있다.

- **Task 3.1a-1: CLIENT_* 잠정 공개 코드 추가** (feature, high)
  - `packages/shared/src/errors/problem-details.ts`에 상태 400 코드 6개를 추가한다: `CLIENT_SERVICE_PERIOD_INVALID`(시작일>종료일), `CLIENT_SERVICE_PERIOD_UNCOMPUTABLE`(기간 계산 불가·미지원 연도, 영문 기술 메시지 노출 제거), `CLIENT_DURATION_OUT_OF_RANGE`(횟수 범위 밖, 동적 N은 v1에서 표현 불가로 기록), `CLIENT_DURATION_NEEDS_SERVICE_PERIOD`(시작·종료일 필요), `CLIENT_SERVICE_STATUS_INVALID`(enum), `CLIENT_AREA_UNAVAILABLE`(지역). ko/en title/detail을 기존 카탈로그 스타일로 작성하고, 잠정 코드 주석을 남긴다.
  - `docs/error-management.md` 공개 코드 앵커 6개(kebab)와 `problem-details.test.ts` 기대 목록·왕복 검증을 갱신하고, `pnpm --filter ./packages/shared build:backend-runtime`로 `backend/vendor/shared-agent` 생성물을 재생성한다(생성물 직접 편집 금지).
  - Dispatch metadata: `Phase: 3a-1` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 공개 식별자·카탈로그 문구·type URI 추가; vendor 재생성` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: feb32d0108b4d14a1515198c94d346ee38a6aecf` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-client-codes` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-client-codes` · `Service tier: default` · `Paths: packages/shared/src/errors/problem-details.ts, packages/shared/src/errors/problem-details.test.ts, docs/error-management.md, backend/vendor/shared-agent/errors/** [생성물]` · `Depends: Task 1.1`

- **Task 3.1a-2: 고객 write 사전 검증의 등록 코드 전환** (feature, high)
  - `client-write-validation.ts`를 전환한다: 연락처·날짜 형식→`VALIDATION_FAILED`+errors(INVALID_FORMAT), 기간 순서→`CLIENT_SERVICE_PERIOD_INVALID`+`/endDate`, 계산 불가→`CLIENT_SERVICE_PERIOD_UNCOMPUTABLE`+`/endDate`, 횟수 범위→`CLIENT_DURATION_OUT_OF_RANGE`+`/duration`, 시작·종료일 필요→`CLIENT_DURATION_NEEDS_SERVICE_PERIOD`+`/duration`, 상태→`CLIENT_SERVICE_STATUS_INVALID`+`/serviceStatus`, 지역→`CLIENT_AREA_UNAVAILABLE`+`/areaId`. `parseClientDate(value, field)`로 필드를 전달(23개 호출부), `client.service.ts` update의 필수 필드·duration 직접 throw 3곳도 같은 헬퍼로 전환한다. provider의 오류 리더(`assertAgentClientPhone`·`validationErrorMessage`)는 구조화 body의 errors[0].detail을 읽도록 갱신한다.
  - 제외: 중복 연락처(clientId 포함, 3.1b), 자동 등록 비활성 409, update 404(별도 단위), BFF·UI 변경.
  - 검증: 기존 spec 3파일 갱신 + 대표 오류의 `mapHttpProblem→normalizeApiError` 왕복, red-first 실패 기록, 타입·lint·diff check.
  - Dispatch metadata: `Phase: 3a-2` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 다중 파일·테스트 전환, 공개 응답 의미 변경` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: bind after Task 3.1a-1 close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-client-write-validation` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-client-write-validation` · `Service tier: default` · `Paths: backend/application/usecases/client/client-write-validation.ts, backend/application/services/client.service.ts [사전 검증 throw만], backend/application/usecases/client/client-write-agent-capabilities.provider.ts [오류 리더·parseClientDate 호출부], backend/application/usecases/client/client-write-validation.spec.ts, backend/test/services/client.service.spec.ts, backend/application/usecases/client/client-write-agent-capabilities.provider.spec.ts` · `Depends: Task 3.1a-1`
  - **Phase close gate:** 각 subphase는 unit 검증 → 통합 → 영향 통합 검증 → exact SHA/base `auditor` FINAL SHIP → inventory 증거 갱신·기록 → clean unit worktree/branch 정리. 3.1a 완료 후에도 Task 3.1 전체(중복·수정 충돌·삭제 제한)와 전체 이슈는 미완료다.

**Task 3.1a-1 실행 결과 (2026-09-10):** worker(launcher) unit `11459dbf3`(branch `unit/bjj319-client-codes`) → 통합 `e81091cf253ff820d494384f781a58ab87d20ded`, 5 files/203 insertions. red-first 12 failures → problem-details 47/47 통과, 통합에서 `build:backend-runtime` 재실행 시 vendor 무변경(커밋된 생성물이 fresh tsc 출력과 동일), backend 타입 통과. lint는 `packages/shared`에 eslint 설정이 없어 실행 불가(기존 상태, 기록). auditor FINAL SHIP/HIGH at `e81091cf2`, base `8a7556138`; blocking 없음. nonblocking: 인벤토리 증거 갱신(이 기록에서 처리: `problem-details.ts` public_codes 6개 추가, `vendor_parity` product_sha/comparison 갱신), CLIENT_* 이름·문구는 EM 카탈로그 도착 시 재정렬 필요, 문서 앵커 자동 검사 없음, unit worktree 정리. 3.1a-2(백엔드 전환)는 다음 단계다.

**Task 3.1a-2 실행 결과 (2026-09-10):** worker(launcher) unit `2a5c30255` + main DIRECT 보정 `33c20c5f4`(잠금 경로 duration throw 2곳) → 통합 `5f1d100e5`, 5 files/371 changed lines(≤450). 고객 create/update 사전 검증을 `VALIDATION_FAILED`/`CLIENT_*` 문제 본문으로 전환했고, provider 오류 리더도 errors[0].detail을 읽도록 갱신했다. 통합 검증: 영향 5 suites 302 tests, backend 타입·eslint·diff check 통과.
- **감사 FIX_REQUIRED → 보정:** 1차 auditor가 ①`client-invariants.spec.ts`의 기존 `.message` 단언 파손(전체 suite red) ②AI-chat 도구 실패 텍스트가 "Bad Request Exception"으로 후퇴하는 문제를 blocking으로 지적했다. `clientProblemBody`에 in-process 호환 `message` 키(HTTP 매퍼가 전송하지 않음)를 추가하고, 기존 테스트를 구조화 단언으로 갱신하며, AI-chat 리더 체인 회귀 테스트를 추가했다. **전체 backend unit suite 353 suites / 4,992 passed / 37 skipped / 0 failed** 후 fresh correction audit **SHIP/HIGH at `282065ab3`** (base `5f1d100e5`).
- **환경 교훈(기록):** pnpm은 `file:vendor/shared-agent`를 설치 시점에 복사하므로, vendor 변경을 머지한 뒤 통합 worktree에서 `pnpm install`로 설치본을 갱신하지 않으면 stale 타입으로 검증이 실패한다(저장소 결함 아님, CI는 fresh install이라 무관).
- 기록: inventory `verified_findings`에 `client-presend-validation-contract`(partial scope 명시) 추가, 관련 owner 3행 evidence 갱신. clean unit worktree/branch 정리.
- 제외·잔여: 중복 연락처(3.1b), 수정 충돌·삭제 제한, update 404, 자동 등록 409, BFF/UI는 다음 단위다.

## dev 동기화 병합 실행 결과 (2026-09-11)

TL;DR: dev가 전진해 PR #657이 CONFLICTING이 되면서 pull_request CI 실행이 멈췄다. dev(스켈레톤·영수증 서명 게이트 등)를 병합해 충돌 5개를 해소하고, dev의 브랜치 컨텍스트 가드와 우리 오류 처리 안전장치를 결합했으며, 최종 SHA에서 전 워크플로가 green이다.

- 배경: GitHub Actions의 pull_request 실행은 병합 가능한 head에만 생성되므로, 충돌 상태는 "CI 없음"으로 나타난다. 병합으로 해소했다.
- dev 병합 `d28b43651`(first parent `322e01374`, second parent dev `a4730c192`), 충돌 해소:
  - `TemplateSendForm.tsx`: 우리 SMS outcome 잠금/수락 수신자 제외/모드별 sending/스냅샷 + dev의 `capturedBranchId`·`rejectBranchContextChange`·`templateReady`/`branchContextReady` 게이트 결합, `sendSms`에 `expectedBranchId` 전달.
  - `services/api.ts`: 원본 Axios/problem 오류 보존(plain Error 래핑 제거) + `expectedBranchId` 지원.
  - `receipt-link.ts`(웹·모바일 동형): dev가 제거한 만료 키(`missing_end_date`/`service_period_expired`) 삭제, `contract_not_signed` 유지, 기존 전환 문구 유지.
  - `SystemTemplateEditor.tsx`: dev의 forwardRef 구조 + 우리 전환 오류 문구. `ui-debt-baseline.json`은 gate 재앵커링(92 groups/822 records 수량 보존).
  - dev가 추가한 BFF 테스트 2건은 전환된 안전 한국어 응답(상태·코드 보존)에 맞춰 갱신.
- 검증: frontend 229 suites/1,468, mobile 232 suites/1,495, backend 타입·대상 suites, UI gate exit 0. backend 전체의 2 실패는 ① `eformsign-document-job.controller`(병렬 flake, 단독 통과) ② `receipt-pdf-verifier` pdfjs 추출 케이스(dev worktree `a4730c192`에서도 동일 실패 = 로컬 환경 한정; CI rasterizer 단계 통과)로 판정했다.
- CI: `d28b43651`에서 Backend CI만 `agent-manifest.json` digest stale로 실패 → `5eb65c4a3`에서 생성기로 재생성(2줄). 이후 `b313c25fe`에서 전 워크플로 success(Backend/Frontend/Mobile/Mobile Unit/Full Flow/Shared Contracts/Auth Lifecycle/Security Review/AI capability impact).
- 감사: dev-sync merge auditor **SHIP/HIGH at `5eb65c4a3`**(base `322e01374`/dev `a4730c192`), nonblocking 2건. `submissionGuardRef` 미해제(브랜치/템플릿 거절 경로)는 `b313c25fe`에서 보정(guard reset 2곳 + dead import 제거) 후 fresh correction audit **SHIP/HIGH**. 복구 회귀 테스트 부재는 carried nonblocking으로 기록한다.
- 참고: Phase 3a-2의 구현 SHA `282065ab3`는 이 병합 이전 커밋이며, 병합 이후의 최종 검증 기준은 `b313c25fe`다. dev 병합·배포·실제 발송은 여전히 별도 승인이다.

## Phase 3.1b — 중복 연락처·삭제 제한·수정 404 전환 (바인딩, 2026-09-11)

TL;DR: 남은 고객 실패 조건 3종(중복 연락처 409, 연결 데이터로 인한 삭제 제한 409, 수정/삭제 대상 없음 404)을 공개 계약으로 전환한다. 중복 연락처의 `clientId` 페이로드는 공개 계약에 실을 수 없으므로, 소비자(웹·모바일 계약 폼)가 `code`로 중복을 식별하도록 바꾸고 구버전 호환 fallback을 유지한다.

- **Task 3.1b-1: `CLIENT_RETENTION_BLOCKED`·`CLIENT_PHONE_ALREADY_REGISTERED` 공개 코드 추가** (feature, high)
  - 상태 409 코드 2개를 잠정 추가한다: `CLIENT_RETENTION_BLOCKED`("연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없어요."), `CLIENT_PHONE_ALREADY_REGISTERED`("같은 전화번호의 고객이 이미 등록되어 있어요."). ko/en title/detail, 테스트·문서 앵커·vendor 재생성을 3.1a-1과 동일 절차로 수행한다.
  - Dispatch metadata: `Phase: 3.1b-1` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 공개 식별자·카탈로그 문구 추가` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: bind after 3.1a close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-client-conflict-codes` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-client-conflict-codes` · `Service tier: default` · `Paths: packages/shared/src/errors/problem-details.ts, packages/shared/src/errors/problem-details.test.ts, docs/error-management.md, backend/vendor/shared-agent/errors/**` · `Depends: Task 3.1a`

- **Task 3.1b-2: 중복·삭제 제한·404 전환과 계약 폼 식별자 전환** (feature, high)
  - 백엔드: `delete-client.usecase.ts`의 두 `CLIENT_RETENTION_BLOCKED` throw와 대상 없음 NotFound 2곳, `client.service.ts` update의 P2002 409·대상 없음 NotFound, create의 중복 연락처 conflict(및 `assertPhoneAvailable`)를 문제 본문으로 바꾼다(중복은 `/phone` errors 포함, 삭제 제한·404는 코드 본문만). 삭제 제한·404의 기존 `(id: …)` 노출을 제거한다.
  - UI: 웹 `ContractCreationForm.tsx`·모바일 `(shell)/contracts/new/page.tsx`의 409 분기를 `code === "CLIENT_PHONE_ALREADY_REGISTERED"`(구버전 `clientId` fallback 유지)로 바꾼다. `reuseExistingClient: true` 재시도 흐름·확인 문구는 유지한다.
  - 검증: 백엔드 spec(usecase/service/validation/provider)과 웹·모바일 계약 폼/BFF 스위트 갱신, 대표 삭제 제한·중복 오류의 `mapHttpProblem→normalizeApiError` 왕복, red-first 기록. 삭제 제한의 웹 BFF allowlist는 코드 문자열이 동일해 그대로 동작함을 확인한다.
  - Dispatch metadata: `Phase: 3.1b-2` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 다중 파일·공개 응답 의미 변경과 UI 식별자 전환 결합(분리 배포 시 계약 자동 등록 회귀)` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: bind after 3.1b-1 close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-client-remaining` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-client-remaining` · `Service tier: default` · `Paths: backend/application/usecases/client/delete-client.usecase.ts, backend/application/services/client.service.ts [중복·삭제·404 throw만], backend/application/usecases/client/client-write-validation.ts [assertPhoneAvailable], frontend/src/components/app/contracts/ContractCreationForm.tsx, mobile/src/app/(shell)/contracts/new/page.tsx, 관련 owner tests(backend/test/usecases/client/**, backend/test/services/client.service.spec.ts, frontend/mobile 계약 폼·BFF 테스트)` · `Depends: Task 3.1b-1`
  - **Phase close gate:** 각 subphase는 unit 검증 → 통합 → 영향 통합 검증 → exact SHA/base `auditor` FINAL SHIP → inventory·계획 기록 → clean unit worktree/branch 정리. 중복 연락처의 `clientId` 제거는 구버전 클라이언트가 새 서버와 함께 동작하는 범위(코드 fallback)임을 기록하며, Task 3.1 전체 종료는 EM 규격 매핑과 실환경 검증 전에는 선언하지 않는다.

**Task 3.1b-1 실행 결과 (2026-09-11):** worker unit `0f39fdb55` → 통합 `ad75bd31b`(5 files/74 insertions). problem-details 51/51, vendor 재실행 무변경, backend 타입 통과. auditor FINAL **SHIP** (confidence MEDIUM; blocking 0).
- 감사의 중요 관찰: `CLIENT_RETENTION_BLOCKED`가 카탈로그에 등록되는 순간, 이미 그 코드를 던지던 `delete-client.usecase.ts`의 409가 전역 problem 필터의 catalog-membership 검사를 통해 자동으로 problem+json으로 전환된다. 소비자 파손은 발견되지 않았다(웹 BFF는 코드 allowlist로 메시지를 덮어씀). 3.1b-2는 이 부분을 "재구현"이 아니라 "검증·보강(outcome/recovery 명시)"해야 한다.
- 3.1b-2 필수 추가 발견: 웹/모바일 계약 폼의 409 중복 분기가 `clientId`가 아니라 `code === "CLIENT_PHONE_ALREADY_REGISTERED"`로 동작하려면, 공유 `getClientConflictPayload` 경로가 `code`를 버리는 문제(`frontend/src/app/api/clients/route.ts`, `mobile/.../clients/route.ts`, `packages/shared/src/errors/api-error-message.ts`)를 함께 처리해야 한다(문제 본문 passthrough로 자연 해결되는지 검증 포함).
- 기록: inventory `problem-details.ts` public_codes 2개 추가, `vendor_parity` 갱신(자동 전환 관찰 포함). unit worktree/branch 정리.

**Task 3.1b-2 실행 결과 (2026-09-11):** worker unit `1250c28dd` → 통합 `03646f8d5`(15 files, +695/−68 — 제품 코드 약 90줄, 나머지는 지시된 테스트 매트릭스라 450줄 가이드를 초과 보고). backend 전체 354 suites/5,020 passed/44 skipped/0 failed, frontend 231/1,473, mobile 232/1,499, 타입 검사 통과. auditor FINAL **SHIP/HIGH**(base `48d7a73d6`).
- 전환: 중복 연락처 3곳 → `CLIENT_PHONE_ALREADY_REGISTERED`(+`/phone` errors, `clientId` 페이로드 제거, 서버 reuse 분기 불변), 삭제 제한 2곳 → `CLIENT_RETENTION_BLOCKED`에 outcome/recovery 보강(상수·웹 BFF allowlist 유지), 열거한 404 2곳 + delete usecase 2곳 → `RESOURCE_NOT_FOUND`/NOT_APPLIED(id 노출 제거). 웹·모바일 계약 폼은 `code`로 중복 식별(구버전 `clientId` fallback 유지).
- worker 발견: `sendProblemResponse`가 legacy `message` 별칭을 내보내므로 기존 `getClientConflictPayload` 브리지가 problem 본문을 가로채 `code`를 버렸다. 두 BFF 라우트에 좁은 게이트를 추가해 problem `code` 보유 페이로드는 계약 보존 passthrough로 보냈다(구형 본문은 기존 브리지 유지). audit이 소비자 전수 확인 후 blocking 없음으로 판정.
- **deferred 404 목록(명시 기록):** `client.service.ts`의 나머지 client-target NotFound 8곳(~L1940/1943/1953/2005/2101/2192/2237/2250: update 트랜잭션·최종 재조회, terminateService, requestReplacement ×3, completeReplacement precheck)과 `update-client.usecase.ts:53`. 현재는 Nest 기본 404 + `(id: N)` 노출이며 Task 3.1 종료 전 추적 잔여다.
- carried nonblocking(auditor): (N1) 웹 BFF의 legacy P2002 shape 변경에 대한 전용 라우트 테스트 부재(모바일은 있음), (N2) 모바일 `hasPrismaErrorCode` 분기 도달 불가(무해), (N3) `hasUpstreamProblemCode` 헬퍼 중복(공유화 제안), (N4) retention 경계 테스트 ko만, (N5) 본 기록으로 해소.
- 환경 교훈(재확인): vendor 변경(3.1b-1) 머지 후 통합 worktree에서 `pnpm install`로 `file:` 의존 복사본을 갱신하지 않으면 spec 로드가 실패한다.
- Task 3.1 진행 상태: 3.1a(사전 검증), 3.1b(중복·삭제 제한·열거 404) 완료. deferred 404·BFF 로컬 라우트·잔여 legacy는 후속 단위다. EM 규격 매핑은 계속 pending.

**3.1b-2 마감 보정 (2026-09-11):** Mobile CI가 UI architecture gate에서 실패해(모바일 계약 폼 변경으로 기존 위반 앵커가 이동, 21 growth/21 shrink, net 0) `ui-debt-baseline.json`을 재앵커링했다(`0aeba3c3e`, 92 groups/822 records 수량 보존). 이어 Shared Contracts CI가 기존 flaky 테스트(`route-utils.test.ts`의 body-leak 단언이 random requestId에 "42"가 포함되면 실패)로 실패해, requestId를 제외한 뒤 단언하도록 결정적으로 수정했다(`3bbde7fb5`; shared 280 jest + 76 node green). 최종 SHA `3bbde7fb5`에서 **전 워크플로 success**, PR #657은 `MERGEABLE/CLEAN`이다.

## Phase 4a — 직원 오류 전환 (바인딩, 2026-09-11)

TL;DR: 직원 도메인의 남은 서버 실패 조건(전화 형식, 중복 연락처, 진행 중 배정으로 인한 삭제 제한, 직원 404 5곳)을 공개 계약으로 전환한다. 3.1과 동일한 잠정 코드 패턴을 사용하고, BFF/UI는 후속 단위(4a-2)로 분리한다.

- **Task 4a-1: 직원 검증·충돌·404 전환** (feature, high)
  - 카탈로그에 잠정 코드 2개를 추가한다: `EMPLOYEE_PHONE_ALREADY_REGISTERED`(409, "같은 전화번호의 관리사가 이미 등록되어 있어요."), `EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED`(409, "진행 중인 배정이 있는 관리사는 삭제할 수 없어요. 배정 종료 또는 교체 후 다시 시도해 주세요."). ko/en·테스트·문서 앵커·vendor 재생성은 기존 절차와 동일하다.
  - `backend/application/utils/problem-bodies.ts`에 `problemBody(code, errors?)` 헬퍼를 추가하고(기존 `clientProblemBody`는 변경하지 않는다), `employee.service.ts`의 전화 형식(`VALIDATION_FAILED` `/phone` INVALID_FORMAT)과 `rethrowPhoneConflict`의 P2002 2곳(`EMPLOYEE_PHONE_ALREADY_REGISTERED` `/phone`), 직원 usecase 5곳의 NotFound(`RESOURCE_NOT_FOUND`/NOT_APPLIED, id 노출 제거), `delete-employee.usecase.ts`의 활성 배정 충돌(`EMPLOYEE_ACTIVE_ASSIGNMENT_BLOCKED`)을 전환한다.
  - 검증: `employee.service.spec`, employee usecase spec들, delete spec, 대표 오류의 `mapHttpProblem→normalizeApiError` 왕복, red-first. 대소문자/조건/권한·업무 규칙은 불변이며 다른 도메인은 건드리지 않는다.
  - Dispatch metadata: `Phase: 4a-1` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 공개 코드 2개 추가 + 직원 백엔드 다중 지점 전환, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: bind after 3.1b close, before dispatch` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-employee-errors` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-employee-errors` · `Service tier: default` · `Paths: packages/shared/src/errors/problem-details.ts, packages/shared/src/errors/problem-details.test.ts, docs/error-management.md, backend/vendor/shared-agent/errors/**, backend/application/utils/problem-bodies.ts [신규], backend/application/services/employee.service.ts [전화·P2002 throw만], backend/application/usecases/employee/{change-employee-open-status,delete-employee,list-active-clients-by-employee,list-work-history-by-employee,update-employee}.usecase.ts [NotFound·충돌 throw만], 관련 owner tests` · `Depends: Task 3.1b`
  - **Phase close gate:** unit 검증 → 통합(`pnpm install` 후) → 영향 통합 검증(전체 backend suite + shared) → exact SHA/base `auditor` FINAL SHIP → inventory·계획 기록 → clean unit worktree/branch 정리. 4a-2(BFF·UI·check-phone 마스킹·useEmployees 빈 성공)는 후속 단위다.

**Task 4a-1 실행 결과 (2026-09-11):** worker unit `3f2fe08f9` → 통합 `07b8cce10`(18 files, +323/−40). `problem-bodies.ts` 헬퍼 추가, `employee.service` 전화 형식·P2002 2곳, 직원 usecase 5곳 NotFound, 삭제 활성 배정 충돌 전환. shared 55/55·284 jest, backend 전체 354 suites/5,021 passed/44 skipped/0 failed, 타입 통과. auditor FINAL **SHIP/HIGH**(base `aa913acec`).
- nonblocking(auditor): (1) `employee.service`의 서버측 전화 충돌 detail이 카탈로그 해요체와 달리 "…있습니다." — HTTP 경계는 안전하나 AI-chat 등 in-process 리더는 비카탈로그 문구를 본다(선택적 정합화), (2) "Provisional client codes" 주석이 EMPLOYEE_*까지 포함(문구 정리), (3) red-first 로그 미보존(카운트 불일치 아님, 기계적 타당), (4) 경계 테스트의 404 normalize 단언 비대칭, (5) **4a-2(BFF/UI)가 land하기 전에는 dev/preview/main으로 릴리스 금지**(과도기 wire shape 불일치).
- 기록: inventory `problem-details` public_codes 2개 추가, employee 파일 6행 migrated 갱신, `employee-validation-conflict-not-found-contract` verified finding 추가, `vendor_parity` 갱신. unit worktree/branch 정리. 다음은 4a-2다.

**Task 4a-2 실행 결과 (2026-09-11):** worker unit `83efd84d2` → 통합 `a0cb5921e`(16 files, +472/−71 — 초과분은 테스트). 직원 BFF 8개 라우트를 공유 helper 패턴으로 정렬하고, **check-phone이 upstream 실패를 `{exists:false}`로 마스킹하던 문제를 제거**(모바일 폼의 `hasPhoneDuplicateCheckFailed` 경로가 이제 동작), `useEmployees`가 비정상 응답을 `[]`로 강제 변환하던 것을 reject로 수정. frontend 232 suites/1,481, mobile 233 suites/1,508, 양쪽 타입 통과. auditor FINAL **SHIP/HIGH**(base `6ead21283`).
- worker 편차(승인 유지): 웹 PATCH/DELETE에 malformed id 로컬 400 게이트 추가(클라이언트 패턴과 동일, 백엔드 `min:1`과 일치 — audit이 유효 흐름 회귀 없음 확인).
- nonblocking(auditor): (1) 웹 invalid-id 게이트 전용 테스트 부재(모바일은 있음), (2) 웹 PATCH/DELETE가 id 검사를 auth보다 먼저 수행(모바일 clients 패턴과 순서 상이, 4a-3에서 정렬 검토), (3) check-phone의 200-비정상-shape는 여전히 exists:false(4a-3 하드닝), (4) check-phone `errorResponse`가 GET인데 기본 operation "mutation"(메타데이터 cosmetic), (5) 라인 예산 초과(테스트).
- 기록: inventory 직원 BFF 8행 migrated·훅 1행 reason 갱신, `employee-bff-alignment` verified finding 추가. worktree/branch 정리. 다음은 4a-3(직원 UI 어댑터: employees 페이지/폼/테이블의 legacy getErrorMessage·getApiErrorMessage → normalizeApiError/문제 표시, check-phone shape 하드닝, 릴리스 게이트 유지)다.

**Task 4a-3 실행 결과 (2026-09-11):** worker 2회(첫 실행 단계 소진 → continuation) unit `81f6e1ee3` → 통합 `f6bcd50b8`, 이후 보정 2건: `c2e41ee81`(mobile source-test 기대 정렬), `9543d88b3`(직원 DELETE BFF의 문제 본문 보존 게이트 + 라우트 테스트), `10bf810fa`(테스트 mock을 실제 wire body 별칭 포함으로 수정). 최종 `10bf810fa`에서 frontend 233/1,487, mobile 234/1,514, 양쪽 타입 통과.
- 내용: 웹/모바일 직원 폼이 구조화 오류 상태(`{message, fieldErrors, requestId, outcome}`)와 `normalizeApiError`+legacy fallback, `/name`·`/phone` 필드 연결(웹은 aria-describedby/aria-invalid, 모바일은 요약+클릭 포커스 — EmployeeFormCard가 범위 밖이라 선언된 편차), 페이지/테이블은 공유 problem-aware 매퍼로 정렬. 웹 PATCH/DELETE 인증-선행 순서 정렬 + invalid-id 테스트.
- **B1 보정 이력:** 1차 4a-3 감사 FIX_REQUIRED — 웹 삭제 409가 legacy conflict 브리지에서 problem 본문을 잃어 일반 문구 표시. 클라이언트 패턴의 `hasUpstreamProblemCode` 게이트를 양 플랫폼 DELETE에 적용. 2차 감사 FIX_REQUIRED — 새 테스트 mock이 실제 wire body(`message`/`error` 별칭)를 누락해 base에서도 통과(가짜 통과). 별칭 포함으로 수정 + base-red/head-green counterfactual 실행 증거 확보. 3차 감사 **SHIP/HIGH**.
- carried nonblocking: mobile 필드 연결 요약 수준, `hasUpstreamProblemCode` 4중 복사(공유화 제안), 웹 legacy 브리지 전용 라우트 테스트 부재, 페이지-레벨 삭제 문구 행동 테스트 부재, 라인 예산 초과(4a-3 전체 17 files +1005/−82, 대부분 테스트), 테스트 fixture가 카탈로그 문구를 수동 복사.
- 기록: inventory 직원 UI 7행 migrated, `employee-ui-problem-alignment` verified finding 추가. unit worktree/branch 정리. 이로써 Phase 4a(직원 오류 전환) 완료다 — 단, 위 carried 항목과 mobile 필드 연결 편차는 후속 정비로 남는다.

**advisory e2e 보정 (2026-09-11, `a2b967715`):** Mobile CI의 advisory Playwright(`employees-detail-layout.spec.ts`의 work-history 500 시나리오)가 4a-3의 무조건 `normalizeApiError` 문구 적용으로 깨졌다. work-history 안내를 `verified`일 때만 문제 카탈로그 문구로 쓰고, 그 외(legacy/일반 실패)에는 기존 "잠시 후 다시 시도해 주세요."를 유지하도록 게이팅했으며, 캐시 데이터 경고의 "현재 저장된 근무 내역을 표시하고 있습니다." 문맥도 복원했다. UI baseline은 순수 재앵커(5/5, 92 groups/822 records 보존). 최종 SHA `a2b967715`에서 **전 워크플로 success**, PR #657 `MERGEABLE/CLEAN`.

## Task 1.1 규격 매핑 마감 실행 결과 (2026-09-14, OpenCode 세션)

TL;DR: Notion MCP로 EM v1.0 카탈로그(97 ID)를 확보해 `docs/error-management-spec-catalog.md`로 기록하고, read-only scout 11배치로 inventory 797행 + 부속 10건을 전수 매핑해 Task 1.1(목록·분류·테스트 매핑·규격 매핑)을 마감했다. 실행 계약(Audit: SELF)에 따라 main이 커버리지·ID 유효성·중복을 대조했으며 준수 선언이 아니다.

- 카탈로그 기록 `bd8ddf4c9`: https://app.notion.com/p/3d60b049243480e388e3d2e409245e45 원문을 OpenCode Notion MCP(OAuth)로 수집. 97 ID / 20 그룹(GOV…CHANGE), 강도 라벨 보존, EM-GOV-04(문서만으로 준수 주장 금지) 명시. MCP 설정은 `~/.agents/opencode/opencode.jsonc`(agents 리포 `dbee72b`)에 추가했고 OAuth 연결 완료.
- 실행: `opencode-task.sh --agent scout`(opencode-go/deepseek-flash) 11배치 — map-01 backend 61 / map-02·03 application 75+75 / map-04 infrastructure+shared+부속 83 / map-05~08 frontend 272 / map-09~11 mobile 238. 브리프 rubric: EM 그룹별 후보 ID + 근거는 classification/reason, 코드 재열람은 모호 시에만, 출력 계약 `path || ids || note`.
- 결과: owners **797/797** (mapped 761 / exempt 36 — 주로 no-direct 경계·엔티티·개발 CLI), zero-regex 6 + service-record-ui 4 = 부속 10건 필드 추가. inventory `status: inventory-complete; spec-mapped-em-v1`, `semantic_inventory_complete: true`, top-level `spec_mapping` 블록, 행별 `spec_ids`·`spec_mapping_note`·`spec_mapping_status`.
- 검증(자체 감사): 배치별 행 커버리지 100%(61·75·75·83·68×4·80×2·78), 매핑 ID 전량 97-set 포함, 중복 출력 1건 dedupe, 스팟체크 10행(대표 문제 helper·클라이언트/직원 전환 파일·공유 오류 모듈). inventory는 기존 mixed-format(pretty + owners/source_manifest compact one-line)을 정밀 라인 수술로 보존했고 `source_manifest`·`review_batches`·`verified_findings`는 불변이다.
- 후속: EM-CAT-01 예시 코드(`CUSTOMER_PHONE_DUPLICATE`, `ASSIGNMENT_OVERLAP`)와 잠정 `CLIENT_*`/`EMPLOYEE_*` 코드명 정렬은 공개 식별자 변경 단위로 분리한다. Phase 4b/4c/5~11·실환경 검증·dev 병합·배포는 계속 열려 있다.

## dev 동기화 실행 결과 (2026-09-14, `5ceb8b4fe`)

TL;DR: dev가 63커밋 전진(계약·메시지·시스템 템플릿·single-flight 갱신)해 PR #657이 CONFLICTING이 되었고, `5ceb8b4fe`로 병합해 해소했다. 충돌 4파일(메시지 신규 페이지 9훅 포함)을 해소하고 테스트 3건을 정렬했으며, 전 영역 통합 검증과 read-only 감사 SHIP을 받았다.

- 병합: `df946a6ae`(Task 1.1 마감) + `c6bac7f83`(origin/dev) → `5ceb8b4fe`. 충돌: `docs/design-system/ui-debt-baseline.json`(라인 시프트), `mobile/src/app/(shell)/contracts/page.tsx`(dev import 추가), `mobile/src/components/app/files/file-storage-screen.tsx`(문구), `mobile/src/app/(shell)/messages/new/page.tsx`(9훅).
- 판단 기록: ① 메시지 신규 페이지 = dev의 서비스 종료 안내(영수증 링크 prepare/send) + 분기 템플릿 준비 게이트 **와** 우리 발송 안전장치(submissionRef 멱등키·outcome 잠금·normalizeApiError)를 한 흐름으로 통합. SMS 경로만 submission/재시도 지문 잠금을 적용하고, receipt-link 오류는 `describeReceiptLinkError(reason)` 문구를 normalize 결과에 입힌다. ② 계약 상세 = dev는 `handleSendReceiptLink`를 base 이후 건드리지 않았으므로 우리의 prop 기반 재작성(supersede)이 정답 — dev가 추가한 `Button`/`describeReceiptLinkError` import는 중복/불용이라 제거. ③ `ui-debt-baseline`은 재앵커로 해소: 수량 보존(frontend 27그룹/48레코드, mobile 28/44), dev 대비 정규화 시 byte-identical(앵커만 이동). ④ 문구 변환 관례에 따라 readiness 문구 기대값 2개 파일에서 해요체로 정렬(`…발송할 수 없어요.`). ⑤ dev의 single-flight `await openAuthenticatedEventSource` 도입으로 계약 생성 behavior 테스트가 실제 auth fetch에 의존하게 되어, 해당 모듈을 스프레드 mock(스텁 EventSource 반환)으로 고정했다.
- 검증(통합 `5ceb8b4fe`, 오케스트레이터 실행): backend 355 suites/5,037 passed(44 skip), frontend 233/1,491, mobile 245/1,569, shared 21/284 jest + 76 node, UI gate frontend·mobile pass(재앵커 후), `scripts/ci` 31 pass, 해소 파일 eslint 0 errors, 집중 78 tests pass(exact SHA). vendor/lockfile 불변(설치 불필요).
- 감사: read-only auditor **SHIP/MEDIUM** — 6개 해소 모두 검증, 충돌 마커 없음, 양 부모 대비 삭제 0, dev 변경 조용한 드랍 없음(양쪽이 바꾼 21개 파일 전부 양측 hunk 보존 확인). 런타임 검증은 감사자의 read-only 정책으로 미실행 → 오케스트레이터가 exact SHA에서 실행·기록했다.
- nonblocking(carried): `messages/new/page.tsx`의 중복 nested 가드·여분 빈 줄, 테스트 `getAllByRole(...).length > 0` 완화(기존), SSE mock 커버리지 공백(의도·문서화), `contracts/page.tsx` import 블록 여분 빈 줄.
- CI: `5ceb8b4fe`에서 메인 워크플로 전부 success, PR #657 `MERGEABLE`(잔여 pending 2건: auth e2e enforce·playwright advisory).

**advisory e2e 2건 기록 (2026-09-14):** Mobile CI의 advisory `playwright e2e`에서 2건이 실패한다: ① `system-template-preview.spec.ts:140` — `buildSystemTemplateSendHref`가 `template=` 파라미터를 추가한 dev 변경으로 실제 URL이 `/messages/new?template=THANKS&body=…`가 되어 `/messages\/new\?body=/` 정규식이 불일치. ② `contracts-mobile-list-row.spec.ts:1068` — dev의 `be3dc1db1`(인증 파일 소비자)로 영수증 다운로드가 `<a href>`에서 `<button aria-label="…다운로드">`(인증 fetch 다운로드)로 바뀌어 href 속성 단언이 불일치. **둘 다 dev 기존 실패다** — dev의 spec 파일 원문이 동일한 stale 기대값을 갖고 있고, dev CI(`Mobile CI`)는 최근 머지 커밋 4건(160983ca9, 9da26712c, 3ea495975, 074586547)에서 이미 failure다(160983ca9의 실패는 UI gate 드리프트 1줄; advisory는 skip). 우리 병합이 만든 회귀가 아니므로 우리 브랜치에서 dev의 stale 스펙을 임의 수정하지 않고 carried로 기록한다. 단, 우리 병합의 ui-debt 재앵커가 dev의 게이트 드리프트도 함께 해소한다. advisory는 non-blocking이며 required checks는 전부 pass다.

## dev 동기화·PR #657 병합 실행 결과 (2026-09-14)

TL;DR: dev가 두 번 더 전진해 sync-2(`ab23fe2af`)·sync-3(`9ec166edc`)로 해소하고, 동결 트리 재감사 **SHIP/HIGH**를 받은 뒤 PR #657을 dev에 병합했다(`2d01ecd9d`). 통합 브랜치는 dev tip으로 fast-forward했다.

- **sync-2 `ab23fe2af`** (`62ef50356` + `895f15169`, dev 30커밋/91파일 — system-template BFF 계약 통일·frontend-mobile parity 게이트·delivery mode 등): 충돌 10파일. shared `package.json`/`tsconfig.backend-runtime.json`/`route-utils`(+) import union, system-template/message-trigger BFF 테스트는 dev parity 계약(`{error:"Failed to <context>", code:"UPSTREAM_ERROR"}`) 채택(구 한글 포워딩 supersede), ClientAutocomplete는 우리 refresh 오류 알림 + dev 공유 검색(`matchesSearchQuery`) 통합, messages/new는 dev의 `selectedTemplateDeliveryMode` 가드 + `service-feedback-link` 차단 + 우리 제출 멱등/잠금/정규화 병합, bff-parity malformed-JSON은 공유 `parseBody`의 EM 문제 본문(VALIDATION_FAILED/NOT_APPLIED)에 맞춰 양 플랫폼 동일하게 갱신. vendor는 병합 소스에서 `build:backend-runtime` 재생성 + `pnpm install`, 재실행 무변경(결정적).
- **sync-2 감사: FIX_REQUIRED(절차 B1)** — 감사 중 같은 worktree에서 sync-3를 준비해 트리가 감사 도중 변함. 내용 결함은 0(9개 검증 항목 전부 통과: 마커 0·삭제 0·manifest union·BFF 구현-테스트 일치·vendor closure disjoint 등). 교훈: 감사 동안 worktree 동결이 필수.
- **sync-3 `9ec166edc`** (`ab23fe2af` + `c00b2305b`, dev phone unification 7커밋/14파일): 충돌 3파일 — `ui-debt-baseline` 재앵커(그룹 27/28, kind 수량 dev와 동일, anchors-only 검증), 직원 2파일 import(우리 `normalizeApiError`/`getUserErrorMessage` 유지 + dev `formatKoreanPhoneNumber` 채택, `getApiErrorMessage`는 사용처가 우리 전환으로 대체되어 제거).
- **재감사(동결 트리) SHIP/HIGH**: `9ec166edc` 14파일 전량 정적 검증 — dev 변경 드랍 0, 양 부모 대비 삭제 0, 마커 0, baseline 정규화 dev 동일성 + 앵커 스팟체크 4건, phone 파일 보존.
- **검증(tip `9ec166edc`)**: mobile 249/1626, frontend 235/1543, shared 27/345 + 86 node, backend 355/5037(2연속; 1회 비재현 flake 기록), mobile/frontend/shared/backend 타입체크, UI gate fe/mo pass, 해소 파일 eslint 0 errors, `scripts/ci` 31 pass.
- **PR #657 병합 완료: `2d01ecd9d`** (2026-09-14T14:08Z). merge 시점 dev head `b6fbd28b5`(message-history-badge-alignment, 7파일)와 GitHub이 충돌 없이 자동 병합. 통합 브랜치 `korean-error-messages`는 `2d01ecd9d`로 fast-forward 완료.
- **carried:** advisory Playwright 2건(dev 기존 stale 스펙 — 우리 회귀 아님, 위 기록), 백엔드 flake 1회(비재현), cosmetic import 여백(직원 3파일 선행), `objectContaining` parity 단언 완화(양 플랫폼 동일).
- **다음:** 잠정 코드 정렬(EM-CAT-01 예시 대비 개명 vs 유지+문서화) → Phase 4b(배정)·4c(일정). 이후 모든 task는 dev tip `2d01ecd9d`에서 분기한다.
- **잠정 코드 정렬 검토 완료(2026-09-14):** 현행 `CLIENT_*`/`EMPLOYEE_*` 10개 코드 유지(EM-CAT-01 등록 식별자 충족, 예시는 illustrative; EM-CAT-03 공개 안정성 우선). `problem-details.ts`의 "Provisional" 주석 해제 + em 문서에 근거·예시 매핑 기록. Phase 4b 신규 배정 충돌 코드는 `ASSIGNMENT_OVERLAP` 우선 검토. 공개 식별자 변경이 없으므로 별도 감사 없이(trivial) 마감한다.


## Phase 4b — 배정 오류 전환 (바인딩·실행, 2026-09-15)

TL;DR: 배정(4b-1 백엔드: 역할·자격·동시 변경 코드 전환 / 4b-2 UI: 필드 매핑·BFF passthrough)로 분리한다. 4b-1을 dev tip `23f835e61` 기준 유닛으로 dispatch한다.

**조사 결과(정찰 `em-4b-scout`, 2026-09-15):** 배정 소유 오류 경로는 `employee-assignment-eligibility.policy.ts`(역할 2 + 자격 1), `client.service.ts`(missing-primary 2곳 L887/L1835, 동시 변경 2곳 L1753/L2149 `SERVICE_RECORD_WRITE_TARGET_CHANGED`), schedule 유스케이스(같은 policy 재사용, 필드명 동일). `contract-client-assignment-guard`는 계약 도메인(5.1), `EMPLOYEE_SCHEDULE_OVERLAP`은 4c로 분리. `employee-assignment-eligibility.policy.spec.ts`는 현재 없음(inventory test_evidence []).

- **Task 4b-1: 배정 거절·동시 변경 코드 전환** (feature, high)
  - 카탈로그 추가 2개: `EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE`(400, 자격 미달 — 지점 불일치/미오픈/삭제) · `SERVICE_RECORD_WRITE_TARGET_CHANGED`(409, 기존 배포 식별자 등록 — EM-CAT-03에 따라 개명 없이 등록만).
  - 전환: policy 역할 오류 2곳 → `VALIDATION_FAILED` `/secondaryEmployeeId` INVALID_FORMAT(다른 상세 2종), 자격 오류 → 신규 코드(codeOnly), client.service missing-primary 2곳 → `VALIDATION_FAILED` `/primaryEmployeeId` REQUIRED, 동시 변경 2곳 → 신규 등록 코드(codeOnly). 상태 코드는 유지(400/409)하고 문구는 해요체로 정리한다.
  - 검증: red-first, policy 신규 spec(역할·자격 각 케이스), client.service spec 갱신(L1445/L3518 raw 단언), 전체 backend suite + shared + 양측 typecheck + vendor 재생성 결정성. 등록으로 HTTP shape가 바뀌는 동일 코드의 타 사이트(service-record lock 등)는 전체 suite에서 드러나면 최소 기계적 표준화만 하고 확장 내역을 보고한다.
  - Dispatch metadata: `Phase: 4b-1` · `Parallel group: none` · `Execution: DELEGATE` · `Audit: SOL` · `Decision reason: 공개 코드 2개 추가·등록 + 다중 사이트 전환, 공유 계약 영향` · `Tier: standard` · `Sandbox: local` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Effort: default` · `Phase starting integration commit: 23f835e61` · `Integration worktree: /Users/jaino/Development/babyjamjam-admin/korean-error-messages` · `Branch: unit/bjj319-assignment-errors` · `Worktree: /Users/jaino/Development/babyjamjam-admin/unit-bjj319-assignment-errors` · `Paths: packages/shared/src/errors/problem-details.ts(+test), backend/application/policies/employee-assignment-eligibility.policy.ts, backend/application/services/client.service.ts [해당 throw만], backend/test/policies/employee-assignment-eligibility.policy.spec.ts [신규], backend/test/services/client.service.spec.ts [해당 단언만], docs/error-management.md [공개 코드], backend/vendor/shared-agent/** [재생성]` · `Depends: Task 4.1(4a 완료)`
  - **4b-2(후속):** UI 단위 — `ClientFormDialog` `/primaryEmployeeId`·`/secondaryEmployeeId` 필드 매핑, 웹 request-replacement 프록시 오류 passthrough(현재 500으로 삼킴), 모바일 error-presentation 확인. 4b-1 close 후 바인딩.

**Task 4b-1 실행 결과 (2026-09-15):** worker unit `c6a8eff64`(실제 분기 `204a4ea43`) → 통합 `d56aac196`(9 files, +261/−13). 카탈로그에 `EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE`(400)·`SERVICE_RECORD_WRITE_TARGET_CHANGED`(409, 기존 식별자 등록) 추가, policy 역할·자격 3곳과 client.service 배정 4곳 전환(상태 유지, 해요체), policy 신규 spec(+147), docs·vendor 재생성. red-first: 신규 spec 4 failed → 12 passed.
- 검증(통합 `d56aac196`): backend 356 suites/5,049(2연속; 첫 통합 실행에서 비재현 flake 1건), shared 349 jest+86 node, mobile 1,630, frontend 1,543, 4종 타입·UI 게이트·`scripts/ci` 31 통과, vendor 재생성 결정성 확인. 감사 **SHIP/HIGH**(base `204a4ea43`).
- carried(auditor): ① `request-replacement` 라우트의 pointer는 `/secondaryEmployeeId`(본문 필드는 `newSecondaryEmployeeId`) — 플랜의 명시 선택이며 4b-2가 라우트 인지 pointer/프록시 passthrough를 소유. ② client.service 4개 전환 throw 직접 단언 없음(기존 공백). ③ 등록으로 wire shape가 바뀐 타 emitters는 테스트 미검증(4b-2/5.1). ④ inventory의 non-catalog 라벨 갱신(본 기록에서 처리).
- 기록: inventory 정책 행 migrated·client.service/write-lock/link-mirrored 행 갱신, `assignment-error-contract` verified finding 추가, `vendor_parity` 갱신. unit worktree/branch 정리. 다음은 **4b-2**(웹 폼 필드 매핑·request-replacement 프록시 오류 passthrough·모바일 확인).

**Task 4b-2: 배정 오류 UI·프록시 정렬** (feature, med) — 바인딩 2026-09-15, base `8de700776`
- 웹 BFF `frontend/src/app/api/clients/[id]/request-replacement/route.ts`: 예외를 전부 500으로 삼키는 catch를 `frontend/src/app/api/clients/route.ts` POST의 problem-code passthrough 패턴으로 정렬(구형 본문은 기존 sanitize/브리지 유지). 라우트 테스트 추가.
- 웹 `ClientFormDialog.tsx`: `ClientFormField`에 `primaryEmployeeId`/`secondaryEmployeeId` 추가 + `fieldForProblemError`가 `/primaryEmployeeId`, `/secondaryEmployeeId`(및 대체 플로우의 `/newPrimaryEmployeeId`, `/newSecondaryEmployeeId`)를 매핑하고 name/phone과 동일한 필드 표시·포커스로 연결.
- 백엔드(소형): `assertEmployeeAssignmentShape`에 pointer 컨텍스트 옵션(기본 `/primaryEmployeeId`·`/secondaryEmployeeId`) 추가, `client.service.ts` requestReplacement 호출만 `/newPrimaryEmployeeId`·`/newSecondaryEmployeeId` 전달 — EM-VAL-03 pointer 정합(4b-1 감사 carried ① 해소). 관련 spec 단언 갱신.
- 모바일: 변경 없음(확인만) — 프록시 passthrough·`error-presentation` 매핑은 이미 존재. 소비자 없는 `useRequestReplacement` 훅은 이번 범위 밖(후속 UI 슬롯으로 기록).
- 비목표: 새 replacement UI 구현, 일정(4c) 도메인, 등록 코드 rename, 다른 BFF 라우트 확장.
- Dispatch metadata: `Phase: 4b-2` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Phase starting integration commit: 8de700776` · `Branch: unit/bjj319-assignment-ui` · `Worktree: unit-bjj319-assignment-ui` · `Paths: frontend/src/app/api/clients/[id]/request-replacement/route.ts(+test), frontend/src/components/app/clients/ClientFormDialog.tsx(+tests), backend/application/policies/employee-assignment-eligibility.policy.ts(+spec), backend/application/services/client.service.ts [requestReplacement throw 1곳], backend/test/services/client.service.spec.ts [pointer 단언만]` · `Depends: Task 4b-1`

**Task 4b-2 실행 결과 (2026-09-15):** worker unit `6393af1b1`(base `f8ef234b1`) → 통합 `94612c8af`(9 files, +385/−30). ① 백엔드 pointer 컨텍스트(기본 `/primaryEmployeeId`·`/secondaryEmployeeId`, requestReplacement만 `/new*`) — 4b-1 carried ① 해소. ② 웹 프록시 problem passthrough(`errorResponse`, 구형은 sanitize 폴백) + route test 4건. ③ ClientFormDialog 직원 필드 매핑(4철자)·필드 인지 스텝/포커스, EmployeeAutocomplete에 aria prop(하위 호환). ④ 모바일 무변경(검증만).
- 검증(통합 `94612c8af`): backend 356/5,050, frontend 236/1,550, mobile 249/1,630, shared 349+86, 4종 타입·UI 게이트·`scripts/ci` 통과. 감사 **SHIP/HIGH**.
- carried(auditor): N1 테스트 포맷(cosmetic), N2 `primary` pointer 미사용(무해), N3 inventory 갱신(본 기록), N4 모바일 `/new*` 미매핑(휴면), N5 create/update pointer 서비스 레벨 단언 없음(low). `useRequestReplacement` 소비자 0 — 대체 UI 슬롯은 후속.
- 기록: inventory request-replacement 행 migrated·ClientFormDialog 행 갱신, `assignment-ui-proxy-alignment` finding 추가. unit worktree/branch 정리. **Phase 4b 완료(4b-1·4b-2)** — 다음은 **4c(일정)**.

**Task 4c-1: 직원 일정 CRUD 오류 전환** (feature, high) — 바인딩 2026-09-15, base `4b5ae77dc`
- 카탈로그 추가 2개(기존 배포 식별자 등록, EM-CAT-03): `EMPLOYEE_SCHEDULE_OVERLAP`(409, "같은 고객의 활성 일정과 기간이 겹쳐요.") · `SCHEDULE_RETENTION_BLOCKED`(409, 기존 한국어 문구를 카탈로그로 이관).
- 전환: ① policy 날짜범위 거절 → `VALIDATION_FAILED` `/endDate` INVALID_VALUE("시작일은 종료일보다 늦을 수 없어요."), 중복 → `EMPLOYEE_SCHEDULE_OVERLAP` code-only(409, `conflictScheduleId`는 소비자 0·params 미지원이라 제거 — 기록). ② create/update/delete usecase: raw NotFound ×6 → `RESOURCE_NOT_FOUND`, lock 재읽기 충돌 ×3 → 4b-1에서 등록한 `SERVICE_RECORD_WRITE_TARGET_CHANGED` 재사용(EM-CAT-02 동일 원인), 보관 삭제 제한 → `SCHEDULE_RETENTION_BLOCKED`, 엔티티 date/role 래핑 → 위 VALIDATION_FAILED 매핑(역할은 `/secondaryEmployeeId` INVALID_FORMAT).
- 범위 밖(기록): `parseInteger` 전역 변환(공유 헬퍼, 컨트롤러 다수) — 별도 단위 후보, `schedule-change.service`는 4c-2, BFF/UI는 4c-3, `service-record-entry`의 overlap 매핑은 제공기록지 슬롯.
- Dispatch metadata: `Phase: 4c-1` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: packages/shared/src/errors/problem-details.ts(+test), backend/application/policies/employee-schedule-invariants.policy.ts(+spec), backend/application/usecases/employee-schedule/{create,update,delete}-employee-schedule.usecase.ts(+specs), backend/vendor/shared-agent/**, docs/error-management.md` · `Depends: Task 4.2(4b 완료)`

**Task 4c-1 실행 결과 (2026-09-15):** worker unit `0a026d03b`(base `1a1d52d79`) → 통합 `97a752cef`(14 files, +282/−64). 카탈로그 2코드(`EMPLOYEE_SCHEDULE_OVERLAP` 409, `SCHEDULE_RETENTION_BLOCKED` 409) 등록, policy 날짜범위→`VALIDATION_FAILED` `/endDate`·중복→신규 코드(`conflictScheduleId` 제거 — 소비자 0·params 미지원), usecase 3종 NF 6곳→`RESOURCE_NOT_FOUND`·lock 충돌→`SERVICE_RECORD_WRITE_TARGET_CHANGED` 재사용·보관 제한→신규 코드·엔티티 date/role 래핑→필드 문제. red-first 2 failed→pass.
- 검증(통합 `97a752cef`): backend 356/5,050, shared 353+86, mobile 1,630, frontend 1,550, 4종 타입·게이트·ci 통과, vendor 결정성. 감사 **SHIP/HIGH**.
- carried: parseInteger 전역 변환(별도 단위), `service-record-entry` 특정 연장 문구가 카탈로그 일반 문구로 대체(제공기록지 슬롯), HTTP 경계 직접 테스트는 기존 패턴 의존.
- 기록: inventory 4행 migrated·service-record-entry 노트·vendor_parity 갱신, `schedule-crud-contract` finding 추가. unit worktree/branch 정리. 다음은 **4c-2(schedule-change 서비스)**.

**Task 4c-2: schedule-change 서비스 오류 전환** (feature, high) — 바인딩 2026-09-15, base `91cb0f26c`
- 카탈로그 등록(기존 배포 식별자, EM-CAT-03): `SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE`(409) · `INVALID_SCHEDULE_DATE`(400) · `ALL_SESSIONS_SUBMITTED`(409) · `REQUEST_ALREADY_PENDING`(409) · `REQUEST_NOT_PENDING`(409) · `SCHEDULE_DATE_NOT_POSTPONED`(409) · `REQUEST_STALE`(409). 추가 1개: `SCHEDULE_CHANGE_UNCOMPUTABLE`(409, "고객 회기 정보/배정 기간 부재로 계산 불가" — raw 메시지 3종 대체).
- 전환: `schedule-change.service.ts`의 코드 throw 전부 `codeOnlyProblemBody`로(원인·상태 보존), raw English 메시지 — NF 3종 → `RESOURCE_NOT_FOUND`, lock("target changed while acquiring write locks") → `SERVICE_RECORD_WRITE_TARGET_CHANGED` 재사용, 계산 불가 3종("Client has no session duration"/"Assignment has no start date"/"Assignment has no end date") → `SCHEDULE_CHANGE_UNCOMPUTABLE`(409).
- 범위 밖(기록): BFF 8라우트·UI dict는 4c-3, `schedule-change.controller` ParseIntPipe raw는 carried, `service-record-entry`의 연장 불가 문구는 제공기록지 슬롯(3c-1 audit item 6).
- Dispatch metadata: `Phase: 4c-2` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: packages/shared/src/errors/problem-details.ts(+test), backend/application/services/schedule-change.service.ts(+spec), backend/vendor/shared-agent/**, docs/error-management.md, 관련 spec/e2e 단언` · `Depends: Task 4.3(4c-1)`

**Task 4c-2 실행 결과 (2026-09-15):** worker unit `1b2b816e4`(base `fa608b1c0`) → 통합 `83dc3bcdb`(9 files, +492/−54). 배포 식별자 7개 등록 + 신규 `SCHEDULE_CHANGE_UNCOMPUTABLE`(409), 서비스 43개 throw 전량 `codeOnlyProblemBody`로 payload-only 전환(RESOURCE_NOT_FOUND ×16·lock ×7 재사용·계산 불가 ×5·나머지 코드 유지). red-first 18 failed→41/41.
- 검증(통합 `83dc3bcdb`): backend 356/5,058, shared 369+86, mobile 1,630, frontend 1,550, 4종 타입·게이트·ci 통과, vendor 결정성. 감사 **SHIP/MEDIUM**(payload-only·상태 일치 정적 검증; 테스트 재실행은 오케스트레이터 근거).
- carried: `service-record-entry` PLANNED_DATE_UNAVAILABLE 경로 wire 변경(status/code/message 보존, HTTP 테스트 없음), write-lock policy 자체 throw는 미변경(등록 코드라 동작 동일), UI dict 신규 코드 미반영(4c-3), `expectConflictCode` objectContaining 완화(minor), 8코드 HTTP 경계 테스트 공백.
- 기록: inventory 서비스 행 migrated·컨트롤러/entry 노트·vendor_parity 갱신, `schedule-change-contract` finding 추가. unit worktree/branch 정리. 다음은 **4c-3(BFF 8라우트 + UI dict)**.

**Task 4c-3: 일정 BFF 8라우트·UI dict 정렬** (feature, med) — 바인딩 2026-09-15, base `dcf64d096`
- 웹 4라우트(approve/reject/apply/preview): raw 401 → `unauthorizedResponse`, catch의 raw passthrough/raw 500 → `errorResponse`(problem 검증·passthrough, 구형은 sanitize), 성공 shape은 `backendJsonResponse`+`withNoStore`로 모바일과 정렬.
- 웹·모바일 로컬 400(English "Invalid schedule id/date") → 플랫폼 로컬 helper(`schedule-change-route-utils.ts`, `client-route-utils.ts` 패턴 + `localValidationResponse` 출력 계약)로 problem 본문(VALIDATION_FAILED, location path/body, 해요체). 공유 `localValidationResponse`는 비공개 유지.
- 모바일 4라우트: raw 400만 동일 helper로 교체(나머지 helper 흐름 유지).
- UI dict(웹 `features/service-records/utils/schedule-change-error.ts`, 모바일 `lib/service-records/schedule-change-error.ts`+test): 누락 등록 코드 추가(`SCHEDULE_CHANGE_UNCOMPUTABLE`, `REQUEST_NOT_PENDING`, `SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE`) — 카탈로그 문구와 일치.
- 테스트: 웹 approve/reject 라우트 테스트 신규, apply/preview 기존 테스트 갱신, 모바일 라우트 테스트 400 본문 갱신, dict 테스트.
- 범위 밖(기록): `localValidationResponse` 공개 export, clients 라우트 로컬 400, 컨트롤러 ParseIntPipe, 공개 페이지 UI 재설계.
- Dispatch metadata: `Phase: 4c-3` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: frontend/src/app/api/schedule-change-requests/** (+helper/tests), mobile/src/app/api/schedule-change-requests/** (+helper/tests), frontend/src/features/service-records/utils/schedule-change-error.ts, mobile/src/lib/service-records/schedule-change-error.ts(+test)` · `Depends: Task 4.3(4c-2)`

**Task 4c-3 실행 결과 (2026-09-15):** worker unit `11db7510c`(base `36af62790`) → 통합 `4ec3297e8`(19 files, +661/−116). 웹 4라우트(401→`unauthorizedResponse`, catch→`errorResponse` problem passthrough, success→`backendJsonResponse`+`withNoStore`), 모바일 4라우트 로컬 400→problem helper, 공통 헬퍼 계약(VALIDATION_FAILED·path/body pointer·ko-KR·problem+json, shared private `localValidationResponse` 모델), UI dict 양 플랫폼 8코드 완성. red-first web 8F/11P·mobile 6F/11P → 40/40·38/38.
- 검증(통합 `4ec3297e8`): frontend 238/1,580, mobile 250/1,656, backend 356/5,058, shared 369+86, 3종 타입·UI 게이트(베이스라인 불변)·ci 통과. 감사 **SHIP/HIGH**(테스트 수 독립 검산 일치).
- carried(auditor): 웹 helper의 scheduleId/request-id 쌍 미사용(테스트로 고정·dead export), `localValidationResponse` 계약 3중 복제(공유 export 제안), 웹 apply/preview scheduleId 미검증(기존), BFF error 본문에서 message/statusCode 별칭 제거(인레포 소비자 없음), `errorResponseMode` no-op 별칭(기존).
- 기록: inventory BFF 8행 migrated·`schedule-bff-ui-alignment` finding 추가. unit worktree/branch 정리. **Phase 4c 완료(4c-1·4c-2·4c-3)** — 다음은 Phase 5(계약·문서 남은 웹/서버 경로).

## Phase 5 — 계약·문서 남은 경로 (바인딩, 2026-09-15)

정찰(`em-5-scout`) 분할: 5-1 가드+계약 발송(저위험) → 5-2 문서 컨트롤러/서비스 → 5-3 eformsign 컨트롤러(고위험: 정렬된 UI) → 5-4 envelope(ok/reason) 전환(최고위험·마지막).

**Task 5-1: 계약 발송 가드 오류 코드화·가시화** (feature, high) — base `ed74acdf3`
- 배경: `contract-client-assignment-guard`의 한국어 400 3종은 모든 호출부(create-and-send/dispatch/finalize)에서 envelope({success}/{ok})로 감싸지고, dispatch 경로의 `reason`은 웹·모바일 `getSafeHeadlessFailureMessage`가 한국어를 버리고 일반 문구로 표시한다 → 사용자에게 원인이 안 보임.
- 카탈로그 3코드(신규): `CLIENT_ASSIGNMENT_REQUIRED`(409) · `DOCUMENT_PROVIDER_MISMATCH`(409) · `CLIENT_SERVICE_TERMINATED`(409).
- 전환: ① 가드 3 throw → `ConflictException(codeOnlyProblemBody(...))`(문구는 카탈로그로 이관). ② `dispatch-document-headless.usecase` catch: 등록된 problem code가 있으면 `reason`을 그 코드 문자열로(없으면 기존 sanitize 유지) — progress emit도 동일. ③ 웹 `ContractCreationForm` 인라인 helper + 모바일 `lib/eformsign/headless-progress.getSafeHeadlessFailureMessage`에 3코드 → 한국어 문구 매핑 추가. ④ create-and-send(AI툴 경로)·finalize(스왈로우)는 범위 밖(기록).
- 테스트: guard spec(코드), dispatch spec(reason 코드), 웹/모바일 helper 테스트(3케이스), 관련 e2e 단언 갱신.
- 범위 밖: envelope(ok/reason) 전환 전체·문서/eformsign 컨트롤러(5-2/5-3), 서명된 계약 수정(별도 subphase).
- Dispatch metadata: `Phase: 5-1` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: packages/shared/src/errors/problem-details.ts(+test), backend/application/services/contract-client-assignment-guard.service.ts(+spec), backend/application/usecases/eformsign-doc/dispatch-document-headless.usecase.ts(+spec), frontend/src/components/app/contracts/ContractCreationForm.tsx(+test), mobile/src/lib/eformsign/headless-progress.ts(+test), backend/vendor/shared-agent/**, docs/error-management.md` · `Depends: Task 5.1 정찰`

**Task 5-1 실행 결과 (2026-09-15):** worker unit `40358eb1e`(base `df9351612`) → 통합 `bafbad310`(14 files, +290/−29). 가드 3원인 코드화(`CLIENT_ASSIGNMENT_REQUIRED`·`DOCUMENT_PROVIDER_MISMATCH`·`CLIENT_SERVICE_TERMINATED`, 409), dispatch catch가 등록 코드 → `reason` 코드 문자열 매핑(그 외 sanitize 유지), 웹·모바일 `getSafeHeadlessFailureMessage` 3코드 문구 추가. red-first 4계층 확인.
- 검증(통합 `bafbad310`): backend 357/5,059(첫 실행 flake 1건·재실행 green), frontend 238/1,582, mobile 250/1,658, shared 375+86, 4종 타입·게이트·ci·vendor 결정성. 감사 **SHIP/HIGH**(음성 분기 커버리지·dead fixture는 nonblocking).
- carried(auditor): `registeredProblemCode` 부정 분기 테스트 공백, `eformsign.controller`의 가드 주입 dead(기존), dispatch `reason`/`uncertainReason`이 코드 문자열이 됨(외부 운영 툴 영향 가능·인레포 소비자 없음).
- 기록: inventory 가드/dispatch 행 migrated + envelope 슬롯 노트, `contract-guard-codes` finding, vendor_parity 갱신. unit worktree/branch 정리. 다음은 **5-2(문서 컨트롤러/서비스)** — 이후 5-3(eformsign 컨트롤러, 고위험)·5-4(envelope, 최고위험).

**Task 5-2: 문서 컨트롤러·서비스 오류 전환** (feature, med) — 바인딩 2026-09-15, base `fb17885db`
- 전환(기존 코드 재사용, 카탈로그 추가 없음): `document.controller.ts` — tags 배열/형식 400 → `VALIDATION_FAILED` `/tags` INVALID_FORMAT, `tenant context unavailable` 403 → `ACCESS_DENIED`, `file is required` → `/file` REQUIRED, validationError → `VALIDATION_FAILED`, name>255 → `/name` OUT_OF_RANGE, `Document file not found` NotFound ×2 → `RESOURCE_NOT_FOUND`(404). `document.service.ts` — Forbidden L34 → `ACCESS_DENIED`(문맥 확인), NotFound ×2 → `RESOURCE_NOT_FOUND`(id 노출 제거), plain Error L145는 500 remap 유지. `document.entity.ts` L108/L120 한국어 Error는 도달 가능할 때만 전환(그 외 기록).
- 소비자: 웹 BFF `file-storage/files` 경유(문제 passthrough 여부 확인, 필요 시 최소 정렬) — 모바일 소비자 없음.
- 테스트: `document.controller.integration.spec.ts`(143/385/395/409/425/483) + service spec 갱신, red-first.
- 범위 밖: eformsign 컨트롤러(5-3), envelope(5-4), 업로드 UI 재설계.
- Dispatch metadata: `Phase: 5-2` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: backend/interface/controllers/document.controller.ts(+spec), backend/application/services/document.service.ts(+spec), backend/domain/entities/document.entity.ts, frontend/src/app/api/file-storage/** [passthrough 확인 시만]` · `Depends: Task 5-1`

**Task 5-2 실행 결과 (2026-09-15):** worker unit `f17073251`(base `5469fe57b`) → 통합 `45ce8fb47`(6 files, +253/−41). 문서 컨트롤러/서비스 전환(기존 코드 재사용, 카탈로그·vendor 불변): tags 4→`/tags`, tenant 403→`ACCESS_DENIED`, file required/validationError→`/file`, name>255→`/name` OUT_OF_RANGE, not-found ×2→`RESOURCE_NOT_FOUND`(id 제거), 웹 download BFF 404 특례 제거→problem passthrough. 엔티티 throw는 도달 불가/섀도우 확인 후 유지. red-first 14 failed→39/39.
- 검증(통합 `45ce8fb47`): backend 356/5,064, frontend 238/1,582, mobile 250/1,658, shared 375+86, 3종 타입·게이트·ci. 감사 **SHIP/MEDIUM**.
- carried(auditor): ① name>255 테스트가 pipe 분기를 검증(컨트롤러 분기 미도달) ② `validationError` 동적 detail이 제어문자 포함 시 500 폴백(고정 문구 권장) ③ 모바일 download BFF는 아직 404 problem 미정렬(no-consumer 주장 정정) ④ storage-path 가드의 `ACCESS_DENIED` 명명(충돌 성격).
- 기록: inventory 문서 3행 + 웹 BFF 행 migrated, `document-contract` finding 추가. unit worktree/branch 정리. 다음은 **5-3(eformsign 컨트롤러, 고위험)**.

**Task 5-3a: eformsign tombstone 코드 등록·전환** (feature, med) — 바인딩 2026-09-15, base `1c7b8cb6d`
- 카탈로그 등록(기존 배포 식별자, 410): `EFORMSIGN_CREDENTIALS_SERVER_ONLY` · `EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY`.
- 전환: 양 컨트롤러의 tombstone 7곳(`eformsign-doc` L186/194, `eformsign` L398/406/414/422/430) → `GoneException(codeOnlyProblemBody(...))` (410 유지, English `error` 필드 제거). 등록 즉시 전 사이트가 mapper로 problem化되므로 7곳을 한 유닛에서 함께 전환한다.
- 소비자: 프론트/모바일 BFF가 자체 410 `{code}`를 author(불변, Next측); UI에 Gone/410 분기 없음(확인됨).
- 테스트: tombstone 단언(eformsign.controller.integration.spec.ts:1423 등) 갱신, red-first.
- 범위 밖: eformsign.controller의 나머지 raw {error}/BadRequest/ServiceUnavailable(5-3b), envelope(5-4).
- Dispatch metadata: `Phase: 5-3a` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Paths: packages/shared/src/errors/problem-details.ts(+test), backend/interface/controllers/{eformsign-doc,eformsign}.controller.ts [tombstone만], backend/vendor/shared-agent/**, docs/error-management.md, 관련 spec` · `Depends: Task 5-2`

**Task 5-3a 실행 결과 (2026-09-16):** worker unit `22f8a3ce4`(base `2d22172b6`) → 통합 `88bb0b970`(8 files, +126/−35). tombstone 코드 2종 등록(410)·7사이트 전환. red-first shared 4F·integration 4F. 감사 **SHIP/HIGH**.
- 검증(통합 `88bb0b970`): **교훈 — vendor 변경 유닛은 통합에서 먼저 `pnpm install --frozen-lockfile`로 `file:` 복사본을 갱신해야 함**(미갱신 시 type-check 실패·스퓨리어스 test 실패; 갱신 후 backend tc 0, 356/5,065 pass, flake 1회 재발). frontend 238/1,582, mobile 250/1,658, shared 379+86, 게이트·ci 통과.
- carried(auditor): integration spec이 프로덕션 mapper 미경유(raw 직렬화 단언 — mapper는 코드 검증), eformsign-doc tombstone 2곳 직접 테스트 없음, BFF tombstone 14파일은 Next측 자체 410(정렬 여부 후속 판단), mapper 410 등록코드 테스트 공백.
- 기록: inventory 컨트롤러 2행 migrated, `eformsign-tombstones` finding 추가. unit 정리. 다음은 **5-3b(eformsign.controller 나머지)**.

**Task 5-3b: eformsign.controller 나머지 전환** (feature, high) — 바인딩 2026-09-16, base `5cd9b1463`
- 전환(tombstone 제외): raw `HttpException({error})` ×12(L684/701/799/820/855/867/895/955/1048/1058/1069/1093) → 상태별 재사용 코드 매핑(400→`REQUEST_INVALID`/`VALIDATION_FAILED`(본문 파라미터면 pointer), 403→`ACCESS_DENIED`, 404→`RESOURCE_NOT_FOUND`, 502/503→`DEPENDENCY_UNAVAILABLE`/`UPSTREAM_*`), English `BadRequestException` ×5(L87/114/127/133/139) → `VALIDATION_FAILED`/`REQUEST_INVALID` 한국어 문구, `ServiceUnavailableException({...})` ×3(L828/912/972) → `DEPENDENCY_UNAVAILABLE`(503, payload의 소비자 확인 후 최소 보존/제거).
- 소비자: eformsign-docs BFF/web·모바일 — 문제 passthrough 확인, 필요 시 최소 정렬. `{error}` 문자열을 읽는 소비자는 카탈로그 호환 별칭으로 유지됨.
- 테스트: 해당 spec들의 raw 단언 갱신 + 신규 커버, red-first.
- 범위 밖: eformsign-doc.controller(5-3a 완료), envelope(5-4).
- Dispatch metadata: `Phase: 5-3b` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: backend/interface/controllers/eformsign.controller.ts [tombstone 제외], backend/test/integration/eformsign.controller.integration.spec.ts, 소비자 BFF 확인 시 frontend/mobile eformsign-docs 라우트(최소), docs/error-management.md` · `Depends: Task 5-3a`

**Task 5-3b 실행 결과 (2026-09-16):** worker unit `f06e71e84`(base `31b6dce86`) → 통합 `a6533b562`(2 files, +271/−75), **감사 FIX_REQUIRED(B1)** → 보정 `bd31791d3` → 통합 `3e71aec88`, 보정 감사 **SHIP/HIGH**.
- 내용: 12 raw `{error}` → 상태별 재사용 코드(3×VALIDATION_FAILED 포인터·6×ACCESS_DENIED·RESOURCE_NOT_FOUND·2×INTERNAL_ERROR), 7 English BadRequest(`fileType/statusCategory/templateMatch/displayStatus/section/format` 쿼리 포인터), 3 ServiceUnavailable→DEPENDENCY_UNAVAILABLE. **B1**: mutation 500 fallback 2곳이 `codeOnlyProblemBody`(NOT_APPLIED)로 변환돼 모바일 재시도 가드가 "재시도 가능"으로 오판할 수 있었음 → `uncertainProblemBody`(UNKNOWN/CHECK_STATUS) 신설·교체, 단언 보강, 카운터팩추얼로 검증.
- 검증(통합 `3e71aec88`): backend 356/5,075, frontend 238/1,582, mobile 250/1,658, shared 379+86, backend tc 0, 게이트·ci. 교훈: **500 fallback은 절대 NOT_APPLIED로 기본 변환하지 않는다(EM-STATE-01)**.
- carried: integration spec이 mapper 미경유(기존), 파이프 섀도우 사이트 defense-in-depth, `throwHttpOrInternalError`·한국어 기존 사이트 유지, 503 읽기 outcome NOT_APPLIED(의미상 무해), korean-error-messages 데드 엔트리.
- 기록: inventory 컨트롤러 행 갱신, `eformsign-controller-contract` finding 추가. unit 정리. 다음은 **5-4(envelope ok/reason, 최고위험)** — 이후 Phase 6.

## Phase 5-4 — headless envelope 계약 (바인딩, 2026-09-16)

**설계 결정(정찰 기반):** ambiguous/partial 결과는 HTTP 오류가 아니라 **업무 결과**(EM-STATE-01)이고, `fallbackHint`·문서 ID 복구 프로토콜은 유지 의무(플랜 "server-owned fallbackHint 재사용")이므로 **가산적 계약**을 채택한다: 기존 `{ok:false, reason, fallbackHint, …}` 필드를 바이트 동일하게 유지하고 `code`(등록)·`outcome`·`recovery`만 추가(EM-CHANGE-01/04 호환). 사전-쓰기 거절의 problem+json화는 후속(6.x) 판단으로 남긴다.

**Task 5-4a: dispatch envelope 가산 계약** — base `ce01b87b7`
- dispatch 11개 실패 분기에 `code`/`outcome`/`recovery` 추가. reason 토큰을 SCREAMING 코드로 등록(의미 1:1, reason은 호환 별칭으로 유지), outcome 매핑: 사전검증/중복/락/진행중 → NOT_APPLIED, already_accepted/uncertain/remote_unconfirmed/terminal → UNKNOWN+CHECK_STATUS, local_persist_failed → PARTIALLY_APPLIED+CHECK_STATUS, iframe 가능한 pre-send 실패 → NOT_APPLIED(+fallbackHint 유지).
- must-NOT-change: iframe 게이트·duplicate force 재시도·local_persist adopt·fallbackHint/reason/문서 ID 필드(바이트 동일), worker `isAmbiguous` 입력.
- Dispatch metadata: `Phase: 5-4a` · `Execution: DELEGATE` · `Audit: SOL` · `Agent: worker` · `Model: opencode-go/glm-5.3-flash` · `Paths: packages/shared/src/errors/problem-details.ts(+test), packages/shared/src/types/eformsign.ts, backend/application/usecases/eformsign-doc/dispatch-document-headless.usecase.ts(+spec), backend/interface/dto/eformsign-doc.dto.ts, backend/interface/controllers/eformsign-doc.controller.ts [dispatch 응답만], backend/vendor/shared-agent/**, docs/error-management.md, worker spec 단언` · `Depends: Task 5-3b`

**Task 5-4a 실행 결과 (2026-09-16):** worker unit `a0457cc77`(base `5c972b86f`) → 통합 `75bd0816f`(12 files, +809/−7). dispatch 실패 11분기에 `code/outcome/recovery` 가산(11코드 등록), legacy 필드 바이트 동일(기계 감사: 제거 7줄 전부 슈퍼셋/리팩터). worker `isAmbiguous` 불변(가드 테스트 추가), 컨트롤러 envelope 스펙 신규. red-first 14F/22F/1F.
- 검증(통합 `75bd0816f`): backend 357/5,082, frontend 238/1,582, mobile 250/1,658, shared 401+86, typecheck 0, 게이트·ci. 감사 **SHIP/HIGH**.
- **flaky 정체 규명:** `receipt-pdf-verifier.service.spec.ts`(pdfjs capability) — base에서도 실패하는 기존 이슈(스태시 검증), 오늘의 flake 전부 이것으로 추정.
- carried(auditor): catch의 SCREAMING 코드 비대칭(도달 불가·Phase 6 연계), post-send catch 방어(계획 명시), inventory 갱신(본 기록), 소비자 미채택(BFF passthrough라 백엔드 변경 불요), HTTP status 미전환(201 유지 — Phase 6 판단).
- 기록: inventory 컨트롤러/dispatch 행 노트, `dispatch-envelope-contract` finding. unit 정리. 다음은 **5-4b(finalize envelope)** → 5-4c(소비자) → 5-4d(creation/AI) → Phase 6.

**Task 5-4b: finalize envelope 가산 계약** — base `68100ab3b` (5-4a 동형)
- finalize 실패 분기에 `code/outcome/recovery` 가산, legacy 필드 바이트 동일. 신규 코드: `DOCUMENT_FINALIZE_IN_PROGRESS`(409), `EFORMSIGN_TERMINAL_FAILURE`(502), `DOCUMENT_FINALIZE_UNCONFIRMED`(502), `DOCUMENT_FINALIZE_FAILED`(502). 재사용: `DOCUMENT_LOCK_UNAVAILABLE`·`DOCUMENT_LOCK_LOST`·`ACCESS_DENIED`·`DISPATCH_ALREADY_ACCEPTED`·`DISPATCH_UNCERTAIN`.
- outcome: 락/진행중/authorization → NOT_APPLIED/NONE(권한은 ACCESS_DENIED 403), already-accepted/uncertain/pending → UNKNOWN+CHECK_STATUS, terminal failure → FAILED/NONE, catch → NOT_APPLIED/NONE(iframe/manual_check 조건 불변). `ok:true, completed:false`(advanced) 성공 분기 불변.
- Dispatch: `Phase: 5-4b` · worker(glm) · `Paths: finalize-document-headless.usecase.ts(+spec), eformsign-doc.dto.ts, eformsign-doc.controller.ts [finalize만], shared types, catalog(+test)+vendor, docs` · `Audit: SOL` · `Depends: 5-4a`

**Task 5-4b 실행 결과 (2026-09-16):** worker unit `32f023dec`(base `087638855`) → 통합 `c09d2253f`(12 files, +338/−7). finalize 9개 실패 분기 + 컨트롤러 denial에 code/outcome/recovery 가산(신규 4코드, 재사용 5코드), legacy 필드·삼항 불변. red-first 17F+8F. 감사 **SHIP**.
- 검증: backend 357/5,083(flaky 1회→재실행 green), shared 409+86, tc 0. **flaky 풀 확장 확인:** 컨트롤러 integration 스펙(Employee/UserController)도 런당 랜덤 1건 실패 — base에서도 동일(기존 환경 flake).
- carried: 4개 분기 직접 단언 미비(N1), 컨트롤러 denial 매핑 리터럴 중복(N2).
- 기록: `finalize-envelope-contract` finding 추가. unit 정리. 다음은 **5-4c(웹/모바일 소비자 정렬)**.

**Task 5-4c: headless 소비자 정렬** — base `6629eee55`
- ① mobile legacy `useContractCreationFlow.ts`의 무조건 iframe 폴백(중복 위험) — 도달성 확인 후 안전 게이트 적용 또는 정식 은퇴. ② 웹 `ContractCreationForm`·웹 `contracts/page`(finalize)·모바일 `new/page`·모바일 `contracts/page`가 가산 `outcome`/`code`를 우선 분류로 채택(UNKNOWN→확인 필요+잠금, PARTIALLY_APPLIED→adopt, NOT_APPLIED→기존), legacy reason/fallbackHint 분기는 폴백으로 유지. ③ 테스트.
- 범위 밖: 백엔드(불변), creation/AI(5-4d), reason 토큰 변경.
- Dispatch: `Phase: 5-4c` · worker(glm) · `Paths: frontend/src/components/app/contracts/ContractCreationForm.tsx, frontend/src/app/(protected)/contracts/page.tsx, frontend/src/services/api.ts, mobile/src/app/(shell)/contracts/{new,page}.tsx, mobile/src/hooks/useContractCreationFlow.ts, mobile/src/app/(shell)/contracts/page.helpers.ts, mobile/src/lib/contracts/contract-operation-guard.ts, 대응 테스트` · `Audit: SOL`

**Task 5-4c 실행 결과 (2026-09-16):** worker unit `981705e21`(base `17e439226`) → 통합 `53ff9d8fe` + 재앵커 `3bec2e441`. 4소비자 outcome-우선(UNKNOWN→확인필요+잠금, PARTIALLY_APPLIED→adopt) + legacy 분기 불변, **dead `useContractCreationFlow` 체인 8파일 은퇴**(도달성 4중 확인), `readHeadlessOutcome` 헬퍼. red-first mobile 5F·web 3F.
- 검증: frontend 240/1,590(+8), mobile 250/1,666(+8), backend 357/5,083, shared 409+86, fe/mo tc 0, UI 재앵커 anchors-only(27/48·28/44 보존)·게이트 green, ci 31. 감사 **SHIP**.
- 기록: `headless-consumer-alignment` finding. unit 정리. 다음은 **5-4d(creation/AI-tool)** → Phase 6.

**Task 5-4d: creation/AI-tool 결과 계약 가산** — base `c7ebcbec7`
- `create-and-send-contract.usecase.ts` 실패 결과에 `code`/`outcome`/`recovery` 가산(legacy `{success:false,error}` 불변, `uncertain`/`remoteDocumentId` 유지). outcome: 사전거절 NOT_APPLIED, uncertain/remote UNKNOWN+CHECK_STATUS. 코드는 재사용(가드 3코드·VALIDATION_FAILED 등) 우선.
- 소비자: `tool-executor.service.ts`(AI툴)·`contract-external-agent-capabilities.provider.ts` — outcome/uncertain 우선 분류(legacy fallback), 테스트.
- Dispatch: `Phase: 5-4d` · worker(glm) · `Paths: create-and-send-contract.usecase.ts(+spec), tool-executor.service.ts(+spec), contract-external-agent-capabilities.provider.ts(+spec), shared types(가산 optional)` · `Audit: SOL`

**Task 5-4d 실행 결과 (2026-09-16):** worker unit `08912aafa`(base `c7ebcbec7`) → 통합 `cd02d5371`, **감사 FIX_REQUIRED(B1)** → 보정 `aff80c56a` → 통합 `052e2fe03`, 보정 감사 **SHIP/HIGH**. creation 실패에 code/outcome/recovery 가산(전부 기존 코드 재사용), tool-executor/agent-capability가 outcome UNKNOWN 우선 분류. B1: call-inbox e2e exact-equality 2곳이 가산 필드로 깨짐(jest가 test/e2e 제외라 미탐) → 단언 보정 + **`e2e:call-inbox` 로컬 실행 22/22 통과**로 검증. full backend 357/5,096, tc 0, eslint 0.
- carried: N1 local-persist 패밀리를 UNKNOWN으로 분류(5-4a의 PARTIALLY_APPLIED와 상이 — 안전·기록된 선택), N2 헬퍼 중복(향후 추출), N3 null phone은 generic VALIDATION_FAILED.
- 기록: inventory 3행 갱신·`creation-result-contract` finding. unit 정리. **Phase 5 완료(5-1~5-4d)** — 다음은 **Phase 6(나머지 전수)**.

## Phase 6 — 바인딩·배치 (2026-09-16)

**6a: 백엔드 agent·AI-chat 도메인** — base `c80fa1d53`. 대상: `backend/application/agent/*`(5) + `backend/application/ai-chat/*`(2) — raw 4xx/에이전트 실패 분류 전환(기존 코드 재사용 우선, 필요 시 최소 신규). 소비자는 AI챗/에이전트 런타임(비HTTP·in-process) — 분류 오류·raw message 비교·빈 성공 삼킴 점검. worker(glm) · Audit SOL.

**Task 6a 실행 결과 (2026-09-16):** worker unit `8db72a46b`(base `c80fa1d53`) → 통합 `157bbc29d`(16 files, +618/−88). agent 5 + ai-chat 2 파일 49+ throw 전환(전부 기존 코드 재사용, 카탈로그·vendor 불변), tool-executor 가산 code/outcome. red-first 22F→246 focused; full backend 358/5,115. 감사 **SHIP**.
- carried: runtime L364 403 의미 긴장, confirmation-mismatch 단일 body(안티프로빙), tool-executor outcome 기본값(read NOT_APPLIED vs mutation UNKNOWN), persistResultPart L855 미전환(범위 외).
- 기록: `agent-chat-contract` finding. unit 정리. **Phase 6 계속: 다음 배치 = 백엔드 controllers/services 잔여 → 프론트/모바일 라우트 → UI.**

**Task 6b: 공유 파서·인증 가드 전환** — base `e36210d03`
- 대상: `backend/interface/parse-integer.ts`(parseInteger/parseOptionalInteger), `backend/interface/parse-boolean.ts`, `backend/infrastructure/auth/{call-ingest.guard,jwt.strategy,local.strategy,service-record.guard,rate-limit.guard}.ts`, `backend/infrastructure/tenant/tenant.guard.ts`.
- 매핑: 파서 → `VALIDATION_FAILED`(pointer `/<name>`, min/max 위반 OUT_OF_RANGE·그 외 INVALID_FORMAT, location 생략 — path/query 혼용) 해요체, 400 유지. auth Unauthorized raw → `AUTH_REQUIRED`(401). rate-limit `{code:AUTH_RATE_LIMITED}` → 기존 `REQUEST_RATE_LIMITED`(429) 재사용. tenant.guard Forbidden → `ACCESS_DENIED`(403).
- 범위 밖: `prisma-exception.filter.ts`(6c 별도), ParseUUIDPipe(Nest 내장 — carried), 컨트롤러/서비스 잔여.
- Dispatch: worker(glm) · `Paths: 위 파일 + 대응 spec` · `Audit: SOL`

**Task 6b 실행 결과 (2026-09-16/17):** worker `0dd877dbf`(base `416fcb09e`) → 통합 `b6443f90f` (8 파일 + specs). 전부 기존 코드 재사용, 카탈로그·vendor 불변. red-first 25F→45 focused; 360 suites/5,127; **call-inbox e2e 22/22 실검증**; 감사 SHIP. 통합 첫 실행 2F는 플레이크 풀(재실행 green, employee-schedule 25/25).
- carried: rate-limit 429 본문 retryAfter 제거(헤더 유지, sanctioned), shared `AUTH_RATE_LIMITED` 죽은 키 정리(후속), ParseUUIDPipe(Nest 내장) 미전환.

**Task 6c: Prisma 필터 + 설정·템플릿·알림 서비스** — base `58a9393f7`
- 대상(7): `backend/infrastructure/filters/prisma-exception.filter.ts`, `application/services/{notification,system-admin,system-setting,system-template,system-template-mutation-guard,document-category}.service.ts`.
- 매핑: Prisma P2002→REQUEST_CONFLICT(409), P2025→RESOURCE_NOT_FOUND(404), P2003→REQUEST_CONFLICT, P2000→VALIDATION_FAILED(400), P2024/P1001/P1002/P1008/P1017→DEPENDENCY_UNAVAILABLE(503), 기타 4xx→REQUEST_INVALID, >=500 기존 흐름 유지 — 필터 자체는 경계 공용이므로 status 보존 최우선. 기존 `{statusCode,code:prismaCode}` 소비자(웹 getUserErrorMessage 별도) 확인.
- 서비스: 알림 Forbidden→ACCESS_DENIED; system-admin/setting/template/mutation-guard raw NotFound/Conflict/BadRequest→등록 코드(+errors 배열 VALIDATION_FAILED); document-category GLOBAL_CATEGORY_CONFLICT/P2002→REQUEST_CONFLICT.
- worker(glm) · Audit SOL.

**Task 6c 실행 결과 (2026-09-17):** worker `d18ac6956`(base `c02b250c5`) → 통합 `e4ee58dc2` (15 파일). red-first 20F→119; 362 suites/5,138; 감사 SHIP. 신규 코드 0.
- carried: 필터 status 정정 2건(P2000 500→400, P1002/P1008 500→503), mutation-guard wire 필드 제거(unsupportedVariables — 소비자 무 확인), 내부 불변식 Error 4곳.
- **dev 관찰(다음 sync 대비):** dev(96f4026ab)에 PR #704(sentry-400-advisories) 머지됨 — `backend/infrastructure/observability/http-advisory.spec.ts` 존재(우리 트리엔 없음), dev에서 로컬 실행 시 1건 실패(EMPLOYEE_ASSIGNMENT_UNAVAILABLE 400 매핑) — dev node_modules 미갱신 가능성 또는 dev 자체 이슈, **우리 범위 아님·다음 sync 때 확인**. dev에 untracked `mobile/AGENTS.md`(사용자 WIP) — 건드리지 말 것.

## Phase 6 — 병렬 웨이브 (2026-09-17~)

**웨이브1 = 6d1(백엔드 서비스5) + 6g1(FE api 32) + 6h1(MO api 29)** — base `3458d2403`
- 6d1: admin-service-record-edit/admin-service-record/call-inbox/call-ingest-token/consultation-inquiry. 기존 코드 재사용; 상태 보존; raw 4xx→등록 코드.
- 6g1/6h1: BFF raw 영문 `{error}`/passthrough → 공유 헬퍼 규약(`frontend/src/app/api/clients/route.ts` 참조, `@/lib/api/route-utils` errorResponse 계열). **packages/shared 편집 금지**(부족 코드는 리포트로). 리스트: `/tmp/em-6/wave1-fe.txt`, `/tmp/em-6/wave1-mo.txt`.
- 규칙: 동일 카탈로그 writer는 백엔드 1유닛만; FE/MO는 코드 신규 등록 금지. worker×3 · Audit SOL ×3.

**웨이브2 = 6d2(auth/auth-session/user/ai-chat 4서비스) + 6g2(FE api 31) + 6h2(MO api 29)** — base `582e806a1` (웨이브1 병합 후). 리스트 `/tmp/em-6/wave2-{fe,mo}.txt`.

**인시던트 (2026-09-17 05:0x~05:5x KST):** z.ai 5시간 한도 소진("Usage limit reached for 5 hour", 리셋 04:52:25 베이징=05:52 KST 추정)으로 워커 6건(보정 3 + 웨이브2 3)이 rate-limit 중단. 추가로 opencode-go 폴백은 `--format json`에서 무출력(사실상 불가) → **폴백 무효** 확인. 교훈: 워커 디스패치에 `--fallback-model opencode-go/glm-5.3-flash` 필수(이번에 누락), 동시 실행 수 3 이하 유지.
- 중단 시점 상태: 보정 워크트리 fe1(1파일 dirty)/mo1(6파일 dirty)/backend5(clean, 보정 미착수), 웨이브2 워크트리 auth4(4)/fe2(51)/mo2(33) dirty — 재개 워커가 이어서 완료해야 함.
- 웨이브1은 이미 병합됨(`582e806a1`): BE 5153+1flaky(고립 52/52), FE 1679, MO 1696 — **보정 후 재감사 필요**(감사 3건 FIX_REQUIRED).

**pdfjs 환경 플레이크 (2026-09-17):** `receipt-pdf-verifier.service.spec.ts` 1테스트가 통합·고립·base `582e806a1` 프로브 워크트리에서 모두 실패(`capability_unverified`) — 환경성 기존 이슈 확정(웨이브1·보정 무관). Phase 9 증거 실행에서 재확인 필요.

**웨이브1 확정 (2026-09-17):** 6d1+6g1+6h1 → 초안 3건 FIX_REQUIRED(B1: 백엔드 충돌 extras 유실·FE 5xx-mutation outcome 위반·MO login 누락) → 보정 `b099ecb2e`/`cf6929a72`/`fdd2dad1a` → 재감사 **3건 SHIP**. 통합 `5f205c805`(병합+보정): BE 362/5159(+pdfjs 환성), FE 267/1685, MO 252/1701. 기록: 66행 migrated 확정(wave1: BE 5 + FE 32 + MO 29, 부모 대비 기계 대조 완료). 유닛 워크트리 정리 예정. 6.1 잔여는 wave2 확정 후 재산정.

**기록 정정 (2026-09-17 19:4x KST):** 당초 "126행 migrated"·"6.1 잔여 130행"은 과대/미검증이었다 — 126행 중 60행(FE 31 + MO 29)은 wave2 리스트(`/tmp/em-6/wave2-{fe,mo}.txt`)와 정확히 일치하는 미병합분 선반영이었으므로 본 정정에서 parent 기준으로 legacy 복원했다(복원 후 부모 대비 migrated delta 정확히 66행, wave2 잔류 0행 기계 확인). wave2 유닛 `40d05d558`(FE 59파일)/`9d5bb5ae2`(MO 52파일)는 각 워크트리 HEAD에 존재하고 재감사 **2건 SHIP**(6g2b/6h2b) 확보 — 병합 `848366c3d`(FE)+`c107ca73a`(MO) 승인·완료, 해당 60행 migrated 확정(본 커밋). 6d2(auth4)는 muse-spark 모델로 재개·완료: 유닛 `3ea961431`(16파일 +1072/−200, BE 362/5167·타입·lint clean, 카탈로그 7코드 등록) → 재감사 **SHIP**(6d2b2, muse-spark 대체 — DeepSeek 체인 무응답) → 병합 `7cf970b03` 승인·완료, auth 4행 migrated 확정(본 커밋). 웨이브2 전체 확정: BE 4 + FE 31 + MO 29.

**6h3 교정 (2026-09-18 00:0x KST):** 통합 게이트에서 공유 parity gate 1건 실패 — 6g2가 FE 3파일을 problem 계약으로 전환한 반면 모바일 대응분(11파일)이 퇴역 raw-English 헬퍼에 잔류, 동일 엔드포인트 cross-platform shape 분기 + 6h2 감사 grep 누락 + 인벤토리 오기 3·미분류 8. 교정 유닛 `aa2e32c60`(12파일 +402/−66, mobile 263/1775·공유 jest 27/423+scripts 86/86·타입·lint clean, 게이트 마커 현대화 포함) → 재감사 **SHIP**(6h3b) → 병합 `4f1ba8d1f` 승인·완료, 8행 재분류+3행 사유 갱신(본 커밋, migrated 249).

**6g4 교정 (2026-09-18 01:0x KST):** FE 타입게이트에서 6g2 유닛의 `upstreamStatusProblemResponse` 2인자 호출 10곳 오류 — 3번째 `outcome` 인자 누락(6g2 워커·감사 모두 미검출, jest는 babel 변환이라 통과). 런타임 동일 수정(`403→NOT_APPLIED` 1곳, 나머지 `UNKNOWN` — 현 default와 동일) `2634f19f4`(6파일 10줄) → SELF 검증(tsc 0 + touched 15/56) → 병합 `eae389265` 승인·완료.

**통합 게이트 (2026-09-18 01:0x KST, HEAD `eae389265`):** BE 362/362·5173 통과(초회 pnpm 스토어 stale로 12 실패 → relink 후 재실행, 잔여 3건은 병렬 플레이크·고립 통과 확인; pdfjs 환경 플레이크 별도), BE tsc 0·lint 0e, 공유 jest 27/423+scripts 86/86(parity 포함), MO 263/1775, FE 287/1743+tsc 0. 웨이브2+교정 close.

**Phase 6.1 배치1 (2026-09-18):** 잔여 legacy 263행을 7개 유닛으로 분할(BE usecase 15+31·컨트롤러 25·FE BFF 40·MO BFF 22·FE 클라이언트 70·MO 클라이언트 57; 공유 3행은 verify-only). 6.1a(BE `247f7a2ad`, 신코드 0) → SHIP 61ab → 병합 `fa5c84b51`. 6.1e(MO `509d27f98`) → SHIP 61eb → 병합 `bce8f329b`. 6.1d(FE `3a37230c4`, 72파일) → SHIP 61db → 병합 `90e716462`. 77행 migrated 확정(본 커밋, migrated 326·legacy 186). 6.1b/6.1c 진행 중.
- carried: 6d1 gated e2e 2건(live DB), 6g1 N2~N6(json 10파일·check-phone·area-templates read·stream boundary), 6h1 N4(agent passthrough)·AUTH_REFRESH_REPLAY_CONCURRENT 카탈로그 등록, pdfjs 환경 플레이크.

**인시던트 · 6.1c 행 반영 (2026-09-22 03:xx KST):** 9/18 12:51 KST에 em-61f2·em-61g2·em-61bb 감사 세션이 프로바이더 장애(zai) → muse 폴백 → rate limit으로 연쇄 중단. 이후 `/tmp/em-6` 전체가 정리(슬립 중 tmp cleanup)로 소실 — 워커 브리프·리스트·로그 유실(git 작업물 무손실). 복구: 세션 export(`~/.local/state/agents/session-exports/opencode/`)에서 브리프 원문 복원, 리스트는 인벤토리 legacy 행에서 재생성(70 FE·57 MO·31 BE·25 controllers 일치 확인). 산출물을 내구성 경로 `/Users/jaino/Development/babyjamjam-admin/.bjj319-em/`로 이전. 6.1c 행 25건 migrated 반영(본 커밋, migrated 351·legacy 161). 61b 재감사(em-61bb2)·61f/61g 재개(em-61f3/em-61g3, 각 41/51 파일 잔여) 진행 중.

**6.1 마감 (2026-09-22 05:1x KST):** 61f(002e86782, SHIP 61fb)·61g(686583ea3+f6af0485c+c812e1e20, SHIP 61gb) 병합. 잔여 3행(shared 어댑터: user-error-message/api-error-message/route-utils)은 verify-only → approved-exception(problem-contract 우선·살균 출력; English 401 기본값은 documented carried gap). **legacy 0 달성**: migrated 509·no-direct 282·approved-exception 5·removed 1. 중간 사고: /tmp 소실 복구 기록은 상단 인시던트 항목 참조.

**6.1 통합 게이트 (HEAD `8fa96f1b2`+baseline 재핀 `442cd33b3`):** 전 항목 green — BE tsc 0·eslint 0·test 364/5201(2회차 user.controller.integration 401v400 병렬 플레이크, 고립 53/53 통과), UI baseline 게이트 0(6.1f/g 라인시프트 266건 재핀 — 배열 길이 전수 동일 검증, reviewed commit), 공유 27/423, MO tsc 0·test 268/1834, FE tsc 0·test 307/1812. middleware 401/403 바디에 코드 추가(AUTH_REQUIRED 신규 부착, AUTH_REFRESH_REPLAY_CONCURRENT/BRANCH_SELECTION_REQUIRED는 local-only session 신호로 카탈로그 밖 유지 — 6h1 carried 항목 종결). carried: e2e `service-record-write-lock-races-lifecycle-client.e2e.spec.ts` L429·478 퇴역 코드 pin → Phase 9 갱신; 61fb/61gb 잔여(비차단).

**Phase 8 Task 8.1 (2026-09-22 05:2x KST, `7c1085a59`):** OSV 스캔(v2.6.0, `osv-scanner scan --lockfile=pnpm-lock.yaml`, CI security.yml과 동일 도구) 결과 1631 패키지 **취약점 0** — 의존성 변경(major/minor bump) 자체가 불필요. 미사용 suppression 2건 정리: uuid는 11.1.1로 이미 상향(제거 조건 충족), @hono/node-server 1.19.15는 어드바이저리가 더는 매치되지 않음(스캔이 unused ignore로 보고). 두 ignore 제거 후 suppression 없이 재스캔 → **No issues found**. osv-scanner.toml은 감사 정책 헤더만 유지. lockfile·package.json 무변경.

**Phase 7 Task 7.1 (2026-09-22 05:3x KST, `e6e9e156b` → 병합):** 상태 전이 검증 완료 — (a)등록 성공+발송 실패 (b)접수 후 저장 실패=UNKNOWN+상태확인 (c)동시 claim(claim token CAS) (d)timeout/재claim (e)재시도 소진(terminal) (f)부분 접수 영속. **결함 1건 수정(red-first)**: `sms-retry.service.ts` — partial/uncertain 재시도 시 attempt 행에만 marker가 남고 source 행이 retryable로 남아 재시작/재클릭 시 **전체 수신자 재발송(중복)** 가능 → source 행에도 durable `retrySafety` fence + `retryById`가 uncertain-fenced를 `REQUEST_CONFLICT`로 거부. Phase 2a residual("mounted 화면 수명 밖 안전성") 종결. 검증: BE tsc 0, full 5205✓/0✗(run2; run1 webhook 401 병렬 플레이크→고립 28/28✓). 감사 **SHIP**(7-1b): non-CAS source fence 수용(attempt-row CAS가 동시성 fence), 잔여=기존 prod 행 backfill 미실시(다음 attempt 시 fence)·late-fence/`reconciled-*` 비-CAS 경합(log-visible, send-safety 무영향)·uncertain-gate 직접 spec·fence 관측성 carried.

**Phase 9 Task 9.1 (2026-09-22 05:5x KST, `6fd792036` → 병합):** 전 항목 green. D1 인벤토리 감사(누락 0) 중 **1.1 스캔 창 누락 발견** — branch system-template 컨트롤러+4 BFF 프록시+`problem-bodies.ts` 헬퍼 → 정직한 6행 추가(803행, migrated 513·approved-exception 7). D2 어댑터 센서스 표(FE 1/MO 12/266 BFF 등). D3 raw-500 스캔: 위반 1건(`fetchNotifications/fetchUnreadCount` 실패를 `[]`/`0`으로 삼킴) red-first 수정(6 red→9 green), 잔여 14건은 local-capability 의미론 문서화. **D4 신규 intake 게이트** `packages/shared/scripts/raw-error-intake-gate.mjs`(인벤토리에서 스캔 루트/패턴 파생, 2036파일 0위반; 통합 검증 완료) — 새 원시 오류 유입 차단. D5 11개 시나리오 전부 PASS 증거 매핑(실환경 Sentry만 Phase 10 이월). D6 e2e 퇴역 핀 2건 `REQUEST_CONFLICT` 갱신(프로덕션 throw 검증). D7 exact-HEAD 전체 회귀 green(shared 27/423+node91, BE 364/5205/45skip, FE 308/1821, MO 268/1834, ui baseline 일치). 감사 **SHIP**(9-1b) — carried: BRANCH_CONTEXT_CHANGED 카탈로그 등록(갭), NotificationBell 전용 오류 UI(데이터 계약은 준수), live-DB/e2e 레인·실환경 Sentry(Phase 10).

**Phase 10 Task 10.1 (2026-09-22 06:0x KST, `28132fded` → 병합):** `docs/error-management-live-verification.md`(204행) — 대상 정의 blanks·read-only 우선 절차·중지/정리 조건·증거 양식·승인 gate·Sentry(BJJ-317) 수신 검증 절차(공개 code/outcome/requestReference, 중복 0, PII/토큰 비노출). 인벤토리에 `live_verification: runbook-prepared; execution-not-approved; executed:false`. 감사 **SHIP**(10-1b). **실행은 미승인 상태** — main의 별도 승인 필요(문서·인벤토리 모두 명시).

**Phase 11 Task 11.1 (2026-09-22 06:1x KST, `a764d7226` → 병합):** `docs/error-management-rollout.md`(121행) — 후보 SHA 고정(`06a8b68af` 기준, Phase 4b~10.1 140커밋), 단계별 감사 요약표, 배포 순서(backend→호환 클라이언트→어댑터 제거 gate), 롤백(이미지/SHA blanks + `retrySafety` marker-blind 버전 롤백 금지), 관측 blanks(수치 발명 없음), 종료 체크리스트(live verification gate OPEN → BJJ-319 종료 제안 불가 상태 정확 표기), 승인 게이트 명시. 감사 **SHIP**(11-1b).

**세션 종합 (2026-09-22, 최종 HEAD `3e91b26d6`, clean):** Phase 6.1~11의 실행 가능한 작업 전부 완료 — 6.1(legacy 0, 통합 게이트 green) · 7.1(SMS 재발송 결함 수정+상태 전이 검증) · 8.1(OSV 0, suppression 정리) · 9.1(intake 게이트 신설+빈-성공 결함 수정+11 시나리오 증거+전체 회귀 green) · 10.1(실환경 검증 runbook) · 11.1(배포/롤백/관측 문서). 최종 재확인: intake gate 0위반·ui gate 0·OSV 0. **남은 2개 승인 게이트(사용자):** ① Phase 10 실환경 검증 실행(대상/건수/비용/중지 조건 확정+승인; runbook `docs/error-management-live-verification.md`) ② Phase 11 dev 병합 승인(후보 SHA 제시 필요; merge commit, squash 금지). BJJ-319 종료 제안은 ①의 실제 증거 확보 후에만.

**PR #734·#735 병합 실행 기록 (2026-09-22 18:55~19:30 KST, OpenCode 세션):** 사용자 승인("둘다 문제들 해소하고 병합")에 따라 두 PR을 merge commit으로 main에 병합. **#734**(service-record 입력 가이드·ISO 생일·관리자 헤더 검증, branch `fix/service-record-input-guidance-20260921`, codex 스레드 3건 resolved) → main `74594fbce`. **#735**(preview 승격: 메시지 규칙 평가·관리자 E2E·인증 케이스·agent-manifest, branch `preview`, codex 스레드 6건 resolved) → main `b2e525a58`(preview head `0322619fb`). 병합 시맨틱 검증: `admin-service-record-edit.service.ts`에 #734 ISO 검증과 preview problem-body 양쪽 모두 보존. post-merge CI(main): Frontend·Mobile·Mobile Unit·Shared Contracts·Security Review·Backend Full Flow·Database Patches 전부 success, Backend CI `b2e525a58`까지 **전 job success**(LightNode fallback deploy 성공; Lightsail deploy는 해당 런에서 target resolution으로 skipped). 잔여 비차단 2건: ① advisory Playwright PR-run `service-record-final-flow.spec.ts:104` ⑧ 모유수유 spinbutton 타임아웃 3회 — **tree 동일 증명**(merge ref tree == head tree `a5588beaf`)+동일 head push-run green+본 변경 영역 밖 → 환경 flake 종결 ② preview push의 `deploy Lightsail backend` OIDC 실패는 09-17부터 pre-existing AWS infra(AssumeRoleWithWebIdentity 거부, 코드 아님). 스키마 변경 보고: `service_record(_case).mom/baby_birth` VarChar(6→10) 확장 마이그레이션 `20260921230000` — 근거 ISO `YYYY-MM-DD` 저장, 기존값 보존·축소 거부형 idempotent SQL, 롤백은 코드 revert 후 혼재 데이터가 없을 때만 축소. 신규 의존성 추가 없음(.env 미변경). Linear BJJ-339·BJJ-340 Done 갱신. clean task worktree 3개(pr734-fix·pr735-msg-evals·pr735-auth-case) 병합 확인 후 제거. **남은 승인 게이트는 이전과 동일:** Phase 10 실환경 검증 실행 + 대상 환경 배포 승인(Phase 11), OIDC infra는 AWS 측.

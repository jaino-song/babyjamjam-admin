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


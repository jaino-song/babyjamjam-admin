# Error Management v1.0 적용 현황

기준: https://app.notion.com/p/3d60b049243480e388e3d2e409245e45
추적: BJJ-319. 이 문서는 구현 증거를 기록하며 전체 준수 선언이 아니다.

## 프로젝트 적용 프로필

- 전송: 전환된 HTTP 경계는 RFC 9457 application/problem+json, no-store.
- 코드/스키마/문구: packages/shared/src/errors/problem-details.ts. 공개 필드만 포함하며 backend/vendor/shared-agent는 동일 소스의 CommonJS 빌드다.
- type URI: 이 저장소의 이 문서 앵커. 한번 공개된 식별자의 의미와 URI는 바꾸지 않는다.
- UI 기본 언어: ko-KR. 카탈로그는 ko-KR/en-US를 제공하며 신규 서버 경계는 Accept-Language를 협상한다. 기존 화면의 한국어 표시 정책은 유지한다.
- 업무 시간대: Asia/Seoul. 이 초기 카탈로그는 날짜/수치 params를 허용하지 않으며 추가 시 권한/포맷 검증이 필요하다.
- 입력 검증: GlobalValidationPipe; body/query/path/custom 위치와 JSON Pointer를 보존한다. 기존 validation 400과 webhook 예외는 호환성을 위해 유지한다.
- 재시도: 새 오류 처리 계층은 자동 재시도를 실행하지 않는다. 변경 결과를 확인할 수 없으면 UNKNOWN이고 재실행보다 상태 확인이 우선이다. CHECK_STATUS는 정보이며 임의 URL/코드를 실행하지 않는다.
- 관측: 기존 Sentry 실행 경계 사용. 요청 참조는 서버가 생성해 응답과 진단 맥락에 연결한다. 새 operationId나 traceId를 만들어 업무/분산 추적이 존재한다고 주장하지 않는다.
- 소유 영역: 서버 경계/backend, 공개 계약/shared, 표시/frontend 및 mobile. 운영 보존기간과 알림 설정은 BJJ-317에서 별도 확인한다.

## 호환성 경계

신규 구조화 validation과 예상치 못한 서버 오류부터 변환한다. 등록되지 않은 기존 4xx 업무 예외를 일반 500으로 덮지 않고 기존 경로로 유지한다. 기존 response message/error/statusCode는 구버전 소비자를 위한 별칭이며 새 소비자는 type/code/status를 함께 검증한다.

packages/shared/src/errors/user-error-message.ts의 문자열 기반 번역은 기존 응답 전용 이행 어댑터다. 새 Problem Details는 이 어댑터보다 먼저 런타임 검증한다. 알 수 없는 type/code, 모순된 HTTP 상태, 잘못된 params/actions는 레거시 코드 분기로 우회하지 않는다.

제거 조건: 전체 기능의 서버 오류 코드 전환, 웹/모바일 개별 입력 연결 및 복구 검증, 지원 중인 구버전 소비자 호환 검증을 모두 완료한 뒤 레거시 어댑터와 별칭을 제거한다. 임의 날짜로 제거를 약속하지 않는다.

## 아직 전체 완료가 아닌 항목

- 등록되지 않은 모든 업무 4xx 오류의 코드 카탈로그 전환과 전수 경로 목록.
- 모든 화면의 필드별 연결, 초점, 입력 보존 및 지속 상태 UI 검증.
- 모든 외부 연동/비동기 작업의 outcome, 상태 확인, 동시 실행/멱등성/복구 검증.
- 서명된 계약 수정, 발송 응답 유실, 등록 성공 후 발송 실패, 동시 수정, 테넌트 경계의 전체 실환경 회귀.
- Sentry 운영 활성화/보존기간, preview 배포/롤백, production 검증.

## 검증 기록

통합 검증 후 실제 명령/결과와 독립 검토 결과를 기록한다. 위 미완료 목록을 체크 해제 없이 완료로 바꾸지 않는다.

## 공개 오류 코드

각 식별자는 공유 카탈로그의 HTTP 상태와 문구로 검증한다. 아래는 식별자 앵커이며 복구 행동을 보장하지 않는다.

### request-invalid

`REQUEST_INVALID`

### validation-failed

`VALIDATION_FAILED`

### auth-required

`AUTH_REQUIRED`

### access-denied

`ACCESS_DENIED`

### resource-not-found

`RESOURCE_NOT_FOUND`

### request-conflict

`REQUEST_CONFLICT`

### method-not-allowed

`METHOD_NOT_ALLOWED`

### request-expired

`REQUEST_EXPIRED`

### payload-too-large

`PAYLOAD_TOO_LARGE`

### media-type-unsupported

`MEDIA_TYPE_UNSUPPORTED`

### request-rate-limited

`REQUEST_RATE_LIMITED`

### internal-error

`INTERNAL_ERROR`

### dependency-unavailable

`DEPENDENCY_UNAVAILABLE`

### upstream-invalid-response

`UPSTREAM_INVALID_RESPONSE`

### upstream-timeout

`UPSTREAM_TIMEOUT`

### contract-already-signed

`CONTRACT_ALREADY_SIGNED`

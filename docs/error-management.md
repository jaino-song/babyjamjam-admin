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

## 적용한 고객 폼

- 웹 `frontend/src/components/app/clients/ClientFormDialog.tsx`의 dialog/panel과 모바일 `mobile/src/components/app/clients/ClientFormDialog.tsx`의 고객 편집 경로에 적용했다.
- `EM-VAL-02/03`, `EM-UI-01/02/03/06`: 모든 구조화 오류를 각각 표시하고, 이름/연락처는 입력란과 연결한다. 연결되지 않은 항목은 내부 JSON Pointer 대신 공통 공개 라벨로 표시한다. 실제 응답의 요청 ID만 표시한다.
- `EM-FE-02/07`, `EM-RETRY-05`: 입력과 편집 맥락을 유지하며 같은 고객의 재조회로 초기화하지 않는다. 검증된 UNKNOWN 및 비정상 응답/통신 실패의 UNKNOWN 모두 상태 확인을 안내하고 같은 폼 세션에서 재전송을 차단한다.
- `EM-I18N-01`: 공개 필드 오류는 공통 카탈로그, 연결되지 않은 항목 라벨과 상태 확인 안내는 `packages/shared/src/errors/problem-presentation.ts`를 사용한다.
- 이 UI 잠금은 서버 멱등성이나 상태 확인 API의 구현 증거가 아니다. 모바일 기본 `/clients/new` 등록 마법사는 후속 전환에서 같은 오류·입력 보존·재전송 차단을 적용했다. 나머지 화면의 전체 적용 여부는 아래 제한과 구분한다.

## 아직 전체 완료가 아닌 항목

- 등록되지 않은 모든 업무 4xx 오류의 코드 카탈로그 전환과 전수 경로 목록.
- 위 고객 폼 외 모든 화면의 필드별 연결, 초점, 입력 보존 및 지속 상태 UI 검증.
- 모든 외부 연동/비동기 작업의 outcome, 상태 확인, 동시 실행/멱등성/복구 검증.
- 서명된 계약 수정, 발송 응답 유실, 등록 성공 후 발송 실패, 동시 수정, 테넌트 경계의 전체 실환경 회귀.
- Sentry 운영 활성화/보존기간, preview 배포/롤백, production 검증.

## 후속 경로 조사 목록

아래는 후속 전환의 대표 진입점이며 전체 경로 전수 목록이나 결함 확정 목록이 아니다. 기존 상태·중복 방지 구조를 먼저 재사용하며 실제 실패 시나리오로 확인한다.

| 경로 | 후속 확인 범위 |
| --- | --- |
| `mobile/src/app/(shell)/clients/new/page.tsx` | 기본 고객 등록 마법사의 구조화 오류·필드 연결·UNKNOWN 복구 |
| `mobile/src/app/(shell)/contracts/new/page.tsx`, `mobile/src/app/(shell)/contracts/page.tsx` | 기존 headless/fallback 결과와 공통 outcome 연결; 자동 재실행 안전성은 별도 입증 |
| `backend/interface/controllers/eformsign-doc.controller.ts` | 기존 `ok/reason/failedStep/fallbackHint` 및 작업 조회 응답의 호환 전환 |
| `backend/interface/controllers/message-delivery.controller.ts` | 기존 부분 발송·자동 재전송 제한의 의미를 보존한 공통 모델 연결 |
| `backend/application/services/eformsign-document-job.service.ts`, `backend/application/services/eformsign-document-job-worker.service.ts` | 기존 claim/reconcile/retry-exhausted 상태와 공개 오류·운영 관측 연결 |
| `mobile/src/hooks/usePushNotification.ts`, `mobile/src/hooks/use-message-templates.ts`, `mobile/src/hooks/useClients.ts` | 정상 빈 결과와 조회 실패·예상치 못한 응답 형식의 구분 |

## 검증 기록

- 공통 HTTP 계약: backend 집중 테스트 45개, shared problem/proxy/route 테스트 41개 및 backend 타입 검사 통과. 실제 Nest HTTP 테스트에서 검증 거절은 변경 0회, 정상 요청은 변경 1회, 부수 효과 후 오류는 UNKNOWN임을 확인했다. 실제 DB 연결이나 외부 발송을 사용한 테스트가 아니다.
- UI 통합 `4c3bc1f2e`: 웹 전체 216개 suite / 1,375개 test, 모바일 전체 219개 suite / 1,365개 test 통과. 뒤이어 웹의 구조화 UNKNOWN 회귀 1개를 추가했고 해당 파일 4개 test를 통과했다.
- 로컬 브라우저: 웹 고객 등록 panel과 모바일 dashboard 고객 편집에서 두 필드 오류/요청 ID/요약 초점/필드 링크/입력 보존을 확인했다. UNKNOWN 후 입력·단계를 변경해도 저장이 잠겨 있고 합성 백엔드 요청 횟수가 1회임을 확인했다. 고립된 로컬 합성 서버를 사용했으며 실제 고객/DB/문자 발송은 변경하지 않았다.
- 공통 계약 독립 Sol 검수: `01939ec04`에서 SHIP. 기존 문구 단계와 UI 단계의 별도 검수는 쿠키 차단, 내부 필드명 표시, 공통 복구 안내 보완을 요구했으며 최종 통합 재검수 결과는 아래에 기록한다.

- 최종 통합 `72ce5d3c6`: 웹 전체 216 suite / 1,376 test, 모바일 전체 219 suite / 1,365 test, shared 21 suite / 244 Jest test + 76 Node test 통과. shared/web/mobile 타입 검사와 UI architecture gate 통과. 공통 민감정보 정책은 auth_token, refresh_token, Cookie, Set-Cookie 및 접힌 다중 쿠키 헤더를 검사하며 진단 로그도 같은 정책으로 마스킹한다 (`EM-SEC-01`).
- 최신 dev `ec85e6265`(메시지 템플릿 목록 변경) 통합 후 웹 217 suite / 1,386 test, 웹 타입 검사 및 UI gate 통과. UI 기준 충돌은 기존 35개 경고의 소스가 동일함을 대조한 뒤 줄 위치만 맞췄다. backend/mobile/shared 오류 처리 코드는 이 동기화에서 변경하지 않았다.
- 의존성 변경은 없으며 기존 의존성 감사에는 critical 2 / high 7 / moderate 8 / low 1 항목이 남아 있다. 이번 오류 처리 변경이 해당 취약점을 해결했거나 실제 악용 가능성을 입증한 것은 아니다.

위 미완료 목록은 전체 규격 준수 선언과 구분한다.

## 외부 문자 결과 해석 근거

[알리고 공식 SMS API 문서](https://smartsms.aligo.in/smsapi.html)의 `result_code`는 API 수신 결과이고 `success_cnt`/`error_cnt`는 요청 성공/실패 건수다. 따라서 접수 결과를 최종 배달 완료라고 표현하지 않는다. 음수 결과 코드의 실패 응답은 건수 필드가 없을 수 있으며, 성공 응답의 건수 모순·형식 오류는 미처리로 단정하지 않는다.

## 후속 전환 검증 · 2026-09-09

- 최신 `dev`의 메시지 템플릿 입력 보존 변경을 `a815224dd`에 통합했다. 웹 218 suite / 1,393 test, 타입 검사와 UI architecture gate 통과. 충돌한 이전 편집기는 새 공통 편집기를 재노출하고 안전한 오류 문구 처리를 실제 소유 컴포넌트로 옮겼다.
- `EM-OBS-01/02/03`, `EM-SEC-01`: 공통 HTTP 및 Prisma 경계가 공개 응답의 등록 코드와 확인된 outcome을 Sentry에 전달한다. `error.code`는 공개 카탈로그의 허용 값만 기록하며 요청 ID는 무제한 태그가 아닌 `requestReference` context로 유지한다. 새로운 보고 경계나 중복 capture를 추가하지 않는다. 잘못된 공개 계약이 500 응답으로 정규화되면 그 최종 상태로 기록한다.
- 이 관측 연결은 오류 코드/결과/요청 참조의 일치 및 태그 정화 테스트를 포함해 32개 테스트와 backend 타입·대상 lint 검사를 통과했다. 실제 Sentry 수신·보존기간·알림 설정의 운영 검증은 별도이며 이 결과로 완료를 주장하지 않는다.
- `7121518f2` 통합: backend 352 suite / 4,927 passed / 37 skipped, mobile 224 suite / 1,404 test, shared 21 suite / 251 Jest test + 76 Node test 통과. backend/mobile 타입 검사와 UI architecture gate 통과. 이 기록은 이후 수정의 검증을 대신하지 않는다.
- 모바일 등록 마법사는 구조화 오류 요약·필드 초점·입력 보존 및 UNKNOWN/PARTIALLY_APPLIED 재전송 차단을 적용했다. 합성 로컬 브라우저에서 두 필드 오류, 실제 입력 이동, 단계 변경 뒤 입력 유지, UNKNOWN 뒤 변경 요청 1회를 확인했다.
- 알림·고객·메시지 템플릿 조회는 정상 빈 결과와 비정상 응답/조회 실패를 구분하고 이전 데이터가 있는 실패를 화면에 표시한다.
- 독립 검토에서 문자 거절 뒤 예약 재시도, 일부 접수 뒤 전체 수신자 재발송, 재시도 응답의 느슨한 성공 판정이 발견됐다. 세 항목은 `4aa424532`에서 수정했고, 통합 `fb9d0d2f9`의 독립 Sol 재검수에서 해당 SMS 수정 범위 SHIP/HIGH를 받았다. backend 전체 353 suite / 4,954 passed / 37 skipped 및 타입 검사·빌드 통과.
- 계약 생성/완료/삭제/영수증 요청은 확인되지 않은 결과의 반복 실행을 막고 입력·오류·요청 참조를 유지한다. 계약 생성은 이미 확인된 고객을 보존하며 결과 불명 뒤 고객 삭제나 강제 재발송을 실행하지 않는다. 서명 창을 닫은 사실만으로 미처리라고 판단하지 않는다.
- 문자 작성 화면은 동일 제출에 안정적인 멱등성 키를 사용하고, UNKNOWN/PARTIALLY_APPLIED 뒤 내용 변경만으로 다시 보내지 않는다. 성공 응답은 실제 제출 수신자 수와 일치하는 정수 건수 및 오류 0건을 요구한다.
- 로컬 JSON/Zod 검증 실패는 실제 외부 요청 전 거절이므로 VALIDATION_FAILED/NOT_APPLIED와 생성한 요청 ID를 반환한다. 여러 오류·안전한 JSON Pointer·공개 문구를 유지하고 입력값·사용자 정의 내부 오류 문구는 노출하지 않는다. 모바일 고객 수정의 nullable primaryEmployeeId 호환성을 보완했다.
- 후속 UI/로컬 검증 통합: 모바일 226 suite / 1,442 test, shared 21 suite / 255 Jest test + 76 Node test 통과. 웹 218 suite 중 이전 형식의 두 테스트를 보정했고 해당 33개 테스트를 재검증했다(나머지 216 suite 통과). 웹·모바일 배포용 빌드 통과. 모바일 빌드는 외부 서비스 없이 localhost API 주소를 명시했다. UI architecture 위반의 파일별 종류와 수량은 동일하며 위치만 재정렬했다.
- 이 UI 잠금은 현재 화면 세션에만 적용되며 서버의 영속적인 멱등성 보장으로 해석하지 않는다. UI/로컬 검증 독립 검토에서 필수 enum/literal/union 누락의 분류 오류 1건을 발견해 `5e68c4a85`에서 수정했다. shared 21 suite / 258 Jest test + 76 Node test 및 타입 검사 통과, 해당 수정의 독립 Sol 검수 SHIP/HIGH로 기존 지적을 모두 해소했다. 이 검수는 선언된 단계별 변경 범위에 한정한다.

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

## 2026-09-10 웹 직접 문자 후속 검증

웹 `sendSms`가 원본 오류를 보존하며, TemplateSendForm은 검증된 NOT_APPLIED와 UNKNOWN/PARTIALLY_APPLIED를 구분한다. 불확실한 요청의 동일 화면 재발송 차단, 확정 접수 수신자 제외, 새 입력 보존, 중복 확인/발송 중 방식 전환 격리와 commit 이후 상태 갱신을 적용했다. 제공기록지의 외부 API와 발송 정책은 기존 동작을 유지한다.

제품 SHA `8cc87adf33553f9cdb86e494391eb8da00a7b2db`: 관련29 tests/3 suites·타입·대상lint·UI gate 통과. fresh Sol correction SHIP/HIGH가 이전 지적을 모두 닫았다. 검토 순서/정확한 base/제한은 `docs/plans/bjj-319-remaining-plan.md`에 기록했다. 기존 unused-import 경고1개는 유지된다.

잠금 수명은 mounted 웹 SMS 화면이며 새로고침/재접속의 영속 멱등성을 대신하지 않는다. Task1.1은 추적 소스3,111개/검색 후보797개를 조사 중이다. 후보는 결함 수가 아니며 `docs/error-management-inventory.json`의 미확인 항목은 완료로 승격하지 않았다. dev 병합·배포·실제 발송은 하지 않았다.

## 2026-09-10 문자 사전 거절 8분기 전환

`resolveSmsRecipients`의 남은 원시 400 분기 8개(지점 컨텍스트 누락, client+employee 동시 지정, 빈/무효 수신자, client/employee 1건 규칙, client·employee 연락처 불일치, 무료 수신자 중복 일치)를 `REQUEST_INVALID` + `NOT_APPLIED`로 전환했다. 발송 전 거절이며 승인·로그 쓰기·공급자 호출 0회, 빈 params, 민감정보 비노출은 그대로다. 공유 카탈로그와 vendor는 변경하지 않았고 신규 공개 코드도 만들지 않았다.

통합 `f91fabdba`(base `5f87f8a3`, unit `5c6632133`): controller 46 + problem-response 8 = 54 tests, backend 타입·대상 lint·diff check 통과, red-first 11 failures 확인. read-only auditor FINAL SHIP/HIGH. 매핑·증거는 `docs/error-management-inventory.json`의 `sms-recipient-presend-legacy`(migrated)에 기록했다. 예약 일시 검증과 `ensureApproved` 승인 오류는 아직 레거시이며 Task 2.1 전체·Task 1.1·전체 이슈는 미완료다.

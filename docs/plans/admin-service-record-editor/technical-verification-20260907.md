# 날짜 연동 기술 검증 — 2026-09-07

검증 기준 커밋: `110dbbb8411ef3b6ff51f97f3077c86694cff854`.
결론: 기존 기능의 로컬 검증 통과. 새 관리자 수정 확정 기능 및 실제 이폼사인 변경 검증은 미완료.

## 실행 결과

- Prisma Client 미생성으로 최초 실행 시 8개 suite가 컴파일 단계에서 실패했다. `pnpm exec prisma generate` 후 동일 대상과 일정 통합 테스트를 실행하여 해결했다. DB 마이그레이션이나 데이터 변경은 하지 않았다.
- 일정·기록지·계약 자동 완료·영수증·문서 작업: 13 suites / 191 tests 통과.
- 메시지 처리·작업 저장·영업일 계산: 4 suites / 255 tests 통과.
- 합계: 17 suites / 446 tests 통과. 외부 서비스와 DB의 대역을 사용하는 기존 테스트이며 운영 E2E 증거가 아니다.
- `pnpm exec nest build`: 통과.
- `pnpm run verify:pdf-rasterizer`: 통과. 실제 합성 PDF 두 페이지를 PNG로 렌더링하고 페이지별 색상, 크기, 잘못된 페이지와 크기 거부를 확인했다. 실제 산모 계약서나 한글 서명 보존의 증거는 아니다.
- 빌드된 기존 영업일 함수로 별도 메모리 내 계산 실험: 5/10/15회 × 시작일 3종(9월 일반일·추석 전·연말) × 1/2/5영업일 이동 = 27개 시나리오 통과. 회차 수·날짜 중복 없음·영업일·종료일 이동량·후속 회차 간격을 검증했다. 불규칙 간격 1개 시나리오도 통과. 관리자 확정 구현의 테스트가 아닌 계산 가능성 검증이다.

## 재현 대상

backend에서 `pnpm exec jest --runInBand` 뒤 다음 파일을 지정한다.

```text
test/unit/schedule-change.service.spec.ts
test/services/service-record-lifecycle.service.spec.ts
test/services/contract-auto-finalize.policy.spec.ts
test/services/contract-auto-finalize-scheduler.service.spec.ts
test/services/receipt-link-token.service.spec.ts
test/services/receipt-link-issue.service.spec.ts
test/services/receipt-link-cleanup-scheduler.service.spec.ts
test/services/eformsign-document-job-worker.service.spec.ts
test/services/eformsign-headless.service.spec.ts
test/usecases/eformsign-doc/sync-client-end-date.usecase.spec.ts
test/usecases/eformsign-doc/finalize-document-headless.usecase.spec.ts
test/integration/service-record.schedule-change.integration.spec.ts
test/integration/schedule-change.controller.integration.spec.ts
test/services/message-trigger.service.spec.ts
test/services/message-trigger-delivery.service.spec.ts
test/repositories/sb.message-trigger-job.repository.spec.ts
test/unit/business-days.spec.ts
```

실행 결과 JSON(임시): `/tmp/admin-date-verification-tests.json`, `/tmp/admin-date-message-tests.json`.

## 실제 문서 검증 상태

브라우저에 열린 이폼사인 문서는 이번 산모 계약서와 다른 회사의 근로계약서 초안이었다. 읽기만 했으며 수정·저장·전송하지 않았다. 사용자에게 검증용 산모 계약서 이름 또는 링크를 요청했다.

기존 live E2E 파일은 발견했으나 외부 문서 생성 및 이메일 발송 옵션을 포함하므로 이번 검증에서 실행하지 않았다. 기존 완료/스냅샷 재시도 테스트가 새 계약서의 서명 이관 기능을 증명하지 않는다.

다음은 테스트 문서에서 별도 확인이 필요하다.

1. 검토 단계에서 날짜 필드 변경 후 저장만 수행하고, 문서 상태·기존 서명·본인부담금 수령일·금액이 유지되는지 재조회한다. PDF에도 변경 날짜가 반영되는지 확인한다.
2. 완료된 테스트 계약서를 원본으로 새 문서 생성 시 기존 서명 보존 및 재서명 요청 없는 처리가 가능한지 확인한다. 단순 중복 생성 방지와는 다른 검증이다.
3. 구현 후 동시 관리자 확정·제공인력 제출·자동 계약 완료·문자 발송 경합을 실제 독립 테스트 DB에서 검증한다.
4. 구현 후 기존 영수증 링크와 만료일을 유지한 이미지 교체, 오래된 문서 이벤트의 날짜 되돌림 방지, 중간 실패 재시도를 검증한다.

## 확정된 불변 조건

duration/바우처 제공 일수, 금액, 본인부담금 수령일, 실제 최초 서명 시각은 일정 수정으로 변경하지 않는다. 관리자 화면의 최초/수정 서비스 날짜 표시와 문서의 수정 서비스 날짜 표시는 실제 서명 시각과 구분한다.

최종 계획이나 제품 구현은 이번 검증 과정에서 변경하지 않았다.

## 사용자 제공 테스트 대상 확인

사용자가 본인 이름과 연락처로 테스트 산모 생성을 요청했다. 로컬 등록 화면에서 같은 연락처의 중복 안내가 발생하여 등록을 취소했다. 운영 관리자 화면에서 사용자 제공 이름·연락처가 일치하는 기존 기록(client 88)을 확인했다. 기존 서비스는 2026-07-09~2026-12-31, duration 118이고 여러 과거 완료·만료 계약서가 연결되어 있다. 사용자는 기존 기록 재사용을 승인했다.

### 승인 후 운영 화면에서 수행한 작업

- 고객 수정 화면의 신규 직원 등록으로 `송진호_날짜검증` 직원 1명을 사용자 제공 연락처로 생성했다. 이 직원은 운영 데이터에 남아 있다. 산모 배정은 저장되지 않았다.
- 테스트 일정을 준비하며 5회 바우처와 2026-11-24 시작일을 입력해 고객 저장을 두 번 시도했다. 모두 HTTP 409 `SERVICE_RECORD_START_DATE_LOCKED`로 거부됐다. 기존 duration 118을 5회로 바꾸는 시도는 확정된 duration 불변 조건에 맞지 않으므로 재시도하지 않는다.
- 수정 폼을 취소했다. 재조회한 고객 화면은 `일반 · 118일`과 기존 계약서 목록을 유지했다. 새 산모나 전자문서는 생성하지 않았고, 계약서 수정·서명·명시적 문자 전송은 수행하지 않았다.
- 현재 일반 수정 폼의 기간 선택은 5/10/15/20일이며 기존 118일 자료를 그대로 유지해 테스트 담당자만 배정하는 경로도 확인하지 못했다. API 잠금을 우회하거나 DB를 직접 변경하지 않았다.
- 별도 이폼사인 탭의 전체 작성 가능 템플릿 목록을 확인했다. 현재 `(주)커버넌트랩스` 로그인에서는 근로계약서 및 제공기록지 5/10/15/20회만 표시되고, 산모 계약서는 표시되지 않았다. 이 목록은 현재 계정의 접근 범위에 대한 증거이며 운영 API 계정의 템플릿 존재 여부를 증명하지 않는다.

### 남은 외부 검증 조건

산모 계약서에 접근할 수 있는 이폼사인 계정 또는 검증용 계약서 화면이 필요하다. 검토 단계 계약서에서 저장만 수행한 뒤 같은 문서 ID·서명·수령일·금액·상태가 유지되는지, PDF 날짜가 변경되는지는 여전히 미검증이다. 기존 118일 자료를 5회로 바꾸어 검증하지 않는다.

## 추가 로그인 후 실제 이폼사인 확인

사용자가 새 Chrome 프로필에서 로그인했다. `인천 아이미래로` 계정의 대시보드에서 산모 계약서 템플릿과 문서함 접근을 확인하여 위 로그인 접근 조건은 해소됐다.

- 사용자 본인 제공기록지 `33e33a426dab4d7ea307228c866c42d4`(1/3)를 검토하기로 열었다. 상단에 임시 저장과 전송이 있었지만 날짜 입력은 disabled였다. 검토 단계라는 이유만으로 날짜 수정 가능하다고 가정할 수 없다. 이는 제공기록지의 관찰이며 산모 계약서 필드 권한까지 증명하지 않는다.
- 같은 본인 문서의 목록 수정 버튼은 `문서를 수정하면 현재 단계부터 문서가 다시 진행됩니다`와 수정 중 다른 참여자는 미리보기만 가능하다는 확인창을 표시했다. 확인하지 않고 취소했다. 상태를 보존하는 단순 필드 저장과 동등한 경로로 취급하지 않는다.
- 완료된 본인 계약서 `983163e5f7c54654907dc0178a2b557d`의 새 문서 작성 옵션을 열었다. 입력 내용 가져오기는 최초 작성자에게 할당된 항목만 복사하며, `서명, 회사 도장, 손글씨 입력항목의 내용은 가져오지 않습니다`라고 명시했다. 템플릿이 업데이트되어 새 템플릿으로 작성한다는 안내도 있었다. 확인하지 않고 취소했다.
- 따라서 기본 재작성 UI는 기존 서명 이관 요구의 해결책이 아니다. API/임베딩의 별도 지원 가능성은 이 UI 관찰로 부정하거나 입증할 수 없으며 추가 검증해야 한다.
- 이번 추가 로그인 이후 문서 저장·생성·전송·서명은 수행하지 않았다. 계약서 날짜 저장 후 재조회/PDF, 서명 보존 재생성, 영수증 URL 유지 교체는 여전히 미완료다.

## 기존 고객 삭제 후 재등록 요청

사용자가 기존 송진호 고객을 삭제하고 새로 생성하여 테스트하라고 명시적으로 요청했다. 운영 고객 화면에서 이름과 제공 연락처가 일치하는 기존 고객을 선택하고 삭제 확인 버튼을 실행했다. 서버 응답에 따른 UI는 `고객을 삭제하지 못했습니다` 및 `연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다`를 표시했다. 삭제는 실패했으며 새 고객은 생성하지 않았다. 연결 데이터를 직접 지우거나 삭제 보호를 우회하지 않았다. 서명 후 계약 완료 전의 산모 계약서 날짜 변경 검증은 계속 미완료다.

## 별도 테스트 계약서 작성 진행

사용자 진행 지시에 따라 이폼사인의 현행 남동구 템플릿 `7a632a0c98a04bf38e678affcb73f815`에서 신규 작성했다. 제목은 입력값에 따라 `인천아이미래로_남동구 계약서_송진호(테스트)`가 되었다. 필수 항목 20/20 입력을 화면에서 확인했다. 기간은 기존 고객과 같은 2026-07-09~2026-12-31, 금액은 1,464,000/1,002,000/462,000원이다. 수령일/영수증 작성일은 검증용 값 2026-07-09를 입력했다(실제 입금 사실 확인값이 아님). 제공기관 도장 3개를 테스트 작성 화면에 적용했다. 이름과 안내문에 테스트임을 표시했다.

전송 확인창에 사용자 제공 수신 번호와 이름을 입력하고 제공기관 검토 단계를 확인했다. 실제 계약/결제 증빙으로 사용하지 않는 날짜 연동 기술 검증 문서라는 안내를 작성했다. 최종 전송은 실행하지 않았다. 임시 저장 클릭 후 저장 성공이나 문서 ID는 확인되지 않아 저장 완료로 간주하지 않는다. 현재 작성 화면을 보존했으며 아직 서명 완료 전이다. 관리자 고객 연결이나 DB 반영을 증명하는 작업은 아니다.

### 서명 요청 전송 완료

이후 사용자가 실제 발송 질문에 `진행`으로 승인했다. 송진호/사용자 제공 번호의 SMS·카카오톡 수신 설정을 확인하고 최종 전송을 실행했다. 진행 중 문서함에서 문서 `51f2d41e00ed45d79f76bbef406c7d4a`, 제목 `인천아이미래로_남동구 계약서_송진호(테스트)`, 현재 단계 `이용자 송진호`를 확인했다. 다음 단계는 제공기관 검토이며 아직 완료가 아니다. 테스트 안내문도 이력에 표시됐다. 이는 전송 처리 및 문서 생성 확인이며 휴대폰 실제 수신 여부는 별도다. 사용자 서명 후 검토 단계 수정 검증을 이어가야 한다.

### 사용자 서명 후 계약서 수정 경로 실험 (2026-09-07)

사용자가 서명 완료를 알렸고 동일 문서 이력에서 이용자 처리 시각 16:01, 현재 제공기관 검토, 완료 시각 없음이 확인됐다. 검토하기 경로의 계약 기간 필드는 읽기 전용이었다. 테스트 문서 목록의 수정 확인을 실제 승인하여 request_type=doc_update 경로로 진입했다. 이 경로에서는 계약 기간과 영수증 항목을 편집할 수 있었다.

- 화면에서 계약 종료일을 2026-12-31에서 2027-01-04로 변경했다. 시작일은 2026-07-09 유지. 이는 vendor 필드 편집 실험이며 고객 duration 또는 일정 알고리즘 검증이 아니다.
- 종료일의 다른 년/월/일 필드는 함께 반영됐지만 영수증의 문자열 서비스 기간은 그대로였다. 서비스 기간을 별도로 20260709 ~ 20270104로 입력하고 포커스를 이동하자 같은 문자열의 다른 두 위치도 반영됐다.
- 영수증 수령일과 작성일 2026-07-09, 총액/지원금/본인부담금 1,464,000/1,002,000/462,000은 편집 화면에서 유지됐다.
- 수정 진입 시 필수 항목은 17/20이었다. 미입력으로 안내된 제공기관 도장 3개에 기존과 같은 인천 아이미래로 도장을 적용하여 20/20으로 만들었다. 이용자 서명은 새로 입력하지 않았다.
- 수정 화면의 전송 버튼을 열면 수신자가 제공기관 검토가 아니라 이용자로 표시됐다. 최종 전송은 실행하지 않고 취소했다. 따라서 이 경로의 재서명 없는 검토 단계 유지 저장은 검증 실패/미완료다. 일반 수정 UI가 요구사항을 충족한다고 결론내리지 않는다.
- 임시 저장을 클릭했지만 성공 알림이나 재조회로 지속 저장을 입증하지 못했다. 나가기를 시도했을 때 미저장 변경 경고가 나타나 이동을 취소했다. 날짜 수정 및 도장 입력 화면을 열린 채 보존했다. 저장 성공 또는 서버의 현재 단계 보존을 주장하지 않는다.
- 수정 화면의 이용자 서명 자리에는 펜 모양이 보여 기존 서명 이미지 보존 역시 확인되지 않았다. 실제 서명 일자 필드는 2026-09-07로 남아 있었으나 이미지 보존 증거와는 별개다.

추가 SMS 전송과 계약 완료 처리는 하지 않았다. PDF 재생성, 동일 문서의 검토 단계 유지 저장, 기존 서명 이미지 보존, 관리자 고객/영수증 URL 자동 연동은 여전히 미검증이다. 최종 설계 확정 전에 검토 단계의 필드 권한 및 지원되는 API/임베딩 저장 동작을 별도로 확인해야 한다.


## 최신 확인 단계 테스트 결과 — 2026-09-07

- 남동구 최신 템플릿 테스트 문서 `d54eae92480941b4b656dfda2ffb93b7` (확인단계테스트). 이용자 처리 이력 16:44 KST를 문서함에서 확인했다.
- 처리할 문서함의 검토하기 → 제공기관 확인 참여자 화면으로 진입했다. 목록의 수정/doc_update 경로를 사용하지 않았다.
- 계약 종료일 2026-12-31 → 2027-01-04 변경. 영수증 기간은 자동 변경되지 않았으며 별도로 `20260709 ~ 20270104` 입력했다. 영수증 양쪽과 8페이지 기간은 같은 필드로 함께 반영됐다.
- 임시 저장 후 문서함으로 나갔다 다시 편집(doc_tempsave)으로 열어 변경 계약 종료일, 영수증 기간, 기존 이용자 서명 그림, 금액 1,464,000/1,002,000/462,000 및 본인부담금 수령일 2026-07-09 유지 확인. 문서 ID와 제공기관 확인 단계 유지. 전송/완료하지 않았다.
- 검증 경계: 제공기관 화면의 저장·재접속 결과다. API 자동 갱신, 일반 미리보기/공용 다운로드 출력, 영수증 URL 이미지 교체, 서구 실문서 저장, 완료 문서의 재서명 없는 신규 생성은 아직 검증되지 않았다. 앱 고객과 연결된 변경이나 duration 유지 검증도 아니다.
- 이전 문서 `51f2d41e00ed45d79f76bbef406c7d4a`는 이전 실험의 수정 중/제공기관 작성 상태이며 새 워크플로우로 소급 변경되지 않았다. 해당 문서에서 이전 테스트 종료일 저장은 재접속으로 확인했지만 올바른 확인 단계 검증 증거로 사용하지 않는다.

## Phase 0 오프라인 characterization 추가 — 2026-09-08

허용된 테스트 경로에 기존 동작을 확인하는 대역 기반 사례를 추가했다. 제품 코드, DB, 외부 제공자, 브라우저, SMS, 스케줄러는 실행하거나 변경하지 않았다.

- `CreateAndSendContractUsecase`를 같은 idempotency key로 두 번 호출해 첫 제공자 수락 후 호출자 응답이 유실된 경우를 재현했다. durable acceptance의 동일 remote id를 재사용하고 제공자 생성 호출은 1회로 유지하며, 재생 시 기존 mirror projection 보존 플래그와 client link 복구 입력을 확인했다.
- 제공자 응답 및 문서 ID가 불명확한 오류 뒤 같은 key 재호출은 `uncertain`으로 남고 두 번째 제공자 생성·수락·mirror 기록을 수행하지 않는지 확인했다. 자동 reconciliation이나 전체 복구 성공은 주장하지 않는다.
- `assertSeoguRevisionOnlyAllowedFieldChanges`에 종료일 벡터 일부만 갱신된 after 응답을 넣어 거부하는지 확인했다. 이는 helper의 allowlist/벡터 검사 범위만 증명한다.
- `downloadSeoguRevisionPdfWithReadonlyRetry`에 일시적인 HTTP 200 비PDF 응답 반복, 3회 소진, 비재시도 상태(401), 문서 ID allowlist를 넣어 재시도 경계를 확인했다. `%PDF-` 형식만 맞는 stale body는 첫 시도에 반환될 수 있음을 characterization gap으로 기록했으며 freshness 회복을 주장하지 않는다.

실행 결과:

```text
pnpm exec jest --config jest.config.ts test/usecases/eformsign-doc/create-and-send-contract.usecase.spec.ts test/e2e/helpers/eformsign-seogu-revision.live.helper.spec.ts --runInBand --testPathIgnorePatterns=/node_modules/
2 suites / 27 tests passed
pnpm exec tsc --noEmit
passed
pnpm exec eslint test/usecases/eformsign-doc/create-and-send-contract.usecase.spec.ts test/e2e/helpers/eformsign-seogu-revision.live.helper.spec.ts
passed
git diff --check
passed
```

이 결과는 오프라인 characterization 증거이며, 실제 이폼사인 PDF 내용의 최신성·서명 보존·자동 reconciliation·새 관리자 수정 확정 흐름을 검증하지 않는다. Phase 0 및 새 계약/서명 흐름은 계속 열려 있다.

## Phase 0 완료 계약 재작성 capability probe — 2026-09-08

완료된 원본 계약 `4f58a134b5864ecf9af283607cebba9d`를 보존한 채 새 사용자 서명 요청을 한 번 생성하는 별도 capability probe를 추가했다. 구현은 다음 네 경로에 한정한다.

- `backend/test/e2e/helpers/eformsign-completed-reissue.live.helper.ts`
- `backend/test/e2e/helpers/eformsign-completed-reissue.live.helper.spec.ts`
- `backend/test/e2e/eformsign-completed-reissue.live.e2e.spec.ts`
- 이 문서의 본 절

오프라인 테스트는 synthetic fixture와 주입 가능한 API/PDF 경계를 사용한다. 외부 API, DB, 브라우저, SMS, 제품 모듈, Prisma, 스케줄러는 호출하지 않는다. 원본 PDF의 SHA-256 및 바이트 수, 현재 완료 상태, 원본 템플릿 ID, enabled/released/version과 write → 이용자 participant → 내부 제공기관 participant → reviewer inheritance → complete 토폴로지를 먼저 확인한다. 필드는 정확한 18개 allowlist만 사용하며 이용자 서명·도장·동의·제공인력·서명일은 payload에 넣지 않는다. 시작일 2026-07-09, 본인부담금 수령일 2026-07-09, 서비스 비용/정부지원금/본인부담금 1,464,000/1,002,000/462,000과 서비스 가격은 원본 값을 보존하고 종료일만 2027-01-07, 서비스 기간만 20260709~20270107로 바꾼다.

생성 테스트는 `LIVE_E2E=1`과 아래 전체 테스트명 selector가 동시에 일치할 때만 실행된다. selector가 없거나 넓은 정규식이면 Nest module bootstrap과 네트워크가 시작되지 않는다. 생성 결과는 고정된 0700 ledger 디렉터리에서 attempt/result/acceptance/failure/artifact 네임스페이스 충돌과 symlink를 먼저 거부하고, 공유 operation relation을 담은 0600 marker·result·acceptance 파일을 fsync한다. 동일 operation key를 provider idempotency key로 전달하며 marker가 있으면 내용과 관계없이 재실행하지 않는다. 생성 응답은 예약된 result와 accepted receipt에 durable하게 기록한 뒤 원본 재조회/PDF와 새 문서의 이용자 단계 및 새 PDF를 GET-only로 확인한다. 새 user-stage PDF와 API snapshot은 ledger artifact에 남기며 visual inspection은 parent review 대기 상태로 둔다. 빈 서명 필드만으로 서명 부재를 증명하지 않는다. 생성 후 자동 정리·서명·전송·완료·거절·삭제는 수행하지 않는다.

사용자가 실제로 새 문서에 서명한 뒤의 readonly follow-up은 생성과 분리된 selector로 실행한다. ledger result의 새 문서 ID만 읽어 `060/05/3/4` 내부 제공기관 participant 단계, 상속된 내부 recipient, target date/period, 금액 및 수령일, PDF marker를 GET-only로 확인한다. 이 probe는 제품 reissue 구현, recovery engine, receipt/pointer integration, Phase 0 전체 종료를 주장하지 않는다.

이미 실행한 실제 생성 명령 (RED — 재실행 금지):

```text
LIVE_E2E=1 pnpm exec jest --config jest.config.ts test/e2e/eformsign-completed-reissue.live.e2e.spec.ts --runInBand --testNamePattern='^Phase 0 completed contract reissue creates one fresh user-signature request from the immutable completed source with target dates$' --testPathIgnorePatterns=/node_modules/
```

사용자 서명 후 readonly 확인 명령 (현재 unavailable — durable result가 `ambiguous`이고 `documentId`가 `null`이므로 실행 금지):

```text
LIVE_E2E=1 pnpm exec jest --config jest.config.ts test/e2e/eformsign-completed-reissue.live.e2e.spec.ts --runInBand --testNamePattern='^Phase 0 completed contract reissue reads the durable new document after user signature without mutating the vendor document$' --testPathIgnorePatterns=/node_modules/
```

위 follow-up 명령은 durable한 새 문서 ID와 사용자 서명이 확인될 때까지 실행할 수 없다.

현재 오프라인 검증 명령:

```text
pnpm exec jest --config jest.config.ts test/e2e/helpers/eformsign-completed-reissue.live.helper.spec.ts --runInBand --testPathIgnorePatterns=/node_modules/
pnpm exec tsc --noEmit
pnpm exec eslint test/e2e/eformsign-completed-reissue.live.e2e.spec.ts test/e2e/helpers/eformsign-completed-reissue.live.helper.ts test/e2e/helpers/eformsign-completed-reissue.live.helper.spec.ts
git diff --check
```

이 절은 capability probe의 실행 지침과 오프라인 guard 범위만 기록한다. probe 자체는 직접 DB를 호출하지 않지만, 외부 vendor webhook/mirror가 새 문서를 자동으로 mirror·link하거나 client pointer를 승격할 수 있다. 따라서 실제 실행 전후의 client/mirror 상태는 parent가 별도 read-only DB snapshot으로 확인해야 한다. 실제 vendor 실행, 원본 불변성의 최신 live 증거, 새 문서의 사용자 서명 및 PDF 시각 검수는 별도 승인과 parent review 이후의 작업이다.

실제 CREATE selector는 승인된 명령으로 한 번만 실행했으며 RED로 종료됐다. operation key는 `95723309330e37928b140a5cd38c8fc583fe5c019719753baa96cdd3fe8a03d0`, durable result의 상태는 `ambiguous`, `documentId`는 `null`, acceptance는 `reserved`로 남았다. artifact 디렉터리는 `/Users/jaino/.local/state/babyjamjam/phase0-completed-reissue/artifacts/95723309330e37928b140a5cd38c8fc583fe5c019719753baa96cdd3fe8a03d0`이다. 재실행·삭제·follow-up은 하지 않았다.

이 RED 실행은 진단 metadata artifact를 추가하기 전의 frozen helper로 수행되어 HTTP status, vendor code, raw response/body/message가 durable하게 보존되지 않았다. 따라서 helper catch의 위치만으로 vendor HTTP rejection, `createDocument` 내부 response-shape(문서 ID 누락) 오류, transport/runtime 오류를 구분할 수 없으며, provider가 실제 처리했는지도 판정하지 않는다. 이후 실행에서는 `create-error.json`에 status/vendor code/name/category만 0600으로 저장하도록 했지만 이 RED 결과에는 소급 적용하지 않았다.

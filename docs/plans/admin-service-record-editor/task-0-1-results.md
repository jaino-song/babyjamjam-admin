# Task 0.1 결과 — 확인 단계 문서 읽기·출력 검증

> 아래 본문은 초기 `d54e…` 문서의 읽기 전용 시험 기록이다. 전체 Task 0.1의 최신 상태로 해석하지 않는다. 이후 격리 문서 `27e3c3287859433dbd8a680525c5338d`에서는 제공기관 참여자 수정 → 검토 → 직전 참여자 반려 → 재수정 → 검토를 수행했고, 같은 문서의 공식 PDF에 두 차례 수정 날짜가 반영됐다. 최초 서명 페이지의 렌더링 바이트도 유지됐다. 이 후속 UI/API/PDF 시험은 Astra/medium 감사에서 통과했으며, 상세 증거는 [워크플로우 전환 검증](workflow-transition-verification-20260907.md)과 [실행 기록](execution-log.md)에 있다.
>
> 후속 공식 API 단일 반려와 SDK의 네 날짜 항목 수정·참여자 전송도 실행했다. 독립 공식 API/PDF 및 기존 영수증 이미지 생성기에서 Jan06 갱신과 서명·수령일·금액 보존을 확인했다. 단, 최초 SDK 라이브 명령은 금액 표기 검사 오류와 즉시 PDF 확보 실패로 RED였으며 수정 후 변경 명령을 재실행하지 않았다. 전체 Phase 0는 미완료이고, 서구 SDK 자동화·기존 공개 링크 이미지 갱신·완료 문서 분기·응답 유실/부분 실패 복구 시험이 남아 있다. 자세한 한계와 증거는 실행 기록을 참조한다.

> 2026-09-08 서구 v12의 본인 서명 문서 `d5adcc5ecd99431f841151a0c7540759`도 공식 UI 수신자 경로에서 Jan04 수정→검토→직전 확인 반려→Jan05 재수정→검토와 API/PDF·최초 서명·수령일·금액 보존을 확인했다. 잘못된 작성자 수정 경로 진입으로 발생한 상태 변경은 공식 수정 취소로 복구했으며, 최초 API의 일부 값 누락도 별도 한계로 실행 기록에 보존했다. 공개 링크나 앱 일정 연동까지 검증된 것은 아니다.

검증일: 2026-09-07
대상: `d54eae92480941b4b656dfda2ffb93b7`
하네스: `backend/test/e2e/contract-date-update.live.e2e.spec.ts`

## 판정

최종 판정은 `NOT_VERIFIED`다. 공식 문서 상세 조회에서는 임시 저장된 종료일과 영수증 서비스 기간이 `2027-01-04`로 보였지만, 같은 문서의 공식 `download_files?file_type=document` 응답 PDF는 이전 값 `2026-12-31`을 계속 포함했다. 따라서 저장된 화면/API 값만으로 자동 문서 연동을 통과시키지 않는다.

서명 보존도 `NOT_VERIFIED`다. 상세 응답에서 이용자 서명 값이 전달되지 않았고, 공식 OPA2_060 문서 컴포넌트 조회에 날짜·영수증·서명 컴포넌트 이름을 요청했지만 값 목록이 비어 있어 해시를 만들 수 없었다. 브라우저에서 서명 그림이 보였다는 사실은 하네스의 전후 불변성 증거로 사용하지 않는다.

## 안전 범위

- 하네스는 정확히 위 문서 ID만 허용한다. 다른 ID는 네트워크 읽기 전에 `NotVerifiedError`로 거부한다.
- 상세 조회, 문서 PDF 다운로드, 공식 문서 컴포넌트 조회만 실행했다. Nest 모듈은 `ConfigModule`, `EformsignApiClient`, `EformsignService`로 한정했으며 Prisma, 스케줄러, 작업자, 완료/전송 서비스는 불러오지 않았다.
- 문서 저장, 전송, 승인, 완료, 취소, 삭제, 재시작, 문자·메일 발송은 실행하지 않았다. 저장용 테스트/플레이스홀더는 이 결과물에 포함하지 않았다.
- 로그와 결과 문서에는 토큰, 원본 PDF, 서명 데이터, 연락처를 기록하지 않는다. PDF 본문은 `/tmp/contract-date-proof-d54-baseline.pdf`에만 보존했다.

## 확인한 원격 값

| 증거 | 관찰값 |
| --- | --- |
| 문서 제목 | `인천아이미래로_남동구 계약서_송진호(확인단계테스트)` |
| 템플릿 ID | `7a632a0c98a04bf38e678affcb73f815` |
| API 상태/단계 | `status_type=001`, `step_type=05`, `step_name=제공기관 확인` |
| 계약 종료일 | `2027-01-04` |
| 영수증 서비스 기간 | `20260709~20270104` |
| 본인부담금 수령일 | `2026-07-09` |
| 금액 | 서비스 비용 `1,464,000`, 정부지원금 `1,002,000`, 본인부담금 `462,000` |
| 문서 컴포넌트 | 요청은 성공했으나 응답 값 목록이 비어 서명 해시를 만들 수 없음 |

금액·수령일·문서 ID·확인 단계가 보존되었다는 상세 응답은 확인했지만, PDF가 갱신되었다는 증거가 없어 저장 기능의 통과 조건을 충족하지 못했다.

## PDF 증거

공식 다운로드 응답은 HTTP 200, `application/pdf`, `%PDF-` 매직 바이트, 9페이지였다. SHA-256은 `f578ce34b23f0ef03a7a2edc363269de51ede2333c2544e6a3e2623659bdaa5c`, 크기는 755,118바이트다.

텍스트 추출 결과에는 다음 이전 값이 남아 있었다.

- 계약 종료일: `2026-12-31`
- 영수증 서비스 기간: `20260709~20261231` (3회 발견)

새 종료일과 새 서비스 기간은 PDF 텍스트에서 발견되지 않았다. 이 상태는 값 누락(`missing`)과 구분해 `exported_pdf_stale`로 분류한다. 별도 미리보기/상세 화면의 `2027-01-04` 표시는 공식 다운로드 출력의 최신성을 증명하지 않는다.

공식 OpenAPI의 OPA2_004 다운로드 정의에는 `file_type`과 선택적 `file_name`만 있고 초안/현재 데이터 강제, 재생성, 새 버전 선택 옵션은 없다. OPA2_060은 컴포넌트 조회 경로지만 이번 문서에서는 서명 값이 반환되지 않았다. 그러므로 PDF를 강제로 새로 만들거나 브라우저 내부 비공개 요청을 재생하는 우회는 하네스에 추가하지 않았다.

## 재현

`backend` 디렉터리에서 다음 명령을 실행한다.

```text
LIVE_E2E=1 pnpm exec jest test/e2e/contract-date-update.live.e2e.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand
```

현재 명령은 읽기 작업을 수행한 뒤 `not_verified: exported_pdf_stale`로 실패한다. PDF 파일을 로컬 증거로 남길 때만 다음 환경 변수를 추가한다.

```text
LIVE_E2E=1 LIVE_E2E_SAVE_BASELINE_PDF=1 pnpm exec jest test/e2e/contract-date-update.live.e2e.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand
```

두 명령 모두 저장·전송을 호출하지 않는다. `LIVE_E2E`가 없으면 라이브 스위트는 건너뛰며, 순수 가드 검증은 다음 명령으로 실행한다.

```text
pnpm exec jest test/e2e/contract-date-update.live.helper.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand
```

## 검증 결과

| 명령 | 결과 |
| --- | --- |
| `pnpm exec jest test/e2e/contract-date-update.live.helper.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand` | PASS — 1 suite / 9 tests (exact-ID, stale/contradictory PDF, contradictory fields, missing signature guards) |
| `pnpm exec jest test/e2e/contract-date-update.live.e2e.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand` | PASS — 라이브 스위트 skip 확인 |
| `LIVE_E2E=1 pnpm exec jest test/e2e/contract-date-update.live.e2e.spec.ts --testPathIgnorePatterns=/node_modules/ --runInBand` | EXPECTED RED — 원격 상세·PDF·컴포넌트 읽기 후 `exported_pdf_stale` |
| `pnpm exec eslint test/e2e/contract-date-update.live.e2e.spec.ts test/e2e/contract-date-update.live.helper.spec.ts test/e2e/helpers/contract-date-update.live.helper.ts test/e2e/helpers/contract-date-update.pdf-text.mjs` | PASS |

백엔드 전체 `tsc --noEmit`는 이번 하네스와 무관한 기존 Prisma 생성물/스키마 드리프트(`@prisma/client` 타입 및 기존 서비스 모델 오류)로 실패했다. 변경 파일 자체는 위 Jest 및 ESLint 명령으로 컴파일·실행 경계를 확인했다.

## 다음 단계 차단 사유

Task 0.1의 자동 저장·출력 증거는 다음 두 조건이 해소될 때까지 차단한다.

1. 지원되는 공식 경로로 저장한 동일 문서의 다운로드 PDF가 `2027-01-04`와 `20260709~20270104`를 모두 반영해야 한다.
2. 동일 문서의 이용자 서명 값을 공식 응답에서 안전하게 해시하거나, 전후 동일성을 검증할 수 있는 공식 증거가 있어야 한다.

조건이 충족되기 전에는 저장 API를 호출하거나 완료 문서를 새로 생성해 성공을 추정하지 않는다. 이번 작업에서는 저장 헬퍼와 제품 코드·스키마·환경 파일을 변경하지 않았다.

# 남은 기술 문제 재확인 — 2026-09-08

이번 확인은 읽기 전용 코드·공식 문서·승인된 테스트 고객 조회다. 외부 문서 수정, 고객 데이터 변경, 메시지 발송, 마이그레이션 또는 배포는 수행하지 않았다. 기존 격리 영수증 시험 PASS와 서구 SDK의 독립 PDF 검증은 유지하며 전체 Phase0 완료로 확대하지 않는다.

## 현재 상태에서 정정된 사항

- main 체크아웃의 로컬 설정이 선택한 DB 프로젝트 `dsaqfyzyuzbyldmvsihr`에서 `public.receipt_link_token`이 현재 존재한다. 20개 열과 7개 인덱스를 확인했고 토큰 모델 조회도 성공했다. 앞선 P2021은 과거 관측으로 남긴다.
- 해당 DB의 `_prisma_migrations`에서 이름에 `receipt`가 포함된 기록은 기존 `20260803060000_add_agent_action_effect_receipts`뿐이었다. 코드의 `20260904000000_add_receipt_link_token`과 적용 이력이 일치하는지는 확인되지 않았다. 테이블 부재 문제가 아니라 스키마 적용 경로·이력 확인 문제다. 임의로 migrate resolve나 재적용을 하지 않았다.
- 승인된 테스트 고객88의 영수증 토큰은0건이다. 운영의 기존 URL을 대상으로 한 갱신 검증은 수행할 대상이 없다. 로컬 설정의 DB 확인을 실제 배포 프로세스의 설정 확인으로 대체하지 않는다.
- 고객88의 앱 기간은2026-07-09~2026-12-31, duration118이다. 외부 서구 문서 `d5adcc5ecd99431f841151a0c7540759`는2027-01-06 종료, `070/06/index4`, 동일 내부 담당자·기한0이다. API와 공식PDF를 다시 확인했다. PDF747028바이트/SHA256 `91dc35c5ee5324e789e6b91fb1b587d0a5ae1bd89e895122448211c5414164e5`, 증거 임시 디렉터리 `workflow-proof-VwSTlm`.

## 남은 문제와 근거

| 항목 | 확인 결과 | 완료 판정에 필요한 증거 |
| --- | --- | --- |
| 수정 확정·앱 연동 | 현재 관리자 컨트롤러에는 조회와 링크 준비/전송/초기화만 있고 초안·미리보기·확정 API가 없다. 외부 날짜 수정이 앱 일정으로 자동 반영되지 않는 것도 현재 테스트 고객에서 확인했다. | 확정 한 건이 회차별 날짜, 배정, 고객 기간, 기록지, 계약/영수증 반영 작업에 일관되게 연결되는 제품 경로와 시험 |
| 기존 일정 변경 재사용 | 기존 경로는 duration을 유지하지만 선택 회차 이후 날짜를 회차 번호에 따른 연속 영업일로 재구성하고 unlocked 행만 이동한다. 새 관리자 요구처럼 기존 간격을 유지하면서 제출된 회차까지 이동하는 동작과 다르다. 기존 기능의 버그라고 단정하지 않는다. | 고정 duration, 휴일 제외, 기존 공백과 배정 귀속 유지, 제출된 회차를 포함한 동일 영업일 차이 이동 검증 |
| PDF 즉시 조회 | 제품의 직접 다운로드는 단일 GET이다. 서구 시험 도우미는 일부 상태에 한해0/250/500ms 간격으로 조회한다. 실패 당시 HTTP 상태·응답 분류가 증거에 남지 않아 정확한 원인은 확정할 수 없다. 현재 새 조회는 정상이다. | 재전송 없이 조회만 재시도하며 최신 PDF의 날짜/버전을 확인하고, 원인 분류·재개 상태를 보존하는 처리 |
| 기존 영수증 URL 갱신 | 격리 실제HTTP 시험은 통과했으나 제품 발급 경로는 재사용 가능한 링크가 있으면 새 이미지 생성 전에 반환한다. 시험 전용 이미지 포인터 교체가 제품 기능으로 연결된 것은 아니다. | 기존 토큰/만료/인증을 보존하는 제품용 이미지 교체, 검증된 최신 PDF 연결, 실제 배포·기존 URL 확인 |
| 자동 계약 완료·동시 작업 | 종료일+설정 유예기간 자동 완료는 이미 있다. 수정 초안/확정, 외부 반영 대기, 이미 예약된 작업과의 조정은 새 수정 경로에 연결되지 않았다. | 오래된 종료일을 가진 예약 작업, 수정 도중 완료, 중복/지연 알림, 응답 유실·부분 실패에 대한 수정 버전 검사와 재개 검증 |
| 완료 계약의 새 전자문서 | 공식 문서에서 기존 서명과 원래 서명 사건/이력을 재서명 없이 새 문서로 승계하는 지원 방식을 확인하지 못했다. | 이폼사인의 공식 지원 방식과 새 PDF/감사추적에서 원본 서명 사건을 보존·연결한다는 실제 증거 |

## 코드 근거

- 관리자 현재 범위: `backend/interface/controllers/admin-service-record.controller.ts:19`, `backend/application/services/admin-service-record.service.ts:93`.
- 기존 일정 계산/이동: `backend/application/services/schedule-change.service.ts:320`, `:351`, `:380`. 고객 duration을 변경하지 않고 끝나는 날짜만 갱신한다.
- 기존 duration 보존: `backend/application/services/service-record-lifecycle.service.ts:175`, `:525`. 기존 값 보존은 이미 있으며 모든 관련 쓰기 경로의 불변성 검증이 남았다.
- 자동 완료: `backend/application/services/contract-auto-finalize.policy.ts:45`, `backend/application/services/contract-auto-finalize-scheduler.service.ts:65`.
- 직접 PDF: `backend/application/services/eformsign.service.ts:494`; 시험 재조회: `backend/test/e2e/helpers/eformsign-seogu-revision.live.helper.ts:747`.
- 저장 PDF의 검토 단계070 허용은 `backend/domain/constants/eformsign-doc-status.constants.ts:78`과 mirror/repository에 이미 반영돼 있다. 직접 이폼사인 SDK 시험의 PDF 실패와 같은 원인으로 합치지 않는다.
- 기존 링크 조기 반환: `backend/application/services/receipt-link-issue.service.ts:185`.
- 영수증 스키마: `backend/prisma/migrations/20260904000000_add_receipt_link_token/migration.sql:8`, `backend/prisma/schema.prisma:1347`.

## 완료 계약의 공식 지원 확인 범위

[공식 임베딩 문서](https://eformsignkr.github.io/developers/help/eformsign_embedding_v2.html)의 `userdata.signatures`/`company_stamps`는 서명·도장 입력 데이터를 지원한다. 이 기능이 과거 완료 문서의 서명자 인증, 실제 서명 시각, 원본 식별자 및 감사추적을 승계한다는 설명은 확인하지 못했다. [공식 API 문서](https://eformsignkr.github.io/developers/help/eformsign_api.html)에서도 해당 완료 문서 복제 방식을 확인하지 못했다. 서명 모양 입력이나 완료PDF 첨부를 원래 서명 사건 승계로 간주하지 않는다.

필요한 업체 확인은 “완료 document_id로 새 전자문서를 만들 때 재서명 없이 원래 서명자·시각·감사추적을 보존하거나 검증 가능한 방식으로 연결하는 공식 API/SDK가 있는가, 있다면 새 PDF와 감사추적에서 이를 어떻게 확인하는가”다. 업체 연락은 수행하지 않았다. 원본 보관+별도 참고 문서는 현재 요구를 자동 충족하는 대안이 아니다.

## 검토 범위와 판정

Spark 읽기 전용 탐색, Luna/max 공식 문서 재확인, main의 코드 및 현재 DB/API/PDF 독립 조회, Astra/medium 검토를 수행했다. Astra 판정은 CONCERNS: 남은 구현·재사용 차이는 실재하지만 기존 기능 전체의 결함이나 모든 실행 경로의 검증 완료로 표현하지 않는다. 특히 웹훅·작업 중복·실패 복구 전체 경로의 실행 검증은 아직 남아 있다. 이 문서는 진단 기록이며 구현·운영 반영 완료나 새로운 구현 계획 승인 기록이 아니다.

# 완료 계약 신규 발급 오류 조사

2026-09-08. 기존 승인된 Phase 0 발급 시험의 결과 복구 조사이며 재발급 실행 계획 또는 성공 판정이 아니다.

## 확인 결과

- 사용자가 신규 서명 요청 문자를 받지 않았다고 확인했다.
- 공식 제목 조회를 다시 실행한 결과 기존 남동구 문서 `27e3c3287859433dbd8a680525c5338d`와 완료 원본 `4f58a134b5864ecf9af283607cebba9d`만 반환됐다. 목록에 없다는 사실만으로 공급자 처리 부재를 확정하지 않는다.
- 현재 양식 `27f092d3bdba4777835187facd7468a6`을 공식 읽기 전용 API로 재조회했다. `write → participant → participant → reviewer → complete`, 버전1이다. 제공기관 확인은 groupormember, 검토는 beforewriter 설정이다.
- 실제 helper의 원본 자료·PDF 기반 사전 검사를 통과한 payload를 실제 `EformsignApiClient.createDocument`에 전달하고, fetch를 네트워크 없는 응답으로 대체해 직렬화된 요청을 관찰했다. 입력18개, 문서명 생략, 수신자 타입은 `["05"]` 한 개였다. 이 관찰에서는 외부 발급을 호출하지 않았다.
- 공식 OpenAPI의 `시작 - 참여자(개인) - 검토자(그룹) - 완료` 예제는 수신자 `["05", "06"]`를 포함한다. 현재 client는 recipient/reviewer 중 하나만 선택하므로 다단계 수신자를 표현할 수 없다. 다만 이 예제가 현재 양식의 생략된 고정 수신자·beforewriter 처리까지 규정하는 것은 아니다.

근거: [공식 API 안내](https://eformsignkr.github.io/developers/help/eformsign_api.html), [공식 OpenAPI 원문](https://api.swaggerhub.com/apis/eformsign_api/eformsign_API_2.0/2.0), `backend/infrastructure/api/eformsign-api.client.ts:388`, `backend/test/e2e/helpers/eformsign-completed-reissue.live.helper.ts:1142`.

## 결론과 한계

단일 수신자만 표현하는 현재 발급 경로는 다단계 양식의 요청을 충분히 모델링하지 못한다. 그러나 원래 HTTP 상태·공급자 오류 응답이 남지 않아 이것을 이번 실패의 확정 원인으로 선언할 수 없다. HTTP 거절, client 내부 응답 ID 파싱, 전송/실행 오류 가능성은 구분되지 않았다. 기존 오류 기록 보완은 이 실패 원인을 소급 복원하지 않는다.

수신자를 임의로 추가하거나 검토 단계의 beforewriter를 특정 멤버로 바꾸지 않는다. 기존 ambiguous marker를 삭제하거나 키·목표 날짜를 바꿔 동일 시도를 우회 재발급하지 않는다. 이 조사에서 신규 문서·SMS·DB 쓰기를 수행하지 않았다.

## 공급자 확인용 문의 초안 — 미발송

안녕하세요. Open API 새 문서 작성 요청의 처리 결과와 다단계 수신자 지정 방법을 확인 부탁드립니다.

- 엔드포인트: `POST /v2.0/api/documents?template_id=27f092d3bdba4777835187facd7468a6`
- 시도 기록 생성 시각: 2026-09-08 04:48:24.036 KST / 2026-09-07 19:48:24.036 UTC. 실제 HTTP 수신 시각을 뜻하지는 않습니다.
- 요청 상관 키(`Idempotency-Key`): `95723309330e37928b140a5cd38c8fc583fe5c019719753baa96cdd3fe8a03d0`
- 문서 ID를 확보하지 못했고, 동일 제목의 새 문서가 조회되지 않으며 수신자도 문자 미수신을 확인했습니다. 중복 발급을 피하려고 재요청하지 않았습니다.
- 양식 순서: 작성 → 이용자(참여자) → 제공기관 확인(참여자/groupormember) → 제공기관 검토(검토자/beforewriter) → 완료.
- 당시 요청에는 이용자 참여자 `step_type=05` 한 개만 포함했고 문서명은 생략했습니다. 입력항목은18개이며 개인정보·서명·인증값은 이 문의에 첨부하지 않습니다.

1. 해당 요청이 수락되어 문서를 생성했는지, 생성됐다면 문서 ID와 현재 상태를 확인 부탁드립니다. 거절됐다면 HTTP 상태·오류코드와 재발급해도 중복되지 않는지 확인 부탁드립니다.
2. 이 양식은 수신자 배열에05/05/06 전체를 넣어야 하나요? 고정 groupormember와 beforewriter 수신자를 API 요청에서 생략할 수 있는지, 명시해야 한다면 각각 어떤 구조로 지정해야 하는지 확인 부탁드립니다.

이 초안은 아직 외부에 보내지 않았다. 답변 없이 이전 요청의 처리 부재나 재시도 안전성을 추정하지 않는다.

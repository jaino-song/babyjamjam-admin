# Mobile MessageMaker

`/messages/compose`는 `MessageMaker` organism을 조립한다. `/messages`와 일반 메시지 진입은 이 제작 화면으로 연결하며 `/messages/new` 및 명시적인 template/clientId 링크는 발송 화면으로 유지한다. 로그인과 지점 확인은 유지하며, 제작 화면의 템플릿 선택·변수 입력·본문 편집·복사는 발신번호 승인과 무관하게 사용할 수 있다. 정확한 `/messages/compose` 경로는 승인 로딩·거절·조회 오류에도 모달 없이 즉시 렌더링한다. 승인 조회와 context는 유지하며 전송하기·발송 기록·템플릿·자동 전송 탭은 승인 확인 중이거나 미승인일 때 비활성화한다. 제작·설정 탭은 사용할 수 있고 기존 역할 조건은 유지한다. 실제 발송은 `/messages/new`의 승인 guard를 따른다.

- 구성: `ListCard`, `MessageSectionNav`, `FieldLabelRow`, `Input`, `MessageTemplateSelect`(Select primitives), `MsgField`, `Button`. page-local component와 page 시각 Tailwind는 없다.
- `data-component`는 caller가 완성된 owner 경로를 전달한다. organism과 field는 source-component를 고정하며 authored slot은 data-slot을 함께 선언한다. 선택기 그룹 CSS는 두 메시지 화면에만 적용한다.
- 시스템 목록은 `useSystemTemplates()`의 지점 유효 본문·멤버십·순서·이름·group/groupLabel을 그대로 따른다. 제공인력·빈 본문도 선택 가능하다. 사용자 목록은 `useMessageTemplates()`로 읽고 지점 세션마다 재조회가 끝나야 노출한다. 오류 시 본문·복사 UI를 제거하고 재시도한다. 지점 변경은 편집 세션 전체를 재생성한다.
- 옵션 값은 `system:<key>`, `user:<id>`, `custom`. 최초 선택은 PRICE_INFO → 첫 시스템 항목 → 직접 작성이다. 변수는 실제 본문의 placeholder를 기준으로 required/custom 메타데이터를 병합하며 사용자 라벨·필수 여부를 보존한다. 미입력 placeholder는 유지한다.
- PRICE_INFO는 유형 → 기간 → 연도 → 지역 순서다. 유형 라벨은 voucher.json, 가격·계좌는 실제 조회 행만 사용한다. 연도 선택은 현재 연도 ±1, 주 수는 `floor(duration / 5)`다. 유형/연도 변경은 기간을 비우고 조회 실패·재조회·빈 결과는 이전 금액/계좌와 override를 제거한다.
- 변수 변경은 본문을 재생성한다. 수동 본문은 다음 변수 변경까지 유지한다. 편집 상한은 발송 화면과 같은 2,000자이며 원본 템플릿 조회 내용은 임의로 잘라내지 않는다. 복사는 표시 중인 본문만 사용한다. 실제 성공 뒤 성공 안내를 표시하고 거부되면 수동 복사를 안내한다. HTTP fallback은 실제 textarea 선택을 사용하고 focus/selection/scroll을 복구한다.
- 수신자·고객 조회·발송·링크 준비·계약 생성·초안 저장·mutation은 없다. 모든 링크 변수는 직접 입력한다.

검증은 모델/상태/클립보드/organism과 내비게이션 Jest, mobile type-check/lint, UI architecture baseline으로 수행한다. 실제 브라우저 UI 수락은 Main이 독립 QA에서 수행한다.

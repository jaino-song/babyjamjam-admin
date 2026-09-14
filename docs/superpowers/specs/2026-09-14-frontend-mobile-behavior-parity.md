# Frontend–Mobile 행동 규칙 파리티 게이트

**Date:** 2026-09-14
**Status:** Implemented in `packages/shared/scripts/frontend-mobile-parity-gate.mjs`
**Scope:** Frontend/mobile shared-contract ownership and message-trigger BFF validation

## 목적

`@babyjamjam/shared`가 frontend와 mobile의 공통 업무 규칙 정본이다. 앱은 기존
feature-local import 경로를 유지할 수 있지만, 전화번호·한국어 검색·바우처 기간·템플릿
렌더링·eformsign 상태·메시지 트리거 계약을 다시 구현해서는 안 된다.

게이트는 선언·import·BFF 계약을 검사한다. 소스 전체에서 `SERVICE_END_NOTICE` 같은
문자열을 금지하지 않는다. 따라서 한 키를 특정 delivery 경로로 보내는 비교식은 허용되고,
키 목록/union/enum을 새로 선언하는 변경만 실패한다.

## 정본과 허용 어댑터

공유 정본은 다음 파일에 있다.

- `packages/shared/src/types/message.ts`
- `packages/shared/src/types/system-template.ts`
- `packages/shared/src/api/route-utils.ts`
- `packages/shared/src/constants/eformsign-status-codes.ts`
- `packages/shared/src/client/voucher-duration.ts`
- `packages/shared/src/utils/phone.ts`
- `packages/shared/src/utils/korean-search.ts`
- `packages/shared/src/template/utils.ts`

아래 frontend/mobile 파일은 이름 호환을 위한 얇은 re-export만 허용된다.

- `src/lib/phone.ts`
- `src/lib/search/korean-search.ts`
- `src/lib/voucher/duration.ts`
- `src/lib/template/variable-parser.ts`

eformsign wrapper에는 화면 전용 label/badge/stats 변환이 남을 수 있다. 다만 상태 코드
집합과 정규화·분류·삭제 여부 함수는 shared import에서 파생해야 한다.

## 검사 규칙

1. shared 정본과 모든 thin adapter가 존재하고 adapter가 `@babyjamjam/shared`를 import한다.
2. frontend/mobile source에 shared-owned helper 구현이 다시 생기면 실패한다.
3. eformsign adapter의 상태 코드 배열/집합 복제를 실패시킨다.
4. system/trigger template key를 local array, `Set` list, union, enum으로 선언하면 실패한다.
   단일 key routing 비교와 화면 전용 label/icon map은 이 검사 대상이 아니다.
5. 다음 네 message-trigger BFF가 각각 shared create/update schema와
   `messageTriggerUpstreamErrorResponse`를 사용해야 한다.
   - `frontend/src/app/api/message-trigger-rules/route.ts`
   - `frontend/src/app/api/message-trigger-rules/[triggerId]/route.ts`
   - `mobile/src/app/api/message-trigger-rules/route.ts`
   - `mobile/src/app/api/message-trigger-rules/[triggerId]/route.ts`
6. mobile의 `src/lib/api/route-utils.ts`는 shared route policy를 re-export해야 한다.

검사는 whitespace나 줄 위치에 의존하지 않는 declaration/import 패턴을 사용한다. 테스트는
현재 repository source를 기준으로 정상 통과를 확인하고, local template key list와 중복
voucher helper를 mutation fixture로 삽입해 실제 실패를 증명한다. eformsign status-code
복제와 BFF schema 제거도 같은 방식으로 고정한다.

## 의도적으로 다른 플랫폼 정책

다음은 파리티 위반이 아니며 `INTENTIONAL_EXCEPTIONS`에 이유와 경로를 기록한다.

- mobile 수동 메시지 화면의 단계적 템플릿/트리거 공개 제어와 `SERVICE_END_NOTICE`
  receipt-link fail-closed guard
- frontend의 legacy system-template deep-link id 호환과 기존 fallback copy
- frontend 실패 메시지 재전송 기능
- frontend settings/messages 루트 navigation
- mobile public token route
- frontend 브라우저 auth refresh/base URL 정책과 mobile native transport 정책
- client-registration의 compact 입력 표시 포맷과 계약 prefill identity 비교

예외는 공통 계약의 소유권을 이전하지 않는다. 새 예외를 추가할 때는 이 문서와 게이트의
목록에 경로·업무 이유를 함께 기록해야 한다.

## CI 연결

`packages/shared/package.json`의 기존 `test` 명령이
`node --test ... scripts/*.test.mjs`를 실행한다. 따라서 새
`frontend-mobile-parity-gate.test.mjs`는 별도 workflow step 없이
`.github/workflows/shared-contracts-ci.yml`의 `Shared package tests` 단계에 자동 포함된다.
workflow의 `packages/shared/**`, `frontend/**`, `mobile/**` path filter도 게이트 입력을
포함한다.

로컬 실행:

```text
node packages/shared/scripts/frontend-mobile-parity-gate.mjs
node --test packages/shared/scripts/frontend-mobile-parity-gate.test.mjs
pnpm --filter @babyjamjam/shared test
```

게이트는 인증된 화면이나 외부 SMS를 호출하지 않으며, source ownership과 입력 검증
계약만 검사한다.

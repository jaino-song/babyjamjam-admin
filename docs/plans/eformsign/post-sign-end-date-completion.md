---
plan_id: efsi-2026-002
feature: post-sign-end-date-completion
status: approved
swagger_base: https://api.eformsign.com/v2.0
agent_version: v0.4.0
created_at: 2026-05-01T18:09:02Z
approved_at: 2026-05-02T17:00:00Z
content_hash: a1b2c3d4e5f6g7h8i9j0
depends_on: []
surfaces_touched:
  - usecases
  - webhook
  - dto
  - module
  - legacy
---

## Summary

산모계약서 워크플로우를 단일 step에서 2-step으로 변경한다. Step 1은 현재와 동일하게 이용자(외부자)가 iframe SDK로 서명하고, Step 2에서는 직원(내부 멤버)이 staff.babyjamjam.com 내부 iframe으로 서비스 종료일을 입력 후 확정해야 문서가 최종 완료된다. eformsign 콘솔 단의 템플릿 변경은 사용자가 직접 수행하며, 본 플랜은 백엔드/프론트엔드의 발급·웹훅·신규 직원용 iframe 옵션·종료일 동기화 경로만 다룬다. 발급 자체는 기존 iframe 경로를 유지한다(JAI-88의 OPA 통일은 보류).

## Requirements

### Goals

- 이용자 서명 직후 자동 완료가 아니라, 직원이 별도 iframe에서 서비스 종료일을 입력·확정해야 `DOC_COMPLETE`가 발생하는 워크플로우 구성을 백엔드가 지원한다.
- 직원용 Step 2 iframe SDK 옵션을 backend가 생성·반환하는 endpoint를 제공한다 (`mode.type: "02"` 기존 문서 모드).
- `DOC_COMPLETE` 웹훅 처리 시 eformsign 문서의 "계약 종료 년/월/일" 필드 값을 읽어 `client.endDate`에 동기화한다.
- 직원이 처리 대기 중인 Step 2 문서를 확인할 수 있도록 pending list endpoint를 추가한다.
- 이용자 측 발급 흐름(현재 iframe SDK)은 보존하되, Step 1 prefill에서 종료일(`endYear/endMonth/endDay`)은 제거하여 이용자가 잘못된 종료일에 서명하는 상황을 방지한다.

### Non-Goals

- OPA_007로 발급 통일 (JAI-88의 막힘 사항, 본 플랜 범위 밖).
- iframe SDK 자체를 제거하거나 다른 dispatch 경로로 교체.
- 자동 종료일 계산 로직(시작일+duration → expectedEndDate) 변경. expected 계산은 그대로 유지하되 prefill에서만 빼고, 사후에 staff가 입력한 actual 종료일이 `client.endDate`를 덮어쓴다.
- 이용자 측 iframe UX/wizard 변경 (요청대로 발급까지의 경로는 그대로).
- eformsign 템플릿 자체의 콘솔 변경 (사용자 본인이 직접 처리 — 백엔드 코드는 새 템플릿 구조를 가정만 함).

## Technical Design

### eformsign Layer Touchpoints

- **Affected usecases (active surface):**
  - 신규: `application/usecases/eformsign-doc/sync-client-end-date.usecase.ts` — `DOC_COMPLETE` 시 문서 필드에서 종료일 추출 후 `client.endDate` 갱신.
  - 신규: `application/usecases/eformsign-doc/list-pending-staff-completion.usecase.ts` — 직원 처리 대기 중 문서(이용자 서명 후 Step 2 대기) 목록 조회.
  - 수정: `application/usecases/eformsign-doc/link-document-to-client.usecase.ts:6-29` — 변경 없음(eDocId 링크는 그대로). end date 동기화는 별도 usecase에서 처리.

- **Service / controller 변경:**
  - 수정 (legacy): `application/services/eformsign.service.ts:137-203` — `generateDocumentOptions()`의 prefill에서 `계약 종료 년도/월/일` 항목 3개 제거 (현재 `:172-174`).
  - 신규 method (legacy 위치 — 기존 iframe option pattern과 동일선상): `application/services/eformsign.service.ts` 끝에 `generateStaffCompletionOptions(documentId, accessToken, refreshToken)` 추가. `mode.type: "02"` + `mode.documentId` 사용, `user.id = USER_EMAIL`.
  - 수정 (legacy controller): `interface/controllers/eformsign.controller.ts:65-106` 다음에 `POST /api/generate-staff-document` 라우트 추가하여 `generateStaffCompletionOptions` 호출.
  - 신규 (active controller): `interface/controllers/eformsign-doc.controller.ts` — pending list endpoint `GET /eformsign-docs/pending-staff-completion` 제공. (현재 active surface에는 controller 없음 — 본 신설이 첫 active controller.)
  - 수정 (active service): `application/services/eformsign-webhook.service.ts:185-233`의 `handleDocumentEvent` 내 `DOC_COMPLETE` 분기(`:218-232`)에서 `linkDocumentUsecase.execute` 직후 `SyncClientEndDateUsecase.execute` 호출 추가. `:131-145` `handleReadyDocumentPdfEvent`도 동일하게 보강.

- **`EformsignApiClient` method additions:** 신규 추가 없음. 기존 `getDocument()` (`infrastructure/api/eformsign-api.client.ts:209-235`)를 종료일 필드 추출에 사용한다 (`include_fields=true` 응답의 `fields[]`).

- **DTO 및 mapper deltas:**
  - 신규 DTO: `interface/dto/staff-document.dto.ts` — `GenerateStaffDocumentRequestDto { documentId, accessToken, refreshToken }`, `PendingStaffCompletionItemDto { documentId, clientId, clientName, signedAt, statusDetail }`.
  - 기존 mapper 변경 없음 (`infrastructure/database/mapper/eformsign-doc.mapper.ts:21-79` 그대로).

- **Prisma schema deltas:** 없음. `client.endDate`는 이미 `prisma/schema.prisma:88`에 존재(DateTime, Date 타입). `eformsign_doc.statusType` 도 `:158`에 존재.

- **Env var 추가:** 없음. 기존 `EFORMSIGN_USER_EMAIL`을 직원 멤버 식별자로 재사용.

- **Webhook 이벤트 영향:**
  - `document` 이벤트의 `DOC_COMPLETE` 핸들러에 종료일 sync 분기 추가 (`application/services/eformsign-webhook.service.ts:218-232`).
  - `ready_document_pdf` 이벤트의 PDF-ready 분기에도 동일 sync 추가 (`:131-145`).
  - `DOC_REQUEST_PARTICIPANT` (Step 1 → Step 2 전이 시 발생, `:313` `mapStatus`에서 `statusType="060"`로 처리)는 추가 변경 불필요. pending list가 이 statusType을 기준으로 필터.

- **NestJS 모듈 등록 변경:**
  - `module/eformsign-doc.module.ts:24-59` — providers에 `SyncClientEndDateUsecase`, `ListPendingStaffCompletionUsecase` 추가, controllers에 신규 `EformsignDocController` 등록, exports에 `SyncClientEndDateUsecase` 추가 (webhook module이 import).
  - `module/eformsign-webhook.module.ts:20-46` — imports에 `EformsignDocModule` 그대로 (이미 있음 가정 — 확인 필요), 새 usecase 주입.

### Design Details

#### Step 2 iframe 옵션 형태 (`generateStaffCompletionOptions`)

```ts
{
    company: { id: COMPANY_ID, country_code: "kr", user_key: USER_EMAIL },
    layout: { lang_code: "ko", zoom: "0.75", viewer_toolbar: { ... } },
    user: {
        type: "01",
        id: USER_EMAIL,            // 직원 멤버 식별자
        access_token: accessToken,
        refresh_token: refreshToken,
    },
    mode: {
        type: "02",                 // 기존 문서 모드
        documentId,                 // Step 2 대기 중인 문서 ID
    },
}
```

`mode.type: "02"`은 eformsign embedded SDK의 기존 문서 로드 모드라는 가정에 기반한다. `efs_embedded_v2.js` 문서가 부재하므로 구현 단계에서 검증이 필요하다(아래 Risks 표 참조). 실패 시 대안: eformsign 콘솔에서 직원에게 발송된 ‘서명 요청’ 링크를 staff app이 iframe `<iframe src="...">`로 직접 임베드. 이는 SDK가 아닌 일반 URL 임베드 방식.

#### Step 1 prefill 변경

`eformsign.service.ts:172-174`의 `계약 종료 년도/월/일` prefill 3건을 삭제한다. 그 외 모든 prefill은 그대로. 사용자가 보는 Step 1 문서에서는 종료일 칸이 비어 있어야 하며, 이는 eformsign 템플릿이 Step 2 직원 역할에 종료일 필드 입력 권한을 부여했을 때 자연스럽게 동작한다(템플릿 변경은 사용자가 직접).

`expectedEndDate`(시작일+duration 영업일 계산)는 발급 시점에 그대로 DB에 박혀 있고, 직원 입력이 들어오면 `DOC_COMPLETE` 시점에 actual 값으로 덮어쓴다.

#### 종료일 sync 로직 (`SyncClientEndDateUsecase`)

1. `EformsignApiClient.getDocument(accessToken, documentId)` 로 fields 조회.
2. response의 `fields[]`에서 `id` 가 `계약 종료 년도`, `계약 종료 월`, `계약 종료 일`인 항목을 찾아 value 추출.
3. `new Date(Date.UTC(year, month-1, day))`로 Date 생성 (KST→UTC 시차 버그 회피, JAI-88 §10에서 검증된 패턴).
4. 빈 값 또는 파싱 실패 시 warning 로깅 후 no-op (existing endDate 유지).
5. 성공 시 `clientRepository.update({ endDate })`.

eformsign access token 획득은 webhook handler가 직접 처리. `EformsignApiClient.getAccessToken()` (`:73-100`) 호출 후 그 token을 sync usecase에 주입.

#### Pending list 쿼리

`eformsign_doc WHERE statusType = '060' AND statusDetail IN ('서명 요청됨', '서명 진행중')` 으로 1차 필터. 단, Step 2 vs Step 1 구분이 필요하다. `eformsign_doc.stepIndex` 가 `2` (Step 2 outsider/approval seq) 인 행만 직원 처리 대상. `webhook` payload의 `workflow_seq`가 `stepIndex`로 저장되므로 (`:202`, `:115`), Step 2 진입 시 `stepIndex='2'` 가 기록된다.

#### 직원 iframe 사용 흐름 (frontend 관점)

본 플랜은 backend 산물 위주이지만 frontend가 호출할 endpoint 시그니처를 다음과 같이 고정해 둔다 — 후속 frontend 작업이 이를 그대로 호출한다:

- `GET /api/eformsign-docs/pending-staff-completion?branchId=...` → `PendingStaffCompletionItemDto[]`
- `POST /api/generate-staff-document` body `{ documentId, accessToken, refreshToken }` → eformsign embedded SDK options object

frontend 작업(목록 화면, iframe 모달 컴포넌트)은 본 플랜 범위에서 제외하되, 호환성을 잃지 않도록 endpoint 계약은 본 플랜에서 확정한다.

## Task Breakdown

#### Task 1.1: Step 1 prefill 종료일 제거
**Tier:** trivial
**Sandbox:** local
**Paths:** `backend/application/services/eformsign.service.ts`
**Depends:** none

`generateDocumentOptions()` 의 `prefill.fields` 배열에서 라인 `:172-174`의 3개 entry(`"계약 종료 년도"`, `"계약 종료 월"`, `"계약 종료 일"`)를 삭제한다. 다른 prefill 항목은 손대지 않는다.

#### Task 1.2: 직원용 iframe options 생성 method 추가
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/application/services/eformsign.service.ts`
**Depends:** none

`EformsignService` 끝(현재 `:553` 직전)에 `generateStaffCompletionOptions(documentId: string, accessToken: string, refreshToken: string)` method 추가. 반환 객체의 형태는 §Technical Design 의 코드 블록과 동일. `assertConfigured()` 호출은 시작 부분에 둔다. `EFORMSIGN_COMPANY_ID` (`:32`) 와 `USER_EMAIL` (`:27`) 를 그대로 사용. `mode.type` 은 `"02"`, `mode.documentId` 는 인자.

#### Task 1.3: `POST /api/generate-staff-document` 라우트 추가
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/interface/controllers/eformsign.controller.ts`, `backend/interface/dto/staff-document.dto.ts`
**Depends:** Task 1.2

`EformsignController` (`:65-106` 의 `generateDocument` 패턴 재사용) 다음에 `POST /api/generate-staff-document` 핸들러 추가. body schema는 신규 `GenerateStaffDocumentRequestDto`(documentId, accessToken, refreshToken) 사용. `JwtGuard + TenantGuard` 가드는 컨트롤러 레벨에서 이미 적용됨(`:9-10`). 핸들러 내부에서 `eformsignService.generateStaffCompletionOptions` 호출 후 결과 그대로 반환.

#### Task 1.4: `SyncClientEndDateUsecase` 추가 + webhook 통합
**Tier:** heavy
**Sandbox:** local
**Paths:** `backend/application/usecases/eformsign-doc/sync-client-end-date.usecase.ts`, `backend/application/services/eformsign-webhook.service.ts`, `backend/module/eformsign-doc.module.ts`, `backend/module/eformsign-webhook.module.ts`
**Depends:** none

1. 신규 usecase 파일 작성: `EFORMSIGN_CLIENT_REPOSITORY`(API client) 와 `CLIENT_REPOSITORY`(`domain/repositories/client.repository.interface.ts:74`) 주입. `execute(branchid, documentId, accessToken)` 시그니처. 내부 동작은 §Technical Design 의 Sync 로직 그대로.
2. `EformsignWebhookService` (`:218-232` `DOC_COMPLETE` 분기, `:131-145` PDF ready 분기)에 webhook이 자체적으로 token을 발급하고 신규 usecase 호출하도록 추가. token 발급은 기존 `EformsignApiClient.getAccessToken(executionTime)` 패턴 사용 (`infrastructure/api/eformsign-api.client.ts:73-100`). webhook payload에 `branchid` 가 포함되므로(`:67-68`, `:74`, `:81`, `:87`) 그대로 전달.
3. `EformsignWebhookService` 생성자에 `SyncClientEndDateUsecase` 주입 (`:53-65` 패턴).
4. `module/eformsign-doc.module.ts:24-59` providers에 신규 usecase 등록, exports에도 추가.
5. `module/eformsign-webhook.module.ts:20-46` imports에 `EformsignDocModule` 이미 포함되어 있는지 확인 후, providers에서 신규 usecase 주입.

#### Task 1.5: `ListPendingStaffCompletionUsecase` + active controller
**Tier:** heavy
**Sandbox:** local
**Paths:** `backend/application/usecases/eformsign-doc/list-pending-staff-completion.usecase.ts`, `backend/interface/controllers/eformsign-doc.controller.ts`, `backend/interface/dto/staff-document.dto.ts`, `backend/module/eformsign-doc.module.ts`
**Depends:** Task 1.4

1. 신규 usecase: `EFORMSIGN_DOC_REPOSITORY`(`domain/repositories/eformsign-doc.repository.interface.ts:1-15`)와 `CLIENT_REPOSITORY` 주입. `execute(branchid)` 가 `eformsign_doc WHERE branchId=? AND statusType='060' AND stepIndex='2'` 결과를 client name 과 join하여 `PendingStaffCompletionItemDto[]` 반환. 새 repository method `findPendingStaffCompletion(branchid)` 가 필요하면 `IEformsignDocRepository` 확장 + `PrismaEformsignDocRepository` 구현 추가.
2. 신규 controller: `interface/controllers/eformsign-doc.controller.ts` 를 만들고 `@Controller("eformsign-docs")` + `JwtGuard + TenantGuard` 적용. `GET /pending-staff-completion` 핸들러 1개.
3. DTO: `PendingStaffCompletionItemDto` 추가 (`interface/dto/staff-document.dto.ts`).
4. `module/eformsign-doc.module.ts:24-59` controllers 배열에 `EformsignDocController` 등록, providers에 신규 usecase, repository 확장이 있다면 PrismaEformsignDocRepository 동일 module에서 이미 바인딩됨 (`:45-47`).

#### Task 1.6: 단위 테스트 — sync usecase + webhook 통합
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/test/usecases/eformsign-doc/sync-client-end-date.usecase.spec.ts`, `backend/test/services/eformsign-webhook.service.spec.ts`
**Depends:** Task 1.4

1. 신규 spec `sync-client-end-date.usecase.spec.ts`:
   - `getDocument` 가 `fields` 배열에 `계약 종료 년도/월/일` 을 반환할 때 `client.endDate` 가 `Date.UTC(...)` 로 정확히 갱신되는지.
   - 필드가 비어 있을 때 no-op 인지.
   - `getDocument` 가 throw 하면 sync 실패가 webhook을 죽이지 않는지 (warning만).
2. 기존 또는 신규 `eformsign-webhook.service.spec.ts` 에 `DOC_COMPLETE` 분기에서 `SyncClientEndDateUsecase.execute` 가 호출되는지 검증 (모킹).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `efs_embedded_v2.js` 가 `mode.type: "02"` (기존 문서 로드)을 지원하지 않을 가능성 | M | H | Task 1.2 구현 전에 sandbox에서 SDK 호출로 검증. 실패 시 fallback: `<iframe src="<eformsign_doc_url>">` 직접 임베드. 직원 iframe 화면은 추후 frontend task로 분리 가능. |
| eformsign 템플릿이 Step 2 직원에게 `계약 종료 년/월/일` 필드 편집 권한을 부여하지 않으면 직원이 값을 입력할 방법이 없음 | L | H | 사용자가 콘솔에서 템플릿을 본 플랜 가정대로 구성한다는 전제 — 템플릿 작업 후 dev tenant에서 실제 발급 → Step 2 진입 → 필드 편집 가능 여부를 수동 검증. 본 플랜의 verification 단계 외 manual smoke test 필요. |
| webhook handler가 별도 token을 발급해야 함 (`getAccessToken` 호출 비용) | M | L | webhook 처리 latency가 약간 증가(<1s). DOC_COMPLETE 시 한 번만 호출되므로 수용 가능. 토큰 캐시는 도입하지 않는다 (다음 iteration에서 검토). |
| Step 2 stepIndex 가 실제로 `"2"` 가 아닐 가능성 (eformsign 워크플로우 인덱스 규칙) | M | M | Task 1.5의 pending list 쿼리는 `stepIndex='2'` 가정. 사용자가 템플릿을 만든 후 dev tenant에서 첫 발급 → DOC_REQUEST_PARTICIPANT webhook payload의 `workflow_seq` 실제값을 로그로 확인 → 필요 시 상수 조정. |
| 기존 `client.endDate` 가 expected (발급 시점 계산값)으로 박혀 있어 직원이 동일 값을 다시 입력할 경우 변동이 없음 | L | L | sync usecase는 무조건 update를 실행. 동일 값이어도 멱등 (no harm). 다만 webhook handler가 DOC_COMPLETE 외에 ready_document_pdf 에서도 sync를 호출하므로 두 번 실행되어도 결과 동일. |
| 종료일 필드 ID 가 템플릿마다 다를 가능성 (남동구 vs 서구 vs 신규 템플릿) | L | M | 본 플랜은 자사 5개 템플릿 모두 `계약 종료 년도/월/일` 동일 ID라는 JAI-88 §3.3 직접 비교 결과를 신뢰. 다른 템플릿이 추가되면 sync usecase에 dictionary 도입 필요 — 본 iteration scope 외. |

## Testing Strategy

- **Unit (jest):**
  - `sync-client-end-date.usecase.spec.ts` (신규): 정상 sync, 빈 필드, getDocument 실패 시 graceful 실패 3 case.
  - `eformsign-webhook.service.spec.ts` (신규 또는 기존 확장): DOC_COMPLETE 핸들러가 `SyncClientEndDateUsecase` 호출하는지, 실패해도 link 동작은 진행되는지.
  - `list-pending-staff-completion.usecase.spec.ts` (신규): repository mock 으로 statusType/stepIndex 필터가 정확한지.
- **Integration (수동 — dev tenant):**
  - 1. 사용자가 콘솔에서 남동구 템플릿을 2-step으로 변경.
  - 2. staff.babyjamjam.com 에서 산모계약서 발급 wizard 실행 → 이용자 SMS 수신 → 이용자 서명.
  - 3. webhook DOC_REQUEST_PARTICIPANT 수신 후 `eformsign_doc.statusType='060'`, `stepIndex='2'` 확인.
  - 4. staff app 에서 pending list endpoint 호출 → 해당 문서 표시.
  - 5. (frontend 작업 후) Step 2 iframe 띄워 종료일 입력 → 직원 확정.
  - 6. webhook DOC_COMPLETE 수신, `client.endDate` 가 직원이 입력한 값으로 갱신됨을 DB에서 확인.
- 본 플랜은 backend 산물 위주이므로 step 5의 frontend 작업은 별도 plan으로 진행. backend는 endpoint 계약을 노출만 한다.

## Verification

Post-implementation checks per §24 Q4 (exact commands listed below):

**Backend build:** `pnpm --dir /Users/jaino/Development/babyjamjam-staff/dev/backend run build`

**Spec test (new specs created in Task 1.6):** `pnpm --dir /Users/jaino/Development/babyjamjam-staff/dev/backend exec jest test/usecases/eformsign-doc/sync-client-end-date.usecase.spec.ts test/services/eformsign-webhook.service.spec.ts --runInBand`

**Rollout:** N/A — additive change. Prisma schema 미변경, 기존 webhook event 처리 분기에 sync 호출만 추가.

**Rollback:** N/A — additive change. 신규 endpoint 미사용 시 기존 흐름 그대로 동작. Step 1 prefill 종료일 제거(Task 1.1)는 발급 후 사용자에게 보이는 화면에서만 종료일이 비어 보이게 되며, 이 변경을 되돌리려면 단순 revert.

# eformsign Headless Playwright Dispatch

Last verified: 2026-05-08

This document records the current backend-driven eformsign automation path. Read this before changing contract creation, staff final confirmation, iframe fallback, or eformsign gate selectors.

## Why This Exists

The staff app still uses the eformsign embedded SDK as the authoritative workflow surface. For the current member workflow, do not assume there is a working REST endpoint that can replace the SDK for advancing and sending a document. The backend Playwright path renders the same SDK off-screen, clicks the same gates a staff user would click, and returns a soft-failure envelope when automation cannot finish.

The design goal is:

- Try backend automation first so staff do not see the iframe during the normal path.
- Keep the existing manual iframe path as the fallback for eformsign UI changes, browser failures, selector misses, and SDK callback failures.
- Persist local `eformsign_doc` records only after eformsign confirms success.
- Preserve branch/tenant isolation through the existing `/eformsign-docs` Nest controller and Next.js API proxy.

## Code Map

Frontend:

- `frontend/src/components/app/messages/forms/ContractCreationForm.tsx`
  - Builds `contractData`.
  - Creates `progressId`.
  - Opens `EventSource` to `/api/eformsign-docs/dispatch-headless/progress`.
  - Calls `eformsignApi.dispatchHeadless(...)`.
  - Shows inline 5th-step progress and falls back to manual iframe controls on `ok: false`.
- `frontend/src/app/(protected)/contracts/page.tsx`
  - Keeps the active creation detail panel mounted while the user views another contract detail.
- `frontend/src/services/api.ts`
  - `dispatchHeadless(contractData, clientId, progressId)`.
  - `finalizeHeadless(documentId, prefillEndDate)`.
- `frontend/src/app/api/eformsign-docs/dispatch-headless/route.ts`
  - Proxies the creation request to Nest with a 180s timeout.
- `frontend/src/app/api/eformsign-docs/dispatch-headless/progress/route.ts`
  - Proxies backend SSE progress by `progressId`.
- `frontend/src/app/api/eformsign-docs/finalize-headless/route.ts`
  - Proxies staff-finalize headless requests with a 60s timeout.
- `frontend/src/lib/feature-flags.ts`
  - `headlessDispatch` is default-on.
  - Disable with `NEXT_PUBLIC_FEATURE_DISABLE_HEADLESS_DISPATCH=1`.

Backend:

- `backend/interface/controllers/eformsign-doc.controller.ts`
  - `POST /eformsign-docs/dispatch-headless`.
  - `GET /eformsign-docs/dispatch-headless/progress`.
  - `POST /eformsign-docs/finalize-headless`.
  - Guarded by `JwtGuard` and `TenantGuard`.
- `backend/interface/dto/eformsign-doc.dto.ts`
  - `DispatchHeadlessRequestDto`, `DispatchHeadlessResponseDto`.
  - `FinalizeHeadlessRequestDto`, `FinalizeHeadlessResponseDto`.
- `backend/application/usecases/eformsign-doc/dispatch-document-headless.usecase.ts`
  - Builds mode `"01"` SDK options.
  - Runs headless creation.
  - Persists the local document record on success.
  - Emits progress.
- `backend/application/usecases/eformsign-doc/finalize-document-headless.usecase.ts`
  - Builds mode `"02"` staff-completion SDK options.
  - Runs headless finalize.
- `backend/infrastructure/automation/eformsign-headless.service.ts`
  - Owns Playwright browser/context/page lifecycle and concurrency.
  - Builds the minimal embedded-SDK HTML.
  - Reads `window.__eformsignSuccess.document_id`.
- `backend/infrastructure/automation/eformsign-creation-gates.ts`
  - Clicks creation gates.
- `backend/infrastructure/automation/eformsign-finalize-gates.ts`
  - Clicks staff-finalize gates.
- `backend/infrastructure/automation/eformsign-gate-utils.ts`
  - Shared visible-locator, success-latch, and diagnostic snapshot helpers.
- `backend/application/services/eformsign-headless-progress.service.ts`
  - In-process RxJS progress bus.
- `backend/module/eformsign-doc.module.ts`
  - Wires controller, usecases, headless service, progress service, API client, and repositories.
- `backend/test/services/eformsign-headless.service.spec.ts`
  - Unit coverage for headless service result envelopes and SDK success callback handling.

## Creation Flow: mode "01"

Contract creation starts from the 5th wizard page, `전자문서 생성`.

```text
ContractCreationForm
  -> generate progressId
  -> EventSource /api/eformsign-docs/dispatch-headless/progress?progressId=...
  -> POST /api/eformsign-docs/dispatch-headless
  -> Next.js proxy
  -> Nest POST /eformsign-docs/dispatch-headless
  -> DispatchDocumentHeadlessUsecase
  -> GetEformsignAccessTokenUsecase
  -> EformsignService.generateDocumentOptions(...)
  -> EformsignHeadlessService.dispatchCreation(...)
  -> runEformsignCreationGates(...)
  -> SDK success callback writes window.__eformsignSuccess
  -> read document_id
  -> CreateEformsignDocUsecase
  -> response { ok: true, documentId, durationMs }
```

Important details:

- `DispatchDocumentHeadlessUsecase` still uses `EformsignService.generateDocumentOptions(...)` to build the same SDK payload as the iframe path. That is intentional.
- The newly created `documentId` comes from the SDK success callback, not from the mode `"01"` request payload.
- If the callback is missing or does not contain `document_id`, the usecase returns `ok: false` with `fallbackHint: "iframe"`.
- `clientId` is optional in the API contract, but without it the local `eformsign_doc` record cannot be linked to a client. Normal contract creation should pass it.
- The local record is persisted with status `"060"`, detail `"대기"`, step type `"01"`, step index `"1"`, and `linkToClient: true`.

## Creation Gate Sequence

The current creation gate runner is deliberately role/text based because eformsign DOM classes are unstable.

Current sequence:

```text
입력 시작
  -> 회사 도장 확인 x 3
  -> 다음
  -> 다음
  -> top-level 전송
  -> popup 전송 inside #requestWithInputCommentPopup
  -> SDK success callback
```

The loop checks in this priority order:

1. `window.__eformsignSuccess` already latched.
2. visible `확인` button.
3. visible popup `전송` in `#requestWithInputCommentPopup`.
4. visible top-level `전송`.
5. visible `다음`.
6. visible `입력 시작`.
7. footer ready text `필수 입력 항목을 모두 작성했습니다.`

Progress emitted to the frontend:

- `client-started`: iframe has been booted and points at `https://www.eformsign.com/...`.
- `info-inserted`: the three `회사 도장 확인` dialogs have been cleared, or send is reached.
- `creating`: send has been clicked.
- `sent`: SDK success callback has fired and the success envelope is returned.
- `failed`: emitted with `reason` and `failedStep` when a headless run cannot finish.

## Staff Finalize Flow: mode "02"

Final confirmation uses the same browser service but a shorter gate sequence.

```text
contracts detail "확인하기"
  -> frontend eformsignApi.finalizeHeadless(documentId, prefillEndDate)
  -> Next.js proxy
  -> Nest POST /eformsign-docs/finalize-headless
  -> FinalizeDocumentHeadlessUsecase
  -> GetEformsignAccessTokenUsecase
  -> EformsignService.generateStaffCompletionOptions(...)
  -> EformsignHeadlessService.dispatchFinalize(...)
  -> runEformsignFinalizeGates(...)
  -> SDK success callback
  -> response { ok: true, durationMs }
```

Current finalize gate sequence:

```text
top-level 전송
  -> popup 전송 inside #requestWithInputCommentPopup
  -> optional 확인 dialog if eformsign shows one
  -> SDK success callback
```

Finalize does not currently stream progress to the frontend. It returns `ok: false` and `fallbackHint: "iframe"` on failure, then the caller opens the staff completion iframe.

## Embedded SDK HTML

`EformsignHeadlessService.buildEmbeddedSdkHtml(...)` creates a minimal HTML page:

- One iframe with the caller-provided id.
- Loads jQuery from `https://www.eformsign.com/plugins/jquery/jquery.min.js`.
- Loads eformsign SDK from `https://www.eformsign.com/lib/js/efs_embedded_v2.js`.
- Calls:

```js
var sdk = new window.EformSignDocument();
sdk.document(
  option,
  iframeId,
  function (resp) { window.__eformsignSuccess = resp; },
  function (resp) { window.__eformsignError = resp; },
  function (resp) { window.__eformsignAction = resp; }
);
sdk.open();
```

The HTML is not opened from `about:blank`. It is served through an intercepted local URL like:

```text
http://localhost:3000/__eformsign-headless/creation-...
```

This local origin is required because the embedded SDK miscomputes iframe URLs from `about:blank`.

## Timeouts And What They Mean

These timeouts are intentionally different. Do not debug them as one generic "3 minute timeout".

| Timeout | Location | Meaning |
| --- | --- | --- |
| 30s | `waitForEformsignIframe(...)` | The SDK did not create an eformsign iframe with `src` starting `https://www.eformsign.com/`, or boot failed. |
| 60s | `runEformsignCreationGates(...)` | The creation iframe loaded, but the gate loop could not reach send. |
| 90s | `driveCreation(...)` success latch | Gates ran, but eformsign never fired the SDK success callback. |
| 30s | `runEformsignFinalizeGates(...)` | Finalize iframe loaded, but the short send gate could not finish. |
| 60s | `driveFinalize(...)` success latch | Finalize send clicked, but no SDK success callback arrived. |
| 180s | Next.js dispatch proxy | Upper bound for the full creation HTTP request. |
| 60s | Next.js finalize proxy | Upper bound for the full finalize HTTP request. |

If logs show `page.waitForFunction: Timeout 30000ms exceeded`, first inspect SDK boot and iframe creation, not the total request timeout.

## Failure Contract

Headless failures are soft failures. Backend responses should follow this shape:

```json
{
  "ok": false,
  "durationMs": 12345,
  "reason": "selector miss or timeout reason",
  "failedStep": "info-inserted",
  "fallbackHint": "iframe"
}
```

Frontend behavior:

- Creation failure stays on the 5th step.
- The failed step turns red and shows an X.
- The label changes to the matching `... 실패` copy.
- Helper text says `수동으로 입력해 주세요`.
- Staff can click `재시도` for another backend run.
- Staff can click `수동 입력` to open the iframe fallback.
- Staff can click `취소` after failure to clear the current creation session and allow a new send.

Completion behavior:

- After `sent`, the cancel button is hidden.
- The right-side `새 전자문서 발송` button resets the form and starts a fresh creation session.
- Header `전자문서 발송` must return to the current creation detail if a 5th-step session exists. It must not start a fresh session until the completed new-send button or failed cancel path clears the session.

## Concurrency And Resource Use

`EformsignHeadlessService` reuses one browser instance and creates a fresh context/page per dispatch. It caps concurrent dispatches at `MAX_CONCURRENCY = 3`.

Reason:

- Each Chromium context is memory-heavy.
- More than three simultaneous eformsign sessions can cause the Railway service to thrash.
- The wait queue is in-process only. It is not durable across server restarts.

If this moves to a multi-instance deployment, do not assume the queue is global. Add a real queue or per-tenant lock before relying on global dispatch limits.

## Troubleshooting

### `page.waitForFunction: Timeout 30000ms exceeded`

Likely owner: SDK boot or iframe creation.

Check:

- `EformsignHeadlessService.waitForEformsignIframe(...)`.
- Whether `window.__eformsignBootError` was set.
- Script load availability for jQuery and `efs_embedded_v2.js`.
- Whether the intercepted local URL was used instead of `about:blank`.
- Whether `documentOption.user.access_token` and `refresh_token` exist.
- Whether eformsign rejected the origin or SDK payload.

### Creation gate timeout after 60s

Likely owner: eformsign UI changed or selector priority is wrong.

Check:

- The thrown snapshot from `getEformsignGateSnapshot(...)`.
- `visibleButtons`.
- `guideButtonLabel`.
- `footerMessages`.
- `requestSendDialogVisible`.
- Whether the iframe now uses different Korean labels.

Patch the gate runner, not the controller or DTO, unless the request shape also changed.

### Success latch timeout after gate clicks

Likely owner: final send did not actually complete or SDK callback did not fire.

Check:

- Whether popup `전송` was clicked.
- Whether `window.__eformsignError` has a useful payload.
- Network failures inside the iframe.
- Whether eformsign opened a new unexpected confirmation layer.

Do not persist a local document record unless `document_id` is available from the SDK callback.

### `missing document_id from eformsign success callback`

The SDK success callback fired but did not include `document_id`. Treat this as a soft failure and fall back to iframe.

Do not invent a document id from request data. Mode `"01"` does not provide the new document id before success.

### Chromium launch failure

Likely owner: deployment/runtime package.

Check:

- Browser binary availability for `playwright-core`.
- Container dependencies needed by Chromium.
- Launch args in `EformsignHeadlessService.getBrowser()`.
- Runtime memory pressure.

Frontend maps Chromium/browser/executable errors to a manual-input message.

## Change Rules

When changing this area:

1. Preserve the `ok: false` + `fallbackHint: "iframe"` contract.
2. Preserve SDK success callback as the source of creation `documentId`.
3. Do not remove the iframe fallback unless a live-tested non-SDK eformsign endpoint replaces the whole gate sequence.
4. Do not add a direct REST approve/send path based on inference. Prove it against the live eformsign flow first.
5. Keep gate selectors role/text based where possible.
6. Keep diagnostic snapshots on timeout.
7. Keep creation progress tied to `progressId`; otherwise two browser sessions can cross-wire UI state.
8. Keep backend routes behind `JwtGuard` and `TenantGuard`.
9. Keep Next.js proxy routes as the browser entrypoint; the client should not call Nest directly.
10. If the form has reached the 5th step, preserve the current creation session until explicit completed-new-send or failed-cancel.

## Verification

Fast backend checks:

```bash
pnpm --dir backend exec jest test/services/eformsign-headless.service.spec.ts --runInBand
pnpm --dir backend run build
```

Frontend regression:

```bash
pnpm --dir frontend exec playwright test tests/contract-creation.spec.ts --project=chromium --reporter=line
```

Real-tenant smoke tests are side-effectful. They can create real eformsign documents and send real SMS. Only run them intentionally:

```bash
RUN_SMOKE_TESTS=1 pnpm --dir frontend exec playwright test tests/contract-creation.smoke.spec.ts --project=chromium --reporter=line
```

If a gate selector changes, an offline unit/spec pass is not enough. Either run the real smoke path with approval or manually verify against the live eformsign iframe and copy the observed button/snapshot state into the PR notes.

## Quick Debug Checklist

1. Confirm `headlessDispatch` is enabled or intentionally disabled.
2. Confirm frontend created a new `progressId`.
3. Confirm SSE connected to `/api/eformsign-docs/dispatch-headless/progress`.
4. Confirm Nest logs show `[POST /eformsign-docs/dispatch-headless] clientId=...`.
5. If failure is 30s, debug iframe boot.
6. If failure is 60s, debug creation gate selectors using the snapshot.
7. If failure is 90s, debug final send and SDK callback.
8. Confirm `document_id` exists before local persistence.
9. Confirm local `eformsign_doc` was created and linked to `client.eDocId`.
10. Confirm frontend did not open `#eformsign_iframe` unless the backend returned `ok: false` and staff chose manual input.

---
plan_id: efsi-2026-05-08-001
feature: finalize-headless-progress-stepper
status: approved
swagger_base: https://api.eformsign.com/v2.0
agent_version: v0.4.0
created_at: 2026-05-08T00:00:00Z
approved_at: 2026-05-07T18:21:55Z
content_hash: 0e78579c37ad064b509d9633f28382122072f198cb46add0dfc6e16bc2e49cdb
depends_on: []
surfaces_touched:
  - usecases
  - dto
---

## Summary

The staff "최종 확인" dialog (mode `"02"` finalize) currently shows only a "처리 중..." button while the headless Playwright run is in flight. Users get no feedback that maps to the four-step progress UI they already see during contract creation. This plan wires SSE-driven progress events through the finalize usecase, mirrors the existing creation progress channel, extracts the local `ContractCreationProgressStepper` into a shared `HeadlessProgressStepper`, and swaps the dialog body to that stepper when the user clicks `완료`. Per user instruction, only one step label diverges from creation: `info-inserted` is rendered as `서비스 종료일 적용중`.

## Requirements

### Goals
- When the user clicks `완료` in the `최종 확인` dialog, the dialog header is preserved but the body and footer are replaced by a vertical stepper showing live finalize progress.
- The stepper reuses the same visual language and step-state machine as `ContractCreationProgressStepper` (`pending` / `active` / `done` / `error`).
- Steps map to the four creation step identifiers (`client-started`, `info-inserted`, `creating`, `sent`); only the `info-inserted` active label is overridden to `서비스 종료일 적용중`.
- Backend finalize emits progress events through the existing `EformsignHeadlessProgressService` bus, on a SSE endpoint dedicated to finalize progress, gated by `progressId` (same shape as creation).
- The existing `ok=false → fallbackHint:"iframe"` contract from `docs/conventions/eformsign-headless-playwright.md` (lines 217–245) is preserved end-to-end. On failure, the dialog auto-falls-back to `StaffCompletionIframeModal` exactly as it does today.
- The shared stepper component is consumed by both creation and finalize without behavior regression on creation.

### Non-Goals
- No new eformsign REST `approve`/`send` endpoint; iframe SDK remains the source of truth (convention rule §4).
- No removal of the iframe fallback (convention rule §3).
- No new step identifiers or new progress event types; finalize reuses the four creation IDs to keep the SSE contract tight.
- No change to the `최종 확인` dialog's input field, validation, or end-date format.
- No change to the dispatch (creation) flow's existing copy or behavior.

## Technical Design

### eformsign Layer Touchpoints

- **Affected usecases:** `application/usecases/eformsign-doc/finalize-document-headless.usecase.ts` — accept `progressId?: string`, inject `EformsignHeadlessProgressService`, emit `client-started`/`sent`/`failed` (gates emit `info-inserted`/`creating`).
- **Service/controller/guard changes:**
  - `application/services/eformsign-headless-progress.service.ts` — no API change; reused as-is.
  - `infrastructure/automation/eformsign-headless.service.ts` — `dispatchFinalize(...)` accepts an optional `onProgress` callback and threads it to the gate runner.
  - `infrastructure/automation/eformsign-finalize-gates.ts` — `runEformsignFinalizeGates(...)` accepts `onProgress` and emits `info-inserted` once the gate loop confirms iframe responsiveness, then `creating` after the popup `전송` click.
  - `interface/controllers/eformsign-doc.controller.ts` — `POST /eformsign-docs/finalize-headless` forwards `progressId` to the usecase; new `@Sse("finalize-headless/progress")` endpoint mirrors the existing dispatch SSE handler shape.
- **`EformsignApiClient` method additions:** none.
- **DTO and mapper deltas:** `interface/dto/eformsign-doc.dto.ts` — `FinalizeHeadlessRequestDto` gains an optional `@IsString() @IsOptional() progressId?: string`. `FinalizeHeadlessResponseDto` is unchanged.
- **Prisma schema deltas:** none.
- **Env var additions:** none.
- **Webhook event types affected:** none.
- **NestJS module registration changes:** verify `module/eformsign-doc.module.ts` already provides `EformsignHeadlessProgressService` to `FinalizeDocumentHeadlessUsecase` (the dispatch usecase already consumes it, so the provider is present); add it as a constructor injection in the finalize usecase only.

### Design Details

#### Backend progress flow (mirrors creation)

Per `application/usecases/eformsign-doc/dispatch-document-headless.usecase.ts:77-82`, creation routes progress through:

```text
usecase.execute → headlessService.dispatchCreation({ onProgress })
  → onProgress(step) → progressService.emit(progressId, step)
```

Finalize will follow the identical pattern:

```text
finalizeUsecase.execute({ documentId, prefillEndDate, progressId })
  → progressService.emit(progressId, "client-started")  // after token+options ready, just before dispatchFinalize
  → headlessService.dispatchFinalize({ documentOption, documentId, onProgress })
       → runEformsignFinalizeGates({ ...rest, onProgress })
            onProgress("info-inserted")  // gate loop iteration 1 (iframe ready, prefill applied)
            onProgress("creating")        // immediately after popup 전송 click
       → SDK success latch
  → progressService.emit(progressId, "sent")
  → returns { ok: true, durationMs }
```

On failure, the usecase emits `failed` with `failedStep` set to whichever step the gate loop last reached (defaulting to `client-started` if the gate loop never ran). This mirrors the dispatch usecase's `failed` emission.

The four-step semantic mapping for finalize:

| Step ID | Creation meaning | Finalize meaning | Active label (frontend) |
|---|---|---|---|
| `client-started` | iframe booted | iframe booted | 전자문서 클라이언트 시작 |
| `info-inserted` | 회사 도장 확인 cleared | end-date prefill applied | **서비스 종료일 적용중** (override) |
| `creating` | top-level 전송 clicked | popup 전송 clicked | 전자문서 생성 중 |
| `sent` | SDK success callback | SDK success callback | 전자문서 전송 완료 |

The user's instruction was to change only the `info-inserted` active label. Other labels are kept verbatim from creation. Per-step error labels are derived as `{label} 실패` (existing creation pattern), so the finalize-side `info-inserted` error label naturally reads `서비스 종료일 적용 실패`.

#### Frontend stepper extraction

The local `ContractCreationProgressStepper` at `frontend/src/components/app/messages/forms/ContractCreationForm.tsx:250-348` becomes a shared `HeadlessProgressStepper` at `frontend/src/components/app/eformsign/HeadlessProgressStepper.tsx`. The shared component's props:

```ts
type HeadlessProgressStepKey = "client-started" | "info-inserted" | "creating" | "sent";

interface HeadlessProgressStep {
  key: HeadlessProgressStepKey;
  label: string;       // active/pending/done label
  errorLabel: string;  // failed-state label
}

interface HeadlessProgressState {
  step: HeadlessProgressStepKey | null;
  completed: boolean;
  failed: boolean;
}

interface HeadlessProgressStepperProps {
  steps: readonly HeadlessProgressStep[];
  progress: HeadlessProgressState;
  ariaLabel: string;
  className?: string;
  errorHint?: string;          // optional secondary line shown under failed step (creation passes "수동으로 입력해 주세요"; finalize omits)
  dataComponentPrefix?: string; // defaults to "headless-progress"; creation overrides with "contract-creation-processing" to preserve existing data-component selectors and the spinner CSS animation hook
}
```

To preserve the existing creation `data-component` selectors (`contract-creation-processing-stepper`, `-step`, `-circle`, `-connector`, `-label`) and the `.contract-creation-processing-spinner` CSS keyframe, the shared component composes its `data-component` attributes from `dataComponentPrefix`. ContractCreationForm calls it with `dataComponentPrefix="contract-creation-processing"`; finalize calls it with the default `"headless-progress"` (or `"contracts-finalize-processing"` to keep finalize selectors distinct — final naming chosen during execution per the data-component skill).

Test selectors: existing creation-side `data-testid="contract-creation-progress-stepper"` and friends are preserved by passing a `testIdPrefix?: string` prop with the same defaulting semantics (`contract-creation-progress` for creation, `finalize-progress` for finalize). The Playwright spec at `frontend/tests/contract-creation.spec.ts` continues to assert the creation prefix and is not modified by this plan.

#### Frontend dialog state machine (ContractDetail in `frontend/src/app/(protected)/contracts/page.tsx:891-1207, 1630-1678`)

Add three new pieces of local state to `ContractDetail`:

```ts
const [finalizeProgress, setFinalizeProgress] = useState<HeadlessProgressState>({
  step: null, completed: false, failed: false,
});
const finalizeProgressIdRef = useRef<string | null>(null);
const finalizeEventSourceRef = useRef<EventSource | null>(null);
```

Lifecycle:

1. `handleFinalizeSubmit` — generate a new `progressId`, store in ref, optimistically set `finalizeProgress` to `{ step: "client-started", completed: false, failed: false }`, open `EventSource` to `/api/eformsign-docs/finalize-headless/progress?progressId=...`, wire `progress` listener (same shape as `ContractCreationForm.tsx:734-763`), then call `mutate(finalizeEndDate)`.
2. `mutationFn` — pass `progressId` to `eformsignApi.finalizeHeadless(doc.id, endDate, progressId)`.
3. `onSuccess (kind:"headless")` — close EventSource, reset progress state, then proceed with existing close+toast flow.
4. `onSuccess (kind:"iframe")` — close EventSource, reset progress state, hand off to existing iframe modal flow.
5. `onError` — close EventSource, set `finalizeProgress.failed = true` for visual feedback (briefly visible before dialog falls through to iframe path or stays open with toast), proceed with existing error toast.

Dialog body rendering rule:

```ts
const showStepper = isFinalizePending || finalizeProgress.step !== null;
```

When `showStepper`:
- Render `<HeadlessProgressStepper>` in place of the date input field.
- Hide the entire `<DialogFooter>` (취소/완료 buttons). Per the chosen design option 1, the footer disappears entirely while progress is in flight; success closes the dialog automatically and failure transitions to the iframe modal.
- Header (`최종 확인`) and description (`서비스 완료일을 수정한 뒤 확정해 주세요.`) remain. The description is acceptable as-is during the brief progress phase; if the description visually competes with the stepper during execution, the data-component skill review can suggest updating it as a follow-up, but per the user's "텍스트만" constraint the description text is not changed in this plan.

When `!showStepper`:
- Render the existing date input + footer unchanged.

`handleFinalizeDialogChange(false)` must also close the EventSource and reset progress state (defensive: dialog could be closed by ESC during processing — though `isFinalizePending` already blocks this path today, see `frontend/src/app/(protected)/contracts/page.tsx:1196-1207`).

#### SSE proxy route

New file `frontend/src/app/api/eformsign-docs/finalize-headless/progress/route.ts` mirrors `frontend/src/app/api/eformsign-docs/dispatch-headless/progress/route.ts` (already created on this branch per `gitStatus`). It pipes `Authorization` Bearer header through to `serverAPIClient.get("/eformsign-docs/finalize-headless/progress?progressId=...", { responseType: "stream" })` and forwards the SSE bytes back to the browser.

#### data-component naming compliance

All new DOM nodes follow the `data-component-naming` skill convention. New roots:
- `<div data-component="contracts-finalize-progress-section">` (the dialog body wrapper when `showStepper`).
- The shared stepper composes via the `dataComponentPrefix` prop; creation continues to render `contract-creation-processing-*` and finalize renders `contracts-finalize-progress-*`.

The existing `data-component="contracts-finalize-end-date-field"` and the input `id="contract-finalize-end-date-{doc.id}"` are preserved unchanged.

## Task Breakdown

#### Task 1: Add `progressId` to `FinalizeHeadlessRequestDto`
**Tier:** trivial
**Sandbox:** local
**Paths:** `backend/interface/dto/eformsign-doc.dto.ts`
**Depends:** none

Add an optional `@IsString() @IsOptional() progressId?: string` field to `FinalizeHeadlessRequestDto` (`backend/interface/dto/eformsign-doc.dto.ts:117-126`). No change to `FinalizeHeadlessResponseDto`.

#### Task 2: Plumb `onProgress` through finalize gate runner
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/infrastructure/automation/eformsign-finalize-gates.ts`
**Depends:** none

Add an optional `onProgress?: (step: "info-inserted" | "creating") => void` parameter to `runEformsignFinalizeGates(...)`. Emit `info-inserted` exactly once at the start of the gate loop after the iframe is detected as visible (the prefilled end date is part of the SDK options and is already applied at this point). Emit `creating` immediately after the popup `전송` click (the `request-send-clicked` branch returned by the gate utility, before the success latch).

#### Task 3: Plumb `onProgress` through `dispatchFinalize`
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/infrastructure/automation/eformsign-headless.service.ts`
**Depends:** Task 2

Add an optional `onProgress` parameter to `dispatchFinalize(...)` (mirror the `dispatchCreation` signature). Forward it into `runEformsignFinalizeGates(...)`. No change to the Playwright lifecycle, success latch, or 60s timeout.

#### Task 4: Wire `progressId` and progress emission through finalize usecase
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/application/usecases/eformsign-doc/finalize-document-headless.usecase.ts`
**Depends:** Task 3

- Inject `EformsignHeadlessProgressService` (already wired to the dispatch usecase via the same module).
- Extend `FinalizeHeadlessParams` with `progressId?: string`.
- Emit `client-started` after `generateStaffCompletionOptions(...)` returns and before calling `dispatchFinalize(...)`.
- Pass an `onProgress: (step) => this.progressService.emit(params.progressId, step)` callback to `dispatchFinalize`.
- Emit `sent` on success and `failed` (with `reason`, `failedStep` derived from the latest gate step the runner reached, defaulting to `client-started`) on every error/soft-failure path.

#### Task 5: Add finalize-progress SSE endpoint and forward `progressId` from controller
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/interface/controllers/eformsign-doc.controller.ts`
**Depends:** Task 1, Task 4

- In the existing `POST /eformsign-docs/finalize-headless` handler, forward `dto.progressId` to `finalizeHeadlessUsecase.execute(...)`.
- Add `@Sse("finalize-headless/progress") finalizeHeadlessProgress(@Query("progressId") progressId: string): Observable<MessageEvent>` mirroring the structure of the existing dispatch SSE handler at `interface/controllers/eformsign-doc.controller.ts:59-71` (filter on `progressId`, merge with 30s heartbeat).

#### Task 6: Verify module wiring
**Tier:** trivial
**Sandbox:** local
**Paths:** `backend/module/eformsign-doc.module.ts`
**Depends:** Task 4

Confirm `EformsignHeadlessProgressService` is in the `providers` array (it should be, since the dispatch usecase already consumes it). Confirm the finalize usecase resolves the new dependency at boot. No new providers expected.

#### Task 7: Update finalize headless service spec
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/test/services/eformsign-headless.service.spec.ts`
**Depends:** Task 3

Extend the existing spec to assert that `dispatchFinalize(...)` invokes the new `onProgress` callback at least once with `"info-inserted"` or `"creating"` (depending on what the existing mock harness exposes — keep the assertion minimal so the spec doesn't pin Playwright internals). If the existing harness is too narrow to cover this, record the gap as an open item and skip the assertion.

#### Task 8: Extract shared `HeadlessProgressStepper` component
**Tier:** standard
**Sandbox:** local
**Paths:** `frontend/src/components/app/eformsign/HeadlessProgressStepper.tsx`, `frontend/src/components/app/messages/forms/ContractCreationForm.tsx`
**Depends:** none

- Create the new file and copy the body of `ContractCreationProgressStepper` (`ContractCreationForm.tsx:250-348`) into it, generalising on a `steps` prop, an `errorHint?` prop, and a `dataComponentPrefix` / `testIdPrefix` prop so callers can preserve their existing selectors. Export the component plus the public types listed in §Technical Design.
- In `ContractCreationForm.tsx`, delete the local `ContractCreationProgressStepper` definition and import the shared component. Pass `steps={CONTRACT_CREATION_PROGRESS_STEPS}`, `errorHint="수동으로 입력해 주세요"`, `dataComponentPrefix="contract-creation-processing"`, `testIdPrefix="contract-creation-progress"`. Pass an `errorLabel` for each existing step that exactly reproduces the current `CONTRACT_CREATION_PROGRESS_FAILURE_LABELS` map. Keep the `aria-label="전자계약서 생성 진행 상태"`.
- The existing `.contract-creation-processing-spinner` CSS animation hook on the active spinner must remain attached when `dataComponentPrefix === "contract-creation-processing"`. Apply the class conditionally inside the shared component or always emit `<class>-spinner` so the existing keyframe rule still matches.

#### Task 9: Add `progressId` to frontend `finalizeHeadless` API helper
**Tier:** trivial
**Sandbox:** local
**Paths:** `frontend/src/services/api.ts`
**Depends:** Task 5

Extend `finalizeHeadless(documentId, prefillEndDate?, progressId?)` (existing signature at `frontend/src/services/api.ts:252-261`) to forward `progressId` in the POST body when provided.

#### Task 10: Add Next.js SSE proxy for finalize progress
**Tier:** standard
**Sandbox:** local
**Paths:** `frontend/src/app/api/eformsign-docs/finalize-headless/progress/route.ts`
**Depends:** Task 5

Create the new route file mirroring the existing `dispatch-headless/progress/route.ts` (per `gitStatus`, that file exists on this branch and must be the structural template). Stream SSE bytes from Nest with the user's `Authorization` header, forwarding the `progressId` query parameter.

#### Task 11: Wire finalize progress and dialog body swap in `ContractDetail`
**Tier:** heavy
**Sandbox:** local
**Paths:** `frontend/src/app/(protected)/contracts/page.tsx`
**Depends:** Task 8, Task 9, Task 10

- Add `finalizeProgress` state, `finalizeProgressIdRef`, `finalizeEventSourceRef` per §Technical Design.
- Define a `FINALIZE_PROGRESS_STEPS` constant (file-local) with the four step IDs and the overridden `info-inserted` label `서비스 종료일 적용중`. Each step gets a derived `errorLabel` matching its active label.
- In `handleFinalizeSubmit`, generate a `progressId`, optimistically set `finalizeProgress.step="client-started"`, open the `EventSource` against the new proxy route, attach the `progress` listener (same parsing shape as `ContractCreationForm.tsx:734-763`), then call `openStaffCompletionMutation.mutate(...)` after wiring `progressId` into the mutation closure.
- In `openStaffCompletionMutation.mutationFn`, pass `progressId` into `eformsignApi.finalizeHeadless(doc.id, endDate, progressId)`.
- In `onSuccess` (both `kind:"headless"` and `kind:"iframe"`) and `onError`, close the EventSource and reset `finalizeProgress` to its initial state.
- Inside `<DialogContent>`, gate the body: when `showStepper === isFinalizePending || finalizeProgress.step !== null`, render `<HeadlessProgressStepper>` and hide `<DialogFooter>`. Otherwise render the existing input + footer.
- Wrap the new stepper section in `<div data-component="contracts-finalize-progress-section">`.
- Preserve the existing `<DialogHeader>` (title, description) and the existing `data-component="contracts-finalize-end-date-field"` and input id when the form view is shown.

#### Task 12: Frontend Playwright regression for finalize stepper
**Tier:** standard
**Sandbox:** local
**Paths:** `frontend/tests/staff-finalize.headless.spec.ts`
**Depends:** Task 11

Extend the existing finalize headless spec to:
- Mock the SSE finalize-progress stream and assert the dialog body switches to the stepper when `완료` is clicked.
- Assert the `info-inserted` step renders the literal text `서비스 종료일 적용중`.
- Assert footer buttons are not rendered while progress is active.
- Re-run the existing creation regression to verify no regression in `frontend/tests/contract-creation.spec.ts` (no edits to that spec; it should still pass after Task 8 because the `dataComponentPrefix`/`testIdPrefix` defaults preserve creation selectors).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Extracting the stepper breaks creation's existing `data-component` / `data-testid` selectors and CSS spinner animation | M | H | Tasks 8 explicitly preserve `dataComponentPrefix="contract-creation-processing"` and `testIdPrefix="contract-creation-progress"`, plus a guarantee that the spinner gets the `contract-creation-processing-spinner` class. Run `frontend/tests/contract-creation.spec.ts` post-extract before merging. |
| Finalize gate emit timing produces a near-instant `info-inserted` → `creating` transition that the user can't perceive, making the stepper feel jumpy | M | L | Acceptable for v1 — creation has the same characteristic when the gate loop runs fast. Future tuning is out of scope. |
| Failure during finalize causes both the stepper (red) and the iframe modal to be visible simultaneously for a moment | L | L | The current `onError`/`onSuccess(kind:"iframe")` paths immediately close the dialog before opening the iframe modal; closing also resets progress state. The transition is single-frame and acceptable. |
| Heartbeat-only SSE traffic (no progress events arrive) leaves the stepper stuck on `client-started` while the backend is mid-flight | L | M | Acceptable failure mode: if the backend never emits `info-inserted`, that means the gate runner never reached its first iteration — the eventual 60s soft-fail will set `finalizeProgress.failed=true` and the iframe fallback kicks in. Identical to creation's behaviour. |
| Convention rule §3 (preserve iframe fallback) is accidentally weakened by hiding the footer | L | H | The fallback is preserved by `onSuccess(kind:"iframe")` automatically opening `StaffCompletionIframeModal`. Hiding the footer only removes the `취소` and `완료` buttons during in-flight progress; the modal continues to fall back without manual user action on failure. |

## Testing Strategy

- **Unit:** the existing `backend/test/services/eformsign-headless.service.spec.ts` is extended in Task 7 to cover the new `onProgress` callback in `dispatchFinalize`. If the spec's mocked harness cannot reliably observe gate-internal callbacks without pinning Playwright internals, record `targeted_test: best-effort` for that surface and rely on the build + frontend Playwright spec for end-to-end coverage.
- **Integration / Playwright:** `frontend/tests/staff-finalize.headless.spec.ts` is extended in Task 12 to assert the stepper renders, the `info-inserted` label is `서비스 종료일 적용중`, and the footer is hidden during progress. The pre-existing `frontend/tests/contract-creation.spec.ts` is re-run unchanged and must remain green after the shared-component extraction.
- **Manual smoke (optional):** `RUN_SMOKE_TESTS=1 pnpm --dir frontend exec playwright test tests/contract-creation.smoke.spec.ts --project=chromium` is not part of CI but is the recommended manual verification if a real eformsign tenant is available — finalize against a real document and confirm step transitions visually.

## Verification

Post-implementation checks per §24 Q4 (exact commands listed below):

**Backend build:** `pnpm --dir backend run build`

**Spec test:** `pnpm --dir backend exec jest test/services/eformsign-headless.service.spec.ts --runInBand`

**Frontend regression (recommended, not part of the verification halt gate):** `pnpm --dir frontend exec playwright test tests/staff-finalize.headless.spec.ts tests/contract-creation.spec.ts --project=chromium --reporter=line`

**Rollout:** N/A — additive change; the existing fallback contract (`ok=false → fallbackHint:"iframe"`) is preserved end-to-end.

**Rollback:** N/A — additive change; reverting the diff disables the stepper and restores the prior in-place "처리 중..." button without data migration.

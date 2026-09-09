Model: gpt-5.6-sol | Effort: high

FINAL_VERDICT: FIX_REQUIRED

1. Canonical planned dates — CLOSED  
   Full `1..N` projections, including unwritten sessions and immutable `originalDate`, are exposed at the root and used for dialog defaults/display without fabricating DB day rows.  
   Evidence: `backend/application/services/admin-service-record.service.ts:193`, `backend/application/policies/service-record-edit-preview.policy.ts:393`, `frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:537`, `:566`, `:766`, `:822`, `:1066`.

2. Failed date saves — CLOSED  
   The pending `toDate` survives 403/409/unknown failures, the dialog remains open, retries require another explicit click, and 409 exposes “최신 초안 불러오기.” No automatic resend exists.  
   Evidence: `frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:629`, `:662`, `:736`; `frontend/src/components/app/service-record/ServiceRecordDateSelectionDialog.tsx:232`, `:458`.

3. Signature/document metadata — BLOCKED  
   Server observation, source/preview hashing, UI display, and the explicit “계약서 서명을 재사용하지 않습니다” boundary are present. However, the frozen contract’s contract stage is still typed as unrestricted `string | null`, and the normalizer accepts any non-empty string.

   - Trigger: a malformed 200 response supplies `contract.stage: "sent"`.
   - Consequence: it is accepted as valid metadata instead of failing closed against `completed | rejected | in_progress | unknown`.
   - Minimum fix: introduce the exact shared stage union, retain permitted null semantics, and validate that union in the frontend normalizer.
   - Evidence: `packages/shared/src/types/service-record.ts:114`, `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:350`.

4. Unsupported year/null N — CLOSED  
   Unsupported calendar derivation no longer crashes the editor or invents `N`; persisted rows remain available as supplemental evidence and projection/preview remain blocked.  
   Evidence: `backend/application/services/admin-service-record.service.ts:66`, `frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:183`, `:206`, `:299`, `:929`.

5. Malformed preview fail-closed behavior — BLOCKED  
   Several load-bearing parser gaps remain:

   - A blocked empty-vector response suppresses `INVALID_PREVIEW_RESPONSE` for every invalidity, including omitted signature/document metadata. Trigger: valid server blocker plus empty vectors but missing metadata. Consequence: omitted metadata is replaced with defaults without the required invalid-response blocker. Evidence: `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:420`, `:431`, `:439`.
   - Duplicate `serviceDate` values across different session indices are not detected. Consequence: a malformed same-day multi-session vector can remain unblocked. Evidence: `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:128`.
   - A legitimate shifted vector can be rejected because every immutable `originalDate` is required to remain inside the shifted vector’s current `startDate/endDate`. Moving the first session forward naturally violates that test. Evidence: `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:147`.
   - Valid zero-based document chunk index `0`, produced by the repository, is rejected by `nullablePositiveInteger`. Evidence: `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:238`, `:333`; `backend/infrastructure/database/repositories/service-record-edit.repository.ts:226`.

   Minimum fix: isolate the blocked-vector exception to count/vector coverage only; never waive envelope/metadata validity, enforce unique current dates, validate original dates without constraining them to the shifted current range, and accept non-negative chunk indices.

6. Draft/source coherence — CLOSED, structurally proven  
   Production code uses one typed interactive Prisma transaction with `Prisma.TransactionIsolationLevel.RepeatableRead`, and preview resolution consumes that combined snapshot. The unit regression verifies one transaction, the isolation option, transaction-client reads, and avoidance of the former separate service reads.  
   Evidence: `backend/infrastructure/database/repositories/service-record-edit.repository.ts:433`, `:437`, `:442`; `backend/application/services/admin-service-record-edit.service.ts:405`; `backend/test/repositories/service-record-edit.repository.spec.ts:237`, `:350`; `backend/test/services/admin-service-record-edit.service.spec.ts:418`, `:438`.

The supplied 54-backend and 36-frontend corrective receipts were considered but not rerun. The concurrency evidence is mocked structural/unit evidence, not an actual PostgreSQL preview/PATCH race. No tests, builds, DB, env, network, browser, or vendor actions were performed.
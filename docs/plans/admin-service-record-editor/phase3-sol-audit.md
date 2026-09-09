Model: gpt-5.6-sol | Effort: high

FINAL_VERDICT: FIX_REQUIRED

## HIGH

1. Future/unwritten sessions cannot be date-moved.

Trigger: when `N` exceeds the number of persisted day rows, the editor obtains dates only from `activeContext.sessions`; missing sessions resolve to `""`, and the date dialog classifies that as malformed and disables selection. The editor endpoint likewise returns only persisted `record.days`. [ServiceRecordAdminWizard.tsx:721](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:721), [ServiceRecordAdminWizard.tsx:994](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:994), [admin-service-record.service.ts:191](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record.service.ts:191), [ServiceRecordDateSelectionDialog.tsx:95](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordDateSelectionDialog.tsx:95)

Consequence: the required suffix move cannot start from an unwritten session, despite the server being able to calculate its authoritative planned date. Immutable `originalDate` is also ignored by the main editor display, which instead treats the current persisted day as original. [ServiceRecordAdminWizard.tsx:777](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:777)

Smallest fix: expose/hydrate the canonical planned vector for every `1..N`, including immutable `originalDate`, and use it for `defaultDate`, the dialog’s current date, and original/revised rendering. Add a UI regression with an unwritten target session.

2. Failed date saves discard the administrator’s selected date.

Trigger: every 403/409/unknown failure closes the dialog. Its open/date reset key then reconstructs selection from the unchanged saved date. [ServiceRecordAdminWizard.tsx:626](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:626), [ServiceRecordDateSelectionDialog.tsx:225](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordDateSelectionDialog.tsx:225). The test explicitly codifies closing and reverting after 403. [ServiceRecordAdminWizard.test.tsx:411](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/service-record/ServiceRecordAdminWizard.test.tsx:411)

Consequence: the “현재 입력은 유지됩니다” message is false for the load-bearing `toDate`; response loss cannot be safely inspected or explicitly retried without re-entering the date.

Smallest fix: retain the pending date and keep the dialog recoverable on failure, with explicit retry/latest-draft controls. Do not automatically resend the command.

3. The authoritative preview omits approved signature and document-impact fields.

The approved Phase 3 acceptance requires signature handling and the document regeneration scope in the preview. [implementation-plan.md:227](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/implementation-plan.md:227). The response type and preview hash contain only dates, assignment provenance, content changes, and blocking reasons. [service-record.ts:95](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/shared/src/types/service-record.ts:95), [service-record-edit-preview.policy.ts:730](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-edit-preview.policy.ts:730)

Consequence: the administrator cannot review those effects, and the `previewId` does not bind the signature/document intent that Phase 4 must later confirm.

Smallest fix: add metadata-only signature treatment and affected document/version scope to the source snapshot, response, preview fingerprint, and read-only dialog. This does not require vendor dispatch.

4. Unsupported-year legacy cases can crash the whole editor instead of remaining viewable.

Trigger: when persisted `requiredSessionCount` is null, `servicePeriodSessionCount` calls the fail-closed calendar without catching `UnsupportedKoreanHolidayYearError`; `getClientEditor` therefore returns a server error for, for example, a 2028 legacy period. [admin-service-record.service.ts:66](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record.service.ts:66), [admin-service-record.service.ts:173](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record.service.ts:173)

Consequence: unsupported legacy evidence is neither viewable nor draftable, instead of loading with preview/confirmation blocked.

Smallest fix: handle unsupported derivation at the presentation boundary without inventing `N`; retain existing rows as supplemental evidence and surface the authoritative blocking reason.

## MEDIUM

5. A partially malformed successful preview response is treated as unblocked.

Invalid sessions and provenance entries are silently dropped, while the mere presence of IDs and `before`/`after` objects suppresses `INVALID_PREVIEW_RESPONSE`. [admin-service-record-edit.api.ts:46](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/features/service-records/api/admin-service-record-edit.api.ts:46), [admin-service-record-edit.api.ts:135](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/features/service-records/api/admin-service-record-edit.api.ts:135)

Consequence: `N=13` with missing rows can display “계산된 회차가 없습니다” and “변경되는 배정이 없습니다” without a blocker.

Smallest fix: validate exact `1..N` before/after coverage, uniqueness, identifiers, dates, and provenance coverage; any incomplete 200 response must become `INVALID_PREVIEW_RESPONSE`.

6. Preview issuance has a draft-version TOCTOU window.

`findDraftById` and source loading occur as separate reads. A concurrent CAS update between them can make version 2 current while a version 1 preview is subsequently returned without 409. [admin-service-record-edit.service.ts:204](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:204), [admin-service-record-edit.service.ts:403](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:403)

Smallest fix: load/fence the draft and source in one repeatable-read operation, or reread the draft version before issuing the preview. Add the currently missing preview/PATCH barrier regression.

Evidence and limits: frozen HEAD matched `c8c7dd60ef9e7b8554c554c574f8c43c75c68a10`; only the specified Phase 3 diff and critical owning seams were inspected. Supplied logs confirm backend 86/86, shared 44/44, existing Task 3.0 PG 19/19, frontend 55/55, and mobile 3/3. No tests, builds, DB, env, network, browser, or vendor actions were run. The PG evidence does not cover preview concurrency, and [verification.md:17](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/verification.md:17) still records Phase 3 as `NOT RUN`. No new authentication bypass, cross-branch access, secret exposure, or injection seam was found. Phase 4 confirmation and Phase 5 vendor/PDF proof were not treated as Phase 3 omissions.


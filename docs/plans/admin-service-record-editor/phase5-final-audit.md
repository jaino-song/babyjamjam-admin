# Phase5 independent audit

Runtime: gpt-5.6-sol / high. Session: 01a081e9-5b2e-7732-a961-b3d34d8a3d12. Reviewed integration82a2594d5 read-only; no tests or external calls.

Model: gpt-5.6-sol | Effort: high

REVISE

Verified defects

1. Most important: a delayed webhook for an older completed contract can restore that document as the client’s current contract and overwrite the revised end date.

   Trigger: an old contract completion event arrives after a newer revision/document is current. The completion handler unconditionally invokes the legacy linker and end-date synchronization without comparing revision ID, operation generation, mirror generation, or the current contract pointer ([eformsign-webhook.service.ts:944](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-webhook.service.ts:944), [eformsign-webhook.service.ts:955](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-webhook.service.ts:955), [eformsign-webhook.service.ts:967](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-webhook.service.ts:967)). The linker writes `client.eDocId` directly ([sb.eformsign-doc.repository.ts:588](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts:588)), and the lifecycle path writes `client.endDate` using only branch/client identity ([service-record-lifecycle.service.ts:793](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:793)).

   Consequence: stale provider events can replace the current contract pointer and dates, violating the Phase5 stale-webhook CAS requirement. Gate these side effects on the current revision/document/generation and leave stale events limited to their own historical document row.

2. The real confirmation path creates an empty contract update, while tests supply the missing date-field mapping manually.

   Trigger: a period-changing confirmation has otherwise trusted source facts and verified capability. The production planner sets `targetPeriod.fields` to `{}` ([admin-service-record-edit.service.ts:794](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:794)); the fact mapper preserves that empty map ([service-record-revision-facts.policy.ts:1073](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-facts.policy.ts:1073)); validation permits it ([service-record-contract-revision.service.ts:567](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-contract-revision.service.ts:567)). The provider then receives no changed fields, and `matchesDesiredFields` succeeds vacuously for the empty map ([service-record-contract-revision.service.ts:777](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-contract-revision.service.ts:777), [service-record-contract-revision.service.ts:900](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-contract-revision.service.ts:900)).

   Consequence: once activation is trusted, the operation can advance to `waiting_for_signature` without changing the contract period; completed-contract replacement creation likewise receives empty target fields. Build the exact start/end/receipt-period field map from observed provider field IDs, require the necessary target fields to be non-empty, and cover the actual confirm-planner-to-worker route with mocked trusted capability.

3. The source-fact mapper can infer workflow authority from a display label.

   Trigger: no explicit trusted `stage` is supplied. `deriveStage` classifies step type `05` by regex-matching `stepName` for words such as “관리자” or “고객” ([service-record-revision-facts.policy.ts:742](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-facts.policy.ts:742), [service-record-revision-facts.policy.ts:775](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-facts.policy.ts:775)). The real repository projection supplies the label but no explicit adapter-verified stage ([service-record-edit.repository.ts:437](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:437)).

   Consequence: after Phase0 metadata becomes available, a renamed or misleading step can be treated as an authorized provider/customer stage. Require explicit adapter-owned stage evidence or derive it only from structured status, recipient type, and verified save permissions; label-only evidence must remain manual review.

Verified fixes and limits

- The bigint allocation conversion and successive-version maximum calculation are present ([service-record-edit.repository.ts:2513](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:2513)).
- Replacement of a prior usable revision is guarded by increasing document version and current-revision ownership ([service-record-edit.repository.ts:2590](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:2590), [service-record-edit.repository.ts:2673](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:2673)).
- Lifecycle completion now fences snapshots to the current usable revision/version ([service-record-lifecycle.service.ts:640](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:640), [service-record-lifecycle.service.ts:699](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:699)). This does not protect the separate legacy contract-completion side effects in finding 1.

Activation limitations

- Production revision jobs are currently not reachable even if trusted facts/capability are supplied: both authorization entrypoints unconditionally reject every revision-bound context ([sb.eformsign-document-job.repository.ts:243](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:243), [sb.eformsign-document-job.repository.ts:515](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:515)), and the module binds explicit unverified adapters ([eformsign-doc.module.ts:180](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/module/eformsign-doc.module.ts:180)). Under the approved contract this is an explicit Phase0 activation limitation, not itself a Phase5 defect; mocked positive-route evidence is not production reachability proof.
- Missing `templateVersion`, `mirrorGeneration`, or permission metadata remains fail-closed; I found no timestamp/hash/default fabrication for those fields.
- Phase0 authoritative vendor/PDF activation remains unverified. Phase6 real HTTP guard and browser tests remain pending.
- No tests were run, per the audit restriction. No hypotheses are being reported as defects.


## Same-session closure review at1e2511738

Model: gpt-5.6-sol | Effort: high

REVISE

### Verified defect

1. The deferred mirrored reconciler still bypasses the current-pointer/revision fence.

   Trigger: an older completed contract’s mirror is reconciled after a newer revision or contract pointer becomes current. The reconciler always supplies `mirrorVersion` ([reconcile-completed-mirrored-eformsign-doc.usecase.ts:89](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase.ts:89)), selecting `syncEndDateFromMirroredContract`. That transaction validates mirror generation and document ownership, but does not compare `client.eDocId`, document `revisionId`, or the case’s `currentRevisionId` before persisting ([service-record-lifecycle.service.ts:666](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:666), [service-record-lifecycle.service.ts:720](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:720)). It consequently writes `client.endDate` and projects it into the case ([service-record-lifecycle.service.ts:931](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:931), [service-record-lifecycle.service.ts:948](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:948)).

   The mirrored linker likewise decides whether to replace `client.eDocId` using only `createdDate`, without revision identity ([link-mirrored-eformsign-doc-by-phone.usecase.ts:1359](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:1359), [link-mirrored-eformsign-doc-by-phone.usecase.ts:1371](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:1371)).

   Consequence: a stale poller/reconciler completion can still overwrite the current contract pointer or revised dates. Apply the same locked pointer/revision evidence used by `syncEndDateFromCurrentContract` inside the mirrored transaction, fence the mirrored pointer update by revision identity, and add an actual-PostgreSQL race through the reconciler entry point.

### Verified closures

- Finding 2 is closed: the confirmation planner now builds target values only from observed provider field IDs, supports separate and combined-period fields, and refuses invalid or empty mappings ([admin-service-record-edit.service.ts:795](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:795), [service-record-revision-facts.policy.ts:1094](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-facts.policy.ts:1094), [service-record-contract-revision.service.ts:309](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-contract-revision.service.ts:309)).
- Finding 3 is closed: display labels no longer establish workflow stage; explicit adapter stage or structured recipient/save-permission evidence is required ([service-record-revision-facts.policy.ts:823](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-facts.policy.ts:823)).
- Finding 1 is closed for the direct legacy webhook path, but not for the deferred mirrored reconciler described above.

### Hypotheses

None.

### Activation limitations

Phase0 production activation remains intentionally unverified and revision-bound dispatch remains fail-closed with zero external calls ([sb.eformsign-document-job.repository.ts:243](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:243), [eformsign-doc.module.ts:180](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/module/eformsign-doc.module.ts:180)). Phase6 HTTP-guard and browser verification also remains pending.
## Same-session residual review at77629a7ed

Model: gpt-5.6-sol | Effort: high

REVISE — local Phase5

### Verified defect

- [link-mirrored-eformsign-doc-by-phone.usecase.ts:1224](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:1224): when the new revision fence returns `ambiguous` for a stale assigned contract, `repairAssignedDocument` still unconditionally invokes `ensureServiceRecordLifecycle` at line 1225. Normal completed reconciliation supplies only `suppressOutboundAutomation`, not `linkExistingOnly` ([eformsign-document-mirror.service.ts:599](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-mirror.service.ts:599)), so webhook/poller/finalizer execution reaches this branch. On a non-finalized case, `ensureForClient` upserts the current case and increments its version ([service-record-lifecycle.service.ts:324](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:324)) before the later end-date fence rejects the stale document. Repeated stale retries can repeatedly advance case version and invalidate draft/confirmation CAS despite the event being rejected. Gate lifecycle initialization on a successful `linked`/`already_linked` result and add production-shaped PG coverage without `linkExistingOnly`.

The supplied PG scenario does not catch this: it explicitly sets `linkExistingOnly: true` ([service-record-mirrored-contract-event-fence.e2e.spec.ts:300](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-mirrored-contract-event-fence.e2e.spec.ts:300)), which disables the unconditional lifecycle call.

The requested atomic `client.eDocId`, revision, and end-date fences themselves are correctly present, including the deterministic pointer-change race. Explicit `documentKind: contract` also remains eligible without label-derived authority. No additional hypothesis is reported.

Phase0 production activation remains deliberately unverified and fail-closed; this is not a Phase5 defect. Phase6 real HTTP-guard and browser verification remains pending.

## Final same-session closure — local Phase5 SHIP

Model: gpt-5.6-sol | Effort: high

SHIP — local Phase5.

No remaining actionable defect found. Commit `84adf3198` correctly gates every post-link lifecycle initialization on `linked`/`already_linked`, while preserving lifecycle initialization after actual client creation. The PostgreSQL fixture now injects the real lifecycle service, uses production-shaped reconciler options, and verifies the entire pending-case row—including `version` and `updatedAt`—remains unchanged.

The supplied logs report 10/10 PostgreSQL tests and 66/66 linker unit tests passing; tests were not rerun under this read-only audit.

Phase0 production activation and real provider workflow capability remain unverified and fail-closed. Phase6 real HTTP guard and browser verification remains pending.
Audit session: `01a081e9-5b2e-7732-a961-b3d34d8a3d12`; implementation checkpoint: `535a7f2db`.

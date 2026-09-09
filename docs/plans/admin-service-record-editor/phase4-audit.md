Model: gpt-5.6-sol | Effort: high

NO_SHIP

### Blocking findings

1. **Critical — Phase0 capability enforcement is fail-open for some new revision jobs.**

`documentStatusForSource` maps an in-progress contract to `waiting_for_completion` and a rejected contract to `pending`, rather than `capability_unverified` ([admin-service-record-edit.service.ts:276-287](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:276)). A complete revision is marked for manual review only when its status is exactly `capability_unverified` ([admin-service-record-edit.service.ts:745-758](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:745)).

The dispatch policy permits every status except `unknown` and `capability_unverified` ([service-record-revision-state.policy.ts:98-103](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-state.policy.ts:98)). Once authorized, the worker proceeds to document creation ([eformsign-document-job-worker.service.ts:180-219](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-job-worker.service.ts:180)).

Failure scenario: a complete service-record case whose contract stage is `in_progress` or `rejected` produces a new revision job with an allowed status. The worker can commit its irreversible marker and reach external document creation even though Phase0 remains unverified. This violates the required `capability_unverified/manual_review`, zero-external-operation boundary ([phase4-execution-contract.md:27-28](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-execution-contract.md:27)).

2. **Critical — later finalization neither freezes complete input nor consumes an immutable revision-bound snapshot.**

The automatic finalizer claims a live case and immediately invokes `executeCase` ([service-record-finalization.service.ts:30-60](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:30)). Its transaction changes lifecycle/attempt state but does not persist a complete immutable generation payload ([service-record-finalization.service.ts:112-244](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:112)).

`executeCase` subsequently rereads the mutable case and builds chunks from that live record ([create-and-send-service-record-snapshot.usecase.ts:156-195](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts:156)), then reaches credential lookup and remote document processing ([create-and-send-service-record-snapshot.usecase.ts:226-270](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts:226)).

Confirmation also changes case dates and N without recomputing `status`, `finalizationDueAt`, or related finalization state ([service-record-edit.repository.ts:1216-1233](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1216)).

Failure scenarios:

- A partial revision later becomes eligible through real provider submissions. Finalization rebuilds from whichever live state exists at that attempt; a retry can therefore use different input instead of the one immutable complete snapshot required by the contract.
- Moving the end date forward on a case already marked `READY_TO_FINALIZE` leaves that status intact. The finalizer can select it immediately and create documents using the revised-but-not-yet-eligible live state.

This directly conflicts with the required later-eligibility freeze and frozen-input-only retries ([phase4-execution-contract.md:24-25](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-execution-contract.md:24)).

3. **High — document synchronization is not authoritatively revalidated at either atomic dispatch boundary, and receipt preparation has the wrong ordering.**

Both authorization implementations manufacture the observed synchronization value from the expected job context:

- SMS: [message-trigger.service.ts:2295-2312](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2295)
- eDocument: [sb.eformsign-document-job.repository.ts:357-370](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:357)

Consequently, their equality checks cannot detect an authoritative synchronization-state change.

For SMS, `dispatching` is committed before delivery ([message-trigger.service.ts:2093-2113](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2093)). Receipt enrichment and validation occur only afterward ([sms-trigger-delivery.service.ts:349-380](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/sms-trigger-delivery.service.ts:349)); image rendering, upload, and token issuance happen later still ([receipt-link-issue.service.ts:215-264](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/receipt-link-issue.service.ts:215)).

Failure scenario: synchronization changes after the job context was recorded. Atomic authorization still succeeds because it compares the expected value to itself. Receipt preparation then occurs outside that boundary, with no authoritative second fence between preparation and provider send. Confirm may also be rejected because `dispatching` already won even if preparation subsequently fails. This does not satisfy the required pre-preparation check plus atomic authorization recheck ([implementation-plan.md:308-310](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/implementation-plan.md:308)).

4. **High — confirmation cancels pending messages without persisting their required reevaluation intent.**

The caller transaction cancels every pending/processing message job for the client and clears its claim ([service-record-edit.repository.ts:1481-1492](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1481)), then returns immediately ([service-record-edit.repository.ts:1493](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1493)). The following enqueue method creates only an eFormSign revision job ([service-record-edit.repository.ts:1562-1644](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1562)).

Failure scenario: an end-date reminder scheduled against the old period is correctly canceled, but no durable intent causes it to be recalculated for the revised end date. The legitimate replacement notification can disappear permanently. The PostgreSQL race test asserts only cancellation/dispatch ownership, not replacement intent creation ([service-record-confirm-message-races.e2e.spec.ts:92-106](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-message-races.e2e.spec.ts:92)).

5. **High — malformed persisted authoritative date vectors silently become legacy fallback.**

The backend parser returns `null` for both absent and malformed vectors ([service-record-entry.service.ts:50-111](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:50)). `getContext` then omits `plannedSessionDates` whenever that result is null ([service-record-entry.service.ts:173-193](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:173)).

The shared wizard intentionally treats an omitted property as permission to calculate legacy default dates ([ServiceRecordWizard.tsx:321-352](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/service-record-ui/src/ServiceRecordWizard.tsx:321)); it shows the fail-closed error only when a malformed vector was actually supplied ([ServiceRecordWizard.tsx:404-410](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/service-record-ui/src/ServiceRecordWizard.tsx:404)).

Failure scenario: corrupted or partial persisted `plannedSessions` is omitted by the API, so the UI silently reconstructs dates and may lose gaps or revised offsets. A subsequent provider submission rejects the same stored vector as unavailable ([service-record-entry.service.ts:423-434](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:423)), creating display/source/write inconsistency.

### Verification assessment

The named production corrections were inspected and are present: repository-owned durable eDocument authorization, common locking, legacy null-client ownership handling, and explicit future-content persistence. Historical RED logs were not treated as current failures.

Recorded evidence distinguishes:

- The original integrated checkpoint: 535 passing tests ([phase4-verification.md:10-23](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-verification.md:10)).
- Post-correction focused evidence: 77 unit tests and final 29 PostgreSQL tests ([phase4-verification.md:39-45](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-verification.md:39)). These overlap earlier coverage and should not be summed as a unique total.
- Backend type evidence still contains exactly the five documented pre-existing receipt-helper errors.

The final 29-test PostgreSQL run covers confirmation rollback/idempotency and provider/message/eDocument authorization races, but its listed suites do not exercise the real finalization service, receipt preparation/authorization ordering, message-intent recreation, or malformed-vector GET behavior. The finalization suite itself uses mocked Prisma and snapshot collaborators ([service-record-finalization.service.spec.ts:16-70](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/services/service-record-finalization.service.spec.ts:16)).

Per the read-only constraint, I did not rerun tests or perform HTTP, browser, database, server, vendor, SMS, PDF, network, or Phase0 checks. Actual HTTP JWT/tenant behavior and browser flow therefore remain unverified, consistent with the recorded Phase5/6 limitation ([phase4-verification.md:47](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-verification.md:47)).
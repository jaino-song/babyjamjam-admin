Model: gpt-5.6-sol | Effort: high

NO_SHIP

### Blocking findings

1. **Critical — the capability-zero-call gate does not cover recovered `reconciling` revision jobs.**

Contract-stage handling is corrected: every complete revision is now `capability_unverified` regardless of contract stage ([admin-service-record-edit.service.ts:276](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts:276)), and ordinary claimed revision jobs are rejected independently of synchronization status ([service-record-revision-state.policy.ts:178](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-revision-state.policy.ts:178)).

The recovery path bypasses that gate:

- Stale jobs with post-preparation progress become `reconciling`, lose their payload, and receive a new lease ([sb.eformsign-document-job.repository.ts:643](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:643)).
- `processDueJobs` sends every recovered `reconciling` job directly to `reconcile`, without `authorizeRevisionJob` ([eformsign-document-job-worker.service.ts:145](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-job-worker.service.ts:145)).
- Reconciliation enters credential custody and provider reads ([eformsign-document-job-reconciliation.service.ts:56](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-job-reconciliation.service.ts:56)).

Concrete scenario: a revision job retained from the former fail-open implementation is `processing/creating` when its heartbeat expires. Recovery converts it to `reconciling`; the next line enters provider reconciliation despite Phase 0 remaining unverified. The focused capability test covers only a newly claimed queued job, not recovered processing/reconciling states ([eformsign-document-job-worker.service.spec.ts:251](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/services/eformsign-document-job-worker.service.spec.ts:251)).

2. **Critical — the normal capability-block path destroys the newly frozen immutable generation.**

The finalizer correctly freezes complete live input under common locks and writes one revision-bound manual-review job ([service-record-finalization.service.ts:427](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:427), [service-record-finalization.service.ts:624](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:624)). The legacy live-row snapshot use case also blocks revised cases before credential access ([create-and-send-service-record-snapshot.usecase.ts:156](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts:156)).

But the queued frozen job is immediately eligible for the ordinary worker:

- `INITIAL_FINALIZATION` is rejected as capability-unverified ([eformsign-document-job-worker.service.ts:326](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-job-worker.service.ts:326)).
- The worker then calls `markRequiresAttention` ([eformsign-document-job-worker.service.ts:199](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/eformsign-document-job-worker.service.ts:199)).
- That terminal transition unconditionally sets `payload = NULL` ([sb.eformsign-document-job.repository.ts:697](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:697)).

Concrete scenario: finalization freezes a complete generation; the worker safely refuses provider work but erases its immutable payload. A subsequent finalization attempt finds the same request key and requires that payload to remain present and fingerprint-valid ([service-record-finalization.service.ts:588](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:588), [service-record-finalization.service.ts:781](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:781)). It therefore throws instead of reusing the frozen input. The recorded PostgreSQL retry test retries before the worker consumes the job, so it does not cover this production sequence ([service-record-confirm-finalization.e2e.spec.ts:297](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-finalization.e2e.spec.ts:297)).

3. **High — stale readiness recomputation uses the old deadline while persisting the new deadline.**

The existing lifecycle policy itself is preserved: complete/header-valid records become `READY_TO_FINALIZE` immediately, while only incomplete records past `finalizationDueAt` become `AWAITING_COMPLETION` ([service-record-lifecycle.service.ts:919](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:919)). Completed/finalization-history states remain immutable ([service-record-lifecycle.service.ts:34](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:34), [service-record-lifecycle.service.ts:901](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:901)).

However, status is selected using the pre-edit `record.finalizationDueAt` at line 933, while the new end-date-derived deadline is written only afterward at lines 950–952 ([service-record-lifecycle.service.ts:927](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts:927)).

Concrete scenario: an incomplete stale-READY case had an already-passed deadline, then its end date was moved into the future. Recompute sets `AWAITING_COMPLETION` from the old deadline but stores a future deadline. The promoter does not select `AWAITING_COMPLETION` rows for another correction pass ([service-record-finalization.service.ts:870](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:870)), leaving the lifecycle inconsistent. The PostgreSQL test asserts only “not FINALIZING,” not the correct resulting status or updated due instant ([service-record-confirm-finalization.e2e.spec.ts:206](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-finalization.e2e.spec.ts:206)).

Additionally, complete-source validation checks headers, assignments, days, signatures, and indices but never validates the current authoritative `plannedSessions` vector ([service-record-finalization.service.ts:124](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:124)). That unchecked value is copied into a generation labeled complete ([service-record-finalization.service.ts:709](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts:709)). A complete set of day rows plus a malformed or absent revised vector can therefore freeze an internally inconsistent “complete” generation.

4. **High — authoritative revalidation still occurs only after receipt preparation.**

The atomic authorization reread now derives synchronization from locked persisted revision/job facts instead of copying the expected status ([message-trigger.service.ts:2425](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2425)). Prepared provider data is persisted and checked before the `dispatching` CAS, and the final send consumes the frozen preparation.

The required pre-preparation source check remains absent:

- `prepareClaimedJob` executes first ([message-trigger.service.ts:2163](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2163)).
- Receipt enrichment runs during preparation ([sms-trigger-delivery.service.ts:429](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/sms-trigger-delivery.service.ts:429)).
- Authoritative source/sync fencing starts only afterward ([message-trigger.service.ts:2178](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2178), [message-trigger.service.ts:2243](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/message-trigger.service.ts:2243)).

Concrete scenario: a job is already stale before dispatch begins. Receipt rendering/upload/token preparation can still occur; only the later atomic fence blocks SMS delivery. The actual PostgreSQL receipt test proves that confirmation during paused preparation prevents the old send, but it does not prove that an already-stale source is rejected before receipt preparation ([service-record-confirm-receipt-preparation.e2e.spec.ts:67](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-receipt-preparation.e2e.spec.ts:67)).

### Findings closed or partially closed

- Durable client and schedule reevaluation intents are now written after cancellation inside the confirmation transaction ([service-record-edit.repository.ts:1314](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1314), [service-record-edit.repository.ts:1362](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/database/repositories/service-record-edit.repository.ts:1362)). Actual PostgreSQL evidence asserts both resulting intents ([service-record-confirm-message-races.e2e.spec.ts:99](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-message-races.e2e.spec.ts:99)).
- The rollback suite injects a failure after the intent upsert, but its before/after comparison omits `message_trigger_job` intent rows ([service-record-confirm-rollback.e2e.spec.ts:88](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-rollback.e2e.spec.ts:88), [service-record-confirm-rollback.e2e.spec.ts:148](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-rollback.e2e.spec.ts:148)). Thus explicit absence of the newly inserted intent after rollback remains unproved, although the production writes share the transaction.
- Malformed persisted vectors and revised cases with an absent vector now fail closed, while genuinely absent legacy vectors remain compatible ([service-record-entry.service.ts:55](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:55), [service-record-entry.service.ts:191](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:191)). The recorded actual PostgreSQL cases cover malformed, valid revised, revised-absent, and genuine legacy-absent behavior ([service-record-confirm-provider-context.e2e.spec.ts:53](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-provider-context.e2e.spec.ts:53)).

The separate contract-completion 17:00 KST and service-record finalization/link 20:00 KST policies remain distinct; no universal end-plus-seven waiting period was introduced.

### Verification assessment

The newest record reports 48 passing assertions across 11 named confirmation suites, explicitly noting that these are not 48 live-database scenarios. Worker unit counts and delivery-focused counts overlap and are not added to that figure ([phase4-verification.md:69](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-verification.md:69)). The same five receipt-helper TypeScript errors remain the documented baseline.

The finalization suite uses actual disposable PostgreSQL and production locking/freezing code with snapshot execution mocked. Receipt-ordering tests use actual PostgreSQL authorization/confirmation with preparation and provider adapters mocked. Capability worker coverage is focused mocked evidence. None is live vendor, SMS, PDF, credentials, HTTP JWT, browser, deployment, or Phase 0 proof.

Per instruction, I ran no tests, builds, server, database, browser, network, vendor, SMS, environment, or Phase 0 operations.


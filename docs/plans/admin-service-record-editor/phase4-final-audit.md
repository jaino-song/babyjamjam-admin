Model: gpt-5.6-sol | Effort: high

SHIP

Both remaining proof gaps are closed:

- The actual-PG test creates a revision-prefixed job with `payload = NULL`, executes real `recoverStale`, runs the real worker, and proves `requires_attention` with zero target, custody, dispatch, finalization, or reconciliation calls ([service-record-confirm-finalization.e2e.spec.ts:432](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-finalization.e2e.spec.ts:432)).
- Both confirm-wins document races now prove that a non-null legacy payload becomes `NULL` ([service-record-confirm-document-races.e2e.spec.ts:71](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-document-races.e2e.spec.ts:71), [service-record-confirm-document-races.e2e.spec.ts:99](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/test/e2e/service-record-confirm-document-races.e2e.spec.ts:99)).

The correction contains only tests and evidence—no production changes. Recorded verification is exactly two actual-PostgreSQL suites, 15/15 passing; this overlaps prior evidence and is not added to earlier counts. The scoped lint log is clean ([phase4-verification.md:88](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/phase4-verification.md:88)).

This SHIP applies only to the local Phase 4 implementation. It is not vendor, PDF, SMS, HTTP/browser, deployment, credential, or Phase 0 capability proof, and does not activate Phase 5 behavior.
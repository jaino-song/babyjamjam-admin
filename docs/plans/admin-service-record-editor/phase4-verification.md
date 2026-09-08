# Phase 4 integrated verification

Status: verification in progress; not yet SHIP. Phase 5 implementation has not started.

## Integrated checkpoint

Production/tree checkpoint: `f3e90d1e44074d9367e56e835218a34a75ba9462`.
Implementation used Luna/max lanes with disjoint ownership. There has been no task-level independent audit. One integrated Sol/high audit follows the required checks.

| Verification | Observed result | Evidence |
|---|---|---|
| Backend affected service/repository/policy/DTO suites and target guard | 17 suites, 444 PASS | `/tmp/bjj-phase4-integrated-backend.log` |
| Frontend API/proxy/admin wizard/preview dialog | 4 suites, 63 PASS | `/tmp/bjj-phase4-integrated-frontend.log` |
| Mobile/shared wizard canonical date handling | 1 suite, 6 PASS | `/tmp/bjj-phase4-integrated-mobile.log` |
| Actual disposable PostgreSQL integration | 6 suites, 22 PASS | `/tmp/bjj-phase4-integrated-postgres.log` |
| Frontend, mobile, shared TypeScript | PASS | `/tmp/bjj-phase4-frontend-types.log`, `/tmp/bjj-phase4-mobile-types.log`, `/tmp/bjj-phase4-packages-shared-types.log` |
| Backend TypeScript | Only 5 known pre-Phase4 receipt diagnostic helper errors | `/tmp/bjj-phase4-backend-types.log` |
| Frontend/mobile changed-file ESLint and UI architecture gate | PASS, existing baseline debt unchanged | `/tmp/bjj-phase4-frontend-lint.log`, `/tmp/bjj-phase4-mobile-lint.log`, `/tmp/bjj-phase4-ui-architecture.log` |
| Changed backend ESLint | One new architecture error, correction active | `/tmp/bjj-phase4-backend-lint.log` |

Total passing tests: 535. Counts do not include skipped tests or external/manual proofs.

The backend baseline errors are `receipt-link-refresh.live.helper.ts:509` (obsolete `createReplacingActive` and two implicit parameter types) and `receipt-link-refresh.live.e2e.spec.ts:273,286` (missing `serviceEndDate`). These were reproduced before Phase4 and are explicitly owned by Phase5.4. No other backend type diagnostics were observed at this integrated checkpoint.

## PostgreSQL proof and limitations

Only the explicit loopback cluster at `127.0.0.1:62295`, user `bjj_revision_test`, database `bjj_revision_task4` was used. Both database URLs are checked against the exact approved value before client construction. No environment database, application module, scheduler, vendor/browser/SMS, Phase0 ledger or signature request was used. Test fixtures are retained; append-only triggers were not disabled.

- Four confirmation tests cover concurrent idempotent replay, durable no-op, same-key/body conflict, foreign branch and stale source rejection, actual N13 with nominal duration15/pricing retained, signatures/timestamps preserved, no future day fabrication, second revision and immutable first-original/history preservation. Partial revision payloads retain existing signature/provider provenance and are not labeled complete.
- Eight fault-injection cases throw after successful client, case, day, assignment, schedule, revision, final draft CAS and raw document-job insertion writes. All scoped persisted rows and counts return to their exact pre-confirm state.
- Two source/preview cases prove all13 dates are visible without source mutation and a repeatable-read combined draft/source view. The latter uses a direct synthetic transaction to isolate snapshot semantics; it is not claimed as production writer race proof.
- Two production provider races prove both common-lock orders. Confirm first rejects the stale provider date before mutation; refreshed canonical input succeeds. Provider first persists its new row and confirm rejects the stale source while preserving its active draft.
- Two SMS and four eFormSign authorization races prove both common-lock orders for legacy client jobs, document creation and finalization. Tests invoke the production authorization transaction with actual PostgreSQL and explicit barriers, without calling external delivery. Focused unit suites cover caller order and capability/stickiness behavior. These tests are not live SMS/vendor/PDF proof.

Meaningful RED evidence preceded fixes: legacy SMS authorization lacked the common client lock (`/tmp/bjj-phase4-message-race-red.log`), and client document jobs lacking revision-context metadata bypassed confirm's marker/cancellation filter (`/tmp/bjj-phase4-document-race-red.log`). After fixes both race orders pass (`/tmp/bjj-phase4-dispatch-race-green.log`). Early fixture/probe issues (user FK, raw-query binding and quoted/unquoted SQL matching) were corrected separately and are not claimed as product defects.

## Remaining before audit

The eFormSign worker's new direct `PrismaService` import violates the existing application-layer import rule. Correction is isolated in `phase4-dispatch-storage-fix`, branch `unit/admin-service-record-4-dispatch-storage`, based on `f3e90d1e4`. Authorization storage/transactions must move behind the existing domain repository port; no allowlist or lint suppression is permitted. Re-run affected exact suites/PG boundaries after integration, then perform the integrated Sol/high audit.

Browser runtime, actual HTTP JWT/tenant authorization, full user flow and comprehensive contract/receipt synchronization are later Phase5/6 acceptance work. Phase0 remains unverified; new revision external operations remain fail-closed. No deployment or environment merge is claimed.

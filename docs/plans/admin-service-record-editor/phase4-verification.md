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
| Changed backend ESLint | Initial worker architecture error corrected in df201fae6; affected worker/repository lint passed, final integrated scope pending | `/tmp/bjj-phase4-backend-lint.log` |

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

The eFormSign worker storage boundary correction `df201fae6` is integrated: authoritative dispatch transaction/locks moved behind the existing repository port. Nine actual PostgreSQL tests pass after this integration and the additional legacy-owner correction `d590d5b55` (`/tmp/bjj-phase4-owner-storage-verified.log`). These include create/finalize race orders and five null-client legacy document ownership cases. A lost-versus-stale test assertion was widened only to accept both safe cancellation outcomes; durable cancellation and no-dispatch assertions remain.

Additional product RED evidence: canonical owned legacy jobs with a null client ID were omitted from confirmation guards, and explicit content changes to future sessions were accepted then lost. Legacy ownership is fixed and verified; future-content persistence was corrected in `041b440ee`. The latter must create only the explicitly edited unsubmitted day draft, preserve real assignment provenance, never create signatures/submissions, and retain the previous zero-row behavior for date-only future changes. Parent tests now also require immutable partial history and rollback after a future-day insertion. Evidence: `/tmp/bjj-phase4-legacy-owner-red.log`, `/tmp/bjj-phase4-future-content-red.log`. The initial 535 count remains a checkpoint; subsequent focused evidence is listed below.

The future-content correction is integrated at `9f1e56d5f`. The final affected service/repository/worker unit run passes 77 tests in four suites (`/tmp/bjj-phase4-final-corrections-unit.log`). Fourteen actual PostgreSQL atomic/rollback tests pass (`/tmp/bjj-phase4-future-content-pg.log`), including explicit future draft persistence, immutable partial payload, duplicate retry, clearing an existing note, and rollback after successful future-day insertion. Scoped lint passes (`/tmp/bjj-phase4-future-content-lint.log`, `/tmp/bjj-phase4-corrections-lint.log`). Backend TypeScript has exactly the same five known receipt-helper errors (`/tmp/bjj-phase4-final-backend-types.log`). A parent test initially supplied null despite its string DTO and expected null normalization for an empty string; it now submits the valid empty-string input and verifies matching empty persisted/history values. This test correction is separate from the production null-presence mapping fix.

Final actual PostgreSQL verification passes all seven suites and 29 tests at the corrected integrated production tree (`/tmp/bjj-phase4-final-postgres.log`). This includes all provider/message/eDoc dispatch orders, legacy null ownership, source snapshots, atomic/idempotency and nine after-write rollback boundaries. The one integrated Sol/high audit returned NO_SHIP at `d067ee717`; see `phase4-audit.md`. Phase5 implementation remains gated. Five load-bearing findings are being corrected in parallel; this is correction/residual review of the same phase audit, not task-level audits.

Browser runtime, actual HTTP JWT/tenant authorization, full user flow and comprehensive contract/receipt synchronization are later Phase5/6 acceptance work. Phase0 remains unverified; new revision external operations remain fail-closed. No deployment or environment merge is claimed.

## Audit correction worktrees

All three unit branches start from integration branch `admin-service-record-editor` at `d067ee717`. Workers are Luna/max; parent owns integration and actual PostgreSQL.

| Unit name | Absolute path | Branch | Ownership |
|---|---|---|---|
| phase4-audit-core | `/Users/jaino/Development/babyjamjam-admin/phase4-audit-core` | `unit/admin-service-record-4-audit-core` | Independent capability gate, later immutable finalization, current readiness, transactional reevaluation intents, eDoc authoritative sync state |
| phase4-audit-delivery | `/Users/jaino/Development/babyjamjam-admin/phase4-audit-delivery` | `unit/admin-service-record-4-audit-delivery` | Prepare receipt before authorization; SMS authoritative sync reread; frozen prepared send |
| phase4-audit-provider | `/Users/jaino/Development/babyjamjam-admin/phase4-audit-provider` | `unit/admin-service-record-4-audit-provider` | Distinguish absent legacy vector from invalid/revised missing vector |

Actual PostgreSQL RED for the provider-context finding: four failures (three malformed persisted vectors and revised missing vector), two compatibility/valid-vector passes, `/tmp/bjj-phase4-provider-context-red.log`. This is a production-service GET test with synthetic disposable fixtures, not HTTP authorization proof.

Finalization-policy clarification: existing lifecycle marks a fully submitted/approved/header-complete record READY immediately. `finalizationDueAt` drives incomplete AWAITING_COMPLETION; it is not a new universal hold on complete records. Corrections preserve that existing policy and the separate contract completion deadline while rejecting stale READY from incomplete or invalid current source.

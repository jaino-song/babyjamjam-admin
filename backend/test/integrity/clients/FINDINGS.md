# FINDINGS — state-integrity audit, clients area (unit p2-clients)

Branch `si/p2-clients` (integration base `61e6e8c8c`). Review-round-1 corrections:
SI-CLIENT-03 re-verdicted REFUTED (last-writer-wins on a caller-supplied explicit
value is correct); SI-CLIENT-04's tombstone half re-verdicted REFUTED (retained
contract history must stay attached) and its phone-edit half added as a test;
SI-CLIENT-02's catch-all refusal check replaced with an unconditional
"row unchanged" assertion; the SI-CLIENT-07 claim-race test relabelled as a
PostgreSQL-semantics proof. Real-PostgreSQL service-layer tests under
`backend/test/integrity/clients/` (5 suites, 24 tests — 4 `knownDefect`s
fail-as-expected, the rest are passing invariants) and Jest +
React-Testing-Library suites under `frontend/src/__integrity__/clients/` and
`mobile/src/__integrity__/clients/`.

## Verdicts

| id | layer (db/backend/frontend/mobile) | verdict CONFIRMED / REFUTED / UNTESTABLE | severity proposal (critical/high/medium/low) | one-line defect | evidence file:line | test file::test name | observed failure message (CONFIRMED only) |
|---|---|---|---|---|---|---|---|
| SI-CLIENT-01 | backend | CONFIRMED | low | Every audited date writer (ordinary update, due-date scheduler, schedule-change move) leaves `client.service_status` stale until the lazy background CAS on the next branch list read. Accurate impact: dispatch reads the EFFECTIVE (recomputed) status, so it is not fooled; the only raw-column consumer is the dashboard count (`backend/infrastructure/database/repositories/prisma-client-dashboard.repository.ts:14`), which drifts with time on its own. Note write-time recompute alone does not fix time-based drift (a stored "computed" status still goes stale as dates pass), so the raw-column consumers need an on-read recompute regardless | `backend/application/services/client.service.ts:2493-2528` (status written only when supplied), `backend/application/services/client-due-date-scheduler.service.ts:107-138`, `backend/application/services/schedule-change.service.ts:656-659` | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 an ordinary date edit via ClientService.update leaves the stored serviceStatus stale` (+ scheduler + applyAdminChange variants) | `SI-CLIENT-01 (ClientService.update endDate edit): stored serviceStatus "active" drifted from computed "completed" after a date write` |
| SI-CLIENT-01 | backend | CONFIRMED | low | (same id, scheduler writer) | see above | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 the due-date scheduler's startDate copy leaves the stored serviceStatus stale` | `SI-CLIENT-01 (due-date scheduler startDate copy): stored serviceStatus "waiting" drifted from computed "active" after a date write` |
| SI-CLIENT-01 | backend | CONFIRMED | low | (same id, session-move writer) | see above | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 an admin session move via ScheduleChangeService.applyAdminChange leaves the stored serviceStatus stale` | `SI-CLIENT-01 (ScheduleChangeService.applyAdminChange): stored serviceStatus "active" drifted from computed "waiting" after a date write` |
| SI-CLIENT-02 | backend | CONFIRMED | high | `completeReplacement` proceeds on ANY status (only logs a warning) and rewrites it with the date-derived status — a `terminated` client is silently un-terminated | `backend/application/services/client.service.ts:3055-3061` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-02 completeReplacement refuses unless the client is in replacement_requested` | `SI-CLIENT-02: completeReplacement ran on a "terminated" client and moved the status to "active" (outcome completed; only a warning was logged)` |
| SI-CLIENT-03 | backend | REFUTED | — | The reuse-existing-client `smsAutomationEnabled` write (`updateMany` by id+branchId, outside the write-set lock) is a blind, explicit, SINGLE-COLUMN write of a caller-supplied value: under the forced interleaving (T1 locked update commits first, reuse write observed blocked) nothing but `smsAutomationEnabled` changes — the committed locked `name` write survives, and the caller-supplied `false` lands. Serial order "T1 commits, then reuse(false)" yields `false` too, so nothing is lost; last-writer-wins on an explicit value is correct | `backend/application/services/client.service.ts:1374-1381` | `client-write-races.real-db.spec.ts::SI-CLIENT-03 the reuse-existing-client write is single-column: under the forced interleaving it clobbers only smsAutomationEnabled` | — |
| SI-CLIENT-04 | backend | REFUTED (tombstone half) | — | A tombstoned client keeps `eDocId`/`eformsign_doc.client_id` BY DESIGN: tombstoning exists because retained history (signed contracts) must stay attached (`sb.client.repository.ts:574-626, 665-676`, rule 고객-06), so detaching the pointers would orphan a legal document. The brief's invariant — a tombstoned client holds no live contract pointer that BLOCKS or RELINKS another client — holds: the reconciler keeps repairing the tombstoned ownership, and a new same-phone client can still claim a NEW contract | `backend/infrastructure/database/repositories/sb.client.repository.ts:574-713` | `client-tombstone.real-db.spec.ts::SI-CLIENT-04 the stale tombstone pointer does not block a new same-phone client from claiming a new contract` and `…the mirror reconciler keeps the tombstoned owner attached to the old contract` | — |
| SI-CLIENT-04 | backend | REFUTED (phone-edit half) | — | After `ClientService.update` moves a client's phone, the reconciler (`LinkMirroredEformsignDocByPhoneUsecase`) behaves correctly for both phones: the owned old contract stays attached to its owner (`already_linked`), an unowned old-phone contract is left unlinked (no live client holds the edited-away phone), and a new-phone contract links to the edited client | `backend/application/services/client.service.ts:2142-2145` (update writes the new `phoneNormalized`, no doc re-link), `backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:626` (owned-doc shortcut), `:688-712` (phone match) | `client-tombstone.real-db.spec.ts::SI-CLIENT-04 after a phone edit the old contract stays owned, an unowned old-phone contract stays unlinked, and the new-phone contract links to the edited client` | — |
| SI-CLIENT-05 | backend | REFUTED | — | Tombstone side effects are complete (hidden row, phone freed, assignment ended, pending automation jobs canceled; open end-date review item remains but is unreachable via the review list's `deletedAt` filter); with the switch disabled (unset + `NODE_ENV=test`) the delete is refused before ANY side effect; a dependency-free client is still physically deleted | `backend/infrastructure/database/repositories/sb.client.repository.ts:574-713` | `client-tombstone.real-db.spec.ts::SI-CLIENT-05 an enabled tombstone hides the client…` / `…refuses before any side effect` / `…dependency-free client is physically deleted` | — |
| SI-CLIENT-06 | backend | REFUTED | — | Booking confirmation is the only exit from 예약 전: saves cannot move a client into/out of `pre_booking` into a date-derived status (only `terminated` is the deliberate exception), and `confirmBooking` is idempotent (double confirm is a no-op, `bookingConfirmedAt` never rewritten) | `backend/application/usecases/client/client-write-validation.ts:294-338`, `backend/application/services/client.service.ts:3148-3249` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-06 …` (5 invariants incl. the `terminated` exception and the double-confirm no-op) | — |
| SI-CLIENT-07 | backend | REFUTED | — | `client_draft` PENDING→CONFIRMING→CONFIRMED\|DISCARDED holds: the conditional claim admits exactly one winner (observed blocked second claimant re-evaluating after the winner commits — PostgreSQL predicate semantics only, see the test's scope note), concurrent `confirmNewClient` creates exactly one client (production path), re-confirmation is refused, and the stuck-CONFIRMING sweep recovers a crashed confirm without touching an in-flight one | `backend/application/services/call-inbox.service.ts:328-476` (claim predicates), `backend/application/services/call-extraction-retry-scheduler.service.ts:154-180` (sweep) | `client-draft-confirm.real-db.spec.ts::SI-CLIENT-07 the PENDING→CONFIRMING claim admits exactly one winner when a second claimant blocks and re-evaluates (PostgreSQL predicate semantics only)` (+ 4 more) | — |
| SI-CLIENT-08 | mobile | CONFIRMED | medium | Mobile live `useUpdateClient` (`mobile/src/hooks/useClients.ts:137-155`) invalidates only `clientQueryKeys.*` + `dashboardQueryKeys.analytics()`; it misses `messageTriggerKeys.upcoming()` and the service-record client overview that desktop invalidates/refetches (`frontend/src/features/clients/hooks/use-clients.ts:343-373`) | `mobile/src/hooks/useClients.ts:137-155` vs `frontend/src/features/clients/hooks/use-clients.ts:366-371` | `mobile/src/__integrity__/clients/mobile-clients-state-integrity.test.tsx::SI-CLIENT-08 mobile useUpdateClient invalidates the same dependent caches desktop does…` (`it.failing` locally wrapped) | `SI-CLIENT-08: mobile useUpdateClient left the message-trigger upcoming cache stale (desktop invalidates it); invalidated: {"queryKey":["clients"]} {"queryKey":["clients","detail",42]}` |
| SI-CLIENT-08 | mobile | REFUTED (delete half) | — | Mobile `useDeleteClient` DOES invalidate `messageTriggerKeys.upcoming()` (line 218) and rolls the optimistic removal back on failure — delete-side parity holds | `mobile/src/hooks/useClients.ts:191-221` | `…mobile useDeleteClient invalidates the message-trigger upcoming cache…` / `…removes the client optimistically and restores the cache when the delete fails` | — |
| SI-CLIENT-08 | frontend | REFUTED | — | Desktop invariants hold: `useUpdateClient` invalidates `clientKeys.all` + `messageTriggerKeys.upcoming()` + refetches `serviceRecordKeys.clientOverview(id)`; `useDeleteClient` restores the optimistic removal on failure and invalidates on settle | `frontend/src/features/clients/hooks/use-clients.ts:343-373, 422-448` | `frontend/src/__integrity__/clients/desktop-clients-state-integrity.test.tsx::SI-CLIENT-08 desktop …` (2 invariants) | — |
| SI-CLIENT-09 (extra) | backend | REFUTED | — | The due-date scheduler's `startDate` copy is a self-protecting CONDITIONAL write: with a client row lock held by a concurrent locked update that commits a real start date, the scheduler's blocked `updateMany` re-evaluates `start_date IS NULL` after the commit and skips (no lost start date) | `backend/application/services/client-due-date-scheduler.service.ts:107-138` | `client-write-races.real-db.spec.ts::SI-CLIENT-09 the scheduler's conditional startDate write skips after a concurrent locked update commits a start date` | — |
| SI-CLIENT-10 (extra) | backend | REFUTED (mitigated) | — | The stale-CONFIRMING sweep flips `CONFIRMING→PENDING` without knowing whether a crashed confirm already created the client, so a half-applied confirm can hand the draft back to PENDING. Worst case is a STUCK draft, not duplicate data: re-confirmation re-runs `create`, the phone-duplicate check (`findClientByNormalizedPhone` + CLIENT_PHONE_ALREADY_REGISTERED conflict) refuses it, and the create-failure path rolls the draft back to PENDING — the sweep's own warn log points staff at possible orphans. No integrity loss | `backend/application/services/call-extraction-retry-scheduler.service.ts:153-158`, `backend/application/services/call-inbox.service.ts:449-469` | — (note-level; the sweep/recovery behaviour is already exercised by the stuck-CONFIRMING invariant) | — |

Extra-ids note: SI-CLIENT-09 (the refuted half of SI-CLIENT-03's two writers,
split out so the SCOPE invariant stays single-defect) and SI-CLIENT-10 (the
sweep duplicate-risk note above) are the extra findings (2 of the 4 allowed).
Notes on hypothesis scope: mobile has **no live terminate hook** —
`useTerminateService` lives only in the dead
`mobile/src/features/clients/hooks/use-clients.ts` (live only for
`useConfirmBooking` per the sweep), so the terminate half of SI-CLIENT-08 as
named in the brief is a dead-code gap and was not tested (low finding, no
test) — the update-path gap above is the live defect.

## Fix notes (CONFIRMED ids)

- **SI-CLIENT-01** — smallest correct fix: at each of the three date-writing
  sites, run the existing repository CAS inline:
  `if (isAutomaticServiceStatusTransitionAllowed(current, computeServiceStatus(current, newStartDate, newEndDate, updated.bookingConfirmedAt)))`
  → include `serviceStatus: computed` in the same write (single statement, no
  migration). The lazy background list-read repair (`updateServiceStatusIfCurrent`)
  stays as the safety net. NOT SENSITIVE (application code only — domain helpers
  already exist). Caveat: this fixes write-time drift only; time-based drift
  (dates passing) needs an on-read recompute for the raw-column consumers
  (dashboard count) regardless.
- **SI-CLIENT-02** — throw `BadRequestException`/`ConflictException` (or return
  the client untouched) instead of the logged warning unless
  `serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED`. NOT SENSITIVE.
- **SI-CLIENT-08** — add
  `queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() })`
  and a `refetchQueries`/invalidate of `serviceRecordQueryKeys.clientOverview(id)`
  to mobile `useUpdateClient`'s `onSuccess` (desktop parity). NOT SENSITIVE.

## Mutation proofs

Per binding rule: every added/repaired test was mutation-proven — the production
site the test pins was temporarily broken, the test area re-run, the observed
result recorded, and the mutation reverted exactly (`git diff` shows nothing
outside the area folders before commit).

- **SI-CLIENT-03 invariant**
  (`client-write-races.real-db.spec.ts::…clobbers only smsAutomationEnabled`):
  mutated `backend/application/services/client.service.ts:1376-1380` — added
  `name: "뮤테이션"` to the reuse `updateMany` data alongside
  `smsAutomationEnabled`. Observed RED:
  `SI-CLIENT-03: the reuse write clobbered name — expected only smsAutomationEnabled to change`.
  Reverted exactly.
- **SI-CLIENT-04 phone-edit invariant**
  (`client-tombstone.real-db.spec.ts::…after a phone edit the old contract stays owned…`):
  first attempt (recorded for honesty, reverted): removed the inner
  transaction fence
  `if (document.clientId !== null) return { status: "already_linked" };` at
  `backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:626`
  — observed GREEN, a no-op: `execute()` routes an ALREADY-OWNED document
  through `repairAssignedDocument` before the inner fence is ever reached, so
  leg 1 does not depend on it. Corrected mutation (observed RED):
  `backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:231-234` —
  an early `return "no_match"` inserted at the top of `execute()`'s
  `if (assignedClientId !== null)` branch (line 231), disabling the owned-document repair
  that keeps the old contract attached to its owner. Observed RED:
  `SI-CLIENT-04: the reconciler did not keep the owned old contract attached after the phone edit (result "no_match")`
  (with the repair disabled the owned old contract fell through to the
  no-match path instead of staying attached). The unowned-doc legs, which
  route through the phone match, stayed green. Reverted exactly.
- **SI-CLIENT-02 knownDefect**
  (`client-replacement-booking.real-db.spec.ts::SI-CLIENT-02 completeReplacement refuses
  unless the client is in replacement_requested`): mutated
  `backend/application/services/client.service.ts:3055-3061` — replaced the
  log-only warning with
  `throw new ConflictException(...)` for a non-`replacement_requested` client.
  Observed GREEN-turned-RED as required for a knownDefect: with the defect
  "fixed" the body's row-unchanged assertion passed, so jest reported
  `Failing test passed even though it was supposed to fail.` (RED) and the
  suite failed, while the companion control invariant
  ("completeReplacement completes a client that IS in replacement_requested")
  stayed green — the mutation affected only the audited test. Reverted exactly.
- **SI-CLIENT-07 claim-race relabel**
  (`client-draft-confirm.real-db.spec.ts::…PostgreSQL predicate semantics only`):
  repaired by relabelling only (title + scope comment) — the test pins
  PostgreSQL conditional-update re-evaluation, not a product guard, and the
  production claim statement is a single autocommit update with no holdable
  lock, so no meaningful production mutation exists for it. Production-path
  exclusivity is separately pinned by the two concurrent `confirmNewClient`
  invariants in the same spec, which already go RED if the claim admits two
  winners (they create duplicate clients / fail the REQUEST_NOT_PENDING
  refusal). No mutation applied; recorded here for completeness.

## Notes for reviewers

- The concurrency proofs use real lock waits observed through `pg_stat_activity`
  (void-fences convention). They hold interactive transactions open, so every
  held transaction passes `{ maxWait: 5000, timeout: 60000 }` (Prisma's 5 s
  interactive-transaction default would otherwise abort the holder mid-wait).
- Barre Prisma's `PrismaPromise` is LAZY: a query only issues when a `.then` /
  `await` attaches. The race specs tap/factor every racing statement accordingly
  (see "TAP REQUIREMENT" in `client-draft-confirm.real-db.spec.ts`); rule for
  future race specs: never dispatch a racing statement without an immediate tap.
- Race specs retry the interleaving up to 3 times on a fresh fixture when the
  blocked statement is not observed (infra-level dispatch miss); a pass always
  requires actually observed blocking, and retry exhaustion fails the test.
- The SI-CLIENT-03 scope invariant compares the full committed T1 row image
  (reread inside the holding transaction) with the post-reuse row and ignores
  only `smsAutomationEnabled`; the `client` table has no `updatedAt` column, so
  any other difference is a clobber.
- Cleanup: `client_draft` / `call_record` / `service_record_case` /
  `schedule_change_request` / `end_date_review_item` rows are either swept by the
  tracker or deleted by local helpers; service-created `client` rows in the draft
  suite are registered in the tracker explicitly.

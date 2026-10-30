# FINDINGS — state-integrity audit, clients area (unit p2-clients)

Branch `si/p2-clients` (integration base `61e6e8c8c`). Real-PostgreSQL service-layer
tests under `backend/test/integrity/clients/` (suite result: 5 suites, 24 tests
green — 6 `knownDefect`s fail-as-expected, the rest are passing invariants) and
Jest + React-Testing-Library suites under
`frontend/src/__integrity__/clients/` and `mobile/src/__integrity__/clients/`.

## Verdicts

| id | layer | verdict | severity proposal | one-line defect | evidence file:line | test file::test name | observed failure message (CONFIRMED only) |
|---|---|---|---|---|---|---|---|
| SI-CLIENT-01 | backend | CONFIRMED | medium | Every audited date writer (ordinary update, due-date scheduler, schedule-change move) leaves `client.service_status` stale until the lazy background CAS on the next branch list read; raw-column consumers (dashboards) see the stale value | `backend/application/services/client.service.ts:2493-2528` (status written only when supplied), `backend/application/services/client-due-date-scheduler.service.ts:107-138`, `backend/application/services/schedule-change.service.ts:656-659` | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 an ordinary date edit via ClientService.update leaves the stored serviceStatus stale` (+ scheduler + applyAdminChange variants) | `SI-CLIENT-01 (ClientService.update endDate edit): stored serviceStatus "active" drifted from computed "completed" after a date write` |
| SI-CLIENT-01 | backend | CONFIRMED | medium | (same id, scheduler writer) | see above | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 the due-date scheduler's startDate copy leaves the stored serviceStatus stale` | `SI-CLIENT-01 (due-date scheduler startDate copy): stored serviceStatus "waiting" drifted from computed "active" after a date write` |
| SI-CLIENT-01 | backend | CONFIRMED | medium | (same id, session-move writer) | see above | `client-status-drift.real-db.spec.ts::SI-CLIENT-01 an admin session move via ScheduleChangeService.applyAdminChange leaves the stored serviceStatus stale` | `SI-CLIENT-01 (ScheduleChangeService.applyAdminChange): stored serviceStatus "active" drifted from computed "waiting" after a date write` |
| SI-CLIENT-02 | backend | CONFIRMED | high | `completeReplacement` proceeds on ANY status (only logs a warning) and rewrites it with the date-derived status — a `terminated` client is silently un-terminated | `backend/application/services/client.service.ts:3049-3060` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-02 completeReplacement refuses unless the client is in replacement_requested` | `SI-CLIENT-02: completeReplacement ran on a "terminated" client and moved the status to "active" (only a warning was logged)` |
| SI-CLIENT-03 | backend | CONFIRMED | medium | The reuse-existing-client `smsAutomationEnabled` `updateMany` (id+branchId, no expected-value guard, outside the write-set lock) overwrites a committed locked `client.update`; proved by forced interleaving (blocked-statement observation) | `backend/application/services/client.service.ts:1374-1381` | `client-write-races.real-db.spec.ts::SI-CLIENT-03 the reuse-existing-client smsAutomationEnabled write overwrites a committed locked client.update` | `SI-CLIENT-03: reuse write returned client 333 with smsAutomationEnabled=false — the committed locked update (true) was overwritten (false)` |
| SI-CLIENT-04 | backend | CONFIRMED | medium | The tombstone clears `phoneNormalized` but keeps `eDocId` and `eformsign_doc.client_id`: the hidden client keeps holding the live contract (reconciler keeps repairing it; a new same-phone client can still claim a NEW contract, so no relink-block, but the dual identity persists) | `backend/infrastructure/database/repositories/sb.client.repository.ts:676-712` (tombstone clears only `phoneNormalized`) | `client-tombstone.real-db.spec.ts::SI-CLIENT-04 a tombstoned client keeps its live contract pointer (eDocId + eformsign_doc.client_id)` | `SI-CLIENT-04: tombstoned client 361 keeps eDocId=si-219131a95c4d and document si-219131a95c4d keeps clientId=361 — the hidden client still holds the live contract` |
| SI-CLIENT-05 | backend | REFUTED | — | Tombstone side effects are complete (hidden row, phone freed, assignment ended, pending automation jobs canceled; open end-date review item remains but is unreachable via the review list's `deletedAt` filter); with the switch disabled (unset + `NODE_ENV=test`) the delete is refused before ANY side effect; a dependency-free client is still physically deleted | `backend/infrastructure/database/repositories/sb.client.repository.ts:574-713` | `client-tombstone.real-db.spec.ts::SI-CLIENT-05 an enabled tombstone hides the client…` / `…refuses before any side effect` / `…dependency-free client is physically deleted` | — |
| SI-CLIENT-06 | backend | REFUTED | — | Booking confirmation is the only exit from 예약 전: saves cannot move a client into/out of `pre_booking` into a date-derived status (only `terminated` is the deliberate exception), and `confirmBooking` is idempotent (double confirm is a no-op, `bookingConfirmedAt` never rewritten) | `backend/application/usecases/client/client-write-validation.ts:294-338`, `backend/application/services/client.service.ts:3148-3249` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-06 …` (5 invariants incl. the `terminated` exception and the double-confirm no-op) | — |
| SI-CLIENT-07 | backend | REFUTED | — | `client_draft` PENDING→CONFIRMING→CONFIRMED\|DISCARDED holds: the conditional claim admits exactly one winner (observed blocked second claimant re-evaluating after the winner commits), concurrent `confirmNewClient` creates exactly one client, re-confirmation is refused, and the stuck-CONFIRMING sweep recovers a crashed confirm without touching an in-flight one | `backend/application/services/call-inbox.service.ts:328-476` (claim predicates), `backend/application/services/call-extraction-retry-scheduler.service.ts:154-180` (sweep) | `client-draft-confirm.real-db.spec.ts::SI-CLIENT-07 …` (5 invariants incl. the deterministic claim race) | — |
| SI-CLIENT-08 | mobile | CONFIRMED | medium | Mobile live `useUpdateClient` (`mobile/src/hooks/useClients.ts:137-155`) invalidates only `clientQueryKeys.*` + `dashboardQueryKeys.analytics()`; it misses `messageTriggerKeys.upcoming()` and the service-record client overview that desktop invalidates/refetches (`frontend/src/features/clients/hooks/use-clients.ts:343-373`) | `mobile/src/hooks/useClients.ts:137-155` vs `frontend/src/features/clients/hooks/use-clients.ts:366-371` | `mobile/src/__integrity__/clients/mobile-clients-state-integrity.test.tsx::SI-CLIENT-08 mobile useUpdateClient invalidates the same dependent caches desktop does…` (`it.failing` locally wrapped) | `SI-CLIENT-08: mobile useUpdateClient left the message-trigger upcoming cache stale (desktop invalidates it); invalidated: {"queryKey":["clients"]} {"queryKey":["clients","detail",42]}` |
| SI-CLIENT-08 | mobile | REFUTED (delete half) | — | Mobile `useDeleteClient` DOES invalidate `messageTriggerKeys.upcoming()` (line 218) and rolls the optimistic removal back on failure — delete-side parity holds | `mobile/src/hooks/useClients.ts:191-221` | `…mobile useDeleteClient invalidates the message-trigger upcoming cache…` / `…removes the client optimistically and restores the cache when the delete fails` | — |
| SI-CLIENT-08 | frontend | REFUTED | — | Desktop invariants hold: `useUpdateClient` invalidates `clientKeys.all` + `messageTriggerKeys.upcoming()` + refetches `serviceRecordKeys.clientOverview(id)`; `useDeleteClient` restores the optimistic removal on failure and invalidates on settle | `frontend/src/features/clients/hooks/use-clients.ts:343-373, 422-448` | `frontend/src/__integrity__/clients/desktop-clients-state-integrity.test.tsx::SI-CLIENT-08 desktop …` (2 invariants) | — |
| SI-CLIENT-09 (extra) | backend | REFUTED | — | The due-date scheduler's `startDate` copy is a self-protecting CONDITIONAL write: with a client row lock held by a concurrent locked update that commits a real start date, the scheduler's blocked `updateMany` re-evaluates `start_date IS NULL` after the commit and skips (no lost start date) | `backend/application/services/client-due-date-scheduler.service.ts:107-138` | `client-write-races.real-db.spec.ts::SI-CLIENT-09 the scheduler's conditional startDate write skips after a concurrent locked update commits a start date` | — |

Extra-ids note: SI-CLIENT-09 is the only extra finding (1 of the 4 allowed) — it is
the refuted half of SI-CLIENT-03's two writers, split out so the CONFIRMED row
stays a single defect. Notes on hypothesis scope: mobile has **no live terminate
hook** — `useTerminateService` lives only in the dead
`mobile/src/features/clients/hooks/use-clients.ts` (live only for
`useConfirmBooking` per the sweep), so the terminate half of SI-CLIENT-08 as named
in the brief is a dead-code gap and was not tested (low finding, no test) — the
update-path gap above is the live defect.

## Fix notes (CONFIRMED ids)

- **SI-CLIENT-01** — smallest correct fix: at each of the three date-writing
  sites, run the existing repository CAS inline:
  `if (isAutomaticServiceStatusTransitionAllowed(current, computeServiceStatus(current, newStartDate, newEndDate, updated.bookingConfirmedAt)))`
  → include `serviceStatus: computed` in the same write (single statement, no
  migration). The lazy background list-read repair (`updateServiceStatusIfCurrent`)
  stays as the safety net. NOT SENSITIVE (application code only — domain helpers
  already exist).
- **SI-CLIENT-02** — throw `BadRequestException`/`ConflictException` (or return
  the client untouched) instead of the logged warning unless
  `serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED`. NOT SENSITIVE.
- **SI-CLIENT-03** — make the reuse write observable-consistent: either (a) CAS:
  `updateMany({ where: { id, branchId, smsAutomationEnabled: preReadValue } })`
  and treat count 0 as a harmless skip, or (b) move the write inside a
  `lockServiceRecordWriteSet(...)` transaction like the ordinary update path.
  NOT SENSITIVE.
- **SI-CLIENT-04** — in `tombstoneLockedClient`, also set `eDocId: null` for the
  tombstoned client and detach the docs it owns (`eformsign_doc.updateMany({ where
  : { clientId: id }, data: { clientId: null } })`), mirroring the pointer-clear
  the relink flow already performs; the tombstoned row keeps no live contract
  pointer. NOT SENSITIVE.
- **SI-CLIENT-08** — add
  `queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() })`
  and a `refetchQueries`/invalidate of `serviceRecordQueryKeys.clientOverview(id)`
  to mobile `useUpdateClient`'s `onSuccess` (desktop parity). NOT SENSITIVE.

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
- Cleanup: `client_draft` / `call_record` / `service_record_case` /
  `schedule_change_request` / `end_date_review_item` rows are either swept by the
  tracker or deleted by local helpers; service-created `client` rows in the draft
  suite are registered in the tracker explicitly.

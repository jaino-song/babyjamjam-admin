# FINDINGS — state-integrity audit, clients area (unit p2-clients)

Branch `si/p2-clients` (integration base `61e6e8c8c`). Review-round-1 corrections:
SI-CLIENT-03 re-verdicted REFUTED (last-writer-wins on a caller-supplied explicit
value is correct); SI-CLIENT-04's tombstone half re-verdicted REFUTED (retained
contract history must stay attached) and its phone-edit half added as a test;
SI-CLIENT-02's catch-all refusal check replaced with an unconditional
"row unchanged" assertion; the SI-CLIENT-07 claim-race test now drives two
production `confirmNewClient` calls behind a real held row lock (both UPDATEs
observed blocked before release), replacing the copied claim statement and
the redundant timing-dependent double-confirm test. Real-PostgreSQL tests under
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
| SI-CLIENT-02 | backend | CONFIRMED | medium | `completeReplacement` proceeds on ANY status (only logs a warning), silently moving `terminated` to `active`. Combined QA also reproduced this over HTTP `PATCH /clients/:id/complete-replacement`; calibrated medium because `useCompleteReplacement` has no UI caller, so only a direct API call reaches it | `backend/application/services/client.service.ts:3055-3061` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-02 completeReplacement refuses unless the client is in replacement_requested` | `SI-CLIENT-02: completeReplacement ran on a "terminated" client and moved the status to "active" (outcome completed; only a warning was logged)` |
| SI-CLIENT-03 | backend | REFUTED | — | The reuse-existing-client `smsAutomationEnabled` write (`updateMany` by id+branchId, outside the write-set lock) is a blind, explicit, SINGLE-COLUMN write of a caller-supplied value: under the forced interleaving (T1 locked update commits first, reuse write observed blocked) nothing but `smsAutomationEnabled` changes — the committed locked `name` write survives, and the caller-supplied `false` lands. Serial order "T1 commits, then reuse(false)" yields `false` too, so nothing is lost; last-writer-wins on an explicit value is correct | `backend/application/services/client.service.ts:1374-1381` | `client-write-races.real-db.spec.ts::SI-CLIENT-03 the reuse-existing-client write is single-column: under the forced interleaving it clobbers only smsAutomationEnabled` | — |
| SI-CLIENT-04 | backend | REFUTED (tombstone half) | — | A tombstoned client keeps `eDocId`/`eformsign_doc.client_id` BY DESIGN: tombstoning exists because retained history (signed contracts) must stay attached (`sb.client.repository.ts:574-626, 665-676`, rule 고객-06), so detaching the pointers would orphan a legal document. The brief's invariant — a tombstoned client holds no live contract pointer that BLOCKS or RELINKS another client — holds: the reconciler keeps repairing the tombstoned ownership, and a new same-phone client can still claim a NEW contract | `backend/infrastructure/database/repositories/sb.client.repository.ts:574-713` | `client-tombstone.real-db.spec.ts::SI-CLIENT-04 the stale tombstone pointer does not block a new same-phone client from claiming a new contract` and `…the mirror reconciler keeps the tombstoned owner attached to the old contract` | — |
| SI-CLIENT-04 | backend | REFUTED (phone-edit half) | — | After `ClientService.update` moves a client's phone, the reconciler (`LinkMirroredEformsignDocByPhoneUsecase`) behaves correctly for both phones: the owned old contract stays attached to its owner (`already_linked`), an unowned old-phone contract is left unlinked (no live client holds the edited-away phone), and a new-phone contract links to the edited client | `backend/application/services/client.service.ts:2142-2145` (update writes the new `phoneNormalized`, no doc re-link), `backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:231-263` (owned-doc repair), `:698-701` (phone match) | `client-tombstone.real-db.spec.ts::SI-CLIENT-04 after a phone edit the old contract stays owned, an unowned old-phone contract stays unlinked, and the new-phone contract links to the edited client` | — |
| SI-CLIENT-05 | backend | REFUTED | — | Tombstone side effects are complete (hidden row, phone freed, assignment ended, pending automation jobs canceled; open end-date review item remains but is unreachable via the review list's `deletedAt` filter); with the switch disabled (unset + `NODE_ENV=test`) the delete is refused before ANY side effect; a dependency-free client is still physically deleted | `backend/infrastructure/database/repositories/sb.client.repository.ts:574-713` | `client-tombstone.real-db.spec.ts::SI-CLIENT-05 an enabled tombstone hides the client…` / `…refuses before any side effect` / `…dependency-free client is physically deleted` | — |
| SI-CLIENT-06 | backend | REFUTED | — | Booking confirmation is the only exit from 예약 전: saves cannot move a client into/out of `pre_booking` into a date-derived status (only `terminated` is the deliberate exception), and `confirmBooking` is idempotent (double confirm is a no-op, `bookingConfirmedAt` never rewritten) | `backend/application/usecases/client/client-write-validation.ts:294-338`, `backend/application/services/client.service.ts:3148-3249` | `client-replacement-booking.real-db.spec.ts::SI-CLIENT-06 …` (5 invariants incl. the `terminated` exception and the double-confirm no-op) | — |
| SI-CLIENT-07 | backend | REFUTED (claim/recovery paths tested) | — | The production conditional claim admits exactly one winner and creates one client after both real `confirmNewClient` UPDATEs are observed blocked on the same PENDING draft; the loser receives REQUEST_NOT_PENDING. Re-confirmation is refused; the stale-CONFIRMING sweep recovers a crashed claim without touching a recent one. This does NOT prove exactly-once creation across a process crash after client creation (see caveat below), nor exercise DISCARDED | `backend/application/services/call-inbox.service.ts:328-476` (claim predicates), `backend/application/services/call-extraction-retry-scheduler.service.ts:154-180` (sweep) | `client-draft-confirm.real-db.spec.ts::SI-CLIENT-07 the production confirm claim admits exactly one winner after both calls block on the same PENDING draft` (+ 3 invariants) | — |
| SI-CLIENT-08 | frontend + mobile | CONFIRMED | low | Self-healing cache: main desktop `useUpdateClient`, used by `ClientFormDialog` on clients/filtered/contracts pages, invalidates clients/upcoming jobs but leaves the service-record overview stale. Mobile live update misses both upcoming jobs and overview. Refetch/remount/realtime repairs the cache; the secondary desktop hook is NOT evidence for the main edit form | `frontend/src/hooks/useClients.ts:185-205`, `frontend/src/components/app/clients/ClientFormDialog.tsx:20`, `mobile/src/hooks/useClients.ts:137-155` | `frontend/src/__integrity__/clients/desktop-clients-state-integrity.test.tsx::SI-CLIENT-08 main desktop useUpdateClient refreshes the service-record client overview after a ClientFormDialog edit`; `mobile/src/__integrity__/clients/mobile-clients-state-integrity.test.tsx::SI-CLIENT-08 mobile useUpdateClient refreshes message-trigger upcoming and service-record client overview caches (secondary desktop parity)` (both guarded knownDefects) | Desktop: `SI-CLIENT-08: main desktop useUpdateClient left the service-record client overview cache stale (version=1)`; mobile: `SI-CLIENT-08: mobile useUpdateClient left the message-trigger upcoming cache stale (desktop invalidates it)` |
| SI-CLIENT-08 | mobile | REFUTED (delete half) | — | Mobile `useDeleteClient` DOES invalidate `messageTriggerKeys.upcoming()` (line 218) and rolls the optimistic removal back on failure — delete-side parity holds | `mobile/src/hooks/useClients.ts:191-221` | `mobile/src/__integrity__/clients/mobile-clients-state-integrity.test.tsx::SI-CLIENT-08 mobile useDeleteClient invalidates the message-trigger upcoming cache (delete-side parity holds)`; `…::SI-CLIENT-08 mobile useDeleteClient removes the client optimistically and restores the cache when the delete fails` (named invariants) | — |
| SI-CLIENT-08 | frontend | REFUTED (secondary hook only) | — | Secondary desktop hook (update caller: `ContractLinkConfirmDialog`) invalidates clients/upcoming jobs and refetches overview; its delete restores optimistic removals on failure and invalidates on settle. These do not cover `ClientFormDialog` | `frontend/src/features/clients/hooks/use-clients.ts:343-373, 422-448`, `frontend/src/components/app/clients/ContractLinkConfirmDialog.tsx:18` | `frontend/src/__integrity__/clients/desktop-clients-state-integrity.test.tsx::SI-CLIENT-08 secondary desktop useUpdateClient invalidates clientKeys.all, messageTriggerKeys.upcoming() and refetches the service-record client overview`; `…::SI-CLIENT-08 secondary desktop useDeleteClient removes the client optimistically and restores the cache when the delete fails` (named invariants) | — |
| SI-CLIENT-09 (extra) | backend | REFUTED | — | Both production-wired transactional and optional-provider fallback `startDate` copies re-evaluate `start_date IS NULL` after a concurrent row-lock holder commits a real start date, then skip. The transactional test supplies real lifecycle and automation-intent instances over real Prisma; dispatch counters assert the intended branch ran | `backend/application/services/client-due-date-scheduler.service.ts:107-138` | `client-write-races.real-db.spec.ts::SI-CLIENT-09 the transactional scheduler's conditional startDate write skips after a concurrent locked update commits a start date`; same title with `fallback` | — |

**SI-CLIENT-07 recovery caveat (inspection note, not a mutation-proven verdict):**
the sweep (`call-extraction-retry-scheduler.service.ts:153-175`) resets stale
CONFIRMING to PENDING even if a process died after creating the client but before
recording CONFIRMED. Re-confirmation can therefore retry creation. The normalized
phone duplicate check (`client.service.ts:1358-1371`) mitigates this when the
original phone is still present, and the catch path tries to persist CONFIRMED
after bookkeeping errors (`call-inbox.service.ts:454-473`); neither is a durable
exactly-once fence for a process crash. A phone is optional, so do not infer
"no duplicates possible" from the normal claim/sweep tests. The post-create
crash window was not fault-injected here; it needs a dedicated recovery test.

Extra-ids note: SI-CLIENT-09 (the refuted scheduler half of SI-CLIENT-03's
two writers) is the only extra finding (1 of the 4 allowed).
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
- **SI-CLIENT-08** — main desktop `frontend/src/hooks/useClients.ts` needs a
  refetch/invalidation of `serviceRecordKeys.clientOverview(id)` after update.
  Mobile `useUpdateClient` in `mobile/src/hooks/useClients.ts` needs its
  `onSuccess` to invalidate `messageTriggerKeys.upcoming()` and invalidate or
  refetch `serviceRecordQueryKeys.clientOverview(id)` (secondary desktop parity).
  NOT SENSITIVE.

## Mutation proofs

All four added/repaired tests below were re-run by the resumed worker against
`bjj_si_clients_throwaway`; prior-run claims were not used as proof. Commands
ran from `backend/` with `DATABASE_URL` and `DIRECT_URL` targeting that database,
`STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test`, and
`pnpm test test/integrity/clients --runInBand --cacheDirectory .jest-cache-clients`
(or the single spec named below). Each production mutation was reverted exactly;
the final diff contains only area-folder tests/FINDINGS.

- **SI-CLIENT-03 invariant**
  (`client-write-races.real-db.spec.ts::…clobbers only smsAutomationEnabled`):
  mutated `backend/application/services/client.service.ts:1376-1380` — added
  `name: "뮤테이션"` to the reuse `updateMany` data alongside
  `smsAutomationEnabled`. Observed RED:
  `SI-CLIENT-03: the reuse write clobbered name — expected only smsAutomationEnabled to change`.
  Reverted exactly.
- **SI-CLIENT-04 phone-edit invariant**
  (`client-tombstone.real-db.spec.ts::…after a phone edit the old contract stays owned…`):
  two separate single-spec runs:
  1. At `backend/application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts:231-232`,
     added `if (assignedClientId > 0) return "no_match";` to bypass owned-document
     repair. RED, 1 failed / 5 passed:
     `SI-CLIENT-04: the reconciler did not keep the owned old contract attached after the phone edit (result "no_match")`.
     An initial unconditional early return caused TypeScript unreachable-code
     narrowing errors (0 tests executed); that attempt was not counted as proof.
  2. Reverted (1), then at the same file `:698-701` inverted the normalized-phone
     match from `=== params.phone` to `!== params.phone`. RED, 2 failed / 4 passed:
     `SI-CLIENT-04: the new-phone contract was left unlinked or attached elsewhere after the phone edit (result "disabled", clientId null)`;
     the existing tombstone/new-contract invariant also failed. Reverted exactly.
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
- **SI-CLIENT-07 production claim invariant**
  (`client-draft-confirm.real-db.spec.ts::…production confirm claim admits exactly one winner…`):
  removed `status: "PENDING"` from the actual production claim's `where` at
  `backend/application/services/call-inbox.service.ts:406-408`. The deterministic
  test went RED after observing BOTH real service UPDATEs blocked:
  `SI-CLIENT-07: production claim admitted 2 winners / 0 losers after two observed blocked claims`.
  A single-spec rerun of the final four-test draft suite reported 1 failed /
  3 passed with successful fixture cleanup. The redundant timing-only race was
  removed: on the initial whole-area mutation run it also failed, but asserted
  before tracking its duplicate-created clients, causing a cleanup FK failure.
  That failure was not used as mutation evidence. Reverted exactly.

### Fix2 mutation proofs (historical)

Targeted tests used `pnpm test <spec> --runInBand --cacheDirectory
.jest-cache-clients -t <name>` with the real-DB exports above, or
`pnpm --filter ./frontend|./mobile exec jest src/__integrity__/clients
--runInBand -t <name>`. Every mutation below exited 1; all production changes
were reverted exactly before the final acceptance runs.

- **SI-CLIENT-09 transactional**, then **fallback** (separate mutations/runs):
  removed `startDate: null` only from the transactional `updateMany` at
  `backend/application/services/client-due-date-scheduler.service.ts:111`, ran
  both SI-CLIENT-09 cases: transactional RED, fallback PASS. Restored it, then
  removed the fallback predicate at `:135`: fallback RED, transactional PASS.
  Both failures: `SI-CLIENT-09: scheduler wrote 1 row(s) although a committed
  start date existed — lost update`. Each passing or failing race first observed
  the actual SQL blocked through `pg_stat_activity`; the transaction uses real
  lifecycle and automation services, with dispatch counters pinning the branch.
  An initial transactional mutation caught an overly broad timing tap (it also
  counted a lifecycle metadata write, `Expected: 1 / Received: 2`); the tap was
  restricted to the scheduler's dueDate predicate and the mutation rerun yielded
  the lost-update assertion above. That initial error is not the proof.
- **SI-CLIENT-05**: removed `client: { deletedAt: null }` from
  `backend/infrastructure/database/repositories/sb.holiday-review.repository.ts:192`.
  Enabled-tombstone invariant RED: `SI-CLIENT-05: the tombstoned client's open
  review item is still listed (1 open item(s) counted)`. The corrected assertion
  scopes summaries to the unique fixture event (which has exactly this client's
  item), not all events/clients in the shared branch.
- **SI-CLIENT-08 main desktop knownDefect**: first ran its body as ordinary
  `it`, observing RED: `SI-CLIENT-08: main desktop useUpdateClient left the
  service-record client overview cache stale (version=1)`. Real QueryClient
  state proved client/upcoming invalidation and detail merge succeeded, unrelated
  overview state stayed untouched, but the target overview kept its old payload.
  Temporarily imported `serviceRecordKeys` and added an awaited
  `refetchQueries({ queryKey: serviceRecordKeys.clientOverview(variables.id) })`
  to `frontend/src/hooks/useClients.ts:203-204`: knownDefect RED with
  `Failing test passed even though it was supposed to fail.` (fresh payload 2).
- **SI-CLIENT-08 secondary desktop update invariant**: changed overview key
  to `clientOverview(id + 1)` at
  `frontend/src/features/clients/hooks/use-clients.ts:369`. RED:
  `SI-CLIENT-08: desktop useUpdateClient did not refetch the service-record client overview`.
- **SI-CLIENT-08 secondary desktop delete invariant**: bypassed
  `restoreQueries` at the same file `:441`. RED:
  `SI-CLIENT-08: desktop useDeleteClient did not restore the optimistic removal on failure`.
- **SI-CLIENT-08 mobile delete invariants**: bypassed `restoreQueries` at
  `mobile/src/hooks/useClients.ts:212` and removed upcoming invalidation at
  `:218`. Both named invariants RED: `SI-CLIENT-08: mobile useDeleteClient no
  longer invalidates the message-trigger upcoming cache` and `SI-CLIENT-08:
  mobile useDeleteClient did not restore the optimistic removal on failure
  (list=false, all=false)`.
- **SI-CLIENT-08 mobile update knownDefect**: added upcoming invalidation and
  overview refetch to `mobile/src/hooks/useClients.ts:153-154` (temporary
  `serviceRecordQueryKeys` import). RED:
  `Failing test passed even though it was supposed to fail.` QueryClient methods
  in both client suites now execute normally (spies call through); only HTTP
  and the secondary hook's irrelevant branch-context boundary are doubled.

## Acceptance rerun (fix1 resumed worker, historical)

Run against a freshly recreated `bjj_si_clients_throwaway` after reverting all
mutations; `prisma migrate deploy` succeeded. No shared integrity runner used.

| command | observed result |
|---|---|
| Real-DB exports above + `pnpm test test/integrity/clients --runInBand --cacheDirectory .jest-cache-clients` (backend cwd) | PASS: 5 suites, 23 tests, 0 skipped; 4 knownDefects fail as expected |
| `env -u DATABASE_URL -u DIRECT_URL -u STATE_INTEGRITY_REAL_DB pnpm test test/integrity/clients` (backend cwd, fresh process) | Exit 0: all 5 real-DB suites / 23 tests skipped |
| `pnpm --filter ./frontend exec jest src/__integrity__/clients` | PASS: 1 suite / 2 tests |
| `pnpm --filter ./mobile exec jest src/__integrity__/clients` | PASS: 1 suite / 3 tests (includes expected mobile cache defect) |
| `pnpm --filter ./backend exec eslint test/integrity/clients` | Exit 0, no diagnostics |
| `pnpm --filter ./backend exec tsc --noEmit -p tsconfig.json` | Exit 0, no diagnostics |
| `pnpm --filter ./frontend exec tsc --noEmit` | Exit 0, no diagnostics |
| `pnpm --filter ./mobile exec tsc --noEmit` | Exit 0, no diagnostics |

Dropped the owned database (`psql -h localhost -U postgres -lqt` has no matching
database) and removed `backend/.jest-cache-clients`. `git diff 54ef4e253 --name-only`
contains only the five files in `backend/test/integrity/clients/`; application,
schema, migrations and shared harness changes are absent. No `DBGWIRE` code.
Scoped security checks: env files remain ignored, no added credentials or unsafe
raw-query APIs; the new lock query parameterizes its UUID. No dependency changes.
The frontend/mobile Jest runs emit the existing Sentry import deprecation warning.

## Notes for reviewers

- The concurrency proofs use real lock waits observed through `pg_stat_activity`
  (void-fences convention). They hold interactive transactions open, so every
  held transaction passes `{ maxWait: 5000, timeout: 60000 }` (Prisma's 5 s
  interactive-transaction default would otherwise abort the holder mid-wait).
- Prisma's `PrismaPromise` is LAZY: a query only issues when a `.then` /
  `await` attaches. The race specs tap/factor every racing statement accordingly;
  rule for
  future race specs: never dispatch a racing statement without an immediate tap.
- Write-race specs retry the interleaving up to 3 times on a fresh fixture when the
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

## Acceptance rerun (fix2, historical)

The owned database was freshly created and `prisma migrate deploy` exited 0.
Backend commands below ran in `backend/` with the real-DB exports documented
above (except the explicit no-env run). No shared integrity runner was used.

| command | observed result |
|---|---|
| `pnpm test test/integrity/clients --runInBand --randomize --seed=-1240350712 --showSeed --cacheDirectory .jest-cache-clients` | PASS: 5 suites / 24 tests, 0 skipped; reproducer seed now green |
| Same command, `--seed=871230` | PASS: 5 suites / 24 tests, 0 skipped |
| Same command, `--seed=20261031` | PASS: 5 suites / 24 tests, 0 skipped |
| `TZ=UTC` + same command, `--seed=424242` | PASS: 5 suites / 24 tests, 0 skipped |
| `env -u DATABASE_URL -u DIRECT_URL -u STATE_INTEGRITY_REAL_DB pnpm test test/integrity/clients` | Exit 0: all 5 real-DB suites / 24 tests skipped as intended |
| `pnpm --filter ./frontend exec jest src/__integrity__/clients` | PASS: 1 suite / 3 tests (main-hook knownDefect + 2 secondary-hook invariants) |
| `pnpm --filter ./mobile exec jest src/__integrity__/clients` | PASS: 1 suite / 3 tests (update knownDefect + 2 delete invariants) |
| `pnpm --filter ./backend exec eslint test/integrity/clients` | Exit 0, no diagnostics |
| `pnpm --filter ./backend exec tsc --noEmit -p tsconfig.json` | Exit 0, no diagnostics |
| `pnpm --filter ./frontend exec tsc --noEmit` | Exit 0, no diagnostics |
| `pnpm --filter ./mobile exec tsc --noEmit` | Exit 0, no diagnostics |
| `git diff --check` | Exit 0 |
| `dropdb -h localhost -U postgres bjj_si_clients_throwaway` then `psql -h localhost -U postgres -lqt \| grep bjj_si_clients_throwaway` | Drop exit 0; no database match |

Removed `backend/.jest-cache-clients`. Final changed paths are confined to the
three clients audit folders; no application/schema/shared-helper changes remain.
Security checks were scoped to the audit diff: no credential/private-key patterns,
unsafe raw-query APIs, dynamic execution or HTML injection added; env files remain
git-ignored. No dependency changes (dependency audit not rerun). No application
fixes or UI changes were made, so no build/browser/server was needed. Existing
Sentry import deprecation warnings remain in frontend/mobile Jest output.

## Fix3 mutation proofs

Both update tests accept either an invalidated overview query or its refetched
payload (`version=2`), using a real QueryClient and mocked HTTP. Mobile now seeds
the inactive overview query, rather than requiring a particular refetch call.
The existing expected-failure guards and missing-upcoming check are retained.

- **SI-CLIENT-08 main desktop**: temporarily imported `serviceRecordKeys` and,
  after `frontend/src/hooks/useClients.ts:193` (original line numbering), added
  `await queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(variables.id) })`
  to `useUpdateClient.onSuccess`. Ran
  `pnpm --filter ./frontend exec jest src/__integrity__/clients --runInBand -t 'main desktop useUpdateClient'`:
  RED (exit 1, one failed knownDefect), with
  `Failing test passed even though it was supposed to fail.` Replaced only that
  call with `await queryClient.refetchQueries(...)` and repeated the same command:
  identical RED. Thus both valid fixes satisfy the revised assertion. An initial
  insertion accidentally matched `useCreateClient`, so the targeted update test
  stayed green; that run is not mutation proof. Both actual update mutations and
  the temporary import were reverted exactly.
- **SI-CLIENT-08 mobile**: temporarily imported `serviceRecordQueryKeys` and
  added upcoming-job invalidation to `mobile/src/hooks/useClients.ts:153`
  (`useUpdateClient.onSuccess`). With this change alone,
  `pnpm --filter ./mobile exec jest src/__integrity__/clients --runInBand -t 'mobile useUpdateClient'`
  stayed green as an expected failure: the overview was still stale. Then added
  `queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.clientOverview(variables.id) })`:
  RED (exit 1, one failed knownDefect), with
  `Failing test passed even though it was supposed to fail.` Replaced the overview
  call with `refetchQueries(...)`: identical RED. Reverted both calls and the
  temporary import exactly. This also proves the mobile overview check remains
  necessary independently of the earlier upcoming-job check.

## Acceptance rerun (fix3, current)

Freshly created the owned `bjj_si_clients_throwaway`; `prisma migrate deploy`
exited 0. Real-DB commands used the exports in the original brief and ran from
`backend/`. All temporary production mutations were reverted before these runs.

| command | observed result |
|---|---|
| `pnpm test test/integrity/clients --runInBand --randomize --seed=-1240350712 --showSeed --cacheDirectory .jest-cache-clients` | PASS: 5 suites / 24 tests, 0 skipped |
| Same command, `--seed=871230` | PASS: 5 suites / 24 tests, 0 skipped |
| Same command, `--seed=20261031` (retains fix2's three-run requirement) | PASS: 5 suites / 24 tests, 0 skipped |
| `TZ=UTC` + same command, `--seed=424242` | PASS: 5 suites / 24 tests, 0 skipped |
| `env -u DATABASE_URL -u DIRECT_URL -u STATE_INTEGRITY_REAL_DB pnpm test test/integrity/clients` | Exit 0: 5 suites / 24 tests skipped as intended |
| `pnpm --filter ./frontend exec jest src/__integrity__/clients` | PASS: 1 suite / 3 tests |
| `pnpm --filter ./mobile exec jest src/__integrity__/clients` | PASS: 1 suite / 3 tests |
| `pnpm --filter ./backend exec eslint test/integrity/clients` | Exit 0, no diagnostics |
| `pnpm --filter ./backend exec tsc --noEmit -p tsconfig.json` | Exit 0, no diagnostics |
| `pnpm --filter ./frontend exec tsc --noEmit` | Exit 0, no diagnostics |
| `pnpm --filter ./mobile exec tsc --noEmit` | Exit 0, no diagnostics |
| `git diff --check` | Exit 0 |
| `git diff --exit-code -- frontend/src/hooks/useClients.ts mobile/src/hooks/useClients.ts` | Exit 0: both production hooks restored exactly |
| `dropdb -h localhost -U postgres bjj_si_clients_throwaway` then database-list check | Exit 0; no matching database |

Removed `backend/.jest-cache-clients`. Only the two clients test files and this
FINDINGS file changed. Scoped security checks found no added credential/private
key patterns, dynamic execution, unsafe raw SQL or HTML injection; env files
remain ignored. No dependencies changed (dependency audit not rerun). No build,
server or browser was needed for this audit-only correction. Existing Sentry
deprecation warnings remain. Reviewer focus: invalidation-or-fresh-payload
semantics and both mutation forms; no application fix is included.

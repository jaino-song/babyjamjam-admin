# FINDINGS — Unit p2-sms (SMS integrity audit)

Audit only: real PostgreSQL and real SMS services/repositories, with local
provider doubles (no network sends). Paths are repository-relative. Correction
base: `217e863d3`; application code, schema, migrations and shared helpers are
unchanged. Backend: 5 suites / 24 tests. Mobile: 1 suite / 7 tests.

## Verdict table

| id | layer | verdict | severity proposal | one-line defect / bounded result | evidence file:line | test file::test name | observed failure message (CONFIRMED only) |
|---|---|---|---|---|---|---|---|
| SI-SMS-01 | backend | CONFIRMED | low | Latent, no production caller: unguarded entity transitions plus token-less repository update allow sent→failed and canceled→sent; live dispatch writes carry a claim token | `backend/domain/entities/message-trigger-job.entity.ts:210-239`; `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:268-298`; production callers `backend/application/services/message-trigger.service.ts:3439,3564,4601` | `backend/test/integrity/sms/sms-job-state-fences.real-db.spec.ts::SI-SMS-01 a claimToken-less entity cannot rewrite a terminal (sent) job` and `…cannot cancel-then-resurrect a sent job over a canceled row` | `terminal job was rewritten: sent job is now status=failed cancelReason=late failure overwrite`; `canceled job was rewritten: status=sent sentAt=2026-10-30T…Z` |
| SI-SMS-02 | backend | CONFIRMED | medium | Rule hard-delete cascades sent/canceled JOB history, but `message_log` survives through SetNull; rule-scoped dedupe does not create a resend | `backend/application/services/message-trigger.service.ts:1690-1695`; `backend/infrastructure/database/repositories/sb.message-trigger-rule.repository.ts:404-408,471-484`; `backend/prisma/schema.prisma:1085,1164` | `backend/test/integrity/sms/sms-rule-delete-cascade.real-db.spec.ts::SI-SMS-02 deleting a rule through MessageTriggerService.deleteRule keeps sent-job history` and `…keeps its canceled-job audit trail` | `sent job history was erased by rule deletion: sentJob=GONE, remaining jobs for rule=0`; `canceled job history was erased by rule deletion: canceledJob=GONE` |
| SI-SMS-03 | backend | REFUTED | — | Claim CAS serializes contenders and yields one token; a second delivery arriving after the first log is started is refused by read-side acceptance checks. Prepared→started CAS and P2002 create convergence are NOT exercised | `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:394-423`; `backend/application/services/sms-trigger-delivery.service.ts:612-633`; `backend/infrastructure/database/repositories/sb.message-log.repository.ts:103-168` | `backend/test/integrity/sms/sms-dispatch-claim-race.real-db.spec.ts::SI-SMS-03 *` (3 invariants; row-lock/pg_stat_activity interleaving, then paused provider call) | — |
| SI-SMS-04 | backend | REFUTED | — | Reclaim reconciles sent/accepted logs to sent and started logs to failed/uncertain. Retry first refuses the pending source via `status !== "failed"`; the locked family re-read is a backup refusal, not merely `isProviderOutcomeUncertain()` | `backend/application/services/message-trigger.service.ts:4564-4601`; `backend/application/services/sms-retry.service.ts:110-118`; `backend/infrastructure/database/repositories/sb.message-log.repository.ts:335-342` | `backend/test/integrity/sms/sms-dispatching-reconciliation.real-db.spec.ts::SI-SMS-04 *` (2 invariants) | — |
| SI-SMS-05 | backend | REFUTED | — | Forced concurrent retries produce one attempt and one provider call; loser must be `ConflictException` with HTTP 409, not an arbitrary error / P2002 | `backend/infrastructure/database/repositories/sb.message-log.repository.ts:302-416`; `backend/application/services/sms-retry.service.ts:139-157,697-747` | `backend/test/integrity/sms/sms-retry-family-race.real-db.spec.ts::SI-SMS-05 two concurrent manual retries of one failed log produce exactly one send` | — |
| SI-SMS-06 | backend | CONFIRMED | low | Raw SQL accepts bogus job/log statuses and carrier state (DB defense-in-depth gap); no production TypeScript writer of these bogus values was found | `backend/prisma/schema.prisma:1059,1079,1145`; existing CHECKs only processing-claim-token and provider-acceptance-state | `backend/test/integrity/sms/sms-job-state-fences.real-db.spec.ts::SI-SMS-06 an out-of-set {message_trigger_job.status / message_log.status / message_log.carrier_result_state} is rejected by the database` | `message_trigger_job accepted out-of-set status 'bogus'`; `message_log accepted out-of-set status 'bogus'`; `message_log accepted out-of-set carrier_result_state 'bogus'` |
| SI-SMS-07 | backend | REFUTED | — | Current eligibility is re-read: deactivating a rule AFTER job creation cancels it; jobsStale prevents claiming; opting a client out BETWEEN claim and dispatch authorization cancels with recipient safeguard reason. Each has zero provider calls | `backend/application/services/message-trigger.service.ts:3162-3197,3635-3640`; `backend/application/services/sms-automation-safeguard.service.ts:159-176,187-198`; `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:353-418` | `backend/test/integrity/sms/sms-dispatching-reconciliation.real-db.spec.ts::SI-SMS-07 *` (5 invariants, including 3 new live-dispatch probes) | — |
| SI-SMS-08 | mobile | CONFIRMED | low | Retry/resend/cancel miss `messages/logs/all` (30-minute default freshness); cancel adds a terminal-job history row that changes rule counts; manual-send invalidates neither all-logs nor trigger history. Per-client optional invalidation is desktop parity, not a mobile defect; that view has staleTime 0 | `mobile/src/features/message-triggers/hooks/use-message-triggers.ts:325-338,412-440`; `mobile/src/components/app/mobile-redesign/MessageTriggerList.tsx:173,189-201`; `backend/interface/controllers/message-trigger.controller.ts:136-146`; `backend/application/services/message-trigger.service.ts:800-812,882-902`; `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:554-568`; `mobile/src/lib/queryClient.ts:40`; `mobile/src/hooks/useClientMessageHistory.ts:19`; `mobile/src/app/(shell)/messages/new/page.tsx:1541-1560`; desktop `frontend/src/features/message-triggers/hooks/use-message-triggers.ts:292-294,329-331` | `mobile/src/__integrity__/sms/message-trigger-invalidation.integrity.test.tsx::SI-SMS-08 *` (3 invariants + 4 knownDefects) | `the all-logs view was not invalidated after the change: retry`; `…: resend`; `the all-logs view was not invalidated after the change: cancel`; `the manual send did not invalidate the message views (allLogs=false history=false)` |
| SI-SMS-09 | backend | NEEDS-PRODUCT-DECISION | — | A slow original worker can overwrite reclaimed failed/uncertain→sent with the SAME retained claim token. double-send REFUTED: one provider call; final state matches the provider outcome; not re-sendable while failed/uncertain. Decide terminal immutability versus accepting a late provider success | `backend/application/services/message-trigger.service.ts:3385-3386,4063-4089,4564-4611`; `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:268-275` | `backend/test/integrity/sms/sms-dispatching-reconciliation.real-db.spec.ts::SI-SMS-09 a late worker rewriting a reconciled failed job to sent is reachable today` (invariant pins current reachability) | — |

## Coverage boundaries

- **SI-SMS-01 is latent.** The two direct repository probes deliberately omit
  the token. Production preparation/rebuild writes run after a claim; reclaim
  reads only processing (CHECK requires a token) and dispatching (token kept).
  SI-SMS-09 separately exercises the reachable same-token case, not that latent
  token-less branch.
- **SI-SMS-02:** the approved delete fence refuses processing/dispatching jobs
  and `sent_at >= fenceStartedAt`, not old sent history. No send-log erasure or
  duplicate provider effect is established by the cascade tests.
- **SI-SMS-03:** no claim that two acceptance creators were forced past both
  read-side checks, or that a P2002 was caught. That would need an additional
  seam before attempt insertion / prepared→started CAS. Existing evidence is
  the claim CAS plus already-started read-side refusal, not that stronger race.
- **SI-SMS-07:** the new recipient probe verifies `processing` + token during
  preparation, flips the real client row there, then drives final dispatch
  authorization. Rule-off and jobsStale probes change the real rule after job
  creation and drive `dispatchClaimedJob`. These do not independently prove
  every employee termination / `suppressGreetingSms` combination.
- **SI-SMS-08:** state, not exact invalidate-call keys, is asserted on a real
  QueryClient. Realtime's `messages` root invalidates both all-logs and client
  history. Retry/resend still leave all-logs fresh even with clientId supplied.
  Cancel also leaves all-logs stale: `GET /message-logs` calls `listHistory`,
  which merges terminal jobs from `findTerminalByBranch` as `message_job` rows
  with status `canceled`, even without a message_log row. `MessageTriggerList`
  counts these rows per rule, so cancel changes that view. This is now a
  knownDefect, not an invariant. Upcoming/history invalidations still hold.
  Immediate manual send changes history, not upcoming jobs,
  so upcoming is deliberately not required. Per-client staleTime 0 refetches
  on remount; both desktop and mobile condition its invalidation on clientId.
- **SI-SMS-09:** the real claim/preparation/authorization/gate/reclaim/update
  paths run; only provider delivery is local. A promise seam holds the provider
  result after admission and one recorded call; the DB is observed dispatching,
  aged past the cutoff, then observed failed/uncertain after a second scheduler
  tick. Release proves the finishing write changes it to sent. A late success
  could legitimately resolve uncertainty: this is not labelled data loss or a
  duplicate send and has no severity until product chooses precedence.
- **UNTESTABLE residual:** reclaim reads sentIds/uncertainIds before its loop;
  a log becoming accepted between those reads and the job update is unmeasured.
  A pause on those reads (or transaction-client hook) would be needed to force
  that separate interleaving. No result is inferred from SI-SMS-09 about it.

## Fix notes

- **SI-SMS-01 (low, latent)** — Guard terminal entity transitions and restrict
  token-less repository writes to non-terminal source rows. No production
  caller was found; do not treat this as demonstrated live data loss.
  Not SENSITIVE (application-only suggestion).
- **SI-SMS-02 (medium)** — Preserve job audit history via archival/soft deletion
  or refuse rule deletion when historical jobs exist, consistently for plain
  and approved paths. The log already survives, so do not claim a resend fix.
  SENSITIVE if changing the Cascade FK / adding archive schema or migrations.
- **SI-SMS-06 (low)** — Enumerated CHECKs for job/log statuses and carrier state.
  SENSITIVE: migration required.
- **SI-SMS-08 (low)** — Retry/resend/cancel should invalidate the `messages/logs`
  prefix as well as trigger history; manual success should invalidate history
  and the message-log prefix. Prefix invalidation is sufficient. No need to
  require upcoming for immediate sends or invent a desktop/clientId disparity.
  Not SENSITIVE (mobile hook/page-only suggestion).
- **SI-SMS-09** — Product decision first; no fix prescribed. If reconciliation
  is final, retire the token / add source-state CAS. If late authoritative
  provider results take precedence, specify that exception to terminal-state
  immutability and keep a test for it. Do not blanket-fence away useful late
  success evidence without choosing this policy.

## Mutation proofs

All production mutations below were temporary and reverted byte-for-byte.
Line numbers refer to the unmutated source. Focused runs used our own
`bjj_si_sms_throwaway`, `STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test`,
and `pnpm test <spec> --runInBand --cacheDirectory .jest-cache-sms` (backend).
Mobile used `pnpm --filter ./mobile exec jest src/__integrity__/sms --runInBand`.
The full unmutated acceptance run is separate from these deliberately RED runs.

| id / test | production file:line and temporary mutation | observed result |
|---|---|---|
| SI-SMS-04 guard characterization | Remove `sourceLog.isProviderOutcomeUncertain()` refusal at `backend/application/services/sms-retry.service.ts:117-119` | Both SI-SMS-04 tests still GREEN: it is not the deciding guard for this pending/started fixture |
| SI-SMS-04 layered refusal | In addition remove `status !== "failed"` at the same service `:110-112`, and disable locked `family.some(...)` refusal at `backend/infrastructure/database/repositories/sb.message-log.repository.ts:335-342` (leave source CAS intact) | RED: `Received promise resolved instead of rejected`; a new attempt reached the local provider stub. The first actual refusal is source status; the family re-read also protects the source |
| SI-SMS-05 concurrent retry | Disable `family.some(...)` in `backend/application/services/sms-retry.service.ts:139-142` and in `backend/infrastructure/database/repositories/sb.message-log.repository.ts:335-342`; remove `status`, `nextRetryAt`, `updatedAt` source predicates at repository `:392-398` | RED: `the losing retry did not surface ConflictException (409): PrismaClientKnownRequestError: … Unique constraint failed on the fields: (provider_acceptance_key)` (P2002). One send still happened; the repaired assertion catches the incorrect loser classification |
| SI-SMS-07 rule deactivated after creation | Remove inactive-rule refusal at `backend/application/services/sms-automation-safeguard.service.ts:164` and replace claim rule `is_active` predicates with true at `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:359,366` | RED: `a dispatch-time inactive rule did not stop the job: status=sent reason=null` |
| SI-SMS-07 jobsStale after creation | Replace `rule.jobs_stale = false` with true in `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:409` | RED: `a dispatch-time stale rule did not stop the job: status=sent reason=null` |
| SI-SMS-07 opt-out between claim and authorization | Remove client opt-out refusal at `backend/application/services/sms-automation-safeguard.service.ts:195-197` | RED: `a job whose client was opted out after scheduling was not canceled: status=sent reason=null` |
| SI-SMS-08 retry all-logs | Add `invalidateQueries({queryKey:["messages"]})` to `mobile/src/features/message-triggers/hooks/use-message-triggers.ts:331` success callback | Test body now passes; knownDefect turns RED: `Failing test passed even though it was supposed to fail` |
| SI-SMS-08 resend all-logs | Same prefix invalidation at mobile hook `:432` | Body passes; knownDefect turns RED with the same unexpected-pass message |
| SI-SMS-08 cancel all-logs (round 2) | Add `invalidateQueries({queryKey:["messages","logs"]})` to `mobile/src/features/message-triggers/hooks/use-message-triggers.ts:418` success callback | Body passes; knownDefect turns RED: `Failing test passed even though it was supposed to fail`. Reverted exactly; the unmutated body run as plain `it` failed with `the all-logs view was not invalidated after the change: cancel` |
| SI-SMS-08 manual send (F1) | Add `useQueryClient()` and invalidate `messages` + `message-triggers` prefixes in `mobile/src/app/(shell)/messages/new/page.tsx:1541` success callback | Body passes; knownDefect turns RED with the unexpected-pass message. Proves correct broad-prefix fixes are accepted, unlike the review-round-1 test |
| SI-SMS-09 reachable rewrite | Add source `status IN (processing,dispatching)` predicate to the token-CAS `updateMany` at `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:273` | RED: final `Expected: "sent" / Received: "failed"`; reclaim still completed first with the original token, but the original worker could no longer overwrite it |

The three new SI-SMS-07 mutations ran together and each failed for the sent
symptom above (not a setup error). The SI-SMS-09 source-state predicate was
also active in that run; SI-SMS-09 was then re-run alone on the final seam and
assertions, with the same RED result. The unchanged older opt-out fixture also
failed under that batch with `Invalid automation variables`; that failure is
NOT counted as a mutation proof. The three new probes have complete payloads.

SI-SMS-08 knownDefect bodies were also run as plain `it` against unmutated
production to capture the actual matching failures in the verdict table; then
the expected-failure wrappers were restored. No application mutation remains.

## Verification

- PASS `STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test pnpm test test/integrity/sms --runInBand --cacheDirectory .jest-cache-sms` (backend, own throwaway URLs): 24 tests (17 invariants, 7 expected defects), no skips.
- PASS `env -u DATABASE_URL -u DIRECT_URL -u STATE_INTEGRITY_REAL_DB -u E2E_VENDOR_STUBS pnpm test test/integrity/sms` (backend): 24 real-DB tests skipped; no DB connection made by the specs.
- PASS `pnpm --filter ./mobile exec jest src/__integrity__/sms --runInBand` twice: 7 tests each (3 invariants, 4 expected defects).
- PASS backend/mobile area ESLint, backend `tsc --noEmit -p tsconfig.json` and mobile `tsc --noEmit` (zero errors).
- Local security checks: env files ignored, no secrets/debug logging added,
  SQL values parameterized, throwaway guard retained, no dependency/auth/schema
  changes. No network dependency audit was run (dependencies unchanged).
- No desktop tests or source were added, so desktop Jest/TypeScript are N/A.
- Scope check: `git diff 217e863d3 --name-only` contains only backend SMS area
  and mobile SMS area files. Temporary production mutations reverted exactly.
- Cleanup checks are repeated after committing: no `.jest-cache-*`, no
  `bjj_si_sms_throwaway`, empty `git status --short`.

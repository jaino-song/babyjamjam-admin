# FINDINGS — Unit p2-sms (SMS integrity audit)

Real-PostgreSQL audit of the SMS state area (`message_trigger_job`, `message_log`,
`message_trigger_rule`, mobile message views). Suite: `backend/test/integrity/sms`
(5 real-DB spec files, 20 tests) + `mobile/src/__integrity__/sms` (6 tests).
All paths below are relative to the repository root.

## Verdict table

| id | layer | verdict | severity proposal | one-line defect | evidence file:line | test file::test name | observed failure message (CONFIRMED only) |
|---|---|---|---|---|---|---|---|
| SI-SMS-01 | backend | CONFIRMED | medium | Entity status transitions are unguarded and a claimToken-less `repository.update()` persists illegal transitions over terminal (sent/canceled) jobs | `backend/domain/entities/message-trigger-job.entity.ts:210-239` (markSent/markFailed/cancel accept any source state), `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:268-298` (token-less branch is a bare UPDATE, token branch is the CAS fence) | `backend/test/integrity/sms/sms-job-state-fences.real-db.spec.ts::SI-SMS-01 a claimToken-less entity cannot rewrite a terminal (sent) job` | `terminal job was rewritten: sent job is now status=failed cancelReason=late failure overwrite` |
| SI-SMS-01 | backend | CONFIRMED | medium | (same id) canceled → sent resurrection persists through the same token-less write | `backend/domain/entities/message-trigger-job.entity.ts:210-218` (markSent keeps canceledAt), `sb.message-trigger-job.repository.ts:293-298` | `backend/test/integrity/sms/sms-job-state-fences.real-db.spec.ts::SI-SMS-01 a claimToken-less entity cannot cancel-then-resurrect a sent job over a canceled row` | `canceled job was rewritten: status=sent sentAt=2026-10-30T…Z` |
| SI-SMS-02 | backend | CONFIRMED | high | `MessageTriggerService.deleteRule` hard-deletes the rule and the `onDelete: Cascade` FK erases all remaining jobs of the rule including `sent` (sent-job history destroyed); the approved delete fence only refuses a send that lands *during* the delete, never old sent history | `backend/application/services/message-trigger.service.ts:1690-1695`, `backend/infrastructure/database/repositories/sb.message-trigger-rule.repository.ts:404-408`, `backend/prisma/schema.prisma:1164` (`onDelete: Cascade`), `sb.message-trigger-rule.repository.ts:471-484` (fence covers `sent_at >= fenceStartedAt` only) | `backend/test/integrity/sms/sms-rule-delete-cascade.real-db.spec.ts::SI-SMS-02 deleting a rule through MessageTriggerService.deleteRule keeps sent-job history` | `sent job history was erased by rule deletion: sentJob=GONE, remaining jobs for rule=0` |
| SI-SMS-02 | backend | CONFIRMED | high | (same id) canceled-job audit trail is erased by the same cascade | same as above | `backend/test/integrity/sms/sms-rule-delete-cascade.real-db.spec.ts::SI-SMS-02 deleting a rule through MessageTriggerService.deleteRule keeps its canceled-job audit trail` | `canceled job history was erased by rule deletion: canceledJob=GONE` |
| SI-SMS-03 | backend | REFUTED | — | Guard exists: two dispatchers cannot double-send. (a) claim CAS: one row-locked UPDATE … status='pending' yields exactly one claim token (proved with a second-connection row lock and `pg_stat_activity` Lock waits); (b) acceptance boundary: a duplicate dispatch converges on the started attempt row (`providerAcceptanceKey` = digest of `branchId:jobId`, unique) and refuses a second provider crossing | `backend/infrastructure/database/repositories/sb.message-trigger-job.repository.ts:394-423`, `backend/application/services/sms-trigger-delivery.service.ts:612-633,655-568`, `backend/infrastructure/database/repositories/sb.message-log.repository.ts:103-168` | `backend/test/integrity/sms/sms-dispatch-claim-race.real-db.spec.ts::SI-SMS-03 *` (3 invariants) | — |
| SI-SMS-04 | backend | REFUTED | — | Guard exists: the stale-processing reclaim reconciles a `dispatching` job with an `accepted`/`sent` log to `sent` (never failed), and with a `started`/`uncertain` log to `failed`+uncertain reason — no re-send without reconciliation (the log's manual retry refuses with 409, provider never called again) | `backend/application/services/message-trigger.service.ts:4564-4603`, `backend/infrastructure/database/repositories/sb.message-log.repository.ts:425-463`, `backend/application/services/sms-retry.service.ts:104-157` | `backend/test/integrity/sms/sms-dispatching-reconciliation.real-db.spec.ts::SI-SMS-04 *` (2 invariants) | — |
| SI-SMS-05 | backend | REFUTED | — | Guard exists: two concurrent manual retries of one failed log produce exactly one attempt row and one provider call; the loser gets 409 (family re-read under the `sms_retry_family` advisory lock + source-row CAS on `updatedAt`) | `backend/infrastructure/database/repositories/sb.message-log.repository.ts:302-416`, `backend/application/services/sms-retry.service.ts:139-157,697-747` | `backend/test/integrity/sms/sms-retry-family-race.real-db.spec.ts::SI-SMS-05 two concurrent manual retries of one failed log produce exactly one send` | — |
| SI-SMS-06 | backend | CONFIRMED | low | No DB CHECK on `message_log.status`, `message_trigger_job.status`, or `message_log.carrier_result_state`; raw out-of-set values ('bogus') are accepted (defense-in-depth gap; the audit found no writer able to produce an out-of-set value in TS — all writers are bounded by entity unions) | `backend/prisma/schema.prisma:1059,1079,1145` (bare String columns); existing CHECKs only `message_trigger_job_processing_claim_token_check` (migration 20260829140000) and `message_log_provider_acceptance_state_check` (migration 20260829000000) | `backend/test/integrity/sms/sms-job-state-fences.real-db.spec.ts::SI-SMS-06 an out-of-set {message_trigger_job.status / message_log.status / message_log.carrier_result_state} is rejected by the database` | `message_trigger_job accepted out-of-set status 'bogus'` / `message_log accepted out-of-set status 'bogus'` / `message_log accepted out-of-set carrier_result_state 'bogus'` |
| SI-SMS-07 | backend | REFUTED | — | Guard exists: dispatch re-checks CURRENT eligibility — a job for a client whose `smsAutomationEnabled` is off is canceled at dispatch with the recipient-level reason and zero provider calls (the safeguard runs inside the claim and again in the dispatch-authorization transaction); an inactive rule is unclaimable; an eligible client under an active rule+enabled parent claims normally | `backend/application/services/message-trigger.service.ts:3162-3197` (safeguard under the claim), `:3635-3640` (safeguard fence under the job row lock), `backend/application/services/sms-automation-safeguard.service.ts:111-170` (fresh reads of rule/client flags) | `backend/test/integrity/sms/sms-dispatching-reconciliation.real-db.spec.ts::SI-SMS-07 a due job for a client whose SMS automation is off is canceled at dispatch, not sent` + `…can be claimed for dispatch` | — |
| SI-SMS-08 | mobile | CONFIRMED | low | Mutation-driven invalidation gaps on mobile (realtime fallback is covered — the `message` root `["messages"]` prefix-matches the client-history family — but the mutation gaps leave a mounted client-detail history stale until an unrelated realtime event or remount): (a) messages-tab retry (`useRetryMessageHistory()` without clientId) skips the `["messages","logs","client",id]` key desktop invalidates; (b) messages-tab resend (`useResendMessageTriggerJob()` without clientId) same gap and a resend creates a new log row; (c) the manual-send page invalidates nothing on success | `mobile/src/features/message-triggers/hooks/use-message-triggers.ts:325-338` (retry onSuccess client-key is clientId-conditional), `:425-440` (resend), `mobile/src/features/message-triggers/hooks/keys.ts:1-13` (no clientHistory family in `messageTriggerKeys`), `mobile/src/app/(shell)/messages/new/page.tsx:1503-1561` (sendMutation.onSuccess resets local state only); desktop baseline `frontend/src/features/message-triggers/hooks/use-message-triggers.ts:285-340`; realtime root `mobile/src/lib/realtime/entity-query-keys.ts:41` | `mobile/src/__integrity__/sms/message-trigger-invalidation.integrity.test.tsx::SI-SMS-08 *` (3 invariants + 3 knownDefects) | retry: `the client history view was not invalidated after the change: retry` · resend: `…: resend` · manual send: `the manual send did not invalidate the message views (clientHistory=false history=false upcoming=false, all invalidate calls=[])` |

UNTESTABLE residual (noted, not claimed as a defect): the reclaim sweep reads
`sentIds`/`uncertainIds` outside the per-job loop, so an attempt row that becomes
`accepted` between those reads and `markSent/markFailed` could mislabel a job.
There is no pause seam inside `reclaimStaleProcessingJobs` to force that
interleaving from the database, so it was not faked. Forcing it would need a
test hook between the reads and the loop in `message-trigger.service.ts:4571-4602`.

## Fix notes

- **SI-SMS-01** — Give the entity transitions a source-state guard (refuse
  transitions out of `sent`/`canceled` instead of silently applying), and in the
  token-less branch of `SbMessageTriggerJobRepository.update()` restrict the
  write to non-terminal source rows (e.g. an `updateMany` CAS on
  `status NOT IN ('sent','canceled')`, returning the current row on count 0 —
  the shape the token branch already has). Not SENSITIVE (application code only).
  Reviewer note: the audit found no live caller holding a claimToken-less stale
  entity over a terminal row; the claim-token fence plus status-predicated
  bulk cancels cover all swept paths — this is a latent persistence-layer hole.
- **SI-SMS-02** — Make rule deletion preserve job history: either refuse rule
  deletion while any non-pending job exists (extend the
  `deleteIfTargetMatchesAndFenceJobs` guard to old `sent` rows, and mirror it in
  the plain `deleteRule`/agent path), or archive job rows to an
  audit table before the delete. SENSITIVE: the smallest pure-SQL fix is a
  schema change (`message_trigger_job.rule_id` → `onDelete: Restrict` + app-side
  archive/cancel of pending jobs), i.e. `backend/prisma/schema.prisma` + a
  migration.
- **SI-SMS-06** — Add CHECK constraints enumerating the application vocabularies
  (`message_trigger_job.status`, `message_log.status`,
  `message_log.carrier_result_state`). SENSITIVE: requires a migration.
- **SI-SMS-08** — Mobile-only, no backend change: (a)+(b) invalidate the
  client-history family after retry/resend regardless of the optional clientId
  (the callers that do not know the client can invalidate the root
  `["messages","logs"]`, which the `messageTriggerKeys.all` family should also
  be able to reach — define the family in `keys.ts` like desktop's
  `clientHistory`); (c) the manual-send page's `sendMutation.onSuccess` should
  invalidate `["messages","logs"]` (draft-reset behaviour unchanged). Not
  SENSITIVE (frontend hook/page code only).

## Test totals

- Backend real-DB: 5 suites, 20 tests — all green with
  `STATE_INTEGRITY_REAL_DB=1` (6 knownDefects failing-as-expected, 14 invariants
  passing). Without the flag: 20 skipped (suite hermetic).
- Mobile: 1 suite, 6 tests — all green (3 invariants, 3 knownDefects
  failing-as-expected; failure messages captured above by running the
  `knownDefect` bodies as plain `it` once).

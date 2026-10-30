# FINDINGS — unit p2-contracts (state-integrity audit: CONTRACTS)

All paths relative to repo root. Tests live in `backend/test/integrity/contracts/`
and `frontend/src/__integrity__/contracts/`, `mobile/src/__integrity__/contracts/`.
Run: `STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test pnpm test test/integrity/contracts --runInBand`
(from `backend/`, own `DATABASE_URL`/`DIRECT_URL`).

Round-1 correction note: every reported defect is pinned by a test plus a
mutation proof (see "Mutation proofs" below); every async `expect(...).rejects`
in the area is awaited; the concurrency claims are forced by database locks
(`FOR UPDATE`, `pg_stat_activity` lock-wait detection), not by promise timers.

Round-2 correction: the stale detail race now proves the newer UPDATE is waiting
before starting the stale UPDATE (waiter counts 1 → 2 → release). The other
row-lock races assert order-independent outcomes: either claim may win, and the
claim/detail writes touch disjoint column sets. M-05 below supersedes the false
round-1 single-fence mutation claim. Desktop delete/finalization now run the real
hooks with a real QueryClient and HTTP-only mocks, not source-text greps.

| id | layer | verdict | severity proposal | one-line defect | evidence file:line | test file::test name | observed failure message |
|---|---|---|---|---|---|---|---|
| SI-CONTRACT-01 | backend | REFUTED | — | Webhook replay does not duplicate side effects: completion claim dedupes via `claimCompletionStatus` CAS, non-completion replays lose to the `updatedDate < sourceUpdatedDate` CAS, snapshot handling is re-entry safe | backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts:257 | contracts/webhook-replay-ordering.real-db.spec.ts :: SI-CONTRACT-01 (3 invariants) | — |
| SI-CONTRACT-02 | backend | REFUTED | — | Out-of-order events cannot downgrade a terminal status; the missing/non-numeric `updated_date` shape only skips `isWebhookCurrentEnough` and is still refused by the terminal fence + CAS downstream | backend/interface/controllers/eformsign-webhook.controller.ts:377, backend/application/usecases/eformsign-doc/update-eformsign-doc-status.usecase.ts:68 | contracts/webhook-replay-ordering.real-db.spec.ts :: SI-CONTRACT-02 (2 invariants) | — |
| SI-CONTRACT-03 | backend | REFUTED | — | The unfenced `syncEndDateFromContract` fallback is dead code on the production wiring: both call sites are `typeof fencedSync !== "function"` guards and the real `ServiceRecordLifecycleService` always exposes the fenced methods | backend/application/services/eformsign-webhook.service.ts:1138, backend/application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase.ts:183 | contracts/unfenced-end-date-fallback.real-db.spec.ts :: SI-CONTRACT-03 (1 invariant) | — |
| SI-CONTRACT-04 | backend | REFUTED | — | Completion-claim CAS holds under DB-proven interleaving: both competing claims wait behind a held row lock and exactly one claims, regardless of grant order; claim/detail writes both survive (disjoint column CAS sets); a newer detail UPDATE is proven waiting before starting the stale UPDATE, which is refused by its version CAS after release; a void between claim and side effects leaves no client link and moves no end date | backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts:257-330, backend/infrastructure/database/repositories/sb.eformsign-document-mirror.repository.ts:308-348 | contracts/completion-claim-void-race.real-db.spec.ts :: SI-CONTRACT-04 (4 invariants: "serialize on the row lock", "applies both writes", "refused by its own version CAS", void race) | — |
| SI-CONTRACT-05 | backend | REFUTED | — | Document job lifecycle holds: single row per requestKey/activeKey, `FOR UPDATE SKIP LOCKED` reclaim gives a fresh lease whose token rejects the old worker's terminal writes while the job is live with the new lease (not only across statuses), activeKey is released on terminal so a new job can be created, and a `claimDue` arriving while another transaction holds a queued row skips that row and takes a different one | backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:225-278, 638-644 (SKIP LOCKED), 701-715 (markCompleted), 942-966 (terminal) | contracts/document-job-lifecycle.real-db.spec.ts :: SI-CONTRACT-05 (5 invariants, incl. "a claimDue arriving while another transaction holds a queued row skips it") | — |
| SI-CONTRACT-06 | backend | REFUTED | — | Auto-finalize attempt accounting is coherent (one increment per failed auto_finalize job; activeKey released while budget remains, retained at exhaustion), the dispatch-intent state machine is at-most-once under a DB-shared read-before-write barrier (both claims observe `attemptCount` 0, exactly one UPDATE wins), and a crash between the provider finalize and the terminal write is recovered by `recoverStale` to `reconciling` with an orphan lease, keeps the active key and the attempt budget, and is reconciled by only a provider READ (no second provider call, no counter increment) | backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts:725-753 (recoverStale), 970-1002, backend/application/services/eformsign-document-job-reconciliation.service.ts:67-202, backend/prisma/migrations/20260829120000_add_eformsign_dispatch_intents/migration.sql | contracts/document-job-lifecycle.real-db.spec.ts :: SI-CONTRACT-06 (3), contracts/dispatch-intent-state-machine.real-db.spec.ts :: SI-CONTRACT-06 (6, all `rejects`/`resolves` awaited) | — |
| SI-CONTRACT-07 | db/backend | CONFIRMED | low | `eformsign_doc.status_type` has no DB CHECK, so the database accepts legacy aliases ("50", "doc_complete") on the column; the client read model itself normalizes all stored completed-alias forms consistently (documentStatus completed / hasSigned true — read-model half REFUTED), so the alias exposure is a storage hygiene issue whose real bite is SI-CONTRACT-09 | backend/prisma/schema.prisma:365, backend/application/services/client.service.ts:1873-1877, 2001 | contracts/status-alias-read-model.real-db.spec.ts :: SI-CONTRACT-07 "the database refuses a legacy alias value on the eformsign_doc.status_type column" (knownDefect) and ("read-model half, refuted") invariant | "SI-CONTRACT-07: the database accepted a legacy alias status_type ('50') on eformsign_doc — no CHECK constraint guards the column" |
| SI-CONTRACT-08 | frontend/mobile | CONFIRMED | low | `document` realtime roots omit clients on desktop/mobile; desktop delete and finalization hooks invalidate documents but leave a seeded clients-list query uninvalidated after successful HTTP. Severity: self-healing cache (refetch/remount restores server truth), not persistent data corruption. Link-confirmation refreshes clients (REFUTED sub-claim); register-client is excluded because `useCreateClient` already invalidates clients. Page-local re-request is UNTESTABLE in this hook suite (see scope note), not claimed confirmed. Mobile has no status-counts query, so that absent root is harmless | frontend/src/lib/realtime/entity-query-keys.ts:33-41, mobile/src/lib/realtime/entity-query-keys.ts:31-44, frontend/src/hooks/useEformsignDocuments.ts:101-159, frontend/src/hooks/useEformsignDocumentJobs.ts:114-140,158-170 | frontend/src/__integrity__/contracts/contract-state-refresh.test.tsx :: SI-CONTRACT-08 (it.failing ×3: realtime, "the delete hook invalidates the clients list that renders contract state", "the finalization hook invalidates the clients list that renders contract state"); mobile/src/__integrity__/contracts/contract-state-refresh.test.tsx :: SI-CONTRACT-08 (it.failing) | realtime: "SI-CONTRACT-08: the clients list query was NOT invalidated by a `document` entity-changed event (its contract badges went stale)"; delete: "SI-CONTRACT-08: delete succeeded but the clients list query was NOT invalidated"; finalization: "SI-CONTRACT-08: finalization succeeded but the clients list query was NOT invalidated"; mobile: same realtime wording |
| SI-CONTRACT-09 (extra) | backend | CONFIRMED | medium | A completed contract row stored as a legacy alias loses the webhook terminal-downgrade fence: `TERMINAL_STATUS_CODES.has(statusType)` only knows canonical padded codes, so a live-status webhook with a NEWER `updated_date` moves the completed row back to 060 (canonical "050" control refuses it). Severity is medium unless the production check below returns completed-alias rows (then high) — see the Fix notes scope guard | backend/application/usecases/eformsign-doc/update-eformsign-doc-status.usecase.ts:68, backend/domain/constants/eformsign-doc-status.constants.ts:140 | contracts/status-alias-read-model.real-db.spec.ts :: SI-CONTRACT-09 (knownDefect) and SI-CONTRACT-09 (control, canonical form) | "SI-CONTRACT-09: a completed alias row was downgraded to a live status (060) by the webhook status write" |

Sub-claims of the original hypotheses that came out REFUTED (recorded as invariants, part of the ids above):

- SI-CONTRACT-01: `handleServiceRecordSnapshotCompleted` re-entry — the duplicate completion path re-runs `completeServiceRecordSnapshotIfReady` and its status CAS refuses a second flip (invariant, same spec).
- SI-CONTRACT-08: `ContractLinkConfirmDialog.tsx` DOES invalidate `clientKeys.all` (i.e. `["clients"]`) on its success path — the dialog half of the hypothesis is refuted by `frontend/src/__integrity__/contracts/contract-state-refresh.test.tsx :: the link-confirmation dialog mutation invalidates the clients root that renders contract status (mutation half of the hypothesis is refuted)`.
- SI-CONTRACT-08 (mobile): a failed optimistic delete does NOT leave the list permanently wrong — `onSettled` invalidates `["eformsign-documents"]` on error too, so a mounted list query refetches the server truth and self-heals within one refetch window; while the refetch is pending the optimistic state is kept (no rollback) — `mobile/src/__integrity__/contracts/mobile-delete-settlement.test.tsx` (2 invariants).
- SI-CONTRACT-07 (read-model half): `documentStatus`/`hasSigned` normalize every stored completed alias consistently — invariant, spec above.

SI-CONTRACT-08 scope note: re-request is an inline `useMutation` inside the
non-exported contract detail component (`frontend/src/app/(protected)/contracts/page.tsx:1464-1497`),
not an exported hook. Its runtime client-refresh sub-claim is **UNTESTABLE in
this hook-only suite**: it needs a full page interaction fixture (contract list,
detail, auth/branch/calendar data and re-request dialog) with HTTP-only mocks,
or a separately authorized extraction of the actual mutation hook. No source
grep is retained as a substitute. Register-client is not a finding: the page's
`useCreateClient` already invalidates `clientKeys.all` (`use-clients.ts:327-335`).

## Fix notes

### SI-CONTRACT-07 (CONFIRMED, low — storage hygiene)
Smallest correct fix: canonicalize the stored codes on any write that touches `eformsign_doc.status_type` (normalize at the repository entry like the completed-alias fences already do) or add a normalization backfill + `CHECK` in a migration once aliases are gone. Either is enough alone; the check is the durable guarantee. **SENSITIVE** (requires `backend/prisma/schema.prisma`/migration for the CHECK variant; the CHECK behaviour itself is mutation-proven on the throwaway DB, see M-07 below).

### SI-CONTRACT-08 (CONFIRMED, low — self-healing cache)
Smallest correct fix: add `["clients"]` to the `document` roots in BOTH `frontend/src/lib/realtime/entity-query-keys.ts` and `mobile/src/lib/realtime/entity-query-keys.ts` (extend each map's existing tests). Add `clientKeys.all` invalidation to `useDeleteEformsignDocument`'s settlement and to the document-job invalidation used by `useEnqueueEformsignDocumentFinalization`. Do not change register-client or the already-correct link-confirmation path. Re-request needs runtime coverage before assigning its own verdict. Not SENSITIVE (frontend/mobile only).

### SI-CONTRACT-09 (CONFIRMED, medium — fence bypass on alias rows)
Smallest correct fix: normalize the stored status before the fence comparison in `UpdateEformsignDocStatusUsecase.executeWithOutcome` (e.g. `TERMINAL_STATUS_CODES.has(normalizeEformsignStatusCode(existing.statusType))` — `normalizeEformsignStatusCode` maps "50"→"050" and "doc_complete"→"003"), so the completed-alias row keeps the protection the canonical row has. No DDL required; by the time this lands, alias row hygiene via SI-CONTRACT-07 covers historical data. Not SENSITIVE (backend code only).

Scope guard recorded as agreed with the reviewer: the severity stays medium unless the production check below returns completed-alias rows (alias rows exist in old data) — the same check bounds whether SI-CONTRACT-07's backload becomes urgent:

```sql
SELECT status_type, count(*) FROM eformsign_doc WHERE status_type !~ '^[0-9]{3}$' GROUP BY 1;
```

Additional production-path evidence pinned here (same alias family as SI-CONTRACT-09):

- `POST /eformsign-docs` (`backend/interface/controllers/eformsign-doc.controller.ts:244` → `CreateEformsignDocLocalDto`, `backend/interface/dto/eformsign-doc.dto.ts:33-34`) stores `statusType` from the request body UNNORMALIZED: no canonicalization pass before the row insert, while all webhook/mirror writers normalize. The desktop UI sends padded codes ("060"), so the defect needs a caller sending an alias today plus legacy rows surviving without backfill.
- `claimCompletionStatus`'s claim predicate (`backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts:281-283`, `notIn: [params.statusType, ...DELETED...]`) also does not exclude alias forms of the target status: a completed row stored as an alias could in principle be re-claimed by a completion event whose `statusType` is the canonical padded form. Replay-safe in practice because the same event re-evaluation also requires `updatedDate < sourceUpdatedDate`, and the claim itself wrote that timestamp — but it belongs to the same normalization fix as above.

## Mutation proofs

Each id below: file:line mutated into the test's dependency, the change, and the observed red run. All mutations were reverted before committing (`git diff` over production trees is empty; `git status` clean).

- **M-01 / SI-CONTRACT-06 (reconcile fence)** — `backend/infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository.ts`: (a) both early not-delivered guards (`outcome === "not_delivered"` conditions of the ACCEPTED/RECONCILED_DELIVERED throw at ~:274-281 and the STARTED throw at ~:289-293) were changed to compare against a value that never matches, and (b) the `status: { notIn: [ACCEPTED, STARTED, RECONCILED_DELIVERED] }` predicate of the reconciliation `updateMany` (~:322-331) was perverted the same way — the whole "no not-delivered reconciliation of a live/accepted/reconciled intent" fence neutered at once. Observed: `dispatch-intent-state-machine.real-db.spec.ts` run → `Errors: 2 failed` — exactly the two repaired tests ("an uncertain attempt may be reconciled … but a started attempt may not", "an accepted intent is terminal …") went RED; the four untouched ones stayed green. (Round-1 note: with only the early guard at :290 removed the tests stayed green even awaited, because the post-UPDATE conflict paths (:347-368) re-throw for these shapes; the fence has two layers and both are pinned.)
- **M-02 / SI-CONTRACT-06 (claim CAS)** — same repository, `claim()`: `attemptCount: current.attemptCount` was removed from the `updateMany` WHERE (~:79), together with the status gate narrowed to `status: { in: [] }` (i.e. both guards of the single-winner claim neutered — with only `attemptCount` dropped, the STARTED status predicate is still a sufficient fence, which is itself why round-1's mutation stayed green). Observed: barrier test "two concurrent claims on separate connections win the attemptCount CAS exactly once" → RED (`Expected: 1 / Received: 0` — exactly one winner failed).
- **M-03 / SI-CONTRACT-05 (lease token)** — `backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts`: the `lease_token = ${leaseToken}::uuid` predicates of `markCompleted` (:712) and `terminal()` (:964) were replaced with `COALESCE(lease_token, <nil uuid>) IS NOT NULL` (true for every lease-bearing row). Observed: "an expired lease reclaimed by the recovery sweep …" → RED — the old-worker `markCompleted` succeeded against the new lease's row (asserted `null`, got the completed row).
- **M-04 / SI-CONTRACT-06 (recoverStale orphan lease)** — same repository, `recoverStale()`: the orphan-lease branch `ELSE gen_random_uuid()` (~:745) was changed to `ELSE NULL` (the recovered `reconciling` job loses its lease). Observed: crash-recovery invariant → RED — reconciliation reported `requires_attention` (missing job lease) instead of completing.
- **M-05 / SI-CONTRACT-04 (completion claim CAS, corrected and rerun round 2)** — `backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts:281-285`, `claimCompletionStatus` where-builder: drop the entire `statusType: { notIn: [...] }` clause **AND** change `updatedDate: { lt: sourceUpdatedDate }` to `lte`. Target: "two concurrent completion claims serialize on the row lock". Observed RED: `Expected: 1 / Received: 2` claimed results at test :178 (1 failed, 3 filtered out). Control mutations were run separately: dropping only `notIn` → GREEN (1 passed); changing only `lt` → `lte` with `notIn` retained → GREEN (1 passed). Either fence alone suffices for equal-timestamp replay; only removing both admits the loser. The previous round-1 single-fence red claim was false and is withdrawn. All source changes reverted exactly.
- **M-06 / SI-CONTRACT-05 (claimDue SKIP LOCKED)** — same job repository, `claimDue()` scan: `FOR UPDATE SKIP LOCKED` (:643) was changed to `FOR UPDATE`. Observed: "a claimDue arriving while another transaction holds a queued row skips it …" → RED — the claim waited on the held row lock instead of skipping it (test failure inside the bounded wait).
- **M-07 / SI-CONTRACT-07 (DB CHECK, rerun round 2)** — applied `ALTER TABLE eformsign_doc ADD CONSTRAINT si_integrity_mutation_status_check CHECK (status_type ~ '^[0-9]{3}$')` only on the throwaway DB. The repaired test now uses parameterized raw SQL and accepts only Prisma `P2010` with PostgreSQL `meta.code = '23514'` (CHECK violation), not any thrown error. Target "the database refuses a legacy alias" flipped RED: `Failing test passed even though it was supposed to fail` (1 failed, no wrong-reason diagnostic). Dropped the temporary constraint immediately; baseline knownDefect is green again.
- **M-08 / SI-CONTRACT-04 (ordered stale detail CAS)** — `backend/infrastructure/database/repositories/sb.eformsign-document-mirror.repository.ts:314-326`, removed the complete detail-version `OR` predicate from `saveDetail`. With the repaired 1-waiter → start stale → 2-waiter barrier, "a stale saveDetail queued behind a newer one" went RED at test :276: `Expected: false / Received: true` (1 failed, 3 filtered out). Reverted exactly; all five full real-DB runs below pass.
- **M-09 / SI-CONTRACT-08 (real delete/finalization hook refresh)** — added `queryClient.invalidateQueries({ queryKey: ["clients"] })` to `frontend/src/hooks/useEformsignDocuments.ts:155` (delete settlement) and `frontend/src/hooks/useEformsignDocumentJobs.ts:119` (job invalidation). The two hook knownDefects both flipped RED: `Failing test passed even though it was supposed to fail` (2 failed, 3 passed). Each test seeds `clientKeys.list(...)`, executes the real hook's `mutateAsync`, verifies the HTTP call and documents invalidation control, then checks the clients query's `isInvalidated` with an operation-specific expectedFailure. Both mutations reverted; 5/5 frontend tests pass.
- **M-10 / SI-CONTRACT-08 (dialog control with real client hook)** — removed the `clientKeys.all` and `clientKeys.detail(clientId)` invalidations from `frontend/src/components/app/clients/ContractLinkConfirmDialog.tsx:120-121`. The dialog control went RED: `Expected: true / Received: false` for clients invalidation. It now keeps the existing client values (no client-update HTTP call), so the real `useUpdateClient` cannot mask a broken adoption cleanup; only HTTP is mocked. Reverted exactly; frontend suite passes again.

## Round-2 verification

- Real PostgreSQL: three consecutive default-TZ runs, then `TZ=UTC`, then
  `TZ=Asia/Seoul`, each using the original real-DB command and own throwaway DB:
  **6 suites / 28 tests passed, 0 skipped in each of five runs**.
- Default backend invocation with `DATABASE_URL`, `DIRECT_URL`, and real-DB/vendor
  flags unset: exit 0, all 6 real-DB suites / 28 tests skipped as intended.
- Frontend Jest: 1 suite / 5 tests passed. Mobile Jest: 2 suites / 4 tests passed.
- Backend area ESLint, frontend test ESLint, and backend/frontend/mobile `tsc
  --noEmit`: passed (zero errors).
- Non-failing diagnostics: backend Jest reports delayed exit/open async work
  (each command exits 0 without forceExit); frontend/mobile report the existing
  Sentry import deprecation. No checks weakened or force-exit flags used.

## Round-3 QA calibration and order independence

- SI-CONTRACT-08 is **low** under the orchestrator's cross-area calibration:
  stale client views are a self-healing cache issue (refetch/remount restores
  server truth), not persistent data corruption. Evidence and verdict unchanged.
- Own database `bjj_si_contracts_throwaway`, migrations deployed; each real-DB
  run used `STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test` and
  `pnpm test test/integrity/contracts --runInBand --randomize --seed=<seed>
  --showSeed --cacheDirectory .jest-cache-contracts` from `backend/`:

  | timezone | seed | result |
  |---|---|---|
  | default | 314159 | 6 suites / 28 tests passed, 0 skipped |
  | default | 271828 | 6 suites / 28 tests passed, 0 skipped |
  | default | 161803 | 6 suites / 28 tests passed, 0 skipped |
  | UTC | 141421 | 6 suites / 28 tests passed, 0 skipped |
  | Asia/Seoul | 173205 | 6 suites / 28 tests passed, 0 skipped |

- No order-dependent failure surfaced; no tests added or repaired, so no new
  mutation proof was needed. Existing proofs remain unchanged.
- Original acceptance rerun: backend without database/real-DB/vendor exports
  exited 0 (6 suites / 28 tests skipped); frontend Jest 1 suite / 5 tests passed;
  mobile Jest 2 suites / 4 tests passed; backend area ESLint and all three
  backend/frontend/mobile TypeScript checks exited 0 with zero errors.
- Existing non-failing diagnostics remain: backend delayed-exit warning,
  client-read-model stub warnings, and Sentry import deprecation. No forceExit
  or weakened assertions/checks were used.
- Security scope check: documentation-only change; no application, schema,
  helper, dependency, auth or environment changes. Local env files are ignored.
  Own throwaway DB dropped (database-list check empty); Jest cache removed.

## Cleanups observed, not counted as defects
- The `typeof fencedSync !== "function"` fallbacks (webhook `persist` closure, reconciler `persist` closure) are dead on the production wiring (SI-CONTRACT-03): low cleanup, delete the unfenced branch when convenient.
- `eformsign_dispatch_intent` reconciliation CHECK cannot reject `status='reconciled_delivered'` with `reconciled_outcome=NULL`: SQL CHECK passes a NULL-valued predicate. No application writer can produce that shape (status+outcome are written atomically in one UPDATE), so this is DB hardening trivia, not an exploit; the same CHECK does reject an explicit contradiction (covered by the dispatch-intent spec).
- `eformsign_webhook_event` has no unique on `webhook_id` by design (delivery ledger, one row per delivery); both deliveries are recorded while the side-effect dedupe lives in `claimCompletionStatus` — verified, no fix needed.

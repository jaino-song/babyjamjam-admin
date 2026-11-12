# ADR-005: Durable eformsign document jobs

## Status

Accepted

## Date

2026-08-13

## Context

Creating and finalizing an eformsign document can outlive the HTTP request that
started it. Browser automation can also return an ambiguous outcome: the vendor
may have accepted a send even when the local click or response was interrupted.
Keeping this state only in process memory makes retries unsafe, loses progress
after a restart, and can duplicate a provider operation.

The existing `eformsign_doc` table is the provider-document mirror. It is not a
job queue: a create operation does not have a provider document identity yet, and
provider identity can arrive before the mirror row is reconciled. A separate
durable table is therefore required.

## Decision

1. Add `eformsign_document_job` as an additive, branch-scoped durable job table.
   `request_key` is the idempotency key for the requested operation. `active_key`
   is nullable so a completed or terminal job can release its active claim while
   retaining its request history. The database enforces request uniqueness and
   active-key uniqueness. PostgreSQL unique indexes permit multiple null values,
   so terminal jobs can release the key without a Prisma/SQL drift mismatch.
2. Store `job_type`, `source`, and `status` as constrained strings. The allowed
   values are intentionally enforced by PostgreSQL CHECK constraints so all
   writers, including repair scripts, share the same state vocabulary.
3. Claiming is atomic in PostgreSQL. A worker selects eligible rows with a
   transaction-safe row lock (`FOR UPDATE SKIP LOCKED`) and changes the status,
   attempt count, and heartbeat in the same transaction. A worker never relies
   on an in-memory lock or an application-side check-then-update sequence.
4. The headless provider dispatcher retains its global maximum of three active
   browser operations. Durable rows provide recovery and reconciliation; they do
   not increase the provider concurrency limit.
5. `payload` contains only the minimum sanitized input needed to resume the
   operation. Credentials, cookies, access tokens, raw provider responses, and
   personal data not required to resume are never persisted. After a job reaches
   a terminal outcome or no longer needs its request body, the worker clears the
   payload while retaining the SHA-256 `payload_fingerprint`, progress marker,
   and sanitized machine `last_error_code` for audit and deduplication.
6. `document_id` is an optional provider identity string, deliberately without a
   foreign key to `eformsign_doc`: create jobs begin before a provider identity
   exists, and reconciliation may observe the provider before the local mirror
   row is written. `client_id` remains an optional foreign key with `SET NULL`.
7. The schema and SQL patch add no dependencies, queues, extensions, or live
   database changes. The database-patches workflow applies and verifies the
   patch independently in dev, preview, and production.
8. Unresolved `requires_attention` rows are retained and keep their active key
   so a staff or scheduler retry cannot duplicate an ambiguous provider send.
   The branch list is bounded to the newest 50 rows. A future authorized
   reconciliation operation may resolve them; they are not auto-deleted.

## Consequences

### Positive

- Restarts, deploys, and worker crashes preserve enough state to resume or
  reconcile without blindly retrying an ambiguous provider send.
- PostgreSQL provides the idempotency and claim boundaries shared by all worker
  replicas.
- The existing three-browser global cap remains explicit and unchanged.
- Payload minimization and clearing reduce the retention of provider credentials
  and unnecessary personal data.

### Negative

- Workers must implement heartbeat/stale-claim recovery and explicit terminal
  transitions.
- Operational queries and retention jobs must account for an additional table.
- Prisma cannot model CHECK constraints; the SQL migration and verification
  script are authoritative for those value invariants.

## Risks and rollback

- Apply the additive migration before deploying code that creates or claims jobs.
- Verification fails closed when any required column, foreign key, CHECK
  constraint, or index is absent.
- No destructive down migration is provided. Leave the additive tables and
  authority fences in place during application rollback. Removing them requires
  a separately approved retention and data-disposition decision.
- After `20261111120000_add_eformsign_contract_authority`, an unmodified
  pre-authority application build is **not a supported rollback target**. Its
  terminal-job retention DELETE ignores authority references and fails with
  PostgreSQL `23503` as soon as a referenced job passes the seven-day cutoff,
  including jobs whose authority is already `closed`. The statement aborts for
  all terminal jobs; the application continues running but retention stops.
- Prepare and verify an authority-aware rollback build before promotion. It must
  retain the `NOT EXISTS` authority exclusion in `deleteExpiredTerminal` and
  purge payloads for expired, generation-bound `failed` jobs as well as
  `requires_attention` jobs. Otherwise failed contract payloads can outlive the
  seven-day bound. Also preserve generation fencing and the compatible recovery
  endpoints while generation-bound jobs remain. Keep the authority table and its
  foreign keys; deleting or cascading authority rows to bypass the error can
  remove duplicate-send protection.
- Rollback verification must use a disposable database with the migration
  applied and both `closed` and unresolved authority rows referencing expired
  terminal jobs. Run the rollback build's retention sweep: it must preserve
  referenced jobs and authorities, delete eligible unreferenced terminal jobs,
  and clear expired recoverable payloads. Record the verified rollback commit
  and immutable deployment identity with the release. No such rollback target
  has been verified by this ADR; until it is, use a forward correction rather
  than an unmodified pre-authority build.

## Production activation

The queue is intentionally fail-closed and must be enabled in dependency order:

1. Confirm the additive migration and production's single scheduler ownership.
2. Enable `EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED=true` and verify worker health.
3. Enable `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED=true` so new jobs can be
   accepted only after a worker is ready to drain them.
4. For contract auto-finalization, enable `CONTRACT_AUTO_FINALIZE_ENABLED=true`
   with a valid `CONTRACT_AUTO_FINALIZE_SINCE=YYYY-MM-DD` backlog fence.

Contract creation (including re-issue) and staff finalization always enqueue.
A running worker is required in every environment where accepting is enabled.

Rollback stops intake first: set `EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED=false`.
Creation fails closed with HTTP 503: the form shows the error and stays open
with its input preserved. There is no manual iframe entry (the browser
document-generation routes are retired); once intake is back, staff send again
from the form, or recover a failed job from the jobs list. Transport failures and
gateway timeouts show an "outcome unknown" message pointing at the jobs list,
because a job may already have been accepted.
Keep the worker enabled until already accepted jobs reach a terminal state, then
disable it. Preview's global scheduler remains disabled, so it is not a valid
worker-drain environment.

## Amendment 2026-10-22: failed staff job payload retention

Contract creation and finalization always run as background jobs, so staff must
be able to finish a stuck job by hand in the eformsign iframe, prefilled with the
data they submitted. This amendment changes what a terminal staff job keeps. No
status, column or migration is added.

A *contract job* is a `source = 'staff'` `create_document` or `finalize_document`
row whose `request_key` does not start with `service-record-` and whose payload
has no `kind` key. Service-record revision jobs share the table but are not
contract jobs and keep their existing rules unchanged.

- A contract job's payload is retained when it becomes `failed` or
  `requires_attention` directly from `processing`. Every other source and job type
  still clears the payload at a terminal transition, and `active_key` handling is
  unchanged.
- A job that entered `reconciling` (or was recovered stale past `preparing`)
  already had its payload cleared, so it stays NULL. Recovery for those rows
  returns `payload: null`; they are exactly the cases where a send may have
  happened.
- `failed` is reached only before anything was sent, so staff may send the
  contract by hand (`manual_send`). `requires_attention` may follow a send, so
  staff verify the result instead (`verify_result`); the system never offers an
  automatic resend there. The split is by status only, not by error code.
- Taking a manual claim overwrites `progress_step` with
  `manual_in_progress:<userId>:<expiryEpochMs>` (10-minute expiry, renewable by the
  same user, takeable by another user once expired). `last_error_code` is not
  touched and remains the audit record of the original failure.
- Resolving a job by hand sets `status = 'completed'`,
  `progress_step = 'manual_resolved'`, `completed_at`, and clears `payload`,
  `active_key`, `heartbeat_at` and `lease_token`; `last_error_code` is kept. A
  `manual_resolved` row is an ordinary `completed` row, so the existing terminal
  retention deletes it 7 days later. Resolving twice is a success.
- `failed` rows are deleted 7 days after `completed_at` by the existing terminal
  retention, which also bounds how long their retained payload lives.
  `requires_attention` rows are never deleted, so their payload is nulled 7 days
  after `completed_at` by a separate purge. The purge keeps `active_key`: a
  `requires_attention` job may already have sent the document, and releasing the
  key could let a duplicate through.

## Proposed addendum: document job display layer (2026-11-04)

Status: Proposed. The accepted durable queue and recovery decisions above remain
in force. Add `documentKind`, `displayOperation`, and nullable `failureReasonCode`
as a safe read projection; the partial [OpenAPI schema addendum](../api/document-jobs-display-projection.openapi.json)
documents only these three fields. Frontend fields are optional for older servers.

Classify existing staff contract create/finalize payloads and the scheduler's
finalize payload as contract generate/review. The sole current record producer,
`service_record_revision` with `INITIAL_FINALIZATION`, is record generate even
when `manualReviewRequired` is true; record review has no current producer.
After payload clearing, preserve staff contract labels using the unchanged
`isContractJob` predicate, and scheduler review labels only for an exact
`auto_finalize:<authoritative documentId>:<valid KST calendar date>` key. This
also preserves labels after legacy cancellation. Unknown kinds, generations,
producers and null service-record keys remain unknown.

The new `failureReasonCode` uses six exact public stable codes only in failed/attention
states; unknown strings and stale normal-state errors project to null. The
record manual-review code is `SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED`,
matching the [worker guard's existing source literal](../../backend/application/services/eformsign-document-job-worker.service.ts), without an alias. Keep existing
fields, manual-claim masking, and `recoveryKind`/`classifyRecovery` as the sole
recovery authority; auto-finalize labels grant no recovery. Do not expose raw
payloads, request keys, templates, tokens or contacts in the list projection.

The planned desktop modal shares the notification shell. Its actual manual
recovery iframe is absent at this phase. Phase 6 remains gated on binding the
guard/bootstrap/API contract (or a reviewed plan amendment with backend paths).
Existing browser credential and document-generation endpoints remain fail-closed
with HTTP 410; the active recovery/resolve endpoints retain their existing
authorization and claim behavior.

### Authority closure amendment (A, R4)

The hold is released by evidence of no creation, or by confirmed handoff of the
same document. An unknown provider outcome never authorizes another create. All
admissions serialize on client → authority → current job → sorted intent refs →
mirror. The automatic intent retains its business generation; draft/human intents
use the authority generation and fingerprint. Their immutable identity and exact
attempt/status/document are checked before CAS writes.

- Exact request-key replay precedes every mutation. A terminal, lease-free
  creation_pending/creation_uncertain job can be replaced when **every** linked
  create/draft has durable no-effect proof, no human/candidate exists, and no live
  manual claim remains. Prepared attempt zero is safe; a later prepared attempt
  needs the explicit before-open release record. Reconciled not-delivered needs
  its time, actor, outcome and null provider document. A matching active key alone
  remains an unchanged existing-job response. Eligible retirement clears the old
  key before INSERT, preserves intent history and the error audit, marks the job
  superseded, and rotates in the same transaction. An INSERT conflict after any
  retirement/normalization throws and rolls the entire operation back.
- A terminal failed/requires_attention job can leave an exact linked create or
  draft STARTED after a crash. `open` deliberately uses **two sequential,
  non-nested transactions**: the first commits STARTED → UNCERTAIN and, only if
  needed, phase → creation_uncertain; the second reloads and takes the claim.
  The first requires no lease, no candidate/human/effect, an eligible phase and
  no live claim by **any** user, including the same user. Both refs are evaluated;
  any failed intent/phase CAS rolls that first transaction back. It changes no
  job, key, payload, attempt, ref or claim field. A later 410 payload_expired in
  the second transaction cannot undo the first commit. A crashed draft must wait
  for the existing ten-minute live claim to expire. Worker-owned
  `markAutomaticUncertain` also repairs the exact create under its valid lease,
  including when the phase is already uncertain. The worker send path is unchanged.
- Only after provider-console investigation can an authorized operator record
  `not_delivered` or `delivered` using the existing branch-scoped GET
  `/eformsign-docs/dispatch-intents/:intentId` and POST `:intentId/reconcile`.
  Start from the job UUID displayed by the UI and its branch; read only the
  authority selected by `creation_job_id` plus `branch_id`, then obtain its
  `creation_intent_id`/`draft_intent_id`. Read that intent through GET before
  reconciling its exact attempt with actor and reason. Do not dump contact
  payloads or expose default aggregate intent-ID reports. Uncertain alone keeps
  the fence; confirmed absence enables the no-effect replacement above. A
  positively identified delivered draft uses that same document, never a new one.
- Seven-day contact retention is unchanged. Current, non-closed authority-bound
  **failed** contract jobs remain in requiresAttention and unresolvedCount even
  after seven days. Closed/superseded/noncurrent failed history retains its
  existing cutoff. `failedCount` still measures only seven-day failed history,
  so it can be lower than unresolvedCount. Existing LIMIT 50 competition remains.
- A retained exact candidate can be read after payload expiry/purge using only
  authority → immutable intent → nonpurged contract mirror ownership and the
  configured server company/creator. A mirror not yet attached to the client
  must be bound to that exact authority document; completion remains the point
  that attaches the mirror and moves the client pointer. There is no contact
  restoration, contractData option generation, draft creation or editor exposure
  in this verification-only path. Frozen identity/workflow, when still retained,
  must match. A configuration change fails closed until the operator restores
  compatible configuration and validates the same document. A remaining draft
  is finished **in the vendor console on that same document**, then verified.
  Unknown, deleted/voided, missing, foreign or otherwise unprovable evidence
  remains a deliberate integrity refusal pending investigation.
- Provider handoff is proved by an exactly matched workflow seq/group/type:
  participant 05 with 060–064, reviewer 06 with 070–074, or complete 01 with 003.
  These states prove creation was handed off, not that all signatures completed.
  Creator draft 001/00, creator-only 002 and unknown combinations are not proof.
  An expiry flag cannot promote a draft to sent; a known handed-off state remains
  handoff proof even after expiry, preserving the mirror's expiry flag and
  downstream void/purge/finalize boundaries.
- Historical verified + completed records normalize at enqueue **before** the
  unresolved-create check, and at provider/legacy admission. Proof requires the
  exact job/generation/fingerprint/completion time, no lease/key, matching
  authority/job/current pointer, fully client-bound contract mirror and all
  linked immutable intents. Current mirror status is only a safety veto:
  draft/creator-write, void/purge, corruption and service-record binding refuse;
  later 064, 061 or 080 do not erase the original atomic handoff proof. Exact
  linked STARTED/UNCERTAIN effects settle with the persisted verified claim actor
  and a historical-completion reason, inside the caller transaction. No actor or
  no integrity proof means no release. Unrelated uncertainty still blocks and
  rolls back enqueue normalization. There is no bulk rewrite or separate journal.
- Fresh and post-TTL completion settle only matching effects, close authority,
  bind mirror, move pointer and finish the job atomically. A recovered delivered
  draft is sufficient without a human intent. No-effect predecessors remain
  immutable history. Post-TTL completion preserves stored mirror customer fields
  and leaves payload NULL. Closed/completed same-generation reopen and repeated
  verification are idempotent; rotation makes old claims/workers stale.

Verification boundaries: unit fixtures test the full predicates and transaction
rollback, including Prisma IS NULL matching. The owned PostgreSQL suite defines
real two-transaction persistence after 410, an inter-transaction claim takeover,
insert-conflict rollback, list/count membership, and lock-observed races in both
orders. These PG cases require the existing owned CI harness and are intentionally
skipped in a unit-only worker session; passing fixtures do not certify PG behavior.
Independent CODE review and package-wide release gates belong to Main.

Carried limitations: operator reconciliation can still record delivered over an
older not-delivered result without authority locks; superseded terminal history
keeps its existing retention policy; LIMIT 50 can crowd recovery entries. The
pre-existing assumption that an automatic provider HTTP attempt is bounded below
the stale-lease interval is unproven here and the worker transport is unchanged.
Historical rows missing their verified actor remain held. Irretrievably missing
provider/configuration evidence has no forced unlock or fabricated successful exit.

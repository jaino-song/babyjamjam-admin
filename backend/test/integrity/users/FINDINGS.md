# State-integrity findings — area `users` (user accounts)

Worktree branch `si/p2-users`, base `fix/state-integrity` @ `61e6e8c8c` (review-round-1 candidate `87bdeab38`).
All real-DB specs ran against `postgresql://postgres@localhost:5432/bjj_si_users_throwaway`
with `STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test` (suite green, 5 suites / 16 tests;
2 of them are `knownDefect` expected-failures). Client suites: frontend 5 tests, mobile 5 tests —
the branch-switch and staleTime contracts are now behavioural (real page render / real hook against a
real QueryClient), not source greps.
No fixes were made; all CONFIRMED defects are left as failing invariants behind `knownDefect`/`it.failing`.

Review-round-1 dispositions: SI-USER-01 and the rejected→approved half of SI-USER-02 are
NEEDS-PRODUCT-DECISION (evidence that reject-from-approved is intended: commit `c31ed52f2` added
membership/ownership removal on reject, which only matters for approved users; the audit event records
the prior status; `test/services/user.service.spec.ts:1753+` rejects an approved owner-of-branch manager
on purpose; the UI only offers reject/approve for pending users) — the tests are kept as `invariant`s
pinning today's reachable behaviour and carry no severity. The audit-trail half of SI-USER-02 was split
into CONFIRMED SI-USER-10. Review evidence found a missed critical product defect in `approve`, filed as
CONFIRMED SI-USER-09.

## CONFIRMED defects (wrong behaviour reachable today)

| id | layer | verdict | severity proposal | one-line defect | evidence file:line | test file::test name | observed failure message (CONFIRMED only) |
|---|---|---|---|---|---|---|---|
| SI-USER-09 | backend | CONFIRMED | critical | `UserService.approve` never reads the target before writing and enforces neither of the two guards `reject` enforces: approving an OWNER target demotes the owner, approving the CALLER'S OWN account self-demotes; two calls drive the owner count to 0, bypassing the `deleteGlobalUser` last-owner guard without deleting a row (권한-02) | backend/application/services/user.service.ts:1108-1245 — target write at 1157 has no owner-target/self guard; compare reject's self guard at 1279 and owner guard at 1292 | backend/test/integrity/users/user-approval-state-machine.real-db.spec.ts :: `SI-USER-09 approve refuses an owner target and the caller's own account, and the owner count never reaches zero` | `SI-USER-09: approval authorization invariant violated: owner-target approval succeeded; ownerB role became 'user'; self approval succeeded; ownerA role became 'manager'; owner count went 2 -> 0` |
| SI-USER-10 | backend | CONFIRMED | medium | The approval audit's `before` payload hardcodes the fresh-sign-up state `{ role: null, approvalStatus: "pending" }` (`user.service.ts:1234`), so every non-pending approval transition is recorded with a `before.approvalStatus` that misdescribes the transition (the audit trail is the accountability record for 권한 changes) | backend/application/services/user.service.ts:1234 (hardcoded literal; the transaction never reads the prior state) | backend/test/integrity/users/user-approval-state-machine.real-db.spec.ts :: `SI-USER-10 the approval audit's before.approvalStatus records the real prior status of the target` | `SI-USER-10: the user.approved audit event's before.approvalStatus is 'pending' (before.role 'null') but the target's real pre-transition state was approvalStatus='rejected', role=null — the before payload is hardcoded to the fresh-sign-up state, so the audit trail misdescribes non-pending approval transitions` |
| SI-USER-08 | frontend/mobile | CONFIRMED | medium | A 403 caused by a server-side role change triggers no authority reset and no re-fetch of the cached auth user; `useGetAuthUser` serves the stale identity from a 30-minute staleTime (now proven behaviourally on both shells), so the UI keeps showing pre-demotion (branch)admin capabilities until the next 401 or manual refetch | frontend/src/lib/api/client.ts:293-317 — only 401 is special-cased (refresh at 222-314, `redirectToLoginOnce` 166-175), 403 falls to the catch-all `captureApiError + reject`; mobile/src/lib/api/authenticated-fetch.ts:6-8/21-37 (`requiresApplicationSessionRefresh` only for 401); the reset exists and works — proven by behaviour on the branch-switch flow: desktop cleared the shared cache before `setCurrentBranch` ran (frontend/src/app/(protected)/select-branch/page.tsx:103-113) and mobile likewise (mobile/src/app/(shell)/select-branch/page.tsx:53-60,122) | CONFIRMED half: frontend/src/__integrity__/users/desktop-authority.client-integrity.test.ts :: `SI-USER-08 a 403 caused by a server-side role change re-fetches the cached authority` (`it.failing`) and mobile/src/__integrity__/users/mobile-session.client-integrity.test.ts :: same-title mirror. The reset/branch-switch contracts are now BEHAVIOURAL green invariants: frontend/src/__integrity__/users/desktop-branch-switch.client-integrity.test.tsx and mobile/src/__integrity__/users/mobile-branch-switch.client-integrity.test.tsx (real page renders against the real shared QueryClient, asserting the cache is cleared BEFORE `setCurrentBranch` — including on a FAILED switch — plus real 30-minute staleTime behaviour of `useGetAuthUser` on both shells). The desktop/mobile 401 halves remain green `invariant`s in the authority/session files | desktop: `SI-USER-08: a 403 ACCESS_DENIED on a protected API left the cached authUser query intact (isInvalidated=false, data still present) — the interceptor triggers no authority re-fetch/reset on 403 …`; mobile: `SI-USER-08: a 403 ACCESS_DENIED on a protected mobile API left the cached authUser query intact (isInvalidated=false, data still present) — authenticatedFetch triggers no authority re-fetch/reset on 403` |

## NEEDS-PRODUCT-DECISION (behaviour reachable today, intent unresolved — pinned as reachable-today invariants, no severity)

| id | layer | verdict | one-line statement | evidence file:line | test file::test name |
|---|---|---|---|---|---|
| SI-USER-01 | backend | NEEDS-PRODUCT-DECISION | `UserService.reject` has no precondition on the target's current `approvalStatus`: rejecting an APPROVED user succeeds and strips memberships, branch ownership and live sessions in one call. Reachable today; the product decision is whether the state machine adds a precondition (`reject` only from `pending`) or a separate explicit deactivate path — review evidence supports intent (commit `c31ed52f2`; audit prior-status payload; user.service.spec.ts:1753+) | backend/application/services/user.service.ts:1275-1361 (target read 1285-1291 never checks status; destructive writes 1325-1350) | backend/test/integrity/users/user-approval-state-machine.real-db.spec.ts :: `SI-USER-01 rejecting an already-APPROVED account strips memberships and sessions — is reachable today (NEEDS-PRODUCT-DECISION)` |
| SI-USER-02 | backend | NEEDS-PRODUCT-DECISION | `UserService.approve` has no check that the target is pending: approving a REJECTED user resurrects the account and re-grants the role. Reachable today; the rejected→approved half looks intended (same evidence as SI-USER-01) but the UI only offers approve for pending users, so the product decision stands; note the same missing precondition also enables the SI-USER-09 owner/self demotion | backend/application/services/user.service.ts:1108-1245 (target is never status-checked before `tx.user.update` 1157); controller allows it from approved/rejected states too (backend/interface/controllers/user.controller.ts:181-201) | backend/test/integrity/users/user-approval-state-machine.real-db.spec.ts :: `SI-USER-02 approving a REJECTED account resurrects it and re-grants the role — is reachable today (NEEDS-PRODUCT-DECISION)` |

## Hypotheses REFUTED (the guard exists today; kept as green `invariant` tests on the real DB)

| id | layer | verdict | evidence file:line | test file::test name |
|---|---|---|---|---|
| SI-USER-03 | backend | REFUTED — the stated invariant holds | backend/application/services/system-admin.service.ts:163-274 (deactivation: no session revocation/tokenVersion bump — the residual is by design survivable); backend/infrastructure/tenant/tenant.guard.ts:34-51 (owner: inactive branch refused, with an ALLOWING control proving the same identity is accepted before deactivation), 62-92 (member: inactive-branch membership refused per request); backend/application/services/auth-session.service.ts:623-663 (`resolveFreshBranchPrincipal` drops the inactive branch on refresh: branch claims omitted, `selected_branch_id` nulled); backend/infrastructure/auth/jwt.strategy.ts:83-94 (`selected_branch_id` vs token `branchId` — a pre-deactivation branch token dies at the next request after refresh) | backend/test/integrity/users/branch-session-invalidation.real-db.spec.ts :: `SI-USER-03 after branch deactivation the next request with an existing token is refused and refresh drops the branch` |
| SI-USER-04 | backend | REFUTED — the stated invariant holds | backend/infrastructure/auth/jwt.strategy.ts:100-106 (fresh DB role, never the token role); backend/infrastructure/tenant/tenant.guard.ts:62-92 (fresh membership role onto the request principal); backend/application/services/system-admin.service.ts:217-246 (demotion writes); demoted owner's authority is re-read inside the write transaction: backend/application/services/user.service.ts:774-799 (rank 0 → 403) | backend/test/integrity/users/branch-session-invalidation.real-db.spec.ts :: `SI-USER-04 a demoted branch owner's existing token is evaluated with the fresh roles on the next request` |
| SI-USER-05 | backend | REFUTED — the stated invariants hold | backend/prisma/schema.prisma:914 (`@@unique([sessionId, activeMarker])`); backend/application/services/auth-session.service.ts:698-709 (`lockSession` FOR UPDATE serializes rotations), 188-229 (single conditional consume via `updateMany usedAt/revokedAt null`), 665-680 (grace → `AUTH_REFRESH_REPLAY_CONCURRENT` without family revocation; past grace → family revocation `refresh_token_reuse`) | backend/test/integrity/users/refresh-rotation.real-db.spec.ts :: (1) `SI-USER-05 a session holds at most one active refresh token (session_active_key unique index)`; (2) `SI-USER-05 two rotations racing on the same token yield exactly one winner and no family revocation (forced interleaving)` — winner paused mid-transaction, loser proven queued on the session lock via `pg_stat_activity` (BOTH waiters counted), FIFO grant by a priming lock: one success + one `AUTH_REFRESH_REPLAY_CONCURRENT`, family intact; (3) `SI-USER-05 reuse after the concurrency grace revokes the whole session family` (`usedAt` backdated 10s, no real time passing) |
| SI-USER-06 | backend | REFUTED — the stated invariants hold | backend/application/services/user.service.ts:940-1001 (`deleteBranchMembership` revokes ALL live sessions of the user with `membership_deleted` — stronger than need be), 878-938 (`deleteGlobalUser`: owner target requires an independent actor, locks EVERY owner row in sorted order — the serialization point the race proves — and refuses with the LAST-owner 409 in a serial one-owner world) | backend/test/integrity/users/membership-removal.real-db.spec.ts :: (1) `SI-USER-06 removing a branch membership revokes the sessions whose selected branch it was` (session row revoked, jwt.strategy 401, refresh `AUTH_SESSION_REVOKED`); (2) `SI-USER-06 concurrent deletion of both owners can never leave zero owners (forced interleaving, exactly two owners)` — world isolated to exactly 2 owners first, both deletes proven queued on the priming lock (waiter COUNT ≥2), winner paused holding both locks; the loser resumes on its FOR UPDATE of the just-deleted row and is rejected by the documented serialization abort (SQLSTATE 40001 "could not serialize access"), world owner count = 1 after; (3) `SI-USER-06 after one owner delete succeeds, deleting the now-last owner is refused with 409 REQUEST_CONFLICT (serial guard)` — the 409 guard itself, proven in a serial one-owner world |
| SI-USER-07 | backend | REFUTED — the stated invariants hold | backend/infrastructure/database/repositories/sb.auth-token.repository.ts:50-67 (`consumeWithinTx`: single conditional `updateMany usedAt: null` → `count === 1`); backend/prisma/schema.prisma:1026-1042 (`auth_flow_state` has no FK on `user_id` — orphan possible, confirmed orphan row survives deletion); backend/application/services/auth.service.ts:593-635 (consumption atomic), 745-755 (`exchangeCodeForTokens` MINTS a further `pending_account_onboarding` state for a deleted user's id from an orphaned `*_exchange` state — graded NOT harmful, see below), 793-815 (`getPendingAccountOnboarding` re-reads the user and 401s when deleted) | backend/test/integrity/users/auth-token-consumption.real-db.spec.ts :: (1) `SI-USER-07 concurrent consumption of one auth_token yields exactly one winner (forced interleaving)` (priming lock + `pg_stat_activity` waiter count): winner consumes and wins, challenger loses per-request after the winner's commit; (2) `SI-USER-07 an unconsumed flow state of a deleted user cannot complete its login flow` (orphan state confirmed to survive, denied `AUTH_REQUIRED`, left unconsumed); (3) `SI-USER-07 an orphaned *_exchange code lets exchangeCodeForTokens mint an onboarding state for the deleted user, but its token cannot complete onboarding` (mint happens, `getPendingAccountOnboarding` refuses `AUTH_REQUIRED`, minted state left unconsumed) |

## Fix notes

### SI-USER-09 (critical) — SENSITIVE (auth/approval core logic)
Smallest correct fix: give `approve` the same guards `reject` already has, read BEFORE the write —
inside the `approve` transaction and before `tx.user.update`:
1. owner-target guard: read the target (`tx.user.findUnique`); if `target.role === "owner"`,
   refuse (403 `ACCESS_DENIED`, same shape as `reject`'s `ownerRejectionProblem()`; "오너 계정은 이 경로로 승인/역할을 바꿀 수 없어요.").
2. self guard: if `params.actor?.userId === id` (or the resolved actor), refuse (403 `ACCESS_DENIED`, mirror of `selfRejectionProblem()`).
No schema change; the write itself stays untouched otherwise. Flagged SENSITIVE because it changes the
approval authorization path (audit-id: `approve` is an authz core decision point). Rollback: remove the
two guards (single hunk before `tx.user.update`). Fixing SI-USER-10's before-payload read (below) naturally
provides the target read this fix needs.

### SI-USER-10 (medium) — SENSITIVE (approval audit trail inside the auth/approval path)
Smallest correct fix: in `approve`, read the target's CURRENT state before `tx.user.update`
(`tx.user.findUnique({ select: { role: true, approvalStatus: true } })`) and write the audit
`before: { id, role: prior?.role ?? null, approvalStatus: prior?.approvalStatus ?? "pending" }`
instead of the hardcoded literal at `backend/application/services/user.service.ts:1234`. No schema change.
Flagged SENSITIVE (inside the approval path; the audit feeds authority review). Rollback: single hunk revert.

### SI-USER-08 (medium) — not SENSITIVE (no schema/deps/approval-core changes)
Smallest correct fix: invalidate the cached authority when a protected call is refused because of an
identity change, in both shells:
- Desktop: in `frontend/src/lib/api/client.ts`'s response interceptor, reject-with-reset for a 403 that
  carries `code: "ACCESS_DENIED"` (Problem-contract body, like `isAppAuthRequiredError`): acquire the
  shared `getQueryClient()` (or route through `resetAuthorityState`), then clear/invalidate
  `AUTH_USER_QUERY_KEY` so the next render re-fetches `/auth/me`; keep the error propagating to the
  caller. Avoid the `window.location.href` login redirect for a 403 (the session is still valid).
- Mobile: same in `mobile/src/lib/api/authenticated-fetch.ts`/`session-refresh.ts` — on 403,
  `getQueryClient().clear()`/invalidate `AUTH_USER_QUERY_KEY`.
Server-side refusal stays authoritative either way; this only shrinks the stale-UI window from ≤30 min to
one refetch. The branch-switch tests prove the exact reset mechanism to reuse.

### SI-USER-01 / SI-USER-02 — NEEDS-PRODUCT-DECISION (no fix prescribed)
No fix here until the product decision: either (a) keep both writes as the intended "offboard / resurrect"
flows (then they need explicit naming + audit labels, and `approve`'s owner/self guards from SI-USER-09
stay the only authorization gap), or (b) add the pending-only preconditions (single-hunk, same shape as
the proof mutations below). The reachable-today invariants must be flipped deliberately with that decision.

### Residual observations (not defects, no ids)
- In the FORCED two-owner interleaving, the losing owner delete is rejected by the Serializable
  FOR UPDATE serialization abort (raw SQLSTATE 40001 at `lockRow`) because the winner deletes the
  sorted-first locked row before the loser's pending lock resolves; the explicit 409 guard is what
  protects the SERIAL one-owner world. `runSerializableTransaction` retries only `P2034`, so raw-query
  40001s surface as an internal error instead of the graceful 409. It fails CLOSED (no row touched,
  exactly one owner remains), so it is not an integrity breach — a robustness fix would extend
  `isPrismaTransactionWriteConflict` to also match raw 40001s so the loser reports a clean 409 either way.
- After branch deactivation the member/owner sessions remain alive and refreshable (branchless). This is
  coherent because the user may legitimately hold other branches, and every branch-claim is re-derived per
  request; noted for future "deactivate + force branch re-selection" UX decisions.
- `exchangeCodeForTokens` minting an onboarding state for a deleted user (auth.service.ts:745-755) was
  graded NOT harmful: it consumes one orphan `auth_flow_state` and creates one more orphan pointing at a
  deleted user id, but completion re-reads the user and refuses `AUTH_REQUIRED` one step later — no access,
  no consumption of the minted state by the refuser. Residual cost: a handful of unpruned rows (they are
  swept by `pruneAuthFlowStates` only when expired/consumed). Not an id; revisit only if the minted-row
  volume ever becomes an issue.

## Mutation proofs (each added/repaired test was verified to have teeth)

Re-executed during the resumed correction, not inferred from the previous worker's notes.
Production files were TEMPORARILY mutated to break the guard each test claims to prove (or fix a
known defect); each focused command exited 1 for the assertion below. Mutations were reverted exactly:
no production-file diff remains. Logs are machine-local under `$TMPDIR/opencode/si/users-m*.log`.
The SI-USER-09/10 bodies were also temporarily run as plain invariants against unmodified production:
both failed with the exact messages in the CONFIRMED rows (`users-actual-defects.log`), then their
`knownDefect` wrappers and mandatory expectedFailure patterns were restored.

| test (id) | mutated production file:line | change | observed red |
|---|---|---|---|
| SI-USER-09 owner-target/self refusal (knownDefect) | backend/application/services/user.service.ts:1121 (insert after caller check) | pre-read target; throw 403 ACCESS_DENIED if target is owner or `params.approvedBy === id` | M1: body genuinely passes (both 403s asserted, roles unchanged, 2 owners remain); `Failing test passed even though it was supposed to fail` — 1 failed |
| SI-USER-02 rejected→approved is reachable today | backend/application/services/user.service.ts:1121 (insert after caller check) | pre-read target; refuse non-pending target with REQUEST_CONFLICT | M2: `Received promise rejected instead of resolved`, ConflictException; SI-USER-02 failed (separate from owner/self mutation) |
| SI-USER-01 approved→rejected is reachable today | backend/application/services/user.service.ts:1295 (after owner guard) | refuse non-pending target with REQUEST_CONFLICT | M2: `Received promise rejected instead of resolved`, ConflictException; SI-USER-01 failed (2 failures total in M2) |
| SI-USER-10 audit before status (knownDefect) | backend/application/services/user.service.ts:1121,1234 | pre-read target before write; replace hardcoded audit before with real prior role/status | M3: `Failing test passed even though it was supposed to fail` — 1 failed |
| SI-USER-06 serial last-owner guard | backend/application/services/user.service.ts:914 | change `lockedOwners.length <= 1` to `< 1` | M4: `Received promise resolved instead of rejected`, resolved `undefined` on second delete — 1 failed |
| SI-USER-06 repaired two-owner race | backend/application/services/user.service.ts:903 | disable owner-row locks with `if (false) await this.lockRow(...)` | M5: `only 0 backend(s) (needed 1) blocked on /FROM\s+"user"[\s\S]*FOR\s+UPDATE/` — 1 failed; no forced interleaving without the lock |
| SI-USER-03 owner token before/after deactivation | backend/infrastructure/tenant/tenant.guard.ts:40 | disable owner-path inactive-branch refusal (`false && !org?.isActive`) | M6: same token passes JwtStrategy before and after; post-deactivation guard resolves `true` instead of rejecting — 1 failed |
| SI-USER-07 orphan exchange mint/refusal | backend/application/services/auth.service.ts:813-815 | replace deleted-user UnauthorizedException with `return {}` (a successful onboarding profile response) | M7: `Received promise resolved instead of rejected`, resolved `{}` for minted onboarding token — 1 failed (2 failures total in combined M6/M7 run) |
| SI-USER-05 rotation race waiter-count hardening | backend/application/services/auth-session.service.ts:150-152 | remove rotate path's `lockSession` call | M8: `only 0 backend(s) (needed 1) blocked on /FROM\s+"auth_session"[\s\S]*FOR\s+UPDATE/` — 1 failed |
| SI-USER-07 token-consumption race waiter-count hardening | backend/infrastructure/database/repositories/sb.auth-token.repository.ts:60 | drop `usedAt: null` from conditional updateMany | M9: secondAttempt expected `false`, received `true` — 1 failed (2 failures total in M8/M9; mutation run also warned of a pending async operation) |
| SI-USER-08 desktop successful AND failed branch-switch cache reset (2 tests) | frontend/src/app/(protected)/select-branch/page.tsx:102 | remove resetAuthorityState before setCurrentBranch | M10 desktop: both tests expected undefined cache at server action, received the stale admin user — 2 failed |
| SI-USER-08 mobile successful AND failed branch-switch cache reset (2 tests) | mobile/src/app/(shell)/select-branch/page.tsx:53 | remove resetAuthorityState before setCurrentBranch | M10 mobile: both tests expected undefined cache at server action, received the stale admin user — 2 failed |
| SI-USER-08 desktop 30-minute staleTime | frontend/src/hooks/useGetAuthUser.ts:60 | change staleTime to 0 | M10 desktop: 29-minute remount expected 1 HTTP call, received 2 — 1 failed (3 total desktop failures) |
| SI-USER-08 mobile 30-minute staleTime | mobile/src/hooks/useGetAuthUser.ts:43 | change staleTime to 0 | M10 mobile: 29-minute remount expected 1 HTTP call, received 2 — 1 failed (3 total mobile failures) |

## Untestable
None. Every hypothesis was wired to the real DB or the real client code and executed.

## Resumed acceptance verification

- Own DB recreated and migrated with `prisma migrate deploy`; full real-DB command from the brief:
  **5 suites / 16 tests passed, 0 skipped** (2 backend knownDefects fail only as expected).
- Fresh-shell no-env `pnpm test test/integrity/users`: exit 0, all 16 real-DB tests intentionally skipped.
- Frontend and mobile `jest src/__integrity__/users`: **2 suites / 5 tests passed each**.
- Backend `eslint test/integrity/users` and `tsc --noEmit -p tsconfig.json`: exit 0.
- Frontend and mobile `tsc --noEmit` and `eslint src/__integrity__/users`: exit 0 each.
- Client acceptance emitted the existing Sentry config-import deprecation warning; no React act warnings
  remain after wrapping mobile page setup in async act. No build/server/vendor call was needed.

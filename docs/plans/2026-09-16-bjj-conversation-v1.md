# BabyJamJam conversational work AI v1 — implementation record

## Authority and delivery boundary

The user approved the detailed implementation plan on 2026-09-16 and requested implementation. Its section 3 retains a concrete pre-change confirmation for additive schema, shared build configuration and new evaluation dependencies. Source: [implementation plan](https://app.notion.com/p/3dd0b0492434814a9585c7a93eddcf30) and [PRD](https://app.notion.com/p/3dd0b0492434815b8766c0cd621b4b68), superseded by the explicit decisions below.

- Base: `dev`, `4198fb991a59d63f14f529f54b1d66c1587ca76b`; remote synchronization confirmed at start.
- Integration: `codex/bjj-conversation-v1`, sibling worktree `bjj-conversation-v1`.
- Delivery: implementation, synthetic deterministic verification and desktop/mobile integration. Paid model evaluation, real external sends, deployment activation and environment-branch merge are excluded until separately authorized.
- The untracked `dev/mobile/AGENTS.md` belongs to the user and is untouched.

## Locked product decisions

1. Desktop and the separate Next.js mobile app both receive task editing, restore, pause/resume, review and approval.
2. Current registration wizard is the input authority: trimmed name, normalized 11-digit phone, completed duplicate check. Optional dates/address/service data remain optional and use existing domain validation. Defaults: `voucherClient=false`, `serviceStatus=pre_booking`.
3. Automatic texts follow existing automation behavior only after an explicit yes/no choice and structured final approval. A yes is input, not execution authorization. A no or no-send constraint suppresses both creation and update-triggered automation.
4. New drafts use existing protected database storage; no new field encryption/key. Editable/paused data expires 30 days after the last accepted mutation; completed/cancelled/definitively failed data expires 7 days after termination. Reads do not extend retention.
5. Google and OpenAI evaluation adapters are prepared without paid calls. Current production model selection remains unchanged; no silent provider fallback.
6. Business writes retain structured approval. No natural-language utterance invokes approval implicitly.

## Load-bearing contracts

- Server-owned `AgentTask` is scoped to user, branch and session; confirmed/tentative/source/issues/constraints are distinct. One editable task per session, multiple paused tasks. Read-only lookup never changes a paused task's target.
- Bounded `set`, `clear`, `mark-tentative` operations; omission is a no-op. Create defaults never apply to omitted update fields. Resolve voucher values using existing business normalization before proposal hashing.
- Public BFF routes: POST `/api/ai/agent/tasks`, GET/PATCH `/api/ai/agent/tasks/:id`, POST `/api/ai/agent/tasks/:id/commands`; commands select-target, pause, resume, prepare-review, cancel. Existing action approve gains task binding. Typed task snapshot/entity select/task patch contracts replace fabricated natural-language IDs.
- Owner-scoped durable event dedupe: same ID/hash returns the immutable acceptance receipt and current snapshot without mutation; different hash is 409. Expired task or retry beyond 30 days is 410 where ownership is known. Minimal event tombstones survive while the owner session exists; no automatic remapping to a new session.
- Canonical semantic request hashes include operation, task, expected revision and validated explicit changes, not transport metadata. Events do not copy raw PII.
- Transaction lock order: session -> task -> action. Patch/increment/proposal invalidation are atomic; proposals attach only to unchanged revisions; approval validates owner/task revision/proposal revision/input hash and atomically claims execution. No model or external call inside transactions.
- Reuse action receipt/reconciliation. Existing execution stale cutoff is 30 minutes, uncertain lookup every 5 minutes. Never retry effects on uncertain outcomes. Preserve identity/receipt/tombstone information until conclusive reconciliation.
- Automation consent seals target/recipient, normalized effects, template/content and policy/display versions. Unrelated edits preserve consent only when the recomputed effect digest is identical. New reviews bind the current task revision; changed effects require a new explicit answer. Task-linked dispatch rechecks the seal.
- Customer write, automation intent and effect receipt share the provider's existing transaction; postcommit fulfillment reuses existing outbox services. Do not call the separately transactional ClientService.create from that transaction.
- Capture unambiguous protected input before model redaction. Multiple phone candidates and ambiguous partial corrections require selection. Model, new message snapshots, events and evaluation output do not duplicate raw sensitive draft data.
- Draft TTL is not an all-system erasure promise: existing customer records and executed/uncertain audit receipts retain their established retention policy. Session cleanup must not delete live tasks or blocking actions.
- Both clients use shared pure contracts/state rules; retain their distinct transport implementations. Existing legacy messages/actions stay readable. Rollback disables new tasks/reviews, not reconciliation or result reads.

## Phases and evidence

| Phase | Deliverable | State | Integration SHA / verification |
| --- | --- | --- | --- |
| 0 | Baseline, policies, ADR | complete | base above; ADR-013; 121 existing unit tests passed |
| 1 | Shared contracts + 48-case evaluator (parallel) | complete | source close: 76d0445babb87f46ecab3a754323695cef9d0203; SOL SHIP; 19 shared tests, 8 evaluator tests, 48 harness cases |
| 2 | Additive persistence + evaluation providers (parallel) | complete | source close d19ef533619f87add609767cc23e99ea447308bf; SOL SHIP; guarded DB14/14, final provider/evaluator39/39, migration compatibility |
| 3 | Task create/read/patch, protected inputs, replay | in progress | start40b258a1b0dfbb125cb8ee7e42cc5aaa24223477; approved clear-state amendment; isolated Luna/max unit |
| 4 | Commands, retention, session lifecycle | pending | |
| 5 | TurnContext, conversation policy, routing | pending | |
| 6 | Atomic task/action approval binding | pending | |
| 7 | Customer policy + automation consent/dispatch | pending | |
| 8 | Desktop + mobile consumers (parallel) | pending | |
| 9 | Cumulative deterministic QA, browser acceptance, audit | pending | |

Every dependent phase starts from a committed, verified integration SHA. Independent writers use isolated unit branches/worktrees. Phase close includes task checks, integration checks and SOL review when shared contracts, state or security changes. Runtime model/effort metadata must report verified values; do not infer them from defaults.

## Requirement coverage checklist

- FR-01/02/05: questions mixed with inputs preserve facts; explanatory turns do not force writes.
- FR-03/06/07: ordered choices, target continuity, pause/resume and actual action state.
- FR-04/08/09: corrections, tentative dates, minimal required data, wizard/provider policy parity.
- FR-10/13: versioned review, races, duplicate requests, interrupted execution and reconciliation.
- FR-11/12: scoped protected input, same text/form task, reload, no stale identity restore.
- FR-14/16: ordinary-language UI, honest capability/flag boundaries, mobile keyboard/IME/focus/scroll.
- FR-15: 48 multi-turn fixtures, 32 development/16 holdout, semantic families do not cross split; failed actions/states cannot be scored as success.
- NFR: user/branch isolation, concurrency, PII minimization, versioned telemetry, accessibility, reversible flags and migration compatibility.

## Initial preflight evidence

- Dedicated worktree created from synchronized dev; source checkout has only the pre-existing untracked mobile rule file.
- `env-bootstrap` copied existing ignored backend/frontend environment files, without new keys.
- `pnpm install --frozen-lockfile` passed; 1,472 packages installed from the frozen lockfile.
- `env-check` passed with one existing STALE manifest key: `GEMINI_EXTRACTION_MODEL`; no DRIFT/LEAK/REVIEW/UNPARSED findings. No values recorded.
- Vault lookup was attempted and failed with missing `@covenant-labs/vault-contracts`; no Vault files changed.
- Plan independent review: APPROVE after explicit retention/replay/consent/policy corrections. This is a plan review, not an implementation audit.
- Existing `action-coordinator.service.spec.ts` and `client-write-agent-capabilities.provider.spec.ts`: 2 suites / 121 tests passed. Logged assignment-refresh failures are expected injected negative paths. These baseline tests do not establish the new task behavior.
- Prisma client generation passed. Docker is unavailable; an isolated ephemeral PostgreSQL 16.13 cluster was instead started on 127.0.0.1:55433. All 70 existing migrations applied successfully to its empty test database, with both Prisma URL variables explicitly pointing there. No operational database was used.
- Phase 1 unit worktrees have independent frozen dependency installs and env-bootstrap. After the concrete schema/shared-build preview question, the user instructed `continue`; the previewed additive schema and shared include/vendor scope is authorized. Actual operational migration/deployment remains excluded.
- Prepared [additive schema preview](./2026-09-16-agent-task-schema-preview.diff). Event task IDs deliberately have no cascading task foreign key, so an expired/purged task cannot erase the replay evidence while its owning session exists. Task data is purged separately from its minimal ownership tombstone.
- The preview validates with Prisma 6.19.2. Existing migration history compared to the unchanged checked-in schema using a separate local shadow database: no difference detected. At that checkpoint the preview had not been applied. Phase2 later generated and applied the approved migration only to the isolated synthetic DB, as recorded below.
- Shared source integrated at a999017c7 (unit 24dca62eb); 2 suites/16 tests and shared/frontend/mobile type checks passed in integration. Dedicated SOL audit was interrupted by provider quota, then resumed after a fresh usage check permitted work. No approval result is claimed until it returns.
- Evaluation foundation integrated at 8ddcb4d80 (unit 5a63ecc58): 48 cases (32 development/16 holdout), independent state/execution assertions and explicit harness-only reporting. An unnecessary evaluation-local tsconfig was removed at 3874fe218 in favor of an explicit CommonJS runner flag; it was not part of the previewed build scope.
- Dependency audit: 1,627 dependencies, zero reported vulnerabilities at this checkpoint; no dependency additions. Ignored environment files confirmed excluded from Git.
- Integration backend type-check passed after the normal Prisma client generation step. The evaluation unit's earlier ungenerated-client errors did not reproduce in the prepared integration worktree.
- SOL source audit at 17615c606 returned FIX_REQUIRED: constrain nested safe-reference strings, fix identity/revision/acknowledgement reducer behavior, match optional date/currency/birthday validation, establish one consent choice, and make chat patch parts reference accepted events. The correction unit also adds the missing task capability/session-create identity contract. Phase 1 remains open until corrected source, generated parity and repeat SOL review pass.
- Before any new task migration, a synthetic legacy user/branch/session/rejected action was inserted in the isolated test DB. Original action JSON saved outside the repository for exact postmigration comparison (canonical hash c62963a51ce721628cd27ce220c8a9e4fd2a8504afbf11670e29895b09e37c51). This is a synthetic compatibility fixture, not an operational action or external execution.

## Final acceptance and deferred gates

Required implementation evidence: unit/integration checks; real database concurrency and migration compatibility; existing agent E2E and capability-manifest checks; shared vendor regeneration with no drift; desktop/mobile type/lint/build checks; UI architecture checks; authenticated loopback browser flows using `qa:fe`/`qa:mobile`; Aligo/vendor stubs with zero actual external effects; security review and cumulative independent audit.

Deferred: real-model A/B/C/D comparison, three repetitions, frozen latency/cost budgets, human conversational review and production activation. Proposed quality targets (95% scenario success, all core repeats, <=5% needless repeat questions, human mean >=4/no core dimension <3, zero observed safety failures) are NOT proven by deterministic tests.

Rollback keeps additive tables/columns and result/reconciliation reads. Disable new task creation and review issuance. Never destructively revert tables containing unresolved actions. Environment branch merge needs separate user approval.

## Phase 1 correction verification

- Corrected shared source/vendor integrated at `eefc21d2396340e0f3bdd10eb63478b7bb6004bd` (unit `a7b863a115c785026acb2da126ac18aa802f8587`). Structural reference fields now use UUIDs/digests; task revisions remain integer and existing action proposal revisions remain opaque tokens; identity/session resets and acknowledgements are handled separately; confirmed/tentative input validators and one consent authority are explicit.
- Integration verification passed: two shared agent suites / 17 tests; shared, backend, desktop and mobile type checks; generated backend runtime rebuild followed by zero vendor difference. Corrective SOL review at that SHA still required three localized fixes: same-identity reset generation, SHA-256 customer target version distinct from integer task revision, and a fixed issue-code vocabulary. Phase 1 remains open pending their correction and re-review.
- Phase 2 briefs were reviewed before dispatch. They now require a single task/event storage transaction with typed conflict/replay outcomes, adapter-owned active-slot derivation, parent-owned legacy migration proof, mandatory stateless provider continuation, explicit supported model profiles and error/metadata privacy checks. The corrected Phase 2 briefs received SOL APPROVE. No Phase 2 writer has started; both will pin the eventual Phase 1 close SHA.

- Second correction integrated at `b6f1b3b48a9df4636bb4c1cde7907ef9bcc97785` (unit `eebb3c102`): request generation captured before dispatch and incremented on reset, separate SHA-256 customer target version, fixed issue-code vocabulary. All 19 shared tests, all four typechecks, generated vendor parity and diffcheck passed. Final amendment `76d0445babb87f46ecab3a754323695cef9d0203` removes the nullable state bypass. All integration checks were rerun successfully and SOL returned SHIP with no blockers or nonblocking findings at that exact SHA. Phase 1 is closed; this is contract/harness verification, not product runtime or model quality proof.

## Phase 2 dispatch contract

- SOL pre-dispatch review: APPROVE after typed UoW, active-slot enforcement, legacy migration workflow and provider continuation/privacy corrections. Storage and provider adapters have disjoint file ownership and start from the committed Phase 1 close record.
- Storage changes are limited to the approved additive schema, a generated migration, task entity/repository port and adapter, focused unit tests and opt-in guarded local database tests. The parent alone generates/applies the migration and verifies exact legacy record equality.
- Provider codecs use injected mock transport, fixed official endpoints, explicitly registered model profiles, stateless opaque continuation, bounded sanitized errors and no import-time network I/O. No SDK/dependency or operational route change is authorized or needed.

### Rollout setting seam (preparation for Phase 3/5)

The existing `AgentFlagsService` reads `agent.flags`, including open-ended capability booleans, and exposes `getSnapshot()` plus `isCapabilityEnabledFromSnapshot()`. No new environment variable or schema is needed for the task rollout. The new task create/review policy must require its own explicit `capabilities["conversation.tasks"] === true` AND the existing relevant capability gate. Merely inheriting `reversible-write` defaults is insufficient: an existing installation may already enable that risk. Disabling this new flag must preserve task/result reads and existing action reconciliation. This is a future implementation decision, not an implemented gate or an operational setting change.

- Existing schema already has the client `(branchId, phoneNormalized)` unique index; no additional client constraint is needed for this feature. Customer IDs are integers, so UUID task choice references require a server-owned mapping to branch-scoped numeric customer IDs. This will be exercised by API/approval integration tests.

### Phase 2 migration evidence

- Storage unit schema checkpoint matched the approved additive preview and validated. Parent generated `20260916134542_add_agent_tasks` with `prisma migrate dev --create-only`; no hand-authored SQL. Reviewed SQL only adds task/event tables, nullable action task columns, indexes and foreign keys.
- Applied to isolated PostgreSQL127.0.0.1:55433 `bjj_conversation_test` with both datasource URLs explicit. The pre-existing synthetic action retained exact old-column JSON/hash `c62963a51ce721628cd27ce220c8a9e4fd2a8504afbf11670e29895b09e37c51`; both new action fields were null.
- Prisma generation passed. All71 migrations compared to the new schema through a separate local shadow database: no difference. Repository concurrency/replay/rollback tests and final source review are still pending. No operational DB migration occurred.

### Phase 2 verification checkpoint

- Provider codecs integrated at `cc62b8685` (unit `988e24857fb2cb65f4b795b3a541e00bf3064d9e`). Parent independently ran provider + conversation evaluator tests: 2 suites, 22 passed. No real model transport, paid calls, SDK/dependency or runtime route change. Phase5 owns the synthetic product-runtime bridge; codecs themselves do not produce product-state evidence. Actual provider profiles/live evaluation remain deferred.
- Real DB tests exposed a UUID/text parameter mismatch in new owner row locks; corrected parameter casts preserve parameterization and the native UUID column types. The following run passed13/14; the remaining failure is the typed mapping of PostgreSQL's active-slot uniqueness conflict. Until that correction and full DB rerun pass, persistence and Phase2 remain open.
- A post-write typed refusal now uses an explicit transaction abort, with rollback checked separately from database-error rollback. Initial compile narrowing failure was corrected with explicit return, not an unsafe union assertion.

- Corrected active-slot conflict mapping now recognizes the exact real DB column pair/constraint; final guarded persistence run passed14/14 against the isolated PostgreSQL. Cases cover partial/tentative roundtrip, paused slots, scoped/session refusals, stale revisions, immutable replay, conflicting event payloads, one-revision updates, receipt insertion rollback, explicit typed abort rollback, durable no-op receipt after later edit, scoped event uniqueness, concurrent active create, and expired tombstones. Unit9/9 and pure TypeScript also passed after correction. Final integration audit remains pending.

- Both units integrated at `9bd51570a3ec85433427da9a4cfba636efe7fb0b` (provider `cc62b8685`, storage unit `2818e6da13f88c339d174065979bc637249d4924`). Integration initially exposed stale installed `file:backend/vendor/shared-agent` contents from the older environment; refreshed frozen dependencies offline, regenerated Prisma, and reran. Final integration: five unit suites152tests passed, guarded realDB14/14 passed, backend TypeScript passed, harness48/48 passed with zero transport/network calls, diff-check passed. ESLint: zero errors, three unused helper warnings in the new storage files. No lockfile/dependency source changes. Independent FINAL SOL audit is in progress at this exact source SHA.
- Phase3 pre-dispatch review requested explicit per-route request hashes, exhaustive state editability, a rollback/role gate matrix, a concrete HTTP409 envelope that survives the existing global error path, live-task filtering for restore, and production repository DI registration. These are being corrected before any Phase3 implementation dispatch.

- FINAL SOL audit at `9bd51570a` returned FIX_REQUIRED for one provider-codec issue: validate nonempty encrypted OpenAI continuation and match unique declared function calls with their exact tool results before injected transport. Storage scope had no additional blocker or missing verification. Correction and zero-transport negative tests are in progress; three unused storage helpers are being removed separately.
- Corrected Phase3 dispatch brief received SOL APPROVE (HIGH). Its ten-state rules, exact role/rollout matrix, task-local bounded409 through existing legacy4xx path, restore classification, canonical replay hashes and module registration are fixed; implementation waits for Phase2 corrected FINAL close.

- OpenAI pairing correction integrated at `2a89606f2` (unit `7c1db02a46f49aac894ae79f074af9073f55450a`), parent focused22tests passed; unused storage helpers removed at `0d98d970d`, focused9tests and zero-warning ESLint passed. The original FINAL blocker is corrected pending repeat review.
- Parent additionally found a stateless history-order concern: prepending opaque model output ahead of full prior user history (or supplying only delta messages without retaining the original input) can alter context. Official OpenAI [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) demonstrates chronological accumulated input, output items, then matching tool results. SOL is checking the minimal equivalent continuation contract for both evaluation providers before Phase2 close. No live model request or quality conclusion is involved.

- SOL confirmed the history gap affects both providers and approved the concrete correction contract: initial input then delta-only messages; run-bound full chronological native history; continuation after text and tool outcomes; profile/model/version binding; bounded native-shape validation and exact multi-round mock tests. Direct parseResponse cannot claim resumable history. The single provider unit is implementing this correction before Phase2 closure.

### Phase2 history correction re-review

- Full chronological continuation integrated at `a38c4a19129c8bb678bf9fe648ce98c54677082b` (unit `abd0356cc55c2e84cb61b76c7bb57d3dd926b49d`). Parent verification: focused36/36; integrated5suites166tests; pure backendTypeScript; targetedzero-warningESLint; offlineharness48/48 andzerotransport; diffcheck allpassed.
- FINAL SOL re-review at exacta38c4a191 closed the earlier OpenAI pairing blocker and accepted the continuation architecture, but returned FIX_REQUIRED for three localized validation gaps: recursive prototype-mutating JSONkeys, Google role/partownership, and the complete serializedsize of newlygeneratedcontinuations including system/binding/pendingcall data. Correction unit remains confined to provider codecs andtheir tests; Phase2 remainsopen.
- Separate Phase3 readiness inspection confirmed explicit optional-field clear currently removes a key and becomes indistinguishable from omission after persistence. A narrow additive clearedFields contract/JSONcodec correction is in PLAN review before the API unit; no new Prisma schema, dependency or buildconfiguration is proposed. Product clear semantics are not yet implemented or claimed verified.

### Phase2 close and Phase3 dispatch

- Localized final fixes integrated at `d19ef533619f87add609767cc23e99ea447308bf` (unit `7d59b3829f287aee8c1045012a20ff40f9ad45cf`). Parent independently verified focused39/39, backendTypeScript, zero-warningfocusedESLint anddiffcheck; integrationfocused39/39 andTypeScript passed. No source changes tostorage since its verifiedunusedhelpercleanup. Earlier realDB14/14, legacyrecordequality, migrationparity and166-test integration remain applicable tounchangedscope.
- FINAL SOL returned SHIP/HIGH at exactd19ef5336, no blockers, nonblockingfindings or missingverification inPhase2scope. Phase2 isclosed. This doesnot establishliveproviderquality orproductruntimebehavior.
- Phase3 corrected API brief and additiveclear amendment both receivedPLANAPPROVE/HIGH. One isolatedLuna/maxunit will implement sharedclear markers/safeprojection/JSONcodec first, followedbyownedcreate/read/patch APIs, protectedinput, durable replay andsessionrestore. Sharedvendorrefresh isparent-owned betweencontractcheckpoint andAPIcompilation. No newPrismaschema, migration, dependency, buildsetting orauthcorechange isrequired.

- Phase3 dispatched to `codex/unit/bjj-conv-task-api` at `/Users/jaino/Development/babyjamjam-admin/bjj-conv-task-api`, starting exactly `40b258a1b0dfbb125cb8ee7e42cc5aaa24223477`. Runtime role Luna implementation, gpt-5.6-luna/max, local sandbox; no nesteddelegation. Parent prepared env-bootstrap, frozenoffline1472-packageinstall with0downloads, Prisma generation, andenv-check withonlyexistingSTALEGEMINI_EXTRACTION_MODEL. Worktreecleanbeforedispatch. Shared/vendorcheckpoint precedes parentdependencyrefresh andAPIcompilation.

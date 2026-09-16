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
| 1 | Shared contracts + 48-case evaluator (parallel) | in progress | start: 83ea2c57a1019138c2afe960c6cb6f6ffcdab55a; SOL brief review APPROVE |
| 2 | Additive persistence + evaluation providers (parallel) | pending | |
| 3 | Task create/read/patch, protected inputs, replay | pending | |
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
- Phase 1 unit worktrees have independent frozen dependency installs and env-bootstrap. Shared build configuration/vendor changes are held pending the concrete confirmation; contract logic and evaluation work continue.
- Prepared [additive schema preview](./2026-09-16-agent-task-schema-preview.diff). Event task IDs deliberately have no cascading task foreign key, so an expired/purged task cannot erase the replay evidence while its owning session exists. Task data is purged separately from its minimal ownership tombstone.
- The preview validates with Prisma 6.19.2. Existing migration history compared to the unchanged checked-in schema using a separate local shadow database: no difference detected. The preview has not been applied to the product schema or database.

## Final acceptance and deferred gates

Required implementation evidence: unit/integration checks; real database concurrency and migration compatibility; existing agent E2E and capability-manifest checks; shared vendor regeneration with no drift; desktop/mobile type/lint/build checks; UI architecture checks; authenticated loopback browser flows using `qa:fe`/`qa:mobile`; Aligo/vendor stubs with zero actual external effects; security review and cumulative independent audit.

Deferred: real-model A/B/C/D comparison, three repetitions, frozen latency/cost budgets, human conversational review and production activation. Proposed quality targets (95% scenario success, all core repeats, <=5% needless repeat questions, human mean >=4/no core dimension <3, zero observed safety failures) are NOT proven by deterministic tests.

Rollback keeps additive tables/columns and result/reconciliation reads. Disable new task creation and review issuance. Never destructively revert tables containing unresolved actions. Environment branch merge needs separate user approval.

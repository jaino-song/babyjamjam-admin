# ADR-013: Durable conversational work tasks

Date: 2026-09-16
Status: Accepted for implementation; production activation deferred

## Context

The agent already has durable sessions, structured action approval, execution receipts and uncertain-result reconciliation. Desktop and mobile currently keep form input separately from conversation state. A new conversation draft must survive clarification, corrections, pause/resume and page reload without granting natural-language execution authority.

The registration wizard requires name, normalized eleven-digit phone and successful duplicate checking. Other fields remain optional. Existing normal registration creates automation intents; the AI write provider currently uses its own transaction without that creation path. Calling the independently transactional ClientService.create from an action transaction would not provide the required atomicity.

## Decision

1. Add an owner-scoped AgentTask aggregate, separate from business drafts, with revision, confirmed/tentative values, provenance, issues, constraints, ordered choices, target/version and lifecycle state. A session has at most one editable task and may have multiple paused tasks.
2. Accept only bounded, validated set/clear/mark-tentative commands. Missing fields retain their value; explicit clear is required to remove optional data. Create defaults do not leak into updates.
3. Keep durable event receipts without raw input. Semantic event hashes make retries idempotent; conflicting event reuse is rejected. Purged/expired retries do not recreate drafts.
4. Use session -> task -> action row locking for edits, proposal attachment and approval claims. Bind approval to task revision, proposal revision and input hash. Perform model calls and external effects outside the transaction.
5. Reuse the existing action receipt, uncertain-result recovery and scheduler lease. Unknown outcomes do not authorize re-execution.
6. Require explicit automation choice, bind it to recipient/effect/template/policy versions, display the effect with the customer change and require existing structured approval. Persist customer changes, automation intents and action receipts together; fulfill after commit through the existing pipeline.
7. Store protected draft values using the existing database approach. Provide safe references/status to the model and messages instead of copying raw protected input. Editable/paused tasks retain data for 30 days after accepted change; terminal tasks for 7 days. Reads do not extend retention. Preserve unresolved execution evidence and session ownership independently.
8. Share contracts and pure client state rules while retaining each client's existing transport. Feature rollout defaults off; rollback stops new tasks/reviews while retaining result lookup and reconciliation.
9. Use synthetic, fixed-clock fixtures for deterministic verification. Prepare Google/OpenAI evaluation adapters without changing the production Google route or running paid evaluation.

## Consequences

The task repository becomes the editing authority. Database integration tests must prove edit/approval ordering and retry behavior; mocks alone cannot establish that guarantee. Additive nullable links preserve old actions. Session cleanup must account for live tasks and unresolved actions. Consent is about the actual computed automation effect, not just a Boolean field.

This decision does not add a second automation queue, automatically approve writes, promise erasure of existing customer/audit data after seven days, or claim model quality from deterministic tests.

## Verification and rollback

See [implementation record](../plans/2026-09-16-bjj-conversation-v1.md). Rollback disables new task/review issuance and keeps additive data until unresolved actions are reconciled. Paid quality review, real sends, deployment activation and environment-branch merge remain separate gates.

TL;DR: Turn the hidden "greeting SMS on new client" into a normal, toggle-able rule you create in the existing 발송 규칙 form — by adding one new SMS template type, routing it through the engine that already powers the other rules, and retiring the old hidden sender (no double-texting, no behavior loss on rollout).

## Context

Today, when a client is added, a greeting SMS ("인사 메시지") is sent by a **hardcoded** service (`client-greeting-sms-automation.service.ts`, called at `client.service.ts:324`). It's invisible in the UI and not configurable. You want it to be a **first-class, data-driven rule** — created and toggled in the existing "새 규칙" form, like the other SMS rules — not a hardcoded behavior or a bespoke card.

The trigger engine already supports a "rule → SMS, body from a system template" path (the `SERVICE_INFO` template). The plan mirrors that exact precedent for a new `CLIENT_GREETING` template whose body comes from the existing `SystemTemplateKey.GREETING` content, then removes the hardcoded sender so clients are texted once. Existing branches keep greeting via a seed migration; new branches self-heal a default rule via an existing pattern. This plan has been adversarially reviewed; the blockers it surfaced are folded into the tasks below.

## Phase 1 — Define the new template everywhere
Introduce `CLIENT_GREETING` across shared types, the backend catalog, and the frontend label maps so the build stays green.

- **Add the `CLIENT_GREETING` template** (feature, low)
  - Backend: add `CLIENT_GREETING` to the `AlimtalkTriggerTemplateKey` enum + a catalog entry (name "인사(소개)", `allowedEventTypes:[CLIENT_CREATED]`, `allowedRecipientTypes:[CLIENT]`, `providers:{aligo,channeltalk}` so `listTemplates` surfaces it in the form).
  - Shared: add `"CLIENT_GREETING"` to the `AlimtalkTriggerTemplateKey` union.
  - Paths: `backend/domain/constants/alimtalk-trigger-catalog.ts`, `packages/shared/src/types/alimtalk.ts`
- **Patch the 3 exhaustive frontend label maps** (feature, med) — *review blocker*
  - The union change makes three `Record<TriggerTemplateKey, …>` literals non-exhaustive (TS2741). Add a `CLIENT_GREETING` entry to each: `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS` (`TriggerRulesManager.tsx:~193`) and `TEMPLATE_LABELS` in `UpcomingAlimtalkManager.tsx:~57` and `AlimtalkHistoryManager.tsx:~55`.
  - Verify: `pnpm --filter ./backend type-check` **and** `pnpm --filter ./frontend type-check` both clean.

## Phase 2 — Wire it through the backend engine
Route the new template to SMS, carry it through client creation, and remove the old hidden sender.

**In parallel:**
- **Delivery — route `CLIENT_GREETING` to SMS** (feature, med)
  - Generalize the hardcoded `if templateKey === SERVICE_INFO` branch into a small `SMS_TEMPLATE_DELIVERY` map (`SERVICE_INFO→SERVICE_INFO`, `CLIENT_GREETING→GREETING`) feeding one generic `sendSmsJob(job, config)`. Greeting title "인사 메시지"; body from `SystemTemplateKey.GREETING`.
  - **Pin the greeting log contract byte-for-byte to the retired sender** (*review #3*) so history/ops semantics don't shift: the `CLIENT_GREETING` map entry must log `templateKey: "client_greeting_sms"`, `automationKey: "CLIENT_GREETING_SMS"`, `triggerType: "client_created"`, `title: "인사 메시지"` (matches `client-greeting-sms-automation.service.ts:54-69`). SERVICE_INFO keeps `service_info_sms` / `SERVICE_INFO_SMS` / `service_start_before_7_days` / `서비스 안내`.
  - **SERVICE_INFO output must stay byte-identical** (same log key `service_info_sms`, title, `automationKey`, `triggerType`); the variable merge `{name: recipientName, clientName: recipientName, ...templateVariables}` lets `templateVariables` win, so SERVICE_INFO is unchanged (review-confirmed).
  - Paths: `backend/application/services/alimtalk-trigger-delivery.service.ts` (+ spec)
- **Trigger service — anti-backfill guard, variables, suppress, self-heal** (feature, high)
  - **[CRITICAL — prevents mass-texting existing clients]** Guard `rebuildJobsForRule` (`:~474`) to skip **IMMEDIATE-offset** rules: add `if (rule.offsetType === AlimtalkTriggerOffsetType.IMMEDIATE) return;` (generalizes the existing `EMPLOYEE_ASSIGNED` early-return at `:481`). Reason: for an IMMEDIATE rule `computeScheduledFor` returns `new Date()` (now), and `persistPendingJob` only drops jobs `scheduledFor < Date.now()` (strictly past) — built in the same millisecond, "now" is **not** dropped, so `createRule`/`updateRule`/self-heal would enqueue a greeting for **every existing client**. IMMEDIATE rules must only fire on the live event (via `syncClientRulesForClient`, `includePast=true`), never via backfill. Verify existing `EMPLOYEE_ASSIGNED`/`SERVICE_INFO` rebuild tests still pass.
  - Add a `CLIENT_GREETING` case to `buildClientTemplateVariables` returning `{name, clientName, phone}` and widen its `client` `Pick` to include `phone` (*review*).
  - Thread `suppressGreeting = false` into `syncClientRulesForClient`; in the build loop, skip the job when `rule.templateKey === CLIENT_GREETING && suppressGreeting` (faithfully preserves the old `!suppressGreetingSms` gate; does **not** affect the alimtalk `CLIENT_WELCOME` rule).
  - Generalize `ensureDefaultServiceInfoTrigger` (`:~448`) to also ensure a default **active** `CLIENT_GREETING` rule — self-heals new branches on panel open (covers the no-branch-create-hook gap). **Safe only because of the IMMEDIATE guard above** — without it, `ensureDefault`'s `rebuildJobsForRule(…, false)` call (`:470`) would retro-blast. *Decision: this is how new branches get the rule; toggling off persists, only a hard delete resurrects — consistent with SERVICE_INFO. Say so if you'd rather new branches be purely manual.*
  - Tests: a rebuild/createRule test asserting **no** jobs are enqueued for existing clients when an IMMEDIATE `CLIENT_GREETING` rule is created (the anti-backfill guard); assert `jobRepository.upsertPending` (not `save`); mock `prisma.client.findFirst`/`findMany`, `jobRepository.upsertPending`/`findPendingByRuleIdsAndClientId`, and `jest.mock` the `schema-capabilities` `hasColumn`/`hasTable` free imports (*review blocker*).
  - Paths: `backend/application/services/alimtalk-trigger.service.ts` (+ spec)

then ↓
- **Client service — retire the hardcoded sender** (refactor, med) — depends on the trigger-service signature above
  - Pass `params.suppressGreetingSms ?? false` as the 4th arg to `syncClientRulesForClient`; delete the `clientGreetingSmsAutomationService` block + its `@Optional` injection + import (keep the `suppressGreetingSms` param; keep `@Optional` for `triggerService`).
  - `git rm` `client-greeting-sms-automation.service.ts` + its spec; remove the provider/import from `client.module.ts`.
  - Fix `client.service.spec.ts` (*review blocker*): remove the deleted-service import/mock-factory/`let`/`beforeEach`/ctor cast and the three greeting assertions (incl. the one inside the phone-dedup test ~`:369`); pass a `triggerService` mock as the **10th** ctor arg so the new "forwards suppress + no separate sender" assertion fires.
  - Both create paths (clients controller + `call-inbox.service.ts:~265`) funnel through `ClientService.create`, so this covers both (review-confirmed).
  - Paths: `backend/application/services/client.service.ts`, `backend/module/client.module.ts`, deletions + `backend/test/services/client.service.spec.ts`

## Phase 3 — Surface it in the SMS form (parallel with Phase 2)
Let the SMS panel offer 고객 등록 + 인사(소개) and preview the real text — no bespoke UI.

- **Enable the rule in the form** (feature, low)
  - `channel.ts`: add `CLIENT_GREETING` to `SMS_TRIGGER_TEMPLATE_KEYS`.
  - `getEventOptionsForChannel` (`:~223`): allow `CLIENT_CREATED` for the `sms` channel (alongside `SERVICE_START`). The existing event→template reset `useEffect` (`:~432`) then auto-selects 인사(소개).
  - `selectedSystemTemplateKey` (`:~339`): map `CLIENT_GREETING → SystemTemplateKey.GREETING` so the form preview shows the real greeting body (*review #7*).
  - Paths: `frontend/src/features/alimtalk-triggers/channel.ts`, `frontend/src/components/app/alimtalk/TriggerRulesManager.tsx`

## Phase 4 — Seed existing branches
Every existing branch keeps greeting immediately, now as a visible active rule.

- **Data migration — seed one active greeting rule per branch** (infra, med)
  - Idempotent `INSERT … SELECT … FROM branch WHERE NOT EXISTS (… template_key='CLIENT_GREETING')`; no schema change (`template_key` is a string column). Seeds all branches (unapproved ones no-op at `ensureApproved`, as today).
  - **Does not retro-greet existing clients**: the migration only inserts rule rows — it creates **no jobs** and never calls `rebuildJobsForRule`. Greeting jobs are only built on new client creation (`syncClientRulesForClient`, `includePast=true`). (Do **not** rely on `persistPendingJob` dropping "now" jobs — it does not for IMMEDIATE; the safety comes from the seed creating no jobs + the Phase 2 anti-backfill guard.)
  - Paths: `backend/prisma/migrations/<ts>_seed_client_greeting_trigger_rule/migration.sql`

## Phase 5 — Verify
- **Type-check + tests + manual smoke** (test, low)
  - `pnpm --filter ./backend type-check && pnpm --filter ./frontend type-check`; run the touched suites (`alimtalk-trigger`, `alimtalk-trigger-delivery`, `client.service`, frontend `channel`).
  - Manual: the seeded "신규 고객 인사 메시지" appears as a toggle-able row; create one via the form (고객 등록 → 인사(소개) → 즉시); add a test client with a phone on an SMS-approved branch → exactly one greeting in `alimtalk_log` within ~1 min; toggle off / `suppressGreetingSms` → none; no double-send.

## Deploy & rollback note (*review #2, #5*)
- **Ship together, migrate-then-start:** the migration (Phase 4) and code (Phases 1–4) go out in the **same release**. Seeding the active rule while old code still runs → the old hidden sender plus the new rule path = **double-send**; new code without the seed → existing branches stop greeting.
- **Rollback:** on a full rollback to pre-feature code, the seeded active rules make the engine build `CLIENT_GREETING` jobs that **fail at delivery** (unknown template) — log noise, not double-SMS (the restored hidden sender still sends exactly one). To roll back cleanly, also deactivate/delete the seeded `CLIENT_GREETING` rows.
- **Kill-switch (no deploy):** because greeting is now a rule, toggling it **off** (`isActive=false`) per branch is an instant kill-switch.

## Critical files
- `backend/domain/constants/alimtalk-trigger-catalog.ts` — new template key + catalog entry
- `backend/application/services/alimtalk-trigger-delivery.service.ts` — SMS routing map + generic `sendSmsJob`
- `backend/application/services/alimtalk-trigger.service.ts` — `buildClientTemplateVariables` case, `syncClientRulesForClient` suppress, generalized `ensureDefault…`
- `backend/application/services/client.service.ts` + `backend/module/client.module.ts` — retire hardcoded sender
- `frontend/src/features/alimtalk-triggers/channel.ts`, `frontend/src/components/app/alimtalk/TriggerRulesManager.tsx` (+ `UpcomingAlimtalkManager.tsx`, `AlimtalkHistoryManager.tsx` label maps)
- `packages/shared/src/types/alimtalk.ts` — union
- `backend/prisma/migrations/<ts>_seed_client_greeting_trigger_rule/migration.sql`
- Detailed step-by-step (TDD, exact code) lives in `docs/superpowers/plans/2026-06-27-client-greeting-trigger-rule.md` (to be updated with these review fixes before execution).

## Verification (end-to-end)
1. `pnpm --filter ./backend type-check && pnpm --filter ./frontend type-check` — clean.
2. Touched Jest suites green (backend trigger/delivery/client, frontend channel).
3. Apply migration twice → first inserts N (branch count), second inserts 0 (idempotent); every branch has exactly one `CLIENT_GREETING` rule.
4. In the SMS 발송 규칙 panel: seeded rule shows as a toggle; create a new one via the form; add a test client (with phone, SMS-approved branch) → one greeting logged within ~1 min; toggle off → none.

## Execution (after approval)
Isolate into a feature worktree off `dev`; implement task-by-task (Sonnet implementer per task, Opus review between) or via Codex delegation; merge back to `dev`.

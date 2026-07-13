# Client Greeting SMS as a Data-Driven Trigger Rule

**Date:** 2026-06-27
**Status:** Design — pending approval
**Area:** `backend/` (NestJS trigger engine), `frontend/` (TriggerRulesManager), `packages/shared`

## Problem

When a new client is added, a greeting SMS ("인사 메시지") is sent. Today this is a **hardcoded automation** (`ClientGreetingSmsAutomationService`, called from `client.service.ts:324`), invisible in the UI and not configurable.

The user wants this to be a **first-class, data-driven rule** managed through the existing "SMS 발송 규칙" panel — created/edited via the existing "새 규칙" form, and toggle-able on/off — rather than a hardcoded behavior or a bespoke hardcoded card.

## Goal

A user can see, create, edit, and toggle a "고객 등록 → 인사 메시지(SMS)" rule in the SMS trigger-rules panel, using the **existing** rule form. The greeting fires through the **existing trigger-rule engine**, with **no second sender** (no double-texting). Current auto-greeting behavior is preserved on rollout.

## Current state (verified)

- **Trigger engine** (`alimtalk_trigger_rule` table) is data-driven: rules have `eventType`, `offsetType`, `offsetDays`, `recipientType`, `templateKey`, `isActive`. Created via `POST /alimtalk-trigger-rules` from the form.
- **No `channel` field.** SMS vs alimtalk is determined **by `templateKey`**: `alimtalk-trigger-delivery.service.ts:52` special-cases `SERVICE_INFO` → `sendServiceInfoSmsJob` (real SMS via Aligo, body resolved from `SystemTemplateKey.SERVICE_INFO`). Every other template → KakaoTalk/alimtalk provider path.
- **`CLIENT_CREATED` is fully wired** for matching/scheduling: on client creation, `client.service.ts:320` calls `syncClientRulesForClient`, which builds jobs for active CLIENT_CREATED rules; a 1-minute cron (`alimtalk-trigger-scheduler.service.ts`) dispatches due jobs. `IMMEDIATE` offset → send now. Anchor date = `client.createdAt`.
- **Two parallel template systems:** `AlimtalkTriggerTemplateKey` (rules) vs `SystemTemplateKey` (manual sends + the GREETING content). They bridge only at `SERVICE_INFO`.
- **Gap:** the trigger system has no greeting template (`CLIENT_WELCOME` is alimtalk-only "고객 등록 안내", not the 인사 content); the SMS form only offers `SERVICE_START` + `SERVICE_INFO`.
- **Hardcoded greeting** still runs in parallel (`client.service.ts:324`), gated by `ensureApproved(branchId)` + per-client `suppressGreetingSms`, body from `SystemTemplateKey.GREETING`.

## Design

Mirror the existing **`SERVICE_INFO` SMS-bridge** precedent for the greeting. Use `templateKey`-based SMS routing (no new `channel` column — keeps the change small and consistent with the existing pattern).

### 1. New trigger template `CLIENT_GREETING`
- Add `CLIENT_GREETING` to `AlimtalkTriggerTemplateKey` — backend enum (`domain/constants/alimtalk-trigger-catalog.ts`) and shared union (`packages/shared/src/types/alimtalk.ts`).
- Catalog entry: name "인사(소개)", `allowedEventTypes: [CLIENT_CREATED]`, `allowedRecipientTypes: [CLIENT]`, `requiredVariables: []` (the renderer fills `name`/`clientName`/`phone`). It is an **SMS** template (see routing). Provider mappings mirror `SERVICE_INFO`'s shape (unused on the SMS path, which short-circuits before provider lookup).

### 2. SMS routing (delivery service)
- Replace the hardcoded `if (templateKey === SERVICE_INFO)` branch with a small map:
  `SMS_TEMPLATE_TO_SYSTEM_TEMPLATE: { SERVICE_INFO → SystemTemplateKey.SERVICE_INFO, CLIENT_GREETING → SystemTemplateKey.GREETING }`.
- Generalize `sendServiceInfoSmsJob` / `resolveServiceInfoSmsMessage` into a generic `sendSmsJob(job, systemTemplateKey, title)` that resolves the system-template body and sends via `aligoService.sendSms` (msgType `"AUTO"`), then logs to `alimtalk_log` (existing behavior). `SERVICE_INFO` behavior is unchanged; `CLIENT_GREETING` uses title "인사 메시지" (matching today's hardcoded title) and `SystemTemplateKey.GREETING` content.

### 3. Form surfacing (frontend, minimal)
- `frontend/src/features/alimtalk-triggers/channel.ts`: add `CLIENT_GREETING` to `SMS_TRIGGER_TEMPLATE_KEYS`.
- `getEventOptionsForChannel` (TriggerRulesManager.tsx): for `sms`, allow `CLIENT_CREATED` in addition to `SERVICE_START`.
- No bespoke UI: with the catalog entry + these two edits, selecting 고객 등록 in the SMS panel surfaces the "인사(소개)" template, and the existing form creates the rule. (Optional: default the SMS create form to CLIENT_CREATED + CLIENT_GREETING.)

### 4. Retire the hardcoded automation (no double-send)
- Remove the `clientGreetingSmsAutomationService.sendClientGreetingSms(...)` call in `client.service.ts` (the greeting now flows via `syncClientRulesForClient`, already called).
- Remove `ClientGreetingSmsAutomationService` (class, module provider, unit tests) — fully replaced.
- **Preserve `suppressGreetingSms`:** thread the flag into the client rule-sync so `CLIENT_GREETING` jobs are **not** built when `suppressGreetingSms` is true (bulk imports rely on this opt-out). All other rule types are unaffected.

### 5. Rollout — seed an active rule ("register as a toggle rule")
- **No DB schema change:** `templateKey` is a `String` column; `CLIENT_GREETING` is just a new value. Migration is **data-only**.
- **Existing branches:** data migration inserts one **active** rule per branch: `{ eventType: CLIENT_CREATED, offsetType: IMMEDIATE, offsetDays: 0, recipientType: CLIENT, templateKey: CLIENT_GREETING, isActive: true, name: "신규 고객 인사 메시지" }`. Idempotent (skip if such a rule already exists). Seed **all** branches — safe because unapproved branches no-op at the `ensureApproved` gate, exactly as today.
- **New branches:** seed the same default rule at branch creation (branch create usecase/service).

## Data flow (after change)

client created → `syncClientRulesForClient` matches the active CLIENT_GREETING rule (unless `suppressGreetingSms`) → builds job (IMMEDIATE → now) → 1-min cron dispatches → `sendSmsJob` resolves `SystemTemplateKey.GREETING` body → `aligoService.sendSms` → logged to `alimtalk_log`.

**Behavior change to note:** the hardcoded path sent **synchronously**; the rule path sends **within ~1 minute** (cron cadence). Acceptable for a greeting.

## Testing

- **Delivery (unit):** `CLIENT_GREETING` job sends an SMS with `SystemTemplateKey.GREETING` content + title "인사 메시지"; `SERVICE_INFO` behavior unchanged.
- **Rule sync (unit):** a new client with an active greeting rule produces exactly one greeting job; `suppressGreetingSms: true` produces none.
- **No double-send:** `client.service` no longer calls the removed automation (spec updated); only the rule path can greet.
- **Migration (integration):** existing branches end up with exactly one active greeting rule; re-running is idempotent.
- **Frontend:** in the SMS panel, the form can select 고객 등록 → 인사(소개) → 즉시 and create the rule; it appears as a toggle-able row.

## Decisions made

- **`templateKey`-based SMS routing** (not a new `channel` column) — matches the `SERVICE_INFO` precedent, smallest change.
- **Bridge to `SystemTemplateKey.GREETING`** for body — reuses the existing 인사 content; greeting text edits remain a separate template concern.
- **Seed active rules for all branches** (existing + new) — preserves current behavior, gives the toggle.

## Risks

- **Double-send** if the hardcoded path isn't fully removed → covered by test + removing the service.
- **Silent greeting loss** if seed migration fails for a branch → idempotent seed + integration test.
- **`suppressGreetingSms` regression** if not threaded into rule sync → explicit test.
- **Greeting content is currently resolved via `systemTemplateService.getByKey(GREETING)`** — same resolution as today (no change in per-branch vs global behavior). Any multi-branch greeting-content limitation is pre-existing and **out of scope**.
- **LMS length:** GREETING content is long; `msgType: "AUTO"` already auto-selects SMS/LMS (unchanged).

## Out of scope

- Changing the greeting **text** (template-content edit, separate flow).
- Adding a generic per-rule `channel` column.
- The alimtalk `CLIENT_WELCOME` template and the retry card.

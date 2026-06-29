# SMS 발송 규칙 — 7개 시스템 템플릿 전체 지원 (Design Spec)

**Date:** 2026-06-30
**Status:** Draft for review
**Author:** David Jinho Song (+ Claude)
**Builds on:** `2026-06-27-client-greeting-trigger-rule-design.md` (Phase C — CLIENT_GREETING SMS trigger), which established the "trigger rule → SMS, body from a SystemTemplate" bridge precedent.

---

## 1. Goal

Let an SMS 자동 발송 규칙 (auto-send rule) use **any of the 7 system message templates**, not just the 2 currently wired (`SERVICE_INFO`, `CLIENT_GREETING`). A user creates a rule in the existing "새 규칙" form by freely pairing **any client event** with **any of the 7 templates** and a timing offset; the message is sent to the **고객 (client)**.

## 2. Background — current state (verbatim-verified)

- **Two template systems.** `SystemTemplateKey` (7: `PRICE_INFO, GREETING, THANKS, SURVEY, SERVICE_INFO, REMINDER, INFO`) is the manual-send content library. `AlimtalkTriggerTemplateKey` (6: `CLIENT_WELCOME, SERVICE_START_REMINDER, SERVICE_INFO, SERVICE_END_REMINDER, EMPLOYEE_ASSIGNED, CLIENT_GREETING`) drives automation rules.
- **The SMS bridge.** Only `SERVICE_INFO` and `CLIENT_GREETING` trigger templates send SMS; each "bridges" to a `SystemTemplateKey` for its body via `SMS_TEMPLATE_DELIVERY` (`backend/application/services/alimtalk-trigger-delivery.service.ts:35-50`). The other 4 trigger templates are alimtalk.
- **Channel is derived, not stored.** `packages/shared/src/types/alimtalk.ts` holds `SMS_TRIGGER_TEMPLATE_KEYS` + `getTriggerTemplateChannel(key)`; the form splits SMS vs alimtalk client-side from this single source of truth (Phase C refactor).
- **The form is already data-driven.** `TriggerRulesManager.tsx` fetches all provider templates and derives the event / recipient / template dropdowns from the catalog. Adding catalog entries surfaces them automatically.
- **Variables.** `buildClientTemplateVariables` (`alimtalk-trigger.service.ts:654-691`) is a per-template `switch`. The SMS cases return only `{name, clientName[, phone]}`. The client `select` (`:383-394`) loads `id,name,phone,type,startDate,endDate,createdAt` — **no price fields, no bank join.**
- **Renderer.** `renderTemplate` (`alimtalk-trigger-delivery.service.ts:196-198`): `template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => variables[key] ?? m)` — **a missing variable leaves the literal `{{key}}` in the text.**

## 3. Rule model — Free pairing (decided)

A rule = **(event) × (timing offset) × (template) → 고객**, with no enforced coupling between event and template.

- **Events** (client-facing only): `CLIENT_CREATED` (고객 등록), `SERVICE_START` (서비스 시작), `SERVICE_END` (서비스 종료).
- **Offsets per event** (already enforced by the form/engine): `CLIENT_CREATED` → `IMMEDIATE | AFTER_DAYS`; `SERVICE_START` / `SERVICE_END` → `SAME_DAY | BEFORE_DAYS | AFTER_DAYS`.
- **Templates**: all 7 system templates.
- **Recipient**: `CLIENT` only. Employee recipients (`PRIMARY_EMPLOYEE` / `SECONDARY_EMPLOYEE`) and `EMPLOYEE_ASSIGNED` are alimtalk-only and **out of scope**.

## 4. Architecture decision — extend the catalog (Option b)

Add the 5 missing system templates as `AlimtalkTriggerTemplateKey` entries that bridge to their `SystemTemplateKey`, rather than introducing a second way to reference templates on a rule. This is a pure extension of the Phase C precedent; every downstream consumer (data-driven form, `SMS_TEMPLATE_DELIVERY`, `getTriggerTemplateChannel`, drift-guard test) already reads from these structures.

**Rejected — Option a** (store `SystemTemplateKey` directly on SMS rules): forks the rule data model into two reference styles for no benefit; more churn.

### Naming / bridge

| Trigger template key (new?) | → System template | Note |
|---|---|---|
| `SERVICE_INFO` | `SERVICE_INFO` | existing |
| `CLIENT_GREETING` | `GREETING` | existing (name intentionally differs; already seeded in DB — no rename) |
| `PRICE_INFO` *(new)* | `PRICE_INFO` | |
| `REMINDER` *(new)* | `REMINDER` | |
| `THANKS` *(new)* | `THANKS` | |
| `SURVEY` *(new)* | `SURVEY` | |
| `INFO` *(new)* | `INFO` | |

→ 7 SMS trigger templates total. The 4 alimtalk trigger templates are untouched.

## 5. Detailed design

### 5.1 Shared types — `packages/shared/src/types/alimtalk.ts`

- Add `"PRICE_INFO" | "REMINDER" | "THANKS" | "SURVEY" | "INFO"` to the `AlimtalkTriggerTemplateKey` union.
- Add the same 5 to `SMS_TRIGGER_TEMPLATE_KEYS` (→ all 7). `getTriggerTemplateChannel` then classifies them as `sms` with no change.
- Add a **single-source bridge map** consumed by both backend delivery and frontend preview:
  ```ts
  export const SMS_TRIGGER_TO_SYSTEM_TEMPLATE: Record<string, string> = {
    SERVICE_INFO: "SERVICE_INFO",
    CLIENT_GREETING: "GREETING",
    PRICE_INFO: "PRICE_INFO",
    REMINDER: "REMINDER",
    THANKS: "THANKS",
    SURVEY: "SURVEY",
    INFO: "INFO",
  };
  ```
  (Keyed/valued by string to avoid importing the backend `SystemTemplateKey` enum into shared. Values equal `SystemTemplateKey` member values.)

### 5.2 Backend catalog — `backend/domain/constants/alimtalk-trigger-catalog.ts`

- Add `PRICE_INFO, REMINDER, THANKS, SURVEY, INFO` to the `AlimtalkTriggerTemplateKey` enum.
- Add a catalog entry for each new key. Shape (matching the existing interface):
  ```ts
  [AlimtalkTriggerTemplateKey.PRICE_INFO]: {
    key: AlimtalkTriggerTemplateKey.PRICE_INFO,
    name: "비용 안내",
    description: "고객에게 비용/계좌 정보를 SMS로 발송",
    allowedEventTypes: [CLIENT_CREATED, SERVICE_START, SERVICE_END],   // free pairing
    allowedRecipientTypes: [CLIENT],
    requiredVariables: [ /* name, weeks, duration, type, fullPrice, grant, actualPrice, bankName, accNum */ ],
    providers: { aligo: { templateKey: "PRICE_INFO" }, channeltalk: { templateKey: "price_info" } },
  },
  ```
  Names/labels per the system registry: `PRICE_INFO`="비용 안내", `REMINDER`="리마인드", `THANKS`="예약 완료(입금 확인)", `SURVEY`="모니터링 설문", `INFO`="정보 요청". For the name-only templates `requiredVariables` = `[{key:"name", label:"산모님 성함"}]`; `INFO` = `[]`.
- **Widen `allowedEventTypes` to all 3 client events** for the two existing SMS entries (`SERVICE_INFO` was `[SERVICE_START]`, `CLIENT_GREETING` was `[CLIENT_CREATED]`) so free pairing applies uniformly. *This affects only what the form offers for new/edited rules; existing stored rules keep their saved eventType.*
- **`providers` is required for the form to surface the template** (`listTemplates(provider)` filters by provider). Give every new entry both `aligo` and `channeltalk` provider codes (as above), matching the existing SMS entries. The provider codes are not used for SMS sending (the body comes from the system template) — they only gate visibility. *Plan must confirm `listTemplates`'s provider filter before finalizing.*

### 5.3 Delivery map — `backend/application/services/alimtalk-trigger-delivery.service.ts`

- Add 5 `SMS_TEMPLATE_DELIVERY` entries:
  | key | smsLogTemplateKey | automationKey | title | systemTemplateKey |
  |---|---|---|---|---|
  | `PRICE_INFO` | `price_info_sms` | `PRICE_INFO_SMS` | 비용 안내 | `PRICE_INFO` |
  | `REMINDER` | `reminder_sms` | `REMINDER_SMS` | 리마인드 | `REMINDER` |
  | `THANKS` | `thanks_sms` | `THANKS_SMS` | 예약 완료 | `THANKS` |
  | `SURVEY` | `survey_sms` | `SURVEY_SMS` | 모니터링 설문 | `SURVEY` |
  | `INFO` | `info_sms` | `INFO_SMS` | 정보 안내 | `INFO` |
- **`triggerType` — derive from the rule's event for new templates; preserve fixed strings for the two legacy ones.** Make `triggerType` on the config **optional**. If present → use it (keeps `SERVICE_INFO`="service_start_before_7_days" and `CLIENT_GREETING`="client_created" byte-for-byte → history unchanged). If absent (the 5 new) → derive from the job's eventType via `{CLIENT_CREATED:"client_created", SERVICE_START:"service_start", SERVICE_END:"service_end"}`. *Accepted minor limitation: re-pairing a legacy template (e.g. SERVICE_INFO) to a non-default event still logs its pinned triggerType; preserving default-pairing history is judged more valuable than event-accuracy for that edge case.* (Requires the job's eventType to be reachable in `sendSmsJob` — plan to confirm it's on `job`/`payload`, else add it.)
- The 7th `systemTemplateKey` resolves the body via the existing `resolveSmsMessage` + `renderTemplate`. The drift-guard test (`SMS_TEMPLATE_DELIVERY` keys === shared `SMS_TRIGGER_TEMPLATE_KEYS`) now enforces all 7 are present.

### 5.4 Generic client → variables mapper — `backend/application/services/alimtalk-trigger.service.ts`

- **Widen the client load** (`:383-394` select + the `ClientTriggerSource` interface `:121-129`) to add: `duration`, `fullPrice` (`full_price`), `grant`, `actualPrice` (`actual_price`), and the `area → bankAccountInfo { bankName, accNum }` relation (via the client's `areaId`).
- **Add a generic SMS variable builder** that returns the full bag, every value coerced to a string with `""` fallback (so no literal `{{x}}` leaks):
  ```ts
  {
    name, clientName, phone,
    weeks: String(Math.floor((duration ?? 0) / 5)),
    duration: String(duration ?? ""),
    type: type ?? "",
    fullPrice: fullPrice ?? "", grant: grant ?? "", actualPrice: actualPrice ?? "",
    bankName: area?.bankAccountInfo?.bankName ?? "", accNum: area?.bankAccountInfo?.accNum ?? "",
  }
  ```
- **Route `buildClientTemplateVariables`**: if `SMS_TRIGGER_TEMPLATE_KEYS.includes(rule.templateKey)` → return the generic bag (replaces the existing `SERVICE_INFO`/`CLIENT_GREETING` cases). Else → existing alimtalk `switch` cases **unchanged** (their distinct variable shapes — `registrationDate`, `timingText`, etc. — are preserved). Each template renders only the placeholders it references; extra vars are ignored.

### 5.5 비용 안내 (PRICE_INFO) data guard — skip-and-log

- **Where:** at delivery, in `sendSmsJob`, **before** sending — the last gate, with the freshest variables.
- **Rule:** if `config.systemTemplateKey === PRICE_INFO` and any **essential** field is empty/missing → **do not send**; write a skip log and mark the job terminally done (not a transient failure → must NOT be retried by the cron). Essential set: `fullPrice, actualPrice, bankName, accNum` (the money + deposit-account values that make a blank message harmful). `grant` and `weeks/duration` are not gate fields. *Plan to confirm the job-completion path so a skip marks the job processed, not pending.*
- **Log:** a record under the same `smsLogTemplateKey`/`automationKey` with a skipped status and reason (e.g. `missing_price_data`) so ops can see it was intentionally not sent. *Plan to confirm the log schema supports a skipped status; if not, the minimum is: do not send + emit an app log + mark job done.*
- **Why both this and the `""` fallback:** the `""` fallback prevents literal `{{fullPrice}}` leaking for *any* template; the guard additionally prevents PRICE_INFO from sending a blank-money message ("총 금액: 원"). Name-only templates (THANKS/SURVEY/SERVICE_INFO/REMINDER) need no guard — `name` is always present; GREETING/INFO have no variables.

### 5.6 Frontend — `frontend/src/components/app/alimtalk/`

- **`selectedSystemTemplateKey` (`TriggerRulesManager.tsx:337-343`):** replace the hardcoded `SERVICE_INFO/CLIENT_GREETING` ternary with a lookup into shared `SMS_TRIGGER_TO_SYSTEM_TEMPLATE[formState.templateKey] ?? ""`. The preview then shows the real system-template body for all 7.
- **Three exhaustive `Record<TriggerTemplateKey, …>` maps** must gain the 5 new keys (else TS2741):
  - `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS` (`TriggerRulesManager.tsx:196-231`) — fallback body per key (use the system template's intent; preview already uses the real body via §5.6 lookup, so this is only a fallback).
  - `TEMPLATE_LABELS` (`UpcomingAlimtalkManager.tsx:57-64`) and (`AlimtalkHistoryManager.tsx:55-62`) — **use the system registry `name` as the canonical user-facing label** (same value as each catalog entry's `name` in §5.2), so the form dropdown, upcoming, and history views agree: `PRICE_INFO`="비용 안내", `REMINDER`="리마인드", `THANKS`="예약 완료(입금 확인)", `SURVEY`="모니터링 설문", `INFO`="정보 요청". (The delivery `title` in §5.3 is a separate ops/log string and may differ — e.g. existing `CLIENT_GREETING` name "인사(소개)" vs title "인사 메시지" — this is pre-existing and intentional.)
- No bespoke UI. The data-driven dropdowns (event / template) already render the new options once the catalog + `SMS_TRIGGER_TEMPLATE_KEYS` include them.

## 6. Data-availability double-check (the "double check" requirement)

Every variable any of the 7 templates needs maps to a real client field:

| Variable | Source | Nullable? |
|---|---|---|
| name | `client.name` | no |
| weeks | `Math.floor(client.duration / 5)` | derived (null duration → "0") |
| duration | `client.duration` | yes (Int?) |
| type | `client.type` | yes |
| fullPrice | `client.fullPrice` | yes |
| grant | `client.grant` | yes |
| actualPrice | `client.actualPrice` | yes |
| bankName | `client.area.bankAccountInfo.bankName` | yes |
| accNum | `client.area.bankAccountInfo.accNum` | yes |

**Conclusion:** all sourceable. Only `PRICE_INFO` depends on the nullable money/bank fields — handled by §5.5's skip-and-log. The other 6 need only `name` (or nothing) → safe for every client.

## 7. Migration & compatibility

- **No DB migration.** `template_key` is a string column; adding catalog/enum/union values needs no schema change and no seed (users opt in by creating rules).
- **Existing rules unaffected.** The seeded `CLIENT_GREETING` rule and the `SERVICE_INFO` default keep working; widening `allowedEventTypes` only changes what the **form** offers for new/edited rules, never stored rules.
- **No retro-blast.** The Phase C `IMMEDIATE` anti-backfill guard in `rebuildJobsForRule` still applies; the only IMMEDIATE-eligible event remains `CLIENT_CREATED`.
- **Ship together.** Backend (catalog + delivery + mapper + guard) and frontend (shared union + maps) must release in one deploy; a frontend offering a template the backend can't deliver would fail at send.

## 8. Out of scope

- The `/alimtalk` channel form and its 4 alimtalk trigger templates (unchanged).
- Employee recipients and `EMPLOYEE_ASSIGNED`.
- Adding/editing the system templates' content (consumed as-is from the registry).
- Per-client conditional template content beyond the PRICE_INFO guard.

## 9. Testing strategy

- **Backend unit:**
  - Drift guard (extend existing): `SMS_TEMPLATE_DELIVERY` keys === shared `SMS_TRIGGER_TEMPLATE_KEYS` (now 7).
  - Generic mapper: given a client with full price+bank → full bag; with nulls → `""` fallbacks, no `{{}}` leak.
  - PRICE_INFO guard: full data → sends; missing any essential field → skips, logs, job marked done (not retried).
  - `triggerType` derivation: new template on each event → correct derived string; `SERVICE_INFO`/`CLIENT_GREETING` → pinned strings unchanged.
  - Existing alimtalk `switch` cases byte-identical (regression).
- **Frontend:** type-check passes with the widened union (the 3 maps exhaustive); `selectedSystemTemplateKey` resolves all 7 via the shared bridge.
- **Manual smoke:** create each of the 5 new rules via the SMS form (free event pairing); add a test client → correct rendered SMS within ~1 min; a client missing price/bank with a PRICE_INFO rule → skipped (no blank SMS), skip visible in log.

## 10. Files touched

- `packages/shared/src/types/alimtalk.ts` — union + `SMS_TRIGGER_TEMPLATE_KEYS` + `SMS_TRIGGER_TO_SYSTEM_TEMPLATE`
- `backend/domain/constants/alimtalk-trigger-catalog.ts` — enum + 5 entries + widen 2 existing `allowedEventTypes`
- `backend/application/services/alimtalk-trigger-delivery.service.ts` — 5 delivery entries + optional/derived `triggerType` + PRICE_INFO guard
- `backend/application/services/alimtalk-trigger.service.ts` — widen client select + `ClientTriggerSource` + generic SMS variable builder + route in `buildClientTemplateVariables`
- `frontend/src/components/app/alimtalk/TriggerRulesManager.tsx` — data-driven `selectedSystemTemplateKey` + `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`
- `frontend/src/components/app/alimtalk/UpcomingAlimtalkManager.tsx`, `AlimtalkHistoryManager.tsx` — `TEMPLATE_LABELS`
- Tests: `backend/test/services/alimtalk-trigger-delivery.service.spec.ts` (+ trigger.service spec as needed)

## 11. Verification points the plan must resolve (not blockers)

1. `listTemplates(provider)`'s exact filter — confirm `providers` entries make the new templates surface in the SMS form for the branch's resolved provider.
2. The job-completion/retry path — confirm a PRICE_INFO skip marks the job terminally done (not retried each cron tick).
3. The job's eventType is reachable in `sendSmsJob` for `triggerType` derivation (on `job` or `payload`); if not, thread it through.
4. The alimtalk log schema — whether a first-class "skipped" status exists; if not, fall back to (don't send + app log + mark done).
5. Frontend `SystemTemplateKey` availability — confirm the preview component accepts the shared bridge's string value.

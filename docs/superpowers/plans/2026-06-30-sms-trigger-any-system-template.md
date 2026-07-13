# SMS 발송 규칙 — 7개 시스템 템플릿 전체 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an SMS 자동 발송 규칙 freely pair any of 3 client events with any of the 7 system message templates (not just the 2 wired today), with a data guard so 비용 안내 never sends a blank-money SMS.

**Architecture:** Extend the existing "trigger template → bridges to a SystemTemplate for its SMS body" precedent (Phase C). Add the 5 missing system templates as `AlimtalkTriggerTemplateKey` catalog entries; the already-data-driven form, the `SMS_TEMPLATE_DELIVERY` router, the `getTriggerTemplateChannel` classifier, and the drift-guard test all pick them up. A new pure `buildSmsClientVariables` mapper fills the full variable bag from client (+ area bank account); a delivery-time guard cancels PRICE_INFO jobs missing essential price/bank fields.

**Tech Stack:** NestJS + Prisma (backend), Next.js + React Query (frontend), TypeScript monorepo with `@babyjamjam/shared` (consumed as source), Jest.

## Global Constraints

- The 7 SMS trigger templates are exactly: `SERVICE_INFO, CLIENT_GREETING, PRICE_INFO, REMINDER, THANKS, SURVEY, INFO`.
- Trigger→system bridge: `CLIENT_GREETING → GREETING`; every other SMS key bridges to the system template of the **same name**.
- Every SMS template's `allowedEventTypes` = `[CLIENT_CREATED, SERVICE_START, SERVICE_END]` (free pairing); `allowedRecipientTypes` = `[CLIENT]`.
- `weeks = Math.floor(duration / 5)`.
- Missing template variables must render as `""` (never a literal `{{x}}`): `renderTemplate` leaves unknown keys verbatim, so the mapper fills all keys.
- **PRICE_INFO data guard:** at delivery, if any of `fullPrice, actualPrice, bankName, accNum` is blank → cancel the job (`job.cancel`) + `logger.warn`, return `false`; do **not** send, do **not** write an `alimtalk_log` row.
- **`triggerType` is a fixed, event-agnostic string per template** (informational only — it lives inside the log's `variables` JSON, not a column, not used for retry/dedup). This **supersedes spec §5.3's "derive from event" idea**: the job entity carries no `eventType`, and deriving it would need needless plumbing. The 2 legacy templates keep their existing `triggerType` strings byte-for-byte.
- **No DB migration** (`template_key` is a string column; no schema change, no seed).
- **Ship frontend + backend together** (a form offering a template the backend can't deliver would fail at send).
- Backend and shared keep **separate** template-key definitions by design (backend `enum` in `domain/constants`, shared `union`). The drift-guard test ties `SMS_TEMPLATE_DELIVERY` (backend) to `SMS_TRIGGER_TEMPLATE_KEYS` (shared) — both must list the same 7.

## Execution order & parallelism

Dependency graph: **Task 1** (catalog) → **Task 2** (shared+delivery wiring) → {**Task 4** (guard), **Task 5** (frontend)}; **Task 3** (mapper) depends only on Task 1. **Task 6** is final verification.

- Safe parallel batch after Task 2: **Task 3**, **Task 4**, **Task 5** touch disjoint files (Task 3 = `trigger.service.ts` + new mapper file; Task 4 = `delivery.service.ts`; Task 5 = frontend + `channel.ts`). Task 4 shares `delivery.service.ts` with Task 2, so it must run **after** Task 2.
- **Expected transient:** between Task 2 and Task 5, `pnpm --filter ./frontend type-check` is RED (the union grew → the 3 `Record<TriggerTemplateKey,…>` maps are non-exhaustive). Task 2's gate is backend-only; Task 5 restores frontend green. This is normal for a cross-package union change.

---

### Task 1: Backend catalog — define the 5 new trigger templates

**Files:**
- Modify: `backend/domain/constants/alimtalk-trigger-catalog.ts` (enum ~21-28; entries ~117-177)

**Interfaces:**
- Produces: 5 new `AlimtalkTriggerTemplateKey` enum members (`PRICE_INFO, REMINDER, THANKS, SURVEY, INFO`) and their `ALIMTALK_TRIGGER_TEMPLATE_CATALOG` entries; widened `allowedEventTypes` on `SERVICE_INFO` and `CLIENT_GREETING`. Consumed by Task 2 (delivery map keys), Task 3 (mapper switch cases).

- [ ] **Step 1: Add the 5 enum members**

In `alimtalk-trigger-catalog.ts`, extend the enum:
```ts
export enum AlimtalkTriggerTemplateKey {
    CLIENT_WELCOME = "CLIENT_WELCOME",
    SERVICE_START_REMINDER = "SERVICE_START_REMINDER",
    SERVICE_INFO = "SERVICE_INFO",
    SERVICE_END_REMINDER = "SERVICE_END_REMINDER",
    EMPLOYEE_ASSIGNED = "EMPLOYEE_ASSIGNED",
    CLIENT_GREETING = "CLIENT_GREETING",
    PRICE_INFO = "PRICE_INFO",
    REMINDER = "REMINDER",
    THANKS = "THANKS",
    SURVEY = "SURVEY",
    INFO = "INFO",
}
```

- [ ] **Step 2: Add a shared client-events constant (DRY)**

Near the top of the catalog module (after the imports / enum), add:
```ts
// Free pairing: every SMS (system-template) trigger may fire on any client lifecycle event.
const CLIENT_EVENT_TYPES = [
    AlimtalkTriggerEventType.CLIENT_CREATED,
    AlimtalkTriggerEventType.SERVICE_START,
    AlimtalkTriggerEventType.SERVICE_END,
];
```

- [ ] **Step 3: Widen the 2 existing SMS entries' `allowedEventTypes`**

In the `SERVICE_INFO` entry (~line 121) change `allowedEventTypes: [AlimtalkTriggerEventType.SERVICE_START],` → `allowedEventTypes: CLIENT_EVENT_TYPES,`.
In the `CLIENT_GREETING` entry (~line 170) change `allowedEventTypes: [AlimtalkTriggerEventType.CLIENT_CREATED],` → `allowedEventTypes: CLIENT_EVENT_TYPES,`.

- [ ] **Step 4: Add the 5 new catalog entries**

Add these to the `ALIMTALK_TRIGGER_TEMPLATE_CATALOG` object (alongside the existing entries):
```ts
    [AlimtalkTriggerTemplateKey.PRICE_INFO]: {
        key: AlimtalkTriggerTemplateKey.PRICE_INFO,
        name: "비용 안내",
        description: "고객에게 비용·계좌 정보를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [
            { key: "name", label: "산모님 성함" },
            { key: "weeks", label: "주수" },
            { key: "duration", label: "이용일수" },
            { key: "type", label: "바우처 유형" },
            { key: "fullPrice", label: "총 금액" },
            { key: "grant", label: "정부지원금" },
            { key: "actualPrice", label: "본인부담금" },
            { key: "bankName", label: "입금 은행" },
            { key: "accNum", label: "계좌번호" },
        ],
        providers: {
            aligo: { templateKey: "PRICE_INFO" },
            channeltalk: { templateKey: "price_info" },
        },
    },
    [AlimtalkTriggerTemplateKey.REMINDER]: {
        key: AlimtalkTriggerTemplateKey.REMINDER,
        name: "리마인드",
        description: "고객에게 일정 리마인드를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            aligo: { templateKey: "REMINDER" },
            channeltalk: { templateKey: "reminder" },
        },
    },
    [AlimtalkTriggerTemplateKey.THANKS]: {
        key: AlimtalkTriggerTemplateKey.THANKS,
        name: "예약 완료(입금 확인)",
        description: "고객에게 예약 완료/입금 확인 메시지를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            aligo: { templateKey: "THANKS" },
            channeltalk: { templateKey: "thanks" },
        },
    },
    [AlimtalkTriggerTemplateKey.SURVEY]: {
        key: AlimtalkTriggerTemplateKey.SURVEY,
        name: "모니터링 설문",
        description: "고객에게 모니터링 설문 안내를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [{ key: "name", label: "산모님 성함" }],
        providers: {
            aligo: { templateKey: "SURVEY" },
            channeltalk: { templateKey: "survey" },
        },
    },
    [AlimtalkTriggerTemplateKey.INFO]: {
        key: AlimtalkTriggerTemplateKey.INFO,
        name: "정보 요청",
        description: "고객에게 정보 안내 메시지를 SMS로 발송",
        allowedEventTypes: CLIENT_EVENT_TYPES,
        allowedRecipientTypes: [AlimtalkTriggerRecipientType.CLIENT],
        requiredVariables: [],
        providers: {
            aligo: { templateKey: "INFO" },
            channeltalk: { templateKey: "info" },
        },
    },
```

- [ ] **Step 5: Type-check (the catalog Record is exhaustive — this is the gate)**

Run: `pnpm --filter ./backend type-check`
Expected: PASS (adding enum members without entries would fail `Record<AlimtalkTriggerTemplateKey, …>` exhaustiveness; entries present → clean).

- [ ] **Step 6: Run the trigger suites to confirm no regression**

Run: `pnpm --filter ./backend test -- alimtalk-trigger`
Expected: PASS, including the existing drift-guard test (still `2 === 2`: SMS_TEMPLATE_DELIVERY and SMS_TRIGGER_TEMPLATE_KEYS are untouched in this task).

- [ ] **Step 7: Commit**
```bash
git commit -m "feat(trigger-catalog): add PRICE_INFO/REMINDER/THANKS/SURVEY/INFO SMS templates + free-pairing events" -- backend/domain/constants/alimtalk-trigger-catalog.ts
```

---

### Task 2: Shared SMS wiring + backend delivery routing

**Files:**
- Modify: `packages/shared/src/types/alimtalk.ts` (union ~35-41; `SMS_TRIGGER_TEMPLATE_KEYS` ~46-49; add bridge map)
- Modify: `backend/application/services/alimtalk-trigger-delivery.service.ts` (`SMS_TEMPLATE_DELIVERY` ~35-50)
- Test: `backend/test/services/alimtalk-trigger-delivery.service.spec.ts` (existing drift-guard, ~238-247)

**Interfaces:**
- Consumes: the 5 enum members + `SystemTemplateKey` members `PRICE_INFO/REMINDER/THANKS/SURVEY/INFO` (already exist in `system-template-registry.ts`).
- Produces: shared `SMS_TRIGGER_TO_SYSTEM_TEMPLATE: Partial<Record<AlimtalkTriggerTemplateKey, SystemTemplateKey>>` (consumed by Task 5 preview); 7-entry `SMS_TEMPLATE_DELIVERY` and `SMS_TRIGGER_TEMPLATE_KEYS`.

- [ ] **Step 1: Extend the shared union**

In `packages/shared/src/types/alimtalk.ts`:
```ts
export type AlimtalkTriggerTemplateKey =
  | "CLIENT_WELCOME"
  | "SERVICE_START_REMINDER"
  | "SERVICE_INFO"
  | "SERVICE_END_REMINDER"
  | "EMPLOYEE_ASSIGNED"
  | "CLIENT_GREETING"
  | "PRICE_INFO"
  | "REMINDER"
  | "THANKS"
  | "SURVEY"
  | "INFO";
```

- [ ] **Step 2: Add the bridge map (single source of truth for the preview + delivery)**

At the top of `alimtalk.ts` add the import, and add the map near `SMS_TRIGGER_TEMPLATE_KEYS`:
```ts
import type { SystemTemplateKey } from "./system-template";

// Which system template's body each SMS trigger template renders. One source of truth for
// both the backend SMS delivery (SMS_TEMPLATE_DELIVERY.systemTemplateKey) and the form preview.
export const SMS_TRIGGER_TO_SYSTEM_TEMPLATE: Partial<Record<AlimtalkTriggerTemplateKey, SystemTemplateKey>> = {
  SERVICE_INFO: "SERVICE_INFO",
  CLIENT_GREETING: "GREETING",
  PRICE_INFO: "PRICE_INFO",
  REMINDER: "REMINDER",
  THANKS: "THANKS",
  SURVEY: "SURVEY",
  INFO: "INFO",
};
```

- [ ] **Step 3: Extend `SMS_TRIGGER_TEMPLATE_KEYS` and run the drift test → RED**

```ts
export const SMS_TRIGGER_TEMPLATE_KEYS: AlimtalkTriggerTemplateKey[] = [
  "SERVICE_INFO",
  "CLIENT_GREETING",
  "PRICE_INFO",
  "REMINDER",
  "THANKS",
  "SURVEY",
  "INFO",
];
```
Run: `pnpm --filter ./backend test -- alimtalk-trigger-delivery`
Expected: **FAIL** on "routes exactly the shared SMS template set through SMS delivery" — `deliveryKeys` (2) ≠ `sharedKeys` (7). This is the intended RED.

- [ ] **Step 4: Add the 5 delivery configs → GREEN**

In `alimtalk-trigger-delivery.service.ts`, add to `SMS_TEMPLATE_DELIVERY` (after the `CLIENT_GREETING` entry):
```ts
    [AlimtalkTriggerTemplateKey.PRICE_INFO]: {
        smsLogTemplateKey: "price_info_sms",
        automationKey: "PRICE_INFO_SMS",
        triggerType: "price_info",
        title: "비용 안내",
        systemTemplateKey: SystemTemplateKey.PRICE_INFO,
    },
    [AlimtalkTriggerTemplateKey.REMINDER]: {
        smsLogTemplateKey: "reminder_sms",
        automationKey: "REMINDER_SMS",
        triggerType: "reminder",
        title: "리마인드",
        systemTemplateKey: SystemTemplateKey.REMINDER,
    },
    [AlimtalkTriggerTemplateKey.THANKS]: {
        smsLogTemplateKey: "thanks_sms",
        automationKey: "THANKS_SMS",
        triggerType: "thanks",
        title: "예약 완료",
        systemTemplateKey: SystemTemplateKey.THANKS,
    },
    [AlimtalkTriggerTemplateKey.SURVEY]: {
        smsLogTemplateKey: "survey_sms",
        automationKey: "SURVEY_SMS",
        triggerType: "survey",
        title: "모니터링 설문",
        systemTemplateKey: SystemTemplateKey.SURVEY,
    },
    [AlimtalkTriggerTemplateKey.INFO]: {
        smsLogTemplateKey: "info_sms",
        automationKey: "INFO_SMS",
        triggerType: "info",
        title: "정보 안내",
        systemTemplateKey: SystemTemplateKey.INFO,
    },
```
Run: `pnpm --filter ./backend test -- alimtalk-trigger-delivery`
Expected: **PASS** (`deliveryKeys` (7) === `sharedKeys` (7)).

- [ ] **Step 5: Backend type-check**

Run: `pnpm --filter ./backend type-check`
Expected: PASS. (Frontend type-check is expected RED until Task 5 — do not run it as this task's gate.)

- [ ] **Step 6: Commit**
```bash
git commit -m "feat(sms-trigger): route 5 system templates through SMS + shared bridge map" -- packages/shared/src/types/alimtalk.ts backend/application/services/alimtalk-trigger-delivery.service.ts
```

---

### Task 3: Generic client → SMS variable mapper

**Files:**
- Create: `backend/application/services/sms-client-variables.ts`
- Test: `backend/test/services/sms-client-variables.spec.ts`
- Modify: `backend/application/services/alimtalk-trigger.service.ts` (`ClientTriggerSource` ~121-129; client `select` ~385-393 and ~537-545; `buildClientTemplateVariables` ~654-691)

**Interfaces:**
- Produces: `buildSmsClientVariables(client: SmsClientVariableSource): Record<string, string>` returning keys `name, clientName, phone, weeks, duration, type, fullPrice, grant, actualPrice, bankName, accNum`. Consumed by `buildClientTemplateVariables` for all 7 SMS templates.

- [ ] **Step 1: Write the failing test**

Create `backend/test/services/sms-client-variables.spec.ts`:
```ts
import { buildSmsClientVariables } from "application/services/sms-client-variables";

describe("buildSmsClientVariables", () => {
    it("fills every PRICE_INFO variable from a fully-populated client", () => {
        const vars = buildSmsClientVariables({
            name: "김지니",
            phone: "010-1234-5678",
            type: "단태아 첫째아 A가1형",
            duration: 20,
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            area: { bankAccountInfo: { bankName: "국민", accNum: "123-45-6789" } },
        });
        expect(vars).toEqual({
            name: "김지니",
            clientName: "김지니",
            phone: "010-1234-5678",
            weeks: "4",
            duration: "20",
            type: "단태아 첫째아 A가1형",
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
        });
    });

    it("computes weeks as floor(duration / 5)", () => {
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, duration: 23 }).weeks).toBe("4");
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, duration: 5 }).weeks).toBe("1");
    });

    it("falls back to empty strings (no literal placeholders) when fields are null", () => {
        const vars = buildSmsClientVariables({ name: "박산모", phone: null, type: null });
        expect(vars.weeks).toBe("0");
        expect(vars.duration).toBe("");
        expect(vars.fullPrice).toBe("");
        expect(vars.bankName).toBe("");
        expect(vars.accNum).toBe("");
        expect(vars.name).toBe("박산모");
    });

    it("handles a missing area / bankAccountInfo relation", () => {
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, area: null }).bankName).toBe("");
        expect(
            buildSmsClientVariables({ name: "A", phone: null, type: null, area: { bankAccountInfo: null } }).accNum,
        ).toBe("");
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./backend test -- sms-client-variables`
Expected: FAIL — "Cannot find module 'application/services/sms-client-variables'".

- [ ] **Step 3: Create the mapper**

Create `backend/application/services/sms-client-variables.ts`:
```ts
export interface SmsClientVariableSource {
    name: string;
    phone: string | null;
    type: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}

/**
 * Builds the full SMS template variable bag from a client (+ its area's bank account).
 * Every value is coerced to a string with a "" fallback so the renderer never leaks a
 * literal {{placeholder}}. The PRICE_INFO delivery guard separately blocks sending when
 * essential money/bank fields are blank.
 */
export function buildSmsClientVariables(client: SmsClientVariableSource): Record<string, string> {
    const duration = client.duration ?? null;
    const weeks = duration != null ? Math.floor(duration / 5) : 0;
    return {
        name: client.name,
        clientName: client.name,
        phone: client.phone ?? "",
        weeks: String(weeks),
        duration: duration != null ? String(duration) : "",
        type: client.type ?? "",
        fullPrice: client.fullPrice ?? "",
        grant: client.grant ?? "",
        actualPrice: client.actualPrice ?? "",
        bankName: client.area?.bankAccountInfo?.bankName ?? "",
        accNum: client.area?.bankAccountInfo?.accNum ?? "",
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./backend test -- sms-client-variables`
Expected: PASS (4 tests).

- [ ] **Step 5: Widen `ClientTriggerSource`**

In `alimtalk-trigger.service.ts` replace the interface (~121-129):
```ts
interface ClientTriggerSource {
    id: number;
    name: string;
    phone: string | null;
    type: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdAt?: Date | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}
```

- [ ] **Step 6: Widen both client `select`s to load the new fields + bank join**

In `syncClientRulesForClient` (~385) and the rebuild path (~537), add the five lines to each `select` block (keep the existing `...(supportsCreatedAt ? { createdAt: true } : {})`):
```ts
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } },
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
```

- [ ] **Step 7: Route the 7 SMS templates through the mapper**

Add the import at the top of `alimtalk-trigger.service.ts`:
```ts
import { buildSmsClientVariables } from "./sms-client-variables";
```
In `buildClientTemplateVariables` (~654): change the param type from `client: Pick<ClientTriggerSource, "name" | "phone" | "type" | "startDate" | "endDate" | "createdAt">` to `client: ClientTriggerSource`, then replace the `SERVICE_INFO` and `CLIENT_GREETING` cases with a single fall-through covering all 7 SMS keys. The full switch becomes:
```ts
        switch (rule.templateKey) {
            case AlimtalkTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    clientName: client.name,
                    registrationDate: this.formatDate(client.createdAt ?? null),
                    serviceType: client.type ?? "방문요양",
                };
            case AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    clientName: client.name,
                    serviceStartDate: this.formatDate(client.startDate),
                    timingText: this.describeTiming(rule, "서비스 시작"),
                };
            case AlimtalkTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    clientName: client.name,
                    serviceEndDate: this.formatDate(client.endDate),
                    timingText: this.describeTiming(rule, "서비스 종료"),
                };
            case AlimtalkTriggerTemplateKey.SERVICE_INFO:
            case AlimtalkTriggerTemplateKey.CLIENT_GREETING:
            case AlimtalkTriggerTemplateKey.PRICE_INFO:
            case AlimtalkTriggerTemplateKey.REMINDER:
            case AlimtalkTriggerTemplateKey.THANKS:
            case AlimtalkTriggerTemplateKey.SURVEY:
            case AlimtalkTriggerTemplateKey.INFO:
                return buildSmsClientVariables(client);
            default:
                return {};
        }
```
(Behavior-preserving for SERVICE_INFO/CLIENT_GREETING: the GREETING body has no placeholders, and the SERVICE_INFO body uses only `{{name}}` — the extra keys in the bag are ignored by `renderTemplate`.)

- [ ] **Step 8: Type-check + run trigger suites**

Run: `pnpm --filter ./backend type-check && pnpm --filter ./backend test -- alimtalk-trigger sms-client-variables`
Expected: PASS. If `alimtalk-trigger.service.spec.ts` asserts the exact variable bag for SERVICE_INFO/CLIENT_GREETING, update those expectations to the full bag from `buildSmsClientVariables` (render output is unchanged).

- [ ] **Step 9: Commit**
```bash
git commit -m "feat(trigger): generic client->SMS variable mapper (price/bank), widen client load" -- backend/application/services/sms-client-variables.ts backend/test/services/sms-client-variables.spec.ts backend/application/services/alimtalk-trigger.service.ts
```

---

### Task 4: PRICE_INFO delivery data guard (skip-and-cancel)

**Files:**
- Modify: `backend/application/services/alimtalk-trigger-delivery.service.ts` (`sendSmsJob` ~121-174)
- Test: `backend/test/services/alimtalk-trigger-delivery.service.spec.ts`

**Interfaces:**
- Consumes: `SMS_TEMPLATE_DELIVERY[PRICE_INFO]` (Task 2), `job.cancel(reason)`, `this.logger`.
- Produces: PRICE_INFO jobs with blank `fullPrice/actualPrice/bankName/accNum` are canceled (not sent, not logged, not retried).

- [ ] **Step 1: Write the failing tests**

Add to `alimtalk-trigger-delivery.service.spec.ts` a `describe("PRICE_INFO data guard", …)`. Reuse the existing service-construction pattern (7 ctor args). Helper to build a PRICE_INFO job:
```ts
    const createPriceInfoJob = (templateVariables: Record<string, string>) =>
        AlimtalkTriggerJobEntity.reconstitute(
            "job-price-info",
            "branch-1",
            "rule-price-info",
            "pending",
            new Date("2026-06-30T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            AlimtalkTriggerRecipientType.CLIENT,
            "010-1234-5678",
            AlimtalkTriggerTemplateKey.PRICE_INFO,
            "rule-price-info:7",
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables,
            },
            new Date("2026-06-30T00:00:00.000Z"),
            new Date("2026-06-30T00:00:00.000Z"),
        );

    const buildService = (overrides: { aligoService: any; logRepository: any; systemTemplateService?: any }) =>
        new AlimtalkTriggerDeliveryService(
            { getAlimtalkProvider: jest.fn() } as unknown as SystemSettingService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            overrides.aligoService as unknown as AligoService,
            (overrides.systemTemplateService ?? {
                getByKey: jest.fn().mockResolvedValue({ content: "총 금액 {{fullPrice}}원 / {{bankName}} {{accNum}}" }),
            }) as unknown as SystemTemplateService,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            overrides.logRepository as unknown as IAlimtalkLogRepository,
        );

    it("cancels a PRICE_INFO job and does not send when price/bank data is missing", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({ name: "김지니", fullPrice: "", actualPrice: "", bankName: "", accNum: "" });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("sends a PRICE_INFO job when all essential data is present", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { senderPhone: "01099998888", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 321, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log) => log) };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(true);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        expect(logRepository.save).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ./backend test -- alimtalk-trigger-delivery`
Expected: FAIL on the "cancels … when missing" test — without the guard, the job is sent (or `getByKey`/`sendSms` is called and status is not "canceled").

- [ ] **Step 3: Add the guard**

In `sendSmsJob`, immediately after `baseVariables` is built and before `const message = await this.resolveSmsMessage(...)`, insert:
```ts
        if (config.systemTemplateKey === SystemTemplateKey.PRICE_INFO) {
            const requiredKeys = ["fullPrice", "actualPrice", "bankName", "accNum"];
            const missing = requiredKeys.filter((key) => !baseVariables[key]?.trim());
            if (missing.length > 0) {
                job.cancel(`비용 안내 발송 건너뜀: 필수 정보 누락 (${missing.join(", ")})`);
                this.logger.warn(
                    `[SMS Automation] PRICE_INFO skipped for job ${job.id}: missing ${missing.join(", ")}`,
                );
                return false;
            }
        }
```
(The dispatch loop does `if (sent) markSent(); else if (job.status === "pending") markFailed()` — because `job.cancel()` already set status to `"canceled"`, the `else if` is skipped, the job persists as canceled, and canceled jobs are never re-fetched by `findDuePending` → no retry.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ./backend test -- alimtalk-trigger-delivery`
Expected: PASS (guard + send tests + existing SERVICE_INFO + drift-guard).

- [ ] **Step 5: Commit**
```bash
git commit -m "feat(sms-delivery): skip-and-cancel PRICE_INFO when price/bank data missing" -- backend/application/services/alimtalk-trigger-delivery.service.ts backend/test/services/alimtalk-trigger-delivery.service.spec.ts
```

---

### Task 5: Frontend — data-driven preview + exhaustive label maps

**Files:**
- Modify: `frontend/src/features/alimtalk-triggers/channel.ts` (re-export the bridge map)
- Modify: `frontend/src/components/app/alimtalk/TriggerRulesManager.tsx` (`selectedSystemTemplateKey` ~337-343; `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS` ~196-231)
- Modify: `frontend/src/components/app/alimtalk/UpcomingAlimtalkManager.tsx` (`TEMPLATE_LABELS` ~57-64)
- Modify: `frontend/src/components/app/alimtalk/AlimtalkHistoryManager.tsx` (`TEMPLATE_LABELS` ~55-62)

**Interfaces:**
- Consumes: shared `SMS_TRIGGER_TO_SYSTEM_TEMPLATE` (Task 2). `useSystemTemplate(key: string)` (existing) fetches `GET /system-templates/${key}`.

- [ ] **Step 1: Re-export the bridge map from channel.ts**

In `frontend/src/features/alimtalk-triggers/channel.ts`, extend the shared import and re-export:
```ts
import {
  SMS_TRIGGER_TEMPLATE_KEYS,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
  getTriggerTemplateChannel,
} from "@babyjamjam/shared/types/alimtalk";

export { SMS_TRIGGER_TEMPLATE_KEYS, SMS_TRIGGER_TO_SYSTEM_TEMPLATE, getTriggerTemplateChannel };
```

- [ ] **Step 2: Make `selectedSystemTemplateKey` data-driven**

In `TriggerRulesManager.tsx`, add `SMS_TRIGGER_TO_SYSTEM_TEMPLATE` to the existing import from `channel.ts`, then replace the ternary (~337-343):
```ts
const selectedSystemTemplateKey = SMS_TRIGGER_TO_SYSTEM_TEMPLATE[formState.templateKey] ?? "";
const { data: selectedSystemTemplate } = useSystemTemplate(selectedSystemTemplateKey);
```
(All 7 SMS templates now resolve their real system-template body in the preview; alimtalk keys map to `undefined → ""` and fall back to `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`, unchanged.)

- [ ] **Step 3: Add the 5 keys to `TRIGGER_TEMPLATE_MESSAGE_FALLBACKS`**

In `TriggerRulesManager.tsx` (~196-231), add (these are fallbacks only — the live preview uses the real system-template content fetched in Step 2):
```ts
  PRICE_INFO: `[아이미래 인천]
비용 안내드립니다. 자세한 내용은 담당자에게 문의해 주세요.`,
  REMINDER: `[아이미래 인천]
#{고객명}님, 일정 리마인드 안내드립니다.`,
  THANKS: `[아이미래 인천]
#{고객명}님, 예약이 완료되었습니다. 감사합니다.`,
  SURVEY: `[아이미래 인천]
#{고객명}님, 모니터링 설문 부탁드립니다.`,
  INFO: `[아이미래 인천]
안내드립니다.`,
```

- [ ] **Step 4: Add the 5 keys to both `TEMPLATE_LABELS` maps**

In `UpcomingAlimtalkManager.tsx` (~57-64) and `AlimtalkHistoryManager.tsx` (~55-62), add to each map (canonical registry names):
```ts
  PRICE_INFO: "비용 안내",
  REMINDER: "리마인드",
  THANKS: "예약 완료(입금 확인)",
  SURVEY: "모니터링 설문",
  INFO: "정보 요청",
```

- [ ] **Step 5: Frontend type-check (the exhaustive maps are the gate)**

Run: `pnpm --filter ./frontend type-check`
Expected: PASS (all three `Record<TriggerTemplateKey, …>` maps exhaustive again; `selectedSystemTemplateKey` typed `SystemTemplateKey | ""`).

- [ ] **Step 6: Commit**
```bash
git commit -m "feat(trigger-form): data-driven preview for all 7 SMS templates + label maps" -- frontend/src/features/alimtalk-triggers/channel.ts frontend/src/components/app/alimtalk/TriggerRulesManager.tsx frontend/src/components/app/alimtalk/UpcomingAlimtalkManager.tsx frontend/src/components/app/alimtalk/AlimtalkHistoryManager.tsx
```

---

### Task 6: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Type-check both packages**

Run: `pnpm --filter ./backend type-check && pnpm --filter ./frontend type-check`
Expected: PASS for both.

- [ ] **Step 2: Run all touched suites**

Run: `pnpm --filter ./backend test -- alimtalk-trigger alimtalk-trigger-delivery sms-client-variables`
Expected: PASS, including the drift-guard (7 === 7).

- [ ] **Step 3: Manual smoke (dev server)**

On an SMS-approved branch in the running dev app:
1. Open the SMS 발송 규칙 panel → "새 규칙". Confirm the **발송 템플릿** dropdown lists all 7 (비용 안내 / 인사(소개) / 서비스 안내 / 리마인드 / 예약 완료(입금 확인) / 모니터링 설문 / 정보 요청) and the **이벤트 기준** dropdown lists 고객 등록 / 서비스 시작 / 서비스 종료 (free pairing).
2. Select 비용 안내 → the preview shows the real PRICE_INFO body with sample variables.
3. Create a rule (e.g. 서비스 종료 → 3일 후 → 모니터링 설문, 고객) → it saves and appears as a toggle-able row.
4. Add a test client **with** price+bank data on that branch + a PRICE_INFO IMMEDIATE rule → exactly one rendered SMS in the log within ~1 min.
5. Add a client **without** price/bank data + a PRICE_INFO rule → no SMS; the job shows canceled with reason "비용 안내 발송 건너뜀…" (and a `logger.warn` in server logs).

- [ ] **Step 4: Confirm deploy constraints**

- No new Prisma migration was created (none required).
- Backend + frontend ship in the **same** release (Global Constraints).

---

## Self-Review

**1. Spec coverage:**
- §5.1 shared (union, keys, bridge) → Task 2. ✓
- §5.2 catalog (5 entries + widen + providers) → Task 1. ✓
- §5.3 delivery (5 configs; triggerType) → Task 2 (triggerType simplified to fixed strings per Global Constraints; spec amended). ✓
- §5.4 generic mapper (widen select + bag + route) → Task 3. ✓
- §5.5 PRICE_INFO guard → Task 4. ✓
- §5.6 frontend (bridge preview + 3 maps) → Task 5. ✓
- §6 data double-check → Task 3 mapper fills all; §7 no migration → Task 6. ✓
- §11 verification points all resolved in scouting (provider filter, job-skip via cancel, no eventType on job → fixed triggerType, no skipped log status → cancel+warn, frontend SystemTemplateKey in shared). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**3. Type consistency:** `buildSmsClientVariables(SmsClientVariableSource)` ⊇ widened `ClientTriggerSource`; `SMS_TRIGGER_TO_SYSTEM_TEMPLATE` typed `Partial<Record<AlimtalkTriggerTemplateKey, SystemTemplateKey>>` consumed as `SystemTemplateKey | ""` by `useSystemTemplate(string)`; delivery configs match `SmsTemplateDeliveryConfig` (triggerType required — provided). ✓

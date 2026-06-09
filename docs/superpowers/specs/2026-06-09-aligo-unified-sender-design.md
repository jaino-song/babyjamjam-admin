# Unify aligo sending number to `1661-2386`

**Date:** 2026-06-09
**Branch:** `feat/aligo-unified-sender`
**Status:** Design approved — pending spec review

## Problem

Today every tenant (branch) registers their **own** mobile phone number to use the
messaging feature. The flow is: a branch submits a number → it is stored on
`branch.sms_sender_phone` with `sms_sender_approval_status = pending` → an
owner/operator approves → SMS is then sent **from that branch's number**.

This is operationally heavy: each tenant's number must be pre-registered with aligo
(발신번호 사전등록) before it can be used, and the operator has to collect and vet a
number per branch.

We are unifying onto a **single sending number, `1661-2386`**, which the company has
already pre-registered with aligo. Tenants no longer provide a number when applying for
messaging permission. The permission gate itself stays — the operator still approves
*which branches may use messaging* — only the phone-number collection is removed.

## Goals

- All aligo sends (alimtalk + SMS, manual + automated) go out from one number, `1661-2386`.
- The messaging-permission application no longer asks for, validates, or stores a number.
- The approval gate is preserved: a branch must be `approved` before it can send.
- Remove the now-orphaned `branch.sms_sender_phone` column. Keep the 6 approval columns.

## Non-goals

- No change to *who* can request/approve (roles stay: owner/admin/manager request; owner approves).
- No change to the alimtalk template system, message scheduling, or delivery logging.
- No new aligo "발신번호 등록" API integration — pre-registration of `1661-2386` is an
  operational precondition handled outside this codebase.
- Not dropping the approval-status columns (only `sms_sender_phone`).

## Key decisions (confirmed)

1. **Permission gate:** keep the approve step; drop only the number field.
2. **Sender config:** constant default `"1661-2386"`, overridable by `ALIGO_SENDER_PHONE`
   env. Digit-normalized (`16612386`) on the wire; human-readable `1661-2386` in UI copy.
3. **DB:** keep the approval columns; drop only `sms_sender_phone` (a targeted destructive
   migration).

## Approach

Make the **aligo client the single owner** of the sending number. Stop threading any
per-branch number through the send paths. Turn `ensureApproved()` into a pure gate.
Make the application flow number-less. Drop the orphaned column.

---

## Change set

### A. Sending — one number everywhere

**`backend/infrastructure/api/aligo-api.client.ts`**
- Introduce `export const DEFAULT_ALIGO_SENDER_PHONE = "1661-2386"`.
- Line 37: `this.ALIGO_SENDER_PHONE = (configService.get("ALIGO_SENDER_PHONE") || DEFAULT_ALIGO_SENDER_PHONE).replace(/\D/g, "")`
  — env override wins; digit-normalized for the wire.
- `sendAlimtalk` (line 59) and `sendSms` (line 110) already use `this.ALIGO_SENDER_PHONE`;
  `sendSms`'s `params.sender ?? this.ALIGO_SENDER_PHONE` now always resolves to the unified
  number because callers stop passing `sender`.
- Side effect: `isConfigured` (lines 38–44) no longer hinges on `ALIGO_SENDER_PHONE` being
  set (it now always has a value). The other 4 aligo creds (`API_URL`, `API_KEY`,
  `USER_ID`, `SENDER_KEY`) still gate it. Update the warning string accordingly.

**`backend/application/services/message-sender-approval.service.ts`**
- `ensureApproved(branchId)` → `Promise<void>`: verify `approvalStatus === "approved"`,
  throw `ForbiddenException` otherwise (reword message to drop "발신번호"). It no longer
  returns or reads a phone.

**Stop passing a from-number in all 3 SMS send paths** (let the client default apply):
- `backend/interface/controllers/message-delivery.controller.ts:41–49,64` — drop the
  `senderPhone` local; call `await ensureApproved(branchId)` for the gate only; remove
  `senderPhone` from the `aligoService.sendSms({...})` argument.
- `backend/application/services/client-greeting-sms-automation.service.ts:33,36` — gate via
  `await ensureApproved(branchId)`; remove `senderPhone` from the `sendSms` call.
- `backend/application/services/alimtalk-trigger-delivery.service.ts:46,103` — same.
- `backend/application/services/alimtalk-trigger.service.ts:288,310` — already ignores the
  return value; no change beyond `ensureApproved` now being `void`.

**Response/log echo (minor):** `message-delivery.controller.ts` response and
`send-sms.usecase` `request.senderPhone` currently echo the per-branch number. After the
change `dto.senderPhone` is `undefined`. Acceptable. UI does not depend on this echo — it
displays the unified number as a static fact (see D). No extra plumbing.

### B. Application flow — drop number, keep gate

**`backend/application/services/message-sender-approval.service.ts`**
- `requestApproval()`: remove the `senderPhone` param and the `PhoneNumber.create` /
  `isMobileSenderPhone` validation; remove `smsSenderPhone` from the `update` data. Still
  sets `status=pending`, `requestedAt`, `requestedBy`, and clears the approved fields.
- `approvePendingRequest()`: drop the `|| !current.smsSenderPhone` precondition; require
  only `status === "pending"`.
- `getState()` + `BranchSenderApprovalRecord`: drop `senderPhone`; stop selecting
  `smsSenderPhone`.
- Remove the now-unused `isMobileSenderPhone` helper and the `PhoneNumber` import.

**`backend/interface/dto/message-sender-approval.dto.ts`**
- `RequestMessageSenderApprovalDto`: remove the `senderPhone` field → empty body.
- `MessageSenderApprovalResponseDto`: remove `senderPhone` / `senderPhoneFormatted` and the
  `PhoneNumber` normalization; `isApproved = approvalStatus === "approved"`.

**`backend/interface/controllers/system-setting.controller.ts`**
- `requestMessageSenderApproval` (line 117–122): stop passing `senderPhone: dto.senderPhone`.
  Body DTO becomes empty; keep the endpoint and guards unchanged.

### C. Persistence

**`backend/prisma/schema.prisma`** (branch model, ~line 270)
- Remove `smsSenderPhone String? @map("sms_sender_phone") @db.VarChar(20)`.
- **Keep** `smsSenderApprovalStatus`, `…RequestedAt`, `…RequestedBy`, `…ApprovedAt`,
  `…ApprovedBy`, and `idx_branch_sms_sender_approval_status`.

**Migration**
- Generate via `prisma migrate dev --name drop_branch_sms_sender_phone`. The generated SQL
  is `ALTER TABLE "branch" DROP COLUMN "sms_sender_phone";` — **destructive**.
- Dev / preview: apply normally (mock data, safe).
- **Production cutover is decision-gated:** run `prisma migrate diff` against the live DB
  and review before applying; the drop must be an intentional, reviewed step (per the
  additive-only-on-live rule). The column carries no data we keep.

**`backend/test/e2e-env/seed-e2e.ts:196,214`**
- Remove the two `smsSenderPhone: "01012345678"` lines.
- Keep `smsSenderApprovalStatus: "approved"` (+ requested/approved timestamps) so SMS E2E
  stays past the gate.

**`backend/application/services/system-admin.service.ts:33,87`**
- Stop selecting `smsSenderPhone`; stop returning `senderPhone`. The system-admin console
  payload no longer carries a per-branch sender number.

### D. UI

Display the unified number as a static product fact (e.g. "문자는 **1661-2386** 번호로
발송됩니다"); remove all number input/validation/display.

- `frontend/src/components/app/messages/MessageTenantApplicationSettings.tsx` — remove the
  phone input, `senderPhone` state, and `isValidSenderPhone`; keep the policy-agreement
  checkboxes + submit. Submit posts an empty body.
- `mobile/src/app/messages/sender-approval/page.tsx` — remove the phone input, formatting,
  and `isMobileSenderPhone`; keep agreements + submit.
- `mobile/src/components/app/messages/MessageSenderApprovalSettings.tsx` — remove the
  registered-number display/edit; keep status + show the unified number as info.
- `frontend/src/components/app/system-admin/OwnerAdminConsole.tsx` — remove the per-branch
  sender-number display in the request detail (~line 1132); keep the approve button.
- `frontend/src/services/api.ts` — drop `senderPhone` / `senderPhoneFormatted` from
  `MessageSenderApprovalResponse`; the request helper posts an empty body.
- Mobile API types/service — same shape changes as the frontend.

### E. Error handling

- Gate failure → unchanged `ForbiddenException` (message reworded to "메시지 발송 권한
  승인이 필요합니다." dropping "발신번호").
- Removed: the invalid-number / mobile-only `BadRequestException`s in `requestApproval`
  (no longer applicable).
- aligo send failures, scheduling validation, and delivery-log behavior are unchanged.

### F. Testing

Update specs that mock a returned from-number or assert `sendSms({ sender… })`:
- `backend/test/services/message-sender-approval.service.spec.ts` — drop `smsSenderPhone`
  mocks/assertions; `requestApproval` no longer takes/validates a number;
  `approvePendingRequest` needs only `pending`; `ensureApproved` resolves `void` when
  approved and throws otherwise.
- `backend/test/interface/controllers/message-delivery.controller.spec.ts` — `ensureApproved`
  mocked as `void`; assert `sendSms` is called **without** `sender`.
- `backend/test/services/client-greeting-sms-automation.service.spec.ts` — same.
- `backend/test/services/alimtalk-trigger-delivery.service.spec.ts` — same.
- `backend/test/services/system-admin.service.spec.ts` — drop `smsSenderPhone` from mocks /
  expected payload.
- Add an `aligo-api.client.spec.ts` case: env unset → sender defaults to `16612386`.
- E2E behavior unchanged (seed branch stays `approved`).

Verification commands: `npm run type-check` (backend, frontend, mobile) and the affected
backend specs; mobile note — `rm -rf mobile/.next` before its type-check to avoid stale
`.next/types` false errors.

---

## Data flow (after)

```
Manual SMS:   POST /message-deliveries/sms
                → ensureApproved(branchId)            [gate only; throws if not approved]
                → aligoService.sendSms({ …, no sender })
                → SendAligoSmsUsecase                  [sender undefined]
                → AligoApiClient.sendSms               [sender = ALIGO_SENDER_PHONE = 16612386]

Automated SMS: client-greeting / trigger-delivery
                → ensureApproved(branchId)            [gate only]
                → aligoService.sendSms({ …, no sender }) → … → 16612386

Alimtalk:     unchanged — already sends from ALIGO_SENDER_PHONE (now defaulted to 16612386)

Application:  POST /settings/message-sender-approval/request   [empty body] → status=pending
              POST /settings/message-sender-approval/:id/approve → status=approved
              GET  /settings/message-sender-approval            → { approvalStatus, isApproved, … } (no number)
```

## Risks / assumptions

- **`1661-2386` is already pre-registered with aligo** as an approved 발신번호. The code
  cannot verify this; it is an operational precondition.
- **Automated SMS senders move to `1661-2386`** as well (greeting, trigger-delivery) — this
  is intended ("one number") but is a behavior change beyond the manual send button.
- **Destructive migration:** dropping `sms_sender_phone` is safe in dev/preview; the prod
  cutover is gated on `migrate diff` review.
- Any external/manual consumer that read the per-branch number from the API response will
  see it absent. Backend has no other reader of `smsSenderPhone` (grep-verified); the
  in-repo response consumers are the UI surfaces in §D — an implementation-time grep for
  `senderPhone` across `frontend/` and `mobile/` confirms none are missed.

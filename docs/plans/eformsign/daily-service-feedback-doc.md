---
plan_id: efsi-2026-002
feature: daily-service-feedback-doc
status: approved
swagger_base: https://api.eformsign.com/v2.0
agent_version: v0.4.0
created_at: 2026-06-27
approved_at: 2026-06-29T08:48:00Z
content_hash: 6e96e4abddb70f89e901eb1926c52522e6b0571768b1a0487eaf144138bcd5f0
depends_on: []
surfaces_touched: [usecases, webhook, dto, schema, module]  # api-client reused UNCHANGED (createDocument)
linear: BJJ-247
mockup: docs/mockups/daily-service-feedback/preview-v3.html
---

## Summary
When a 제공인력 (employee) is assigned to a client, SMS them a no-login link to fill the official **산모·신생아 건강관리 서비스 제공기록지** (인천 아이미래로) for each service session. The link is gated by a date-of-birth challenge that mints an access token lasting the service window. Records are captured in our DB (one row per session, N = `client.duration`), so the variable day-count never hits eformsign's fixed-template limit. Submitted sessions lock (immutable). On completion, the full record is rendered into a single eformsign snapshot and SMS'd to the 제공인력 to sign — gated by `template_id` so the contract is **never** marked complete.

## Requirements
### Goals
- **G1 — No-login DOB-gated capture.** On assignment, SMS a magic link → first open requires the 제공인력's DOB → mint an access token valid until `endDate` + grace buffer.
- **G2 — Dynamic session count.** Exactly N session records, N = `client.duration`; dates default from the schedule, forward-only adjustable (skip-safe). Captured in our DB.
- **G3 — Faithful 제공기록지.** One-time service header + per-session grouped pages (산모 / 신생아 / 마무리) including 결제 확인 (provider checkbox) and 산모 확인서명 (on-device each session).
- **G4 — Edit-block.** Submitted sessions are immutable (server-enforced).
- **G5 — eformsign finalize without contract completion.** One provider-signed snapshot; webhook gated by `template_id` so no `client.eDocId` / `client.endDate` write and no contract alimtalk.
- **G6 — Lifecycle.** Replacement revokes the old token + issues a new link to the new provider; termination / `endDate`+buffer expiry revoke access.

### Non-Goals
- No new 제공인력 app/login surface (access is the SMS+DOB link only).
- No change to the contract document or its completion flow beyond the feedback-template skip branch.
- No per-day fields inside the eformsign template (snapshot = one rendered field).
- No `EformsignApiClient` public-method changes (reuse `createDocument`).
- No Kakao 알림톡 template (links go via free-form SMS).

## Technical Design
### eformsign Layer Touchpoints
- **Affected usecases (new):** `application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase.ts` — mirrors `application/usecases/eformsign-doc/create-and-send-contract.usecase.ts:19-30` (deps `EFORMSIGN_CLIENT_REPOSITORY`, `CLIENT_REPOSITORY`, `GetEformsignAccessTokenUsecase`, `CreateEformsignDocUsecase`). Recipient = `employee.phone` (`prisma/schema.prisma:188`). Reuses `createDocument` (`infrastructure/api/eformsign-api.client.ts:238-280`) with one multiline content field.
- **Service/controller/guard changes:**
  - **Modify** `application/services/eformsign-webhook.service.ts` `handleDocumentEvent` (`:239-289`): read `template_id`, and when it equals `EFORMSIGN_FEEDBACK_TEMPLATE_ID` skip `handleCompletedDocument` (`:325-356`). Apply the same skip to the `ready_document_pdf` completion-style path (per `eformsign-api-webhooks.md:105`) — verify at build.
  - **New guard** `infrastructure/auth/employee-feedback.guard.ts` — mirrors `infrastructure/auth/call-ingest.guard.ts:16-47` (Bearer → resolve → attach `{branchId, scheduleId, employeeId}`).
  - **New controller** `interface/controllers/service-feedback.controller.ts` — token-guarded (NOT `JwtGuard`).
- **`EformsignApiClient` additions:** NONE. Reuse `createDocument` (`infrastructure/api/eformsign-api.client.ts:238-280`).
- **DTO deltas:** **New** `interface/dto/service-feedback.dto.ts`. **Verify/extend** `interface/dto/eformsign-webhook.dto.ts` so the `document` event exposes `template_id` (`eformsign-api-webhooks.md:16`; not currently destructured at `eformsign-webhook.service.ts:243`).
- **Prisma deltas (additive only):** `employee.birthday`; new `employee_feedback_token`, `service_record`, `service_record_day`; back-relations on `employee_schedule` (`prisma/schema.prisma:200-216`) and `branch`. No column change to `eformsign_doc` / `client.eDocId` / `doc_template`.
- **Env vars (names only):** `EFORMSIGN_FEEDBACK_TEMPLATE_ID`, `EFORMSIGN_FEEDBACK_TEMPLATE_NAME` (opt), `EMPLOYEE_FEEDBACK_TOKEN_GRACE_DAYS` (opt), `MOBILE_FEEDBACK_BASE_URL`. Reuse `ALIGO_*` incl. `ALIGO_SENDER_PHONE`.
- **Webhook event types:** `document` (doc_complete) + `ready_document_pdf` — both gated. `document_action` unaffected.
- **Module registration:** **New** `module/service-feedback.module.ts`. Register `CreateAndSendFeedbackSnapshotUsecase` in `module/eformsign-doc.module.ts:36-89`. Wire link-issuer into `module/employee-schedule.module.ts` + `application/services/employee-schedule.service.ts:45-47`, and into `client.service.ts` (replacement `:769-773`, termination `:707-713`).

### Access & lifecycle model
- **Link token** (in SMS, possession) only reaches the DOB challenge; **DOB** (knowledge) → mint **access token** cookie, `expiresAt = schedule.endDate + EMPLOYEE_FEEDBACK_TOKEN_GRACE_DAYS`. Expected DOB = `sha256(employee.birthday)` snapshot; lockout after N failed attempts. Mirror `call-ingest-token.service.ts:19-53` (sha256 hex, `randomBytes(32).base64url`, revoke via `updateMany active=false,revokedAt`).
- **Replacement** (`client.service.ts:744-768`): old token revoked, new token + SMS for the new `primaryEmployeeId`. **Termination** (`client.service.ts:707-710`): revoke tokens. **No DOB on file** → skip SMS, flag staff.

### Form structure
- **Auth page** → **Service header** (one-time: 산모/신생아 names+DOBs, 분만형태, 신생아 몸무게; 제공인력/제공기관/제공시간 read-only) → **per-session 3 grouped pages** (산모 ①–⑤ / 신생아 ⑥–⑪ / 마무리: 기타·특이·결제확인·산모서명) with forward-only `serviceDate`, then 제출→lock.

### Data model (additive)
- `employee.birthday String? @db.VarChar(6)` (YYMMDD, mirror `client.birthday` `prisma/schema.prisma:92`).
- `employee_feedback_token`: id(uuid), branchId, scheduleId, employeeId, linkTokenHash(unique), accessTokenHash(unique,nullable), expectedDobHash, verifiedAt?, failedAttempts, expiresAt, active, revokedAt?, createdAt; `@@unique([scheduleId, employeeId])`.
- `service_record`: id(uuid), branchId, scheduleId(unique), momName, momBirth, babyName, babyBirth, deliveryType, babyWeight, createdAt/updatedAt.
- `service_record_day`: id(uuid), branchId, scheduleId, sessionIndex, serviceDate(@db.Date), perineum/breast/excretion/sitzBath/meals…(①–⑪ as typed cols or JSON), etcService, notes, paymentConfirmed(bool), momApproval(text), locked(bool default false), submittedAt?; `@@unique([scheduleId, sessionIndex])`.

### Design Details
- **Hybrid rationale:** eformsign templates are fixed-field (`eformsign-api-templates.md:35-43`); `createDocument` fills only pre-existing fields, no repeatable rows (`eformsign-api-documents.md:14-29`). DB capture removes the limit; snapshot is one text field.
- **Send mechanism caveat:** eformsign has no REST send endpoint (`eformsign_no_rest_approve` memory; headless 전송 automation `infrastructure/automation/eformsign-finalize-gates`, `Dispatch/FinalizeDocumentHeadlessUsecase`). Phase-2 task 0: confirm whether `createDocument` + `recipients.use_sms` auto-dispatches or the headless path is required, then reuse it.
- **Monotonic dates:** server rejects `serviceDate < previous session's serviceDate` (no backdating); a skip pushes later sessions forward; always N records.

## Task Breakdown
### Phase 1 — DOB-gated capture
- [ ] **T1.1 Prisma + additive migration** — Tier standard · local · Depends none · Paths `backend/prisma/schema.prisma`, `backend/prisma/migrations/<new>/migration.sql`
- [ ] **T1.2 Employee DOB end-to-end** — standard · local · Depends T1.1 · Paths `backend/domain/entities/employee.entity.ts`, `backend/interface/dto/employee.dto.ts`, employee usecases, `mobile/src/components/app/employees/EmployeeFormDialog.tsx`, `frontend/src/components/app/employees/EmployeeFormDialog.tsx`
- [ ] **T1.3 Token service + guard (+unit tests)** — standard · local · Depends T1.1 · Paths `backend/application/services/employee-feedback-token.service.ts`, `backend/infrastructure/auth/employee-feedback.guard.ts`
- [ ] **T1.4 Capture API + DOB challenge + lock** — standard · local · Depends T1.1,T1.3 · Paths `backend/application/usecases/service-feedback/*`, `backend/interface/controllers/service-feedback.controller.ts`, `backend/interface/dto/service-feedback.dto.ts`
- [ ] **T1.5 Assignment/replacement/termination link hooks** — standard · local · Depends T1.1,T1.3 · Paths `backend/application/services/employee-feedback-link.service.ts`, `backend/application/services/employee-schedule.service.ts`, `backend/application/services/client.service.ts`
- [ ] **T1.6 Module wiring** — standard · local · Depends T1.3,T1.4,T1.5 · Paths `backend/module/service-feedback.module.ts`, `backend/app.module.ts`
- [ ] **T1.7 Mobile no-login wizard** — heavy · local · Depends T1.4 (contract) · Paths `mobile/src/middleware.ts`, `mobile/src/app/feedback/[token]/*`, `mobile/src/app/api/feedback/[token]/*`
### Phase 2 — eformsign finalize + isolation
- [ ] **T2.0 Confirm send mechanism** — trivial · local · read-only spike
- [ ] **T2.1 Webhook template_id gate + spec** — standard · local · Paths `backend/application/services/eformsign-webhook.service.ts`, `backend/interface/dto/eformsign-webhook.dto.ts`, `backend/test/services/eformsign-webhook-feedback-gate.spec.ts`
- [ ] **T2.2 Snapshot usecase** — heavy · local · Depends T1.1,T2.0 · Paths `backend/application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase.ts`, `backend/module/eformsign-doc.module.ts`
- [ ] **T2.3 Finalize endpoint + mobile button** — standard · local · Depends T1.4,T1.7,T2.2

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `ready_document_pdf` path also fires contract side effects, missed by the gate | M | H | T2.1 inspects + gates it; spec asserts both paths |
| `template_id` absent/unstable in live webhook payload | M | H | Verify against a real feedback webhook; fallback gate = eformsign_doc docType marker |
| `createDocument` alone does not dispatch SMS (headless required) | M | M | T2.0 spike before T2.2; reuse headless path |
| DOB is low-entropy (guessable) | M | M | Link token = primary secret; hash at rest + lockout; token scoped + expiring |
| Existing employees have no DOB → links unusable | H | M | Skip SMS when birthday null + flag staff; backfill pass |
| Skip-tail exceeds grace buffer | L | M | Generous buffer; staff reissue fallback |
| Prisma migration drift on live | L | H | Additive-only; `migrate diff` before any prod push (never `db push` live) |

## Testing Strategy
- **Unit (RED→GREEN):** `backend/test/services/eformsign-webhook-feedback-gate.spec.ts` — feedback `template_id` skips link/endDate/alimtalk; contract `template_id` still invokes them.
- **Unit:** token round-trip (create→verify DOB→mint access→revoke); wrong-DOB lockout; expiry; monotonic `serviceDate`; locked-session write rejection.
- **Integration (build-time):** assign → SMS → DOB → fill → submit(lock) → finalize → sign SMS → client `eDocId`/`endDate` untouched, no contract alimtalk.

## Verification
**Backend build:** `pnpm --dir <resolved-backend-dir> run build`

**Spec test:** `pnpm --dir <resolved-backend-dir> exec jest test/services/eformsign-webhook-feedback-gate.spec.ts --runInBand`

**Rollout:** Additive Prisma migration (`employee.birthday`, `employee_feedback_token`, `service_record`, `service_record_day`). Apply with `migrate deploy`; `migrate diff` before any live push. New env vars set per environment before enabling the SMS hook.

**Rollback:** Drop the new tables + `employee.birthday`; unset `EFORMSIGN_FEEDBACK_TEMPLATE_ID` (webhook gate is a no-op when unset → existing contract behavior). Capture page is dark until SMS links are issued.

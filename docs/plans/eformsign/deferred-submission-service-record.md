---
plan_id: efsi-2026-001
feature: deferred-submission-service-record
status: approved
swagger_base: https://api.eformsign.com/v2.0
agent_version: v0.2.0
created_at: 2026-04-15T00:00:00Z
approved_at: 2026-04-17T00:00:00Z
content_hash: null
depends_on: []
---

# Summary

Add **two-phase contract support** for 서비스제공기록지 in babyjamjam-staff. A single eformsign document has two completion phases tracked in the backend:

- **Phase 1 — Customer signing (계약 체결)**: Customer signs in eformsign → webhook fires → document persisted → client service activated → customer receives existing `sendContractSignedAlimtalk`. This reuses the existing chain unchanged. The only difference from today is that `statusType` goes to `070` (collecting) instead of `050` (completed) so the document stays open for Phase 2.
- **Phase 2 — Service provision records (서비스 제공 기록)**: Employees submit daily entries over a 10–30 day period via backend endpoints (consumer app comes later). When all entries are filled or force-finalized, `statusType` flips to `050`. No customer alimtalk at Phase 2.

eformsign signing is unchanged — Phase 2 deferral is purely babyjamjam-staff side (Architecture A2). No new eformsign API calls, no new env vars, no alimtalk changes.

# Requirements

## Goals
- On customer signing of a 서비스제공기록지 document: preserve the existing Phase 1 chain (`LinkDocumentToClientUsecase` + `sendContractSignedAlimtalk`), but write `statusType = "070"` instead of `050`
- Initialize collection period fields (`collectionStartDate`, `collectionEndDate`, `collectionPeriodDays`) at Phase 1 completion
- Provide backend endpoints for daily-record entry submission, listing (with computed missing dates), and finalization (with `force` flag)
- Finalize path: flip `statusType = "050"`, set `finalizedAt`; do NOT re-run `LinkDocumentToClientUsecase` (already ran at Phase 1) or re-send the signed alimtalk
- Support force-finalize with missing dates: return the missing dates in the response (no customer alimtalk)
- Do not break non-record document flows (conditional branching on template type)

## Non-goals
- Modifying eformsign's signing flow
- Building the employee frontend (app is a future project)
- New alimtalk templates or AlimtalkService changes (Phase 2 customer notification is intentionally not sent)
- Provider-specific auth guard (use standard JwtGuard + TenantGuard for now)
- Migration of existing in-flight documents (additive only)
- Auto-finalization on cron (manual trigger only for v1)

# Technical Design

## Existing Behavior (baseline)
Webhook `doc_complete` for ANY document:
1. `UpdateEformsignDocStatusUsecase` sets `statusType = "050"`, `statusDetail = "완료"`
2. `LinkDocumentToClientUsecase` activates the client service
3. `sendContractSignedAlimtalk` notifies the customer

## Proposed Behavior
Webhook `doc_complete` for 서비스제공기록지 (detected by template lookup):
1. `UpdateEformsignDocStatusUsecase` sets `statusType = "070"`, `statusDetail = "일일기록 수집 중"` (NEW status code)
2. `StartDailyRecordCollectionUsecase` sets `collectionStartDate = today`, `collectionEndDate = today + collectionPeriodDays`, `collectionPeriodDays` (from client record or default 30)
3. `LinkDocumentToClientUsecase` runs as today (preserved)
4. `sendContractSignedAlimtalk` runs as today (preserved)

Webhook `doc_complete` for other templates: unchanged.

`POST /daily-records/:docId/entries` (guarded by JwtGuard + TenantGuard):
- Validates date within `[collectionStartDate, collectionEndDate]`
- Dedupes via unique `(eformsignDocId, recordDate)` constraint
- Persists the entry

`GET /daily-records/:docId/entries`:
- Returns entries + computed missing dates list

`POST /daily-records/:docId/finalize` with body `{ force: boolean }`:
- If `force === false` and gaps exist: returns 400 with `{ missingDates: [...] }`
- If `force === true` or complete: sets `statusType = "050"`, `finalizedAt = now()`, `forceFinalize = force`
- Does NOT re-run Phase 1 chain

## eformsign Layer Touchpoints

- **Affected usecases** (`application/usecases/eformsign-doc/`):
  - MODIFY `update-eformsign-doc-status.usecase.ts` — no code change needed; already accepts any statusType/statusDetail as params
  - NEW `start-daily-record-collection.usecase.ts`
  - NEW `submit-daily-record-entry.usecase.ts`
  - NEW `list-daily-record-entries.usecase.ts`
  - NEW `finalize-service-record.usecase.ts`

- **Services / controllers / modules**:
  - MODIFY `application/services/eformsign-webhook.service.ts` — branch `handleDocumentEvent` and `handleReadyDocumentPdfEvent` on 서비스제공기록지 detection
  - NEW `application/services/daily-record.service.ts` — orchestrates usecases
  - NEW `interface/controllers/daily-record.controller.ts` — JwtGuard + TenantGuard
  - NEW `module/daily-record.module.ts` — registers everything
  - MODIFY `app.module.ts` — import DailyRecordModule
  - MODIFY `module/eformsign-webhook.module.ts` — inject AreaTemplateService for template detection

- **`EformsignApiClient`**: no changes

- **DTOs/mappers** (`interface/dto/`, `infrastructure/database/mapper/`):
  - NEW `interface/dto/daily-record.dto.ts`
  - NEW `infrastructure/database/mapper/daily-record-entry.mapper.ts`

- **Domain** (`domain/`):
  - NEW `domain/entities/daily-record-entry.entity.ts`
  - NEW `domain/repositories/daily-record-entry.repository.interface.ts`
  - NEW `infrastructure/database/repositories/sb.daily-record-entry.repository.ts`

- **Prisma schema deltas** (`backend/prisma/schema.prisma`):
  - NEW model `daily_record_entry`
  - MODIFY `eformsign_doc` — add `collectionStartDate`, `collectionEndDate`, `collectionPeriodDays`, `finalizedAt`, `forceFinalize`
  - MODIFY `organization` — add reverse relation

- **Env vars**: none

- **Webhook event types affected**: `document` and `ready_document_pdf` handlers (only `doc_complete` status case adds branching)

- **Template detection helper**: add method to `AreaTemplateService` (e.g., `isServiceProvisionRecordTemplate`) using `doc_template` table lookup by templateId or templateName

## Status Vocabulary (post-change)
Existing: `010` (created), `020` (in-progress), `050` (completed), `060` (pending), `080` (rejected), `090` (revoked), `099` (deleted)
NEW: `070` (일일기록 수집 중 / COLLECTING_DAILY_RECORDS)

# Task Breakdown

Vertical slices, each ≤400 LOC:

1. **Prisma schema + migration** (~60 LOC) — add model + fields, run `prisma migrate dev --name add_daily_record_entry` + `prisma generate`
2. **Domain + repository** (~200 LOC) — entity, interface+token, mapper, Supabase impl
3. **Usecases** (~300 LOC) — 4 new usecases under `application/usecases/eformsign-doc/`, export from `index.ts`
4. **Webhook branching** (~120 LOC) — modify `eformsign-webhook.service.ts`, add template detection to `AreaTemplateService`, update `mapStatus` to accept new `070`
5. **Controller + DTOs + service + module** (~350 LOC) — controller, DTOs, service, module, register in app.module
6. **Build + lint verification** — run `pnpm build`, `pnpm lint` on backend filter

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Webhook branching breaks existing non-record flows | Medium | High | Branch strictly on `isServiceProvisionRecordTemplate(templateId)`; fallback to existing path on any error; add smoke test |
| Template detection returns false negative (record doc treated as normal) | Medium | Medium | Use `doc_template` table lookup with explicit `templateName` contains match (`서비스제공기록지`); log warning on ambiguous matches |
| No consumer yet → endpoints have no real-world validation | High | Low | Acceptable; document that integration will happen with employee app project |
| Timezone bug on `recordDate` submissions near midnight | Low | Medium | Use `@db.Date` (date-only) and reject invalid date ranges explicitly |
| `collectionPeriodDays` defaulting wrong | Low | Low | Default 30 if unset; allow override via DTO or client record in future |

# Testing Strategy

- **Unit** (stubbed, no Jest run required for this PR per babyjamjam-staff convention):
  - `submit-daily-record-entry.usecase` — valid date, out-of-range date, duplicate date
  - `finalize-service-record.usecase` — complete path, force path with gaps, non-force with gaps
  - Webhook branching — record template vs non-record template routes
- **Manual smoke** (see Verification)

# Verification

1. `pnpm --filter imirae-incheon-backend build` — passes (type check)
2. `pnpm --filter imirae-incheon-backend lint` — passes
3. `pnpm --filter imirae-incheon-backend prisma migrate dev --name add_daily_record_entry` — migration applies
4. `pnpm --filter imirae-incheon-backend prisma generate` — client regenerates
5. Grep codebase for `statusType === "050"` or `statusType: "050"` to confirm no existing logic is broken by record-type docs entering `070` instead
6. **Phase 1 smoke (manual)**: sign a 서비스제공기록지 in eformsign sandbox → verify `statusType = "070"`, collection fields set, client linked, contract-signed alimtalk sent
7. **Phase 2 entry smoke**: `POST /daily-records/:docId/entries` → 201 Created; duplicate date → 409 Conflict
8. **Phase 2 finalize complete**: all entries filled → `POST /daily-records/:docId/finalize` with `force=false` → 200 OK, `statusType = "050"`, no additional alimtalk
9. **Phase 2 finalize force**: `POST /daily-records/:docId/finalize` with `force=true` and gaps → 200 OK with `missingDates: [...]` in response
10. **Cross-tenant**: submit entry with a JWT from a different organization → 403 or empty (TenantGuard blocks)
11. **Non-record doc regression**: sign a regular contract → existing flow unchanged (statusType = "050", client linked, alimtalk sent)

Rollout: N/A — additive. Rollback: revert the branch; schema additions are nullable and safe to leave.

# 통화 인박스 (Call Inbox) — Design Spec

**Date:** 2026-06-10
**Status:** Approved design, pending implementation plan
**Wireframe:** `docs/mockups/call-inbox-wireframe.html`

## 1. Goal

Phone call recordings land in Google Drive. n8n transcribes them with Gemini. The backend classifies each call, extracts structured customer information, and stages it for staff review in the mobile app (m.staff). Staff correct and confirm; only then does anything touch production data — a new client is created through the existing creation path, or proposed changes are applied to an existing client. Every call is kept as a searchable log entry.

This is a SaaS product: every call is allocated to a branch (tenant) by its ingestion credential, never by payload claim.

## 2. Decisions log

| Decision | Choice |
|---|---|
| Automation level | Staging table (`client_draft`); staff review → confirm → real client. No auto-creation. |
| Extraction location | Backend (prompt versioned + tested in repo). n8n stays transport: Drive → Gemini STT → webhook POST. |
| Call scope | Log ALL calls. 신규상담 → new-client drafts. 기존고객 서비스 변경 (출산예정일/시작일 변경, 관리사 교체, 연장, 종료 등) → change drafts. 기타 → log only. |
| Review surface | Mobile app (m.staff) first. |
| Branch allocation | Per-branch ingest tokens (DB-backed, hashed). No env-configured branch. |
| LLM provider | Gemini 2.5 Flash via REST behind a port/adapter (existing Gemini key; swappable). |

Assumptions (confirm at spec review):
- Operator runs n8n for all branches initially; per-branch token contract already supports branch-operated n8n later.
- Greeting-SMS toggle on NEW_CLIENT confirm defaults ON (same as manual creation today).
- 통화 gets a bottom-nav tab; falls back to 전체 menu if nav space doesn't allow (decided at implementation against the current nav).
- 기타-category transcripts are kept indefinitely for now (retention policy revisit later).

## 3. Architecture

```
📱 통화녹음 → Google Drive (per-branch folder)
  → n8n (per-branch workflow from template):
      Drive trigger → download → Gemini upload → Gemini transcribe/교정 (구조화 JSON)
      → POST https://api.babyjamjam.com/webhooks/call-transcripts
        Authorization: Bearer <branch ingest token>
  → backend:
      CallIngestGuard (token → branchId) → call_record upsert (idempotent on driveFileId)
      → async extraction (LLM port): classify + extract → client_draft (if actionable)
  → m.staff 통화 인박스: 검토 대기 + 통화 기록
  → confirm:
      NEW_CLIENT → 기존 ClientService.create (greeting SMS 등 부수효과는 이 시점에만)
      CLIENT_UPDATE → 기존 client update 경로 (serviceStatus 전환 포함 동일 검증)
```

## 4. n8n workflow changes

Current workflow "Call Transcription" (id `4lbxMDu5my7pfh2h`, currently inactive) becomes a **per-branch template**:

**Keep:** Google Drive trigger (per-branch folder) → Download → Gemini resumable upload → `Gemini Transcribe Audio` (existing `responseSchema`: `summary{inquiry_type, customer_info, key_content, result_action}` + `transcript[{speaker, text}]`, with the 아이미래로 terminology-correction prompt).

**Remove:** `AI Agent - STT Correction` (second LLM pass), markdown formatter code node, dead POST to `staff.babyjamjam.com`.

**Add:** one code node that `JSON.parse`s the Gemini response text, then an HTTP node:

```
POST https://api.babyjamjam.com/webhooks/call-transcripts
Authorization: Bearer <CALL_INGEST_TOKEN>   ← per-branch blank
Content-Type: application/json

{
  "fileId":    "<Drive file id>",          // required — idempotency key
  "fileName":  "<original file name>",     // required — may carry caller number
  "recordedAt": "<Drive createdTime ISO>", // optional
  "transcript": [{ "speaker": "아이미래로|고객|산모|남편", "text": "..." }],  // required
  "summary":   { "inquiry_type": "...", "customer_info": "...",
                 "key_content": "...", "result_action": "..." }              // optional
}
```

`retryOnFail` enabled on the POST node — safe because the webhook is idempotent. Per-branch blanks in the template: Drive folder ID, Drive credential, ingest token. The updated template JSON is produced as an implementation deliverable for import.

## 5. Branch allocation — ingest tokens

**Table `call_ingest_token`:** `id (uuid)`, `branchId (FK branch)`, `tokenHash (sha256, unique)`, `label` (e.g. "인천본점 n8n"), `active (bool, default true)`, `lastUsedAt?`, `revokedAt?`, `createdAt`.

- Token format `cit_<random ≥32 bytes base64url>`, generated server-side, plaintext returned **once** at creation, stored only hashed.
- **`CallIngestGuard`** (new, DB-backed; same spirit as the eformsign `WebhookGuard`): hash Bearer token → look up active row → attach `branchId` to request; touch `lastUsedAt`. 401 on missing/revoked/unknown.
- All downstream rows inherit `branchId` from the token. Payload never carries branch identity.
- **Provisioning (Phase 1, ops-level):** `POST /branches/:branchId/call-ingest-tokens { label }` → `{ token }` (once) and `POST /call-ingest-tokens/:id/revoke`, gated by the existing admin/role mechanism (exact guard confirmed at plan stage). Self-serve branch settings UI is Phase 3.

## 6. Data model

Names follow the existing snake_case Prisma convention.

**`call_record`** — one row per ingested call:

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| branchId | uuid FK branch | from ingest token |
| driveFileId | string, **unique** | idempotency key |
| fileName | string | |
| recordedAt | timestamptz? | Drive createdTime; fallback: parsed from fileName |
| transcript | JSONB | `[{speaker, text}]` |
| summary | JSONB? | n8n Gemini coarse summary |
| category | enum? | `NEW_CONSULTATION \| CLIENT_SERVICE \| OTHER` — null until extracted |
| callerPhone | string? | normalized digits |
| callerName | string? | |
| matchedClientId | int? FK client | phone match within branch |
| processingStatus | enum | `RECEIVED \| EXTRACTED \| FAILED` |
| extractionRetryCount | int default 0 | |
| failureReason | text? | |
| createdAt | timestamptz | |

Indexes: `(branchId, createdAt)`, `processingStatus`, `matchedClientId`.

**`client_draft`** — one per actionable call (1:1 with call_record):

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| callRecordId | uuid FK, **unique** | |
| branchId | uuid FK branch | denormalized for scoping |
| type | enum | `NEW_CLIENT \| CLIENT_UPDATE` |
| status | enum | `PENDING \| CONFIRMED \| DISCARDED`; transitions only out of PENDING |
| clientId | int? FK client | UPDATE: target client; NEW: set to created client on confirm |
| proposals | JSONB | `[{ field, value, currentValue?, evidence, confidence: "high"\|"low" }]` |
| requestSummary | text | 한 줄 요약 (예: "출산이 빨라져 시작일 6/23로 변경 요청") |
| extractionMeta | JSONB | `{ model, promptVersion, rawResponse }` — enables re-extraction/debugging |
| reviewedById / reviewedAt | FK?, timestamptz? | |
| discardReason | text? | |
| createdAt | timestamptz | |

`proposals[].currentValue` is a snapshot for context only; the review UI always renders the **live** client value at review time (the client may have changed between extraction and review), and confirm applies against live data.

`proposals[].field` is constrained to an allowlist of client fields: `name, phone, address, dueDate, birthday, startDate, endDate, duration, type, careCenter, voucherClient, breastPump, serviceStatus, fullPrice, grant, actualPrice`. Details that don't map to a client field (바우처 세부유형, 선호 관리사, 기타 메모) stay on the draft/call record — readable from the call log; the client table is not extended.

## 7. Extraction service

- **Port:** `CallExtractionPort.extract({ transcript, summary?, fileName }) → ExtractionResult`; **adapter:** Gemini 2.5 Flash REST, JSON-schema response mode, `GEMINI_API_KEY` env (backend). Provider swappable without touching callers.
- **One call returns:** `category`, `callerName?`, `callerPhoneCandidates[]` (spoken digits in transcript; backend also regex-parses fileName), `requestSummary`, `proposals[]` (per the allowlist; dates ISO, duration in days, booleans strict; evidence quote mandatory per proposal; confidence high/low; "해당 없음" → omit).
- **Classification:** `NEW_CONSULTATION` = caller inquiring to start service; `CLIENT_SERVICE` = request to change an existing service (예정일/시작일/종료일 변경, 교체, 연장, 종료 등); `OTHER` = everything else (주차, 제휴, spam…). NEW_CONSULTATION → `NEW_CLIENT` draft; CLIENT_SERVICE → `CLIENT_UPDATE` draft; OTHER → no draft.
- **Prompt:** Korean, in-repo constant with `promptVersion`; reuses the 아이미래로 terminology dictionary from the n8n prompt.
- **Client matching:** normalize phones (strip non-digits, `+82`→`0`); exact match against branch-scoped `client.phone` (normalized). Single match → set `matchedClientId`/`clientId`; zero or multiple → unmatched + UI flag (변경요청 drafts require manual link before confirm).
- **Async processing:** webhook responds 202 immediately; extraction runs via async event. Failures → `FAILED` + retry cron (max 3 attempts; cadence per existing alimtalk retry conventions), then surfaced in the call log with manual 재시도.

## 8. Staff API (JwtGuard + TenantGuard, branch-scoped like existing list endpoints)

| Endpoint | Behavior |
|---|---|
| `GET /call-records?category&search&cursor` | Call log; includes draft status per row |
| `GET /call-records/:id` | Full record: transcript, summary, draft, Drive link |
| `GET /client-drafts?status=PENDING&cursor` | Review queue |
| `PATCH /client-drafts/:id` | Edit proposals / link `clientId` — only while PENDING |
| `POST /client-drafts/:id/confirm` | NEW_CLIENT: body = staff-final `CreateClientDto`-shaped fields (+ `suppressGreetingSms?`) → existing `ClientService.create`; CLIENT_UPDATE: body = included `{field: value}` set → existing client update path (same validation as today's edits, incl. serviceStatus transitions). Transactional; 409 unless PENDING; stamps reviewedBy/At |
| `POST /client-drafts/:id/discard` | `{ reason? }` |
| `POST /call-records/:id/re-extract` | Phase 2, admin: re-runs extraction; only replaces proposals of a still-PENDING draft |

**Webhook responses:** 202 accepted · 200 duplicate no-op · 401 bad token · 400 invalid payload · 413 transcript over size cap.

**Mobile BFF:** `mobile/src/app/api/call-records/...` and `/api/client-drafts/...` proxy routes mirroring the existing `/api/clients` pattern (session token + zod validation).

## 9. Mobile UI (wireframe: `docs/mockups/call-inbox-wireframe.html`)

New **통화 인박스** section, bottom-nav tab with pending-count badge (placement provisional, see assumptions):

1. **검토 대기 (default tab)** — pending drafts only. Card: 신규/변경 badge, caller name+phone, one-line `requestSummary`, time/duration, low-confidence ⚠, matched-client chip or "고객 연결 필요".
2. **통화 기록** — all calls incl. 기타; category chips (전체/신규상담/고객 변경/기타) + search; row shows outcome (적용 완료/폐기/대기). Replaces the old markdown report. Detail view: summary + chat-style transcript + Drive audio link.
3. **신규 상담 검토** — editable form pre-filled from proposals, field order following `ClientFormDialog`; per-field evidence quote chips (tap → scroll transcript to that utterance); low-confidence fields amber; actions [폐기] [고객 등록] (등록 → confirm sheet with greeting-SMS toggle → existing create path → navigate to client detail).
4. **변경 요청 검토** — matched-client card (or manual link via existing `ClientAutocomplete`); per-change diff rows (현재값 → 제안값) with include/exclude toggles and inline editing; actions [폐기] [변경 적용 (N건)].

Reuse: existing list/infinite-scroll patterns, `ClientAutocomplete`, `ClientFormDialog` field components, `NotificationBell` (new-draft notifications). Phase 2: 통화 탭 inside client detail (calls where `matchedClientId` = client).

## 10. Edge cases

- **Idempotency:** unique `driveFileId`; duplicate webhook → 200 no-op (n8n retries safe).
- **Extraction failure:** FAILED rows visible in call log with 재시도; cron retries ≤3.
- **Repeat caller:** new draft when a PENDING draft shares the normalized phone → "중복 가능" flag in queue (no auto-merge).
- **NEW_CLIENT confirm with existing-client phone match:** warning in confirm sheet before create.
- **Unmatched/ambiguous CLIENT_UPDATE:** confirm blocked until staff link a client.
- **Double confirm:** status guard, 409.
- **Oversized transcript:** 413 with cap (exact cap at plan stage; generous — calls are minutes, not hours).

## 11. PII & retention

Transcripts contain PII and pregnancy/birth-adjacent details — stored in the same Postgres with the same protections as existing client data; access is branch-scoped staff-only. Audio never leaves Google Drive; the backend stores only `driveFileId` and links out. Open item: retention/purge policy (especially 기타 calls) — default keep, revisit as a business decision.

## 12. Testing

- **Backend unit:** `CallIngestGuard` (valid/revoked/unknown token, branch attach), webhook idempotency, extraction service against a **mocked LLM port** with fixture transcripts — 주차 문의 (→ OTHER, the real example), 신규상담 (→ field proposals), 시작일 변경 (→ diff proposal, matched), 교체 요청 unmatched (→ manual-link required); confirm flows (NEW_CLIENT → create path with side-effect events; CLIENT_UPDATE → patch path; status guards).
- **e2e (CI):** real backend per project policy (Postgres container + migrate + seed), LLM port stubbed (vendor-only stubbing rule): webhook → record → draft → confirm → client row + suppressed greeting verified.
- **Mobile:** component tests per existing `__tests__` patterns; Playwright visual verification per the established E2E-mode setup.
- **n8n:** template imported, sample audio dropped into a test Drive folder, end-to-end smoke.

## 13. Phasing

- **Phase 1 — intake + 신규상담 (end-to-end value):** schema (3 tables) + `CallIngestGuard` + webhook + extraction + token provisioning endpoints + mobile 검토 대기/통화 기록 + 신규 상담 confirm. n8n template updated.
- **Phase 2 — 변경요청 + polish:** CLIENT_UPDATE confirm flow, re-extract, NotificationBell integration, client-detail 통화 탭, call-log search polish.
- **Phase 3 — SaaS self-serve:** branch settings UI for token create/rotate + n8n onboarding guide for branch-operated setups.

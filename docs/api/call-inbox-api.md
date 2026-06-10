# 통화요약 (Call Inbox) — API Sheet

**Status:** design contract (pre-implementation). This file is the **source of truth** for the UI-facing API; implementation must conform or update this sheet in the same PR.
**Spec:** `docs/superpowers/specs/2026-06-10-call-inbox-design.md` · **Wireframe:** `docs/mockups/call-inbox-wireframe.html`

## Conventions

- UI calls the **mobile BFF** routes (`m.staff` → `mobile/src/app/api/...`), which proxy to the backend with the session token — same pattern as `/api/clients`.
- Auth: session cookie (BFF) → Bearer JWT (backend). All list/detail data is branch-scoped server-side; the UI never sends a branch id.
- Dates/timestamps: ISO 8601 strings (`"2026-07-15"` for dates, `"2026-06-10T14:02:11+09:00"` for timestamps).
- Pagination: cursor-based — `?cursor=<opaque>&limit=20` → `{ items, nextCursor }`, `nextCursor: null` on last page.
- Error envelope mirrors the existing `/api/clients` convention (confirm exact shape at implementation); status codes below are contractual.

## Shared types

```ts
type CallCategory     = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";
type ProcessingStatus = "RECEIVED" | "EXTRACTED" | "FAILED";
type DraftType        = "NEW_CLIENT" | "CLIENT_UPDATE";
type DraftStatus      = "PENDING" | "CONFIRMED" | "DISCARDED";
type Confidence       = "high" | "low";

interface TranscriptTurn {
  speaker: "아이미래로" | "고객" | "산모" | "남편";
  text: string;
}

interface CallSummary {            // n8n Gemini coarse summary (nullable as a whole)
  inquiry_type: string;
  customer_info?: string;
  key_content: string;
  result_action?: string;
}

type ProposalField =
  | "name" | "phone" | "address" | "dueDate" | "birthday"
  | "startDate" | "endDate" | "duration" | "type"
  | "careCenter" | "voucherClient" | "breastPump"
  | "serviceStatus" | "fullPrice" | "grant" | "actualPrice";

interface Proposal {
  field: ProposalField;
  value: string | number | boolean | null;  // dates as ISO strings, duration in days
  currentValue?: string | number | boolean | null; // extraction-time snapshot — display LIVE client value instead
  evidence: string;                          // transcript quote backing the value
  confidence: Confidence;                    // "low" → amber highlight in UI
}

interface ClientRef { id: number; name: string; phone: string | null; }
```

## 1. Call log

### `GET /api/call-records?category&search&cursor&limit`

| Param | Type | Notes |
|---|---|---|
| `category` | `CallCategory` (optional) | omit = 전체 |
| `search` | string (optional) | matches caller name/phone, summary, transcript text |
| `cursor`, `limit` | pagination | default `limit=20` |

```ts
interface CallRecordListItem {
  id: string;                       // uuid
  category: CallCategory | null;    // null until extraction completes
  processingStatus: ProcessingStatus;
  callerName: string | null;
  callerPhone: string | null;       // normalized digits, UI formats XXX-XXXX-XXXX
  fileName: string;
  recordedAt: string | null;
  createdAt: string;
  matchedClient: ClientRef | null;
  draft: {                          // null for OTHER / not-yet-extracted
    id: string;
    type: DraftType;
    status: DraftStatus;
    requestSummary: string;
  } | null;
  summaryLine: string | null;       // requestSummary ?? summary.key_content (list display)
}
// → 200 { items: CallRecordListItem[], nextCursor: string | null }
```

### `GET /api/call-records/:id`

```ts
interface CallRecordDetail extends CallRecordListItem {
  transcript: TranscriptTurn[];
  summary: CallSummary | null;
  driveFileId: string;
  driveUrl: string;                 // link out to original audio in Google Drive
  failureReason: string | null;     // when processingStatus === "FAILED"
}
// → 200 CallRecordDetail · 404 unknown/foreign-branch id
```

## 2. Review queue (drafts)

### `GET /api/client-drafts?status&cursor&limit`

`status` default `PENDING`.

```ts
interface ClientDraftListItem {
  id: string;
  type: DraftType;
  status: DraftStatus;
  requestSummary: string;
  callerName: string | null;
  callerPhone: string | null;
  recordedAt: string | null;
  createdAt: string;
  callRecordId: string;
  client: ClientRef | null;         // CLIENT_UPDATE: matched client (null = 고객 연결 필요)
  hasLowConfidence: boolean;        // any proposal.confidence === "low"
  possibleDuplicate: boolean;       // another PENDING draft shares this phone
  phoneMatchesExistingClient: boolean; // NEW_CLIENT: phone already on a live client → warn
}
// → 200 { items: ClientDraftListItem[], nextCursor: string | null }
```

### `GET /api/client-drafts/count?status=PENDING`

→ `200 { count: number }` — nav badge / NotificationBell.

### `GET /api/client-drafts/:id`

```ts
interface ClientDraftDetail extends ClientDraftListItem {
  proposals: Proposal[];
  clientCurrent: Partial<Record<ProposalField, unknown>> | null; // LIVE values for linked client (diff display)
  callRecord: CallRecordDetail;     // transcript inline for the evidence-scroll UX
  reviewedBy: { id: number; name: string } | null;
  reviewedAt: string | null;
  discardReason: string | null;
  extractionMeta: { model: string; promptVersion: string };
}
// → 200 ClientDraftDetail · 404
```

### `PATCH /api/client-drafts/:id` — staff edits before confirm

```ts
interface PatchDraftBody {
  proposals?: Proposal[];           // full replacement of the array
  clientId?: number | null;         // CLIENT_UPDATE: manual link/unlink (ClientAutocomplete)
}
// → 200 ClientDraftDetail · 409 not PENDING · 422 invalid field/value
```

### `POST /api/client-drafts/:id/confirm`

NEW_CLIENT — body carries **staff-final** values (same shape as the existing create-client form/DTO):

```ts
interface ConfirmNewClientBody {
  fields: {
    name: string;                              // required
    careCenter: boolean;                       // required
    voucherClient: boolean;                    // required
    breastPump: boolean;                       // required
    phone?: string | null;
    address?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;                 // ISO date
    endDate?: string | null;
    birthday?: string | null;                  // YYMMDD
    dueDate?: string | null;
    serviceStatus?: string | null;
    areaId?: string | null;
    primaryEmployeeId?: number | null;
    secondaryEmployeeId?: number | null;
  };
  suppressGreetingSms?: boolean;               // default false (= SMS goes out, same as manual create)
}
// → 201 { clientId: number }
```

CLIENT_UPDATE — body carries only the **included** changes (allowlisted keys):

```ts
interface ConfirmClientUpdateBody {
  changes: Partial<Record<ProposalField, string | number | boolean | null>>;
}
// → 200 { clientId: number }
```

Common errors: `409` draft not PENDING (already confirmed/discarded) · `409` CLIENT_UPDATE with no linked client · `422` validation failure (same rules as existing client create/update paths).

### `POST /api/client-drafts/:id/discard`

Body `{ reason?: string }` → `200 { id, status: "DISCARDED" }` · `409` not PENDING.

## 3. Phase 2 endpoints (contract reserved)

- `POST /api/call-records/:id/re-extract` → `202` — re-runs extraction; replaces proposals only while the draft is still PENDING.

## 4. Operator-side (not called by the mobile UI)

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /webhooks/call-transcripts` | `Authorization: Bearer <cit_… ingest token>` | n8n only. Body: `{ fileId, fileName, recordedAt?, transcript[], summary? }`. `202` accepted · `200` duplicate no-op · `401` bad token · `400` invalid payload · `413` transcript over cap |
| `POST /branches/:branchId/call-ingest-tokens` | admin JWT | `{ label }` → `{ token }` — plaintext shown once |
| `POST /call-ingest-tokens/:id/revoke` | admin JWT | kills exactly one ingest source |

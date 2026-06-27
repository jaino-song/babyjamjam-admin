# Mobile ↔ Frontend Parity — Receipt Download + Message-History Panel

**Date:** 2026-06-26
**Branch:** `mobile-frontend-parity` (off `dev`)
**Linear:** [BJJ-240](https://linear.app/jaino-studio/issue/BJJ-240) (parent) · [BJJ-242](https://linear.app/jaino-studio/issue/BJJ-242) (receipt) · [BJJ-241](https://linear.app/jaino-studio/issue/BJJ-241)/[BJJ-243](https://linear.app/jaino-studio/issue/BJJ-243) (message panel)

## Goal

Close two accidental same-URL parity gaps between the **frontend** (desktop staff admin) and **mobile** (m.staff) apps. **Neither needs backend changes.** Port 2 is mobile UI-only (data already flows to mobile). Port 1 is frontend UI **plus a new BFF route** (PDF page-extraction, ported from mobile) and the `pdf-lib` dependency.

## Non-goals

- Not porting whole-app sections that are intentional platform splits (`stats`, `website-admin`, `calls`, `terms`/`privacy`, push settings, …) — tracked separately under BJJ-240.
- Port 1: **no** Web Share on desktop (download-only — confirmed decision).
- Port 2: **no** retry-failed action (deferred); **no** client-detail header quick-actions (메시지/계약서 발급) — that is a separate BJJ-241 sub-decision.

---

## Port 1 — Receipt download → frontend (BJJ-242)

### Context

Mobile lets users download the eformsign **receipt PDF** for a completed contract. Frontend only displays a `영수증 발행일` date field — no receipt file.

Backend endpoint is shared and already live (auth via httpOnly cookie):

```
GET /api/eformsign/documents/{documentId}/download_files?fileType=document&page=7
```

`page=7` extracts the receipt page; the regular document download omits `&page=7`.

**Reference impl (mobile):** `mobile/src/services/api.ts:334-336`; `mobile/src/app/contracts/page.tsx` (download button ~1336, gate ~1112, filename ~1121).

### Changes

> **Scope correction (found during planning):** frontend has **no** `/download_files` route — only `/preview` (which hardcodes `fileType` and cannot extract a page). The receipt page-extraction is a **BFF concern** (mobile does it with `pdf-lib`), so frontend must gain that route. Backend is still untouched — it returns the full PDF; the BFF extracts the page.

1. **`frontend/package.json`** — add `"pdf-lib": "^1.17.1"` (matches mobile; not currently a frontend dep, not workspace-hoisted), then `pnpm install`.
2. **Create `frontend/src/app/api/eformsign/documents/[documentId]/download_files/route.ts`** — port mobile's BFF route (`mobile/src/app/api/eformsign/documents/[documentId]/download_files/route.ts`): parse `fileType` + `page` query params, fetch the full PDF from backend `/api/documents/{id}/download_files` (mirror the `serverAPIClient` + auth-header pattern in frontend's existing `preview/route.ts`), and when `page` is set, extract that one page with `pdf-lib`'s `extractSinglePdfPage`.
3. **`frontend/src/services/api.ts`** — add to `eformsignApi`:
   - `getDocumentDownloadUrl(documentId)` → `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document`
   - `getDocumentReceiptDownloadUrl(documentId)` → same `+ &page=7`
4. **`frontend/src/components/app/documents/shared-document-preview-dialog.tsx`** — add optional props `receiptDownloadUrl?: string`, `receiptDownloadFileName?: string`; render a `영수증 다운로드` button beside the existing `다운로드` button (L638) **only when `receiptDownloadUrl` is set** (reuse the existing `handleDownload` link pattern; `Download` icon).
5. **`frontend/src/components/app/contracts/ContractDocumentPreviewModal.tsx`** — build the receipt URL via `eformsignApi.getDocumentReceiptDownloadUrl(document.id)`, pass it + `receiptDownloadFileName` = `"<document_name or id> 영수증.pdf"` to the dialog **only when completed**. The modal's `document` prop may lack a status field; if so, lift the completion flag to the caller **`frontend/src/app/(protected)/contracts/page.tsx`** (`category === "completed"`, ~L1090) and pass it into the modal (invoked ~L1833).

_DRY note: this duplicates mobile's extraction route. A later cleanup could move `extractSinglePdfPage` + the route into `packages/shared`; deferred here to keep the change parity-focused._

### Gating

Show the receipt button only when contract/document status is **completed** (mirror mobile's `category === "completed"`).

### Verification

- Unit-test the new BFF route's page-extraction (`page=7` → single-page PDF; out-of-range page → 400/`RangeError`) and the `getDocumentReceiptDownloadUrl` builder.
- Completed contract → open preview modal → `영수증 다운로드` visible → downloads `<name> 영수증.pdf` (single-page receipt).
- Non-completed contract → receipt button absent.
- Frontend `type-check` passes; `pnpm install` resolves `pdf-lib`.

---

## Port 2 — Message-history detail panel → mobile (BJJ-241 / BJJ-243)

### Context

Frontend's client detail has a **clickable** message-history list → in-panel slide-in `MessageHistoryDetailPanel` (수신자 / 연락처 / 템플릿 / 채널 / 내용 / 상태 / 실패 사유). Mobile renders the same `/alimtalk-logs` data as **static, non-clickable** `DetailDocRow` in the `알림 발송` tab — no detail view.

Data is **shared**: `packages/shared/src/types/alimtalk.ts` `AlimtalkHistoryRecord` carries `messageBody` (L141), `errorMessage` (L145), `recipientName` (L158), `templateKey`, etc. Mobile already fetches the full record via `fetchAllAlimtalkLogs` (`mobile/src/lib/alimtalk/logs.ts`) but **narrows** it to `ClientNotificationLogRecord` (`mobile/src/components/app/clients/client-detail.tsx:411-421`), dropping `messageBody`/`errorMessage`/`recipientName`.

**Reference impl (frontend):** `MessageHistoryDetailPanel.tsx` (props ~50-62, content ~388-424); `frontend/src/app/(protected)/clients/page.tsx` `ClientMessageHistoryList` (~165-292), `ClientMessageDetailSlide` (~294-355).

### Changes

1. **Data widen:**
   - Extend `ClientNotificationLogRecord` (mobile `client-detail.tsx`) with `messageBody: string`, `errorMessage: string | null`, `recipientName: string | null` (plus channel/template label if not already derivable).
   - Update the mapping where `notificationLogs` are built (mobile `clients/page.tsx`, from `AlimtalkHistoryRecord`) to carry these fields through.
2. **New component `ClientMessageHistoryDetail`** (mobile-redesign idiom), built from existing `InfoCard` / `InfoRow` primitives (`mobile-redesign/detail-sheet.tsx`):
   - `발송 정보` card: 수신자 (recipientName/receiver), 연락처, 템플릿, 채널, 실패 사유 (only if failed).
   - status badge (sent/failed/pending) — reuse mobile badge tones.
   - `메시지 내용` card: `messageBody` (`whitespace-pre-wrap`).
   - `data-component` prefix `mobile-clients-message-history-detail`.
3. **Interaction (in-place drill-down):**
   - Make `알림 발송` rows tappable: `DetailDocRow` → a `<button>` with `onClick` that sets `selectedNotificationLogId`.
   - When a log is selected, the `알림 발송` tab swaps **list → detail** with a `← 목록으로` back button, reusing the existing `.nav-stack.show-detail` slide pattern (`redesign.css` ~1275-1330). **No nested `MobileDetailSheet`.**
   - State lives within `client-detail` (`selectedNotificationLogId`).

### Scope boundary (YAGNI)

- **Display-only** — no retry-failed action (frontend's panel has `canRetry`/`onRetry`; deferred).
- Header quick-actions (메시지/계약서 발급) out of scope — separate BJJ-241 sub-decision.

### Verification

- Client detail → `알림 발송` → tap a message → detail shows recipient / phone / template / channel / content / status; failed shows `실패 사유`; `← 목록으로` returns to list.
- Mobile `type-check` passes (`rm -rf mobile/.next` first if stale-`.next` TS2307 false error — known gotcha).
- `data-component` annotations present in rendered DOM.

---

## Sequencing

The two ports touch **disjoint apps** (`frontend/` vs `mobile/`) and disjoint files → fully independent. Implement as two commits on this branch (or two PRs). Recommended order: **Port 1 (smaller) first**, then Port 2.

## Testing approach

- **Unit tests** are cheap and worth it for: the Port 1 URL builders, and the Port 2 data-mapping widen. Use TDD there (RED → GREEN).
- **UI panels:** rely on `type-check` + a visual check on the authenticated screen per the project's visual-verify approach.
- **Worktree caveat:** this session worktree uses symlinked `node_modules`, which refuses `next dev`/`build` (per known gotcha) — so `type-check`/`lint`/`test` run here, but **visual verification must happen in the `dev` env worktree or a CI preview**, not in this worktree.

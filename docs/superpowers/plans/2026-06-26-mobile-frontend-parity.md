# Mobile ↔ Frontend Parity Implementation Plan

> **For agentic workers:** implement task-by-task; each task ends with an independently testable deliverable.

TL;DR: Give the desktop app mobile's one-tap contract-receipt download (port a small PDF-page-extraction route + a button), and give the mobile app the desktop's tappable message-history detail panel (the data already arrives — make rows open an in-place detail). No backend changes.

**Goal:** Close the two accidental same-URL parity gaps — receipt download on `/contracts` (→ frontend) and the message-history detail panel on `/clients` (→ mobile).

**Architecture:** Two independent tracks. The frontend track ports mobile's `download_files` BFF route (server-side `pdf-lib` page extraction) and surfaces a `영수증 다운로드` button. The mobile track widens one type so the already-fetched message data is exposed, then adds a tappable in-place detail panel reusing the existing `.nav-stack.show-detail` slide.

**Tech stack:** Next.js App Router · TypeScript · React Query · pnpm workspace · pdf-lib · Tailwind (v3 + mobile-redesign design systems).

## Global Constraints

- Commands use path filters: `pnpm --filter ./frontend …` / `pnpm --filter ./mobile …` (old package names silently no-op).
- Korean conventional commits; commit per task.
- New DOM carries `data-component` annotations (`mobile-*` prefix on mobile).
- Mobile type-check: `rm -rf mobile/.next` first if a stale `.next/types` TS2307 false error appears.
- This session worktree has symlinked `node_modules` → it **cannot** run `next dev`/`build`; visual verification happens in the `dev` env worktree or a Vercel preview. `type-check`/`lint`/`test` run fine here.
- **No backend changes** in this plan.

---

## Phase 1 — Receipt download → frontend (BJJ-242)

Port mobile's receipt capability to the desktop contract preview so a completed contract can download its single-page receipt PDF.

**In parallel:**

- **1.1 Port the BFF page-extraction route + add pdf-lib** (infra, med)
  - Add `"pdf-lib": "^1.17.1"` to `frontend/package.json`; run `pnpm install`.
  - Create `frontend/src/app/api/eformsign/documents/[documentId]/download_files/route.ts` mirroring mobile's route: parse `fileType` + `page`, fetch the full PDF from backend `/api/documents/{id}/download_files` (copy the `serverAPIClient` + auth-header pattern from frontend's existing `preview/route.ts`), extract one page with `pdf-lib` when `page` is set.
  - Done when: `GET /api/eformsign/documents/<id>/download_files?fileType=document&page=7` returns a 1-page PDF.
  - Tier: heavy · Sandbox: network · Paths: `frontend/package.json`, `pnpm-lock.yaml`, `frontend/src/app/api/eformsign/documents/[documentId]/download_files/route.ts` · Depends: none
- **1.2 Add `eformsignApi` URL builders** (feature, low)
  - Add `getDocumentDownloadUrl` + `getDocumentReceiptDownloadUrl` (`…&page=7`) to `frontend/src/services/api.ts`.
  - Tier: trivial · Sandbox: local · Paths: `frontend/src/services/api.ts` · Depends: none (runtime needs 1.1)
- **1.3 Receipt button in the shared preview dialog** (feature, low)
  - Add optional `receiptDownloadUrl?` / `receiptDownloadFileName?` props; render `영수증 다운로드` beside the existing `다운로드` (L638) when set, reusing `handleDownload`.
  - Tier: standard · Sandbox: local · Paths: `frontend/src/components/app/documents/shared-document-preview-dialog.tsx` · Depends: none

then ↓

- **1.4 Wire the contract modal + completion gate** (feature, med)
  - In `ContractDocumentPreviewModal.tsx`, build the receipt URL via `eformsignApi.getDocumentReceiptDownloadUrl(document.id)` and pass it + `receiptDownloadFileName` to the dialog **only when completed**; if the modal's `document` lacks a status field, lift the `category === "completed"` flag from `contracts/page.tsx` (modal invoked ~L1833).
  - Tier: standard · Sandbox: local · Paths: `frontend/src/components/app/contracts/ContractDocumentPreviewModal.tsx`, `frontend/src/app/(protected)/contracts/page.tsx` · Depends: 1.2, 1.3

## Phase 2 — Message-history panel → mobile (BJJ-241 / BJJ-243)

Make mobile's `알림 발송` message rows tappable, opening an in-place detail panel — the data already arrives via `/alimtalk-logs`.

- **2.1 Widen the notification-log type** (refactor, low)
  - Add `messageBody`, `errorMessage`, `recipientName` to `ClientNotificationLogRecord` (`client-detail.tsx:411-421`). Because `fetchAllAlimtalkLogs<T>()` casts the raw record, the fields flow through with **no mapping change**.
  - Tier: trivial · Sandbox: local · Paths: `mobile/src/components/app/clients/client-detail.tsx` · Depends: none

then ↓

- **2.2 Build the message-detail panel component** (feature, med)
  - New `mobile/src/components/app/clients/client-message-history-detail.tsx` using `InfoCard`/`InfoRow`: `발송 정보` (수신자 / 연락처 / 템플릿 / 채널, + 실패 사유 if failed), status badge, `메시지 내용` (`messageBody`). `data-component="mobile-clients-message-history-detail-*"`.
  - Tier: standard · Sandbox: local · Paths: `mobile/src/components/app/clients/client-message-history-detail.tsx` · Depends: 2.1

then ↓

- **2.3 Tappable rows + in-place drill-down** (feature, med)
  - In the `알림 발송` tab, make `DetailDocRow` a `<button>` that sets `selectedNotificationLogId`; swap list → detail with a `← 목록으로` back action via the existing `.nav-stack.show-detail` slide (`redesign.css`, already used by `[data-component="clients"]`).
  - Tier: standard · Sandbox: local · Paths: `mobile/src/components/app/clients/client-detail.tsx`, `mobile/src/components/app/mobile-redesign/redesign.css` · Depends: 2.1, 2.2

## Phase 3 — Verify & integrate

Prove both tracks green, then visually confirm in an environment that can actually build.

**In parallel:**

- **3.1 Frontend checks** (test, low) — `pnpm --filter ./frontend type-check`; unit tests for the route page-extraction (`page=7` → 1-page PDF; out-of-range → 400/`RangeError`) and the URL builder. Depends: Phase 1.
- **3.2 Mobile checks** (test, low) — `rm -rf mobile/.next` then `pnpm --filter ./mobile type-check`. Depends: Phase 2.

then ↓

- **3.3 Visual verification** (test, med) — in the `dev` env worktree or a Vercel preview: completed contract → `영수증 다운로드` downloads a single-page receipt; mobile client → `알림 발송` → tap message → detail (recipient/phone/template/channel/content/status; failed shows 실패 사유) → `← 목록으로`. Depends: 3.1, 3.2.

---

## Parallelism summary

Phase 1 (frontend) and Phase 2 (mobile) are fully independent (disjoint apps/files) → run as two concurrent tracks, each as its own unit worktree if dispatched in parallel. Phase 3 gates on both.

## Out of scope (this plan)

Web Share on desktop · retry-failed action on mobile · client-detail header quick-actions (메시지/계약서 발급) · DRY-refactoring the extraction route into `packages/shared` · any whole-app-section parity (tracked under BJJ-240).

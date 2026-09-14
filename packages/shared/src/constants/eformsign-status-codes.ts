/**
 * Canonical eformsign document status-code buckets (M1: status-code drift).
 *
 * Investigated three existing copies before canonicalizing:
 *
 * 1. Backend — backend/application/services/eformsign-webhook.service.ts:90-91
 *    (duplicated verbatim in backend/application/services/eformsign-doc.service.ts:26-27):
 *      COMPLETED_STATUS_CODES = 003,012,022,032,050,062,072,092
 *      REJECTED_STATUS_CODES  = 011,021,031,040,042,045,047,049,061,071,080
 *    Backend additionally treats "090" ("철회"/withdrawn) as a same-bucket
 *    terminal-negative status: eformsign-webhook.service.ts:614 synthesizes
 *    `{ statusType: "090", statusDetail: "철회" }`, and
 *    backend/application/services/client.service.ts:26 groups it with the
 *    other revoke-family codes: `REVOKED_DOCUMENT_STATUS_TYPES = new Set(["040", "042", "045", "090"])`.
 *    "090" is not part of eformsign's own API status-code table — it is a
 *    backend-synthesized status — which is why neither frontend nor mobile
 *    (whose code sets are transcribed from the eformsign API docs) had it.
 *
 * 2. Frontend — frontend/src/lib/eformsign/status-codes.ts:10-34:
 *      COMPLETED_CODES = (same 8 as backend)
 *      EXPIRED_CODES   = 011,021,031,040,042,045,047,049,061,071,080
 *    Matches backend's REJECTED_STATUS_CODES exactly (including 047/049),
 *    but is missing "090".
 *
 * 3. Mobile — mobile/src/lib/eformsign/status-codes.ts:10-38:
 *      COMPLETED_CODES = (same 8 as backend)
 *      DELETED_CODES   = 047,049 (carved out into its own bucket —
 *        "Mobile keeps these hidden from the contracts UI", a UI-hiding
 *        concern specific to mobile's contracts list, not a semantic
 *        difference in what these codes mean)
 *      EXPIRED_CODES   = 011,021,031,040,042,045,061,071,080
 *    Missing 047/049 (moved to DELETED_CODES) and missing "090".
 *
 * Canonicalization decision:
 *   - COMPLETED_STATUS_CODES: no drift across all three sources — used as-is.
 *   - EXPIRED_STATUS_CODES: canonicalized to backend's semantics (backend is
 *     the source of truth for what "terminal/negative" means, since it also
 *     owns webhook ingestion) plus "090", per this task's explicit
 *     instruction ("정본 = backend 의미론 기준 + 090 포함").
 *   - 047/049 (doc_request_delete / doc_delete): kept IN the canonical
 *     EXPIRED_STATUS_CODES bucket. Backend and frontend agree on this (2 of
 *     3 sources); the separate DELETED_STATUS_CODES predicate below keeps
 *     mobile's UI-visibility concern (hiding fully-deleted docs) distinct from
 *     the semantic category.
 */

export const COMPLETED_STATUS_CODES = [
    "003", // doc_complete: 문서 완료
    "012", // doc_accept_approval: 문서 결재 승인
    "022", // doc_accept_reception: 문서 내부자 승인
    "032", // doc_accept_outsider: 문서 외부자 승인
    "050", // PDF 전송
    "062", // doc_accept_participant: 참여자 승인
    "072", // doc_accept_reviewer: 검토자 승인
    "092", // 대면서명 완료
] as const;

export const EXPIRED_STATUS_CODES = [
    "011", // doc_reject_approval: 문서 결재 반려
    "021", // doc_reject_reception: 문서 내부자 반려
    "031", // doc_reject_outsider: 문서 외부자 반려
    "040", // doc_request_revoke: 문서 취소 요청
    "042", // doc_revoke: 문서 취소
    "045", // doc_request_reject: 문서 반려 요청
    "047", // doc_request_delete: 문서 삭제 요청
    "049", // doc_delete: 문서 삭제
    "061", // doc_reject_participant: 참여자 반려
    "071", // doc_reject_reviewer: 검토자 반려
    "080", // doc_expired: 문서 만료
    "090", // 철회 (backend-synthesized withdrawal status; see eformsign-webhook.service.ts:614)
] as const;

/**
 * Alias matching backend's naming (`REJECTED_STATUS_CODES`) for the same
 * set. Backend and frontend/mobile name this bucket differently
 * ("rejected" vs. "expired") for what is the same semantic bucket; both
 * names are exported so a follow-up integration task can import whichever
 * matches the call site it is replacing.
 */
export const REJECTED_STATUS_CODES = EXPIRED_STATUS_CODES;

export type CompletedStatusCode = (typeof COMPLETED_STATUS_CODES)[number];
export type ExpiredStatusCode = (typeof EXPIRED_STATUS_CODES)[number];

/** Status codes that represent an in-progress eformsign workflow. */
export const IN_PROGRESS_STATUS_CODES = [
    "001", // doc_tempsave
    "002", // doc_create
    "010", // doc_request_approval
    "020", // doc_request_reception
    "030", // doc_request_outsider
    "043", // doc_update
    "060", // doc_request_participant
    "063", // doc_rerequest_participant
    "064", // doc_open_participant
    "070", // doc_request_reviewer
] as const;

export const DELETED_STATUS_CODES = [
    "047", // doc_request_delete
    "049", // doc_delete
    "099", // legacy backend webhook tombstone
] as const;

export type EformsignStatusCategory = "completed" | "expired" | "in-progress" | "unknown";

export const EFORMSIGN_STATUS_CATEGORY_LABELS = {
    completed: "계약 완료",
    expired: "기간 만료",
    "in-progress": "서명 대기",
    unknown: "알 수 없음",
} as const satisfies Record<EformsignStatusCategory, string>;

/** Provider status names accepted by webhook and client payloads. */
export const EFORMSIGN_STATUS_NAME_TO_CODE: Readonly<Record<string, string>> = {
    doc_tempsave: "001",
    doc_create: "002",
    doc_complete: "003",
    doc_request_approval: "010",
    doc_reject_approval: "011",
    doc_accept_approval: "012",
    doc_request_reception: "020",
    doc_reject_reception: "021",
    doc_accept_reception: "022",
    doc_request_outsider: "030",
    doc_reject_outsider: "031",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_update: "043",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
    doc_withdraw: "090",
    doc_withdrawal: "090",
    doc_tombstone: "099",
} as const;

export type EformsignStatusInput = string | number | null | undefined;

/**
 * Normalize a provider status code or status name to the canonical code.
 * Unknown non-empty values are preserved (lower-cased and trimmed) so callers
 * can record them while classifying them as `unknown`.
 */
export function normalizeEformsignStatusCode(status: EformsignStatusInput): string {
    const normalized = String(status ?? "").trim().toLowerCase();
    if (!normalized) return "000";

    const knownName = EFORMSIGN_STATUS_NAME_TO_CODE[normalized];
    if (knownName) return knownName;

    if (/^\d+$/.test(normalized)) return normalized.padStart(3, "0");
    return normalized;
}

export const normalizeEformsignStatusName = normalizeEformsignStatusCode;

export function isDeletedEformsignStatusCode(status: EformsignStatusInput): boolean {
    const normalized = normalizeEformsignStatusCode(status);
    return (DELETED_STATUS_CODES as readonly string[]).includes(normalized);
}

export function getEformsignStatusCategory(
    status: EformsignStatusInput,
): EformsignStatusCategory {
    const normalized = normalizeEformsignStatusCode(status);

    if ((COMPLETED_STATUS_CODES as readonly string[]).includes(normalized)) {
        return "completed";
    }
    if ((EXPIRED_STATUS_CODES as readonly string[]).includes(normalized)) {
        return "expired";
    }
    if ((IN_PROGRESS_STATUS_CODES as readonly string[]).includes(normalized)) {
        return "in-progress";
    }
    return "unknown";
}

export function getEformsignStatusLabel(status: EformsignStatusInput): string {
    return EFORMSIGN_STATUS_CATEGORY_LABELS[getEformsignStatusCategory(status)];
}

// Compatibility aliases make migration from the existing frontend/mobile
// wrappers mechanical while keeping the canonical names explicit above.
export const normalizeStatusCode = normalizeEformsignStatusCode;
export const getStatusCategory = getEformsignStatusCategory;
export const mapStatusToLabel = getEformsignStatusLabel;
export const mapEformsignStatusToLabel = getEformsignStatusLabel;
export const isDeletedStatusCode = isDeletedEformsignStatusCode;

const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];

/**
 * True when the document's current workflow step is the provider's
 * review/confirmation step. Because that step only becomes current after the
 * customer has signed, this doubles as the "customer already signed" test for
 * in-progress documents — callers must first exclude completed/expired
 * documents, whose current step is no longer meaningful.
 *
 * Canonicalized from the byte-identical copies that lived in
 * frontend/src/lib/eformsign/status-codes.ts and
 * mobile/src/lib/eformsign/status-codes.ts; both now re-export this.
 */
export function isProviderReviewWorkflowStep(
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined,
): boolean {
    const stepType = currentStatus?.step_type?.trim() ?? "";
    const stepName = currentStatus?.step_name?.trim() ?? "";

    if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) return true;
    if (!stepName) return false;
    if (CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) return false;

    const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
    const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
    return hasProviderOwner && hasReviewAction;
}

// Mirror of new admin rules; pinned by backend parity specs and /tmp/legacy-contract-stage-parity.cjs.
import {
    isProviderReviewWorkflowStep,
    isReviewerRejectedEformsignStatus,
    isRevokeRequestedEformsignStatus,
    isRevokedEformsignStatus,
} from "./eformsign-status-codes";
import { KR_BUILTIN_CALENDAR, type KrBusinessDayCalendar } from "../business-days";

// Preserve the historical named export for consumers that imported the
// display-status module directly; the set itself now comes from the single
// versioned calendar source rather than a second hand-maintained copy.
export { KR_HOLIDAYS } from "../business-days";

/**
 * Display status for an eformsign document, shared verbatim by the desktop and
 * mobile contracts UIs so both platforms bucket documents identically.
 *
 * 서명 완료 vs 검토 필요: once the customer has signed, the document sits in the
 * provider-review workflow step. The provider is only expected to act from
 * 1 business day before the contract end date, so until then the document is
 * surfaced as 서명 완료 and flips to 검토 필요 when the window opens.
 */
export type ContractDocStatusLabel = "서명 대기" | "서명 완료" | "검토 필요" | "계약 완료" | "철회 요청됨" | "철회됨" | "반려됨" | "기간 만료" | "파기됨";

export type ContractDocStatusCategory = "completed" | "expired" | "in-progress";

/**
 * Wire enum for a document's display status. The BACKEND is the authority: it
 * stamps `display_status` on document payloads at serve time, and clients map
 * it to a label/variant without re-deriving. The client-side resolver below is
 * the fallback for payloads that predate the field, and the backend keeps a
 * byte-identical copy of this rule pinned by parity tests
 * (backend/application/utils/eformsign-doc-display-status.ts).
 */
export type ContractDocDisplayStatus =
    | "pending"
    | "signed"
    | "review"
    /**
     * At the provider review step with no client attached, so the review cannot
     * proceed. Only the backend can produce this — it is the only side that can
     * see whether the row is claimed. See the resolver's return type below.
     */
    | "unassigned"
    | "completed"
    /**
     * eformsign 040 (doc_request_revoke) and 045 (doc_request_reject): cancellation was
     * requested, not done — it may still be refused (041, which continues like 060) or
     * completed (→ 042). Shown "철회 요청됨" (warning); distinct from 기간 만료
     * (080) and from 철회됨 (042/090). It keeps the "expired" category for tabs/filters/stats —
     * only the label and tone differ.
     */
    | "revoke_requested"
    /**
     * eformsign 042 (doc_revoke) and 090 (synthesized withdrawal): the document was revoked —
     * terminal. Shown "철회됨" (danger); distinct from 기간 만료 (080) and from 철회 요청됨. It keeps
     * the "expired" category for tabs/filters/stats — only the label and tone differ.
     */
    | "revoked"
    /**
     * eformsign 071 (doc_reject_reviewer, 계약-04): the provider's reviewer rejected the document.
     * Shown "반려됨" (solid burgundy). NOT terminal: a later 070 returns it to 서명 완료/검토 필요,
     * a later 072 completes it, and the customer's signature stays valid (receipt link and
     * service-end notice may be sent). Its category is in-progress, not expired.
     */
    | "rejected_by_reviewer"
    | "expired"
    /**
     * BJJ-439 계약 파기: the branch voided the document in the app (eformsign_doc.voided_at is set).
     * App-only state with no eformsign code, so it overrides every code in every resolver (checked
     * first) — eformsign keeps reporting codes for a voided document. Shown "파기됨" (neutral grey).
     * It keeps the "expired" category for tabs/filters/stats — only the label and tone differ — and
     * is never receipt-sendable.
     */
    | "voided"
    | "unknown";

export const CONTRACT_DOC_DISPLAY_STATUS_LABELS = {
    pending: "서명 대기",
    signed: "서명 완료",
    review: "검토 필요",
    unassigned: "고객 등록 필요",
    completed: "계약 완료",
    revoke_requested: "철회 요청됨",
    revoked: "철회됨",
    rejected_by_reviewer: "반려됨",
    expired: "기간 만료",
    voided: "파기됨",
    unknown: "알 수 없음",
} as const satisfies Record<ContractDocDisplayStatus, string>;

/**
 * Every label a display status can carry, derived from the map so the two
 * cannot drift. Wider than ContractDocStatusLabel above, which is deliberately
 * only what the client-side resolver can produce: that one sees neither
 * "알 수 없음" nor "고객 등록 필요", and saying it could would be a lie the
 * compiler would then enforce everywhere.
 */
export type ContractDocDisplayStatusLabel =
    (typeof CONTRACT_DOC_DISPLAY_STATUS_LABELS)[ContractDocDisplayStatus];

export function isContractDocDisplayStatus(value: unknown): value is ContractDocDisplayStatus {
    return typeof value === "string" && value in CONTRACT_DOC_DISPLAY_STATUS_LABELS;
}

const KST_TIME_ZONE = "Asia/Seoul";

/** en-CA locale renders YYYY-MM-DD, giving the KST calendar day of an instant. */
const KST_YMD_FORMAT = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function parseYmdToUtc(ymd: string): Date | null {
    const match = YMD_PATTERN.exec(ymd);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return parsed;
}

/**
 * True when today (KST) is on or after 1 Korean business day before the
 * contract end date — e.g. a Friday end date opens on Thursday, a Monday end
 * date on the preceding Friday, and holidays are skipped like weekends — and
 * stays true after the end date passes.
 *
 * A missing or malformed end date opens the window (the pre-date-rule
 * behavior), so documents without recoverable dates never hide the review cue.
 */
export function isContractReviewWindowOpen(
    contractEndDate: string | null | undefined,
    now: Date = new Date(),
    calendar: KrBusinessDayCalendar = KR_BUILTIN_CALENDAR,
): boolean {
    const endDate = contractEndDate ? parseYmdToUtc(contractEndDate) : null;
    if (!endDate) return true;
    calendar.assertSupportedYear(endDate.getUTCFullYear());

    const threshold = calendar.shiftBusinessDays(endDate.toISOString().slice(0, 10), -1);
    const todayKst = KST_YMD_FORMAT.format(now);
    return todayKst >= threshold;
}

/**
 * Resolve the wire display status for a contract document from its category,
 * workflow step, and end date. Single rule shared by both apps; the backend
 * keeps a parity-tested copy.
 */
export function resolveContractDocDisplayStatus(params: {
    category: ContractDocStatusCategory;
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined;
    contractEndDate: string | null | undefined;
    /**
     * The provider status code (current_status.status_type). Checked first so 040/045
     * (cancellation requested) and 042/090 (revoked) are not folded into the "expired" category.
     */
    statusType?: string | number | null;
    /**
     * eformsign_doc.voided_at (BJJ-439). When set the document reads "voided" before any provider
     * code or category is looked at, because eformsign keeps reporting codes for a voided document.
     */
    voidedAt?: string | null;
    now?: Date;
    /** Holiday calendar to use; defaults to the built-in Korean calendar. */
    calendar?: KrBusinessDayCalendar;
    // "unassigned" is excluded deliberately, not by omission: whether a row is
    // claimed lives only in the local mirror, so this client-side fallback
    // cannot decide it and must not pretend to. A payload carrying
    // display_status gets the backend's answer, which can be "unassigned".
}): Exclude<ContractDocDisplayStatus, "unknown" | "unassigned"> {
    if (params.voidedAt) return "voided";
    if (isRevokeRequestedEformsignStatus(params.statusType)) return "revoke_requested";
    if (isRevokedEformsignStatus(params.statusType)) return "revoked";
    // 071 is in the in-progress category (not terminal), but it is neither 서명 대기 nor 서명 완료.
    if (isReviewerRejectedEformsignStatus(params.statusType)) return "rejected_by_reviewer";
    if (params.category === "completed") return "completed";
    if (params.category === "expired") return "expired";
    if (!isProviderReviewWorkflowStep(params.currentStatus)) return "pending";
    return isContractReviewWindowOpen(params.contractEndDate, params.now, params.calendar) ? "review" : "signed";
}

/** Resolve the display label for a contract document from its category, workflow step, and end date. */
export function resolveContractDocStatusLabel(params: {
    category: ContractDocStatusCategory;
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined;
    contractEndDate: string | null | undefined;
    /** See resolveContractDocDisplayStatus: 040/045 resolve to 철회 요청됨, 042/090 to 철회됨 and 071 to 반려됨 before the category. */
    statusType?: string | number | null;
    /** See resolveContractDocDisplayStatus: a set voidedAt resolves to 파기됨 before any provider code. */
    voidedAt?: string | null;
    now?: Date;
    calendar?: KrBusinessDayCalendar;
}): ContractDocStatusLabel {
    return CONTRACT_DOC_DISPLAY_STATUS_LABELS[resolveContractDocDisplayStatus(params)];
}
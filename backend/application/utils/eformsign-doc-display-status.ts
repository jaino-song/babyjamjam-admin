import { stringFromUnknown } from "application/utils/eformsign-document-customer-name";
import {
    getCurrentStatus,
    getDocumentStatusCategory,
    isProviderReviewStep,
    type EformsignListDoc,
} from "application/utils/eformsign-document-list";
import { MIRROR_UNASSIGNED_KEY } from "application/utils/eformsign-list-doc-from-mirror";
import { isRevokeRequestedStatus } from "domain/constants/eformsign-doc-status.constants";
import {
    isoDateInKorea,
    type KrBusinessDayCalendar,
} from "domain/utils/business-days";

/**
 * Wire enum for a document's display status, stamped on list pages, status
 * signals, and the client-docs payload at SERVE time (never into cached
 * snapshots — the review window moves with the calendar). The backend is the
 * authority; clients map this to a label/variant and display it.
 *
 * Copy of the rule in packages/shared/src/constants/eformsign-doc-status.ts,
 * with exactly one deliberate divergence: only this side can see whether a
 * mirrored row is claimed, so only this side resolves "unassigned". The shared
 * resolver excludes that value from its return type for the same reason — it is
 * the fallback for payloads that predate display_status and has no mirror to
 * consult. Everything else must stay identical.
 *
 * The backend domain surface re-exports the same versioned business-day module
 * from the generated backend runtime package. Parity is pinned by
 * backend/test/utils/eformsign-doc-display-status.spec.ts, which mirrors the
 * shared test fixtures — change both files together.
 */
export type EformsignDocDisplayStatus =
    | "pending"
    | "signed"
    | "review"
    | "unassigned"
    | "completed"
    /**
     * eformsign 040 (doc_request_revoke): cancellation was requested, not done — it may still be
     * refused (→ 060) or completed (→ 042). Display only: the document keeps the "expired"
     * category for tabs, scope and stats; this is neither 기간 만료 (080) nor 철회됨 (042/090).
     */
    | "revoke_requested"
    | "expired"
    | "unknown";

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
 * contract end date — weekends and the given calendar's holidays are both
 * skipped; a missing or malformed end date opens the window (legacy behavior).
 *
 * `calendar` is the branch calendar.
 */
export function isContractReviewWindowOpen(
    contractEndDate: string | null | undefined,
    now: Date,
    calendar: KrBusinessDayCalendar,
): boolean {
    const endDate = contractEndDate ? parseYmdToUtc(contractEndDate) : null;
    if (!endDate) return true;
    calendar.assertSupportedYear(endDate.getUTCFullYear());

    const threshold = calendar.shiftBusinessDays(endDate.toISOString().slice(0, 10), -1);
    return isoDateInKorea(now) >= threshold;
}

/** Resolve the display status of a projected list document. */
export function resolveEformsignDocDisplayStatus(
    document: EformsignListDoc,
    now: Date,
    calendar: KrBusinessDayCalendar,
): EformsignDocDisplayStatus {
    // Before the category checks: 040 sits in the expired bucket for filtering, but the document
    // is not expired — independent of step, unassigned state and end date.
    if (isRevokeRequestedStatus(stringFromUnknown(getCurrentStatus(document)?.["status_type"]))) {
        return "revoke_requested";
    }
    const category = getDocumentStatusCategory(document);
    if (category === "completed") return "completed";
    if (category === "expired") return "expired";
    if (category === "unknown") return "unknown";
    if (!isProviderReviewStep(document)) return "pending";

    // Only here, where the alternatives are "review" and "signed" — both of
    // which promise a provider review that this row cannot receive. An
    // unassigned document at an earlier step stays "pending", which is already
    // true of it and asks nothing of anyone.
    if (document[MIRROR_UNASSIGNED_KEY] === true) return "unassigned";

    const contractEndDate = typeof document["contract_end_date"] === "string"
        ? document["contract_end_date"]
        : null;
    return isContractReviewWindowOpen(contractEndDate, now, calendar) ? "review" : "signed";
}

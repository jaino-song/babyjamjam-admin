import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    type EformsignDocumentClassificationInput,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";
import { isRevokeRequestedStatus } from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import {
    COMPLETED_DOCUMENT_STATUS_TYPES,
    CREATED_DOCUMENT_STATUS_TYPES,
    OPENED_DOCUMENT_STATUS_TYPES,
    REQUESTED_DOCUMENT_STATUS_TYPES,
} from "domain/utils/eformsign-customer-signature";
import { isoDateInKorea, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import type { Prisma } from "@prisma/client";

/** The fields the "current contract" rule reads from an `eformsign_doc` row. */
export type CurrentContractCandidate = EformsignDocumentClassificationInput;

/**
 * The single answer to "which contract is this client's current one?".
 *
 * Both the client summary (badges, alerts, `hasSigned`, `documentStatus`) and the receipt-link
 * automatic path must judge a client's contract with this rule, so a screen and an SMS can never
 * disagree about which document counts:
 *
 * - candidates are contract documents (`documentKind` = contract, or legacy `null`);
 * - service-record snapshots/templates are never contracts, whatever their kind says;
 * - the newest wins: the FIRST remaining row of the input, which MUST already be ordered
 *   `createdDate desc, id desc` by the database.
 *
 * The ordering is deliberately NOT re-done here. `created_date` is `timestamptz(6)`
 * (microseconds) and a JS `Date` only holds milliseconds, so re-ranking in JS would collapse two
 * rows that differ only below the millisecond into a tie and pick by `id` instead — disagreeing
 * with the database. Callers must query with `orderBy: [{ createdDate: "desc" }, { id: "desc" }]`
 * (see `IEformsignDocRepository.findContractCandidatesByClientId`); this helper only filters,
 * stably, and never reorders.
 *
 * Purge-requested rows are deliberately NOT filtered: a purge-requested newest contract is still
 * the current one (the summary shows it as deleted). The caller decides what that means.
 */
export function selectCurrentContractDocument<T extends CurrentContractCandidate>(
    rows: readonly T[],
    serviceRecordTemplateIds: ReadonlySet<string>,
): T | null {
    for (const row of rows) {
        if (isContractCandidate(row, serviceRecordTemplateIds)) return row;
    }
    return null;
}

function isContractCandidate(
    row: CurrentContractCandidate,
    serviceRecordTemplateIds: ReadonlySet<string>,
): boolean {
    if (row.serviceRecordCaseId != null) return false;
    if (row.documentKind != null && row.documentKind !== EFORMSIGN_DOCUMENT_KIND.CONTRACT) return false;
    return !isServiceRecordEformsignDocument(row, serviceRecordTemplateIds);
}

/** The latest contract signal the document-status/active-document checks read. */
export interface LatestContractSignal {
    statusType: string;
    permanentPurgeRequestedAt: Date | null;
    /**
     * When the contract was voided (계약 파기), else `null`. Read straight from the row: this select
     * has no deploy-window fallback, so the `voided_at` column must exist before the app that reads it.
     */
    voidedAt: Date | null;
    documentId: string;
    stepType: string | null;
    stepName: string | null;
    detailPayload: unknown;
}

/**
 * Latest non-service-record contract document per client. The selection rule is
 * `selectCurrentContractDocument`, shared with the receipt-link automatic path, so a screen,
 * a digest and an SMS always judge the same "current" contract.
 */
export async function findLatestContractSignalsByClientId(
    prisma: Pick<Prisma.TransactionClient, "eformsign_doc">,
    serviceRecordTemplateIds: ReadonlySet<string>,
    clientIds: readonly number[],
): Promise<Map<number, LatestContractSignal>> {
    const latestContractMap = new Map<number, LatestContractSignal>();
    if (clientIds.length === 0) return latestContractMap;

    const contractDocs = await prisma.eformsign_doc.findMany({
        where: {
            clientId: { in: [...clientIds] },
            serviceRecordCaseId: null,
            // Contract lifecycle status is an indexed projection that commits before
            // detail/PDF artifacts finish. Do not filter it by artifact syncStatus:
            // doing so can hide the newest contract and fall back to an older one.
            OR: [
                { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                { documentKind: null },
            ],
        },
        // Newest first at full timestamptz(6) precision: selectCurrentContractDocument keeps this order.
        orderBy: [
            { createdDate: "desc" },
            { id: "desc" },
        ],
        select: {
            clientId: true,
            documentId: true,
            statusType: true,
            stepType: true,
            stepName: true,
            detailPayload: true,
            permanentPurgeRequestedAt: true,
            voidedAt: true,
            documentKind: true,
            serviceRecordCaseId: true,
            templateId: true,
        },
    });

    const docsByClientId = new Map<number, typeof contractDocs>();
    for (const doc of contractDocs) {
        if (doc.clientId === null) continue;
        const docs = docsByClientId.get(doc.clientId);
        if (docs) docs.push(doc);
        else docsByClientId.set(doc.clientId, [doc]);
    }

    for (const [clientId, docs] of docsByClientId) {
        const doc = selectCurrentContractDocument(docs, serviceRecordTemplateIds);
        if (!doc) continue;
        latestContractMap.set(clientId, {
            statusType: doc.statusType,
            permanentPurgeRequestedAt: doc.permanentPurgeRequestedAt,
            voidedAt: doc.voidedAt,
            documentId: doc.documentId,
            stepType: doc.stepType,
            stepName: doc.stepName,
            detailPayload: doc.detailPayload,
        });
    }

    return latestContractMap;
}

type ContractStatusSignal = Pick<LatestContractSignal, "statusType" | "permanentPurgeRequestedAt"> & {
    voidedAt?: Date | null;
};

/**
 * A voided (파기) newest contract is no live contract: like a withdrawn newest document it never
 * falls back to an older signed one (`selectCurrentContractDocument` keeps returning the newest row).
 */
export function isVoidedContractSignal(contract: { voidedAt?: Date | null } | null | undefined): boolean {
    return contract?.voidedAt != null;
}

/**
 * Whether the current contract document is still "alive": created / requested (060, 041) /
 * opened / completed, or a pending cancellation (040/045 revoke_requested). Rejected, expired,
 * revoked, deleted, purge-requested, voided or absent documents are dead and fall back to "발송 필요".
 * Mirrors `ClientService`'s `ACTIVE_DOCUMENT_STATUSES` over `mapStatusTypeToDocumentStatus`.
 */
export function isActiveContractSignal(contract: ContractStatusSignal | null | undefined): boolean {
    if (!contract) return false;
    if (contract.permanentPurgeRequestedAt != null) return false;
    if (isVoidedContractSignal(contract)) return false;
    const code = normalizeEformsignStatusCode(contract.statusType);
    return COMPLETED_DOCUMENT_STATUS_TYPES.has(code)
        || isRevokeRequestedStatus(code)
        || OPENED_DOCUMENT_STATUS_TYPES.has(code)
        || CREATED_DOCUMENT_STATUS_TYPES.has(code)
        || REQUESTED_DOCUMENT_STATUS_TYPES.has(code);
}

/** The current contract is signed off (completed), so the 계약서 미완료 list does not hold it. */
export function isCompletedContractSignal(contract: ContractStatusSignal | null | undefined): boolean {
    if (!contract || contract.permanentPurgeRequestedAt != null) return false;
    if (isVoidedContractSignal(contract)) return false;
    return COMPLETED_DOCUMENT_STATUS_TYPES.has(normalizeEformsignStatusCode(contract.statusType));
}

/** 계약서 미완료: the current contract is alive but not yet completed. */
export function isIncompleteContractSignal(contract: ContractStatusSignal | null | undefined): boolean {
    return isActiveContractSignal(contract) && !isCompletedContractSignal(contract);
}

/**
 * Contract attention window, in KR business days before service start, within which a client
 * with no active contract document is flagged as needing one sent. The 발송 필요 badge, the
 * dashboard count, the action-required feeds, the daily digest and `/clients/filtered` all read it.
 */
export const CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD = 6;

/**
 * The single rule behind "발송 필요": a client whose (effective) service is not pre-booking /
 * completed / terminated, with a start date inside the business-day send window and no active
 * contract document. Deliberately ignores 교체 요청.
 *
 * The calendar throws for a year outside its supported/synced range. One client with such a date
 * must not fail a whole request, so the error is reported to `onCalendarError` (with the client
 * id, never PII) and the client is skipped from this business-day-based decision.
 */
export function isContractSendRequired(
    params: {
        clientId?: number;
        serviceStatus: string | null;
        startDate: Date | null;
        hasActiveContractDocument: boolean;
        /** The instant "today" is read from (Korean calendar date); defaults to the current time. */
        now?: Date;
    },
    calendar: KrBusinessDayCalendar,
    onCalendarError?: (clientId: number | undefined, error: unknown) => void,
): boolean {
    if (
        params.serviceStatus === SERVICE_STATUS.PRE_BOOKING ||
        params.serviceStatus === SERVICE_STATUS.COMPLETED ||
        params.serviceStatus === SERVICE_STATUS.TERMINATED
    ) {
        return false;
    }

    if (!params.startDate) return false;
    if (params.hasActiveContractDocument) return false;

    let businessDaysUntilStart: number | null;
    try {
        businessDaysUntilStart = calendar.diffBusinessDays(
            params.startDate.toISOString().slice(0, 10),
            isoDateInKorea(params.now ?? new Date()),
        );
    } catch (error) {
        onCalendarError?.(params.clientId, error);
        return false;
    }
    if (businessDaysUntilStart === null) return false;

    return businessDaysUntilStart <= CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD;
}

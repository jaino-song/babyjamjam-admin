import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    type EformsignDocumentClassificationInput,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";

/** The fields the "current contract" rule reads from an `eformsign_doc` row. */
export interface CurrentContractCandidate extends EformsignDocumentClassificationInput {
    id: number;
    createdDate: Date;
}

/**
 * The single answer to "which contract is this client's current one?".
 *
 * Both the client summary (badges, alerts, `hasSigned`, `documentStatus`) and the receipt-link
 * automatic path must judge a client's contract with this rule, so a screen and an SMS can never
 * disagree about which document counts:
 *
 * - candidates are contract documents (`documentKind` = contract, or legacy `null`);
 * - service-record snapshots/templates are never contracts, whatever their kind says;
 * - the newest wins: `createdDate` descending, then `id` descending as the tie-break.
 *
 * Purge-requested rows are deliberately NOT filtered: a purge-requested newest contract is still
 * the current one (the summary shows it as deleted). The caller decides what that means.
 */
export function selectCurrentContractDocument<T extends CurrentContractCandidate>(
    rows: readonly T[],
    serviceRecordTemplateIds: ReadonlySet<string>,
): T | null {
    let current: T | null = null;
    for (const row of rows) {
        if (!isContractCandidate(row, serviceRecordTemplateIds)) continue;
        if (current === null || isNewer(row, current)) current = row;
    }
    return current;
}

function isContractCandidate(
    row: CurrentContractCandidate,
    serviceRecordTemplateIds: ReadonlySet<string>,
): boolean {
    if (row.serviceRecordCaseId != null) return false;
    if (row.documentKind != null && row.documentKind !== EFORMSIGN_DOCUMENT_KIND.CONTRACT) return false;
    return !isServiceRecordEformsignDocument(row, serviceRecordTemplateIds);
}

function isNewer(candidate: CurrentContractCandidate, current: CurrentContractCandidate): boolean {
    const byCreated = candidate.createdDate.getTime() - current.createdDate.getTime();
    return byCreated !== 0 ? byCreated > 0 : candidate.id > current.id;
}

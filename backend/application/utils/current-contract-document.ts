import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    type EformsignDocumentClassificationInput,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";

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

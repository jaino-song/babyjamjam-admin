import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    EFORMSIGN_REJECTED_STATUS_CODES,
    EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { EXPORT_FILE_TYPES, type ExportClassification } from "./constants";
import { assertIdentifier } from "../source-evidence";

export interface ExportClassificationInput {
    documentId: string;
    documentKind: string | null;
    /** Raw stored value; may be a legacy form such as "3" or "doc_complete". */
    statusType: string | null;
    permanentPurgeRequestedAt: Date | null;
    voidedAt: Date | null;
    detailPayloadIsNull: boolean;
    /** File types that had a row at snapshot time. */
    fileTypesPresent: readonly string[];
}

export interface ExportClassificationResult {
    classification: ExportClassification;
    reasons: string[];
    /** Normalized: 3-digit for known codes, otherwise the lowercased raw string. */
    statusType: string;
}

export interface ExportCounts {
    total: number;
    inaccessible: number;
    unknownTemplate: number;
    policyPending: number;
    excludedByPolicy: number;
    included: number;
}

// KNOWN = completed + in progress + rejected + revoke-requested + {090, 099} (contract D4).
const KNOWN_STATUS_CODES: ReadonlySet<string> = new Set([
    ...EFORMSIGN_COMPLETED_STATUS_CODES,
    ...EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    ...EFORMSIGN_REJECTED_STATUS_CODES,
    ...EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES,
    "090",
    "099",
]);

function hasValidIdentifier(documentId: string): boolean {
    try {
        assertIdentifier(documentId);
        return true;
    } catch {
        return false;
    }
}

/** Contract D4, evaluated in priority order (rows 1, 1b, identifier rule, 2, 3, 4, 5). */
export function classifyExportDocument(input: ExportClassificationInput): ExportClassificationResult {
    const statusType = normalizeEformsignStatusCode(input.statusType);
    const done = (classification: ExportClassification, primary: string | null): ExportClassificationResult => {
        const reasons: string[] = primary ? [primary] : [];
        if (input.voidedAt) reasons.push("voided");
        if (classification === "included") {
            for (const fileType of EXPORT_FILE_TYPES) {
                if (!input.fileTypesPresent.includes(fileType)) reasons.push(`artifact-missing-at-snapshot:${fileType}`);
            }
        }
        return { classification, reasons, statusType };
    };

    if (input.permanentPurgeRequestedAt) return done("inaccessible", "purge-pending");
    if (statusType === "049" && input.documentKind === null && input.detailPayloadIsNull) {
        return done("inaccessible", "purged");
    }
    if (!hasValidIdentifier(input.documentId)) return done("inaccessible", "identifier-invalid");
    if (input.documentKind === null) return done("unknown_template", "document-kind-unknown");
    if (!KNOWN_STATUS_CODES.has(statusType)) return done("policy_pending", "status-unclassified");
    if (!EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)) return done("excluded_by_policy", "incomplete-no-file");
    return done("included", null);
}

export function countExportClassifications(classifications: readonly ExportClassification[]): ExportCounts {
    const counts: ExportCounts = {
        total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0,
    };
    for (const classification of classifications) {
        switch (classification) {
            case "inaccessible": counts.inaccessible++; break;
            case "unknown_template": counts.unknownTemplate++; break;
            case "policy_pending": counts.policyPending++; break;
            case "excluded_by_policy": counts.excludedByPolicy++; break;
            case "included": counts.included++; break;
            default: throw new Error("Unknown export classification");
        }
        counts.total++;
    }
    return counts;
}

/** total must equal the sum of the five exclusive classes (contract 3.2 invariant). */
export function assertExclusiveCounts(counts: ExportCounts): void {
    const sum = counts.inaccessible + counts.unknownTemplate + counts.policyPending
        + counts.excludedByPolicy + counts.included;
    if (counts.total !== sum) {
        throw new Error(`Export counts are not exclusive: total=${counts.total} sum=${sum}`);
    }
}

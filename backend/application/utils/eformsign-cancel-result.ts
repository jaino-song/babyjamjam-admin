import { EformsignApiError, isEformsignDocumentAbsentError } from "infrastructure/api/eformsign-api.error";

/**
 * A vendor HTTP refusal that settles the outcome: 4xx other than a request timeout, rate
 * limit or confirmed document absence. Everything else (timeouts, network errors, 5xx,
 * absence) is ambiguous, and the generation-fenced purge intent must be kept for
 * reconciliation, which can verify the vendor state before purging.
 */
export function isDefinitiveVendorRefusal(error: unknown): boolean {
    if (!(error instanceof EformsignApiError)) return false;
    const { status } = error;
    return status >= 400
        && status < 500
        // A confirmed absence may mean the document is already gone at the vendor,
        // so there is nothing left to cancel. Retain the intent until reconciliation can
        // purge the local detail and PDFs safely.
        && !isEformsignDocumentAbsentError(error)
        && ![408, 429].includes(status);
}

export function successfulDeletedDocumentIds(result: unknown): string[] {
    if (typeof result !== "object" || result === null) {
        return [];
    }
    const resultBody = (result as Record<string, unknown>)["result"];
    if (typeof resultBody !== "object" || resultBody === null) {
        return [];
    }
    const successResult = (resultBody as Record<string, unknown>)["success_result"];
    if (!Array.isArray(successResult)) {
        return [];
    }
    return successResult.filter(
        (documentId): documentId is string =>
            typeof documentId === "string" && documentId.trim().length > 0,
    );
}

import { sanitizeEformsignErrorMessage } from "domain/utils/eformsign-error-message";
import {
    EformsignApiError,
    isEformsignDocumentAbsentError,
} from "infrastructure/api/eformsign-api.error";

export type EformsignCancellationDecision =
    | "accepted"
    | "authoritative_refusal"
    | "uncertain";

export interface EformsignCancellationOutcome {
    documentId: string;
    decision: EformsignCancellationDecision;
    reason: string;
    vendorCode?: string;
}

const AUTHORITATIVE_REFUSAL_CODES = new Set(["4000164"]);
const NON_TERMINAL_AMBIGUOUS_CODES = new Set(["4000031", "4000004", "4000006"]);

/**
 * Reads only the provider's per-document result envelope. The raw response is
 * deliberately not retained: provider payloads may contain recipient PII or
 * credentials and are not an audit receipt.
 */
export function classifyEformsignCancellationResult(
    result: unknown,
    requestedDocumentIds: readonly string[],
): EformsignCancellationOutcome[] {
    const requested = new Set(requestedDocumentIds);
    const outcomes = new Map<string, EformsignCancellationOutcome>();
    const body = readRecord(result)?.["result"];
    const resultBody = readRecord(body);
    const successResult = resultBody?.["success_result"];
    if (Array.isArray(successResult)) {
        for (const value of successResult) {
            if (typeof value !== "string") continue;
            const documentId = value.trim();
            if (!requested.has(documentId)) continue;
            outcomes.set(documentId, {
                documentId,
                decision: "accepted",
                reason: "provider_cancel_accepted",
            });
        }
    }

    const failures = resultBody?.["fail_result"];
    if (Array.isArray(failures)) {
        for (const failure of failures) {
            const record = readRecord(failure);
            const documentId = typeof record?.["document_id"] === "string"
                ? record["document_id"].trim()
                : "";
            if (!requested.has(documentId) || outcomes.has(documentId)) continue;
            const vendorCode = normalizeVendorCode(record?.["code"]);
            const decision = vendorCode && AUTHORITATIVE_REFUSAL_CODES.has(vendorCode)
                ? "authoritative_refusal"
                : "uncertain";
            outcomes.set(documentId, {
                documentId,
                decision,
                reason: vendorCode
                    ? `provider_cancel_${decision}:${vendorCode}`
                    : `provider_cancel_${decision}`,
                ...(vendorCode ? { vendorCode } : {}),
            });
        }
    }

    return requestedDocumentIds.map((documentId) => outcomes.get(documentId) ?? {
        documentId,
        decision: "uncertain",
        reason: "provider_cancel_result_missing_document",
    });
}

/**
 * Classifies a thrown provider error without making a retry/cleanup decision
 * from a caller-supplied HTTP body. Ambiguous and already-absent outcomes keep
 * the purge fence until an operator or reconciliation proves the result.
 */
export function classifyEformsignCancellationError(error: unknown): EformsignCancellationOutcome {
    const apiError = error instanceof EformsignApiError ? error : undefined;
    const apiStatus = apiError?.status;
    const vendorCode = apiError?.vendorCode?.trim();
    if (
        apiError
        && apiStatus !== undefined
        && apiStatus >= 400
        && apiStatus < 500
        && apiStatus !== 408
        && apiStatus !== 429
        && !isEformsignDocumentAbsentError(apiError)
        && (!vendorCode || !NON_TERMINAL_AMBIGUOUS_CODES.has(vendorCode))
    ) {
        return {
            documentId: "",
            decision: "authoritative_refusal",
            reason: `provider_cancel_authoritative_refusal:${vendorCode ?? apiStatus}`,
            ...(vendorCode ? { vendorCode } : {}),
        };
    }

    const sanitized = sanitizeEformsignErrorMessage(error);
    return {
        documentId: "",
        decision: "uncertain",
        reason: sanitized ? `provider_cancel_uncertain:${sanitized}` : "provider_cancel_uncertain",
        ...(vendorCode ? { vendorCode } : {}),
    };
}

/**
 * A compact provider receipt suitable for JSONB. It contains no raw response,
 * request body, token, phone number, or error stack.
 */
export function sanitizeEformsignCancellationReceipt(input: {
    decision: EformsignCancellationDecision;
    documentId: string;
    vendorCode?: string;
    source?: string;
}): Record<string, string> {
    return {
        source: input.source ?? "eformsign_cancel",
        documentId: input.documentId,
        decision: input.decision,
        ...(input.vendorCode ? { vendorCode: input.vendorCode } : {}),
    };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function normalizeVendorCode(value: unknown): string | undefined {
    if (typeof value === "string" && /^\d{4,8}$/.test(value.trim())) {
        return value.trim();
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return String(value);
    }
    return undefined;
}

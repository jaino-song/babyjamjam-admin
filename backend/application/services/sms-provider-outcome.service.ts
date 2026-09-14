export type SmsProviderOutcome = "accepted" | "partial" | "rejected" | "unknown";

/**
 * Classifies one Aligo response using only evidence that is present in the
 * provider request/response pair. A result that cannot account for every
 * requested recipient remains unknown so no resend is authorized.
 */
export function classifySmsProviderOutcome(
    result: unknown,
    expectedRecipientCount: number,
): SmsProviderOutcome {
    if (!Number.isInteger(expectedRecipientCount) || expectedRecipientCount <= 0) {
        return "unknown";
    }

    const response = smsResponse(result);
    if (!response || !hasString(response, "message")) {
        return "unknown";
    }

    const request = smsRequest(result);
    const responseReceiver = request?.["receiver"];
    if (
        typeof responseReceiver !== "string"
        || countSmsRecipients(responseReceiver) !== expectedRecipientCount
    ) {
        return "unknown";
    }

    const resultCode = smsInteger(response["result_code"]);
    if (resultCode === undefined) {
        return "unknown";
    }

    const hasSuccessCount = hasDefinedProperty(response, "success_cnt");
    const hasErrorCount = hasDefinedProperty(response, "error_cnt");
    const successCount = hasSuccessCount ? smsCounter(response["success_cnt"]) : undefined;
    const errorCount = hasErrorCount ? smsCounter(response["error_cnt"]) : undefined;
    if (
        (hasSuccessCount && successCount === undefined)
        || (hasErrorCount && errorCount === undefined)
    ) {
        return "unknown";
    }

    if (resultCode === 1) {
        if (successCount === undefined || errorCount === undefined) {
            return "unknown";
        }
        if (successCount + errorCount !== expectedRecipientCount) {
            return "unknown";
        }
        if (successCount > 0 && errorCount === 0) {
            return "accepted";
        }
        if (successCount > 0 && errorCount > 0) {
            return "partial";
        }
        if (successCount === 0 && errorCount === expectedRecipientCount && errorCount > 0) {
            return "rejected";
        }
        return "unknown";
    }

    // Aligo documents negative result codes as provider failures. Zero and
    // other positive codes are not a registered rejection signal.
    if (resultCode >= 0) {
        return "unknown";
    }

    const normalizedSuccessCount = successCount ?? 0;
    const normalizedErrorCount = errorCount ?? 0;
    if (
        normalizedSuccessCount !== 0
        || (
            normalizedErrorCount !== 0
            && normalizedErrorCount !== expectedRecipientCount
        )
    ) {
        return "unknown";
    }
    return "rejected";
}

export function countSmsRecipients(receiver: string): number {
    return receiver
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean).length;
}

function smsResponse(result: unknown): Record<string, unknown> | null {
    if (!isRecord(result)) {
        return null;
    }
    const response = result["response"];
    return isRecord(response) ? response : null;
}

function smsRequest(result: unknown): Record<string, unknown> | null {
    if (!isRecord(result)) {
        return null;
    }
    const request = result["request"];
    return isRecord(request) ? request : null;
}

function smsInteger(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isInteger(value) && Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string" || !value.trim()) {
        return undefined;
    }
    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) {
        return undefined;
    }
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : undefined;
}

function smsCounter(value: unknown): number | undefined {
    const parsed = smsInteger(value);
    return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function hasDefinedProperty(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

function hasString(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key) && typeof record[key] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

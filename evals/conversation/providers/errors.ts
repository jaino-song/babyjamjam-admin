export const ConversationProviderErrorCode = {
    INVALID_PROFILE: "INVALID_PROFILE",
    UNSUPPORTED_MODEL: "UNSUPPORTED_MODEL",
    INVALID_REQUEST: "INVALID_REQUEST",
    PROVIDER_MISMATCH: "PROVIDER_MISMATCH",
    INVALID_CONTINUATION: "INVALID_CONTINUATION",
    MISSING_CONTINUATION: "MISSING_CONTINUATION",
    MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
    INVALID_TOOL_ARGUMENTS: "INVALID_TOOL_ARGUMENTS",
    REFUSAL: "REFUSAL",
    BLOCKED: "BLOCKED",
    INCOMPLETE: "INCOMPLETE",
    HTTP_FAILURE: "HTTP_FAILURE",
    TRANSPORT_FAILURE: "TRANSPORT_FAILURE",
} as const;

export type ConversationProviderErrorCode = typeof ConversationProviderErrorCode[keyof typeof ConversationProviderErrorCode];

type SafeMetadataValue = string | number | boolean;
export type ConversationProviderErrorMetadata = Readonly<Record<string, SafeMetadataValue>>;

const SAFE_METADATA_KEYS = new Set([
    "field",
    "provider",
    "profileId",
    "status",
    "finishReason",
    "blockReason",
]);

function boundedStatus(status: unknown): number | undefined {
    return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function sanitizeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): ConversationProviderErrorMetadata {
    if (!metadata) return {};
    const sanitized: Record<string, SafeMetadataValue> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (!SAFE_METADATA_KEYS.has(key)) continue;
        if (typeof value === "string") {
            if (value.length <= 96 && /^[A-Za-z0-9_.:-]+$/.test(value)) sanitized[key] = value;
            continue;
        }
        if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
        if (typeof value === "boolean") sanitized[key] = value;
    }
    return sanitized;
}

export interface ConversationProviderErrorOptions {
    readonly code: ConversationProviderErrorCode;
    readonly status?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A bounded error that never carries provider bodies, source messages, prompts, keys, or opaque state. */
export class ConversationProviderCodecError extends Error {
    readonly code: ConversationProviderErrorCode;
    readonly status?: number;
    readonly metadata: ConversationProviderErrorMetadata;

    constructor(options: ConversationProviderErrorOptions) {
        const status = boundedStatus(options.status);
        super(status === undefined ? `Conversation provider error: ${options.code}` : `Conversation provider error: ${options.code} (${status})`);
        this.name = "ConversationProviderCodecError";
        this.code = options.code;
        this.status = status;
        this.metadata = sanitizeMetadata(options.metadata);
        Object.setPrototypeOf(this, new.target.prototype);
    }

    toJSON(): { name: string; code: ConversationProviderErrorCode; status?: number; metadata: ConversationProviderErrorMetadata } {
        return {
            name: this.name,
            code: this.code,
            ...(this.status === undefined ? {} : { status: this.status }),
            metadata: this.metadata,
        };
    }
}

export function providerError(
    code: ConversationProviderErrorCode,
    metadata?: Readonly<Record<string, unknown>>,
    status?: unknown,
): ConversationProviderCodecError {
    return new ConversationProviderCodecError({ code, metadata, status });
}

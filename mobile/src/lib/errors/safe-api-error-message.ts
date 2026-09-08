/**
 * Bare HTTP status names and this app's own proxy placeholder. A backend that
 * only gives us one of these has told the operator nothing, so the localized
 * fallback is the better message.
 */
const UNINFORMATIVE_MESSAGES = new Set([
    "bad request",
    "unauthorized",
    "payment required",
    "forbidden",
    "not found",
    "method not allowed",
    "conflict",
    "gone",
    "unprocessable entity",
    "too many requests",
    "internal server error",
    "not implemented",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
]);

const SQL_IDENTIFIER = String.raw`(?:["'\x60][^"'\x60]+["'\x60]|[a-z_][\w$]*(?:\s*\.\s*(?:["'\x60][^"'\x60]+["'\x60]|[a-z_][\w$]*))?)`;
const SQL_SELECT_FROM_PATTERN = new RegExp(
    String.raw`\bselect\s+(?<projection>\*|${SQL_IDENTIFIER}(?:\s*,\s*${SQL_IDENTIFIER})*)\s+from\s+(?<table>${SQL_IDENTIFIER})(?<tail>[\s\S]*)`,
    "i",
);
const SQL_CLAUSE_PATTERN = /\b(?:where\s+[a-z_][\w$.'"\x60]*\s*(?:=|<>|!=|<=|>=|<|>|\bis\b|\bin\b|\blike\b)|join\s+[a-z_][\w$.'"\x60]*\s+on\b|group\s+by\s+[a-z_][\w$.'"\x60]*|order\s+by\s+[a-z_][\w$.'"\x60]*|having\s+[a-z_][\w$.'"\x60]*\s*(?:=|<>|!=|<=|>=|<|>|\bis\b|\bin\b|\blike\b)|limit\s+\d+|offset\s+\d+|union(?:\s+all)?\s+select)/i;

/**
 * Keep ordinary validation text visible while rejecting technical diagnostics
 * and value-bearing credentials that should never be shown to an operator.
 */
const UNSAFE_SERVER_MESSAGE_PATTERNS = [
    /\bprisma(?:client)?\b/i,
    /\b(?:sqlstate\s*[:=]?\s*[0-9a-z-]{3,}|sql\s+(?:error|exception|query|statement|syntax))\b/i,
    /\b(?:insert\s+into|update\s+[a-z_][\w.$]*\s+set|delete\s+from\s+[a-z_][\w.$]*)\b/i,
    /\b(?:stack\s*trace|node_modules|referenceerror|typeerror|syntaxerror|econn(?:refused|reset|aborted))\b/i,
    /\bupstream\s+(?:error|failure|rejected)\b/i,
    /\bbearer\s+\S+/i,
    /\b(?:access|refresh|oauth)[ _-]?token\s*[:=]\s*\S+/i,
    /\bapi[ _-]?key\s*[:=]\s*\S+/i,
    /\bclient[ _-]?secret\s*[:=]\s*\S+/i,
    /\bpassword\s*[:=]\s*\S+/i,
    /\bauthorization\s*[:=]\s*(?:bearer\s+)?\S+/i,
    /(?:^|[\s:])(?:\/(?:users|home|app|var|tmp|workspace)\/|[A-Za-z]:[\\/])/i,
];

interface ApiErrorPayload {
    error?: unknown;
    message?: unknown;
    statusCode?: unknown;
}

interface ResponsePayload {
    payload: ApiErrorPayload;
    status?: number;
}

function isUninformative(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return UNINFORMATIVE_MESSAGES.has(normalized) || normalized.startsWith("failed to ");
}

function isUnsafeServerMessage(message: string, status: number | undefined): boolean {
    if (status !== undefined && status >= 500) {
        return true;
    }

    const selectMatch = SQL_SELECT_FROM_PATTERN.exec(message);
    if (selectMatch?.groups) {
        const projection = selectMatch.groups.projection;
        const table = selectMatch.groups.table;
        const tail = selectMatch.groups.tail;
        const hasProjectionList = projection.includes(",");
        const hasQuotedIdentifier = /["'\x60]/.test(`${projection}${table}`);
        const hasSqlClause = SQL_CLAUSE_PATTERN.test(tail);
        const hasStatementTerminator = tail.includes(";");

        if (projection === "*" || hasProjectionList || hasQuotedIdentifier || hasSqlClause || hasStatementTerminator) {
            return true;
        }
    }

    return UNSAFE_SERVER_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function getResponsePayload(error: unknown): ResponsePayload | null {
    if (!error || typeof error !== "object") {
        return null;
    }

    const candidate = error as {
        response?: { data?: unknown; status?: unknown };
        data?: unknown;
        status?: unknown;
    };
    const data = candidate.response?.data ?? candidate.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return null;
    }

    const payload = data as ApiErrorPayload;
    const responseStatus = candidate.response?.status ?? candidate.status;
    const status = typeof responseStatus === "number"
        ? responseStatus
        : typeof payload.statusCode === "number"
            ? payload.statusCode
            : undefined;

    return { payload, status };
}

function normalizeMessageCandidate(candidate: unknown, status: number | undefined): string | null {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    const messages = values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .filter((entry) => !isUninformative(entry))
        .filter((entry) => !isUnsafeServerMessage(entry, status));

    return messages.length > 0 ? messages.join(", ") : null;
}

/**
 * Read only the controlled response message/error fields. The helper rejects
 * raw 5xx payloads and technical/credential diagnostics before either the
 * mobile BFF or UI can expose them.
 */
export function getSafeApiDisplayMessage(error: unknown): string | null {
    const response = getResponsePayload(error);
    if (!response) {
        return null;
    }

    for (const candidate of [response.payload.message, response.payload.error]) {
        const text = normalizeMessageCandidate(candidate, response.status);
        if (text) {
            return text;
        }
    }

    return null;
}

/**
 * Apply the same credential/identity redaction used by the shared proxy when
 * a controlled 4xx message is returned by the mobile adapter.
 */
export function sanitizeApiDisplayMessage(message: string): string {
    return message
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(
            /([?&](?:access[_-]?token|refresh[_-]?token|oauth[_-]?token|external[_-]?token|api[ _-]?key|authorization|member[_-]?email|member[_-]?id)=)[^&\s]+/gi,
            "$1[REDACTED]",
        )
        .replace(
            /(["']?(?:access[ _-]?token|refresh[ _-]?token|oauth[ _-]?token|external[ _-]?token|api[ _-]?key|authorization|member[ _-]?(?:email|id)|client[ _-]?secret|password|secret)["']?\s*[:=]\s*)["']?[^"'\s,;}&]+["']?/gi,
            "$1[REDACTED]",
        )
        .replace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            "[REDACTED_EMAIL]",
        )
        .replace(/\s+/g, " ")
        .trim();
}

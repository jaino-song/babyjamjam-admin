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

type SqlTokenKind = "number" | "operator" | "punctuation" | "quoted" | "word";

interface SqlToken {
    kind: SqlTokenKind;
    value: string;
}

/**
 * This is deliberately a small SQL-shaped scanner, not a SQL parser. It only
 * recognizes a complete SELECT projection followed by FROM and a relation,
 * which is enough to keep query diagnostics out of controlled 4xx messages.
 */
const SQL_PROJECTION_KEYWORDS = new Set([
    "all",
    "as",
    "case",
    "distinct",
    "else",
    "end",
    "false",
    "filter",
    "null",
    "over",
    "then",
    "true",
    "when",
]);
const SQL_RELATION_TAIL_KEYWORDS = new Set([
    "except",
    "fetch",
    "for",
    "group",
    "having",
    "intersect",
    "join",
    "limit",
    "lock",
    "offset",
    "on",
    "order",
    "returning",
    "union",
    "where",
    "window",
]);
const SQL_OPERATOR_CHARS = "+-*/%<>=!|&^~:";
const SQL_PUNCTUATION_CHARS = ".,()[];";

/**
 * Keep sensitive names in one policy so response rejection and diagnostic
 * redaction cannot drift apart. Cookie headers are handled as whole values
 * because one header can contain several cookie pairs.
 */
const SENSITIVE_KEY_PATTERN_SOURCE = [
    "access[ _-]?token",
    "refresh[ _-]?token",
    "oauth[ _-]?token",
    "external[ _-]?token",
    "auth[ _-]?token",
    "api[ _-]?key",
    "authorization",
    "member[ _-]?(?:email|id)",
    "client[ _-]?secret",
    "password",
    "secret",
    "cookie",
    "set-cookie",
].join("|");

const SENSITIVE_KEY_ASSIGNMENT_PATTERN = new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:["']?(?:${SENSITIVE_KEY_PATTERN_SOURCE})["']?)\\s*[:=]\\s*(?:["'][^"']*["']|\\S+)`,
    "i",
);

const SENSITIVE_QUERY_PATTERN = new RegExp(
    `([?&](?:${SENSITIVE_KEY_PATTERN_SOURCE})=)[^&\\s]+`,
    "gi",
);

const COOKIE_HEADER_PATTERN = new RegExp(
    `(^|[^A-Za-z0-9_])(["']?(?:cookie|set-cookie)["']?\\s*[:=]\\s*)(?:["'][^"']*["']|[^\\n\\r,}]+)`,
    "gi",
);

const SENSITIVE_VALUE_ASSIGNMENT_PATTERN = new RegExp(
    `(^|[^A-Za-z0-9_])(["']?(?:${SENSITIVE_KEY_PATTERN_SOURCE})["']?\\s*[:=]\\s*)(?:["'][^"']*["']|[^"'\\s,;}&]+)`,
    "gi",
);

function isSqlWordStart(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z_$]/.test(char);
}

function isSqlWordPart(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function isSqlNumberPart(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_.]/.test(char);
}

function tokenizeSqlLikeMessage(message: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let index = 0;

    while (index < message.length) {
        const char = message[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            const quote = char;
            const start = index;
            index += 1;

            while (index < message.length) {
                if (message[index] === "\\") {
                    index += 2;
                    continue;
                }

                if (message[index] === quote) {
                    if (message[index + 1] === quote) {
                        index += 2;
                        continue;
                    }

                    index += 1;
                    break;
                }

                index += 1;
            }

            tokens.push({ kind: "quoted", value: message.slice(start, index) });
            continue;
        }

        if (isSqlWordStart(char)) {
            const start = index;
            index += 1;
            while (isSqlWordPart(message[index])) {
                index += 1;
            }
            tokens.push({ kind: "word", value: message.slice(start, index).toLowerCase() });
            continue;
        }

        if (/[0-9]/.test(char)) {
            const start = index;
            index += 1;
            while (isSqlNumberPart(message[index])) {
                index += 1;
            }
            tokens.push({ kind: "number", value: message.slice(start, index) });
            continue;
        }

        if (SQL_OPERATOR_CHARS.includes(char)) {
            const start = index;
            index += 1;
            if ("=<>|".includes(message[index] ?? "")) {
                index += 1;
            }
            tokens.push({ kind: "operator", value: message.slice(start, index) });
            continue;
        }

        if (SQL_PUNCTUATION_CHARS.includes(char)) {
            tokens.push({ kind: "punctuation", value: char });
            index += 1;
            continue;
        }

        tokens.push({ kind: "punctuation", value: char });
        index += 1;
    }

    return tokens;
}

function isSqlKeyword(token: SqlToken | undefined, keyword: string): boolean {
    return token?.kind === "word" && token.value === keyword;
}

function isSqlIdentifierToken(token: SqlToken | undefined): boolean {
    return token?.kind === "word" || token?.kind === "quoted";
}

function splitSqlProjection(tokens: SqlToken[]): SqlToken[][] | null {
    const segments: SqlToken[][] = [];
    let segment: SqlToken[] = [];
    let parentheses = 0;
    let brackets = 0;

    for (const token of tokens) {
        if (token.value === "(") {
            parentheses += 1;
        } else if (token.value === ")") {
            parentheses -= 1;
            if (parentheses < 0) {
                return null;
            }
        } else if (token.value === "[") {
            brackets += 1;
        } else if (token.value === "]") {
            brackets -= 1;
            if (brackets < 0) {
                return null;
            }
        }

        if (token.value === "," && parentheses === 0 && brackets === 0) {
            if (segment.length === 0) {
                return null;
            }
            segments.push(segment);
            segment = [];
            continue;
        }

        segment.push(token);
    }

    if (parentheses !== 0 || brackets !== 0 || segment.length === 0) {
        return null;
    }

    segments.push(segment);
    return segments;
}

function isSqlProjectionSegment(segment: SqlToken[]): boolean {
    if (segment.length === 1 && isSqlIdentifierToken(segment[0])) {
        return true;
    }

    return segment.some((token) => (
        token.kind === "number"
        || token.kind === "operator"
        || token.kind === "quoted"
        || token.value === "."
        || token.value === "("
        || token.value === ")"
        || token.value === "["
        || token.value === "]"
        || SQL_PROJECTION_KEYWORDS.has(token.value)
    ));
}

function isSqlProjection(tokens: SqlToken[]): boolean {
    const segments = splitSqlProjection(tokens);
    return segments !== null && segments.every(isSqlProjectionSegment);
}

function findTopLevelFrom(tokens: SqlToken[], selectIndex: number): number | null {
    let parentheses = 0;
    let brackets = 0;

    for (let index = selectIndex + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.value === "(") {
            parentheses += 1;
        } else if (token.value === ")") {
            if (parentheses === 0) {
                return null;
            }
            parentheses -= 1;
        } else if (token.value === "[") {
            brackets += 1;
        } else if (token.value === "]") {
            if (brackets === 0) {
                return null;
            }
            brackets -= 1;
        } else if (parentheses === 0 && brackets === 0 && isSqlKeyword(token, "from")) {
            return index;
        }
    }

    return null;
}

function consumeSqlRelationIdentifier(tokens: SqlToken[], start: number): number | null {
    if (!isSqlIdentifierToken(tokens[start])) {
        return null;
    }

    let index = start + 1;
    while (tokens[index]?.value === ".") {
        if (!isSqlIdentifierToken(tokens[index + 1])) {
            return null;
        }
        index += 2;
    }

    return index;
}

function consumeSqlDerivedRelation(tokens: SqlToken[], start: number): number | null {
    if (tokens[start]?.value !== "(") {
        return null;
    }

    let depth = 0;
    for (let index = start; index < tokens.length; index += 1) {
        if (tokens[index].value === "(") {
            depth += 1;
        } else if (tokens[index].value === ")") {
            depth -= 1;
            if (depth === 0) {
                return index + 1;
            }
        }
    }

    return null;
}

function hasSqlRelationAfterFrom(
    tokens: SqlToken[],
    fromIndex: number,
    projection: SqlToken[],
): boolean {
    const relationStart = fromIndex + 1;
    const isDerivedRelation = tokens[relationStart]?.value === "(";
    let index = isDerivedRelation
        ? consumeSqlDerivedRelation(tokens, relationStart)
        : consumeSqlRelationIdentifier(tokens, relationStart);
    if (index === null) {
        return false;
    }

    if (isDerivedRelation && !tokens.slice(relationStart + 1, index - 1).some((token) => isSqlKeyword(token, "select"))) {
        return false;
    }

    if (isSqlKeyword(tokens[index], "as")) {
        index += 1;
        if (!isSqlIdentifierToken(tokens[index])) {
            return false;
        }
        index += 1;
    }

    const tail = tokens[index];
    if (
        tail === undefined
        || tail.value === ";"
        || (tail.kind === "word" && SQL_RELATION_TAIL_KEYWORDS.has(tail.value))
    ) {
        return true;
    }

    // SQL commonly continues with a bare table alias or a dialect-specific
    // clause. Once the projection and relation are SQL-shaped, an unknown tail
    // should remain hidden instead of making the diagnostic displayable. Keep
    // the natural-language "from the list" near-miss visible when it has a
    // single plain-word projection.
    return !(
        projection.length === 1
        && projection[0]?.kind === "word"
        && tokens[relationStart]?.kind === "word"
        && tokens[relationStart]?.value === "the"
    );
}

function looksLikeSqlSelectDiagnostic(message: string): boolean {
    const tokens = tokenizeSqlLikeMessage(message);

    for (let index = 0; index < tokens.length; index += 1) {
        if (!isSqlKeyword(tokens[index], "select")) {
            continue;
        }

        const fromIndex = findTopLevelFrom(tokens, index);
        if (fromIndex === null) {
            continue;
        }

        const projection = tokens.slice(index + 1, fromIndex);
        if (isSqlProjection(projection) && hasSqlRelationAfterFrom(tokens, fromIndex, projection)) {
            return true;
        }
    }

    return false;
}

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

    if (looksLikeSqlSelectDiagnostic(message)) {
        return true;
    }

    return SENSITIVE_KEY_ASSIGNMENT_PATTERN.test(message)
        || UNSAFE_SERVER_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
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
        .replace(SENSITIVE_QUERY_PATTERN, "$1[REDACTED]")
        .replace(COOKIE_HEADER_PATTERN, "$1$2[REDACTED]")
        .replace(SENSITIVE_VALUE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]")
        .replace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            "[REDACTED_EMAIL]",
        )
        .replace(/\s+/g, " ")
        .trim();
}

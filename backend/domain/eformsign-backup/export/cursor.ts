import { EXPORT_PAGE_LIMIT_DEFAULT, EXPORT_PAGE_LIMIT_MAX } from "./constants";

export type ExportPageErrorCode = "INVALID_REQUEST" | "INVALID_CURSOR" | "CURSOR_PARAMETER_MISMATCH";

export type ExportPageResolution =
    | { ok: true; afterOrdinal: number; limit: number }
    | { ok: false; code: ExportPageErrorCode };

interface DecodedCursor {
    snapshotId: string;
    lastOrdinal: number;
    limit: number;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const CURSOR_MAX_LENGTH = 512;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

function isLimit(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= EXPORT_PAGE_LIMIT_MAX;
}
function isOrdinal(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function encodeExportCursor(cursor: DecodedCursor): string {
    if (!UUID_SHAPE.test(cursor.snapshotId) || !isOrdinal(cursor.lastOrdinal) || !isLimit(cursor.limit)) {
        throw new Error("Invalid export cursor");
    }
    return Buffer.from(
        JSON.stringify({ v: 1, s: cursor.snapshotId, o: cursor.lastOrdinal, l: cursor.limit }), "utf8",
    ).toString("base64url");
}

/** Strict decode: any deviation from the exact {v,s,o,l} schema yields null. */
function decodeExportCursor(raw: string): DecodedCursor | null {
    if (raw.length === 0 || raw.length > CURSOR_MAX_LENGTH || !CURSOR_ALPHABET.test(raw)) return null;
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) return null; // reject non-canonical encodings
    let parsed: unknown;
    try {
        parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as { v?: unknown; s?: unknown; o?: unknown; l?: unknown };
    const keys = Object.keys(record).sort();
    if (keys.length !== 4 || keys.join(",") !== "l,o,s,v") return null;
    if (record.v !== 1) return null;
    if (typeof record.s !== "string" || !UUID_SHAPE.test(record.s)) return null;
    if (!isOrdinal(record.o) || !isLimit(record.l)) return null;
    return { snapshotId: record.s, lastOrdinal: record.o, limit: record.l };
}

/** Query-string limit: canonical decimal integer 1..100; omitted -> default. */
export function parseExportLimit(raw: string | undefined): number | "INVALID_REQUEST" {
    if (raw === undefined) return EXPORT_PAGE_LIMIT_DEFAULT;
    if (!/^(0|[1-9][0-9]{0,8})$/.test(raw)) return "INVALID_REQUEST";
    const value = Number(raw);
    return value >= 1 && value <= EXPORT_PAGE_LIMIT_MAX ? value : "INVALID_REQUEST";
}

/** Contract 3.3-3.4. A present-but-empty `cursor` is a malformed cursor, an empty `limit` is invalid. */
export function resolveExportPage(input: {
    snapshotId: string; cursor?: string; limit?: string;
}): ExportPageResolution {
    const limit = parseExportLimit(input.limit);
    if (limit === "INVALID_REQUEST") return { ok: false, code: "INVALID_REQUEST" };
    if (input.cursor === undefined) return { ok: true, afterOrdinal: 0, limit };

    const decoded = decodeExportCursor(input.cursor);
    if (!decoded) return { ok: false, code: "INVALID_CURSOR" };
    if (decoded.snapshotId !== input.snapshotId) return { ok: false, code: "CURSOR_PARAMETER_MISMATCH" };
    if (input.limit !== undefined && limit !== decoded.limit) return { ok: false, code: "CURSOR_PARAMETER_MISMATCH" };
    return { ok: true, afterOrdinal: decoded.lastOrdinal, limit: decoded.limit };
}

/** Contract 3.1: 1..128 chars of [A-Za-z0-9._:-]. */
export function isValidIdempotencyKey(raw: string | undefined): raw is string {
    return typeof raw === "string" && IDEMPOTENCY_KEY.test(raw);
}

import { z } from "zod";
import { assertIdentifier } from "domain/eformsign-backup/source-evidence";
import { WORKER_REASON_CODES } from "./worker-error";

/** Shared zod primitives of the worker records. Pure; no I/O. */
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_SEQUENCE = 999_999_999_999;
export const MAX_PATH_SEGMENT_BYTES = 255;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const OPAQUE_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const hex64 = z.string().regex(HEX64_PATTERN);
export const runIdField = z.string().regex(UUID_V4_PATTERN);
/** Ids the worker only compares and records (installation, snapshot, destination); same shape `assertIdentifier` accepts. */
export const identifier = z.string().regex(IDENTIFIER_PATTERN);
/**
 * A document id exactly as the export server sent it. The ledger records it even when it cannot become a
 * path segment, so the candidate can be marked `blocked invalid-path-segment` instead of aborting the run.
 */
export const opaqueId = z.string().regex(OPAQUE_ID_PATTERN);
export const count = z.number().int().min(0);
export const sequenceField = z.number().int().min(1).max(MAX_SEQUENCE);
export const sequenceFloorField = z.number().int().min(0).max(MAX_SEQUENCE);
export const isoUtc = z.string().regex(ISO_UTC_PATTERN).refine((value) => !Number.isNaN(Date.parse(value)));
export const isoWithOffset = z.string().regex(ISO_OFFSET_PATTERN).refine((value) => !Number.isNaN(Date.parse(value)));
export const reasonCodeField = z.enum(WORKER_REASON_CODES);
export const fileNameField = z.string().regex(FILE_NAME_PATTERN);
export const artifactTypeField = z.enum(["document", "audit-trail"]);

/** Path-safe relative POSIX key: no leading slash, no empty/`.`/`..` segment, no backslash or control character. */
export function isSafeRelativeKey(value: string): boolean {
    if (value.length === 0 || value.length > 1024 || value.startsWith("/")) return false;
    return value.split("/").every((segment) => segment.length > 0
        && segment.length <= MAX_PATH_SEGMENT_BYTES
        && segment !== "." && segment !== ".."
        && !/[\\\u0000-\u001f\u007f]/u.test(segment));
}
export const relativeKeyField = z.string().refine(isSafeRelativeKey);

/** Identifier that can be one path segment: `assertIdentifier` and at most 255 UTF-8 bytes. */
export function isPathIdentifier(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        assertIdentifier(value);
    } catch {
        return false;
    }
    return Buffer.byteLength(value, "utf8") <= MAX_PATH_SEGMENT_BYTES;
}
export const pathIdentifier = z.string().refine(isPathIdentifier);

/** Counts a run reports (ledger `run_finished` and the archive run inventory share one shape). */
export const runCountsSchema = z.strictObject({
    candidates: count,
    included: count,
    verified: count,
    blocked: count,
    retryWait: count,
    integrityError: count,
    terminalUnavailable: count,
    orphanTemps: count,
});
export type RunCounts = z.infer<typeof runCountsSchema>;

import { createHash } from "node:crypto";
import { z } from "zod";
import { EXPORT_CLASSIFICATIONS } from "domain/eformsign-backup/export/constants";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { DESTINATION_STATES } from "./destination-transitions";
import {
    artifactTypeField, count, fileNameField, hex64, identifier, isoUtc, isoWithOffset, opaqueId,
    reasonCodeField, relativeKeyField, runCountsSchema, runIdField, sequenceField, sequenceFloorField,
} from "./schema-fields";
import { JUDGED_HISTORICAL_COVERAGES, JUDGED_SNAPSHOT_STATUSES } from "./snapshot-status";
import { WorkerError } from "./worker-error";

export const LEDGER_RECORD_VERSION = 1;
const CHECKSUM_DOMAIN = "eformsign-backup/ledger/v1\n";

export const LEDGER_RECORD_TYPES = [
    "installed",
    "run_started",
    "snapshot_bound",
    "candidate_observed",
    "destination_transition",
    "staging_verified",
    "manifest_published",
    "completion_published",
    "run_finished",
    "tail_discarded",
    "recovery_started",
    "recovered_verified",
] as const;
export type LedgerRecordType = typeof LEDGER_RECORD_TYPES[number];

const installationFields = {
    installationId: identifier,
    archiveId: identifier,
    archiveDev: count,
    archiveIno: count,
    destinationIdentity: identifier,
    destinationRevision: identifier,
};

const destinationStateField = z.enum(DESTINATION_STATES);

export const knownGapSchema = z.strictObject({
    documentId: opaqueId,
    artifactIdentity: hex64.nullable(),
    reasonCode: reasonCodeField,
});
export type KnownGap = z.infer<typeof knownGapSchema>;

/** Contract §4: body fields are fixed, no additions. */
export const LEDGER_BODY_SCHEMAS = {
    installed: z.strictObject(installationFields),
    run_started: z.strictObject({ runId: runIdField, scheduledFor: isoWithOffset.nullable(), startedAt: isoUtc }),
    snapshot_bound: z.strictObject({
        runId: runIdField,
        snapshotId: identifier,
        sequence: sequenceField,
        scopeRevision: identifier,
        policyRevision: identifier,
        counts: z.record(z.string().min(1).max(64), count),
    }),
    candidate_observed: z.strictObject({
        snapshotId: identifier,
        ordinal: count,
        documentId: opaqueId,
        classification: z.enum(EXPORT_CLASSIFICATIONS),
        metadataRevision: hex64,
        artifacts: z.array(z.strictObject({
            artifactType: artifactTypeField,
            artifactIdentity: hex64,
            sha256: hex64,
            byteLength: count,
        })).max(2),
    }),
    destination_transition: z.strictObject({
        artifactIdentity: hex64,
        destinationIdentity: identifier,
        destinationRevision: identifier,
        from: destinationStateField.nullable(),
        to: destinationStateField,
        reasonCode: reasonCodeField.nullable(),
        attempts: count,
        nextRetryAt: isoUtc.nullable(),
        relativeKey: relativeKeyField.nullable(),
    }),
    staging_verified: z.strictObject({ artifactIdentity: hex64, sha256: hex64, byteLength: count }),
    manifest_published: z.strictObject({ relativeKey: relativeKeyField, sha256: hex64 }),
    completion_published: z.strictObject({ relativeKey: relativeKeyField, sha256: hex64, sequence: sequenceField }),
    run_finished: z.strictObject({
        runId: runIdField,
        finishedAt: isoUtc,
        snapshotStatus: z.enum(JUDGED_SNAPSHOT_STATUSES),
        historicalCoverage: z.enum(JUDGED_HISTORICAL_COVERAGES),
        reasonCodes: z.array(reasonCodeField).max(64),
        counts: runCountsSchema,
    }),
    tail_discarded: z.strictObject({ byteLength: count, quarantineName: fileNameField }),
    recovery_started: z.strictObject({
        ...installationFields,
        priorLedgerName: fileNameField,
        sequenceFloor: sequenceFloorField,
        knownGaps: z.array(knownGapSchema),
    }),
    recovered_verified: z.strictObject({ artifactIdentity: hex64, relativeKey: relativeKeyField, sha256: hex64 }),
} as const satisfies Record<LedgerRecordType, z.ZodType>;

export type LedgerBodies = { [T in LedgerRecordType]: z.infer<typeof LEDGER_BODY_SCHEMAS[T]> };
export interface LedgerRecordOf<T extends LedgerRecordType> {
    v: typeof LEDGER_RECORD_VERSION;
    seq: number;
    type: T;
    at: string;
    body: LedgerBodies[T];
}
export type LedgerRecord = { [T in LedgerRecordType]: LedgerRecordOf<T> }[LedgerRecordType];

const TYPE_SET: ReadonlySet<string> = new Set(LEDGER_RECORD_TYPES);
function isLedgerRecordType(value: unknown): value is LedgerRecordType {
    return typeof value === "string" && TYPE_SET.has(value);
}

/** `sum` of a record: sha256 over the domain label and the canonical JSON of the record without `sum`. */
export function ledgerChecksum(record: {
    v: number; seq: number; type: string; at: string; body: unknown;
}): string {
    const { v, seq, type, at, body } = record;
    return createHash("sha256").update(`${CHECKSUM_DOMAIN}${canonicalJson({ v, seq, type, at, body })}`, "utf8").digest("hex");
}

const envelopeSchema = z.strictObject({
    v: z.unknown(),
    seq: z.number().int().min(1),
    type: z.string(),
    at: isoUtc,
    body: z.unknown(),
    sum: hex64,
});

/** One journal line: canonical JSON of the record plus `sum`, then `\n`. Throws `ledger-schema` for an invalid record. */
export function encodeLedgerLine(record: LedgerRecord): string {
    const schema = (LEDGER_BODY_SCHEMAS as Record<string, z.ZodType>)[record.type];
    if (!schema || record.v !== LEDGER_RECORD_VERSION || !Number.isSafeInteger(record.seq) || record.seq < 1
        || !isoUtc.safeParse(record.at).success || !schema.safeParse(record.body).success) {
        throw new WorkerError("ledger-schema");
    }
    return `${canonicalJson({ ...record, sum: ledgerChecksum(record) })}\n`;
}

export type LedgerDecodeErrorKind = "malformed" | "unsupported-version" | "checksum" | "unknown-type" | "schema";
export type LedgerDecodeResult =
    | { ok: true; record: LedgerRecord }
    | { ok: false; error: LedgerDecodeErrorKind };

/** Verifies JSON shape, `v`, `sum`, type and body schema. Never throws on bad input. */
export function decodeLedgerLine(line: string): LedgerDecodeResult {
    try {
        const text = line.endsWith("\n") ? line.slice(0, -1) : line;
        const parsed: unknown = JSON.parse(text);
        const envelope = envelopeSchema.safeParse(parsed);
        if (!envelope.success) return { ok: false, error: "malformed" };
        const { v, seq, type, at, body, sum } = envelope.data;
        if (v !== LEDGER_RECORD_VERSION) return { ok: false, error: "unsupported-version" };
        if (ledgerChecksum({ v: LEDGER_RECORD_VERSION, seq, type, at, body }) !== sum) {
            return { ok: false, error: "checksum" };
        }
        if (!isLedgerRecordType(type)) return { ok: false, error: "unknown-type" };
        const checked = LEDGER_BODY_SCHEMAS[type].safeParse(body);
        if (!checked.success) return { ok: false, error: "schema" };
        return { ok: true, record: { v: LEDGER_RECORD_VERSION, seq, type, at, body: checked.data } as LedgerRecord };
    } catch {
        // JSON.parse failure, or a value canonicalJson refuses (unsafe integer, forbidden key): not a valid record.
        return { ok: false, error: "malformed" };
    }
}

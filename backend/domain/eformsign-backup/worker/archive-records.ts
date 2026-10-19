import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExportFileType } from "domain/eformsign-backup/export/constants";
import {
    EVIDENCE_DOMAINS, canonicalJson, evidenceDigest, type ArtifactKind,
} from "domain/eformsign-backup/source-evidence";
import {
    artifactKey, completionKey, completionName, manifestKey, type ArchiveArtifactType,
} from "./archive-paths";
import {
    artifactTypeField, count, hex64, isoUtc, isoWithOffset, pathIdentifier, reasonCodeField, relativeKeyField,
    runCountsSchema, runIdField, sequenceField, identifier,
} from "./schema-fields";
import { JUDGED_HISTORICAL_COVERAGES, JUDGED_SNAPSHOT_STATUSES } from "./snapshot-status";
import { WorkerError } from "./worker-error";

export const ARCHIVE_SCHEMA_VERSION = 1;

/** The export API says `audit_trail`; the archive and `ArtifactKind` say `audit-trail` (export/evidence.ts:19, kept as its own copy). */
export function toArchiveArtifactType(fileType: ExportFileType): ArchiveArtifactType {
    return fileType === "audit_trail" ? "audit-trail" : "document";
}

export const manifestSchema = z.strictObject({
    schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
    companyId: pathIdentifier,
    documentId: pathIdentifier,
    metadataRevision: hex64,
    bundleId: hex64.nullable(),
    consistency: z.enum(["unverified", "incomplete"]),
    artifacts: z.array(z.strictObject({
        artifactType: artifactTypeField,
        artifactIdentity: hex64,
        sha256: hex64,
        byteLength: count,
        relativeKey: relativeKeyField,
    })).min(1).max(2),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const completionSchema = z.strictObject({
    schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
    companyId: pathIdentifier,
    sequence: sequenceField,
    snapshotId: identifier,
    runId: runIdField,
    scopeRevision: identifier,
    policyRevision: identifier,
    destinationIdentity: identifier,
    destinationRevision: identifier,
    coverage: z.literal("unverified"),
    entries: z.array(z.strictObject({
        documentId: pathIdentifier,
        metadataRevision: hex64,
        manifestKey: relativeKeyField,
        manifestSha256: hex64,
    })),
    gaps: z.array(z.strictObject({ documentId: z.string().min(1).max(512), reasonCode: reasonCodeField })),
});
export type Completion = z.infer<typeof completionSchema>;

export const runInventorySchema = z.strictObject({
    schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
    runId: runIdField,
    scheduledFor: isoWithOffset.nullable(),
    startedAt: isoUtc,
    finishedAt: isoUtc,
    snapshotId: identifier.nullable(),
    sequence: sequenceField.nullable(),
    snapshotStatus: z.enum(JUDGED_SNAPSHOT_STATUSES),
    historicalCoverage: z.enum(JUDGED_HISTORICAL_COVERAGES),
    reasonCodes: z.array(reasonCodeField).max(64),
    counts: runCountsSchema,
});
export type RunInventory = z.infer<typeof runInventorySchema>;

/** A record ready to publish: the value, its canonical JSON bytes (no trailing newline) and their sha256. */
export interface BuiltRecord<T> {
    value: T;
    bytes: Uint8Array;
    sha256: string;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
function build<T>(schema: z.ZodType<T>, input: unknown): BuiltRecord<T> {
    const checked = schema.safeParse(input);
    if (!checked.success) throw new WorkerError("internal");
    const bytes = Buffer.from(canonicalJson(checked.data), "utf8");
    return { value: checked.data, bytes, sha256: sha256Hex(bytes) };
}
function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Same value as `evaluateBundle(...).bundleId`: `null` unless both artifact kinds are present
 * (a document with one kind is `incomplete` and has no bundle).
 */
export function bundleIdFor(
    companyId: string, documentId: string, metadataRevision: string,
    artifacts: ReadonlyArray<{ artifactType: ArchiveArtifactType; artifactIdentity: string }>,
): string | null {
    const kinds = new Set(artifacts.map((artifact) => artifact.artifactType));
    if (kinds.size !== artifacts.length) throw new WorkerError("internal");
    if (kinds.size !== 2) return null;
    const sorted = artifacts
        .map((artifact) => ({ artifactKind: artifact.artifactType as ArtifactKind, artifactId: artifact.artifactIdentity }))
        .sort((a, b) => compare(a.artifactKind, b.artifactKind));
    return evidenceDigest(EVIDENCE_DOMAINS.bundle, {
        companyId, documentId, artifacts: sorted, metadataRevision, sourceRevision: null,
    });
}

export interface ManifestInput {
    companyId: string;
    documentId: string;
    metadataRevision: string;
    artifacts: ReadonlyArray<{ artifactType: ArchiveArtifactType; artifactIdentity: string; sha256: string; byteLength: number }>;
}

/** `relativeKey`, `bundleId` and `consistency` are derived here so they cannot disagree with the artifacts. */
export function buildManifest(input: ManifestInput): BuiltRecord<Manifest> {
    const artifacts = [...input.artifacts]
        .sort((a, b) => compare(a.artifactType, b.artifactType))
        .map((artifact) => ({
            artifactType: artifact.artifactType,
            artifactIdentity: artifact.artifactIdentity,
            sha256: artifact.sha256,
            byteLength: artifact.byteLength,
            relativeKey: artifactKey({
                companyId: input.companyId, documentId: input.documentId,
                artifactType: artifact.artifactType, sha256: artifact.sha256,
            }),
        }));
    const bundleId = bundleIdFor(input.companyId, input.documentId, input.metadataRevision, artifacts);
    return build(manifestSchema, {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        companyId: input.companyId,
        documentId: input.documentId,
        metadataRevision: input.metadataRevision,
        bundleId,
        consistency: bundleId === null ? "incomplete" : "unverified",
        artifacts,
    });
}

/** sha256 of the canonical JSON of the completion: its identity in the file name. No timestamp is part of it. */
export function completionContentDigest(completion: Completion): string {
    return createHash("sha256").update(canonicalJson(completion), "utf8").digest("hex");
}

export interface CompletionInput {
    companyId: string;
    sequence: number;
    snapshotId: string;
    runId: string;
    scopeRevision: string;
    policyRevision: string;
    destinationIdentity: string;
    destinationRevision: string;
    entries: ReadonlyArray<{ documentId: string; metadataRevision: string; manifestSha256: string }>;
    gaps: ReadonlyArray<{ documentId: string; reasonCode: z.infer<typeof reasonCodeField> }>;
}

export function buildCompletion(input: CompletionInput): BuiltRecord<Completion> & {
    contentDigest: string; name: string; relativeKey: string;
} {
    const entries = input.entries
        .map((entry) => ({
            documentId: entry.documentId,
            metadataRevision: entry.metadataRevision,
            manifestKey: manifestKey({
                companyId: input.companyId, documentId: entry.documentId, metadataRevision: entry.metadataRevision,
            }),
            manifestSha256: entry.manifestSha256,
        }))
        .sort((a, b) => compare(a.documentId, b.documentId));
    const seen = new Set<string>();
    const gaps = input.gaps
        .filter((gap) => {
            const key = `${gap.documentId}\u0000${gap.reasonCode}`;
            return seen.has(key) ? false : (seen.add(key), true);
        })
        .map((gap) => ({ documentId: gap.documentId, reasonCode: gap.reasonCode }))
        .sort((a, b) => compare(a.documentId, b.documentId) || compare(a.reasonCode, b.reasonCode));
    const built = build(completionSchema, {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        companyId: input.companyId,
        sequence: input.sequence,
        snapshotId: input.snapshotId,
        runId: input.runId,
        scopeRevision: input.scopeRevision,
        policyRevision: input.policyRevision,
        destinationIdentity: input.destinationIdentity,
        destinationRevision: input.destinationRevision,
        coverage: "unverified",
        entries,
        gaps,
    });
    const contentDigest = completionContentDigest(built.value);
    const name = completionName({ sequence: built.value.sequence, contentDigest });
    const relativeKey = completionKey({ companyId: built.value.companyId, sequence: built.value.sequence, contentDigest });
    return { ...built, contentDigest, name, relativeKey };
}

export type RunInventoryInput = Omit<RunInventory, "schemaVersion">;

export function buildRunInventory(input: RunInventoryInput): BuiltRecord<RunInventory> {
    return build(runInventorySchema, { schemaVersion: ARCHIVE_SCHEMA_VERSION, ...input });
}

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    EXPORT_SNAPSHOT_TTL_MS,
    type ExportArtifact,
    type ExportClassification,
    type ExportCounts,
    type ExportFileType,
    type ExportSnapshotStatus,
} from "domain/eformsign-backup/export";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

/** Rows per createMany call; keeps one statement well below the bind-parameter limit. */
export const CANDIDATE_INSERT_CHUNK = 500;
const SOURCE_TRANSACTION_TIMEOUT_MS = 60_000;
const WRITE_TRANSACTION_TIMEOUT_MS = 60_000;
const READ_TRANSACTION_TIMEOUT_MS = 15_000;

export interface ExportSourceDoc {
    documentId: string;
    documentKind: string | null;
    statusType: string | null;
    templateId: string | null;
    permanentPurgeRequestedAt: Date | null;
    voidedAt: Date | null;
    detailPayloadIsNull: boolean;
}
export interface ExportSourceFile {
    documentId: string;
    fileType: ExportFileType;
    sha256: string;
    byteSize: number;
}
export interface ExportSource {
    docs: ExportSourceDoc[];
    files: ExportSourceFile[];
}

export interface ExportSnapshotIdentity {
    principalId: string;
    companyId: string;
    scopeRevision: string;
    policyRevision: string;
    idempotencyKey: string;
    requestHash: string;
}
export interface ExportSnapshotRecord extends ExportSnapshotIdentity {
    id: string;
    status: ExportSnapshotStatus;
    counts: ExportCounts | null;
    failureCode: string | null;
    createdAt: Date;
    readyAt: Date | null;
    expiresAt: Date | null;
}
export interface ExportCandidateRecord {
    ordinal: number;
    documentId: string;
    classification: ExportClassification;
    reasons: string[];
    statusType: string;
    documentKind: string | null;
    metadataRevision: string;
    artifacts: ExportArtifact[];
}
export interface CreateReadySnapshotInput extends ExportSnapshotIdentity {
    counts: ExportCounts;
    candidates: ExportCandidateRecord[];
}
export interface RecordFailedSnapshotInput extends ExportSnapshotIdentity {
    failureCode: string;
}
export interface ExportCandidateArtifactMatch {
    documentId: string;
    fileType: ExportFileType;
    sha256: string;
    byteSize: number;
}
export interface ExportArtifactSource {
    doc: { permanentPurgeRequestedAt: Date | null; statusType: string | null; syncStatus: string | null } | null;
    file: { sha256: string; byteSize: number; contentType: string; content?: Buffer } | null;
}

const SNAPSHOT_COLUMNS = {
    id: true, principalId: true, companyId: true, scopeRevision: true, policyRevision: true, idempotencyKey: true,
    requestHash: true, status: true, counts: true, failureCode: true, createdAt: true, readyAt: true, expiresAt: true,
} as const;

function toSnapshotRecord(row: {
    id: string; principalId: string; companyId: string; scopeRevision: string; policyRevision: string;
    idempotencyKey: string; requestHash: string; status: string; counts: Prisma.JsonValue | null;
    failureCode: string | null; createdAt: Date; readyAt: Date | null; expiresAt: Date | null;
}): ExportSnapshotRecord {
    return { ...row, status: row.status as ExportSnapshotStatus, counts: row.counts as ExportCounts | null };
}

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * The one place that reads `eformsign_doc` / `eformsign_doc_file` across branches for the machine
 * export (BJJ-454). Those reads run in system scope: a snapshot is company-wide by definition
 * (inactive-branch and unassigned documents included), and the caller is a machine principal with
 * no branch. The reads are strictly read-only on the eformsign tables and never select `content`
 * (except the artifact byte read), `detail_payload` or any name/phone column. The only writes
 * go to the three export tables, and only the snapshot/candidate pair is written here.
 */
@Injectable()
export class SbEformsignBackupExportRepository {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Every document and the metadata of every file in ONE read-only RepeatableRead transaction, so
     * the pair is a single consistent cut. `detailPayloadIsNull` comes from a SQL-NULL filter: the
     * payload itself is never fetched.
     */
    readSourceForSnapshot(): Promise<ExportSource> {
        return runSystemScope(() => this.prisma.$transaction(async (tx) => {
            const docs = await tx.eformsign_doc.findMany({
                select: {
                    id: true, documentId: true, documentKind: true, statusType: true, templateId: true,
                    permanentPurgeRequestedAt: true, voidedAt: true,
                },
            });
            const nullPayload = await tx.eformsign_doc.findMany({
                where: { detailPayload: { equals: Prisma.DbNull } },
                select: { id: true },
            });
            const files = await tx.eformsign_doc_file.findMany({
                select: { eformsignDocId: true, fileType: true, sha256: true, byteSize: true },
            });

            const nullPayloadIds = new Set(nullPayload.map(row => row.id));
            const documentIdByPk = new Map<number, string>();
            const sourceDocs: ExportSourceDoc[] = docs.map(({ id, ...doc }) => {
                documentIdByPk.set(id, doc.documentId);
                return { ...doc, detailPayloadIsNull: nullPayloadIds.has(id) };
            });
            const sourceFiles: ExportSourceFile[] = [];
            for (const file of files) {
                const documentId = documentIdByPk.get(file.eformsignDocId);
                if (documentId === undefined) continue;
                sourceFiles.push({ documentId, fileType: file.fileType as ExportFileType, sha256: file.sha256, byteSize: file.byteSize });
            }
            return { docs: sourceDocs, files: sourceFiles };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            timeout: SOURCE_TRANSACTION_TIMEOUT_MS,
            maxWait: SOURCE_TRANSACTION_TIMEOUT_MS,
        }));
    }

    findSnapshotByIdempotency(principalId: string, idempotencyKey: string): Promise<ExportSnapshotRecord | null> {
        return this.lookupByIdempotency(principalId, idempotencyKey);
    }

    async findSnapshot(id: string): Promise<ExportSnapshotRecord | null> {
        const row = await this.prisma.eformsign_backup_export_snapshot.findUnique({ where: { id }, select: SNAPSHOT_COLUMNS });
        return row ? toSnapshotRecord(row) : null;
    }

    /**
     * One write transaction: the snapshot is inserted directly as `ready`, then its candidates.
     * `building` is never committed. A unique violation on (principal, key) means another request
     * won the race: return its row, and let the caller compare request hashes.
     */
    async createReadySnapshot(input: CreateReadySnapshotInput): Promise<ExportSnapshotRecord> {
        const readyAt = new Date();
        try {
            const row = await this.prisma.$transaction(async (tx) => {
                const created = await tx.eformsign_backup_export_snapshot.create({
                    data: {
                        principalId: input.principalId, companyId: input.companyId, scopeRevision: input.scopeRevision,
                        policyRevision: input.policyRevision, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
                        status: "ready", counts: input.counts as unknown as Prisma.InputJsonValue,
                        readyAt, expiresAt: new Date(readyAt.getTime() + EXPORT_SNAPSHOT_TTL_MS),
                    },
                    select: SNAPSHOT_COLUMNS,
                });
                for (let offset = 0; offset < input.candidates.length; offset += CANDIDATE_INSERT_CHUNK) {
                    await tx.eformsign_backup_export_candidate.createMany({
                        data: input.candidates.slice(offset, offset + CANDIDATE_INSERT_CHUNK)
                            .map(candidate => toCandidateRow(created.id, candidate)),
                    });
                }
                return created;
            }, { timeout: WRITE_TRANSACTION_TIMEOUT_MS, maxWait: WRITE_TRANSACTION_TIMEOUT_MS });
            return toSnapshotRecord(row);
        } catch (error) {
            return this.convergeOrThrow(error, input);
        }
    }

    /** A `failed` row (counts NULL) in its own short transaction; on a unique violation return the existing row. */
    async recordFailedSnapshot(input: RecordFailedSnapshotInput): Promise<ExportSnapshotRecord> {
        try {
            const row = await this.prisma.eformsign_backup_export_snapshot.create({
                data: {
                    principalId: input.principalId, companyId: input.companyId, scopeRevision: input.scopeRevision,
                    policyRevision: input.policyRevision, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
                    status: "failed", failureCode: input.failureCode,
                },
                select: SNAPSHOT_COLUMNS,
            });
            return toSnapshotRecord(row);
        } catch (error) {
            return this.convergeOrThrow(error, input);
        }
    }

    /** Up to `limit` candidates after `afterOrdinal`, plus whether more follow. */
    async listCandidates(
        snapshotId: string, afterOrdinal: number, limit: number,
    ): Promise<{ items: ExportCandidateRecord[]; hasMore: boolean }> {
        const rows = await this.prisma.eformsign_backup_export_candidate.findMany({
            where: { snapshotId, ordinal: { gt: afterOrdinal } },
            orderBy: { ordinal: "asc" },
            take: limit + 1,
        });
        return { items: rows.slice(0, limit).map(toCandidateRecord), hasMore: rows.length > limit };
    }

    /** Resolves an artifact identity inside one snapshot through the two per-file identity indexes. */
    async findCandidateArtifact(snapshotId: string, artifactIdentity: string): Promise<ExportCandidateArtifactMatch | null> {
        const row = await this.prisma.eformsign_backup_export_candidate.findFirst({
            where: { snapshotId, OR: [{ documentArtifactIdentity: artifactIdentity }, { auditTrailArtifactIdentity: artifactIdentity }] },
            select: {
                documentId: true, documentArtifactIdentity: true, documentSha256: true, documentByteSize: true,
                auditTrailSha256: true, auditTrailByteSize: true,
            },
        });
        if (!row) return null;
        if (row.documentArtifactIdentity === artifactIdentity && row.documentSha256 !== null && row.documentByteSize !== null) {
            return { documentId: row.documentId, fileType: "document", sha256: row.documentSha256, byteSize: row.documentByteSize };
        }
        if (row.auditTrailSha256 !== null && row.auditTrailByteSize !== null) {
            return { documentId: row.documentId, fileType: "audit_trail", sha256: row.auditTrailSha256, byteSize: row.auditTrailByteSize };
        }
        return null;
    }

    /**
     * The document row and the file row in ONE short read transaction (system scope). `content` is
     * selected only when asked for, so the metadata pass never loads bytes.
     */
    readArtifactForDownload(
        documentId: string, fileType: ExportFileType, options: { withContent: boolean },
    ): Promise<ExportArtifactSource> {
        return runSystemScope(() => this.prisma.$transaction(async (tx) => {
            const doc = await tx.eformsign_doc.findUnique({
                where: { documentId },
                select: { id: true, permanentPurgeRequestedAt: true, statusType: true, syncStatus: true },
            });
            if (!doc) return { doc: null, file: null };
            const file = await tx.eformsign_doc_file.findUnique({
                where: { eformsignDocId_fileType: { eformsignDocId: doc.id, fileType } },
                select: {
                    sha256: true, byteSize: true, contentType: true,
                    ...(options.withContent ? { content: true } : {}),
                },
            });
            const { id: _id, ...docMetadata } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars -- named only to drop it
            if (!file) return { doc: docMetadata, file: null };
            const { content, ...fileMetadata } = file as typeof file & { content?: Uint8Array };
            return {
                doc: docMetadata,
                file: content === undefined ? fileMetadata : { ...fileMetadata, content: Buffer.isBuffer(content) ? content : Buffer.from(content) },
            };
        }, { timeout: READ_TRANSACTION_TIMEOUT_MS, maxWait: READ_TRANSACTION_TIMEOUT_MS }));
    }

    private async lookupByIdempotency(principalId: string, idempotencyKey: string): Promise<ExportSnapshotRecord | null> {
        const row = await this.prisma.eformsign_backup_export_snapshot.findUnique({
            where: { principalId_idempotencyKey: { principalId, idempotencyKey } },
            select: SNAPSHOT_COLUMNS,
        });
        return row ? toSnapshotRecord(row) : null;
    }

    private async convergeOrThrow(error: unknown, identity: ExportSnapshotIdentity): Promise<ExportSnapshotRecord> {
        if (!isUniqueViolation(error)) throw error;
        const existing = await this.lookupByIdempotency(identity.principalId, identity.idempotencyKey);
        if (!existing) throw error; // a violation on something other than (principal, key)
        return existing;
    }
}

function toCandidateRow(snapshotId: string, candidate: ExportCandidateRecord): Prisma.eformsign_backup_export_candidateCreateManyInput {
    const document = candidate.artifacts.find(artifact => artifact.fileType === "document");
    const audit = candidate.artifacts.find(artifact => artifact.fileType === "audit_trail");
    return {
        snapshotId, ordinal: candidate.ordinal, documentId: candidate.documentId, classification: candidate.classification,
        reasons: candidate.reasons, statusType: candidate.statusType, documentKind: candidate.documentKind,
        metadataRevision: candidate.metadataRevision,
        documentSha256: document?.sha256 ?? null, documentByteSize: document?.byteSize ?? null,
        documentArtifactIdentity: document?.artifactIdentity ?? null,
        auditTrailSha256: audit?.sha256 ?? null, auditTrailByteSize: audit?.byteSize ?? null,
        auditTrailArtifactIdentity: audit?.artifactIdentity ?? null,
    };
}

function toCandidateRecord(row: {
    ordinal: number; documentId: string; classification: string; reasons: string[]; statusType: string;
    documentKind: string | null; metadataRevision: string;
    documentSha256: string | null; documentByteSize: number | null; documentArtifactIdentity: string | null;
    auditTrailSha256: string | null; auditTrailByteSize: number | null; auditTrailArtifactIdentity: string | null;
}): ExportCandidateRecord {
    const artifacts: ExportArtifact[] = [];
    if (row.documentSha256 !== null && row.documentByteSize !== null && row.documentArtifactIdentity !== null) {
        artifacts.push({ fileType: "document", artifactIdentity: row.documentArtifactIdentity, sha256: row.documentSha256, byteSize: row.documentByteSize });
    }
    if (row.auditTrailSha256 !== null && row.auditTrailByteSize !== null && row.auditTrailArtifactIdentity !== null) {
        artifacts.push({ fileType: "audit_trail", artifactIdentity: row.auditTrailArtifactIdentity, sha256: row.auditTrailSha256, byteSize: row.auditTrailByteSize });
    }
    return {
        ordinal: row.ordinal, documentId: row.documentId, classification: row.classification as ExportClassification,
        reasons: row.reasons, statusType: row.statusType, documentKind: row.documentKind,
        metadataRevision: row.metadataRevision, artifacts,
    };
}

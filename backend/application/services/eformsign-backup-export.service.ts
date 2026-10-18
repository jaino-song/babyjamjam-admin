import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    EXPORT_POLICY_REVISION,
    EXPORT_SCOPE_REVISION,
    EXPORT_ARTIFACT_MAX_CONCURRENCY,
    ExportError,
    assertExclusiveCounts,
    buildExportArtifacts,
    buildExportMetadataRevision,
    classifyExportDocument,
    countExportClassifications,
    decideExportArtifact,
    encodeExportCursor,
    exportRequestHash,
    isValidIdempotencyKey,
    resolveExportPage,
    verifyExportArtifactBytes,
    type ExportCandidatePageView,
    type ExportCandidateView,
    type ExportCounts,
    type ExportPrincipal,
    type ExportSnapshotView,
} from "domain/eformsign-backup/export";
import { assertIdentifier } from "domain/eformsign-backup/source-evidence";
import {
    SbEformsignBackupExportRepository,
    type ExportCandidateRecord,
    type ExportSnapshotRecord,
    type ExportSource,
} from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";

export interface CreateExportSnapshotBody {
    companyId: string;
    scopeRevision: string;
    policyRevision: string;
}

export interface ExportArtifactView {
    bytes: Buffer;
    contentType: string;
    byteSize: number;
    sha256: string;
    artifactIdentity: string;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_IDENTITY_SHAPE = /^[0-9a-f]{64}$/;
const RATE_LIMIT_RETRY_SECONDS = 5;
const ARTIFACT_PENDING_RETRY_SECONDS = 60;
const ZERO_COUNTS: ExportCounts = { total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 };

const FAILURE_COMPUTE = "snapshot-compute-failed";
const FAILURE_WRITE = "snapshot-write-failed";

/** Code-unit order (not locale order): the same document set always numbers the same way. */
const byDocumentId = (a: { documentId: string }, b: { documentId: string }): number =>
    a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;

/**
 * Machine export of the company's eformsign backup inventory (BJJ-454): fixed snapshot, paged
 * candidates, exact artifact bytes. It talks only to the export repository; it deliberately has no
 * mirror, provider, outbox or event dependency, so nothing here can repair, re-download or send.
 */
@Injectable()
export class EformsignBackupExportService {
    private artifactReadsInFlight = 0;

    constructor(
        private readonly repository: SbEformsignBackupExportRepository,
        private readonly config: ConfigService,
    ) {}

    async createSnapshot(principal: ExportPrincipal, body: CreateExportSnapshotBody, idempotencyKey: string): Promise<ExportSnapshotView> {
        if (!isValidIdempotencyKey(idempotencyKey)) throw new ExportError("INVALID_REQUEST", { reasonCode: "idempotency-key" });
        const companyId = this.resolveCompany();
        if (body.companyId !== companyId || !principal.companyIds.includes(body.companyId)) throw new ExportError("NOT_FOUND");
        if (body.scopeRevision !== EXPORT_SCOPE_REVISION || body.policyRevision !== EXPORT_POLICY_REVISION) {
            throw new ExportError("UNSUPPORTED_REVISION");
        }

        const requestBody = { companyId: body.companyId, scopeRevision: body.scopeRevision, policyRevision: body.policyRevision };
        const requestHash = exportRequestHash(requestBody);
        const existing = await this.repository.findSnapshotByIdempotency(principal.principalId, idempotencyKey);
        if (existing) return this.replay(existing, requestHash);

        const identity = {
            principalId: principal.principalId, companyId, scopeRevision: body.scopeRevision,
            policyRevision: body.policyRevision, idempotencyKey, requestHash,
        };
        let prepared: { counts: ExportCounts; candidates: ExportCandidateRecord[] };
        try {
            const source = await this.repository.readSourceForSnapshot();
            prepared = this.prepare(companyId, source);
        } catch {
            return this.replay(await this.repository.recordFailedSnapshot({ ...identity, failureCode: FAILURE_COMPUTE }), requestHash);
        }
        let created: ExportSnapshotRecord;
        try {
            created = await this.repository.createReadySnapshot({ ...identity, ...prepared });
        } catch {
            return this.replay(await this.repository.recordFailedSnapshot({ ...identity, failureCode: FAILURE_WRITE }), requestHash);
        }
        return this.replay(created, requestHash);
    }

    async getSnapshot(principal: ExportPrincipal, snapshotId: string): Promise<ExportSnapshotView> {
        const snapshot = await this.accessSnapshot(principal, snapshotId);
        this.assertNotExpired(snapshot);
        return toSnapshotView(snapshot);
    }

    async listCandidates(
        principal: ExportPrincipal, snapshotId: string, cursor?: string, limit?: string,
    ): Promise<ExportCandidatePageView> {
        const companyId = this.resolveCompany();
        if (!UUID_SHAPE.test(snapshotId)) throw new ExportError("NOT_FOUND");
        const page = resolveExportPage({ snapshotId, ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) });
        if (!page.ok) throw new ExportError(page.code);

        const snapshot = await this.loadOwnedSnapshot(principal, snapshotId, companyId);
        this.assertNotExpired(snapshot);
        if (snapshot.status === "building") throw new ExportError("SNAPSHOT_NOT_READY");
        if (snapshot.status === "failed") throw new ExportError("SNAPSHOT_FAILED");

        const { items, hasMore } = await this.repository.listCandidates(snapshotId, page.afterOrdinal, page.limit);
        const last = items[items.length - 1];
        return {
            snapshotId,
            items: items.map(toCandidateView),
            nextCursor: hasMore && last
                ? encodeExportCursor({ snapshotId, lastOrdinal: last.ordinal, limit: page.limit })
                : null,
        };
    }

    async readArtifact(principal: ExportPrincipal, snapshotId: string, artifactIdentity: string): Promise<ExportArtifactView> {
        const companyId = this.resolveCompany();
        if (!UUID_SHAPE.test(snapshotId) || !ARTIFACT_IDENTITY_SHAPE.test(artifactIdentity)) throw new ExportError("NOT_FOUND");

        const snapshot = await this.loadOwnedSnapshot(principal, snapshotId, companyId);
        const expected = await this.repository.findCandidateArtifact(snapshotId, artifactIdentity);
        if (!expected) throw new ExportError("NOT_FOUND");
        this.assertNotExpired(snapshot);

        // The slot is taken after the cheap checks and before any file row or byte is read (contract 3.5 #3b).
        if (this.artifactReadsInFlight >= EXPORT_ARTIFACT_MAX_CONCURRENCY) {
            throw new ExportError("RATE_LIMITED", { retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS });
        }
        this.artifactReadsInFlight++;
        try {
            const expectation = { sha256: expected.sha256, byteSize: expected.byteSize };
            // Pass 1 decides from metadata alone, so a missing, moved or oversized file never loads bytes.
            this.assertServable(decideExportArtifact({ expected: expectation, ...await this.metadata(expected) }));
            // Pass 2 reads the bytes and decides again on the same read, so a change between the two
            // passes is reported as what it is rather than as a byte mismatch.
            const { doc, file } = await this.repository.readArtifactForDownload(expected.documentId, expected.fileType, { withContent: true });
            this.assertServable(decideExportArtifact({ expected: expectation, doc, file }));
            const bytes = file?.content;
            if (!file || !bytes || !verifyExportArtifactBytes(bytes, expectation)) throw new ExportError("CONSISTENCY_CONFLICT");
            return {
                bytes,
                contentType: file.contentType || "application/pdf",
                byteSize: bytes.length,
                sha256: expected.sha256,
                artifactIdentity,
            };
        } finally {
            this.artifactReadsInFlight--;
        }
    }

    private metadata(expected: { documentId: string; fileType: "document" | "audit_trail" }) {
        return this.repository.readArtifactForDownload(expected.documentId, expected.fileType, { withContent: false });
    }

    private assertServable(decision: ReturnType<typeof decideExportArtifact>): void {
        if (decision.kind === "serve") return;
        throw new ExportError(decision.code, decision.code === "ARTIFACT_PENDING" ? { retryAfterSeconds: ARTIFACT_PENDING_RETRY_SECONDS } : undefined);
    }

    /** Configured company, trimmed; unset or not a valid identifier -> the export is unavailable (503). */
    private resolveCompany(): string {
        const configured = this.config.get<string>("EFORMSIGN_COMPANY_ID")?.trim() || null;
        if (!configured) throw new ExportError("EXPORT_UNAVAILABLE");
        try {
            assertIdentifier(configured);
        } catch {
            throw new ExportError("EXPORT_UNAVAILABLE", { reasonCode: "company-id-invalid" });
        }
        return configured;
    }

    private async accessSnapshot(principal: ExportPrincipal, snapshotId: string): Promise<ExportSnapshotRecord> {
        const companyId = this.resolveCompany();
        if (!UUID_SHAPE.test(snapshotId)) throw new ExportError("NOT_FOUND");
        return this.loadOwnedSnapshot(principal, snapshotId, companyId);
    }

    /** Same principal AND the company is both on the credential and the configured one; otherwise it does not exist. */
    private async loadOwnedSnapshot(principal: ExportPrincipal, snapshotId: string, companyId: string): Promise<ExportSnapshotRecord> {
        const snapshot = await this.repository.findSnapshot(snapshotId);
        if (!snapshot
            || snapshot.principalId !== principal.principalId
            || snapshot.companyId !== companyId
            || !principal.companyIds.includes(snapshot.companyId)) {
            throw new ExportError("NOT_FOUND");
        }
        return snapshot;
    }

    private assertNotExpired(snapshot: ExportSnapshotRecord): void {
        if (snapshot.expiresAt && snapshot.expiresAt.getTime() <= Date.now()) throw new ExportError("SNAPSHOT_EXPIRED");
    }

    /** Idempotent replay and race convergence share one rule set: hash first, then expiry. */
    private replay(snapshot: ExportSnapshotRecord, requestHash: string): ExportSnapshotView {
        if (snapshot.requestHash !== requestHash) throw new ExportError("IDEMPOTENCY_CONFLICT");
        this.assertNotExpired(snapshot);
        return toSnapshotView(snapshot);
    }

    private prepare(companyId: string, source: ExportSource): { counts: ExportCounts; candidates: ExportCandidateRecord[] } {
        const filesByDocument = new Map<string, ExportSource["files"]>();
        for (const file of source.files) {
            const list = filesByDocument.get(file.documentId);
            if (list) list.push(file);
            else filesByDocument.set(file.documentId, [file]);
        }
        const candidates = [...source.docs].sort(byDocumentId).map((doc, index): ExportCandidateRecord => {
            const files = filesByDocument.get(doc.documentId) ?? [];
            const result = classifyExportDocument({
                documentId: doc.documentId, documentKind: doc.documentKind, statusType: doc.statusType,
                permanentPurgeRequestedAt: doc.permanentPurgeRequestedAt, voidedAt: doc.voidedAt,
                detailPayloadIsNull: doc.detailPayloadIsNull, fileTypesPresent: files.map(file => file.fileType),
            });
            return {
                ordinal: index + 1,
                documentId: doc.documentId,
                classification: result.classification,
                reasons: result.reasons,
                statusType: result.statusType,
                documentKind: doc.documentKind,
                metadataRevision: buildExportMetadataRevision({
                    companyId, documentId: doc.documentId, documentKind: doc.documentKind,
                    statusType: doc.statusType, templateId: doc.templateId,
                }),
                artifacts: result.classification === "included" ? buildExportArtifacts(companyId, doc.documentId, files) : [],
            };
        });
        const counts = countExportClassifications(candidates.map(candidate => candidate.classification));
        assertExclusiveCounts(counts);
        return { counts, candidates };
    }
}

function toSnapshotView(snapshot: ExportSnapshotRecord): ExportSnapshotView {
    return {
        snapshotId: snapshot.id,
        status: snapshot.status,
        companyId: snapshot.companyId,
        scopeRevision: snapshot.scopeRevision,
        policyRevision: snapshot.policyRevision,
        createdAt: snapshot.createdAt.toISOString(),
        readyAt: snapshot.readyAt ? snapshot.readyAt.toISOString() : null,
        expiresAt: snapshot.expiresAt ? snapshot.expiresAt.toISOString() : null,
        // A building or failed snapshot has no counts; the view type requires them, so report zeros.
        counts: snapshot.counts ?? { ...ZERO_COUNTS },
        coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" },
        backupComplete: false,
    };
}

function toCandidateView(candidate: ExportCandidateRecord): ExportCandidateView {
    return {
        ordinal: candidate.ordinal,
        documentId: candidate.documentId,
        classification: candidate.classification,
        reasons: candidate.reasons,
        statusType: candidate.statusType,
        documentKind: candidate.documentKind,
        metadataRevision: candidate.metadataRevision,
        artifacts: candidate.artifacts.map(artifact => ({ ...artifact })),
    };
}

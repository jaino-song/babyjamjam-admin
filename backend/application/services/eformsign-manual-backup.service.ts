import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { configuredServiceRecordTemplateIds } from "application/utils/eformsign-document-kind";
import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";
import {
    ManualBackupControlError, parseManualControl, manualStaffContextSchema, manualRequestBodySchema,
    manualPageSchema, manualRunCursorSchema, manualDocumentCursorSchema, manualControlUuidSchema,
    manualClaimBodySchema, manualLeaseBodySchema, manualCandidatePageSchema, manualValidateBodySchema,
    manualArtifactBodySchema, manualWriteBodySchema, manualFinishBodySchema, manualRequestHash,
    toManualSelectedCandidate, manualFixedSelection, validateManualOutcome, manualReportWrapper,
    toManualStaffRun, toManualStaffDocument, type ManualBackupStaffContext,
} from "domain/eformsign-backup/manual-backup-control";
import { MANUAL_BACKUP_SCOPE_REVISION, MANUAL_BACKUP_LEASE_DURATION_MS, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { manualBackupKstRange, parseManualBackupScope } from "domain/eformsign-backup/manual-backup-scope";
import {
    ManualBackupRunError, canonicalBackupJson, type ManualBackupRunRecord,
    type ManualBackupDocumentRecord, type ManualBackupLeaseIdentity,
} from "domain/eformsign-backup/manual-backup-run";
import {
    buildManualAggregateResult, manualAggregateResultDigest, manualSelectionDigest, manualExecutionScopeSchema,
    validateManualDocumentResult, type ManualExecutionScope, type ManualSelection, type ManualDocumentResult,
} from "domain/eformsign-backup/worker/manual-protocol";
import { identifier } from "domain/eformsign-backup/worker/schema-fields";
import { WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { ExportError, EXPORT_POLICY_REVISION, countExportClassifications, type ExportPrincipal, type ExportSnapshotView } from "domain/eformsign-backup/export";
import type { ManualBackupClaimedSource } from "domain/repositories/eformsign-backup-run.repository.interface";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import type { ExportArtifactSource } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import { EformsignBackupExportService, type ExportArtifactLease } from "./eformsign-backup-export.service";

/** Library only. Callers must supply controller-derived staff context or the guard's verifiedExportPrincipal. */
@Injectable()
export class EformsignManualBackupService {
    constructor(
        private readonly repository: SbEformsignBackupRunRepository,
        private readonly exportService: EformsignBackupExportService,
        private readonly config: ConfigService,
    ) {}

    requestRun(context: ManualBackupStaffContext, body: unknown) {
        return this.perform(async () => {
            const ctx = parseManualControl(manualStaffContextSchema, context);
            const input = parseManualControl(manualRequestBodySchema, body);
            const companyId = this.company();
            const requestHash = manualRequestHash(companyId, ctx.branchId, ctx.userId, input.scope);
            const existing = await this.repository.findByRequestKey(companyId, ctx.branchId, input.requestKey);
            if (existing) {
                if (existing.requestHash !== requestHash) throw new ManualBackupControlError("IDEMPOTENCY_CONFLICT");
                return toManualStaffRun(existing);
            }
            const source = await this.repository.readSourceForRequest(ctx.branchId, manualBackupKstRange(input.scope));
            const selection = prepareManualBackupSelection({ companyId, branchId: ctx.branchId, scope: input.scope, source,
                serviceRecordTemplateIds: configuredServiceRecordTemplateIds(this.config) });
            if (selection.documents.length === 0) throw new ManualBackupControlError("EMPTY_SELECTION");
            // C1 wire constraints are narrower than persistence JSON constraints; validate before enqueue.
            for (const document of selection.documents) toManualSelectedCandidate(document);
            const result = await this.repository.enqueue({ companyId, branchId: ctx.branchId, requestedByUserId: ctx.userId,
                requestKey: input.requestKey, requestHash, scope: input.scope, ...selection });
            return toManualStaffRun(result.run);
        });
    }
    listRuns(context: ManualBackupStaffContext, query: unknown) {
        return this.perform(async () => {
            const ctx = parseManualControl(manualStaffContextSchema, context);
            const input = parseManualControl(manualPageSchema, query);
            const cursor = input.cursor ? this.decode(manualRunCursorSchema, input.cursor) : undefined;
            const companyId = this.company();
            await this.repository.expireStale(companyId);
            const page = await this.repository.listForBranch({ companyId, branchId: ctx.branchId, limit: input.limit,
                ...(cursor ? { cursor: { id: cursor.id, createdAt: new Date(cursor.createdAt) } } : {}) });
            const last = page.items[page.items.length - 1];
            return { items: page.items.map(toManualStaffRun), nextCursor: page.hasMore && last
                ? this.encode({ id: last.id, createdAt: last.createdAt.toISOString() }) : null };
        });
    }
    getRun(context: ManualBackupStaffContext, id: string) {
        return this.perform(async () => toManualStaffRun(await this.staffRun(context, id)));
    }
    listRunDocuments(context: ManualBackupStaffContext, id: string, query: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualPageSchema, query);
            const cursor = input.cursor ? this.decode(manualDocumentCursorSchema, input.cursor) : undefined;
            const runId = parseManualControl(manualControlUuidSchema, id);
            if (cursor && cursor.runId !== runId) throw new ManualBackupControlError("INVALID_REQUEST");
            const run = await this.staffRun(context, runId);
            const page = await this.repository.listDocumentsForBranch({ companyId: run.companyId, branchId: run.branchId,
                runId: run.id, afterOrdinal: cursor?.afterOrdinal ?? 0, limit: input.limit });
            const last = page.items[page.items.length - 1];
            return { items: page.items.map(toManualStaffDocument), nextCursor: page.hasMore && last
                ? this.encode({ runId: run.id, afterOrdinal: last.ordinal }) : null };
        });
    }
    claim(principal: ExportPrincipal, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualClaimBodySchema, body);
            const companyId = this.authorize(principal, input.companyId);
            const principalId = parseManualControl(identifier.max(64), principal.principalId);
            await this.repository.expireStale(companyId);
            const run = await this.repository.claimNext(companyId, principalId);
            if (!run) return null;
            if (!run.leaseToken || !run.leaseExpiresAt) throw new ManualBackupControlError("SERVICE_UNAVAILABLE");
            const identity = { companyId, principalId, runId: run.id, leaseToken: run.leaseToken };
            try {
                const { executionScope } = await this.fixed(identity, run, false);
                const snapshot: ExportSnapshotView = { snapshotId: manualBackupSnapshotId(executionScope), status: "ready", companyId,
                    scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
                    // The source cut precedes persistence of the queued run. C3
                    // requires snapshot creation <= readiness, even with a real DB clock.
                    createdAt: run.snapshotAt.toISOString(), readyAt: run.createdAt.toISOString(), expiresAt: null,
                    counts: { ...run.sourceCounts }, coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false };
                return { executionScope, snapshot, leaseToken: run.leaseToken, leaseExpiresAt: run.leaseExpiresAt.toISOString(),
                    leaseDurationMs: MANUAL_BACKUP_LEASE_DURATION_MS };
            } catch (error) {
                if (!(error instanceof ManualBackupControlError) || error.code !== "INVALID_REPORT") throw error;
                const result = { failureCode: "INVALID_SERVER_SELECTION", coverage: "unverified", backupComplete: false } as const;
                const accepted = await this.repository.finish(identity, { status: "failed", workerRunId: randomUUID(),
                    reportHash: createHash("sha256").update(canonicalBackupJson(result)).digest("hex"), result, failureCode: "INVALID_SERVER_SELECTION" });
                if (!accepted) throw new ManualBackupControlError("LEASE_LOST");
                throw new ManualBackupControlError("SERVICE_UNAVAILABLE");
            }
        });
    }
    renew(principal: ExportPrincipal, runId: string, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualLeaseBodySchema, body);
            const identity = this.identity(principal, runId, input);
            if (!await this.repository.heartbeat(identity)) throw new ManualBackupControlError("LEASE_LOST");
            const run = await this.claimed(identity);
            if (!run.leaseExpiresAt) throw new ManualBackupControlError("LEASE_LOST");
            return { leaseExpiresAt: run.leaseExpiresAt.toISOString(), leaseDurationMs: MANUAL_BACKUP_LEASE_DURATION_MS };
        });
    }
    listCandidates(principal: ExportPrincipal, runId: string, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualCandidatePageSchema, body);
            const identity = this.identity(principal, runId, input);
            await this.claimed(identity);
            const page = await this.repository.listClaimedDocuments(identity, input.afterOrdinal, input.limit);
            await this.claimed(identity);
            const last = page.items[page.items.length - 1];
            return { items: page.items.map(toManualSelectedCandidate), nextCursor: page.hasMore && last ? last.ordinal : null };
        });
    }
    validateSelectedDocument(principal: ExportPrincipal, runId: string, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualValidateBodySchema, body);
            const identity = this.identity(principal, runId, input);
            await this.claimed(identity);
            if (input.documentId !== undefined) {
                const source = await this.repository.readClaimedSource(identity, input.documentId);
                if (!source) throw new ManualBackupControlError("LEASE_LOST");
                this.validateSource(source);
            }
            return { valid: true as const };
        });
    }
    readArtifact(principal: ExportPrincipal, runId: string, body: unknown): Promise<ExportArtifactLease> {
        return this.perform(async () => {
            const input = parseManualControl(manualArtifactBodySchema, body);
            const identity = this.identity(principal, runId, input);
            await this.claimed(identity);
            const selected = await this.repository.findClaimedDocument(identity, input.documentId);
            if (!selected) throw new ManualBackupControlError("NOT_FOUND");
            const expected = selected.candidate.classification === "included"
                ? selected.candidate.artifacts.find(a => a.artifactIdentity === input.artifactIdentity) : undefined;
            if (!expected) throw new ManualBackupControlError("NOT_FOUND");
            let metadata: ManualBackupClaimedSource | undefined;
            return this.exportService.readFixedArtifact({ documentId: input.documentId, ...expected }, async withContent => {
                const current = await this.repository.readClaimedSource(identity, input.documentId,
                    withContent ? { fileType: expected.fileType, withContent: true } : undefined);
                if (!current) throw new ManualBackupControlError("LEASE_LOST");
                this.validateSource(current, withContent ? metadata?.files : undefined);
                if (canonicalBackupJson(toManualSelectedCandidate(current.selected)) !== canonicalBackupJson(toManualSelectedCandidate(selected))) {
                    throw new ExportError("VERSION_CHANGED");
                }
                if (!withContent) metadata = current;
                const file = current.files.find(f => f.fileType === expected.fileType);
                if (file && file.byteSize !== expected.byteSize) throw new ExportError("VERSION_CHANGED");
                const source: ExportArtifactSource = { doc: current.source, file: file ? {
                    sha256: file.sha256, byteSize: file.byteSize, contentType: current.download?.contentType || "application/pdf",
                    ...(withContent && current.download?.content ? { content: Buffer.from(current.download.content) } : {}),
                } : null };
                return source;
            });
        });
    }
    writeDocumentResults(principal: ExportPrincipal, runId: string, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualWriteBodySchema, body, "INVALID_REPORT");
            const outcomes = input.items.map(validateManualOutcome);
            const workerRunId = outcomes[0]?.payload.runId;
            if (!workerRunId || outcomes.some(o => o.payload.runId !== workerRunId)
                || new Set(outcomes.map(o => o.payload.documentId)).size !== outcomes.length) throw new ManualBackupControlError("INVALID_REPORT");
            const identity = this.identity(principal, runId, input);
            const run = await this.claimed(identity);
            const fixed = await this.fixed(identity, run, false);
            for (const outcome of outcomes) this.validateResult(fixed.selection, fixed.executionScope, outcome.payload, workerRunId);
            if (!await this.repository.writeDocumentResults(identity, outcomes.map(outcome => ({ documentId: outcome.payload.documentId, outcome })), workerRunId)) {
                throw new ManualBackupControlError("LEASE_LOST");
            }
            return { accepted: true as const };
        });
    }
    finish(principal: ExportPrincipal, runId: string, body: unknown) {
        return this.perform(async () => {
            const input = parseManualControl(manualFinishBodySchema, body, "INVALID_REPORT");
            if (manualAggregateResultDigest(input.payload) !== input.digest) throw new ManualBackupControlError("INVALID_REPORT");
            const identity = this.identity(principal, runId, input);
            const run = await this.repository.findForDelivery(identity);
            if (!run) throw new ManualBackupControlError("LEASE_LOST");
            const fixed = await this.fixed(identity, run, true);
            if (canonicalBackupJson(input.payload.scope) !== canonicalBackupJson(fixed.executionScope)
                || input.payload.documentResultCount !== fixed.documents.length || input.payload.counts.selected !== fixed.documents.length
                || (run.workerRunId !== null && run.workerRunId !== input.payload.runId)) throw new ManualBackupControlError("INVALID_REPORT");
            if (fixed.documents.some(d => d.outcome === null)) {
                throw new ManualBackupControlError(run.status === "running" ? "DOCUMENT_RESULTS_PENDING" : "INVALID_REPORT");
            }
            const results = fixed.documents.map(document => {
                const outcome = validateManualOutcome(document.outcome);
                this.validateResult(fixed.selection, fixed.executionScope, outcome.payload, input.payload.runId);
                if (outcome.payload.documentId !== document.documentId) throw new ManualBackupControlError("INVALID_REPORT");
                return outcome.payload;
            });
            const report = buildManualAggregateResult({ receiptId: input.payload.receiptId, runId: input.payload.runId,
                scope: fixed.executionScope, selection: fixed.selection, results, status: input.payload.status, reasons: input.payload.reasons });
            if (canonicalBackupJson(report) !== canonicalBackupJson(input.payload)) throw new ManualBackupControlError("INVALID_REPORT");
            const result = manualReportWrapper(report, results);
            if (!await this.repository.finish(identity, { status: report.status, workerRunId: report.runId, reportHash: input.digest, result })) {
                throw new ManualBackupControlError("LEASE_LOST");
            }
            return { accepted: true as const };
        });
    }

    private validateResult(selection: ManualSelection, scope: ManualExecutionScope, result: ManualDocumentResult, workerRunId: string): void {
        const candidate = selection.candidates.find(c => c.documentId === result.documentId);
        if (!candidate || result.runId !== workerRunId || canonicalBackupJson(result.scope) !== canonicalBackupJson(scope)) {
            throw new ManualBackupControlError("INVALID_REPORT");
        }
        validateManualDocumentResult(candidate, result);
    }
    private async fixed(identity: ManualBackupLeaseIdentity, run: ManualBackupRunRecord, delivery: boolean) {
        const documents: ManualBackupDocumentRecord[] = [];
        let after = 0;
        for (;;) {
            const page = delivery ? await this.repository.listDeliveryDocuments(identity, after, 100)
                : await this.repository.listClaimedDocuments(identity, after, 100);
            if (page.items.some((d, i) => d.ordinal !== after + i + 1)) throw new ManualBackupControlError("INVALID_REPORT");
            documents.push(...page.items);
            const last = page.items[page.items.length - 1];
            if (!page.hasMore) break;
            if (!last || last.ordinal <= after || documents.length > run.sourceCounts.total) throw new ManualBackupControlError("INVALID_REPORT");
            after = last.ordinal;
        }
        const current = delivery ? await this.repository.findForDelivery(identity) : await this.repository.findClaimed(identity);
        if (!current) throw new ManualBackupControlError("LEASE_LOST");
        if (!parseManualBackupScope(run.scope).ok || run.attempts < 1) throw new ManualBackupControlError("INVALID_REPORT");
        const selection = manualFixedSelection(run, documents);
        if (canonicalBackupJson(countExportClassifications(selection.candidates.map(c => c.classification))) !== canonicalBackupJson(run.sourceCounts)) {
            throw new ManualBackupControlError("INVALID_REPORT");
        }
        const executionScope = parseManualControl(manualExecutionScopeSchema, { kind: "manual", jobId: run.id,
            attemptId: `${run.id}.attempt-${run.attempts}`, companyId: run.companyId, branchId: run.branchId,
            selectionDigest: manualSelectionDigest(selection) }, "INVALID_REPORT");
        return { documents, selection, executionScope };
    }
    private validateSource(current: ManualBackupClaimedSource, files = current.files): void {
        if (!current.source || current.source.branchId !== current.run.branchId || current.source.permanentPurgeRequestedAt !== null) {
            throw new ExportError("SOURCE_REMOVED");
        }
        try {
            const selected = prepareManualBackupSelection({ companyId: current.run.companyId, branchId: current.run.branchId,
                scope: current.run.scope, source: { observedAt: current.run.snapshotAt, documents: [current.source], files },
                serviceRecordTemplateIds: configuredServiceRecordTemplateIds(this.config) }).documents[0];
            const fixed = current.selected;
            if (!selected || selected.kind !== fixed.kind || selected.currentMilestone !== fixed.currentMilestone
                || selected.documentCreatedAt.getTime() !== fixed.documentCreatedAt.getTime()
                || canonicalBackupJson(toManualSelectedCandidate({ candidate: { ...selected.candidate, ordinal: fixed.ordinal } }))
                    !== canonicalBackupJson(toManualSelectedCandidate(fixed))) throw new Error();
        } catch { throw new ExportError("VERSION_CHANGED"); }
    }
    private company(): string {
        return parseManualControl(identifier, this.config.get<string>("EFORMSIGN_COMPANY_ID")?.trim(), "SERVICE_UNAVAILABLE");
    }
    private authorize(principal: ExportPrincipal, companyId: string): string {
        const configured = this.company();
        if (companyId !== configured || !principal.companyIds.includes(configured)) throw new ManualBackupControlError("NOT_FOUND");
        return configured;
    }
    private identity(principal: ExportPrincipal, runId: string, body: { companyId: string; leaseToken: string }): ManualBackupLeaseIdentity {
        return { companyId: this.authorize(principal, body.companyId), principalId: parseManualControl(identifier.max(64), principal.principalId),
            runId: parseManualControl(manualControlUuidSchema, runId), leaseToken: body.leaseToken };
    }
    private async claimed(identity: ManualBackupLeaseIdentity): Promise<ManualBackupRunRecord> {
        const run = await this.repository.findClaimed(identity);
        if (!run) throw new ManualBackupControlError("LEASE_LOST");
        return run;
    }
    private async staffRun(context: ManualBackupStaffContext, id: string): Promise<ManualBackupRunRecord> {
        const ctx = parseManualControl(manualStaffContextSchema, context);
        const runId = parseManualControl(manualControlUuidSchema, id);
        const companyId = this.company();
        await this.repository.expireStale(companyId);
        const run = await this.repository.findForBranch(companyId, ctx.branchId, runId);
        if (!run) throw new ManualBackupControlError("NOT_FOUND");
        return run;
    }
    private encode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
    private decode<T>(schema: import("zod").z.ZodType<T>, cursor: string): T {
        try {
            if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
            const bytes = Buffer.from(cursor, "base64url");
            if (bytes.toString("base64url") !== cursor) throw new Error();
            return parseManualControl(schema, JSON.parse(bytes.toString("utf8")));
        } catch { throw new ManualBackupControlError("INVALID_REQUEST"); }
    }
    private async perform<T>(fn: () => Promise<T>): Promise<T> {
        try { return await fn(); } catch (error) {
            if (error instanceof ManualBackupControlError || error instanceof ExportError) throw error;
            if (error instanceof WorkerError) throw new ManualBackupControlError("INVALID_REPORT");
            if (error instanceof ManualBackupRunError) {
                const mapped = { IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT", RUN_ACTIVE: "RUN_ACTIVE", NOT_FOUND: "NOT_FOUND",
                    LEASE_LOST: "LEASE_LOST", SOURCE_SCOPE_CHANGED: "SOURCE_CHANGED", INVALID_INPUT: "INVALID_REQUEST" } as const;
                throw new ManualBackupControlError(mapped[error.code]);
            }
            throw new ManualBackupControlError("SERVICE_UNAVAILABLE");
        }
    }
}

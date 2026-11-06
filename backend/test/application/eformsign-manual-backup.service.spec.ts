import { createHash, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { EformsignManualBackupService } from "application/services/eformsign-manual-backup.service";
import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import type { ManualBackupSource, ManualBackupClaimedSource } from "domain/repositories/eformsign-backup-run.repository.interface";
import type { ManualBackupDocumentRecord, ManualBackupRunRecord } from "domain/eformsign-backup/manual-backup-run";
import { manualRequestHash, manualFixedSelection, toManualStaffRun } from "domain/eformsign-backup/manual-backup-control";
import { MANUAL_BACKUP_SCOPE_REVISION } from "domain/eformsign-backup/manual-backup-constants";
import { EXPORT_POLICY_REVISION, EXPORT_ARTIFACT_MAX_BYTES } from "domain/eformsign-backup/export";
import { buildManualAggregateResult, manualAggregateResultDigest, manualDocumentResultDigest, manualSelectionDigest,
    type ManualDocumentResult, type ManualExecutionScope } from "domain/eformsign-backup/worker/manual-protocol";

const JOB = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const WORKER = "55555555-5555-4555-8555-555555555555";
const COMPANY = "synthetic-company";
const FIXED = new Date("2026-11-01T00:00:00.000Z");
const BYTES = Buffer.from("synthetic-pdf");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const ctx = { branchId: BRANCH, userId: USER };
const principal = { credentialId: "credential", principalId: "verified-worker", companyIds: [COMPANY] };
const scope = { period: "all" as const, start: "", end: "", kind: "all" as const,
    contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"] as const,
    recordStages: ["created", "sent", "reviewed", "completed"] as const };
const leaseBody = { companyId: COMPANY, leaseToken: TOKEN };
function source(n = 1): ManualBackupSource {
    const documents = Array.from({ length: n }, (_, i) => ({ documentId: `doc-${String(i).padStart(4, "0")}`, branchId: BRANCH,
        documentKind: "contract", serviceRecordCaseId: null, templateId: "synthetic-template", createdDate: FIXED, updatedDate: FIXED,
        statusType: "003", stepType: "", stepIndex: "", voidedAt: null, permanentPurgeRequestedAt: null, detailPayloadIsNull: false }));
    return { observedAt: FIXED, documents, files: documents.flatMap(d => (["document", "audit_trail"] as const).map(fileType => ({
        documentId: d.documentId, fileType, sha256: HASH, byteSize: BYTES.length }))) };
}
function records(n = 1) {
    const live = source(n);
    const prepared = prepareManualBackupSelection({ companyId: COMPANY, branchId: BRANCH, scope, source: live, serviceRecordTemplateIds: new Set() });
    const run: ManualBackupRunRecord = { ...prepared, id: JOB, companyId: COMPANY, branchId: BRANCH, requestedByUserId: USER,
        requestKey: "key", requestHash: manualRequestHash(COMPANY, BRANCH, USER, scope), scope, status: "running", activeKey: `manual-backup:${BRANCH}`,
        attempts: 1, leaseToken: TOKEN, leaseOwnerPrincipalId: principal.principalId, leaseExpiresAt: new Date("2099-01-01"),
        heartbeatAt: FIXED, startedAt: FIXED, finishedAt: null, workerRunId: null, reportHash: null, result: null,
        failureCode: null, createdAt: FIXED, updatedAt: FIXED };
    const documents: ManualBackupDocumentRecord[] = prepared.documents.map(d => ({ ...d, runId: JOB, branchId: BRANCH, outcome: null }));
    return { run, documents, live };
}
function reportFor(run: ManualBackupRunRecord, documents: ManualBackupDocumentRecord[]) {
    const selection = manualFixedSelection(run, documents);
    const executionScope: ManualExecutionScope = { kind: "manual", jobId: JOB, attemptId: `${JOB}.attempt-1`, companyId: COMPANY,
        branchId: BRANCH, selectionDigest: manualSelectionDigest(selection) };
    const results: ManualDocumentResult[] = selection.candidates.map(c => ({ receiptId: randomUUID(), runId: WORKER, scope: executionScope,
        documentId: c.documentId, classification: c.classification, expectedArtifactIdentities: c.artifacts.map(a => a.artifactIdentity).sort(),
        observedAtSequence: 1, local: { destinationIdentity: "private-local", destinationRevision: "revision", state: "verified", manifestStatus: "verified",
            artifacts: c.artifacts.map(a => ({ artifactIdentity: a.artifactIdentity, state: "verified", reasonCode: null })), reasons: [] },
        drive: { destinationIdentity: null, destinationRevision: null, state: "not_required", manifestStatus: "not_required", artifacts: [], reasons: [] }, reasons: [] }));
    const payload = buildManualAggregateResult({ receiptId: randomUUID(), runId: WORKER, scope: executionScope, selection, results, status: "unverified", reasons: [] });
    return { selection, executionScope, results, payload, digest: manualAggregateResultDigest(payload) };
}

describe("manual backup application library", () => {
    const repo = { findByRequestKey: jest.fn(), readSourceForRequest: jest.fn(), enqueue: jest.fn(), findForBranch: jest.fn(),
        listForBranch: jest.fn(), listDocumentsForBranch: jest.fn(), expireStale: jest.fn(), claimNext: jest.fn(), heartbeat: jest.fn(),
        findClaimed: jest.fn(), findClaimedDocument: jest.fn(), listClaimedDocuments: jest.fn(), readClaimedSource: jest.fn(),
        findForDelivery: jest.fn(), listDeliveryDocuments: jest.fn(), writeDocumentResults: jest.fn(), finish: jest.fn() };
    const exportRepo = { findSnapshot: jest.fn(), findCandidateArtifact: jest.fn(), readArtifactForDownload: jest.fn() };
    let service: EformsignManualBackupService; let exports: EformsignBackupExportService;
    let run: ManualBackupRunRecord; let documents: ManualBackupDocumentRecord[]; let live: ManualBackupSource;
    let config: ConfigService;
    const item = () => { const d = documents[0]; if (!d) throw new Error("fixture"); return d; };
    function current(): ManualBackupClaimedSource {
        return { run, selected: item(), source: { ...live.documents[0]!, syncStatus: "synced" }, files: live.files,
            download: { sha256: HASH, byteSize: BYTES.length, contentType: "application/pdf", content: BYTES } };
    }
    beforeEach(() => {
        jest.resetAllMocks(); ({ run, documents, live } = records());
        config = new ConfigService({ EFORMSIGN_COMPANY_ID: COMPANY });
        exports = new EformsignBackupExportService(exportRepo as unknown as SbEformsignBackupExportRepository, config);
        service = new EformsignManualBackupService(repo as unknown as SbEformsignBackupRunRepository, exports, config);
        repo.findByRequestKey.mockResolvedValue(null); repo.readSourceForRequest.mockImplementation(async () => live);
        repo.enqueue.mockImplementation(async () => ({ run, replayed: false }));
        repo.findForBranch.mockImplementation(async () => run); repo.findClaimed.mockImplementation(async () => run);
        repo.findForDelivery.mockImplementation(async () => run); repo.findClaimedDocument.mockImplementation(async () => item());
        repo.claimNext.mockImplementation(async () => run); repo.heartbeat.mockResolvedValue(true);
        const page = async (_identity: unknown, after: number, limit: number) => ({ items: documents.slice(after, after + limit), hasMore: after + limit < documents.length });
        repo.listClaimedDocuments.mockImplementation(page); repo.listDeliveryDocuments.mockImplementation(page);
        repo.readClaimedSource.mockImplementation(async () => current());
        repo.writeDocumentResults.mockImplementation(async (_identity, results, workerRunId) => {
            if (run.workerRunId && run.workerRunId !== workerRunId) return false;
            run = { ...run, workerRunId };
            documents = documents.map(d => ({ ...d, outcome: results.find((r: { documentId: string }) => r.documentId === d.documentId)?.outcome ?? d.outcome }));
            return true;
        });
        repo.finish.mockImplementation(async (_identity, input) => { run = { ...run, ...input, finishedAt: FIXED }; return true; });
    });
    it("binds staff company/branch/actor and only returns allowlisted fields", async () => {
        const dto = await service.requestRun(ctx, { scope, requestKey: "key" });
        expect(repo.enqueue.mock.calls[0]?.[0]).toMatchObject({ companyId: COMPANY, branchId: BRANCH, requestedByUserId: USER,
            requestHash: run.requestHash, sourceCounts: { total: 1, included: 1 } });
        expect(Object.keys(dto).sort()).toEqual(["backupComplete", "coverage", "createdAt", "cut", "failureCode", "finishedAt", "id", "scope", "startedAt", "status", "summary"]);
        for (const secret of [TOKEN, "lease", "private", "candidate", "requestedBy", "requestHash"]) expect(JSON.stringify(dto)).not.toContain(secret);
    });
    it("replays before source capture and empty errors; different actor or scope conflicts", async () => {
        repo.findByRequestKey.mockResolvedValue(run); live = source(0);
        await expect(service.requestRun(ctx, { scope, requestKey: "key" })).resolves.toMatchObject({ id: JOB });
        expect(repo.readSourceForRequest).not.toHaveBeenCalled();
        await expect(service.requestRun({ ...ctx, userId: TOKEN }, { scope, requestKey: "key" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await expect(service.requestRun(ctx, { scope: { ...scope, kind: "record" }, requestKey: "key" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        expect(repo.enqueue).not.toHaveBeenCalled();
    });
    it("rejects empty selection and invalid C1 candidate before enqueue", async () => {
        live = source(0);
        await expect(service.requestRun(ctx, { scope, requestKey: "key" })).rejects.toMatchObject({ code: "EMPTY_SELECTION" });
        live = source(); live = { ...live, documents: live.documents.map(d => ({ ...d, documentId: "x".repeat(513) })) };
        await expect(service.requestRun(ctx, { scope, requestKey: "key" })).rejects.toMatchObject({ code: "INVALID_REPORT" });
        expect(repo.enqueue).not.toHaveBeenCalled();
    });
    it.each(["companyId", "branchId", "requestedByUserId", "principalId", "arbitraryPath"])("rejects staff supplied %s without source access", async key => {
        await expect(service.requestRun(ctx, { scope, requestKey: "key", [key]: "private@example.test" })).rejects.toMatchObject({ code: "INVALID_REQUEST", message: "INVALID_REQUEST" });
        expect(repo.readSourceForRequest).not.toHaveBeenCalled();
    });
    it("maps repository faults to safe codes", async () => {
        repo.readSourceForRequest.mockRejectedValue(new Error("private-name /secret/path"));
        await expect(service.requestRun(ctx, { scope, requestKey: "key" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "SERVICE_UNAVAILABLE" });
    });
    it("loads more than 500 fixed candidates and returns a fixed manual snapshot without documents", async () => {
        ({ run, documents, live } = records(507));
        const claim = await service.claim(principal, { companyId: COMPANY });
        expect(repo.listClaimedDocuments.mock.calls.map(c => c[1])).toEqual([0, 100, 200, 300, 400, 500]);
        expect(claim).toMatchObject({ executionScope: { jobId: JOB, attemptId: `${JOB}.attempt-1`, companyId: COMPANY, branchId: BRANCH },
            snapshot: { snapshotId: `manual-${JOB}-attempt-1`, status: "ready", scopeRevision: MANUAL_BACKUP_SCOPE_REVISION,
                policyRevision: EXPORT_POLICY_REVISION, readyAt: "2026-11-01T00:00:00.000Z", expiresAt: null, counts: { total: 507 }, backupComplete: false },
            leaseToken: TOKEN, leaseDurationMs: 180000 });
        expect(claim).not.toHaveProperty("documents");
        expect(repo.claimNext).toHaveBeenCalledWith(COMPANY, "verified-worker");
    });
    it("claim expires stale first and returns null when the company queue is empty", async () => {
        repo.claimNext.mockResolvedValue(null);
        await expect(service.claim(principal, { companyId: COMPANY })).resolves.toBeNull();
        expect(repo.expireStale.mock.invocationCallOrder[0]).toBeLessThan(repo.claimNext.mock.invocationCallOrder[0]!);
    });
    it.each(["ordinal", "count", "digest"])("finishes malformed server selection (%s) safely without invented outcomes", async defect => {
        if (defect === "ordinal") documents = documents.map(d => ({ ...d, ordinal: 2 }));
        if (defect === "count") run = { ...run, sourceCounts: { ...run.sourceCounts, total: 2 } };
        if (defect === "digest") documents = documents.map(d => ({ ...d, candidate: { ...d.candidate, metadataRevision: "bad" } }));
        await expect(service.claim(principal, { companyId: COMPANY })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        expect(repo.finish).toHaveBeenCalledWith(expect.objectContaining({ principalId: "verified-worker" }), expect.objectContaining({
            status: "failed", failureCode: "INVALID_SERVER_SELECTION", result: { failureCode: "INVALID_SERVER_SELECTION", coverage: "unverified", backupComplete: false } }));
        expect(repo.writeDocumentResults).not.toHaveBeenCalled(); expect(repo.readClaimedSource).not.toHaveBeenCalled();
    });
    it("requires configured company, credential company and no body principal", async () => {
        await expect(service.claim(principal, { companyId: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(service.claim({ ...principal, companyIds: [] }, { companyId: COMPANY })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(service.claim(principal, { companyId: COMPANY, principalId: "attacker" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(repo.expireStale).not.toHaveBeenCalled();
        config.set("EFORMSIGN_COMPANY_ID", "");
        await expect(service.claim(principal, { companyId: COMPANY })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });
    it("renews only explicitly and reports the actual repository deadline", async () => {
        await expect(service.renew(principal, JOB, leaseBody)).resolves.toEqual({ leaseExpiresAt: "2099-01-01T00:00:00.000Z", leaseDurationMs: 180000 });
        await service.validateSelectedDocument(principal, JOB, leaseBody);
        expect(repo.heartbeat).toHaveBeenCalledTimes(1); expect(repo.readClaimedSource).not.toHaveBeenCalled();
        repo.heartbeat.mockResolvedValue(false);
        await expect(service.renew(principal, JOB, leaseBody)).rejects.toMatchObject({ code: "LEASE_LOST" });
    });
    it("bounds candidates, exposes only fixed fields and refuses a lost lease", async () => {
        const page = await service.listCandidates(principal, JOB, { ...leaseBody, limit: 1 });
        expect(page.items[0]).toMatchObject({ documentId: "doc-0000", artifacts: [{ artifactType: "document", byteLength: BYTES.length }, { artifactType: "audit-trail", byteLength: BYTES.length }] });
        expect(page.items[0]).not.toHaveProperty("outcome");
        await expect(service.listCandidates(principal, JOB, { ...leaseBody, limit: 101 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        repo.findClaimed.mockResolvedValue(null);
        await expect(service.listCandidates(principal, JOB, leaseBody)).rejects.toMatchObject({ code: "LEASE_LOST" });
    });
    it.each(["voided", "kind", "case", "date", "hash", "status", "template", "move", "purge", "gone"])("rejects live source change %s including staged reuse validation", async change => {
        const base = current();
        const changed = { ...base, source: base.source ? { ...base.source } : null, files: [...base.files] };
        if (changed.source) {
            if (change === "voided") changed.source = { ...changed.source, voidedAt: FIXED };
            if (change === "kind") changed.source = { ...changed.source, documentKind: "record" };
            if (change === "case") changed.source = { ...changed.source, serviceRecordCaseId: USER };
            if (change === "date") changed.source = { ...changed.source, createdDate: new Date("2025-01-01") };
            if (change === "status") changed.source = { ...changed.source, statusType: "030" };
            if (change === "template") changed.source = { ...changed.source, templateId: "changed" };
            if (change === "move") changed.source = { ...changed.source, branchId: USER };
            if (change === "purge") changed.source = { ...changed.source, permanentPurgeRequestedAt: FIXED };
        }
        if (change === "gone") changed.source = null;
        if (change === "hash") changed.files = changed.files.map(f => ({ ...f, sha256: "b".repeat(64) }));
        repo.readClaimedSource.mockResolvedValue(changed);
        await expect(service.validateSelectedDocument(principal, JOB, { ...leaseBody, documentId: "doc-0000" })).rejects.toMatchObject({
            code: ["move", "purge", "gone"].includes(change) ? "SOURCE_REMOVED" : "VERSION_CHANGED" });
        expect(repo.heartbeat).not.toHaveBeenCalled();
    });
    it("shares two slots with the legacy company artifact reader, before manual live metadata access", async () => {
        exportRepo.findSnapshot.mockResolvedValue({ id: JOB, principalId: principal.principalId, companyId: COMPANY, expiresAt: null });
        exportRepo.findCandidateArtifact.mockResolvedValue({ documentId: "doc-0000", ...item().candidate.artifacts[0] });
        exportRepo.readArtifactForDownload.mockResolvedValue({ doc: { permanentPurgeRequestedAt: null, statusType: "003", syncStatus: "synced" },
            file: { sha256: HASH, byteSize: BYTES.length, contentType: "application/pdf", content: BYTES } });
        const artifactIdentity = item().candidate.artifacts[0]!.artifactIdentity;
        const legacy = await exports.readArtifact(principal, JOB, artifactIdentity);
        const manual = await service.readArtifact(principal, JOB, { ...leaseBody, documentId: "doc-0000", artifactIdentity });
        expect(repo.readClaimedSource.mock.calls.map(c => c[2])).toEqual([undefined, { fileType: "document", withContent: true }]);
        expect(manual.bytes).toEqual(BYTES); expect(manual.byteSize).toBe(13);
        const before = repo.readClaimedSource.mock.calls.length;
        await expect(service.readArtifact(principal, JOB, { ...leaseBody, documentId: "doc-0000", artifactIdentity })).rejects.toMatchObject({ code: "RATE_LIMITED" });
        expect(repo.readClaimedSource).toHaveBeenCalledTimes(before);
        manual.release(); manual.release();
        const again = await service.readArtifact(principal, JOB, { ...leaseBody, documentId: "doc-0000", artifactIdentity });
        await expect(exports.readArtifact(principal, JOB, artifactIdentity)).rejects.toMatchObject({ code: "RATE_LIMITED" });
        legacy.release(); again.release();
    });
    it("releases slots on metadata, bytes and source guard errors", async () => {
        const artifactIdentity = item().candidate.artifacts[0]!.artifactIdentity;
        const body = { ...leaseBody, documentId: "doc-0000", artifactIdentity };
        repo.readClaimedSource.mockRejectedValueOnce(new Error("private"));
        await expect(service.readArtifact(principal, JOB, body)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        repo.readClaimedSource.mockImplementationOnce(async () => current()).mockResolvedValueOnce({ ...current(), download: { ...current().download!, content: Buffer.from("wrong") } });
        await expect(service.readArtifact(principal, JOB, body)).rejects.toMatchObject({ code: "CONSISTENCY_CONFLICT" });
        const one = await service.readArtifact(principal, JOB, body); const two = await service.readArtifact(principal, JOB, body);
        one.release(); two.release();
    });
    it("guards both byte-phase document facts and lease loss and never reads bytes for oversized metadata", async () => {
        const artifactIdentity = item().candidate.artifacts[0]!.artifactIdentity;
        const body = { ...leaseBody, documentId: "doc-0000", artifactIdentity };
        repo.readClaimedSource.mockImplementationOnce(async () => current()).mockResolvedValueOnce({ ...current(), source: { ...current().source!, voidedAt: FIXED } });
        await expect(service.readArtifact(principal, JOB, body)).rejects.toMatchObject({ code: "VERSION_CHANGED" });
        repo.readClaimedSource.mockResolvedValueOnce(null);
        await expect(service.readArtifact(principal, JOB, body)).rejects.toMatchObject({ code: "LEASE_LOST" });
        const huge = EXPORT_ARTIFACT_MAX_BYTES + 1;
        documents = documents.map(d => ({ ...d, candidate: { ...d.candidate, artifacts: d.candidate.artifacts.map(a => ({ ...a, byteSize: huge })) } }));
        live = { ...live, files: live.files.map(f => ({ ...f, byteSize: huge })) };
        repo.readClaimedSource.mockClear();
        await expect(service.readArtifact(principal, JOB, body)).rejects.toMatchObject({ code: "ARTIFACT_TOO_LARGE" });
        expect(repo.readClaimedSource).toHaveBeenCalledTimes(1);
    });
    it("finish-first returns pending, accepts all batches then derives a safe server summary and replay ACK", async () => {
        const report = reportFor(run, documents);
        const body = { ...leaseBody, payload: report.payload, digest: report.digest };
        await expect(service.finish(principal, JOB, body)).rejects.toMatchObject({ code: "DOCUMENT_RESULTS_PENDING" });
        expect(repo.finish).not.toHaveBeenCalled();
        await service.writeDocumentResults(principal, JOB, { ...leaseBody, items: report.results.map(payload => ({ payload, digest: manualDocumentResultDigest(payload) })) });
        expect(repo.writeDocumentResults.mock.calls[0]?.[2]).toBe(WORKER);
        await expect(service.finish(principal, JOB, body)).resolves.toEqual({ accepted: true });
        expect(repo.finish.mock.calls[0]?.[1]).toMatchObject({ workerRunId: WORKER, reportHash: report.digest, result: { report: report.payload,
            summary: { target: 1, saved: 1, attention: 0, metadataOnly: 0, local: { state: "stored", saved: 1 }, drive: { state: "excluded", saved: 0 } } } });
        run = { ...run, leaseExpiresAt: new Date("2000-01-01") };
        await expect(service.finish(principal, JOB, body)).resolves.toEqual({ accepted: true });
        const staff = toManualStaffRun(run);
        expect(staff.summary.saved).toBe(1); expect(staff.backupComplete).toBe(false);
        for (const value of [TOKEN, "private-local", "destinationIdentity", "report", "receiptId"]) expect(JSON.stringify(staff)).not.toContain(value);
    });
    it.each(["digest", "scope", "unknown", "classification", "worker", "duplicate"])("rejects malformed document batch %s with zero repository writes", async change => {
        const r = reportFor(run, documents).results[0]!;
        let payload = r;
        if (change === "scope") payload = { ...r, scope: { ...r.scope, branchId: USER } };
        if (change === "unknown") payload = { ...r, documentId: "unknown" };
        if (change === "classification") payload = { ...r, classification: "unknown_template" };
        const entries = [{ payload, digest: change === "digest" ? "0".repeat(64) : manualDocumentResultDigest(payload) }];
        if (change === "duplicate") entries.push(entries[0]!);
        if (change === "worker") { const other = { ...r, runId: TOKEN }; entries.push({ payload: other, digest: manualDocumentResultDigest(other) }); }
        await expect(service.writeDocumentResults(principal, JOB, { ...leaseBody, items: entries })).rejects.toMatchObject({ code: "INVALID_REPORT" });
        expect(repo.writeDocumentResults).not.toHaveBeenCalled();
    });
    it("rejects tampered aggregate counts and mixed stored worker IDs", async () => {
        const r = reportFor(run, documents);
        documents = documents.map((d, i) => ({ ...d, outcome: { payload: r.results[i]!, digest: manualDocumentResultDigest(r.results[i]) } }));
        const tampered = { ...r.payload, counts: { ...r.payload.counts, localVerified: 999 } };
        await expect(service.finish(principal, JOB, { ...leaseBody, payload: tampered, digest: manualAggregateResultDigest(tampered) })).rejects.toMatchObject({ code: "INVALID_REPORT" });
        run = { ...run, workerRunId: TOKEN };
        await expect(service.finish(principal, JOB, { ...leaseBody, payload: r.payload, digest: r.digest })).rejects.toMatchObject({ code: "INVALID_REPORT" });
        expect(repo.finish).not.toHaveBeenCalled();
    });
    it("lost, foreign and stale delivery leases write nothing", async () => {
        const r = reportFor(run, documents);
        repo.findForDelivery.mockResolvedValue(null);
        await expect(service.finish(principal, JOB, { ...leaseBody, payload: r.payload, digest: r.digest })).rejects.toMatchObject({ code: "LEASE_LOST" });
        await expect(service.finish({ ...principal, companyIds: [] }, JOB, { ...leaseBody, payload: r.payload, digest: r.digest })).rejects.toMatchObject({ code: "NOT_FOUND" });
        repo.writeDocumentResults.mockResolvedValue(false);
        await expect(service.writeDocumentResults(principal, JOB, { ...leaseBody, items: r.results.map(payload => ({ payload, digest: manualDocumentResultDigest(payload) })) })).rejects.toMatchObject({ code: "LEASE_LOST" });
        expect(repo.finish).not.toHaveBeenCalled();
    });
    it("staff run/doc pagination binds cursors, ownership and bounded limits", async () => {
        repo.listForBranch.mockResolvedValue({ items: [run], hasMore: true });
        const page = await service.listRuns(ctx, { limit: "1" });
        expect(page.nextCursor).toBeTruthy();
        await service.listRuns(ctx, { limit: 1, cursor: page.nextCursor });
        expect(repo.listForBranch.mock.calls[1]?.[0]).toEqual({ companyId: COMPANY, branchId: BRANCH, limit: 1, cursor: { id: JOB, createdAt: FIXED } });
        repo.listDocumentsForBranch.mockResolvedValue({ items: documents, hasMore: true });
        const docs = await service.listRunDocuments(ctx, JOB, { limit: 1 });
        expect(docs.items[0]).toEqual({ documentId: "doc-0000", ordinal: 1, kind: "contract", currentMilestone: "completed",
            documentCreatedAt: "2026-11-01T00:00:00.000Z", classification: "included", local: "unverified", drive: "unverified" });
        const foreignCursor = Buffer.from(JSON.stringify({ runId: USER, afterOrdinal: 1 })).toString("base64url");
        await expect(service.listRunDocuments(ctx, JOB, { cursor: foreignCursor })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(service.listRuns(ctx, { limit: " 1" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(service.listRuns(ctx, { cursor: "%%%" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        repo.findForBranch.mockResolvedValue(null);
        await expect(service.getRun(ctx, JOB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
});

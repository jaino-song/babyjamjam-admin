import { assertNativeDocumentObservations } from "../qa/eformsign-backup-fixture-app";
import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";
import { manualFixedSelection, manualRequestHash } from "domain/eformsign-backup/manual-backup-control";
import type { ManualBackupDocumentRecord, ManualBackupRunRecord } from "domain/eformsign-backup/manual-backup-run";
import { prepareManualRun } from "infrastructure/eformsign-backup/worker/manual-run-scope";
import { ConfigService } from "@nestjs/config";
import { EformsignManualBackupService } from "application/services/eformsign-manual-backup.service";
import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";

const context = { branchId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000010" };
const id = "20000000-0000-4000-8000-000000000001";
describe("staff stale lease reads", () => {
    const calls: string[] = [];
    const repository = {
        expireStale: jest.fn(async () => { calls.push("expire"); }),
        listForBranch: jest.fn(async () => { calls.push("list"); return { items: [], hasMore: false }; }),
        findForBranch: jest.fn(async () => { calls.push("get"); return null; }),
    };
    let service: EformsignManualBackupService;
    beforeEach(() => {
        calls.length = 0; jest.clearAllMocks();
        service = new EformsignManualBackupService(repository as unknown as SbEformsignBackupRunRepository,
            {} as EformsignBackupExportService, new ConfigService({ EFORMSIGN_COMPANY_ID: "company" }));
    });
    it("expires by repository DB clock before the branch list", async () => {
        await service.listRuns(context, {});
        expect(calls).toEqual(["expire", "list"]);
        expect(repository.expireStale).toHaveBeenCalledWith("company");
    });
    it("expires before the branch get even when the run is absent", async () => {
        await expect(service.getRun(context, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(calls).toEqual(["expire", "get"]);
    });
    it.each([
        () => ({ action: (s: EformsignManualBackupService) => s.listRuns({ ...context, branchId: "bad" }, {}) }),
        () => ({ action: (s: EformsignManualBackupService) => s.listRuns(context, { limit: 101 }) }),
        () => ({ action: (s: EformsignManualBackupService) => s.listRuns(context, { cursor: "bad" }) }),
        () => ({ action: (s: EformsignManualBackupService) => s.getRun(context, "bad") }),
        () => ({ action: (s: EformsignManualBackupService) => s.listRunDocuments(context, id, { cursor: "bad" }) }),
    ])("does not mutate for invalid input", async make => {
        await expect(make().action(service)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(calls).toEqual([]);
    });
    it("does not mutate for invalid company configuration", async () => {
        service = new EformsignManualBackupService(repository as unknown as SbEformsignBackupRunRepository,
            {} as EformsignBackupExportService, { get: () => undefined } as unknown as ConfigService);
        await expect(service.listRuns(context, {})).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        expect(calls).toEqual([]);
    });
});

it("accepts a real source cut observed before the queued row is created in C3", async () => {
    const cut = new Date("2026-11-04T01:00:00.000Z");
    const queuedAt = new Date("2026-11-04T01:00:00.025Z");
    const scope = { period: "all" as const, start: "", end: "", kind: "contract" as const, contractStages: ["created"] as const, recordStages: [] };
    const prepared = prepareManualBackupSelection({ companyId: "company", branchId: context.branchId, scope,
        source: { observedAt: cut, files: [], documents: [{ documentId: "synthetic-document", branchId: context.branchId, documentKind: "contract",
            templateId: "synthetic-template", serviceRecordCaseId: null, createdDate: cut, updatedDate: cut, statusType: "001", stepType: "", stepIndex: "",
            voidedAt: null, permanentPurgeRequestedAt: null, detailPayloadIsNull: false }] }, serviceRecordTemplateIds: new Set() });
    const run: ManualBackupRunRecord = { ...prepared, id, companyId: "company", branchId: context.branchId, requestedByUserId: context.userId,
        requestKey: "synthetic-intent", requestHash: manualRequestHash("company", context.branchId, context.userId, scope), scope,
        status: "running", activeKey: `manual-backup:${context.branchId}`, attempts: 1, leaseToken: "20000000-0000-4000-8000-000000000002",
        leaseOwnerPrincipalId: "synthetic-worker", leaseExpiresAt: new Date("2026-11-04T01:05:00.000Z"), heartbeatAt: queuedAt, startedAt: queuedAt,
        finishedAt: null, workerRunId: null, reportHash: null, result: null, failureCode: null, createdAt: queuedAt, updatedAt: queuedAt };
    const documents: ManualBackupDocumentRecord[] = prepared.documents.map(d => ({ ...d, runId: id, branchId: context.branchId, outcome: null }));
    const repository = { expireStale: jest.fn(), claimNext: async () => run, findClaimed: async () => run,
        listClaimedDocuments: async () => ({ items: documents, hasMore: false }) };
    const service = new EformsignManualBackupService(repository as unknown as SbEformsignBackupRunRepository,
        {} as EformsignBackupExportService, new ConfigService({ EFORMSIGN_COMPANY_ID: "company" }));
    const claim = await service.claim({ credentialId: "synthetic", principalId: "synthetic-worker", companyIds: ["company"] }, { companyId: "company" });
    expect(claim).not.toBeNull();
    const manual = prepareManualRun({ executionScope: claim!.executionScope, snapshot: claim!.snapshot, selection: manualFixedSelection(run, documents),
        exportPort: { openArtifact: jest.fn() }, fence: { signal: new AbortController().signal, assertActive: jest.fn() } }, "company");
    expect(manual).not.toBeNull();
    const results = manual!.results({ runId: "20000000-0000-4000-8000-000000000003", uuid: () => "20000000-0000-4000-8000-000000000004",
        observedAtSequence: 1, localIdentity: "synthetic-local", localRevision: "synthetic-revision", driveIdentity: null, driveRevision: null,
        driveConfigured: false, localFailure: null, driveFailure: null, stopped: null });
    expect(results.map(r => [r.local.state, r.drive.state])).toEqual([["metadata_only", "not_required"]]);
    expect(() => assertNativeDocumentObservations("pagination", results.map(r => ({ local: r.local.state, drive: r.drive.state })))).not.toThrow();
    expect(() => assertNativeDocumentObservations("pagination", [{ local: "metadata_only", drive: "unverified" }])).toThrow("PRODUCT_OBSERVATION_ORACLE");
    expect(claim!.snapshot.createdAt).toBe(cut.toISOString());
    expect(claim!.snapshot.readyAt).toBe(queuedAt.toISOString());
});

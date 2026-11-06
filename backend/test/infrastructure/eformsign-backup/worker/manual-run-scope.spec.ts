import { EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { manualSelectionDigest, type ManualSelection } from "domain/eformsign-backup/worker/manual-protocol";
import { boundedManualReasons, legacyManualReasons, prepareManualRun } from "infrastructure/eformsign-backup/worker/manual-run-scope";
import type { ManualRunOptions } from "infrastructure/eformsign-backup/worker/runner-types";

const jobId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
function input(): ManualRunOptions {
    const sha256 = "a".repeat(64);
    const selection: ManualSelection = { jobId, companyId: "C001", branchId, scopeRevision: MANUAL_BACKUP_SCOPE_REVISION,
        policyRevision: EXPORT_POLICY_REVISION, candidates: [{ ordinal: 1, documentId: "A", classification: "included", reasons: [],
            statusType: "003", documentKind: "contract", metadataRevision: "b".repeat(64), artifacts: [
                { artifactType: "document", sha256, byteLength: 100, artifactIdentity: artifactIdentity({ companyId: "C001", documentId: "A",
                    artifactKind: "document", contentSha256: sha256, byteLength: 100 }) },
            ] }] };
    const executionScope = { kind: "manual" as const, jobId, attemptId: `${jobId}.attempt-1`, companyId: "C001", branchId,
        selectionDigest: manualSelectionDigest(selection) };
    return { executionScope, selection, snapshot: { snapshotId: manualBackupSnapshotId(executionScope), status: "ready", companyId: "C001",
        scopeRevision: selection.scopeRevision, policyRevision: selection.policyRevision, createdAt: "2026-11-06T00:00:00.000Z",
        readyAt: "2026-11-06T00:00:00.000Z", expiresAt: null, counts: { total: 1, included: 1, inaccessible: 0,
            unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0 }, coverage: { status: "unverified", reasonCode: "coverage-unverified" }, backupComplete: false },
    exportPort: { createSnapshot: jest.fn(), getSnapshot: jest.fn(), listCandidates: jest.fn(), openArtifact: jest.fn() },
    fence: { signal: new AbortController().signal, assertActive: jest.fn() } };
}
function redigest(options: ManualRunOptions): void { options.executionScope.selectionDigest = manualSelectionDigest(options.selection); }

describe("manual preflight", () => {
    it("copies all public facts while retaining class capabilities and receivers without invoking them", async () => {
        const options = input();
        class Fence {
            signal = new AbortController().signal;
            calls: Array<string | undefined> = [];
            async assertActive(id?: string): Promise<void> { this.calls.push(id); }
        }
        const fence = new Fence();
        options.fence = fence;
        const scope = prepareManualRun(options, "C001")!;
        options.selection.candidates[0]!.documentId = "changed";
        options.snapshot.counts.included = 900;
        options.snapshot.coverage.status = "verified";
        options.executionScope.branchId = jobId;
        expect(scope.options.selection.candidates[0]!.documentId).toBe("A");
        expect(scope.options.snapshot.counts.included).toBe(1);
        expect(scope.options.snapshot.coverage.status).toBe("unverified");
        expect(scope.options.executionScope.branchId).toBe(branchId);
        expect(scope.options.exportPort).toBe(options.exportPort);
        expect(scope.options.fence).toBe(fence);
        expect(fence.calls).toEqual([]);
        await scope.effect("A").assertActive();
        expect(fence.calls).toEqual(["A"]);
        expect(options.exportPort.createSnapshot).not.toHaveBeenCalled();
        expect(options.exportPort.getSnapshot).not.toHaveBeenCalled();
        expect(options.exportPort.listCandidates).not.toHaveBeenCalled();
    });
    it.each(["executionScope", "selection", "snapshot", "exportPort", "fence"])("fails closed for incomplete %s options", key => {
        expect(() => prepareManualRun({ [key]: undefined }, "C001")).toThrow("export-response-invalid");
    });
    it.each([
        ["scheduledFor", (o: ManualRunOptions) => Object.assign(o, { scheduledFor: undefined })],
        ["scope company", (o: ManualRunOptions) => { o.executionScope.companyId = "C002"; }],
        ["branch", (o: ManualRunOptions) => { o.selection.branchId = jobId; redigest(o); }],
        ["digest", (o: ManualRunOptions) => { o.executionScope.selectionDigest = "0".repeat(64); }],
        ["revision", (o: ManualRunOptions) => { o.selection.scopeRevision = "ordinary"; redigest(o); }],
        ["policy", (o: ManualRunOptions) => { o.selection.policyRevision = "changed"; redigest(o); }],
        ["snapshot id", (o: ManualRunOptions) => { o.snapshot.snapshotId = "unrelated"; }],
        ["snapshot state", (o: ManualRunOptions) => { o.snapshot.status = "building"; }],
        ["snapshot revision", (o: ManualRunOptions) => { o.snapshot.scopeRevision = "ordinary"; }],
        ["snapshot company", (o: ManualRunOptions) => { o.snapshot.companyId = "C002"; }],
        ["counts", (o: ManualRunOptions) => { o.snapshot.counts.included = 2; }],
        ["coverage", (o: ManualRunOptions) => { o.snapshot.coverage.status = "verified"; }],
        ["backupComplete", (o: ManualRunOptions) => { o.snapshot.backupComplete = true; }],
        ["expiry", (o: ManualRunOptions) => { o.snapshot.expiresAt = o.snapshot.createdAt; }],
        ["date", (o: ManualRunOptions) => { o.snapshot.createdAt = "2026-02-30T00:00:00Z"; }],
        ["offset", (o: ManualRunOptions) => { o.snapshot.readyAt = "2026-11-06T09:00:00+09:00"; }],
        ["ordinal", (o: ManualRunOptions) => { o.selection.candidates[0]!.ordinal = 2; redigest(o); }],
        ["hash", (o: ManualRunOptions) => { o.selection.candidates[0]!.artifacts[0]!.sha256 = "c".repeat(64); redigest(o); }],
        ["oversize", (o: ManualRunOptions) => { o.selection.candidates[0]!.artifacts[0]!.byteLength = 64 * 1024 * 1024 + 1; redigest(o); }],
        ["duplicate", (o: ManualRunOptions) => { o.selection.candidates.push(o.selection.candidates[0]!); }],
        ["nonincluded bytes", (o: ManualRunOptions) => { o.selection.candidates[0]!.classification = "excluded_by_policy"; redigest(o); }],
        ["fake signal", (o: ManualRunOptions) => { o.fence.signal = { aborted: false } as AbortSignal; }],
        ["missing function", (o: ManualRunOptions) => { o.exportPort.openArtifact = undefined as never; }],
    ] as const)("rejects %s", (_name, change) => {
        const options = input(); change(options);
        expect(() => prepareManualRun(options, "C001")).toThrow("export-response-invalid");
    });
    it("rejects a redigested non-code-unit document ordering", () => {
        const options = input();
        const first = options.selection.candidates[0]!;
        options.selection.candidates = [ { ...first, documentId: "z", artifacts: [] }, { ...first, ordinal: 2, documentId: "a", artifacts: [] } ];
        redigest(options);
        expect(() => prepareManualRun(options, "C001")).toThrow("export-response-invalid");
    });
    it.each([{}, { scheduledFor: null }, { scheduledFor: "2026-11-06T00:00:00Z" }])("preserves ordinary options %j", value => {
        expect(prepareManualRun(value, "C001")).toBeNull();
    });
    it("uses only the legacy vocabulary in summaries", () => {
        expect(legacyManualReasons(["lease-lost", "source-changed", "not-attempted", "other-safe-code"]))
            .toEqual(["coverage-unverified", "export-unavailable", "version-changed"]);
    });
    it("retains selected legacy codes and fence reasons when bounding a large safe reason union", () => {
        const reasons = boundedManualReasons([...Array.from({ length: 100 }, (_, i) => `safe-${i}`), "artifact-integrity", "lease-lost", "coverage-unverified", "not-attempted"]);
        expect(reasons).toHaveLength(64);
        expect(reasons).toEqual(expect.arrayContaining(["artifact-integrity", "lease-lost", "coverage-unverified", "not-attempted"]));
    });

    it("never classifies a callable carrying incomplete manual fields as an ordinary run", () => {
        const value = Object.assign(() => undefined, { fence: undefined });
        expect(() => prepareManualRun(value, "C001")).toThrow("export-response-invalid");
    });

});

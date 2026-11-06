import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import {
    ManualBackupControlError, parseManualControl, manualRequestBodySchema, manualPageSchema,
    manualClaimBodySchema, manualLeaseBodySchema, manualCandidatePageSchema, manualValidateBodySchema,
    manualArtifactBodySchema, manualWriteBodySchema, manualFinishBodySchema, manualRequestHash,
    validateManualOutcome, deriveManualSummary, toManualStaffRun, toManualStaffDocument,
} from "domain/eformsign-backup/manual-backup-control";
import type { ManualBackupRunRecord, ManualBackupDocumentRecord } from "domain/eformsign-backup/manual-backup-run";
import { manualAggregateResultSchema, manualAggregateResultDigest, manualDocumentResultDigest, type ManualDocumentResult } from "domain/eformsign-backup/worker/manual-protocol";

const JOB = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const WORKER = "33333333-3333-4333-8333-333333333333";
const scope = { period: "all" as const, start: "", end: "", kind: "all" as const,
    contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"] as const,
    recordStages: ["created", "sent", "reviewed", "completed"] as const };
const execution = { kind: "manual" as const, jobId: JOB, attemptId: `${JOB}.attempt-7`, companyId: "company", branchId: BRANCH, selectionDigest: "a".repeat(64) };
const metadata: ManualDocumentResult = { receiptId: JOB, runId: WORKER, scope: execution, documentId: "doc-1", classification: "excluded_by_policy",
    expectedArtifactIdentities: [], observedAtSequence: 1,
    local: { destinationIdentity: null, destinationRevision: null, state: "metadata_only", manifestStatus: "not_required", artifacts: [], reasons: [] },
    drive: { destinationIdentity: null, destinationRevision: null, state: "not_required", manifestStatus: "not_required", artifacts: [], reasons: [] }, reasons: [] };
const report = manualAggregateResultSchema.parse({ receiptId: JOB, runId: WORKER, scope: execution, status: "unverified", coverage: "unverified", backupComplete: false,
    documentResultCount: 1, documentResultsDigest: "b".repeat(64), counts: { selected: 1, localVerified: 0, driveVerified: 0, metadataOnly: 1, attention: 0 }, reasons: [] });
function run(status: ManualBackupRunRecord["status"] = "queued"): ManualBackupRunRecord {
    return { id: JOB, companyId: "company", branchId: BRANCH, requestedByUserId: WORKER, requestKey: "private-key", requestHash: "a".repeat(64),
        scope, sourceCounts: { total: 1, included: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 1 },
        snapshotAt: new Date("2026-11-01"), status, activeKey: null, attempts: 7, leaseToken: WORKER, leaseOwnerPrincipalId: "private-worker",
        leaseExpiresAt: new Date("2099-01-01"), heartbeatAt: null, startedAt: null, finishedAt: null, workerRunId: null,
        reportHash: null, result: null, failureCode: null, createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01") };
}
describe("manual backup strict control protocol", () => {
    it("pins the shared revision and exact job/attempt snapshot ID", () => {
        expect(MANUAL_BACKUP_SCOPE_REVISION).toBe("2026-11-06-branch-selected-docs");
        expect(manualBackupSnapshotId(execution)).toBe("manual-11111111-1111-4111-8111-111111111111-attempt-7");
        expect(() => manualBackupSnapshotId({ ...execution, attemptId: `${JOB}.attempt-07` })).toThrow("Invalid manual execution scope");
    });
    it("canonicalizes visible scope stages and binds company, branch and actor in the request hash", () => {
        const hash = manualRequestHash("company", BRANCH, WORKER, scope);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
        expect(manualRequestHash("company", BRANCH, WORKER, { ...scope, contractStages: [...scope.contractStages].reverse() })).toBe(hash);
        for (const [company, branch, user] of [["different", BRANCH, WORKER], ["company", JOB, WORKER], ["company", BRANCH, JOB]]) {
            expect(manualRequestHash(company!, branch!, user!, scope)).not.toBe(hash);
        }
    });
    it("rejects unknown fields at every boundary with no raw validator details or PII", () => {
        const lease = { companyId: "company", leaseToken: JOB };
        const entries = [
            [manualRequestBodySchema, { scope, requestKey: "key" }], [manualPageSchema, {}],
            [manualClaimBodySchema, { companyId: "company" }], [manualLeaseBodySchema, lease],
            [manualCandidatePageSchema, lease], [manualValidateBodySchema, lease],
            [manualArtifactBodySchema, { ...lease, documentId: "doc", artifactIdentity: "a".repeat(64) }],
            [manualWriteBodySchema, { ...lease, items: [{ payload: metadata, digest: manualDocumentResultDigest(metadata) }] }],
            [manualFinishBodySchema, { ...lease, payload: report, digest: "a".repeat(64) }],
        ] as const;
        for (const [schema, value] of entries) {
            expect(() => parseManualControl(schema as import("zod").z.ZodType<unknown>, { ...value, "private-name@example.test": "/private/path" })).toThrow("INVALID_REQUEST");
        }
        expect(new ManualBackupControlError("INVALID_REQUEST").message).toBe("INVALID_REQUEST");
    });
    it.each([0, 101, -1, 1.2, "01", "1e2", " 1", "1.0", "Infinity"])("rejects non-strict page limit %s", limit => {
        expect(() => parseManualControl(manualPageSchema, { limit })).toThrow("INVALID_REQUEST");
    });
    it("normalizes outcome array order for stable digests and rejects digest/size tampering", () => {
        const payload = { ...metadata, reasons: ["z", "a", "z"] };
        const digest = manualDocumentResultDigest(payload);
        expect(validateManualOutcome({ payload, digest }).payload.reasons).toEqual(["a", "z"]);
        expect(() => validateManualOutcome({ payload, digest: "0".repeat(64) })).toThrow("INVALID_REPORT");
        expect(() => validateManualOutcome({ payload: { ...metadata, privatePath: "/secret" }, digest })).toThrow("INVALID_REPORT");
        expect(() => validateManualOutcome({ payload, digest, overflow: "x".repeat(16 * 1024) })).toThrow("INVALID_REPORT");
    });
    it("does not count metadata-only as saved and derives excluded destinations", () => {
        expect(deriveManualSummary(report, [metadata])).toEqual({ target: 1, saved: 0, attention: 0, metadataOnly: 1,
            local: { state: "excluded", saved: 0 }, drive: { state: "excluded", saved: 0 } });
    });
    it("derives partial, failed and unverified destination states without exposing identities", () => {
        const verified = { ...metadata, local: { ...metadata.local, state: "verified" as const } };
        const blocked = { ...metadata, local: { ...metadata.local, state: "blocked" as const } };
        expect(deriveManualSummary(report, [verified, blocked]).local).toEqual({ state: "partial", saved: 1 });
        expect(deriveManualSummary(report, [blocked]).local).toEqual({ state: "failed", saved: 0 });
        expect(deriveManualSummary(report, [{ ...blocked, local: { ...blocked.local, state: "unverified" } }]).local).toEqual({ state: "unverified", saved: 0 });
    });
    it.each(["queued", "running", "failed", "blocked", "unverified", "partial"] as const)("maps absent/malformed terminal report safely for %s", status => {
        const raw = { ...run(status), result: { privateName: "private-name@example.test", destinationIdentity: "/private/path", summary: { saved: 999 } }, failureCode: "private-name@example.test" };
        const dto = toManualStaffRun(raw);
        expect(dto.summary).toEqual({ target: 1, saved: 0, attention: ["queued", "running"].includes(status) ? 0 : 1,
            metadataOnly: 0, local: { state: "unverified", saved: 0 }, drive: { state: "unverified", saved: 0 } });
        expect(dto.failureCode).toBeNull(); expect(dto.coverage).toBe("unverified"); expect(dto.backupComplete).toBe(false);
        for (const secret of ["private", WORKER, "lease", "result", "reportHash"]) expect(JSON.stringify(dto)).not.toContain(secret);
    });
    it("falls back safely when a stored wrapper has an invalid hash or inconsistent summary counts", () => {
        const summary = deriveManualSummary(report, [metadata]);
        const terminal = { ...run("unverified"), workerRunId: WORKER, reportHash: manualAggregateResultDigest(report), result: { report, summary } };
        expect(toManualStaffRun(terminal).summary.metadataOnly).toBe(1);
        expect(toManualStaffRun({ ...terminal, reportHash: "0".repeat(64) }).summary.metadataOnly).toBe(0);
        expect(toManualStaffRun({ ...terminal, result: { report, summary: { ...summary, metadataOnly: 0 } } }).summary.metadataOnly).toBe(0);
    });
    it("maps malformed document outcomes with a safe fallback and an explicit field allowlist", () => {
        const d: ManualBackupDocumentRecord = { runId: JOB, branchId: BRANCH, documentId: "doc", ordinal: 1, kind: "contract", currentMilestone: null,
            documentCreatedAt: new Date("2026-11-01"), candidate: { ordinal: 1, documentId: "doc", classification: "excluded_by_policy", reasons: ["private-name"],
                statusType: "001", documentKind: "contract", metadataRevision: "a".repeat(64), artifacts: [] }, outcome: { privateName: "/private/path" } };
        expect(toManualStaffDocument(d)).toEqual({ documentId: "doc", ordinal: 1, kind: "contract", currentMilestone: null,
            documentCreatedAt: "2026-11-01T00:00:00.000Z", classification: "excluded_by_policy", local: "unverified", drive: "unverified" });
    });
});

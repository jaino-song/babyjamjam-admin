import {
    normalizeManualBackupEnqueue, canonicalBackupJson, assertBackupObject, ManualBackupRunError,
    type EnqueueManualBackupInput, type ManualBackupCandidate,
} from "domain/eformsign-backup/manual-backup-run";
import { SbEformsignBackupRunRepository } from "infrastructure/database/repositories/sb.eformsign-backup-run.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const candidate: ManualBackupCandidate = { ordinal: 1, documentId: "doc-a", classification: "included", reasons: [],
    statusType: "003", documentKind: "contract", metadataRevision: HASH, artifacts: [] };
function valid(): EnqueueManualBackupInput {
    return { companyId: "test-company", branchId: BRANCH, requestedByUserId: null, requestKey: "request", requestHash: HASH,
        scope: { period: "all", start: "", end: "", kind: "all", contractStages: ["completed", "created", "completed"], recordStages: ["created"] },
        sourceCounts: { total: 1, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 1 },
        snapshotAt: new Date("2026-11-06T00:00:00Z"), documents: [{ documentId: "doc-a", ordinal: 1, kind: "contract",
            currentMilestone: "completed", documentCreatedAt: new Date("2026-11-01T00:00:00Z"), candidate }] };
}
describe("manual backup internal input validation", () => {
    it("normalizes scope without classifying raw statuses", () => {
        expect(normalizeManualBackupEnqueue(valid()).scope.contractStages).toEqual(["created", "completed"]);
    });
    it.each([
        { branchId: "not-uuid" }, { companyId: " " }, { requestHash: "A".repeat(64) }, { requestKey: "" },
        { snapshotAt: new Date("bad") }, { requestedByUserId: "fake" }, { activeKey: "supplied" },
        { sourceCounts: { total: 1, included: 1 } }, { documents: [] }, { scope: { period: "all" } },
    ])("rejects constructor casts: %j", change => {
        expect(() => normalizeManualBackupEnqueue({ ...valid(), ...change } as EnqueueManualBackupInput)).toThrow(ManualBackupRunError);
    });
    it.each([
        { ordinal: 0 }, { kind: "unknown" }, { currentMilestone: "other" }, { documentCreatedAt: new Date("bad") },
        { candidate: { ...candidate, documentId: "other" } }, { candidate: { ...candidate, customerName: "forbidden" } },
        { candidate: { ...candidate, artifacts: [{ fileType: "document", sha256: HASH, artifactIdentity: HASH, byteSize: -1 }] } },
    ])("rejects malformed fixed targets: %j", change => {
        const input = valid();
        expect(() => normalizeManualBackupEnqueue({ ...input, documents: [{ ...input.documents[0], ...change }] } as EnqueueManualBackupInput)).toThrow(ManualBackupRunError);
    });
    it("rejects duplicate and unsorted document IDs with contiguous ordinal requirements", () => {
        const input = valid(); const doc = input.documents[0]!;
        for (const documentId of ["doc-a", "doc-0"]) expect(() => normalizeManualBackupEnqueue({ ...input,
            sourceCounts: { ...input.sourceCounts, total: 2, included: 2 }, documents: [doc, { ...doc, ordinal: 2, documentId,
                candidate: { ...candidate, ordinal: 2, documentId } }] })).toThrow(ManualBackupRunError);
    });
    it("canonicalizes JSON key order but rejects cycles, undefined, nonfinite and non-JSON objects", () => {
        expect(canonicalBackupJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
        const cyclic: Record<string, unknown> = {}; cyclic["self"] = cyclic;
        for (const value of [cyclic, { a: undefined }, { a: NaN }, new Date(), { a: 1n }, { a: "\0" }, { a: "\ud800" }, { get a() { return 1; } }]) {
            expect(() => canonicalBackupJson(value)).toThrow(ManualBackupRunError);
        }
    });
    it("bounds actual UTF-8 bytes, including multibyte outcomes", () => {
        expect(() => assertBackupObject({ x: "한".repeat(6000) }, 16384)).toThrow(ManualBackupRunError);
        expect(() => assertBackupObject({ x: "a".repeat(16376) }, 16384)).not.toThrow();
        expect(() => assertBackupObject({ x: "a".repeat(16377) }, 16384)).toThrow(ManualBackupRunError);
        expect(() => assertBackupObject([], 16384)).toThrow(ManualBackupRunError);
    });
    it("uses generic errors without input values", () => {
        const error = new ManualBackupRunError("SOURCE_SCOPE_CHANGED");
        expect(error.message).toBe("Manual backup operation rejected"); expect(error.code).toBe("SOURCE_SCOPE_CHANGED");
    });
});
describe("manual backup adapter preflight", () => {
    const repository = new SbEformsignBackupRunRepository({} as PrismaService);
    it("rejects bad pagination and staff/machine identities before any DB operation", async () => {
        await expect(repository.listForBranch({ companyId: "c", branchId: BRANCH, limit: 101 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
        expect(() => repository.claimNext("", "p")).toThrow(ManualBackupRunError);
        expect(() => repository.heartbeat({ companyId: "c", principalId: "p", runId: BRANCH, leaseToken: "fake" })).toThrow(ManualBackupRunError);
        expect(() => repository.readSourceForRequest(BRANCH, { gte: new Date("2026-11-07"), lt: new Date("2026-11-06") })).toThrow(ManualBackupRunError);
    });
    it("rejects duplicate result IDs and oversized results/reports without writes", async () => {
        const identity = { companyId: "c", principalId: "p", runId: BRANCH, leaseToken: BRANCH };
        await expect(repository.writeDocumentResults(identity, [{ documentId: "d", outcome: {} }, { documentId: "d", outcome: {} }])).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(repository.writeDocumentResults(identity, [{ documentId: "d", outcome: { x: "x".repeat(16384) } }])).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(repository.finish(identity, { status: "unverified", workerRunId: "w", reportHash: HASH, result: { x: "x".repeat(131072) } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
});

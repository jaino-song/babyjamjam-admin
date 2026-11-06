import { EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { manualSelectionDigest } from "domain/eformsign-backup/worker/manual-protocol";
import { ExecutionFencedError } from "infrastructure/eformsign-backup/execution-effect-fence";
import { ManualControlFailure, type ManualClaim } from "infrastructure/eformsign-backup/worker/manual-control-client";
import { ManualBackupLeaseFence } from "infrastructure/eformsign-backup/worker/manual-lease";
import { runIdOf } from "./helpers/runner-support";

const at = "2000-01-01T00:00:00.000Z";
function claim(n = 1): ManualClaim {
    const selection = { jobId: runIdOf(n), companyId: "company", branchId: runIdOf(2),
        scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION, candidates: [] };
    const executionScope = { kind: "manual" as const, ...{ jobId: selection.jobId, companyId: selection.companyId, branchId: selection.branchId },
        attemptId: `${selection.jobId}.attempt-1`, selectionDigest: manualSelectionDigest(selection) };
    return { executionScope, leaseToken: runIdOf(n + 10), leaseDurationMs: 180000, leaseExpiresAtUTC: at,
        snapshot: { snapshotId: manualBackupSnapshotId(executionScope), status: "ready", companyId: "company",
            scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
            createdAt: at, readyAt: at, expiresAt: null, counts: { total: 0, inaccessible: 0, included: 0, excludedByPolicy: 0, policyPending: 0, unknownTemplate: 0 },
            coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false } };
}
const renewed = { leaseDurationMs: 180000 as const, leaseExpiresAtUTC: at };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
describe("monotonic manual lease authority", () => {
    const fences: ManualBackupLeaseFence[] = [];
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { for (const fence of fences.splice(0)) fence.close(); expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });
    function rig(overrides: Partial<ConstructorParameters<typeof ManualBackupLeaseFence>[0]> = {}) {
        const client = { renew: jest.fn(async () => renewed), validate: jest.fn(async (): Promise<void> => undefined) };
        const beforeCheck = jest.fn(async () => undefined);
        const fence = new ManualBackupLeaseFence({ client, claim: claim(), beforeCheck, claimStartedAtMono: performance.now(), ...overrides });
        fences.push(fence);
        return { fence, client, beforeCheck };
    }
    it("constructs without callbacks/timers and validates every global/document check despite UTC skew", async () => {
        const r = rig();
        expect(r.beforeCheck).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
        r.fence.start(); r.fence.start();
        await r.fence.assertActive(); await r.fence.assertActive("doc"); await r.fence.assertActive("doc");
        expect(r.client.validate.mock.calls.map(c => c.slice(0, 2))).toEqual([
            [{ runId: runIdOf(1), leaseToken: runIdOf(11) }, undefined],
            [{ runId: runIdOf(1), leaseToken: runIdOf(11) }, "doc"],
            [{ runId: runIdOf(1), leaseToken: runIdOf(11) }, "doc"],
        ]);
        expect(r.beforeCheck).toHaveBeenCalledTimes(6);
        expect(JSON.stringify(r.fence)).toBe("{}");
    });
    it("renews every 30 seconds, serializes concurrent checks and measures from request start", async () => {
        const pending = deferred<typeof renewed>();
        const r = rig(); r.client.renew.mockImplementationOnce(() => pending.promise);
        r.fence.start();
        await jest.advanceTimersByTimeAsync(30_000);
        const one = r.fence.assertActive("a"); const two = r.fence.assertActive("b");
        await jest.advanceTimersByTimeAsync(90_000);
        expect(r.client.renew).toHaveBeenCalledTimes(1); expect(r.client.validate).not.toHaveBeenCalled();
        pending.resolve(renewed); await Promise.all([one, two]);
        // Proof from t=30s expires at t=180s, even though the reply arrived at t=120s.
        r.client.renew.mockImplementation(() => new Promise(() => undefined));
        await jest.advanceTimersByTimeAsync(60_000);
        expect(r.fence.signal.aborted).toBe(true);
        await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "lease-lost" });
    });
    it("renews immediately below 60s remaining, sharing a single flight between checks", async () => {
        let now = 0;
        const r = rig({ now: () => now, claimStartedAtMono: 0 }); r.fence.start();
        now = 91_000;
        await Promise.all([r.fence.assertActive("a"), r.fence.assertActive("b")]);
        expect(r.client.renew).toHaveBeenCalledTimes(1);
        expect(r.client.validate).toHaveBeenCalledTimes(2);
    });
    it.each([NaN, Infinity, -1, 1])("refuses invalid/future request-start proof %s", proof => {
        expect(() => { const r = rig({ claimStartedAtMono: proof }); r.fence.start(); }).toThrow(ExecutionFencedError);
        expect(jest.getTimerCount()).toBe(0);
    });
    it("rejects an already spent proof and permanently latches the first reason", async () => {
        const r = rig({ now: () => 150_000, claimStartedAtMono: 0 });
        expect(() => r.fence.start()).toThrow(ExecutionFencedError); r.fence.close();
        await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "lease-lost" });
        expect(r.client.renew).not.toHaveBeenCalled();
    });
    it.each([
        [new ManualControlFailure(409, "LEASE_LOST"), "lease-lost"],
        [new ManualControlFailure(404, "NOT_FOUND"), "lease-lost"],
        [new ManualControlFailure(409, "SOURCE_CHANGED"), "source-changed"],
        [new ManualControlFailure(401, "UNKNOWN_ERROR"), "uncertain"],
        [new Error("PRIVATE detail"), "uncertain"],
    ])("normalizes client failures without exposing causes", async (error, reason) => {
        const r = rig(); r.client.validate.mockRejectedValue(error); r.fence.start();
        await expect(r.fence.assertActive("a")).rejects.toMatchObject({ reason, message: "Execution effect fenced" });
        await expect(r.fence.assertActive("b")).rejects.toMatchObject({ reason });
        expect(r.client.validate).toHaveBeenCalledTimes(1); expect(r.fence.signal.aborted).toBe(true);
    });
    it.each([false, true])("normalizes %s async guard failure before RPC", async asynchronous => {
        const r = rig({ beforeCheck: () => { if (asynchronous) return Promise.reject(new Error("PRIVATE")); throw new Error("PRIVATE"); } });
        r.fence.start(); await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "uncertain" });
        expect(r.client.validate).not.toHaveBeenCalled();
    });
    it("rechecks the local lock after RPC and discards a formerly valid response", async () => {
        const r = rig(); r.fence.start(); r.beforeCheck.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("lock gone"));
        await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "uncertain" });
        expect(r.client.validate).toHaveBeenCalledTimes(1);
    });
    it("deadline wins over nonsettling validation and a late rejection is consumed", async () => {
        const pending = deferred<void>(); const r = rig();
        r.client.validate.mockImplementation(() => pending.promise);
        r.client.renew.mockImplementation(() => new Promise(() => undefined)); r.fence.start();
        const checked = r.fence.assertActive(); const failure = expect(checked).rejects.toMatchObject({ reason: "lease-lost" });
        await jest.advanceTimersByTimeAsync(150_000); await failure;
        pending.reject(new Error("PRIVATE late failure")); await Promise.resolve();
        expect(jest.getTimerCount()).toBe(0);
    });
    it("close promptly races a nonsettling guard, prevents late renewal and is idempotent", async () => {
        const pending = deferred<void>(); const r = rig({ beforeCheck: () => pending.promise }); r.fence.start();
        const checked = r.fence.assertActive(); const failure = expect(checked).rejects.toMatchObject({ reason: "aborted" });
        await Promise.resolve(); r.fence.close(); r.fence.close(); await failure;
        pending.resolve(); await jest.advanceTimersByTimeAsync(300_000);
        expect(r.client.validate).not.toHaveBeenCalled(); expect(r.client.renew).not.toHaveBeenCalled();
        expect(() => r.fence.start()).toThrow(ExecutionFencedError);
    });
    it("ignores late renewal completion after close", async () => {
        const pending = deferred<typeof renewed>(); const r = rig(); r.client.renew.mockImplementation(() => pending.promise); r.fence.start();
        await jest.advanceTimersByTimeAsync(30_000); r.fence.close(); pending.resolve(renewed);
        await jest.advanceTimersByTimeAsync(500_000); expect(r.client.renew).toHaveBeenCalledTimes(1);
        await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "aborted" });
    });
    it("normalizes bad renewal metadata and throwing/backward clocks", async () => {
        const r = rig(); r.client.renew.mockResolvedValue({ ...renewed, leaseDurationMs: 1 } as unknown as typeof renewed); r.fence.start();
        await jest.advanceTimersByTimeAsync(30_000);
        await expect(r.fence.assertActive()).rejects.toMatchObject({ reason: "uncertain" });
        let now = 2; const second = rig({ now: () => now, claimStartedAtMono: 0 }); second.fence.start(); now = 1;
        await expect(second.fence.assertActive()).rejects.toMatchObject({ reason: "uncertain" });
        const third = rig({ now: () => { throw new Error("PRIVATE"); } }); expect(() => third.fence.start()).toThrow(ExecutionFencedError);
    });
    it("copies claim capabilities and keeps two fences sharing one client isolated", async () => {
        const original = claim(); const first = rig({ claim: original });
        const second = rig({ client: first.client, claim: claim(3) });
        original.leaseToken = runIdOf(99); original.executionScope.jobId = runIdOf(99);
        first.fence.start(); second.fence.start(); first.fence.close(); await second.fence.assertActive("doc");
        expect(first.client.validate).toHaveBeenCalledWith({ runId: runIdOf(3), leaseToken: runIdOf(13) }, "doc", second.fence.signal);
        expect(second.fence.signal.aborted).toBe(false);
    });
});

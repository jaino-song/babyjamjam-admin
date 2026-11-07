import { promises as fs } from "node:fs";
import { EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { buildManualAggregateResult, manualAggregateResultDigest, manualDocumentResultDigest, manualSelectionDigest,
    type ManualDocumentResult, type ManualSelection } from "domain/eformsign-backup/worker/manual-protocol";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { ManualControlFailure } from "infrastructure/eformsign-backup/worker/manual-control-client";
import type { ManualDeliveryBinding } from "infrastructure/eformsign-backup/worker/manual-delivery-store";
import { processPending, type ManualPendingOptions } from "infrastructure/eformsign-backup/worker/manual-pending";
import { INSTALL_AT, INSTALL_PARAMS, testMarkerWriter } from "./helpers/ledger-fixtures";
import { createHarness, destroyHarness, runIdOf, type Harness } from "./helpers/runner-support";

type Client = ManualPendingOptions["client"];
function mock<T extends (...args: never[]) => unknown>(implementation: (...args: Parameters<T>) => ReturnType<T>) {
    return jest.fn<ReturnType<T>, Parameters<T>>(implementation);
}
const fingerprint = "a".repeat(64);
function fixture(count = 1, job = 900) {
    const selection: ManualSelection = { jobId: runIdOf(job), companyId: "C001", branchId: runIdOf(901),
        scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
        candidates: Array.from({ length: count }, (_, i) => ({ ordinal: i + 1, documentId: `doc-${String(i).padStart(6, "0")}`,
            classification: "excluded_by_policy", reasons: [], statusType: "003", documentKind: "contract", metadataRevision: "b".repeat(64), artifacts: [] })) };
    const executionScope = { kind: "manual" as const, jobId: selection.jobId, companyId: selection.companyId, branchId: selection.branchId,
        attemptId: `${selection.jobId}.attempt-1`, selectionDigest: manualSelectionDigest(selection) };
    const binding: ManualDeliveryBinding = { version: 1, executionScope, snapshot: { snapshotId: manualBackupSnapshotId(executionScope), status: "ready", companyId: "C001",
        scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION, createdAt: INSTALL_AT, readyAt: INSTALL_AT, expiresAt: null,
        counts: { total: count, included: 0, inaccessible: 0, excludedByPolicy: count, policyPending: 0, unknownTemplate: 0 },
        coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false },
    leaseToken: runIdOf(job + 1000), leaseExpiresAtUTC: "2000-01-01T00:00:00.000Z", leaseDurationMs: 180000,
    installationId: INSTALL_PARAMS.installationId, credentialFingerprint: fingerprint, createdAtUTC: INSTALL_AT };
    const claim = { executionScope, snapshot: binding.snapshot, leaseToken: binding.leaseToken,
        leaseExpiresAtUTC: binding.leaseExpiresAtUTC, leaseDurationMs: binding.leaseDurationMs };
    return { selection, binding, claim };
}
type Fixture = ReturnType<typeof fixture>;
async function journal(store: LedgerStore, f: Fixture, run = 100, rich = false) {
    const runId = runIdOf(run);
    await store.append("run_started", { runId, scheduledFor: null, startedAt: INSTALL_AT, executionScope: f.binding.executionScope }, INSTALL_AT);
    for (const candidate of f.selection.candidates) await store.append("manual_candidate_selected", { runId, candidate }, INSTALL_AT);
    await store.append("manual_selection_ready", { runId, scopeRevision: f.selection.scopeRevision, policyRevision: f.selection.policyRevision,
        candidateCount: f.selection.candidates.length, selectionDigest: f.binding.executionScope.selectionDigest }, INSTALL_AT);
    const reasons = rich ? Array.from({ length: 64 }, (_, i) => `reason-${i}-${"R".repeat(90)}`) : [];
    const results: ManualDocumentResult[] = [];
    for (const candidate of f.selection.candidates) {
        const payload: ManualDocumentResult = { receiptId: runIdOf(run * 1000 + candidate.ordinal), runId, scope: f.binding.executionScope,
            documentId: candidate.documentId, classification: candidate.classification, expectedArtifactIdentities: [], observedAtSequence: store.lastSeq,
            local: { destinationIdentity: "local:synthetic", destinationRevision: "local-layout-v1", state: "metadata_only", manifestStatus: "not_required", artifacts: [], reasons },
            drive: { destinationIdentity: null, destinationRevision: null, state: "not_required", manifestStatus: "not_required", artifacts: [], reasons }, reasons };
        results.push(payload);
        await store.append("manual_document_result", { payload, digest: manualDocumentResultDigest(payload) }, INSTALL_AT);
    }
    const payload = buildManualAggregateResult({ receiptId: runIdOf(run + 500), runId, scope: f.binding.executionScope,
        selection: f.selection, results, status: "unverified", reasons: [] });
    const digest = manualAggregateResultDigest(payload);
    await store.append("manual_result_ready", { payload, digest }, INSTALL_AT);
    return { runId, receiptId: payload.receiptId, digest };
}
describe("manual pending orchestration with real C1 ledger and synthetic private binding port", () => {
    let h: Harness;
    let ledger: LedgerStore;
    let options: ManualPendingOptions;
    let records: ManualDeliveryBinding[];
    let client: jest.Mocked<ManualPendingOptions["client"]>;
    let runner: jest.Mocked<ManualPendingOptions["runner"]>;
    let bindings: jest.Mocked<ManualPendingOptions["bindings"]>;
    beforeEach(async () => {
        h = await createHarness({ startServer: false });
        ledger = await LedgerStore.open(h.control, { writeMarker: testMarkerWriter }); await ledger.initialize(INSTALL_PARAMS);
        records = [];
        client = { claim: mock<Client["claim"]>(async () => null), renew: mock<Client["renew"]>(async () => ({ leaseDurationMs: 180000, leaseExpiresAtUTC: INSTALL_AT })),
            validate: mock<Client["validate"]>(async () => undefined), listCandidates: mock<Client["listCandidates"]>(async () => ({ items: [], nextCursor: null })),
            openArtifact: mock<Client["openArtifact"]>(async () => { throw new Error("source forbidden during delivery"); }),
            finish: mock<Client["finish"]>(async () => undefined), writeDocumentResults: mock<Client["writeDocumentResults"]>(async () => undefined) };
        runner = { run: jest.fn(async () => { throw new Error("unexpected artifact work"); }) };
        bindings = { list: jest.fn(async () => records), put: jest.fn(async b => { records.push(JSON.parse(JSON.stringify(b))); }),
            remove: jest.fn(async b => { records = records.filter(r => r.executionScope.jobId !== b.executionScope.jobId); }) };
        options = { deps: { config: h.config, clock: h.clock, ledger, credentialFingerprint: fingerprint }, client, runner, bindings, lockGuard: jest.fn(async () => undefined) };
    });
    afterEach(async () => { jest.useRealTimers(); await ledger?.close(); if (h) await destroyHarness(h); });
    async function ready(count = 1, job = 900, rich = false) {
        const f = fixture(count, job); records.push(f.binding); const receipt = await journal(ledger, f, job + 3000, rich); return { ...f, receipt };
    }
    it("finishes first after expiry, durably ACKs before deleting the original capability, never renews or reads source", async () => {
        const f = await ready();
        let controlSignal: AbortSignal | undefined;
        client.finish.mockImplementation(async (_lease, _payload, _digest, signal) => {
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal!.aborted).toBe(false);
            controlSignal = signal;
        });
        bindings.remove.mockImplementation(async b => {
            expect(b).toEqual(f.binding); expect(ledger.state.manualAttempts!.get(f.receipt.runId)!.delivery).toBe("acknowledged");
        });
        expect(await processPending(options)).toMatchObject({ counts: { claimed: 0, acknowledged: 1, pending: 0, rejected: 0 } });
        expect(client.finish).toHaveBeenCalledWith({ runId: f.binding.executionScope.jobId, leaseToken: f.binding.leaseToken },
            ledger.state.manualAttempts!.get(f.receipt.runId)!.aggregate!.payload, f.receipt.digest, controlSignal);
        expect(client.finish).toHaveBeenCalledTimes(1);
        expect(controlSignal!.aborted).toBe(true);
        expect(client.renew).not.toHaveBeenCalled(); expect(client.validate).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
        expect(runner.run).not.toHaveBeenCalled(); expect(client.openArtifact).not.toHaveBeenCalled();
    });
    it("retains a lost finish response and replays the same receipt/digest after ledger reopen", async () => {
        const f = await ready(); const snapshot = canonicalJson(ledger.state.manualAttempts!.get(f.receipt.runId)!.aggregate);
        client.finish.mockRejectedValueOnce(new ManualControlFailure(0, "NETWORK"));
        expect(await processPending({ ...options, maxJobs: 20 })).toMatchObject({ counts: { pending: 1 } });
        expect(bindings.remove).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
        await ledger.close(); ledger = await LedgerStore.open(h.control); options.deps.ledger = ledger;
        expect(await processPending(options)).toMatchObject({ counts: { acknowledged: 1 } });
        expect(canonicalJson(ledger.state.manualAttempts!.get(f.receipt.runId)!.aggregate)).toBe(snapshot);
        expect(client.finish.mock.calls[0]!.slice(0, 3)).toEqual(client.finish.mock.calls[1]!.slice(0, 3));
        expect(client.finish.mock.calls[0]![3]).toBeInstanceOf(AbortSignal);
        expect(client.finish.mock.calls[1]![3]).toBeInstanceOf(AbortSignal);
        expect(client.finish.mock.calls[0]![3]).not.toBe(client.finish.mock.calls[1]![3]);
        expect(client.renew).not.toHaveBeenCalled();
    });
    it.each([false, true])("splits document results by 100 AND complete UTF8 body 64KiB (rich=%s)", async rich => {
        const f = await ready(rich ? 12 : 105, 900, rich);
        client.finish.mockRejectedValueOnce(new ManualControlFailure(409, "DOCUMENT_RESULTS_PENDING"));
        const events: string[] = []; client.renew.mockImplementation(async () => { events.push("renew"); return { leaseDurationMs: 180000, leaseExpiresAtUTC: INSTALL_AT }; });
        client.writeDocumentResults.mockImplementation(async (lease, items) => {
            events.push("documents"); expect(lease.runId).toBe(f.binding.executionScope.jobId); expect(items.length).toBeLessThanOrEqual(100);
            expect(Buffer.byteLength(canonicalJson({ companyId: h.config.companyId, leaseToken: lease.leaseToken, items }))).toBeLessThanOrEqual(65536);
        });
        expect(await processPending(options)).toMatchObject({ counts: { acknowledged: 1 } });
        expect(events[0]).toBe("renew"); expect(client.writeDocumentResults.mock.calls.length).toBeGreaterThan(1);
        expect(client.writeDocumentResults.mock.calls.flatMap(c => c[1])).toEqual([...ledger.state.manualAttempts!.get(f.receipt.runId)!.results.values()]);
        expect(client.finish).toHaveBeenCalledTimes(2); expect(client.validate).not.toHaveBeenCalled();
    });
    it("keeps the delivery heartbeat active through stalled batches and closes it after callback", async () => {
        await ready(); jest.useFakeTimers();
        client.finish.mockRejectedValueOnce(new ManualControlFailure(409, "DOCUMENT_RESULTS_PENDING"));
        let release!: () => void;
        client.writeDocumentResults.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
        const work = processPending(options);
        for (let i = 0; i < 30 && !release; i++) await jest.advanceTimersByTimeAsync(0);
        expect(release).toBeDefined(); await jest.advanceTimersByTimeAsync(60_000);
        expect(client.renew).toHaveBeenCalledTimes(3); release(); await work;
        expect(jest.getTimerCount()).toBe(0);
    });
    it.each(["LEASE_LOST", "NOT_FOUND", "INVALID_REPORT", "IDEMPOTENCY_CONFLICT"])("durably rejects %s before deleting", async code => {
        const f = await ready(); client.finish.mockRejectedValue(new ManualControlFailure(409, code));
        bindings.remove.mockImplementation(async () => { expect(ledger.state.manualAttempts!.get(f.receipt.runId)!.delivery).toBe("rejected"); });
        expect(await processPending(options)).toMatchObject({ counts: { rejected: 1, pending: 0 } });
    });
    it.each([new ManualControlFailure(401, "LEASE_LOST"), new ManualControlFailure(403, "INVALID_REPORT"),
        new ManualControlFailure(429, "UNKNOWN_ERROR"), new ManualControlFailure(503, "SERVICE_UNAVAILABLE"), new Error("PRIVATE unknown")])(
        "keeps uncertain/auth/availability failures pending", async failure => {
            const f = await ready(); client.finish.mockRejectedValue(failure);
            expect(await processPending(options)).toMatchObject({ counts: { pending: 1, rejected: 0 } });
            expect(bindings.remove).not.toHaveBeenCalled(); expect(ledger.state.manualAttempts!.get(f.receipt.runId)!.delivery).toBe("pending");
        });
    it("retains incomplete bindings without consuming budget or starving a later ready job", async () => {
        records.push(fixture(1, 100).binding); await ready();
        expect(await processPending(options)).toMatchObject({ counts: { acknowledged: 1 } });
        expect(records).toHaveLength(1); expect(records[0]!.executionScope.jobId).toBe(runIdOf(100)); expect(runner.run).not.toHaveBeenCalled();
    });
    it("cleans a durable closure left by a crashed deletion without another HTTP", async () => {
        const f = await ready(); await ledger.append("manual_result_acknowledged", f.receipt, INSTALL_AT);
        expect(await processPending(options)).toMatchObject({ counts: { acknowledged: 0 } });
        expect(bindings.remove).toHaveBeenCalledTimes(1); expect(client.finish).not.toHaveBeenCalled();
    });
    it("retains evidence and refuses a ready public aggregate whose private binding is missing", async () => {
        await ready(); records = [];
        await expect(processPending(options)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
        expect(client.finish).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
    });
    it.each(["credential", "installation", "company", "selection"])("fails closed on a mismatched %s binding", async field => {
        await ready(); const b = records[0]!;
        if (field === "credential") b.credentialFingerprint = "f".repeat(64);
        if (field === "installation") b.installationId = "other";
        if (field === "company") b.executionScope.companyId = "other";
        if (field === "selection") b.executionScope.selectionDigest = "c".repeat(64);
        await expect(processPending(options)).rejects.toBeDefined(); expect(client.finish).not.toHaveBeenCalled(); expect(bindings.remove).not.toHaveBeenCalled();
    });
    it("detects C1 digest contradiction before making HTTP", async () => {
        const f = await ready(); ledger.state.manualAttempts!.get(f.receipt.runId)!.results.values().next().value!.digest = "0".repeat(64);
        await expect(processPending(options)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" }); expect(client.finish).not.toHaveBeenCalled();
    });
    it("bounds existing ready plus new claims with the same max-jobs budget", async () => {
        await ready(1, 900); await ready(1, 902); await ready(1, 903);
        expect(await processPending({ ...options, maxJobs: 2 })).toMatchObject({ counts: { acknowledged: 2 } });
        expect(client.finish).toHaveBeenCalledTimes(2); expect(client.claim).not.toHaveBeenCalled(); expect(records).toHaveLength(1);
    });
    it("persistently binds a new claim before pages or runner and passes fixed selection/fence to C2", async () => {
        const f = fixture(); client.claim.mockResolvedValueOnce(f.claim);
        client.listCandidates.mockImplementation(async () => { expect(bindings.put).toHaveBeenCalledTimes(1); return { items: f.selection.candidates, nextCursor: null }; });
        runner.run.mockImplementation(async runOptions => {
            expect(runOptions).toMatchObject({ executionScope: f.binding.executionScope, selection: f.selection });
            if (!runOptions || !runOptions.executionScope) throw new Error("missing manual options");
            expect(() => runOptions.exportPort.createSnapshot("company fallback")).toThrow();
            const receipt = await journal(ledger, f);
            return { outcome: "finished", runId: receipt.runId, manualReceipt: receipt, snapshotId: f.binding.snapshot.snapshotId,
                sequence: null, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [], counts: null };
        });
        expect(await processPending(options)).toMatchObject({ counts: { claimed: 1, acknowledged: 1 } });
        expect(client.listCandidates).toHaveBeenCalledWith({ runId: f.binding.executionScope.jobId, leaseToken: f.binding.leaseToken }, { afterOrdinal: 0, limit: 100 }, expect.any(AbortSignal));
    });
    it("uses a live independent finish signal when the completed run's effect fence has aborted", async () => {
        const f = fixture(); client.claim.mockResolvedValueOnce(f.claim);
        client.listCandidates.mockResolvedValue({ items: f.selection.candidates, nextCursor: null });
        let effectSignal: AbortSignal | undefined;
        runner.run.mockImplementation(async runOptions => {
            if (!runOptions || !runOptions.executionScope) throw new Error("missing manual options");
            const receipt = await journal(ledger, f);
            effectSignal = runOptions.fence.signal;
            client.validate.mockRejectedValueOnce(new ManualControlFailure(409, "LEASE_LOST"));
            await expect(runOptions.fence.assertActive()).rejects.toMatchObject({ reason: "lease-lost" });
            expect(effectSignal.aborted).toBe(true);
            return { outcome: "finished", runId: receipt.runId, manualReceipt: receipt, snapshotId: f.binding.snapshot.snapshotId,
                sequence: null, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [], counts: null };
        });
        client.finish.mockImplementation(async (lease, payload, digest, signal) => {
            expect(effectSignal!.aborted).toBe(true);
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal).not.toBe(effectSignal);
            expect(signal!.aborted).toBe(false);
            expect(lease).toEqual({ runId: f.binding.executionScope.jobId, leaseToken: f.binding.leaseToken });
            expect(payload).toEqual(ledger.state.manualAttempts!.get(payload.runId)!.aggregate!.payload);
            expect(digest).toBe(manualAggregateResultDigest(payload));
        });
        expect(await processPending(options)).toMatchObject({ counts: { claimed: 1, acknowledged: 1, pending: 0, rejected: 0 } });
        expect(client.finish).toHaveBeenCalledTimes(1);
        expect(client.renew).not.toHaveBeenCalled(); expect(client.writeDocumentResults).not.toHaveBeenCalled();
        expect(records).toHaveLength(0);
    });
    it("never starts pages or engine when durable private publication fails", async () => {
        client.claim.mockResolvedValueOnce(fixture().claim); bindings.put.mockRejectedValue(new Error("PRIVATE file path"));
        await expect(processPending(options)).rejects.toBeDefined(); expect(client.listCandidates).not.toHaveBeenCalled(); expect(runner.run).not.toHaveBeenCalled();
    });
    it("does not replenish the request-start budget while waiting for private durability", async () => {
        jest.useFakeTimers(); const f = fixture(); client.claim.mockResolvedValueOnce(f.claim);
        let published!: () => void;
        bindings.put.mockImplementation(b => new Promise<void>(resolve => { records.push(b); published = resolve; }));
        const work = processPending(options); const checked = expect(work).rejects.toMatchObject({ reasonCode: "export-unavailable" });
        for (let i = 0; i < 30 && !published; i++) await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(150_000); published(); await checked;
        expect(records).toHaveLength(1); expect(client.listCandidates).not.toHaveBeenCalled(); expect(runner.run).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
    it("aborts stalled candidate pages at the conservative deadline and consumes a late failure", async () => {
        jest.useFakeTimers(); const f = fixture(); client.claim.mockResolvedValueOnce(f.claim);
        let rejectPage!: (error: unknown) => void;
        client.listCandidates.mockImplementation(() => new Promise((_, reject) => { rejectPage = reject; }));
        client.renew.mockImplementation(() => new Promise(() => undefined));
        const checked = expect(processPending(options)).rejects.toMatchObject({ reasonCode: "export-unavailable" });
        for (let i = 0; i < 30 && !rejectPage; i++) await jest.advanceTimersByTimeAsync(0);
        expect(rejectPage).toBeDefined(); await jest.advanceTimersByTimeAsync(150_000); await checked;
        rejectPage(new Error("PRIVATE late page")); await Promise.resolve();
        expect(runner.run).not.toHaveBeenCalled(); expect(records).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
    });
    it("keeps delivery pending when renewal loses authority while a document request never settles", async () => {
        await ready(); jest.useFakeTimers();
        client.finish.mockRejectedValueOnce(new ManualControlFailure(409, "DOCUMENT_RESULTS_PENDING"));
        let sending = false;
        client.writeDocumentResults.mockImplementation(() => { sending = true; return new Promise(() => undefined); });
        client.renew.mockResolvedValueOnce({ leaseDurationMs: 180000, leaseExpiresAtUTC: INSTALL_AT })
            .mockRejectedValueOnce(new ManualControlFailure(0, "NETWORK"));
        const work = processPending(options);
        for (let i = 0; i < 30 && !sending; i++) await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(30_000);
        expect(await work).toMatchObject({ counts: { pending: 1 } });
        expect(bindings.remove).not.toHaveBeenCalled(); expect(client.finish).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
    });
    it("records explicit lease rejection during a new run's delivery renewal", async () => {
        const f = fixture(); client.claim.mockResolvedValueOnce(f.claim);
        client.listCandidates.mockResolvedValue({ items: f.selection.candidates, nextCursor: null });
        runner.run.mockImplementation(async () => {
            const receipt = await journal(ledger, f);
            return { outcome: "finished", runId: receipt.runId, manualReceipt: receipt, snapshotId: f.binding.snapshot.snapshotId,
                sequence: null, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [], counts: null };
        });
        client.finish.mockRejectedValueOnce(new ManualControlFailure(409, "DOCUMENT_RESULTS_PENDING"));
        client.renew.mockRejectedValueOnce(new ManualControlFailure(409, "LEASE_LOST"));
        expect(await processPending(options)).toMatchObject({ counts: { claimed: 1, rejected: 1 } });
        expect(records).toHaveLength(0); expect(client.writeDocumentResults).not.toHaveBeenCalled();
    });
    it.each(["loop", "ordinal", "digest", "revision", "count"])("rejects unsafe fixed page facts: %s", async defect => {
        const f = fixture(); const bad = JSON.parse(JSON.stringify(f.claim));
        if (defect === "digest") bad.executionScope.selectionDigest = "f".repeat(64);
        if (defect === "revision") bad.snapshot.scopeRevision = "other";
        if (defect === "count") bad.snapshot.counts = { ...bad.snapshot.counts, total: 2, excludedByPolicy: 2 };
        client.claim.mockResolvedValueOnce(bad);
        client.listCandidates.mockResolvedValue({ items: defect === "ordinal" ? [{ ...f.selection.candidates[0]!, ordinal: 2 }] : f.selection.candidates,
            nextCursor: defect === "loop" ? 0 : null });
        await expect(processPending(options)).rejects.toBeDefined(); expect(runner.run).not.toHaveBeenCalled(); expect(client.openArtifact).not.toHaveBeenCalled();
    });
    it("never restarts an incomplete binding when claim repeats that attempt", async () => {
        const f = fixture(); records.push(f.binding); client.claim.mockResolvedValueOnce(f.claim);
        await expect(processPending(options)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" }); expect(runner.run).not.toHaveBeenCalled(); expect(bindings.put).not.toHaveBeenCalled();
    });
    it("disabled and lost-lock paths have zero store/network/runner effects", async () => {
        options.deps.config = { ...h.config, enabled: false };
        expect(await processPending(options)).toMatchObject({ outcome: "disabled" }); expect(bindings.list).not.toHaveBeenCalled();
        options.deps.config = h.config; options.lockGuard = async () => { throw new Error("PRIVATE lock"); };
        await expect(processPending(options)).rejects.toMatchObject({ reasonCode: "lock-not-held" });
        expect(bindings.list).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled(); expect(runner.run).not.toHaveBeenCalled();
    });
    it("leaves durable pending receipt/capability when ACK append fails", async () => {
        const f = await ready(); jest.spyOn(ledger, "append").mockRejectedValueOnce(new Error("PRIVATE fsync"));
        expect(await processPending(options)).toMatchObject({ counts: { pending: 1 } });
        expect(ledger.state.manualAttempts!.get(f.receipt.runId)!.delivery).toBe("pending"); expect(bindings.remove).not.toHaveBeenCalled();
    });
    it("rejects invalid budgets before private/network work", async () => {
        for (const maxJobs of [0, 21, NaN, 1.2]) await expect(processPending({ ...options, maxJobs })).rejects.toMatchObject({ reasonCode: "config-invalid" });
        expect(bindings.list).not.toHaveBeenCalled(); expect(client.claim).not.toHaveBeenCalled();
        expect((await fs.readdir(h.archive))).toEqual([]);
    });
});

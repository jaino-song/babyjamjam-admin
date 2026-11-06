import { promises as fs } from "node:fs";
import path from "node:path";

import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { artifactKey, ledgerStateToJson, WorkerError } from "domain/eformsign-backup/worker";
import { manualSelectionDigest, manualAggregateResultDigest, manualDocumentResultDigest, type ManualSelection } from "domain/eformsign-backup/worker/manual-protocol";
import { ExecutionFencedError } from "infrastructure/eformsign-backup/execution-effect-fence";
import type { DriveFailure } from "infrastructure/eformsign-backup/worker/drive-client";
import { DriveDestination } from "infrastructure/eformsign-backup/worker/drive-destination";
import { ExportClient } from "infrastructure/eformsign-backup/worker/export-client";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";
import { WorkerRunner, controlMarkerWriter } from "infrastructure/eformsign-backup/worker/runner";
import type { ManualRunOptions, RunnerDependencies } from "infrastructure/eformsign-backup/worker/runner-types";

import { probeFor, snapshotTree } from "./helpers/destination-support";
import { startDriveFakes, makeDriveClient, type DriveHarness } from "./helpers/drive-support";
import { createHarness, destroyHarness, pairDoc, runIdOf, rewriteConfig, TOKEN } from "./helpers/runner-support";

async function rig(withDrive = false) {
    const h = await createHarness();
    let fakes: DriveHarness | undefined;
    let ledger: LedgerStore | undefined;
    try {
        if (withDrive) { fakes = await startDriveFakes(); await rewriteConfig(h, { drive: { ...fakes.config, rootFolderName: "synthetic-backup", chunkBytes: 262144 } }); }
        const probe = probeFor();
        ledger = await LedgerStore.open(h.control, { writeMarker: controlMarkerWriter });
        const ordinary = new ExportClient({ baseUrl: h.baseUrl, token: TOKEN, companyId: h.config.companyId, requestTimeoutMs: 1000 });
        const drive = fakes ? { kind: "ready" as const, client: makeDriveClient(fakes).client, settings: { ...h.config.drive!, requestTimeoutMs: 1000 } } : null;
        const deps: RunnerDependencies = { config: h.config, ledger, clock: h.clock, uuid: h.uuid, probe, sleep: async () => undefined,
            exportClient: ordinary, drive,
            createDestination: ({ dev, ino }) => new LocalDestination({ archivePath: h.archive, archiveId: h.config.archive.archiveId,
                expectedDev: dev, expectedIno: ino, reserveBytes: h.config.archive.reserveBytes, reserveInodes: h.config.archive.reserveInodes,
                requireMountPoint: false }, probe),
            createDriveDestination: (binding) => { if (!drive) throw new WorkerError("drive-not-configured"); return new DriveDestination(drive.client, binding); } };
        const runner = new WorkerRunner(deps);
        await runner.init();
        if (drive) await runner.driveSetup({ rebind: false });
        async function claim(docs = [pairDoc("A")], attempt = 1): Promise<ManualRunOptions> {
            h.api.docs = docs;
            const frozen = await ordinary.createSnapshot(`fixture-${h.uuid()}`);
            const candidates = [];
            let cursor: string | null = null;
            do { const page = await ordinary.listCandidates(frozen.snapshotId, cursor); candidates.push(...page.items); cursor = page.nextCursor; } while (cursor);
            const jobId = runIdOf(900);
            const selection: ManualSelection = { jobId, companyId: h.config.companyId, branchId: runIdOf(901),
                scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: frozen.policyRevision, candidates: candidates.map((c) => ({ ...c,
                    artifacts: c.artifacts.map((a) => ({ artifactType: a.fileType === "document" ? "document" : "audit-trail",
                        artifactIdentity: a.artifactIdentity, sha256: a.sha256, byteLength: a.byteSize })) })) };
            const executionScope = { kind: "manual" as const, jobId, companyId: selection.companyId, branchId: selection.branchId,
                attemptId: `${jobId}.attempt-${attempt}`, selectionDigest: manualSelectionDigest(selection) };
            h.api.clearRequests();
            return { executionScope, selection, snapshot: { ...frozen, snapshotId: manualBackupSnapshotId(executionScope), scopeRevision: selection.scopeRevision, expiresAt: null },
                fence: { signal: new AbortController().signal, assertActive: jest.fn(async () => undefined) },
                exportPort: { createSnapshot: jest.fn(), getSnapshot: jest.fn(), listCandidates: jest.fn(),
                    openArtifact: jest.fn((_snapshotId, artifact) => ordinary.openArtifact(frozen.snapshotId, artifact)) } };
        }
        return { h, deps, runner, fakes, claim, async close() { await deps.ledger.close(); await fakes?.close(); await destroyHarness(h); } };
    } catch (error) { await ledger?.close(); await fakes?.close(); await destroyHarness(h); throw error; }
}

type Rig = Awaited<ReturnType<typeof rig>>;
let current: Rig | undefined;
afterEach(async () => { jest.restoreAllMocks(); await current?.close(); current = undefined; });
const attemptOf = (r: Rig) => [...r.deps.ledger.state.manualAttempts!.values()][0]!;

describe("selected manual archive engine", () => {
    it("stores a PDF/audit pair as one unverified-coverage document and retains immutable receipts after reopen", async () => {
        const r = current = await rig(true);
        const options = await r.claim();
        const summary = await r.runner.run(options);
        expect(summary).toMatchObject({ snapshotStatus: "partial", historicalCoverage: "unverified", counts: { verified: 2, driveVerified: 2 } });
        const attempt = attemptOf(r);
        expect(attempt.aggregate!.payload).toMatchObject({ status: "unverified", backupComplete: false, coverage: "unverified",
            counts: { selected: 1, localVerified: 1, driveVerified: 1, metadataOnly: 0, attention: 0 } });
        expect(summary.manualReceipt!.digest).toBe(manualAggregateResultDigest(attempt.aggregate!.payload));
        for (const result of attempt.results.values()) expect(result.digest).toBe(manualDocumentResultDigest(result.payload));
        expect(options.exportPort.createSnapshot).not.toHaveBeenCalled();
        expect(options.exportPort.getSnapshot).not.toHaveBeenCalled();
        expect(options.exportPort.listCandidates).not.toHaveBeenCalled();
        expect(r.h.api.requests.every((request) => request.url.includes("/artifacts/"))).toBe(true);
        expect(r.deps.ledger.state.completions.size).toBe(0);
        expect(r.fakes!.drive.nodes().filter((n) => n.bytes && (/completions|runs/.test(n.name)))).toEqual([]);
        const receipt = JSON.stringify(ledgerStateToJson(r.deps.ledger.state).manualAttempts);
        await r.deps.ledger.compactIfNeeded(1);
        await r.deps.ledger.close();
        r.deps.ledger = await LedgerStore.open(r.h.control, { writeMarker: controlMarkerWriter });
        expect(r.deps.ledger.status).toBe("ok");
        expect(JSON.stringify(ledgerStateToJson(r.deps.ledger.state).manualAttempts)).toBe(receipt);
        const before = ledgerStateToJson(r.deps.ledger.state);
        const tree = await snapshotTree(r.h.base);
        const requests = r.fakes!.drive.requests.length;
        expect(await r.runner.run(options)).toEqual(summary);
        expect(ledgerStateToJson(r.deps.ledger.state)).toEqual(before);
        expect(await snapshotTree(r.h.base)).toEqual(tree);
        expect(r.fakes!.drive.requests).toHaveLength(requests);
    });
    it("normalizes the claim before the first mutable callback", async () => {
        const r = current = await rig();
        const options = await r.claim();
        const candidate = structuredClone(options.selection.candidates[0]!);
        const check = jest.fn(async () => {
            options.selection.candidates.length = 0;
            options.snapshot.companyId = "C999";
            options.executionScope.selectionDigest = "0".repeat(64);
        });
        options.fence.assertActive = check;
        const summary = await r.runner.run(options);
        expect(summary.counts!.verified).toBe(2);
        expect([...attemptOf(r).candidates.values()]).toEqual([candidate]);
        expect(check.mock.calls.length).toBeGreaterThan(0);
    });
    it.each(["executionScope", "selection", "snapshot", "exportPort", "fence"])("incomplete %s input has zero effects including startup compaction", async key => {
        const r = current = await rig(true);
        const tree = await snapshotTree(r.h.base);
        const seq = r.deps.ledger.lastSeq;
        const create = jest.spyOn(r.deps, "createDestination");
        const compact = jest.spyOn(r.deps.ledger, "compactIfNeeded");
        const requests = r.fakes!.drive.requests.length;
        await expect(r.runner.run({ [key]: undefined } as never)).rejects.toMatchObject({ reasonCode: "export-response-invalid" });
        expect(create).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
        expect(r.deps.ledger.lastSeq).toBe(seq); expect(r.fakes!.drive.requests).toHaveLength(requests);
        expect(await snapshotTree(r.h.base)).toEqual(tree);
    });
    it("empty selection is disabled before installation, staging or port calls", async () => {
        const r = current = await rig();
        const options = await r.claim([]);
        const before = await snapshotTree(r.h.base);
        const create = jest.spyOn(r.deps, "createDestination");
        expect(await r.runner.run(options)).toMatchObject({ outcome: "disabled", runId: null, counts: null });
        expect(create).not.toHaveBeenCalled(); expect(await snapshotTree(r.h.base)).toEqual(before);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it.each(["included", "excluded_by_policy", "unknown_template", "policy_pending", "inaccessible"] as const)("accounts for %s without inventing stored PDFs", async classification => {
        const r = current = await rig();
        const options = await r.claim([{ documentId: "A", classification, artifacts: [] }]);
        const summary = await r.runner.run(options);
        const result = [...attemptOf(r).results.values()][0]!.payload;
        expect(summary.counts!.verified).toBe(0);
        expect(attemptOf(r).aggregate!.payload.counts).toMatchObject({ localVerified: 0, selected: 1,
            metadataOnly: classification === "excluded_by_policy" ? 1 : 0, attention: classification === "excluded_by_policy" ? 0 : 1 });
        expect(result.local.state).toBe(classification === "excluded_by_policy" ? "metadata_only" : "unverified");
        expect(result.drive.state).toBe("not_required");
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
        expect(r.deps.ledger.state.manifests.size).toBe(0);
    });
    it("a missing pair member publishes only a partial manifest and never a verified document", async () => {
        const r = current = await rig(true);
        const doc = pairDoc("A"); doc.artifacts!.pop();
        const summary = await r.runner.run(await r.claim([doc]));
        expect(summary.counts).toMatchObject({ verified: 1, driveVerified: 1 });
        expect(attemptOf(r).aggregate!.payload).toMatchObject({ status: "partial", counts: { localVerified: 0, driveVerified: 0, attention: 1 } });
        expect(r.deps.ledger.state.manifests.size).toBe(1);
    });
    it.each(["lease-lost", "source-changed", "aborted", "uncertain"] as const)("loss before staging (%s) journals every unattempted document with no effects", async reason => {
        const r = current = await rig(true);
        const options = await r.claim([pairDoc("A"), pairDoc("B")]);
        options.fence.assertActive = jest.fn(async () => { throw new ExecutionFencedError(reason); });
        const requests = r.fakes!.drive.requests.length;
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(summary.reasonCodes).toContain(reason === "source-changed" ? "version-changed" : "export-unavailable");
        expect(attemptOf(r).results.size).toBe(2);
        for (const result of attemptOf(r).results.values()) {
            expect(result.payload.local.reasons).toEqual(expect.arrayContaining([reason, "not-attempted"]));
            expect(result.payload.local.artifacts.every((a) => a.state === null)).toBe(true);
        }
        expect(r.fakes!.drive.requests).toHaveLength(requests);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
        await expect(fs.lstat(path.join(r.h.control, "staging"))).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("an incomplete attempt cannot restart and a changed digest cannot acquire another run ID", async () => {
        const r = current = await rig();
        const options = await r.claim();
        const at = r.h.clock.now().toISOString();
        await r.deps.ledger.append("run_started", { runId: runIdOf(999), scheduledFor: null, startedAt: at, executionScope: options.executionScope }, at);
        const seq = r.deps.ledger.lastSeq;
        await expect(r.runner.run(options)).rejects.toMatchObject({ reason: "uncertain" });
        const changed = await r.claim([pairDoc("C")]);
        await expect(r.runner.run(changed)).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
        expect(r.deps.ledger.lastSeq).toBe(seq);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it("freshly rechecks cached local and Drive bytes without opening the source", async () => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        const options = await r.claim([pairDoc("A")], 2);
        const reverify = jest.spyOn(LocalDestination.prototype, "reverify");
        const remote = jest.spyOn(DriveDestination.prototype, "verifyRemote");
        const summary = await r.runner.run(options);
        expect(summary.counts).toMatchObject({ verified: 2, driveVerified: 2 });
        expect(reverify).toHaveBeenCalledTimes(2); expect(remote).toHaveBeenCalledTimes(2);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it("a stale verified ledger bit is not counted when fresh reuse is fenced", async () => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        const options = await r.claim([pairDoc("A"), pairDoc("B")], 2);
        options.fence.assertActive = jest.fn(async id => { if (id) throw new ExecutionFencedError("source-changed"); });
        const summary = await r.runner.run(options);
        expect(summary.counts).toMatchObject({ verified: 0, driveVerified: 0 });
        const attempt = [...r.deps.ledger.state.manualAttempts!.values()][1]!;
        expect(attempt.aggregate!.payload.counts.localVerified).toBe(0);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it.each(["mismatch", "missing", "conflict", "download-corruption", "download-missing"] as const)("revokes earlier Drive proof after contradictory %s evidence", async contradiction => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        const artifact = attemptOf(r).candidates.get("A")!.artifacts[0]!;
        const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
        const binding = r.deps.ledger.state.installation!.drive!;
        const nodeOf = () => r.deps.ledger.state.driveNodes.get(`${binding.destinationRevision}|${key}`)!;
        // Two previous repairs make the next contradiction exhaust the integrity budget.
        for (const attempt of [2, 3]) {
            r.fakes!.drive.corrupt(nodeOf().fileId);
            await r.runner.run(await r.claim([pairDoc("A")], attempt));
        }
        const node = nodeOf();
        await fs.rm(path.join(r.h.archive, key));
        await fs.rm(path.join(r.h.control, "staging", `${artifact.artifactIdentity}.bin`));
        const verify = DriveDestination.prototype.verifyRemote;
        let checks = 0;
        jest.spyOn(DriveDestination.prototype, "verifyRemote").mockImplementation(async function (this: DriveDestination, ...args) {
            if (args[0] === node.fileId && ++checks === 2) {
                if (contradiction === "conflict") return { ok: false, conflict: "mismatch" };
                if (contradiction === "mismatch") r.fakes!.drive.corrupt(node.fileId);
                if (contradiction === "missing") r.fakes!.drive.trash(node.fileId);
            }
            return verify.apply(this, args);
        });
        const download = DriveDestination.prototype.download;
        jest.spyOn(DriveDestination.prototype, "download").mockImplementation(async function (this: DriveDestination, ...args) {
            if (args[0] === node.fileId) {
                if (contradiction === "download-corruption") r.fakes!.drive.corrupt(node.fileId);
                if (contradiction === "download-missing") r.fakes!.drive.addFault({ route: "download", times: 1,
                    match: (request) => request.id === node.fileId, action: { type: "status", status: 404, reason: "notFound" } });
            }
            return download.apply(this, args);
        });
        const summary = await r.runner.run(await r.claim([pairDoc("A")], 4));
        expect(checks).toBe(contradiction.startsWith("download-") ? 1 : 2);
        expect(summary.counts).toMatchObject({ verified: 2, driveVerified: 1, driveBlocked: 1 });
        const latest = [...r.deps.ledger.state.manualAttempts!.values()].at(-1)!;
        const result = latest.results.get("A")!.payload;
        expect(result.local.state).toBe("verified");
        expect(result.drive.state).toBe("partial");
        expect(result.drive.artifacts.find((a) => a.artifactIdentity === artifact.artifactIdentity)).toMatchObject({ state: "blocked", reasonCode: "integrity-repeated" });
        expect([...r.deps.ledger.state.destinations.values()].find((e) => e.artifactIdentity === artifact.artifactIdentity
            && e.destinationIdentity === binding.destinationIdentity)).toMatchObject({ state: "blocked", reasonCode: "integrity-repeated" });
        expect(latest.aggregate!.payload).toMatchObject({ status: "partial", counts: { driveVerified: 0, attention: 1 } });
        expect(latest.aggregate!.digest).toBe(manualAggregateResultDigest(latest.aggregate!.payload));
    });
    it.each([
        ["timeout", { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null }, "network-timeout", false],
        ["rate limit", { kind: "http", httpStatus: 429, reason: null, retryAfterSeconds: 30 }, "rate-limited", false],
        ["permission", { kind: "http", httpStatus: 403, reason: "forbidden", retryAfterSeconds: null }, "drive-permission", true],
        ["quota", { kind: "http", httpStatus: 403, reason: "storageQuotaExceeded", retryAfterSeconds: null }, "drive-quota", true],
        ["token", { kind: "token-rejected", httpStatus: 400, reason: "invalid_grant", retryAfterSeconds: null }, "drive-token-invalid", true],
    ] satisfies Array<[string, DriveFailure, string, boolean]>)("journals cached Drive %s verification failure without changing historical verified entries", async (_label, failure, reason, halts) => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        const binding = r.deps.ledger.state.installation!.drive!;
        const before = JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => e.destinationIdentity === binding.destinationIdentity));
        const remote = jest.spyOn(DriveDestination.prototype, "verifyRemote").mockResolvedValue({ ok: false, failure });
        const options = await r.claim([pairDoc("A")], 2);
        const summary = await r.runner.run(options);
        expect(summary.manualReceipt).toBeDefined();
        expect(summary.counts).toMatchObject({ verified: 2, driveVerified: 0 });
        expect(summary.reasonCodes).toContain(reason);
        expect(remote).toHaveBeenCalledTimes(halts ? 1 : 2);
        expect(JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => e.destinationIdentity === binding.destinationIdentity))).toBe(before);
        const latest = [...r.deps.ledger.state.manualAttempts!.values()].at(-1)!;
        const result = latest.results.get("A")!.payload;
        expect(result.local.state).toBe("verified");
        expect(result.drive.state).not.toBe("verified");
        expect(result.drive.reasons).toContain(reason);
        expect(result.drive.artifacts.some((a) => a.reasonCode === reason && a.state !== "verified")).toBe(true);
        expect(latest.aggregate!.payload).toMatchObject({ status: "partial", counts: { driveVerified: 0, attention: 1 } });
        expect(latest.aggregate!.digest).toBe(manualAggregateResultDigest(latest.aggregate!.payload));
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it.each(["failure-after-proof", "proof-after-failure"] as const)("uses the latest fresh cached Drive evidence for %s", async order => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        const artifact = attemptOf(r).candidates.get("A")!.artifacts[0]!;
        const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
        const binding = r.deps.ledger.state.installation!.drive!;
        const node = r.deps.ledger.state.driveNodes.get(`${binding.destinationRevision}|${key}`)!;
        await fs.rm(path.join(r.h.archive, key));
        await fs.rm(path.join(r.h.control, "staging", `${artifact.artifactIdentity}.bin`));
        let checks = 0;
        const verify = DriveDestination.prototype.verifyRemote;
        jest.spyOn(DriveDestination.prototype, "verifyRemote").mockImplementation(async function (this: DriveDestination, ...args) {
            if (args[0] === node.fileId && ++checks === (order === "failure-after-proof" ? 2 : 1)) {
                return { ok: false, failure: { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null } };
            }
            return verify.apply(this, args);
        });
        const summary = await r.runner.run(await r.claim([pairDoc("A")], 2));
        expect(checks).toBe(2);
        const recovered = order === "proof-after-failure";
        expect(summary.counts).toMatchObject({ verified: 2, driveVerified: recovered ? 2 : 1, driveRetryWait: recovered ? 0 : 1 });
        const latest = [...r.deps.ledger.state.manualAttempts!.values()].at(-1)!;
        const result = latest.results.get("A")!.payload;
        expect(result.drive.state).toBe(recovered ? "verified" : "partial");
        expect(result.drive.reasons).toEqual(recovered ? [] : ["network-timeout"]);
        expect(latest.aggregate!.payload.counts.driveVerified).toBe(recovered ? 1 : 0);
    });
    it.each(["local", "drive"] as const)("corrupt %s cache is checked and only selected identities are repaired", async side => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim([pairDoc("A"), pairDoc("B")]));
        const first = attemptOf(r);
        const bIds = new Set(first.candidates.get("B")!.artifacts.map((a) => a.artifactIdentity));
        const bBefore = [...r.deps.ledger.state.destinations.values()].filter((e) => bIds.has(e.artifactIdentity));
        const bJson = JSON.stringify(bBefore);
        const artifact = first.candidates.get("A")!.artifacts[0]!;
        const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
        if (side === "local") await fs.writeFile(path.join(r.h.archive, key), Buffer.alloc(artifact.byteLength));
        else { const node = r.deps.ledger.state.driveNodes.get(`${r.deps.ledger.state.installation!.drive!.destinationRevision}|${key}`)!; r.fakes!.drive.corrupt(node.fileId); }
        const summary = await r.runner.run(await r.claim([pairDoc("A")], 2));
        expect(summary.counts!.verified).toBe(2);
        expect(JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => bIds.has(e.artifactIdentity)))).toBe(bJson);
        const selected = [...r.deps.ledger.state.manualAttempts!.values()][1]!;
        expect(selected.aggregate!.payload.counts.selected).toBe(1);
    });
    it("source-open fence loss stops both destinations and later documents", async () => {
        const r = current = await rig(true);
        const options = await r.claim([pairDoc("A"), pairDoc("B")]);
        options.exportPort.openArtifact = jest.fn(async () => { throw new ExecutionFencedError("lease-lost"); });
        const requests = r.fakes!.drive.requests.length;
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(options.exportPort.openArtifact).toHaveBeenCalledTimes(1);
        expect(r.fakes!.drive.requests).toHaveLength(requests);
        const result = attemptOf(r).results.get("B")!.payload;
        expect(result.local.reasons).toContain("not-attempted"); expect(result.drive.reasons).toContain("not-attempted");
    });
    it.each(["publishArtifact", "quarantineCorrupt", "publishJson"] as const)("typed loss at local %s escapes to the single stop boundary", async method => {
        const r = current = await rig(true);
        if (method === "quarantineCorrupt") {
            await r.runner.run(await r.claim());
            const artifact = attemptOf(r).candidates.get("A")!.artifacts[0]!;
            const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
            await fs.writeFile(path.join(r.h.archive, key), Buffer.alloc(artifact.byteLength));
        }
        const options = await r.claim([pairDoc("A"), pairDoc("B")], method === "quarantineCorrupt" ? 2 : 1);
        jest.spyOn(LocalDestination.prototype, method).mockRejectedValueOnce(new ExecutionFencedError("lease-lost"));
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(r.deps.ledger.state.completions.size).toBe(0);
        const attempt = [...r.deps.ledger.state.manualAttempts!.values()].at(-1)!;
        expect(attempt.aggregate!.payload.status).toBe("blocked");
    });
    it.each(["local", "drive"] as const)("active %s failure preserves the independent destination result", async side => {
        const r = current = await rig(true);
        const options = await r.claim();
        if (side === "local") jest.spyOn(LocalDestination.prototype, "publishArtifact").mockResolvedValue({ ok: false, reasonCode: "archive-unavailable" });
        else r.fakes!.drive.setQuotaExceeded(true);
        const summary = await r.runner.run(options);
        const result = attemptOf(r).results.get("A")!.payload;
        expect(result[side === "local" ? "drive" : "local"].state).toBe("verified");
        expect(result[side].state).not.toBe("verified");
        expect(summary.snapshotStatus).toBe("partial");
    });
    it("configured but unready Drive remains attention instead of not_required", async () => {
        const r = current = await rig(true);
        r.deps.ledger.state.installation!.drive!.status = "pending";
        await r.runner.run(await r.claim());
        expect(attemptOf(r).results.get("A")!.payload.drive.state).toBe("blocked");
        expect(attemptOf(r).aggregate!.payload.counts.attention).toBe(1);
    });
    it("control append failure preserves the journal and never fabricates a receipt or completion", async () => {
        const r = current = await rig();
        const options = await r.claim();
        const append = r.deps.ledger.append.bind(r.deps.ledger);
        jest.spyOn(r.deps.ledger, "append").mockImplementation(async (type, body, at) => {
            if (type === "manual_result_ready") throw new WorkerError("control-unavailable");
            return (append as (...args: Parameters<LedgerStore["append"]>) => ReturnType<LedgerStore["append"]>)(type, body, at);
        });
        await expect(r.runner.run(options)).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        const attempt = attemptOf(r);
        expect(attempt.results.size).toBe(1); expect(attempt.aggregate).toBeNull();
        expect([...r.deps.ledger.state.runs.values()][0]!.status).toBe("open");
        expect(r.deps.ledger.state.completions.size).toBe(0);
        expect(r.deps.ledger.state.destinations.size).toBe(2);
    });
    it.each(["count", "revision", "hash", "duplicate"])("invalid complete %s claim is refused before every effect", async defect => {
        const r = current = await rig(true);
        const options = await r.claim();
        if (defect === "count") options.snapshot.counts.included++;
        else if (defect === "revision") options.snapshot.scopeRevision = "ordinary";
        else if (defect === "hash") { options.selection.candidates[0]!.artifacts[0]!.sha256 = "0".repeat(64); options.executionScope.selectionDigest = manualSelectionDigest(options.selection); }
        else options.selection.candidates.push(options.selection.candidates[0]!);
        const before = await snapshotTree(r.h.base);
        const seq = r.deps.ledger.lastSeq;
        const driveRequests = r.fakes!.drive.requests.length;
        const create = jest.spyOn(r.deps, "createDestination");
        await expect(r.runner.run(options)).rejects.toMatchObject({ reasonCode: "export-response-invalid" });
        expect(create).not.toHaveBeenCalled(); expect(r.deps.ledger.lastSeq).toBe(seq);
        expect(r.fakes!.drive.requests).toHaveLength(driveRequests);
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
        expect(await snapshotTree(r.h.base)).toEqual(before);
    });
    it.each(["chunk", "retry"] as const)("Drive %s loss stops the next HTTP effect and leaves durable unattempted receipts", async when => {
        const r = current = await rig(true);
        const options = await r.claim([pairDoc("A", "large".repeat(60000)), pairDoc("B")]);
        let lost = false;
        let requestsAtLoss = 0;
        const putsBefore = r.fakes!.drive.requests.filter((q) => q.method === "PUT").length;
        options.fence.assertActive = jest.fn(async id => {
            expect(id === undefined || id === "A" || id === "B").toBe(true);
            if (lost) throw new ExecutionFencedError("lease-lost");
        });
        r.fakes!.drive.addFault({ route: "uploadPut", times: 1, match: () => { lost = true; requestsAtLoss = r.fakes!.drive.requests.length; return when === "retry"; },
            action: { type: "status", status: 503 } });
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(r.fakes!.drive.requests.filter((q) => q.method === "PUT")).toHaveLength(putsBefore + 1);
        expect(r.fakes!.drive.requests).toHaveLength(requestsAtLoss);
        const attempt = attemptOf(r);
        expect(attempt.results.size).toBe(2);
        expect(attempt.results.get("B")!.payload.drive.reasons).toContain("not-attempted");
        expect(attempt.aggregate!.payload.counts.driveVerified).toBe(0);
        expect(r.deps.ledger.state.completions.size).toBe(0);
    });
    it("staging-aside rename checks the document fence immediately before the rename", async () => {
        const r = current = await rig();
        const first = await r.claim();
        await r.runner.run(first);
        const options = await r.claim([pairDoc("A")], 2);
        const artifact = options.selection.candidates[0]!.artifacts[0]!;
        const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
        await fs.rm(path.join(r.h.archive, key));
        await fs.writeFile(path.join(r.h.control, "staging", `${artifact.artifactIdentity}.bin`), Buffer.alloc(1));
        let lost = false;
        const lstat = fs.lstat.bind(fs);
        jest.spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
            if (String(args[0]).includes(".corrupt-")) lost = true;
            return lstat(...args);
        }) as typeof fs.lstat);
        options.fence.assertActive = jest.fn(async () => { if (lost) throw new ExecutionFencedError("lease-lost"); });
        const rename = jest.spyOn(fs, "rename");
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(lost).toBe(true);
        expect(rename).not.toHaveBeenCalled();
        expect(options.exportPort.openArtifact).not.toHaveBeenCalled();
    });
    it("an abort during an open source stream stops staging and later source opens", async () => {
        const r = current = await rig();
        const options = await r.claim([pairDoc("A"), pairDoc("B")]);
        const controller = new AbortController(); options.fence.signal = controller.signal;
        options.exportPort.openArtifact = jest.fn(async () => (async function* () {
            yield Buffer.from("%PDF-1.4\n"); controller.abort("synthetic private reason"); yield Buffer.alloc(100);
        })());
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        expect(options.exportPort.openArtifact).toHaveBeenCalledTimes(1);
        expect(attemptOf(r).aggregate!.payload.reasons).toContain("aborted");
        expect(JSON.stringify(ledgerStateToJson(r.deps.ledger.state))).not.toContain("synthetic private reason");
    });

    it("bounds safe reason unions while preserving the stop reason and complete selected receipts", async () => {
        const r = current = await rig();
        const options = await r.claim([pairDoc("A"), pairDoc("B")]);
        for (const candidate of options.selection.candidates) candidate.reasons = Array.from({ length: 64 }, (_, i) => `${candidate.documentId}-reason-${i}`);
        options.executionScope.selectionDigest = manualSelectionDigest(options.selection);
        options.fence.assertActive = jest.fn(async () => { throw new ExecutionFencedError("lease-lost"); });
        const summary = await r.runner.run(options);
        expect(summary.snapshotStatus).toBe("blocked");
        const attempt = attemptOf(r);
        expect(attempt.results.size).toBe(2);
        expect(attempt.aggregate!.payload.reasons).toHaveLength(64);
        expect(attempt.aggregate!.payload.reasons).toEqual(expect.arrayContaining(["coverage-unverified", "lease-lost"]));
        for (const result of attempt.results.values()) expect(result.payload.reasons).toContain("lease-lost");
    });
    it("a ready receipt survives a failed finish and duplicate delivery performs no writes", async () => {
        const r = current = await rig();
        const options = await r.claim();
        const append = r.deps.ledger.append.bind(r.deps.ledger);
        jest.spyOn(r.deps.ledger, "append").mockImplementation(async (type, body, at) => {
            if (type === "run_finished") throw new WorkerError("control-unavailable");
            return (append as (...args: Parameters<LedgerStore["append"]>) => ReturnType<LedgerStore["append"]>)(type, body, at);
        });
        await expect(r.runner.run(options)).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        const ready = attemptOf(r).aggregate!;
        const seq = r.deps.ledger.lastSeq;
        const opened = (options.exportPort.openArtifact as jest.Mock).mock.calls.length;
        const duplicate = await r.runner.run(options);
        expect(duplicate.manualReceipt).toEqual({ runId: ready.payload.runId, receiptId: ready.payload.receiptId, digest: ready.digest });
        expect(duplicate.counts).toMatchObject({ candidates: 1, included: 1, verified: 2 });
        expect(r.deps.ledger.lastSeq).toBe(seq);
        expect(options.exportPort.openArtifact).toHaveBeenCalledTimes(opened);
    });

    it("a stale local verified bit during archive outage cannot prevent independent Drive acquisition", async () => {
        const r = current = await rig(true);
        await r.runner.run(await r.claim());
        for (const artifact of attemptOf(r).candidates.get("A")!.artifacts) {
            await fs.rm(path.join(r.h.control, "staging", `${artifact.artifactIdentity}.bin`));
            const key = artifactKey({ companyId: "C001", documentId: "A", artifactType: artifact.artifactType, sha256: artifact.sha256 });
            const node = r.deps.ledger.state.driveNodes.get(`${r.deps.ledger.state.installation!.drive!.destinationRevision}|${key}`)!;
            r.fakes!.drive.trash(node.fileId);
        }
        jest.spyOn(LocalDestination.prototype, "checkArchive").mockResolvedValue({ ok: false, reasonCode: "archive-unavailable" });
        const options = await r.claim([pairDoc("A")], 2);
        const summary = await r.runner.run(options);
        expect(summary.counts).toMatchObject({ verified: 0, driveVerified: 2 });
        expect(options.exportPort.openArtifact).toHaveBeenCalledTimes(2);
        const latest = [...r.deps.ledger.state.manualAttempts!.values()].at(-1)!;
        expect(latest.results.get("A")!.payload.drive.state).toBe("verified");
        expect(latest.results.get("A")!.payload.local.state).toBe("blocked");
    });

});

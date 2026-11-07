import path from "node:path";

import { MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { artifactKey, buildManifest, manifestKey, WorkerError } from "domain/eformsign-backup/worker";
import { manualSelectionDigest, type ManualSelection } from "domain/eformsign-backup/worker/manual-protocol";
import { DriveDestination } from "infrastructure/eformsign-backup/worker/drive-destination";
import { ExportClient } from "infrastructure/eformsign-backup/worker/export-client";
import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";
import { DestinationLedger } from "infrastructure/eformsign-backup/worker/runner-common";
import { writeOutbox } from "infrastructure/eformsign-backup/worker/drive-outbox";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";
import { restoreDrive } from "infrastructure/eformsign-backup/worker/restore-drive";
import { WorkerRunner, controlMarkerWriter } from "infrastructure/eformsign-backup/worker/runner";
import type { ManualRunOptions, RunnerDependencies } from "infrastructure/eformsign-backup/worker/runner-types";

import { probeFor } from "./helpers/destination-support";
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

async function localRestore(r: Rig, name: string) {
    return restoreFromArchive({ archivePath: r.h.archive, companyId: "C001", selector: { latest: true }, outDir: path.join(r.h.base, name) });
}
async function driveRestore(r: Rig, name: string) {
    const target = path.join(r.h.base, name);
    const report = await restoreDrive({ client: r.deps.drive!.kind === "ready" ? r.deps.drive!.client : null as never,
        archiveId: r.h.config.archive.archiveId, archivePath: r.h.archive, controlPath: r.h.control, outDir: target,
        rootFolderId: r.deps.ledger.state.installation!.drive!.rootFolderId });
    const restored = await restoreFromArchive({ archivePath: target, companyId: "C001", selector: { latest: true }, outDir: path.join(r.h.base, `${name}-files`) });
    return { report, restored };
}

/** Stray old-A and B work belongs to an earlier open ordinary run and must stay byte-identical. */
async function excludedWork(r: Rig) {
    const fixture = await r.claim([pairDoc("A", "stray-old-A"), pairDoc("B", "stray-B")], 42);
    const runId = runIdOf(700);
    const at = r.h.clock.now().toISOString();
    await r.deps.ledger.append("run_started", { runId, scheduledFor: null, startedAt: at }, at);
    await r.deps.ledger.append("snapshot_bound", { runId, snapshotId: "stray-snapshot", sequence: 50,
        scopeRevision: fixture.selection.scopeRevision, policyRevision: fixture.selection.policyRevision, counts: fixture.snapshot.counts }, at);
    const dl = new DestinationLedger(r.deps, r.deps.ledger.state.installation!);
    const drive = new DestinationLedger(r.deps, r.deps.ledger.state.installation!, r.deps.ledger.state.installation!.drive!);
    for (const candidate of fixture.selection.candidates) {
        await r.deps.ledger.append("candidate_observed", { snapshotId: "stray-snapshot", ordinal: candidate.ordinal,
            documentId: candidate.documentId, classification: candidate.classification, metadataRevision: candidate.metadataRevision, artifacts: candidate.artifacts }, at);
        for (const [index, artifact] of candidate.artifacts.entries()) {
            const key = artifactKey({ companyId: "C001", documentId: candidate.documentId, artifactType: artifact.artifactType, sha256: artifact.sha256 });
            await dl.transition(artifact.artifactIdentity, "pending");
            if (index === 0) await dl.transition(artifact.artifactIdentity, "transferring", { relativeKey: key });
            await drive.transition(artifact.artifactIdentity, "pending");
        }
        const built = buildManifest({ companyId: "C001", documentId: candidate.documentId, metadataRevision: candidate.metadataRevision, artifacts: candidate.artifacts });
        const key = manifestKey({ companyId: "C001", documentId: candidate.documentId, metadataRevision: candidate.metadataRevision, manifestSha256: built.sha256 });
        // Deliberately missing on disk, yet bound in the shared ledger: manual execution must not repair it.
        await r.deps.ledger.append("manifest_published", { relativeKey: key, sha256: built.sha256 }, at);
        if (candidate.documentId === "B") {
            await writeOutbox(r.h.control, built.bytes);
            await r.deps.ledger.append("drive_record_pending", { destinationRevision: r.deps.ledger.state.installation!.drive!.destinationRevision,
                relativeKey: key, sha256: built.sha256 }, at);
        }
    }
    const openManualId = runIdOf(701);
    const scope = { ...fixture.executionScope, jobId: runIdOf(702), attemptId: `${runIdOf(702)}.attempt-1` };
    await r.deps.ledger.append("run_started", { runId: openManualId, scheduledFor: null, startedAt: at, executionScope: scope }, at);
    const ids = new Set(fixture.selection.candidates.flatMap((c) => c.artifacts.map((a) => a.artifactIdentity)));
    return { runId, openManualId, ids };
}

describe("manual execution preserves company restore selection", () => {
    it("touches only selected A, preserves old A/B completion locally and on Drive, and leaves the next daily run ordinary", async () => {
        const r = current = await rig(true);
        r.h.api.docs = [pairDoc("A", "baseline-A"), pairDoc("B", "baseline-B")];
        const daily = await r.runner.run({ scheduledFor: "2026-11-05T01:00:00Z" });
        expect(daily).not.toHaveProperty("manualReceipt");
        expect(Object.keys(daily).sort()).toEqual(["counts", "historicalCoverage", "outcome", "reasonCodes", "runId", "sequence", "snapshotId", "snapshotStatus"]);
        const beforeLocal = await localRestore(r, "before-local");
        const beforeDrive = await driveRestore(r, "before-drive");
        expect(beforeLocal.documents.map((d) => d.documentId)).toEqual(["A", "B"]);
        expect(beforeDrive.restored.documents).toEqual(beforeLocal.documents);
        const excluded = await excludedWork(r);
        const excludedBefore = JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => excluded.ids.has(e.artifactIdentity)));
        const pendingBefore = [...r.deps.ledger.state.driveRecordsPending];
        const completionsBefore = [...r.deps.ledger.state.completions];
        const driveRecordsBefore = [...r.deps.ledger.state.driveRecords].filter(([key]) => /completions|runs/.test(key));
        const baselineArtifacts = new Set([...r.deps.ledger.state.destinations.values()].filter((e) => e.state === "verified").map((e) => e.artifactIdentity));
        const baselineBefore = JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => baselineArtifacts.has(e.artifactIdentity)));
        const options = await r.claim([pairDoc("A", "manual-new-A")]);
        const check = options.fence.assertActive;
        options.fence.assertActive = jest.fn(async doc => { expect(doc === undefined || doc === "A").toBe(true); await check(doc); });
        const localCalls = jest.spyOn(LocalDestination.prototype, "reverify");
        const quarantine = jest.spyOn(LocalDestination.prototype, "quarantineCorrupt");
        const summary = await r.runner.run(options);
        expect(summary.counts).toMatchObject({ candidates: 1, included: 1, verified: 2, driveVerified: 2, terminalUnavailable: 0, integrityError: 0 });
        expect([...r.deps.ledger.state.completions]).toEqual(completionsBefore);
        expect([...r.deps.ledger.state.driveRecords].filter(([key]) => /completions|runs/.test(key))).toEqual(driveRecordsBefore);
        expect([...r.deps.ledger.state.driveRecordsPending]).toEqual(pendingBefore);
        expect(JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => excluded.ids.has(e.artifactIdentity)))).toBe(excludedBefore);
        expect(JSON.stringify([...r.deps.ledger.state.destinations.values()].filter((e) => baselineArtifacts.has(e.artifactIdentity)))).toBe(baselineBefore);
        expect(r.deps.ledger.state.runs.get(excluded.runId)!.status).toBe("open");
        expect(r.deps.ledger.state.runs.get(excluded.openManualId)!.status).toBe("open");
        expect(localCalls.mock.calls.every(([key]) => key.includes("/A/"))).toBe(true);
        expect(quarantine).not.toHaveBeenCalled();
        expect(options.exportPort.createSnapshot).not.toHaveBeenCalled(); expect(options.exportPort.getSnapshot).not.toHaveBeenCalled();
        expect(options.exportPort.listCandidates).not.toHaveBeenCalled();
        expect(r.h.api.requests.every((request) => request.url.includes("/artifacts/"))).toBe(true);
        const afterLocal = await localRestore(r, "after-local");
        const afterDrive = await driveRestore(r, "after-drive");
        expect(afterLocal).toEqual(beforeLocal);
        expect(afterDrive.restored).toEqual(beforeDrive.restored);
        expect(afterDrive.report.failed).toBe(0);
        const receipt = [...r.deps.ledger.state.manualAttempts!.values()].find((a) => a.aggregate)!.aggregate!;
        const receiptBytes = JSON.stringify(receipt);
        // Ordinary cleanup may finish company work, but must leave the earlier manual attempt open.
        r.h.api.docs = [pairDoc("A", "daily-next-A"), pairDoc("B", "baseline-B")];
        const next = await r.runner.run();
        expect(next).not.toHaveProperty("manualReceipt");
        expect(next.sequence!).toBeGreaterThan(summary.sequence!);
        expect(r.deps.ledger.state.runs.get(excluded.openManualId)!.status).toBe("open");
        expect(r.deps.ledger.state.runs.get(excluded.runId)!.status).toBe("finished");
        expect(JSON.stringify([...r.deps.ledger.state.manualAttempts!.values()].find((a) => a.aggregate)!.aggregate)).toBe(receiptBytes);
        const nextRestore = await localRestore(r, "next-local");
        expect(nextRestore.snapshotId).toBe(next.snapshotId);
        expect(nextRestore.documents.map((d) => d.documentId)).toEqual(["A", "B"]);
        expect(nextRestore.documents.find((d) => d.documentId === "A")!.artifacts).not.toEqual(beforeLocal.documents[0]!.artifacts);
    });
    it("Drive-only manual publication leaves the original company completion as the restore default", async () => {
        const r = current = await rig(true);
        r.h.api.docs = [pairDoc("A", "baseline-A"), pairDoc("B", "baseline-B")];
        const baseline = await r.runner.run();
        const completionRecords = [...r.deps.ledger.state.driveRecords].filter(([key]) => /completions|runs/.test(key));
        const options = await r.claim([pairDoc("A", "drive-only-new-A")]);
        jest.spyOn(LocalDestination.prototype, "publishArtifact").mockResolvedValue({ ok: false, reasonCode: "archive-unavailable" });
        const result = await r.runner.run(options);
        expect(result.counts).toMatchObject({ verified: 0, driveVerified: 2 });
        expect([...r.deps.ledger.state.driveRecords].filter(([key]) => /completions|runs/.test(key))).toEqual(completionRecords);
        expect(r.deps.ledger.state.completions.size).toBe(1);
        const restored = await driveRestore(r, "drive-only-restore");
        expect(restored.restored.snapshotId).toBe(baseline.snapshotId);
        expect(restored.restored.documents.map((d) => d.documentId)).toEqual(["A", "B"]);
        expect(attemptOf(r).aggregate!.payload.counts).toMatchObject({ selected: 1, localVerified: 0, driveVerified: 1, attention: 1 });
    });
});

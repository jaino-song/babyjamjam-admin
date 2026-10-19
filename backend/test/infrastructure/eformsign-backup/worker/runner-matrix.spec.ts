import { promises as fs } from "node:fs";
import path from "node:path";

import { FS_TYPE_EXT4, type FsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";

import {
    archivePdfs, createHarness, destroyHarness, initArchive, listFiles, lockedProbe, pairDoc, readLedgerRecords, runOnce,
    transitionPath, treeSignature, tryRun, type Harness,
} from "./helpers/runner-support";

const MIB = 1024 * 1024;

async function swapArchive(h: Harness): Promise<string> {
    const away = `${h.archive}.away`;
    await fs.rename(h.archive, away);
    await fs.mkdir(h.archive, { mode: 0o700 });
    return away;
}
async function swapBack(h: Harness, away: string): Promise<void> {
    await fs.rename(h.archive, `${h.archive}.new`);
    await fs.rename(away, h.archive);
}

/** Free space per volume: the control path gets `controlFreeBytes`, everything else is roomy. */
function probeWith(h: Harness, controlFreeBytes: number, archiveFreeBytes = 4 * 1024 * MIB): FsProbe {
    const locks = lockedProbe(h.lockPath);
    return {
        readProcLocks: locks.readProcLocks,
        statfs: async (target) => ({
            type: FS_TYPE_EXT4, bsize: 4096, ffree: 1_000_000,
            bavail: Math.floor((target.startsWith(h.control) ? controlFreeBytes : archiveFreeBytes) / 4096),
        }),
    };
}

describe("T-WRK-10: failure matrix (V08)", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });
    const docs = () => [pairDoc("D001"), pairDoc("D002")];

    it("should stage and block while the archive is gone, keep staging and download nothing new, then publish from staging once it is back", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        const away = await swapArchive(h);
        const awayBefore = await treeSignature(away);

        // matrix row 3: control fine, no staged bytes, archive broken: download and stage, then blocked.
        const first = await runOnce(h);

        expect(first).toMatchObject({ snapshotStatus: "blocked", counts: { blocked: 4, verified: 0 } });
        expect(first.reasonCodes).toContain("archive-unavailable");
        expect(h.api.artifactRequests()).toHaveLength(4);
        expect((await fs.readdir(path.join(h.control, "staging"))).filter((name) => name.endsWith(".bin"))).toHaveLength(4);
        const states = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition");
        expect(states.filter((record) => record.body["to"] === "blocked").every((record) => record.body["reasonCode"] === "archive-unavailable")).toBe(true);
        // Root fallback is 0: nothing in the new directory, nothing changed in the real archive, no inventory.
        expect(await listFiles(h.archive)).toEqual([]);
        expect(await treeSignature(away)).toBe(awayBefore);

        // matrix row 2: staged bytes exist: no new download, staging kept, still blocked.
        const second = await runOnce(h);
        expect(second.snapshotStatus).toBe("blocked");
        expect(h.api.artifactRequests()).toHaveLength(4);
        expect(await listFiles(h.archive)).toEqual([]);

        await swapBack(h, away);
        const third = await runOnce(h);
        expect(third).toMatchObject({ snapshotStatus: "partial", counts: { verified: 4, blocked: 0 } });
        expect(h.api.artifactRequests()).toHaveLength(4);
        expect(await archivePdfs(h.archive)).toHaveLength(4);
        // The earlier states are history: every artifact went blocked -> pending -> ... -> verified.
        const sample = (await readLedgerRecords(h.control)).find((record) => record.type === "candidate_observed")!;
        const identity = (sample.body["artifacts"] as Array<{ artifactIdentity: string }>)[0]!.artifactIdentity;
        expect(await transitionPath(h.control, identity)).toEqual(
            ["pending", "transferring", "blocked", "pending", "transferring", "verifying", "verified"]);
    });

    it.each([
        ["read-only archive", async (x: Harness) => { await fs.chmod(x.archive, 0o500); }, async (x: Harness) => { await fs.chmod(x.archive, 0o700); }, undefined],
        ["missing marker", async (x: Harness) => { await fs.rename(path.join(x.archive, ".bjj-backup"), path.join(x.base, "marker.away")); }, async (x: Harness) => { await fs.rename(path.join(x.base, "marker.away"), path.join(x.archive, ".bjj-backup")); }, undefined],
    ])("should block with archive-unavailable and write nothing for a %s", async (_name, break_, repair) => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        await break_(h);

        const first = await runOnce(h);

        expect(first.snapshotStatus).toBe("blocked");
        expect(first.reasonCodes).toContain("archive-unavailable");
        await repair(h);
        expect(await archivePdfs(h.archive)).toHaveLength(0);
        const second = await runOnce(h);
        expect(second.counts).toMatchObject({ verified: 4, blocked: 0 });
        expect(h.api.artifactRequests()).toHaveLength(4);
    });

    it("should block with archive-unavailable when the archive volume has no room left", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        const first = await runOnce(h, { probe: probeWith(h, 4 * 1024 * MIB, 10 * MIB) });
        expect(first).toMatchObject({ snapshotStatus: "blocked", counts: { blocked: 4 } });
        expect(first.reasonCodes).toContain("archive-unavailable");
        expect(await archivePdfs(h.archive)).toHaveLength(0);
        const second = await runOnce(h);
        expect(second.counts).toMatchObject({ verified: 4 });
    });

    it("should replace the archive in the middle of a run: blocked, staging kept, nothing written to the new directory", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        let away = "";
        const summary = await runOnce(h, { runnerFault: async (point) => { if (point === "after-transferring" && away === "") away = await swapArchive(h); } });

        expect(summary.snapshotStatus).toBe("blocked");
        expect(summary.reasonCodes).toContain("archive-unavailable");
        expect(await listFiles(h.archive)).toEqual([]);
        expect(await archivePdfs(away)).toHaveLength(0);
        expect((await fs.readdir(path.join(h.control, "staging"))).filter((name) => name.endsWith(".bin")).length).toBeGreaterThan(0);

        await swapBack(h, away);
        const again = await runOnce(h);
        expect(again.counts).toMatchObject({ verified: 4, blocked: 0 });
        expect(h.api.artifactRequests()).toHaveLength(4);
    });

    it("should catch a file damaged between publish and the re-read: renamed aside, integrity_error, no manifest, republished from staging next run", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        let damaged = "";
        const summary = await runOnce(h, {
            runnerFault: async (point) => {
                if (point !== "after-publish-before-verifying" || damaged !== "") return;
                damaged = path.join(h.archive, (await archivePdfs(h.archive))[0]!);
                const bytes = await fs.readFile(damaged);
                bytes[20] = bytes[20]! ^ 0xff;
                await fs.writeFile(damaged, bytes);
            },
        });

        expect(summary.counts).toMatchObject({ verified: 3, integrityError: 1 });
        expect((await fs.readdir(path.dirname(damaged))).filter((name) => name.includes(".corrupt-"))).toHaveLength(1);
        expect((await listFiles(h.archive)).filter((file) => file.includes("/manifests/"))).toHaveLength(1);

        const next = await runOnce(h);

        expect(next.counts).toMatchObject({ verified: 4, integrityError: 0 });
        expect(h.api.artifactRequests()).toHaveLength(4);
        expect(await archivePdfs(h.archive)).toHaveLength(4);
        expect((await listFiles(h.archive)).filter((file) => file.includes("/manifests/"))).toHaveLength(2);
    });

    it("should keep an artifact pending, not download it, when the archive is broken and the control side has no room to stage", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        const away = await swapArchive(h);

        const summary = await runOnce(h, { probe: probeWith(h, 50 * MIB) });

        expect(h.api.artifactRequests()).toHaveLength(0);
        expect(summary.reasonCodes).toContain("archive-unavailable");
        expect(summary.counts).toMatchObject({ blocked: 0, verified: 0 });
        await swapBack(h, away);
        const recovered = await runOnce(h);
        expect(recovered.counts).toMatchObject({ verified: 4 });
    });

    it("should block control-space artifacts without downloading (staging stops first, the ledger keeps writing) and resume when room is back", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);

        const first = await runOnce(h, { probe: probeWith(h, 50 * MIB) });

        expect(h.api.artifactRequests()).toHaveLength(0);
        expect(first).toMatchObject({ snapshotStatus: "blocked", counts: { blocked: 4 } });
        expect(first.reasonCodes).toContain("control-space");
        expect(await listFiles(h.archive).then((files) => files.filter((file) => file.includes("/runs/")))).toHaveLength(1);

        const second = await runOnce(h);
        expect(second.counts).toMatchObject({ verified: 4, blocked: 0 });
    });

    it("should stop safely with control-space when even the ledger's share of the reserve is gone, before any work", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        const error = await tryRun(h, { probe: probeWith(h, 10 * MIB) });
        expect(error).toMatchObject({ reasonCode: "control-space" });
        expect(h.api.requests).toHaveLength(0);
    });

    it("should stop everything on a ledger write failure: no new download, no archive record, and converge on the next start", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        let fired = false;
        const error = await tryRun(h, {
            ledgerFault: (point) => {
                if (point === "before-fsync" && !fired && h.api.artifactRequests().length >= 1) {
                    fired = true;
                    throw Object.assign(new Error("EIO"), { code: "EIO" });
                }
            },
        });

        expect(error).toMatchObject({ reasonCode: "control-unavailable" });
        expect(h.api.artifactRequests()).toHaveLength(1);
        const files = await listFiles(h.archive);
        expect(files.filter((file) => /completions|runs|manifests/.test(file))).toEqual([]);
        expect(await archivePdfs(h.archive)).toHaveLength(0);

        const next = await runOnce(h);
        expect(next.counts).toMatchObject({ verified: 4 });
        const finished = (await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished");
        expect(finished[0]!.body).toMatchObject({ snapshotStatus: "failed", reasonCodes: ["crashed"] });
        expect(await archivePdfs(h.archive)).toHaveLength(4);
    });

    it("should never create anything outside control and archive when the archive is unusable (root fallback 0)", async () => {
        h = await createHarness({ docs: docs() });
        await initArchive(h);
        const away = await swapArchive(h);
        await runOnce(h);
        await runOnce(h);
        expect((await fs.readdir(h.base)).sort()).toEqual(["archive", "archive.away", "control", "token", "worker.json"]);
        await swapBack(h, away);
    });
});

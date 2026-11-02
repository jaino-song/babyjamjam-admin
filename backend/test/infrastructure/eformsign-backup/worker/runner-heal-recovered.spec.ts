import { promises as fs } from "node:fs";
import path from "node:path";

import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { RunEndedWithFailure } from "infrastructure/eformsign-backup/worker/runner-run";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { MANIFEST_KEY, PDF_KEY, RUN_KEY, bindDrive, driveKeys, driveTree } from "./helpers/drive-run-support";
import { driveFaults } from "./helpers/fake-drive-server";
import {
    COMPANY, createHarness, destroyHarness, initArchive, listFiles, readLedgerRecords, runOnce, sha256Of, singleDoc, withWorker, type Harness,
} from "./helpers/runner-support";

const isDrive = (record: { body: Record<string, unknown> }): boolean => String(record.body["destinationIdentity"]).startsWith("drive:");

/**
 * Phase audit (BJJ-456 PF1): an artifact `recover` adopted has no length in the ledger. When the local archive copy and the staged
 * copy are then lost, the verified Drive copy must heal it, on the strength of a manifest that lists it.
 */
describe("BJJ-456 PF1: a recovered (length-less) artifact heals from its verified Drive copy", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    const records = async (type?: string) => (await readLedgerRecords(h.control)).filter((record) => type === undefined || record.type === type);
    const verifyAll = () => withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));

    async function ledgerState() {
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            return store.state;
        } finally {
            await store.close();
        }
    }
    /** The last state the local entry of an artifact reached (`recovered_verified` without a destination is the local one). */
    const localState = async (): Promise<{ state: string; reasonCode: unknown }> => {
        let last: { state: string; reasonCode: unknown } = { state: "none", reasonCode: null };
        for (const record of await records()) {
            if (record.type === "destination_transition" && !isDrive(record)) last = { state: String(record.body["to"]), reasonCode: record.body["reasonCode"] ?? null };
            if (record.type === "recovered_verified" && record.body["destinationIdentity"] === undefined) last = { state: "verified", reasonCode: null };
        }
        return last;
    };
    const driveState = async (): Promise<string> => {
        let last = "none";
        for (const record of await records()) {
            if (record.type === "destination_transition" && isDrive(record)) last = String(record.body["to"]);
            if (record.type === "recovered_verified" && isDrive(record)) last = "verified";
        }
        return last;
    };

    /**
     * One document, both destinations verified; the ledger is lost and rebuilt by `recover` (artifact length null); the local PDF and every staged
     * copy are gone and `verify --all` has turned the local entry non-terminal. The next run's snapshot does not contain the document.
     */
    async function lostLocalCopy(): Promise<{ localKey: string; manifestKey: string; manifestBytes: Buffer; pdf: Buffer }> {
        h = await createHarness({ docs: [singleDoc("D001")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);
        await runOnce(h);
        const installationId = JSON.parse(await fs.readFile(path.join(h.archive, ".bjj-backup/installation.json"), "utf8")).installationId as string;
        await fs.rename(path.join(h.control, "ledger"), path.join(h.base, "ledger.lost"));
        await withWorker(h, "recover", (worker) => worker.runner.recover({ installationId }));
        const state = await ledgerState();
        expect([...state.artifacts.values()].map((info) => info.byteLength)).toEqual([null]);

        const files = await listFiles(h.archive);
        const localKey = files.find((file) => PDF_KEY.test(`/${file}`))!;
        const manifestKey = files.find((file) => MANIFEST_KEY.test(`/${file}`))!;
        const pdf = await fs.readFile(path.join(h.archive, localKey));
        const manifestBytes = await fs.readFile(path.join(h.archive, manifestKey));
        await fs.rm(path.join(h.archive, localKey));
        for (const file of await listFiles(h.control)) if (file.endsWith(".bin")) await fs.rm(path.join(h.control, file));

        const summary = await verifyAll();
        expect(summary.integrityErrors).toBeGreaterThanOrEqual(1);
        expect((await localState()).state).toBe("integrity_error");
        expect(await driveState()).toBe("verified");
        h.api.docs = [];
        return { localKey, manifestKey, manifestBytes, pdf };
    }

    it("should download the verified Drive copy once, republish it locally and record no new gap", async () => {
        const lost = await lostLocalCopy();
        const gapsBefore = (await ledgerState()).gaps.length;
        const downloadsBefore = fakes.drive.downloads;

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await driveState()).toBe("verified");
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        const after = await ledgerState();
        expect(after.gaps.length).toBe(gapsBefore);
        // The manifest that lists it was on the archive already: it is neither rewritten nor replaced, and the ledger now binds it.
        expect(await fs.readFile(path.join(h.archive, lost.manifestKey))).toEqual(lost.manifestBytes);
        expect(after.manifests.get(lost.manifestKey)?.sha256).toBe(sha256Of(lost.manifestBytes));
        expect((await records()).filter((record) => record.type === "run_finished").pop()!.body["reasonCodes"]).not.toContain("ledger-inconsistent");
    }, 240_000);

    /** The artifact's staged copy as an interrupted run leaves it: the bytes in the staging directory and the ledger's record of them. */
    async function stageCopy(identity: string, bytes: Buffer, recordedSha256: string): Promise<void> {
        const staging = path.join(h.control, "staging");
        await fs.mkdir(staging, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(staging, `${identity}.bin`), bytes, { mode: 0o600 });
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            await store.append("staging_verified", { artifactIdentity: identity, sha256: recordedSha256, byteLength: bytes.byteLength }, new Date().toISOString());
        } finally {
            await store.close();
        }
    }

    it("should publish a hash-checked staged copy without any Drive download, and set a damaged one aside before healing from Drive", async () => {
        const lost = await lostLocalCopy();
        const [identity, info] = [...(await ledgerState()).artifacts.entries()][0]!;
        await stageCopy(identity, lost.pdf, info.sha256);
        const downloadsBefore = fakes.drive.downloads;

        await runOnce(h);

        expect(fakes.drive.downloads).toBe(downloadsBefore);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
    }, 240_000);

    it("should set a staged copy that does not hash to the artifact aside and heal from the verified Drive copy", async () => {
        const lost = await lostLocalCopy();
        const [identity, info] = [...(await ledgerState()).artifacts.entries()][0]!;
        const damaged = Buffer.from(lost.pdf);
        damaged.writeUInt8((damaged.readUInt8(damaged.length - 2) + 1) % 256, damaged.length - 2);
        await stageCopy(identity, damaged, info.sha256);
        const downloadsBefore = fakes.drive.downloads;

        await runOnce(h);

        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect((await listFiles(h.control)).filter((file) => file.includes(".bin.corrupt-"))).toHaveLength(1);
    }, 240_000);

    it("should keep the local outcome as it is today, and mark the Drive entry damaged, when the Drive bytes do not hash to the artifact", async () => {
        const lost = await lostLocalCopy();
        const driveFile = fakes.drive.nodes().find((node) => node.bytes !== null && node.name.endsWith(".pdf"))!;
        fakes.drive.corrupt(driveFile.id);

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "exact-bytes-unavailable" });
        expect(await driveState()).toBe("integrity_error");
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
    }, 240_000);

    it("should not crash on ledger-inconsistent, download nothing and end exact-bytes-unavailable when the archive manifest is gone too", async () => {
        const lost = await lostLocalCopy();
        await fs.rm(path.join(h.archive, lost.manifestKey));
        const downloadsBefore = fakes.drive.downloads;

        // The run still ends with the existing archive-conflict verdict for a bound manifest that is gone (everything else is recorded first).
        const ended = await runOnce(h).then(() => null, (error: unknown) => error);

        expect(ended).toBeInstanceOf(RunEndedWithFailure);
        expect(ended).toMatchObject({ reasonCode: "archive-conflict" });
        expect(fakes.drive.downloads).toBe(downloadsBefore);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "exact-bytes-unavailable" });
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
    }, 240_000);
});

describe("BJJ-456 PF1: the run's reasons carry the Drive reason of an inventory-only refusal", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    it("should report drive-unavailable (and stay partial) when only the run inventory upload fails", async () => {
        h = await createHarness({ docs: [singleDoc("D001")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);
        const base = fakes.drive.uploadsCompleted;
        // 1 PDF, the manifest and the completion are accepted; the fourth upload, the run inventory, is refused.
        fakes.drive.addFault({ route: "uploadStart", times: 1, match: () => fakes.drive.uploadsCompleted - base === 3, action: driveFaults.status(503) });

        const summary = await runOnce(h);

        expect(driveKeys(await driveTree(h, fakes), RUN_KEY)).toEqual([]);
        expect(summary.snapshotStatus).toBe("partial");
        expect(summary.reasonCodes).toContain("drive-unavailable");
        const finished = (await readLedgerRecords(h.control)).filter((record) => record.type === "run_finished").pop()!;
        expect(finished.body["reasonCodes"]).toContain("drive-unavailable");
        expect(finished.body["snapshotStatus"]).toBe("partial");
        const inventory = JSON.parse(await fs.readFile(path.join(h.archive, `eformsign/${COMPANY}/runs/${summary.runId}.json`), "utf8"));
        expect(inventory.reasonCodes).not.toContain("drive-unavailable");
    }, 240_000);
});

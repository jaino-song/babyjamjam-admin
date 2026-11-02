import { promises as fs } from "node:fs";
import path from "node:path";

import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { PDF_KEY, bindDrive } from "./helpers/drive-run-support";
import { driveFaults } from "./helpers/fake-drive-server";
import { createHarness, destroyHarness, initArchive, listFiles, readLedgerRecords, runOnce, singleDoc, tryRun, type Harness } from "./helpers/runner-support";

const isDrive = (record: { body: Record<string, unknown> }): boolean => String(record.body["destinationIdentity"]).startsWith("drive:");

/**
 * QA finding F3 (BJJ-456 Phase 3.4): bad export bytes for an artifact the local copy lost must never shut out a heal from the
 * verified Drive copy. "The copies heal each other": the export is only consulted while Drive cannot be asked, and a failed export
 * attempt (down to integrity-repeated) does not prevent a later heal from Drive.
 */
describe("BJJ-456 QF3: an export that keeps serving wrong bytes does not shut out the Drive heal", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    const records = async (type?: string) => (await readLedgerRecords(h.control)).filter((record) => type === undefined || record.type === type);
    async function ledgerState() {
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            return store.state;
        } finally {
            await store.close();
        }
    }
    const localState = async (): Promise<{ state: string; reasonCode: unknown }> => {
        let last: { state: string; reasonCode: unknown } = { state: "none", reasonCode: null };
        for (const record of await records()) {
            if (record.type === "destination_transition" && !isDrive(record)) last = { state: String(record.body["to"]), reasonCode: record.body["reasonCode"] ?? null };
        }
        return last;
    };
    const driveState = async (): Promise<string> => {
        let last = "none";
        for (const record of await records()) if (record.type === "destination_transition" && isDrive(record)) last = String(record.body["to"]);
        return last;
    };

    /** One document published (and mirrored when Drive is configured); its archive PDF and every staged copy are then deleted. */
    async function lostCopy(withDrive: boolean): Promise<{ localKey: string; pdf: Buffer }> {
        h = await createHarness({ docs: [singleDoc("D001")], ...(withDrive ? { config: { drive: fakes.config } as never } : {}) });
        await initArchive(h);
        if (withDrive) await bindDrive(h);
        await runOnce(h);
        const localKey = (await listFiles(h.archive)).find((file) => PDF_KEY.test(`/${file}`))!;
        const pdf = await fs.readFile(path.join(h.archive, localKey));
        await fs.rm(path.join(h.archive, localKey));
        for (const file of await listFiles(h.control)) if (file.endsWith(".bin")) await fs.rm(path.join(h.control, file));
        // The export keeps offering the artifact but serves other bytes of the same length.
        const wrong = Buffer.from(pdf);
        wrong.writeUInt8((wrong.readUInt8(wrong.length - 2) + 1) % 256, wrong.length - 2);
        h.api.addFault({ route: "artifact", times: 1000, fault: { kind: "bytes", bytes: wrong } });
        h.api.clearRequests();
        return { localKey, pdf };
    }

    it("should heal from the verified Drive copy once Drive answers again, after the export's wrong bytes ran the entry into integrity-repeated", async () => {
        const lost = await lostCopy(true);
        const gapsBefore = (await ledgerState()).gaps.length;
        const outage = fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });

        for (let attempt = 0; attempt < 3; attempt += 1) await tryRun(h);

        expect(outage.hits).toBeGreaterThanOrEqual(1);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
        fakes.drive.clearFaults();
        h.api.clearRequests();
        const downloadsBefore = fakes.drive.downloads;

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(h.api.artifactRequests()).toEqual([]);
        expect((await ledgerState()).gaps.length).toBe(gapsBefore);
        expect(await driveState()).toBe("verified");
        // The next run has nothing left to do for it.
        await runOnce(h);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(h.api.artifactRequests()).toEqual([]);
    }, 240_000);

    it("should heal a carried artifact (no longer in the snapshot) from Drive once it answers, after integrity-repeated", async () => {
        const lost = await lostCopy(true);
        fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });
        for (let attempt = 0; attempt < 3; attempt += 1) await tryRun(h);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        fakes.drive.clearFaults();
        h.api.docs = [];
        h.api.clearRequests();

        await runOnce(h);

        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(h.api.artifactRequests()).toEqual([]);
    }, 240_000);

    it("should stay blocked integrity-repeated, asking the export no more, while Drive cannot be asked", async () => {
        await lostCopy(true);
        fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });
        for (let attempt = 0; attempt < 3; attempt += 1) await tryRun(h);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        h.api.clearRequests();

        await tryRun(h);
        await tryRun(h);

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        expect(h.api.artifactRequests()).toEqual([]);
    }, 240_000);

    it("should heal in the same run when Drive answers before the export attempts are used up", async () => {
        const lost = await lostCopy(true);
        await runOnce(h);

        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(h.api.artifactRequests()).toEqual([]);
    }, 240_000);

    it("control: without any Drive copy, wrong export bytes still end blocked integrity-repeated and stay so", async () => {
        const lost = await lostCopy(false);

        for (let attempt = 0; attempt < 5; attempt += 1) await tryRun(h);

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
        const requests = h.api.artifactRequests().length;
        await tryRun(h);
        expect(h.api.artifactRequests().length).toBe(requests);
    }, 240_000);
});

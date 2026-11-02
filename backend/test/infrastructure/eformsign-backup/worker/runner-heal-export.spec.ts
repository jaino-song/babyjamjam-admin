import { promises as fs } from "node:fs";
import path from "node:path";

import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { PDF_KEY, bindDrive, swapArchive, swapBack } from "./helpers/drive-run-support";
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

    /** An exhausted entry (Drive down for three runs), then Drive answers; `after` says whether the next run's snapshot still lists the document. */
    async function exhaustedWithDriveBack(carried: boolean): Promise<Awaited<ReturnType<typeof lostCopy>> & { gapsBefore: number }> {
        const lost = await lostCopy(true);
        fakes.drive.addFault({ route: "*", action: driveFaults.status(503, "backendError") });
        for (let attempt = 0; attempt < 3; attempt += 1) await tryRun(h);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        fakes.drive.clearFaults();
        if (carried) h.api.docs = [];
        h.api.clearRequests();
        return { ...lost, gapsBefore: (await ledgerState()).gaps.length };
    }
    /** The staged copy a Drive heal just wrote is damaged before it is published (same length, other bytes). */
    const corruptStagedOnce = (): (point: string) => Promise<void> => {
        let done = false;
        return async (point) => {
            if (point !== "after-transferring" || done) return;
            for (const file of await listFiles(h.control)) {
                if (!file.endsWith(".bin")) continue;
                const target = path.join(h.control, file);
                const bytes = await fs.readFile(target);
                bytes.writeUInt8((bytes.readUInt8(bytes.length - 2) + 1) % 256, bytes.length - 2);
                await fs.writeFile(target, bytes);
                done = true;
            }
        };
    };

    it.each([["snapshot", false], ["carry", true]] as const)(
        "should keep an exhausted entry retryable, never ask the export and never record a gap, when the %s heal's staged copy is damaged (F1)",
        async (_name, carried) => {
            const lost = await exhaustedWithDriveBack(carried);

            await runOnce(h, { runnerFault: corruptStagedOnce() });

            expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
            expect(h.api.artifactRequests()).toEqual([]);
            expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
            await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });

            await runOnce(h);

            expect(await localState()).toEqual({ state: "verified", reasonCode: null });
            expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
            expect(h.api.artifactRequests()).toEqual([]);
            expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
        }, 240_000);

    /**
     * QF4 / M1: the entry is exhausted, heals from Drive into staging, and the archive goes away before the copy is published: the local
     * entry is now blocked archive-unavailable. The archive then comes back. Exhaustion is a property of the entry's history, not of its
     * current reason, so it must survive this intermediate state (and the ledger reopen every run does).
     */
    async function exhaustedThenArchiveOutage(carried: boolean): Promise<Awaited<ReturnType<typeof exhaustedWithDriveBack>>> {
        const lost = await exhaustedWithDriveBack(carried);
        let away: string | null = null;
        const outage = await tryRun(h, { runnerFault: async (point) => {
            if (point === "after-transferring" && away === null) away = await swapArchive(h);
        } });
        expect(outage).toMatchObject({ reasonCodes: expect.arrayContaining(["archive-unavailable"]) });
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
        expect(await driveState()).toBe("verified");
        await swapBack(h, away!);
        h.api.clearRequests();
        return lost;
    }
    const stagedBins = async (): Promise<string[]> => (await listFiles(h.control)).filter((file) => file.endsWith(".bin"));

    it("should keep an exhausted entry from asking the export after an archive outage, when its staged copy is lost and Drive cannot be asked (QF4 M1, snapshot)", async () => {
        const lost = await exhaustedThenArchiveOutage(false);
        for (const file of await stagedBins()) await fs.rm(path.join(h.control, file));
        const outage = fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });

        await tryRun(h);
        await tryRun(h);

        expect(outage.hits).toBeGreaterThanOrEqual(1);
        expect(h.api.artifactRequests()).toEqual([]);
        expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
        expect((await localState()).state).toBe("blocked");
        fakes.drive.clearFaults();

        await runOnce(h);

        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(h.api.artifactRequests()).toEqual([]);
        expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
    }, 240_000);

    it("should keep a carried exhausted entry retryable, never terminal and never a gap, when its staged copy is damaged after an archive outage (QF4 M1, carry)", async () => {
        const lost = await exhaustedThenArchiveOutage(true);

        await runOnce(h, { runnerFault: corruptStagedOnce() });

        expect(await localState()).toMatchObject({ state: "blocked" });
        expect((await localState()).reasonCode).not.toBe("exact-bytes-unavailable");
        expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
        expect(h.api.artifactRequests()).toEqual([]);

        await runOnce(h);

        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(h.api.artifactRequests()).toEqual([]);
        expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
    }, 240_000);

    it("should publish an exhausted entry's usable staged copy without downloading it from Drive again (QF4 L1)", async () => {
        const lost = await exhaustedThenArchiveOutage(false);
        expect(await stagedBins()).toHaveLength(1);
        const downloadsBefore = fakes.drive.downloads;

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(fakes.drive.downloads).toBe(downloadsBefore);
        expect(h.api.artifactRequests()).toEqual([]);
    }, 240_000);

    it("should count a carried exhausted entry whose Drive heal failed as blocked, and report its reason, like any carried artifact (F2)", async () => {
        const lost = await exhaustedWithDriveBack(true);
        fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });

        const summary = await runOnce(h);

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "integrity-repeated" });
        expect(summary.counts!.blocked).toBe(1);
        expect(summary.reasonCodes).toContain("integrity-repeated");
        expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
    }, 240_000);

    /**
     * QF5 / R6: the exhausted entry heals from Drive into staging and the run stops at after-transferring; the staged copy then disappears
     * and Drive cannot be asked. Interruption recovery moves the entry back to pending, so the failed attempt must be recorded and reported
     * (blocked with the Drive reason), not left as an unreported pending entry. The export is still never asked and no gap is recorded.
     */
    it.each([["snapshot", false], ["carry", true]] as const)(
        "should record and report an interrupted exhausted entry that cannot be restaged while Drive is down, then heal it when Drive answers (QF5, %s)",
        async (_name, carried) => {
            const lost = await exhaustedWithDriveBack(carried);
            const crash = new Error("synthetic interruption");
            await expect(runOnce(h, { runnerFault: async (point) => { if (point === "after-transferring") throw crash; } })).rejects.toBe(crash);
            expect(await localState()).toMatchObject({ state: "transferring" });
            for (const file of await stagedBins()) await fs.rm(path.join(h.control, file));
            const outage = fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });
            h.api.clearRequests();

            const summary = await runOnce(h);

            expect(outage.hits).toBeGreaterThanOrEqual(1);
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "drive-unavailable" });
            expect(summary.counts!.blocked).toBe(1);
            expect(summary.reasonCodes).toContain("drive-unavailable");
            expect(h.api.artifactRequests()).toEqual([]);
            expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);

            // The same outage on the next run changes nothing it has already recorded.
            const recorded = async (): Promise<number> => (await records("destination_transition"))
                .filter((record) => !isDrive(record) && record.body["reasonCode"] === "drive-unavailable").length;
            const before = await recorded();
            const again = await runOnce(h);
            expect(await recorded()).toBe(before);
            expect(again.counts!.blocked).toBe(1);
            expect(again.reasonCodes).toContain("drive-unavailable");

            fakes.drive.clearFaults();
            await runOnce(h);

            expect(await localState()).toEqual({ state: "verified", reasonCode: null });
            expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
            expect(h.api.artifactRequests()).toEqual([]);
            expect((await ledgerState()).gaps.length).toBe(lost.gapsBefore);
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

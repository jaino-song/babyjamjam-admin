import { promises as fs } from "node:fs";
import path from "node:path";

import { LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";
import { RunEndedWithFailure } from "infrastructure/eformsign-backup/worker/runner-run";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { MANIFEST_KEY, PDF_KEY, RUN_KEY, bindDrive, driveKeys, driveTree, swapArchive, swapBack } from "./helpers/drive-run-support";
import { driveFaults } from "./helpers/fake-drive-server";
import {
    COMPANY, createHarness, destroyHarness, initArchive, listFiles, readLedgerRecords, rewriteConfig, runOnce, sha256Of, singleDoc, withWorker, type Harness,
} from "./helpers/runner-support";
import type { RunSummary } from "infrastructure/eformsign-backup/worker/runner-types";

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

    const localVerifiedCount = async (): Promise<number> =>
        (await records("destination_transition")).filter((record) => !isDrive(record) && record.body["to"] === "verified").length;
    const drivePdfCount = (): number => fakes.drive.nodes().filter((node) => node.bytes !== null && node.name.endsWith(".pdf")).length;

    /**
     * PF1b: a temporary archive outage must not make the length-less artifact terminal. Phase audit scenario: the heal from Drive was
     * interrupted after staging (before the local publication), Drive was rebound, and the next run (empty snapshot) found the archive gone.
     */
    it("should record archive-unavailable, not the terminal exact-bytes-unavailable, during an archive outage, and heal once the archive is back", async () => {
        const lost = await lostLocalCopy();
        await expect(runOnce(h, { runnerFault: async (point) => { if (point === "after-transferring") throw new Error("interrupted-after-staging"); } }))
            .rejects.toThrow("interrupted-after-staging");
        expect((await localState()).state).toBe("transferring");
        await bindDrive(h, true);
        const gapsBefore = (await ledgerState()).gaps.length;
        const localBefore = await localVerifiedCount();
        const away = await swapArchive(h);

        const outage = await runOnce(h);

        expect(outage.reasonCodes).toContain("archive-unavailable");
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
        expect(await driveState()).toBe("verified");
        const pdfsAfterOutage = drivePdfCount();

        await swapBack(h, away);
        const downloadsBefore = fakes.drive.downloads;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const summary = await runOnce(h);
            expect(summary.outcome).toBe("finished");
            expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        }

        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(sha256Of(await fs.readFile(path.join(h.archive, lost.localKey)))).toBe(sha256Of(lost.pdf));
        expect(await fs.readFile(path.join(h.archive, lost.manifestKey))).toEqual(lost.manifestBytes);
        expect((await ledgerState()).manifests.get(lost.manifestKey)?.sha256).toBe(sha256Of(lost.manifestBytes));
        expect((await ledgerState()).gaps.length).toBe(gapsBefore);
        expect(await localVerifiedCount() - localBefore).toBe(1);
        expect(fakes.drive.downloads).toBe(downloadsBefore);
        expect(drivePdfCount()).toBe(pdfsAfterOutage);
        expect(await driveState()).toBe("verified");
    }, 240_000);

    it("should record archive-unavailable, not exact-bytes-unavailable, when the archive is lost while the manifests are being read", async () => {
        const lost = await lostLocalCopy();
        const manifestPath = path.join(h.archive, lost.manifestKey);
        await fs.chmod(manifestPath, 0o000);
        try {
            const outage = await runOnce(h).then((summary) => summary, (error: unknown) => error);

            expect(outage).not.toBeInstanceOf(Error);
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
        } finally {
            await fs.chmod(manifestPath, 0o600);
        }

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
    }, 240_000);

    /**
     * PB1 (e): a Drive that could not be asked is not an answer. A recovered (length-less) artifact whose verified Drive copy cannot be
     * downloaded right now (503) stays retryable, never the terminal exact-bytes-unavailable, and heals once Drive answers.
     */
    it("should keep a recovered artifact retryable, not terminal, while the verified Drive copy answers 503, then heal from it (PB1 e)", async () => {
        const lost = await lostLocalCopy();
        const gapsBefore = (await ledgerState()).gaps.length;
        const fault = fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });

        const outage = await runOnce(h).then((summary) => summary, (error: unknown) => error);

        expect(outage).toBeDefined();
        expect(fault.hits).toBeGreaterThanOrEqual(1);
        const during = await localState();
        expect(during.state).toBe("blocked");
        expect(during.reasonCode).toBe("drive-unavailable");
        expect((await ledgerState()).gaps.length).toBe(gapsBefore);
        expect(await driveState()).toBe("verified");
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });

        fakes.drive.clearFaults();
        const downloadsBefore = fakes.drive.downloads;
        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
    }, 240_000);

    /**
     * PF1c: the manifest listing that decides "no manifest lists this artifact" is complete-or-error, and the decision is taken against a
     * freshly checked archive. Faults are injected at the filesystem boundary; the runner, ledger, staging and publication are the real ones.
     */
    describe("PF1c: a negative manifest lookup needs a completed observation and a fresh archive check", () => {
        afterEach(() => { jest.restoreAllMocks(); });

        type Lost = Awaited<ReturnType<typeof lostLocalCopy>>;
        const manifestsDirOf = (lost: Lost): string => path.join(h.archive, path.dirname(lost.manifestKey));

        /** The directory's real listing is taken, `after` runs once (the archive changes), and the listing is handed back. */
        function afterListing(directory: string, after: () => Promise<void>): { listed: () => number } {
            const real = fs.readdir.bind(fs) as (...args: unknown[]) => Promise<unknown>;
            let listed = 0;
            jest.spyOn(fs, "readdir").mockImplementation((async (target: unknown, ...rest: unknown[]) => {
                const names = await real(target, ...rest);
                if (String(target) === directory && listed === 0) {
                    listed += 1;
                    await after();
                }
                return names;
            }) as never);
            return { listed: () => listed };
        }
        /** Every listing of `directory` fails with EIO while the fault is on; the archive root itself stays healthy. */
        function failListing(directory: string): { off: () => void; refused: () => number } {
            const real = fs.readdir.bind(fs) as (...args: unknown[]) => Promise<unknown>;
            let refused = 0;
            let on = true;
            jest.spyOn(fs, "readdir").mockImplementation((async (target: unknown, ...rest: unknown[]) => {
                if (on && String(target) === directory) {
                    refused += 1;
                    throw Object.assign(new Error("synthetic manifest-directory EIO"), { code: "EIO" });
                }
                return real(target, ...rest);
            }) as never);
            return { off: () => { on = false; }, refused: () => refused };
        }
        const settled = async (): Promise<unknown> => runOnce(h).then((summary) => summary, (error: unknown) => error);

        /** The artifact is healed exactly once from Drive: right bytes, the manifest untouched, no new gap, Drive evidence as it was. */
        async function expectHealed(lost: Lost, baseline: { gaps: number; localVerified: number; downloads: number; drivePdfs: number }): Promise<void> {
            expect(await localState()).toEqual({ state: "verified", reasonCode: null });
            const healed = await fs.readFile(path.join(h.archive, lost.localKey));
            expect(healed.length).toBe(lost.pdf.length);
            expect(sha256Of(healed)).toBe(sha256Of(lost.pdf));
            expect(await fs.readFile(path.join(h.archive, lost.manifestKey))).toEqual(lost.manifestBytes);
            expect((await ledgerState()).manifests.get(lost.manifestKey)?.sha256).toBe(sha256Of(lost.manifestBytes));
            expect((await ledgerState()).gaps.length).toBe(baseline.gaps);
            expect(await localVerifiedCount() - baseline.localVerified).toBe(1);
            expect(fakes.drive.downloads - baseline.downloads).toBe(1);
            expect(drivePdfCount()).toBe(baseline.drivePdfs);
            expect(await driveState()).toBe("verified");
        }
        const baselineOf = async () => ({ gaps: (await ledgerState()).gaps.length, localVerified: await localVerifiedCount(), downloads: fakes.drive.downloads, drivePdfs: drivePdfCount() });

        it("should record a retryable archive-unavailable when the archive disappears after the preflight and before the manifest listing, then heal (reviewer probe: mid-list)", async () => {
            const lost = await lostLocalCopy();
            const baseline = await baselineOf();
            const away = `${h.archive}.away`;
            let moved = false;
            const fetchImpl: typeof fetch = async (input, init) => {
                const response = await fetch(input, init);
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
                if (!moved && url.includes("/candidates")) {
                    moved = true;
                    await fs.rename(h.archive, away);
                }
                return response;
            };

            const outage = await runOnce(h, { fetchImpl }).then((summary) => summary, (error: unknown) => error);

            expect(moved).toBe(true);
            expect(outage).toBeDefined();
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
            expect(fakes.drive.downloads).toBe(baseline.downloads);
            await fs.rename(away, h.archive);

            const summary = await runOnce(h);

            expect(summary.outcome).toBe("finished");
            await expectHealed(lost, baseline);
        }, 240_000);

        it("should record no terminal transition and no gap when the manifests directory cannot be listed while every root check succeeds, then heal (reviewer probe: directory I/O)", async () => {
            const lost = await lostLocalCopy();
            const baseline = await baselineOf();
            const fault = failListing(manifestsDirOf(lost));

            const outage = await settled();

            expect(fault.refused()).toBeGreaterThanOrEqual(1);
            expect(outage).toBeDefined();
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
            expect((await ledgerState()).gaps.length).toBe(baseline.gaps);
            expect((await records("destination_transition")).filter((record) => !isDrive(record) && record.body["reasonCode"] === "exact-bytes-unavailable")).toHaveLength(0);
            expect(fakes.drive.downloads).toBe(baseline.downloads);

            fault.off();
            const summary = await runOnce(h);

            expect(summary.outcome).toBe("finished");
            await expectHealed(lost, baseline);
        }, 240_000);

        it("should stay retryable when the enumeration ends negatively and the archive is lost just before the decision, then establish the absence on a stable archive", async () => {
            const lost = await lostLocalCopy();
            await fs.rm(path.join(h.archive, lost.manifestKey));
            const away = `${h.archive}.away`;
            // The enumeration lists D001, then the company's completions and runs directories: it is complete (and negative) after the last one.
            const spy = afterListing(path.join(h.archive, "eformsign", COMPANY, "runs"), async () => { await fs.rename(h.archive, away); });

            await settled();

            expect(spy.listed()).toBe(1);
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
            await fs.rename(away, h.archive);
            await settled();
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "exact-bytes-unavailable" });
        }, 240_000);

        it("should stay retryable for this run when a listed manifest is gone before it is read, and heal on the next stable run", async () => {
            const lost = await lostLocalCopy();
            const baseline = await baselineOf();
            const manifestPath = path.join(h.archive, lost.manifestKey);
            const spy = afterListing(manifestsDirOf(lost), async () => { await fs.rm(manifestPath); });

            await settled();

            expect(spy.listed()).toBe(1);
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
            expect(fakes.drive.downloads).toBe(baseline.downloads);
            await fs.writeFile(manifestPath, lost.manifestBytes, { mode: 0o600 });

            const summary = await runOnce(h);

            expect(summary.outcome).toBe("finished");
            await expectHealed(lost, baseline);
        }, 240_000);

        /** The one local destination transition into blocked/archive-unavailable per artifact, however many runs the outage lasts. */
        const outageTransitions = async (): Promise<number> =>
            (await records("destination_transition")).filter((record) => !isDrive(record) && record.body["to"] === "blocked" && record.body["reasonCode"] === "archive-unavailable").length;
        const localTransitions = async (): Promise<number> => (await records("destination_transition")).filter((record) => !isDrive(record)).length;

        it("should write one unchanged outage transition over four outage runs (the ledger reopened each time), then heal", async () => {
            const lost = await lostLocalCopy();
            const baseline = await baselineOf();
            const before = await localTransitions();
            const away = await swapArchive(h);

            for (let attempt = 0; attempt < 4; attempt += 1) {
                const outage = await runOnce(h);
                expect(outage.reasonCodes).toContain("archive-unavailable");
            }

            expect(await outageTransitions()).toBe(1);
            expect(await localTransitions() - before).toBe(1);
            expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
            expect((await ledgerState()).gaps.length).toBe(baseline.gaps);
            const entry = [...(await ledgerState()).destinations.values()].find((candidate) => !String(candidate.destinationIdentity).startsWith("drive:"))!;
            expect(entry).toMatchObject({ state: "blocked", reasonCode: "archive-unavailable", attempts: 0, nextRetryAt: null });

            await swapBack(h, away);
            const summary = await runOnce(h);

            expect(summary.outcome).toBe("finished");
            await expectHealed(lost, baseline);
        }, 240_000);

        /** The outage transition as another retry timestamp would leave it, written by hand into the ledger. */
        async function appendOutageTransitionWithRetryAt(nextRetryAt: string): Promise<void> {
            const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
            try {
                const entry = [...store.state.destinations.values()].find((candidate) => !String(candidate.destinationIdentity).startsWith("drive:"))!;
                await store.append("destination_transition", {
                    artifactIdentity: entry.artifactIdentity, destinationIdentity: entry.destinationIdentity, destinationRevision: entry.destinationRevision,
                    from: "blocked", to: "blocked", reasonCode: "archive-unavailable", attempts: entry.attempts, nextRetryAt, relativeKey: entry.relativeKey,
                } as never, new Date().toISOString());
            } finally {
                await store.close();
            }
        }

        it("should not suppress the outage transition while the live entry carries another retry timestamp, and suppress it again once it is written", async () => {
            await lostLocalCopy();
            const away = await swapArchive(h);
            await runOnce(h);
            expect(await outageTransitions()).toBe(1);

            await appendOutageTransitionWithRetryAt("2099-01-01T00:00:00.000Z");
            expect(await outageTransitions()).toBe(2);
            await runOnce(h);
            expect(await outageTransitions()).toBe(3);
            await runOnce(h);
            expect(await outageTransitions()).toBe(3);
            await swapBack(h, away);
        }, 240_000);
    });
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

/**
 * PF1b follow-up: the same outage rule for an artifact whose length the ledger knows. Its staged copy is gone and the verified Drive copy
 * cannot be used while the archive is down: that is a temporary state (archive-unavailable), never the terminal exact-bytes-unavailable.
 */
describe("BJJ-456 PF1b: a known-length artifact is not made terminal by an archive outage", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    const records = async (type?: string) => (await readLedgerRecords(h.control)).filter((record) => type === undefined || record.type === type);
    const localState = async (): Promise<{ state: string; reasonCode: unknown }> => {
        let last: { state: string; reasonCode: unknown } = { state: "none", reasonCode: null };
        for (const record of await records("destination_transition")) {
            if (!isDrive(record)) last = { state: String(record.body["to"]), reasonCode: record.body["reasonCode"] ?? null };
        }
        return last;
    };
    const gapCount = async (): Promise<number> => {
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            return store.state.gaps.length;
        } finally {
            await store.close();
        }
    };

    /** One document verified locally (and on Drive when configured); the local PDF and every staged copy are lost; `verify --all` makes the local entry integrity_error; the next snapshot is empty. */
    async function lostCopy(withDrive: boolean): Promise<{ localKey: string; pdf: Buffer }> {
        h = await createHarness({ docs: [singleDoc("D001")], ...(withDrive ? { config: { drive: fakes.config } as never } : {}) });
        await initArchive(h);
        if (withDrive) await bindDrive(h);
        await runOnce(h);
        const localKey = (await listFiles(h.archive)).find((file) => PDF_KEY.test(`/${file}`))!;
        const pdf = await fs.readFile(path.join(h.archive, localKey));
        await fs.rm(path.join(h.archive, localKey));
        for (const file of await listFiles(h.control)) if (file.endsWith(".bin")) await fs.rm(path.join(h.control, file));
        const summary = await withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));
        expect(summary.integrityErrors).toBeGreaterThanOrEqual(1);
        expect((await localState()).state).toBe("integrity_error");
        h.api.docs = [];
        return { localKey, pdf };
    }

    it("should record archive-unavailable during an archive outage and heal once from the verified Drive copy when the archive is back", async () => {
        const lost = await lostCopy(true);
        const gapsBefore = await gapCount();
        const away = await swapArchive(h);

        const outage = await runOnce(h);

        expect(outage.reasonCodes).toContain("archive-unavailable");
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });

        await swapBack(h, away);
        const downloadsBefore = fakes.drive.downloads;
        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(await gapCount()).toBe(gapsBefore);
    }, 240_000);

    /**
     * PF1c: the archive is reachable at the preflight and lost while the verified Drive copy is being fetched (the fetch fails): the
     * no-copy decision for a known-length artifact must not be the terminal exact-bytes-unavailable.
     */
    it("should record archive-unavailable, not exact-bytes-unavailable, when the archive is lost between the copy lookup and the terminal decision", async () => {
        await lostCopy(true);
        const away = `${h.archive}.away`;
        let moved = false;
        const fetchImpl: typeof fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (!moved && url.includes("alt=media")) {
                moved = true;
                await fs.rename(h.archive, away);
                return new Response(null, { status: 503 });
            }
            return fetch(input, init);
        };

        const settled = await runOnce(h, { fetchImpl }).then((summary) => summary, (error: unknown) => error);

        expect(settled).toBeDefined();
        expect(moved).toBe(true);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "archive-unavailable" });
        await fs.rename(away, h.archive);
        const next = await runOnce(h);
        expect(next.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
    }, 240_000);

    it("should still record exact-bytes-unavailable when the archive is reachable and Drive holds no verified copy", async () => {
        const lost = await lostCopy(false);

        const summary = await runOnce(h);

        expect(summary.outcome).toBe("finished");
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "exact-bytes-unavailable" });
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
    }, 240_000);
});

/**
 * PB1: a Drive that could not be asked is not an answer. The local copy of a known-length artifact is lost, Drive holds it verified, and
 * Drive cannot be asked (a download answering 503, or a root check that never lets the gate open): the local entry stays retryable
 * (non-terminal blocked) and heals on the next run that can ask. Only "Drive answered, no usable copy" may end terminal.
 */
describe("BJJ-456 PB1: a Drive that could not be asked does not make a lost local copy terminal", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    const records = async (type?: string) => (await readLedgerRecords(h.control)).filter((record) => type === undefined || record.type === type);
    const localTransitions = async () => (await records("destination_transition")).filter((record) => !isDrive(record));
    const localState = async (): Promise<{ state: string; reasonCode: unknown }> => {
        let last: { state: string; reasonCode: unknown } = { state: "none", reasonCode: null };
        for (const record of await localTransitions()) last = { state: String(record.body["to"]), reasonCode: record.body["reasonCode"] ?? null };
        return last;
    };
    const driveState = async (): Promise<string> => {
        let last = "none";
        for (const record of await records("destination_transition")) if (isDrive(record)) last = String(record.body["to"]);
        return last;
    };
    const terminalTransitions = async (): Promise<number> =>
        (await localTransitions()).filter((record) => record.body["reasonCode"] === "exact-bytes-unavailable").length;
    const gapCount = async (): Promise<number> => {
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            return store.state.gaps.length;
        } finally {
            await store.close();
        }
    };

    /** One document verified locally and on Drive; the local PDF and every staged copy are lost; `verify --all` makes the local entry integrity_error; the next snapshot is empty. */
    async function lostCopy(): Promise<{ localKey: string; pdf: Buffer }> {
        h = await createHarness({ docs: [singleDoc("D001")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);
        await runOnce(h);
        const localKey = (await listFiles(h.archive)).find((file) => PDF_KEY.test(`/${file}`))!;
        const pdf = await fs.readFile(path.join(h.archive, localKey));
        await fs.rm(path.join(h.archive, localKey));
        for (const file of await listFiles(h.control)) if (file.endsWith(".bin")) await fs.rm(path.join(h.control, file));
        const summary = await withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));
        expect(summary.integrityErrors).toBeGreaterThanOrEqual(1);
        expect((await localState()).state).toBe("integrity_error");
        h.api.docs = [];
        return { localKey, pdf };
    }

    async function expectHealed(lost: { localKey: string; pdf: Buffer }): Promise<void> {
        fakes.drive.clearFaults();
        const downloadsBefore = fakes.drive.downloads;
        const summary = await runOnce(h);
        expect(summary.outcome).toBe("finished");
        expect(fakes.drive.downloads - downloadsBefore).toBe(1);
        expect(await localState()).toEqual({ state: "verified", reasonCode: null });
        expect(await fs.readFile(path.join(h.archive, lost.localKey))).toEqual(lost.pdf);
        expect(await driveState()).toBe("verified");
        expect(await terminalTransitions()).toBe(0);
    }

    it("should keep the local entry retryable while the Drive download answers 503, then heal from Drive (PB1 a)", async () => {
        const lost = await lostCopy();
        const fault = fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });

        const outage = await runOnce(h).then((summary) => summary, (error: unknown) => error);

        expect(outage).toBeDefined();
        expect(fault.hits).toBeGreaterThanOrEqual(1);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "drive-unavailable" });
        expect(await terminalTransitions()).toBe(0);
        expect(await driveState()).toBe("verified");
        await expect(fs.lstat(path.join(h.archive, lost.localKey))).rejects.toMatchObject({ code: "ENOENT" });
        // PB1-F2: the carried entry left blocked is reported, not lost from the run's counts and reasons.
        expect((outage as RunSummary).counts!.blocked).toBe(1);
        expect((outage as RunSummary).reasonCodes).toContain("drive-unavailable");

        await expectHealed(lost);
    }, 240_000);

    it("should keep the local entry retryable while the Drive root check fails and the gate never opens, then heal (PB1 b)", async () => {
        const lost = await lostCopy();
        const fault = fakes.drive.addFault({ route: "get", action: driveFaults.status(503, "backendError") });

        const outage = await runOnce(h).then((summary) => summary, (error: unknown) => error);

        expect(outage).toBeDefined();
        expect(fault.hits).toBeGreaterThanOrEqual(1);
        const during = await localState();
        expect(during.state).toBe("blocked");
        expect(during.reasonCode).not.toBe("exact-bytes-unavailable");
        expect(during.reasonCode).toBe("drive-unavailable");
        expect(await terminalTransitions()).toBe(0);
        expect(await driveState()).toBe("verified");

        await expectHealed(lost);
    }, 240_000);

    it("should write at most one local transition over repeated Drive outages (PB1 c)", async () => {
        const lost = await lostCopy();
        const before = (await localTransitions()).length;
        fakes.drive.addFault({ route: "download", action: driveFaults.status(503, "backendError") });

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const outage = (await runOnce(h).then((summary) => summary, (error: unknown) => error)) as RunSummary;
            expect(outage.counts!.blocked).toBe(1);
            expect(outage.reasonCodes).toContain("drive-unavailable");
        }

        expect((await localTransitions()).length - before).toBe(1);
        expect(await localState()).toEqual({ state: "blocked", reasonCode: "drive-unavailable" });
        expect(await terminalTransitions()).toBe(0);
        const store = await LedgerStore.open(h.control, { deferTornTailRepair: true });
        try {
            const entry = [...store.state.destinations.values()].find((candidate) => !String(candidate.destinationIdentity).startsWith("drive:"))!;
            expect(entry).toMatchObject({ state: "blocked", reasonCode: "drive-unavailable", nextRetryAt: null });
        } finally {
            await store.close();
        }

        await expectHealed(lost);
    }, 240_000);
    /** PB1-F1: Drive cannot be asked because its configuration is unusable, not because it answered. */
    it("should keep the local entry retryable while the Drive secret file is unusable (token-file-invalid), then heal once it is fixed (PB1 F1 secret)", async () => {
        const lost = await lostCopy();
        const gapsBefore = (await gapCount());
        const downloadsBefore = fakes.drive.downloads;
        await fs.chmod(fakes.refreshTokenFile, 0o644);

        const outage = (await runOnce(h).then((summary) => summary, (error: unknown) => error)) as RunSummary;

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "token-file-invalid" });
        expect(await terminalTransitions()).toBe(0);
        expect(await gapCount()).toBe(gapsBefore);
        expect(await driveState()).toBe("verified");
        expect(outage.counts!.blocked).toBe(1);
        expect(fakes.drive.downloads).toBe(downloadsBefore);

        await fs.chmod(fakes.refreshTokenFile, 0o600);
        await expectHealed(lost);
    }, 240_000);

    it("should keep the local entry retryable while the config has no drive block but the ledger holds a verified Drive copy, then heal when it is back (PB1 F1 no drive block)", async () => {
        const lost = await lostCopy();
        const gapsBefore = (await gapCount());
        await rewriteConfig(h, {});

        const outage = (await runOnce(h).then((summary) => summary, (error: unknown) => error)) as RunSummary;

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "drive-not-configured" });
        expect(await terminalTransitions()).toBe(0);
        expect(await gapCount()).toBe(gapsBefore);
        expect(outage.counts!.blocked).toBe(1);
        expect(outage.reasonCodes).toContain("drive-not-configured");

        await rewriteConfig(h, { drive: fakes.config } as never);
        await expectHealed(lost);
    }, 240_000);

    it("should still end terminal when there is no Drive block and the ledger holds no verified Drive copy (PB1 F1 control)", async () => {
        h = await createHarness({ docs: [singleDoc("D001")] });
        await initArchive(h);
        await runOnce(h);
        const localKey = (await listFiles(h.archive)).find((file) => PDF_KEY.test(`/${file}`))!;
        await fs.rm(path.join(h.archive, localKey));
        for (const file of await listFiles(h.control)) if (file.endsWith(".bin")) await fs.rm(path.join(h.control, file));
        await withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));
        h.api.docs = [];

        await runOnce(h);

        expect(await localState()).toEqual({ state: "blocked", reasonCode: "exact-bytes-unavailable" });
    }, 240_000);
});

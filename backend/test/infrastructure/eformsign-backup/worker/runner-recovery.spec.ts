import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";
import { controlMarkerWriter } from "infrastructure/eformsign-backup/worker/runner";

import { probeFor } from "./helpers/destination-support";
import {
    ARCHIVE_ID, COMPANY, archivePdfs, createHarness, destroyHarness, identityFor, initArchive, listFiles, pairDoc, readCompletions,
    readJsonFile, readLedgerRecords, runOnce, singleDoc, transitionPath, treeSignature, tryRun, withWorker, type Harness,
} from "./helpers/runner-support";

async function flipByte(file: string, offset: number): Promise<void> {
    const bytes = await fs.readFile(file);
    bytes[offset] = bytes[offset]! ^ 0xff;
    await fs.writeFile(file, bytes);
}
async function swapArchive(h: Harness): Promise<string> {
    const away = `${h.archive}.away`;
    await fs.rename(h.archive, away);
    await fs.mkdir(h.archive, { mode: 0o700 });
    return away;
}
const pdfOf = async (h: Harness, doc: string, type: string): Promise<string> =>
    path.join(h.archive, (await archivePdfs(h.archive)).find((file) => file.includes(`/${doc}/`) && file.includes(`/${type}/`))!);
const verifyAll = (h: Harness) => withWorker(h, "verify", (worker) => worker.runner.verify({ all: true }));

describe("T-WRK-11: verified, then damaged (V10)", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });

    async function damaged(): Promise<{ id: string; file: string }> {
        const d1 = pairDoc("D001");
        h = await createHarness({ docs: [d1, pairDoc("D002")] });
        await initArchive(h);
        await runOnce(h);
        const file = await pdfOf(h, "D001", "document");
        await flipByte(file, 20);
        const summary = await verifyAll(h);
        expect(summary.integrityErrors).toBe(1);
        return { id: identityFor(h, d1, "document"), file };
    }

    it("should find the damage with verify, rename the file aside and keep the earlier verified event (a: staged bytes present -> republish)", async () => {
        const { id, file } = await damaged();

        expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "verifying", "verified", "integrity_error"]);
        const dir = path.dirname(file);
        const names = await fs.readdir(dir);
        expect(names.filter((name) => name.includes(".corrupt-"))).toHaveLength(1);
        expect(names.filter((name) => name === path.basename(file))).toHaveLength(0);

        const requestsBefore = h.api.artifactRequests().length;
        const next = await runOnce(h);

        expect(next.counts).toMatchObject({ verified: 4, integrityError: 0 });
        expect(h.api.artifactRequests()).toHaveLength(requestsBefore);
        expect((await fs.readdir(dir)).filter((name) => name.endsWith(".pdf"))).toEqual([path.basename(file)]);
        expect(await transitionPath(h.control, id)).toEqual([
            "pending", "transferring", "verifying", "verified", "integrity_error", "pending", "transferring", "verifying", "verified",
        ]);
        const verifiedEvents = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && record.body["artifactIdentity"] === id && record.body["to"] === "verified");
        expect(verifiedEvents).toHaveLength(2);
    });

    it("should block as exact-bytes-unavailable when staging is gone and the identity is not in the new snapshot (b)", async () => {
        const { id } = await damaged();
        await fs.rm(path.join(h.control, "staging", `${id}.bin`));
        h.api.docs = [pairDoc("D002")];

        const next = await runOnce(h);

        expect(next).toMatchObject({ historicalCoverage: "known_gap", counts: { terminalUnavailable: 1 } });
        expect(await transitionPath(h.control, id)).toEqual(["pending", "transferring", "verifying", "verified", "integrity_error", "blocked"]);
        const completion = (await readCompletions(h.archive)).pop()!;
        expect(completion.value["gaps"]).toEqual([{ documentId: "D001", reasonCode: "exact-bytes-unavailable" }]);
        expect(completion.value["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D002"]);
        const inventory = await readJsonFile(path.join(h.archive, "eformsign", COMPANY, "runs", `${next.runId}.json`));
        expect(inventory["counts"]).toMatchObject({ terminalUnavailable: 1 });
        expect(inventory["historicalCoverage"]).toBe("known_gap");
        const verifiedEvents = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition" && record.body["artifactIdentity"] === id && record.body["to"] === "verified");
        expect(verifiedEvents).toHaveLength(1);
    });

    it("should download the artifact again when staging is gone but the identity is in the new snapshot (b')", async () => {
        const { id } = await damaged();
        await fs.rm(path.join(h.control, "staging", `${id}.bin`));
        const before = h.api.artifactRequests().length;
        const next = await runOnce(h);
        expect(next.counts).toMatchObject({ verified: 4 });
        expect(h.api.artifactRequests()).toHaveLength(before + 1);
    });

    it("should not touch verified entries when the archive is unavailable during verify, and say so at run level (U2)", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        await runOnce(h);
        const away = await swapArchive(h);
        const transitions = (await readLedgerRecords(h.control)).filter((record) => record.type === "destination_transition").length;

        const summary = await verifyAll(h);

        expect(summary).toMatchObject({ archiveAvailable: false, integrityErrors: 0 });
        const records = await readLedgerRecords(h.control);
        expect(records.filter((record) => record.type === "destination_transition")).toHaveLength(transitions);
        const finished = records.filter((record) => record.type === "run_finished").pop()!;
        expect(finished.body).toMatchObject({ snapshotStatus: "blocked", reasonCodes: ["archive-unavailable"] });
        expect(await listFiles(h.archive)).toEqual([]);
        await fs.rename(h.archive, `${h.archive}.new`);
        await fs.rename(away, h.archive);
        const again = await runOnce(h);
        expect(again.counts).toMatchObject({ verified: 2 });
    });

    it("should re-hash only entries older than 7 days by default and everything with all", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        await runOnce(h);
        await flipByte(await pdfOf(h, "D001", "document"), 20);

        h.clock.advance(24 * 3600 * 1000);
        expect(await withWorker(h, "verify", (worker) => worker.runner.verify({ all: false }))).toMatchObject({ checked: 0, integrityErrors: 0 });
        h.clock.advance(7 * 24 * 3600 * 1000);
        expect(await withWorker(h, "verify", (worker) => worker.runner.verify({ all: false }))).toMatchObject({ checked: 2, integrityErrors: 1 });
    });
});

describe("recover (contract section 3) and the marker carry-overs", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });

    async function history(): Promise<void> {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        await runOnce(h);
        h.api.docs.push(singleDoc("D009"));
        h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D009", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
        await runOnce(h);
    }
    const installationOf = async (): Promise<string> => (await readJsonFile(path.join(h.archive, ".bjj-backup", "installation.json")))["installationId"];
    const recover = (id: string) => withWorker(h, "recover", (worker) => worker.runner.recover({ installationId: id }));
    async function corruptLedger(): Promise<void> {
        const journal = path.join(h.control, "ledger", "journal-000000000001.jsonl");
        const text = await fs.readFile(journal);
        const firstEnd = text.indexOf(0x0a);
        await flipByte(journal, firstEnd + 30);
    }

    it("should rebuild a corrupt ledger: floor, known gaps, re-hash, then the next completion continues the sequence and restore picks it", async () => {
        await history();
        await corruptLedger();
        expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
        const oldLedger = await treeSignature(path.join(h.control, "ledger"));

        const result = await recover(await installationOf());

        expect(result).toMatchObject({ recovered: 4, unverified: 0, sequenceFloor: 2 });
        const records = await readLedgerRecords(h.control);
        expect(records[0]!.type).toBe("recovery_started");
        expect(records[0]!.body).toMatchObject({
            sequenceFloor: 2, knownGaps: [{ documentId: "D009", artifactIdentity: null, reasonCode: "source-removed" }],
        });
        expect(records.filter((record) => record.type === "recovered_verified")).toHaveLength(4);
        const quarantined = (await fs.readdir(h.control)).filter((name) => name.startsWith("ledger.quarantine-"));
        expect(quarantined).toHaveLength(1);
        expect(await treeSignature(path.join(h.control, quarantined[0]!))).toBe(oldLedger);

        const requests = h.api.artifactRequests().length;
        const next = await runOnce(h);
        expect(next).toMatchObject({ sequence: 3, historicalCoverage: "known_gap", counts: { verified: 4 } });
        expect(h.api.artifactRequests()).toHaveLength(requests + 1); // only D009 is asked for again
        const out = path.join(h.base, "out");
        await fs.mkdir(out, { mode: 0o700 });
        const report = await restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { latest: true }, outDir: out });
        expect(report).toMatchObject({ status: "unverified-archive", sequence: 3 });
        expect(report.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002"]);
    });

    it("should record only artifacts that still hash correctly as recovered (no fake success)", async () => {
        await history();
        await flipByte(await pdfOf(h, "D001", "document"), 20);
        await corruptLedger();
        const result = await recover(await installationOf());
        expect(result).toMatchObject({ recovered: 3, unverified: 1 });
        expect((await readLedgerRecords(h.control)).filter((record) => record.type === "recovered_verified")).toHaveLength(3);
    });

    it("should refuse a wrong installation id and change nothing", async () => {
        await history();
        await corruptLedger();
        const before = await treeSignature(h.control);
        await expect(recover("not-the-installation")).rejects.toBeInstanceOf(WorkerError);
        expect(await treeSignature(h.control)).toBe(before);
    });

    it("should refuse when the archive inode was swapped (new empty directory), leaving the ledger byte for byte unchanged", async () => {
        await history();
        const id = await installationOf();
        await corruptLedger();
        await swapArchive(h);
        const before = await treeSignature(h.control);
        await expect(recover(id)).rejects.toMatchObject({ reasonCode: expect.stringMatching(/^archive-(identity-mismatch|marker-invalid)$/) });
        expect(await treeSignature(h.control)).toBe(before);
    });

    it("should refuse when the archive inode was swapped but the marker was copied over", async () => {
        await history();
        const id = await installationOf();
        await corruptLedger();
        const away = await swapArchive(h);
        await fs.mkdir(path.join(h.archive, ".bjj-backup"), { mode: 0o700 });
        await fs.copyFile(path.join(away, ".bjj-backup", "installation.json"), path.join(h.archive, ".bjj-backup", "installation.json"));
        const before = await treeSignature(h.control);
        await expect(recover(id)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
        expect(await treeSignature(h.control)).toBe(before);
    });

    it("should refuse recover while the ledger is healthy", async () => {
        await history();
        const before = await treeSignature(h.control);
        await expect(recover(await installationOf())).rejects.toBeInstanceOf(WorkerError);
        expect(await treeSignature(h.control)).toBe(before);
    });

    it("should rewrite a missing control marker from the archive marker", async () => {
        await history();
        const marker = path.join(h.control, "installation.json");
        await fs.rename(marker, `${marker}.away`);
        expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });

        await recover(await installationOf());

        expect(await readJsonFile(marker)).toMatchObject({ schemaVersion: 1, archiveId: ARCHIVE_ID, installationId: await installationOf() });
        expect((await runOnce(h)).sequence).toBe(3);
    });

    it("should refuse, changing nothing, when the control marker exists but disagrees with the archive marker", async () => {
        await history();
        const marker = path.join(h.control, "installation.json");
        const body = await readJsonFile(marker);
        await fs.rm(marker);
        await fs.writeFile(marker, `${JSON.stringify({ ...body, installationId: "other-installation" })}\n`, { mode: 0o600 });
        const before = await treeSignature(h.control);
        await expect(recover(await installationOf())).rejects.toBeInstanceOf(WorkerError);
        expect(await treeSignature(h.control)).toBe(before);
    });

    describe("a crash between the archive marker and the installed record (init window)", () => {
        const archiveMarkerOnly = async (): Promise<void> => {
            h = await createHarness({ docs: [pairDoc("D001")] });
            const stat = await fs.lstat(h.archive);
            const destination = new LocalDestination({
                archivePath: h.archive, archiveId: ARCHIVE_ID, expectedDev: stat.dev, expectedIno: stat.ino,
                reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000, requireMountPoint: false,
            }, probeFor());
            const written = await destination.writeMarker({ schemaVersion: 1, installationId: "install-window-1", archiveId: ARCHIVE_ID, createdAt: "2026-10-19T00:00:00.000Z" });
            expect(written.ok).toBe(true);
        };

        it("should be recovery_required for run, refused by init, and resolved by recover", async () => {
            await archiveMarkerOnly();
            expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
            await expect(initArchive(h)).rejects.toBeInstanceOf(WorkerError);
            expect(h.api.requests).toHaveLength(0);

            await recover("install-window-1");

            expect(await readJsonFile(path.join(h.control, "installation.json"))).toMatchObject({ installationId: "install-window-1", archiveId: ARCHIVE_ID });
            const records = await readLedgerRecords(h.control);
            expect(records[0]).toMatchObject({ type: "recovery_started", body: { sequenceFloor: 0, knownGaps: [], installationId: "install-window-1" } });
            const next = await runOnce(h);
            expect(next).toMatchObject({ sequence: 1, historicalCoverage: "unverified", counts: { verified: 2 } });
        });

        it("should resolve the same way when the control marker was written but the ledger was not", async () => {
            await archiveMarkerOnly();
            const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, installationId: "install-window-1", archiveId: ARCHIVE_ID, createdAt: "2026-10-19T00:00:00.000Z" })}\n`);
            await controlMarkerWriter(h.control, "installation.json", bytes);
            expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
            await recover("install-window-1");
            expect((await runOnce(h)).counts?.verified).toBe(2);
        });
    });
});

import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError, encodeLedgerLine } from "domain/eformsign-backup/worker";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";
import { controlMarkerWriter } from "infrastructure/eformsign-backup/worker/runner";

import { probeFor } from "./helpers/destination-support";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
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

    describe("a damaged staged copy is set aside, never trusted (V10 path 2)", () => {
        const stagedFile = (id: string): string => path.join(h.control, "staging", `${id}.bin`);
        const corruptCopies = async (): Promise<string[]> => (await fs.readdir(path.join(h.control, "staging"))).filter((name) => name.includes(".bin.corrupt-"));

        it("should download once and converge when the staged bytes were flipped in place (same size)", async () => {
            const { id } = await damaged();
            const before = await fs.readFile(stagedFile(id));
            await flipByte(stagedFile(id), 20);
            const requests = h.api.artifactRequests().length;

            const next = await runOnce(h);

            expect(next.counts).toMatchObject({ verified: 4, integrityError: 0, blocked: 0 });
            expect(h.api.artifactRequests()).toHaveLength(requests + 1);
            expect(await archivePdfs(h.archive)).toHaveLength(4);
            const kept = await corruptCopies();
            expect(kept).toHaveLength(1);
            expect((await fs.readFile(path.join(h.control, "staging", kept[0]!))).equals(before)).toBe(false);
            expect(await fs.readFile(stagedFile(id))).toHaveLength(before.length);
            const states = await transitionPath(h.control, id);
            expect(states.filter((state) => state === "integrity_error")).toHaveLength(1);
            expect(states[states.length - 1]).toBe("verified");
        });

        it("should download once and converge when the staged file was truncated", async () => {
            const { id } = await damaged();
            await fs.truncate(stagedFile(id), 100);
            const requests = h.api.artifactRequests().length;

            const next = await runOnce(h);

            expect(next.counts).toMatchObject({ verified: 4, integrityError: 0, blocked: 0 });
            expect(h.api.artifactRequests()).toHaveLength(requests + 1);
            expect(await archivePdfs(h.archive)).toHaveLength(4);
            const kept = await corruptCopies();
            expect(kept).toHaveLength(1);
            expect((await fs.stat(path.join(h.control, "staging", kept[0]!))).size).toBe(100);
            expect((await transitionPath(h.control, id)).filter((state) => state === "blocked")).toHaveLength(0);
        });

        it("should record exact-bytes-unavailable, keeping the damaged copy, when the identity is not in the new snapshot", async () => {
            const { id } = await damaged();
            await flipByte(stagedFile(id), 20);
            h.api.docs = [pairDoc("D002")];

            const next = await runOnce(h);

            expect(next).toMatchObject({ historicalCoverage: "known_gap", counts: { terminalUnavailable: 1 } });
            expect((await transitionPath(h.control, id)).pop()).toBe("blocked");
            expect(await corruptCopies()).toHaveLength(1);
        });
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

    it("should refuse, changing nothing, when the prior installation cannot be read and the archive root was swapped for one with a copied marker", async () => {
        await history();
        const id = await installationOf();
        await flipByte(path.join(h.control, "ledger", "journal-000000000001.jsonl"), 30);
        expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
        const away = await swapArchive(h);
        await fs.mkdir(path.join(h.archive, ".bjj-backup"), { mode: 0o700 });
        await fs.copyFile(path.join(away, ".bjj-backup", "installation.json"), path.join(h.archive, ".bjj-backup", "installation.json"));
        const before = [await treeSignature(h.control), await treeSignature(h.archive)];

        await expect(recover(id)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });

        expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
    });

    it("should re-hash every manifest found in the archive, also those no completion names", async () => {
        await history();
        const dir = path.join(h.archive, "eformsign", COMPANY, "completions");
        for (const name of await fs.readdir(dir)) await fs.rename(path.join(dir, name), path.join(h.base, `${name}.away`));
        await corruptLedger();

        const result = await recover(await installationOf());

        expect(result).toMatchObject({ recovered: 4, unverified: 0, sequenceFloor: 0 });
        expect((await readLedgerRecords(h.control)).filter((record) => record.type === "recovered_verified")).toHaveLength(4);
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

        /** Marker on both sides and a ledger directory whose first journal holds `content` (what a kill inside `initialize` leaves). */
        const journalWith = async (content: string): Promise<void> => {
            await archiveMarkerOnly();
            const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, installationId: "install-window-1", archiveId: ARCHIVE_ID, createdAt: "2026-10-19T00:00:00.000Z" })}\n`);
            await controlMarkerWriter(h.control, "installation.json", bytes);
            await fs.mkdir(path.join(h.control, "ledger"), { mode: 0o700 });
            await fs.writeFile(path.join(h.control, "ledger", "journal-000000000001.jsonl"), content, { mode: 0o600 });
            expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
        };

        it.each([
            ["an empty first journal (killed after the journal was created)", ""],
            ["a torn first line without a newline (killed in the middle of the installed record)", "{\"v\":1,\"seq\":1,\"type\":\"insta"],
        ])("should resolve the init window when the ledger holds %s", async (_name, content) => {
            await journalWith(content);

            await recover("install-window-1");

            expect((await readLedgerRecords(h.control))[0]).toMatchObject({ type: "recovery_started", body: { sequenceFloor: 0, installationId: "install-window-1" } });
            expect(await runOnce(h)).toMatchObject({ sequence: 1, counts: { verified: 2 } });
        });

        it("should still refuse, changing nothing, when the first complete journal line is corrupt", async () => {
            await journalWith("this is not a record\n");
            const before = await treeSignature(h.control);
            await expect(recover("install-window-1")).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
            expect(await treeSignature(h.control)).toBe(before);
        });
    });

    describe("a crash inside recover (quarantine window)", () => {
        const QA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const QB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const QS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const JOURNAL_1 = "journal-000000000001.jsonl";
        const AT = "2026-10-19T00:00:00.000Z";
        const ledgerDir = (): string => path.join(h.control, "ledger");
        const quarantineDir = (id: string): string => path.join(h.control, `ledger.quarantine-${id}`);

        /** What `quarantineAndReset` leaves after its rename: the old ledger under `ledger.quarantine-A`, no new directory yet. */
        async function renamedAway(): Promise<string> {
            await history();
            const id = await installationOf();
            await fs.rename(ledgerDir(), quarantineDir(QA));
            expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
            return id;
        }
        const emptyLedgerDir = async (): Promise<void> => { await fs.mkdir(ledgerDir(), { mode: 0o700 }); };
        const journalOne = async (content: string): Promise<void> => {
            await fs.writeFile(path.join(ledgerDir(), JOURNAL_1), content, { mode: 0o600 });
        };
        const installedBody = async () => {
            const first = (await readLedgerRecords(h.control))[0]!;
            expect(first.type).toBe("installed");
            return first.body as { installationId: string; archiveId: string; archiveDev: number; archiveIno: number; destinationIdentity: string; destinationRevision: string };
        };
        async function writeQuarantine(name: string, line: string): Promise<void> {
            await fs.mkdir(path.join(h.control, name), { mode: 0o700 });
            await fs.writeFile(path.join(h.control, name, JOURNAL_1), line, { mode: 0o600 });
        }
        async function swappedWithCopiedMarker(): Promise<void> {
            const away = await swapArchive(h);
            await fs.mkdir(path.join(h.archive, ".bjj-backup"), { mode: 0o700 });
            await fs.copyFile(path.join(away, ".bjj-backup", "installation.json"), path.join(h.archive, ".bjj-backup", "installation.json"));
        }
        async function expectRefused(id: string): Promise<void> {
            const before = [await treeSignature(h.control), await treeSignature(h.archive)];
            await expect(recover(id)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
            expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
        }
        async function expectRecovered(id: string, priorLedgerName: string | RegExp): Promise<void> {
            const stat = await fs.lstat(h.archive);
            expect(await recover(id)).toMatchObject({ recovered: 4, unverified: 0, sequenceFloor: 2 });
            const records = await readLedgerRecords(h.control);
            expect(records[0]).toMatchObject({
                type: "recovery_started",
                body: { archiveDev: stat.dev, archiveIno: stat.ino, sequenceFloor: 2, knownGaps: [{ documentId: "D009", reasonCode: "source-removed" }] },
            });
            const recorded = records[0]!.body["priorLedgerName"] as string;
            if (typeof priorLedgerName === "string") expect(recorded).toBe(priorLedgerName);
            else expect(recorded).toMatch(priorLedgerName);
            expect((await runOnce(h)).sequence).toBe(3);
        }

        const shapes: Array<[string, () => Promise<string>, string]> = [
            ["Q2: ledger/ renamed to a quarantine dir, no new ledger/", renamedAway, `ledger.quarantine-${QA}`],
            ["Q3: Q2 plus an empty ledger/", async () => { const id = await renamedAway(); await emptyLedgerDir(); return id; }, `ledger.quarantine-${QA}`],
            ["Q4: Q3 plus an empty first journal", async () => {
                const id = await renamedAway();
                await emptyLedgerDir();
                await journalOne("");
                return id;
            }, `ledger.quarantine-${QA}`],
            ["Q5: Q4 with the torn first bytes of recovery_started", async () => {
                const id = await renamedAway();
                await emptyLedgerDir();
                await journalOne("{\"v\":1,\"seq\":1,\"type\":\"recovery_st");
                return id;
            }, `ledger.quarantine-${QA}`],
        ];

        describe.each(shapes)("%s", (_name, build, priorLedgerName) => {
            it("should accept the genuine archive, adopt the quarantined prior and continue above the floor", async () => {
                const id = await build();
                await expectRecovered(id, priorLedgerName);
            });

            it("should refuse a swapped archive with a copied marker and change nothing", async () => {
                const id = await build();
                await swappedWithCopiedMarker();
                await expectRefused(id);
            });
        });

        describe("Q7: two quarantine dirs that agree, a fresh ledger/", () => {
            async function build(): Promise<string> {
                const id = await renamedAway();
                const body = { ...(await readPriorBody()), priorLedgerName: `ledger.quarantine-${QA}`, sequenceFloor: 0, knownGaps: [] };
                await writeQuarantine(`ledger.quarantine-${QB}`, encodeLedgerLine({ v: 1, seq: 1, type: "recovery_started", at: AT, body }));
                await emptyLedgerDir();
                await journalOne("");
                return id;
            }
            // The installed record now sits in quarantine A, so read it from there.
            async function readPriorBody() {
                const line = (await fs.readFile(path.join(quarantineDir(QA), JOURNAL_1), "utf8")).split("\n")[0]!;
                const { body } = JSON.parse(line) as { body: Awaited<ReturnType<typeof installedBody>> };
                return body;
            }

            it("should accept the genuine archive", async () => {
                await expectRecovered(await build(), /^ledger\.quarantine-[0-9a-f-]{36}$/);
            });

            it("should refuse a swapped archive with a copied marker and change nothing", async () => {
                const id = await build();
                await swappedWithCopiedMarker();
                await expectRefused(id);
            });
        });

        describe("X1: the quarantine dir holds records but its first line is corrupt", () => {
            async function build(): Promise<string> {
                await history();
                const id = await installationOf();
                await fs.rename(ledgerDir(), quarantineDir(QA));
                await flipByte(path.join(quarantineDir(QA), JOURNAL_1), 30);
                await emptyLedgerDir();
                await journalOne("");
                return id;
            }

            it.each([["the genuine archive", false], ["a swapped archive with a copied marker", true]])("should refuse %s and change nothing", async (_n, swapped) => {
                const id = await build();
                if (swapped) await swappedWithCopiedMarker();
                await expectRefused(id);
            });
        });

        describe("X2: the quarantine dir holds only a torn line, nothing is recorded anywhere", () => {
            it("should accept the genuine archive on the marker alone", async () => {
                await history();
                const id = await installationOf();
                await fs.rm(ledgerDir(), { recursive: true });
                await writeQuarantine(`ledger.quarantine-${QA}`, "{\"v\":1,\"seq\":1,\"type\":\"insta");
                await emptyLedgerDir();
                await journalOne("");
                expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });

                await recover(id);

                expect((await readLedgerRecords(h.control))[0]).toMatchObject({ type: "recovery_started", body: { installationId: id, sequenceFloor: 2 } });
            });
        });

        describe.each<[string, (body: Awaited<ReturnType<typeof installedBody>>) => Record<string, unknown>]>([
            ["archiveIno", (body) => ({ ...body, archiveIno: body.archiveIno + 1 })],
            ["archiveDev", (body) => ({ ...body, archiveDev: body.archiveDev + 1 })],
            ["installationId", (body) => ({ ...body, installationId: "other-installation" })],
        ])("X3: ledger/ holds the real prior and a stale quarantine dir differs only in %s", (_field, vary) => {
            async function build(): Promise<string> {
                await history();
                const id = await installationOf();
                await corruptLedger();
                const body = await installedBody();
                await writeQuarantine(`ledger.quarantine-${QS}`, encodeLedgerLine({
                    v: 1, seq: 1, type: "installed", at: AT, body: vary(body) as Awaited<ReturnType<typeof installedBody>>,
                }));
                expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
                return id;
            }

            it.each([["the genuine archive", false], ["a swapped archive with a copied marker", true]])("should refuse %s and change nothing", async (_n, swapped) => {
                const id = await build();
                if (swapped) await swappedWithCopiedMarker();
                await expectRefused(id);
            });
        });

        describe("P1: unreadable evidence is not empty evidence", () => {
            /** The Q4 shape: the only durable `installed` record sits in quarantine A, a fresh ledger/ beside it. */
            async function q4(): Promise<string> {
                const id = await renamedAway();
                await emptyLedgerDir();
                await journalOne("");
                return id;
            }
            const locked: Array<[string, () => string]> = [
                ["the quarantine dir", () => quarantineDir(QA)],
                ["only the quarantine journal", () => path.join(quarantineDir(QA), JOURNAL_1)],
            ];

            describe.each(locked)("%s is mode 000", (_name, target) => {
                it.each([["a swapped archive with a copied marker", true], ["the genuine archive", false]])(
                    "should refuse %s with control-unavailable and change nothing", async (_n, swapped) => {
                        const id = await q4();
                        if (swapped) await swappedWithCopiedMarker();
                        const before = [await treeSignature(h.control), await treeSignature(h.archive)];
                        const mode = (await fs.stat(target())).mode & 0o777;
                        await fs.chmod(target(), 0o000);
                        try {
                            await expect(recover(id)).rejects.toMatchObject({ reasonCode: "control-unavailable" });
                        } finally {
                            await fs.chmod(target(), mode);
                        }
                        expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
                    });
            });
        });

        describe("SIGKILL between quarantineAndReset and the recovery_started record", () => {
            async function killed(): Promise<string> {
                await history();
                const id = await installationOf();
                await corruptLedger();
                const child = spawnUnderFlock(h, ["recover", "--config", h.configPath, "--installation-id", id, "--kill-at", "recover-after-quarantine"]);
                expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
                const quarantined = (await fs.readdir(h.control)).filter((name) => name.startsWith("ledger.quarantine-"));
                expect(quarantined).toHaveLength(1);
                expect((await readLedgerRecords(h.control)).length).toBe(0);
                expect(await tryRun(h)).toMatchObject({ reasonCode: "recovery-required" });
                return id;
            }

            it("should leave run recovery-required and let recover with the genuine archive succeed", async () => {
                const id = await killed();
                const name = (await fs.readdir(h.control)).find((entry) => entry.startsWith("ledger.quarantine-"))!;

                await expectRecovered(id, name);

                expect((await fs.readdir(h.control)).filter((entry) => entry.startsWith("ledger.quarantine-"))).toEqual([name]);
            }, 120_000);

            it("should refuse with exit 69 and change nothing when the archive was swapped for one with a copied marker", async () => {
                const id = await killed();
                await swappedWithCopiedMarker();
                const before = [await treeSignature(h.control), await treeSignature(h.archive)];

                const child = spawnUnderFlock(h, ["recover", "--config", h.configPath, "--installation-id", id]);
                expect(await child.exited).toEqual({ code: 69, signal: null });

                expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
            }, 120_000);
        });
    });
});
